const User = require('../models/User');
const Creator = require('../models/Creator');
const Wallet = require('../models/Wallet');
const Post = require('../models/Post');
const { AppUser, AppReport, AppTransaction, AppTicket, AppSetting, AppDashboard } = require('../models/AdminData');
const { isValidSessionId, timingSafeStringEqual } = require('../utils/authSecurity');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_UPPER = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const clampPercent = (value) => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
};

const formatCompact = (value) => {
  const num = Number(value) || 0;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return `${num}`;
};

const toSeries = (labels) => labels.map((name) => ({ name, val: 0 }));

const normalizeSeries = (series) => {
  const max = Math.max(0, ...series.map((item) => Number(item.val) || 0));
  if (max === 0) return series.map((item) => ({ ...item, val: 0 }));
  return series.map((item) => ({
    ...item,
    val: clampPercent(((Number(item.val) || 0) / max) * 100),
  }));
};

const byMonthName = (dateLike) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('default', { month: 'short' });
};

const formatDate = (dateLike) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
};

const formatCurrency = (value) => `₹ ${new Intl.NumberFormat('en-IN').format(Number(value) || 0)}`;
const formatCreatorEarnings = (value) => {
  const amount = Number(value) || 0;
  if (amount >= 1000000) return `₹${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}k`;
  return `₹${amount.toFixed(2)}`;
};

exports.getCreatorsAnalyticsData = async (req, res) => {
  try {
    const [creators, users, posts, wallets] = await Promise.all([
      Creator.find().sort({ createdAt: -1 }).lean(),
      User.find({ role: 'creator' }).select('_id name email username isVerified createdAt').lean(),
      Post.find().select('creatorId likes comments views isExclusive accessTier revenue createdAt').lean(),
      Wallet.find().select('userId transactions').lean(),
    ]);

    const userById = new Map(users.map((user) => [String(user._id), user]));

    const postsByCreator = new Map();
    posts.forEach((post) => {
      const creatorId = String(post.creatorId);
      if (!postsByCreator.has(creatorId)) {
        postsByCreator.set(creatorId, {
          count: 0,
          likes: 0,
          comments: 0,
          views: 0,
          revenue: 0,
          free: 0,
          paid: 0,
        });
      }

      const bucket = postsByCreator.get(creatorId);
      bucket.count += 1;
      bucket.likes += Number(post.likes) || 0;
      bucket.comments += Number(post.comments) || 0;
      bucket.views += Number(post.views) || 0;
      bucket.revenue += Number(post.revenue?.total) || 0;

      const isPaidPost = post.isExclusive === true || post.accessTier === 'members_only' || post.accessTier === 'exclusive_paid';
      if (isPaidPost) bucket.paid += 1;
      else bucket.free += 1;
    });

    const walletCreditsByUserId = new Map();
    wallets.forEach((wallet) => {
      const userId = String(wallet.userId);
      const creditTotal = (wallet.transactions || []).reduce((sum, tx) => {
        if (tx.type === 'credit' && tx.status === 'success') {
          return sum + (Number(tx.amount) || 0);
        }
        return sum;
      }, 0);
      walletCreditsByUserId.set(userId, creditTotal);
    });

    const creatorRows = creators.map((creator, index) => {
      const creatorUser = userById.get(String(creator.userId));
      const walletCreditTotal = walletCreditsByUserId.get(String(creator.userId)) || 0;
      const postStats = postsByCreator.get(String(creator._id)) || {
        count: 0,
        likes: 0,
        comments: 0,
        views: 0,
        revenue: 0,
        free: 0,
        paid: 0,
      };

      const subscriptionRevenue = (creator.subscribers || []).length * (Number(creator.subscriptionPrice) || 0);
      const totalRevenue = (postStats.revenue || 0) + subscriptionRevenue + walletCreditTotal;
      const isVerified = Boolean(creatorUser?.isVerified) || creator.payoutSettings?.kyc?.status === 'verified';

      return {
        id: index + 1,
        creatorDbId: String(creator._id),
        name: creator.name || creator.username || creatorUser?.name || 'Creator',
        email: creatorUser?.email || `${creator.username || 'creator'}@creator.com`,
        avatar: creator.avatar || null,
        status: creator.status === 'active' ? 'Active' : 'Inactive',
        verified: isVerified,
        revenue: totalRevenue,
        subscribers: formatCompact((creator.subscribers || []).length),
        content: postStats.count,
        date: formatDate(creator.createdAt),
        createdAt: creator.createdAt,
      };
    });

    const totalCreatorsCount = creatorRows.length;
    const activeCreatorsCount = creatorRows.filter((creator) => creator.status === 'Active').length;
    const verifiedCreatorsCount = creatorRows.filter((creator) => creator.verified).length;
    const totalRevenue = creatorRows.reduce((sum, creator) => sum + creator.revenue, 0);
    const avgRevenuePerCreator = totalCreatorsCount > 0 ? Math.round(totalRevenue / totalCreatorsCount) : 0;
    const retentionRate = totalCreatorsCount > 0 ? clampPercent((activeCreatorsCount / totalCreatorsCount) * 100) : 0;
    const topRevenueCreators = [...creatorRows].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    const totalCreatorsChartData = toSeries(MONTHS);
    const activeCreatorsChartData = toSeries(MONTHS);
    const revenueByMonth = toSeries(MONTHS);
    const verifiedUsersByMonth = toSeries(MONTHS_UPPER).map((item) => ({ ...item, users: 0, creators: 0 }));

    creators.forEach((creator) => {
      const month = byMonthName(creator.createdAt);
      if (!month) return;

      const totalPoint = totalCreatorsChartData.find((point) => point.name === month);
      if (totalPoint) totalPoint.val += 1;

      if (creator.status === 'active') {
        const activePoint = activeCreatorsChartData.find((point) => point.name === month);
        if (activePoint) activePoint.val += 1;
      }

      const creatorUser = userById.get(String(creator.userId));
      const monthUpper = month.toUpperCase();
      const verifiedPoint = verifiedUsersByMonth.find((point) => point.name === monthUpper);
      if (verifiedPoint) {
        verifiedPoint.users += 1;
        if (creatorUser?.isVerified || creator.payoutSettings?.kyc?.status === 'verified') {
          verifiedPoint.creators += 1;
        }
      }
    });

    posts.forEach((post) => {
      const month = byMonthName(post.createdAt);
      if (!month) return;
      const revenuePoint = revenueByMonth.find((point) => point.name === month);
      if (revenuePoint) {
        revenuePoint.val += Number(post.revenue?.total) || 0;
      }
    });

    const normalizedTotalCreators = normalizeSeries(totalCreatorsChartData);
    const normalizedActiveCreators = normalizeSeries(activeCreatorsChartData);
    const normalizedTopRevenue = normalizeSeries(revenueByMonth);

    const retentionRateChartData = normalizedActiveCreators.map((point, index) => ({
      name: point.name,
      val: clampPercent(Math.min(100, point.val + (index % 3 === 0 ? 5 : 0))),
    }));

    const analyticsActiveCreatorsData = normalizedTotalCreators.map((point, index) => ({
      name: point.name,
      val: clampPercent(Math.max(0, point.val - (index % 4 === 0 ? 6 : 2))),
    }));

    const creatorGrowthData = normalizedTotalCreators.map((point, index) => {
      const month = MONTHS[index];
      const monthPosts = posts.filter((post) => byMonthName(post.createdAt) === month);
      const free = monthPosts.filter((post) => !(post.isExclusive === true || post.accessTier === 'members_only' || post.accessTier === 'exclusive_paid')).length;
      const paid = monthPosts.length - free;
      const maxMix = Math.max(1, monthPosts.length);
      return {
        name: point.name,
        free: clampPercent((free / maxMix) * 100),
        paid: clampPercent((paid / maxMix) * 100),
      };
    });

    const totalLikes = posts.reduce((sum, post) => sum + (Number(post.likes) || 0), 0);
    const totalComments = posts.reduce((sum, post) => sum + (Number(post.comments) || 0), 0);
    const totalViews = posts.reduce((sum, post) => sum + (Number(post.views) || 0), 0);
    const totalPosts = posts.length || 1;

    const engagement = {
      avgLikesPerPost: Math.round(totalLikes / totalPosts),
      avgComments: Math.round(totalComments / totalPosts),
      engagementRate: totalViews > 0 ? Number((((totalLikes + totalComments) / totalViews) * 100).toFixed(2)) : 0,
    };

    res.status(200).json({
      stats: {
        totalCreators: totalCreatorsCount,
        activeCreators: activeCreatorsCount,
        verifiedCreators: verifiedCreatorsCount,
        topRevenueCreators: topRevenueCreators.reduce((sum, creator) => sum + creator.revenue, 0),
        totalRevenue,
        avgRevenuePerCreator,
        retentionRate,
      },
      charts: {
        totalCreatorsChartData: normalizedTotalCreators,
        activeCreatorsChartData: normalizedActiveCreators,
        verifiedCreatorsChartData: verifiedUsersByMonth,
        topRevenueChartData: normalizedTopRevenue,
        retentionRateChartData,
        analyticsActiveCreatorsData,
        creatorGrowthData,
      },
      creatorsTableData: creatorRows,
      engagement,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getRevenueAnalyticsData = async (req, res) => {
  try {
    const [wallets, creators, settings] = await Promise.all([
      Wallet.find().populate('userId', 'name').lean(),
      Creator.find().sort({ 'earnings.total': -1 }).lean(),
      AppSetting.findOne().lean(),
    ]);

    const totalRevenueDataRaw = toSeries(MONTHS);
    const platformCommissionDataRaw = toSeries(MONTHS);
    const refundAmountDataRaw = toSeries(MONTHS);
    const pendingPayoutsDataRaw = toSeries(MONTHS);

    const flatTransactions = [];
    wallets.forEach((wallet) => {
      (wallet.transactions || []).forEach((transaction, txIndex) => {
        const month = byMonthName(transaction.createdAt);
        if (!month) return;

        const amount = Number(transaction.amount) || 0;
        const isCredit = transaction.type === 'credit';
        const isSuccess = transaction.status === 'success';
        const isPending = transaction.status === 'pending';
        const isFailed = transaction.status === 'failed';

        if (isCredit && isSuccess) {
          const revenuePoint = totalRevenueDataRaw.find((point) => point.name === month);
          if (revenuePoint) revenuePoint.val += amount;

          const commissionRate = Number(settings?.commission) || 10;
          const commissionPoint = platformCommissionDataRaw.find((point) => point.name === month);
          if (commissionPoint) commissionPoint.val += (amount * commissionRate) / 100;
        }

        if (isFailed) {
          const refundPoint = refundAmountDataRaw.find((point) => point.name === month);
          if (refundPoint) refundPoint.val += amount;
        }

        if (isPending) {
          const pendingPoint = pendingPayoutsDataRaw.find((point) => point.name === month);
          if (pendingPoint) pendingPoint.val += amount;
        }

        flatTransactions.push({
          id: `${String(wallet._id)}-${txIndex}`,
          transactionId: transaction.referenceId || `TXN-${String(wallet._id).slice(-4)}${txIndex + 1}`,
          user: { name: wallet.userId?.name || 'User' },
          amount,
          type: isCredit ? 'Subscription' : 'Tip',
          status: isPending ? 'Pending' : 'Completed',
          date: formatDate(transaction.createdAt),
          createdAt: transaction.createdAt,
        });
      });
    });

    flatTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const revenueTransactionsData = flatTransactions.slice(0, 10).map((transaction, index) => ({
      id: transaction.id,
      transactionId: transaction.transactionId,
      user: transaction.user,
      creator: { name: creators[index % Math.max(creators.length, 1)]?.name || 'Creator' },
      amount: transaction.amount,
      type: transaction.type,
      status: transaction.status,
      date: transaction.date,
    }));

    const recentActivityFeed = flatTransactions.slice(0, 3).map((transaction) => ({
      text: `${formatCurrency(transaction.amount)} ${transaction.type.toLowerCase()} ${transaction.status.toLowerCase()}`,
      time: transaction.date,
      dotColor: transaction.status === 'Completed' ? '#10B981' : '#F59E0B',
    }));

    const totalRevenueAmount = flatTransactions
      .filter((transaction) => transaction.type === 'Subscription' && transaction.status === 'Completed')
      .reduce((sum, transaction) => sum + transaction.amount, 0);

    const commissionRate = Number(settings?.commission) || 10;
    const platformCommissionAmount = Math.round((totalRevenueAmount * commissionRate) / 100);
    const refundAmount = flatTransactions
      .filter((transaction) => transaction.status !== 'Completed')
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const pendingPayoutsAmount = flatTransactions
      .filter((transaction) => transaction.status === 'Pending')
      .reduce((sum, transaction) => sum + transaction.amount, 0);

    const monthlyTotal = totalRevenueDataRaw.map((point) => point.val);
    const currentMonthValue = monthlyTotal[monthlyTotal.length - 1] || 0;
    const previousMonthValue = monthlyTotal[monthlyTotal.length - 2] || 0;
    const monthlyGrowth = previousMonthValue > 0
      ? (((currentMonthValue - previousMonthValue) / previousMonthValue) * 100)
      : 0;

    res.status(200).json({
      totals: {
        totalRevenue: totalRevenueAmount,
        platformCommission: platformCommissionAmount,
        refundAmount,
        pendingPayouts: pendingPayoutsAmount,
        monthlyGrowth: Number(monthlyGrowth.toFixed(2)),
      },
      totalRevenueData: normalizeSeries(totalRevenueDataRaw),
      platformCommissionData: normalizeSeries(platformCommissionDataRaw),
      refundAmountData: normalizeSeries(refundAmountDataRaw),
      pendingPayoutsData: normalizeSeries(pendingPayoutsDataRaw),
      revenueTransactionsData,
      recentActivityFeed,
      insight: {
        message: monthlyGrowth >= 0
          ? `Revenue improved by ${monthlyGrowth.toFixed(1)}% compared to last month.`
          : `Revenue is down by ${Math.abs(monthlyGrowth).toFixed(1)}% compared to last month.`,
        currentProjection: totalRevenueAmount * 12,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getDashboardData = async (req, res) => {
  try {
    const [allUsers, allCreators, allWallets, allPosts] = await Promise.all([
        User.find().sort({ createdAt: -1 }),
        Creator.find().sort({ 'earnings.total': -1 }),
      Wallet.find().populate('userId', 'name avatar'),
      Post.find().select('creatorId revenue').lean(),
    ]);
    
    // Aggregating Totals
    const totalUsersCount = allUsers.length;
    const activeCreatorsCount = allCreators.filter(c => c.status === 'active').length;
    
    let totalRevenue = 0;
    let pendingPayouts = 0;
    let allTransactions = [];

    // Extract transactions from wallets
    allWallets.forEach(wallet => {
      if (wallet.transactions && wallet.transactions.length > 0) {
        wallet.transactions.forEach(t => {
           allTransactions.push({ ...t.toObject(), user: wallet.userId });
           if (t.type === 'credit' && t.status === 'success') {
              totalRevenue += t.amount;
           }
           if (t.status === 'pending') {
              pendingPayouts += t.amount;
           }
        });
      }
    });

    const formatCurrency = (num) => new Intl.NumberFormat('en-IN').format(num);

    // Mini Stats
    const flaggedContentCount = 0; // Replace with Moderation/Report model when it exists
    const verificationRequestsCount = allUsers.filter(u => u.role === 'creator' && !u.isVerified).length;

    // Aggregating Charts
    const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const usersGrowthData = monthOrder.map(m => ({ name: m, val: 0 }));
    const creatorsGrowthData = monthOrder.map(m => ({ name: m, val: 0 }));
    const revenueOverTime = monthOrder.map(m => ({ name: m, val: 0 }));
    const revenueWeekly = [
      { name: 'Wk1', val: 0 }, { name: 'Wk2', val: 0 }, { name: 'Wk3', val: 0 }, { name: 'Wk4', val: 0 }
    ];

    allUsers.forEach(u => {
      const month = new Date(u.createdAt).toLocaleString('default', { month: 'short' });
      const mData = usersGrowthData.find(d => d.name === month);
      if (mData) {
        mData.val += 1;
        if (u.role === 'creator') {
          const cData = creatorsGrowthData.find(d => d.name === month);
          if (cData) cData.val += 1;
        }
      }
    });

    // Time-based sorting for transactions natively
    allTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    allTransactions.forEach((t, i) => {
      if (t.type === 'credit' && t.status === 'success') {
        const month = new Date(t.createdAt).toLocaleString('default', { month: 'short' });
        const rData = revenueOverTime.find(d => d.name === month);
        if (rData) rData.val += t.amount;
        
        // Randomly scatter revenue into weekly array based on modulo for logic since we don't have exact week metrics natively plotted easily
        revenueWeekly[i % 4].val += t.amount;
      }
    });

    const walletCreditsByUserId = new Map();
    allWallets.forEach((wallet) => {
      const userId = wallet?.userId?._id ? String(wallet.userId._id) : String(wallet.userId);
      const credits = (wallet.transactions || []).reduce((sum, tx) => {
        if (tx.type === 'credit' && tx.status === 'success') {
          return sum + (Number(tx.amount) || 0);
        }
        return sum;
      }, 0);
      walletCreditsByUserId.set(userId, credits);
    });

    const postRevenueByCreatorId = new Map();
    allPosts.forEach((post) => {
      const creatorId = String(post.creatorId);
      const value = Number(post.revenue?.total) || 0;
      postRevenueByCreatorId.set(creatorId, (postRevenueByCreatorId.get(creatorId) || 0) + value);
    });

    const getCreatorRevenue = (creator) => {
      const postRevenue = postRevenueByCreatorId.get(String(creator?._id)) || 0;
      const subscriptionRevenue = (creator?.subscribers?.length || 0) * (Number(creator?.subscriptionPrice) || 0);
      const walletCreditTotal = walletCreditsByUserId.get(String(creator?.userId)) || 0;
      return postRevenue + subscriptionRevenue + walletCreditTotal;
    };

    const colors = ['#6366F1', '#F97316', '#1F2937', '#10B981', '#EAB308'];
    const rankedCreators = [...allCreators]
      .sort((a, b) => getCreatorRevenue(b) - getCreatorRevenue(a))
      .slice(0, 3);

    const topCreators = rankedCreators.map((c, index) => ({
        initials: c.name ? c.name.substring(0, 2).toUpperCase() : 'CR',
        name: c.name || c.username,
        role: c.category || 'Creator',
        earnings: formatCreatorEarnings(getCreatorRevenue(c)),
        rank: index + 1,
        color: colors[index % colors.length]
    }));

    // Dynamic Recent Activities based on real wallet transactions and real new users
    const recentActivities = [];
    allTransactions.slice(0, 3).forEach((t, index) => {
       const actionText = t.type === 'credit' ? `Received ₹${t.amount}` : `Withdrew ₹${t.amount}`;
       recentActivities.push({
           dot: t.status === 'success' ? '#10B981' : (t.status === 'pending' ? '#F97316' : '#DC2626'),
           text: `${t.user?.name || 'User'} - ${actionText}`,
           time: new Date(t.createdAt).toLocaleDateString()
       });
    });

    if (recentActivities.length === 0 && allUsers.length > 0) {
      allUsers.slice(0, 3).forEach(u => {
        recentActivities.push({ 
           dot: '#10B981', 
           text: `${u.name} registered as a ${u.role}`, 
           time: new Date(u.createdAt).toLocaleDateString() 
        });
      });
    }

    const dashboard = {
      users: { count: totalUsersCount.toLocaleString('en-US'), growth: '+2%', data: usersGrowthData.slice(0, 5) },
      creators: { count: activeCreatorsCount.toLocaleString('en-US'), growth: '+5%', data: creatorsGrowthData.slice(0, 5) },
      revenue: { count: `₹${formatCurrency(totalRevenue)}`, growth: '+8%', data: revenueOverTime.slice(0, 5) },
      subscriptions: { count: pendingPayouts.toLocaleString('en-US'), growth: '-1%', data: revenueOverTime.slice(0, 5) },
      revenueOverTime: revenueOverTime,
      revenueWeekly,
      topCreators,
      recentActivities,
      miniStats: { flaggedContentCount, verificationRequestsCount },
      systemAlert: null
    };

    res.status(200).json(dashboard);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- Legacy Endpoints for Other Admin Panels ---
const {
  DEFAULT_SESSION_TIMEOUT,
  DEFAULT_MIN_PASSWORD_LENGTH,
  normalizeSessionTimeout,
  normalizeMinPasswordLength,
  getRuntimeSecuritySettings,
} = require('../utils/securitySettings');
const { invalidateDisposableEmailCache } = require('../utils/disposableEmail');

const normalizeBlockedEmailDomains = (value) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const normalized = source
    .map((domain) => String(domain || '').trim().toLowerCase())
    .filter(Boolean);

  return [...new Set(normalized)];
};

exports.getAllData = async (req, res) => {
  try {
    const users = await AppUser.find();
    const reports = await AppReport.find();
    const transactions = await AppTransaction.find();
    const tickets = await AppTicket.find();
    const settings = await AppSetting.findOne();
    const dashboard = await AppDashboard.findOne();
    res.status(200).json({ users, reports, transactions, tickets, settings, dashboard });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, status, password } = req.body;
    const user = await AppUser.findByIdAndUpdate(id, { name, email, role, status, password }, { new: true });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    await AppUser.findByIdAndDelete(id);
    res.status(200).json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = await AppSetting.findOneAndUpdate({}, req.body, { new: true });

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'blockedEmailDomains')) {
      invalidateDisposableEmailCache();
    }

    res.status(200).json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSettings = async (req, res) => {
  try {
    let settings = await AppSetting.findOne();
    if (!settings) {
      settings = AppSetting.buildDefault();
      await settings.save();
    }

    const normalizedSessionTimeout = normalizeSessionTimeout(settings.sessionTimeout);
    const normalizedMinPasswordLength = normalizeMinPasswordLength(settings.minPasswordLength);
    const normalizedBlockedEmailDomains = normalizeBlockedEmailDomains(settings.blockedEmailDomains);
    let shouldPersistNormalization = false;

    if (settings.sessionTimeout !== normalizedSessionTimeout) {
      settings.sessionTimeout = normalizedSessionTimeout;
      shouldPersistNormalization = true;
    }

    if (settings.minPasswordLength !== normalizedMinPasswordLength) {
      settings.minPasswordLength = normalizedMinPasswordLength;
      shouldPersistNormalization = true;
    }

    const existingDomains = Array.isArray(settings.blockedEmailDomains)
      ? settings.blockedEmailDomains
      : [];
    if (JSON.stringify(existingDomains) !== JSON.stringify(normalizedBlockedEmailDomains)) {
      settings.blockedEmailDomains = normalizedBlockedEmailDomains;
      shouldPersistNormalization = true;
    }

    if (shouldPersistNormalization) {
      await settings.save();
      invalidateDisposableEmailCache();
    }

    res.status(200).json(settings.toObject());
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.saveSettings = async (req, res) => {
  try {
    const allowed = [
      'platformName', 'platformUrl', 'defaultLanguage', 'timezone',
      'termsOfService', 'privacyPolicy',
      'commission', 'minPayout', 'currency', 'transactionFee',
      'razorpayConnected', 'stripeConnected',
      'twoFactorEnabled', 'botProtectionEnabled', 'sessionTimeout', 'minPasswordLength',
      'blockedEmailDomains',
    ];

    const update = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    });

    if (Object.prototype.hasOwnProperty.call(update, 'sessionTimeout')) {
      update.sessionTimeout = normalizeSessionTimeout(update.sessionTimeout);
    }

    if (Object.prototype.hasOwnProperty.call(update, 'minPasswordLength')) {
      update.minPasswordLength = normalizeMinPasswordLength(update.minPasswordLength);
    }

    if (Object.prototype.hasOwnProperty.call(update, 'blockedEmailDomains')) {
      update.blockedEmailDomains = normalizeBlockedEmailDomains(update.blockedEmailDomains);
    }

    const settings = await AppSetting.findOneAndUpdate(
      {},
      { $set: update },
      { new: true, upsert: true }
    );

    if (Object.prototype.hasOwnProperty.call(update, 'blockedEmailDomains')) {
      invalidateDisposableEmailCache();
    }

    res.status(200).json(settings.toObject());
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.resetSettings = async (req, res) => {
  try {
    const defaults = {
      platformName: 'Nexus Enterprise',
      platformUrl: 'https://admin.nexus-ent.com',
      defaultLanguage: 'English (US)',
      timezone: '(GMT+05:30) India Standard Time',
      termsOfService: '## Platform Usage Rules\n1. Users must be 18+...\n2. All content must comply with global standards...',
      privacyPolicy: '## Data Privacy\nWe value your data security. This document outlines how we process information...',
      commission: 10,
      transactionFee: 2,
      minPayout: 1000,
      currency: 'INR',
      razorpayConnected: false,
      stripeConnected: false,
      twoFactorEnabled: true,
      botProtectionEnabled: false,
      sessionTimeout: DEFAULT_SESSION_TIMEOUT,
      minPasswordLength: DEFAULT_MIN_PASSWORD_LENGTH,
      blockedEmailDomains: [],
    };

    const settings = await AppSetting.findOneAndUpdate(
      {},
      { $set: defaults },
      { new: true, upsert: true }
    );

    invalidateDisposableEmailCache();

    res.status(200).json(settings.toObject());
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getAdminSessions = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('sessions');
    if (!user) {
      return res.status(404).json({ message: 'Admin user not found' });
    }

    const { sessionTimeoutMs } = await getRuntimeSecuritySettings();
    const now = Date.now();
    const sessionsBeforeCleanup = user.sessions || [];
    const activeSessions = sessionsBeforeCleanup.filter((session) => {
      // Keep legacy sessions without lastSeenAt; they are upgraded by auth middleware.
      if (!session.lastSeenAt) {
        return true;
      }

      const lastSeenMs = new Date(session.lastSeenAt).getTime();
      const createdAtMs = session.createdAt ? new Date(session.createdAt).getTime() : Number.NaN;
      const activityMs = Number.isFinite(lastSeenMs) ? lastSeenMs : createdAtMs;

      if (!Number.isFinite(activityMs)) {
        return true;
      }

      return now - activityMs <= sessionTimeoutMs;
    });

    if (activeSessions.length !== sessionsBeforeCleanup.length) {
      user.sessions = activeSessions;
      await user.save({ validateBeforeSave: false });
    }

    const sessions = [...activeSessions]
      .sort((a, b) => {
        const aMs = new Date(a.lastSeenAt || a.createdAt || 0).getTime();
        const bMs = new Date(b.lastSeenAt || b.createdAt || 0).getTime();
        return bMs - aMs;
      })
      .map((session) => ({
        sessionId: session.sessionId,
        browser: session.browser || 'Unknown Browser',
        os: session.os || 'Unknown OS',
        ipAddress: session.ipAddress || 'Unknown',
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        isCurrent: session.sessionId === req.sessionId,
      }));

    res.status(200).json({ sessions });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.revokeAdminSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ message: 'Invalid sessionId format' });
    }

    if (timingSafeStringEqual(sessionId, req.sessionId)) {
      return res.status(400).json({ message: 'Current session cannot be revoked from this action' });
    }

    const user = await User.findById(req.user._id).select('sessions');
    if (!user) {
      return res.status(404).json({ message: 'Admin user not found' });
    }

    const exists = (user.sessions || []).some((session) => timingSafeStringEqual(session.sessionId, sessionId));
    if (!exists) {
      return res.status(404).json({ message: 'Session not found' });
    }

    user.sessions = (user.sessions || []).filter((session) => !timingSafeStringEqual(session.sessionId, sessionId));
    await user.save({ validateBeforeSave: false });

    res.status(200).json({ message: 'Session revoked successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.revokeAllOtherAdminSessions = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('sessions');
    if (!user) {
      return res.status(404).json({ message: 'Admin user not found' });
    }

    const beforeCount = (user.sessions || []).length;
    user.sessions = (user.sessions || []).filter((session) => timingSafeStringEqual(session.sessionId, req.sessionId));
    const removedCount = beforeCount - user.sessions.length;

    await user.save({ validateBeforeSave: false });

    res.status(200).json({ message: 'Logged out all other sessions', removedCount });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getUserDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await AppUser.findById(id);
    const activities = [
        { id: 1, type: 'subscription', action: 'Subscribed to creator @marcus_dev', desc: 'Plan: Annual Pro Membership ($199.00/yr)', time: '2 hours ago' },
        { id: 2, type: 'comment', action: 'Posted a comment on "Modern UI Trends 2024"', desc: '“This is exactly the type of minimalist approach...”', time: 'Yesterday, 14:20' },
        { id: 3, type: 'login', action: 'Account login from New Device', desc: 'Chrome / MacOS (192.168.1.1) • Mumbai, India', time: 'Jan 22, 2024' },
        { id: 4, type: 'like', action: 'Liked a post by @design_studio', desc: '', time: 'Jan 21, 2024' },
        { id: 5, type: 'purchase', action: 'Purchased digital asset "Icon Pack Vol. 2"', desc: 'Transaction ID: #TR-990812', time: 'Jan 18, 2024' },
    ];
    res.status(200).json({ user, activities });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// --- Platform Settings Endpoints ---

exports.getPlatformSettings = async (req, res) => {
  try {
    let settings = await AppSetting.findOne();
    let needsSave = false;

    if (!settings) {
      settings = AppSetting.buildDefault();
      needsSave = true;
    }

    // Convert to a plain object before checking keys to avoid subdocument key edge cases
    const togglesObj = settings.toObject().toggles || {};

    // Default toggles if missing
    if (Object.keys(togglesObj).length === 0) {
      settings.toggles = {
        livestreaming: true,
        messaging: true,
        tips: true,
        contentLock: false,
        community: true
      };
      settings.markModified('toggles');
      needsSave = true;
    }

    // Default plans if missing or empty
    if (!settings.subscriptionPlans || settings.subscriptionPlans.length === 0) {
      settings.subscriptionPlans = [
        {
          id: 'plan_basic',
          tierName: 'BASIC ACCESS',
          planName: 'Free',
          price: 0,
          frequency: '/forever',
          features: ['Standard Marketplace Listing', '15% Platform Fee', 'Basic Support'],
          isRecommended: false,
        },
        {
          id: 'plan_pro',
          tierName: 'MOST POPULAR',
          planName: 'Pro',
          price: 499,
          frequency: '/month',
          features: ['Priority Search Results', '8% Platform Fee', 'Advanced Analytics'],
          isRecommended: true,
        },
        {
          id: 'plan_enterprise',
          tierName: 'ENTERPRISE SCALE',
          planName: 'Premium',
          price: 'Custom',
          frequency: '',
          features: ['White-label Storefront', '5% Platform Fee', 'Dedicated Manager'],
          isRecommended: false,
        }
      ];
      needsSave = true;
    }

    // Save only when defaults are initialized; avoid overwriting on regular GET calls
    if (needsSave) {
      await settings.save();
    }

    const settingsObj = settings.toObject();
    res.status(200).json({ toggles: settingsObj.toggles, subscriptionPlans: settingsObj.subscriptionPlans });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updatePlatformToggle = async (req, res) => {
  try {
    const { featureId, isEnabled } = req.body;
    let settings = await AppSetting.findOne();
    if (!settings) settings = AppSetting.buildDefault();

    // Map frontend feature IDs to schema properties
    const map = {
      'feat_livestreaming': 'livestreaming',
      'feat_messaging': 'messaging',
      'feat_tips': 'tips',
      'feat_content_lock': 'contentLock',
      'feat_community': 'community'
    };

    const propName = map[featureId];
    if (!propName) {
      return res.status(400).json({ message: 'Invalid featureId' });
    }

    const normalizedEnabled = isEnabled === true || isEnabled === 'true';
    settings.set(`toggles.${propName}`, normalizedEnabled);
    await settings.save();

    res.status(200).json(settings.toObject().toggles);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateSubscriptionPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    let settings = await AppSetting.findOne();
    if (!settings) settings = AppSetting.buildDefault();
    
    const planIndex = settings.subscriptionPlans.findIndex(p => p.id === id);
    if (planIndex !== -1) {
      settings.subscriptionPlans[planIndex] = { ...settings.subscriptionPlans[planIndex].toObject(), ...updates };
      settings.markModified('subscriptionPlans');
      await settings.save();
      res.status(200).json(settings.subscriptionPlans[planIndex]);
    } else {
      res.status(404).json({ message: 'Plan not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
