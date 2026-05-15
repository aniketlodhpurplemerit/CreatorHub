const { isValidObjectId } = require('../utils/objectId');
const multer = require('multer');
const streamifier = require('streamifier');
const cloudinary = require('../utils/cloudinary');
const Post = require('../models/Post');
const Creator = require('../models/Creator');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Livestream = require('../models/Livestream');
const Message = require('../models/Message');
const Block = require('../models/Block');
const Review = require('../models/Review');
const { AppSetting } = require('../models/AdminData');

const DEFAULT_TOGGLES = {
  livestreaming: true,
  messaging: true,
  tips: true,
  contentLock: false,
  community: true
};

const isFeatureEnabled = async (featureName) => {
  const settings = await AppSetting.findOne().lean();

  const toggles = {
    ...DEFAULT_TOGGLES,
    ...(settings?.toggles || {})
  };

  const value = toggles[featureName];
  return !(value === false || value === 'false');
};

// --- Dashboard ---
const getDashboardData = async (req, res) => {
  try {
    let creator = await Creator.findOne({ userId: req.user._id.toString() });
    if (!creator) {
      creator = await Creator.create({ 
          userId: req.user._id.toString(), 
          name: req.user.name, 
          username: req.user.name.toLowerCase().replace(' ', '') 
      });
    }

    const posts = await Post.find({ creatorId: creator._id });
    const activeSubscribers = creator.subscribers ? creator.subscribers.length : 0;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const calculatedPostTotal = posts.reduce((sum, post) => sum + (Number(post.revenue?.total) || 0), 0);
    const calculatedPostThisMonth = posts.reduce((sum, post) => {
      if (post.createdAt && new Date(post.createdAt) >= monthStart) {
        return sum + (Number(post.revenue?.total) || 0);
      }
      return sum;
    }, 0);

    const subscriptionRevenue = activeSubscribers * (Number(creator.subscriptionPrice) || 0);
    const totalEarned = calculatedPostTotal + subscriptionRevenue;
    const thisMonth = calculatedPostThisMonth;

    // Per-post performance/revenue table
    const postRevenueBreakdown = posts.map(p => ({
      id: p._id,
      title: p.title,
      type: p.mediaType,
      date: p.createdAt,
      revenueSubscription: Number(p.revenue?.breakdown?.subscriptionPay) || 0,
      revenueExclusive: Number(p.revenue?.breakdown?.directPurchase) || 0,
      total: Number(p.revenue?.total) || 0,
      views: p.views || 0,
      uniqueViews: p.uniqueViewers ? p.uniqueViewers.length : 0,
      likes: p.likes || 0,
      comments: p.comments || 0,
      thumbnailUrl: p.thumbnailUrl || (p.mediaType === 'image' ? p.mediaUrl : ''),
      mediaUrl: p.mediaUrl,
      policyViolationLocked: !!p.policyViolationLocked,
      policyViolationLabel: p.policyViolationLabel || ''
    })).sort((a,b) => b.date - a.date).slice(0, 10);

    // Month breakdown (real-ish, normally you'd use aggregation)
    const revenueHistory = [
      { name: 'Total', subscription: posts.reduce((sum, p) => sum + (p.revenue?.breakdown?.subscriptionPay || 0), 0), exclusive: posts.reduce((sum, p) => sum + (p.revenue?.breakdown?.directPurchase || 0), 0) },
    ];

    // Compute dynamic rating
    const ratingAgg = await Review.aggregate([
      { $match: { creator: creator._id } },
      { $group: { _id: null, avg: { $avg: '$rating' } } }
    ]);
    const averageRating = ratingAgg.length > 0
      ? Math.round(ratingAgg[0].avg * 10) / 10
      : null;

    res.json({
      creator,
      stats: {
        totalEarned,
        thisMonth,
        activeSubscribers,
        postCount: posts.length,
        averageRating
      },
      postRevenueBreakdown,
      revenueHistory
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const profileUpload = multer({ storage: multer.memoryStorage() }).fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'banner', maxCount: 1 }
]);

const updateCreatorProfile = async (req, res) => {
  profileUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    try {
      let creator = await Creator.findOne({ userId: req.user._id.toString() });
      if (!creator) return res.status(404).json({ error: 'Creator not found' });

      const { name, username, bio, category, instagram, facebook, twitter, tiktok } = req.body;
      
      if (name) creator.name = name;
      if (username) creator.username = username.toLowerCase().replace(' ', '');
      if (bio !== undefined) creator.bio = bio;
      if (category) creator.category = category;
      
      if (creator.socialLinks) {
        if (instagram !== undefined) creator.socialLinks.instagram = instagram;
        if (facebook !== undefined) creator.socialLinks.facebook = facebook;
        if (twitter !== undefined) creator.socialLinks.twitter = twitter;
        if (tiktok !== undefined) creator.socialLinks.tiktok = tiktok;
      }

      const handleUpload = async (file, folder) => {
        return new Promise((resolve, reject) => {
          let stream = cloudinary.uploader.upload_stream(
            { resource_type: 'auto', folder },
            (error, result) => {
              if (result) resolve(result.secure_url);
              else reject(error);
            }
          );
          streamifier.createReadStream(file.buffer).pipe(stream);
        });
      };

      if (req.files) {
        if (req.files.avatar && req.files.avatar[0]) {
           creator.avatar = await handleUpload(req.files.avatar[0], 'logoipsum_avatars');
        }
        if (req.files.banner && req.files.banner[0]) {
           creator.banner = await handleUpload(req.files.banner[0], 'logoipsum_banners');
        }
      }

      if (req.body.avatar) creator.avatar = req.body.avatar;
      if (req.body.banner) creator.banner = req.body.banner;

      await creator.save();

      // Keep users row in sync so login / GET /auth/profile show the same avatar & bio as the creator profile.
      const userSync = {};
      if (name) userSync.name = name;
      if (creator.avatar) userSync.avatar = creator.avatar;
      if (bio !== undefined) userSync.bio = bio;
      if (Object.keys(userSync).length) {
        await User.findByIdAndUpdate(req.user._id, { $set: userSync });
      }

      res.json(creator);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};

// --- Engagement Analytics ---
const getAnalytics = async (req, res) => {
  try {
    const { timeRange } = req.query; // e.g. '7d', '30d', 'all'
    const creator = await Creator.findOne({ userId: req.user._id.toString() });
    if (!creator) return res.status(404).json({ error: 'Creator profile not found' });

    // In a real app, you'd filter posts by createdAt based on timeRange
    const posts = await Post.find({ creatorId: creator._id }).sort({ createdAt: 1 });

    const engagementChart = posts.map(p => ({
      name: p.title.length > 10 ? p.title.substring(0, 7) + '...' : p.title,
      views: p.views || 0,
      likes: p.likes || 0,
      comments: p.comments || 0,
      date: p.createdAt
    }));

    res.json({ engagementChart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Posts ---
const upload = multer({ storage: multer.memoryStorage() }).fields([
  { name: 'file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]);

const uploadSingle = multer({ storage: multer.memoryStorage() }).single('media');

const uploadMessageMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const isVideo = req.file.mimetype.startsWith('video/');
    const isImage = req.file.mimetype.startsWith('image/');

    if (!isVideo && !isImage) {
      return res.status(400).json({ error: 'Only image and video files are supported' });
    }

    // 10MB limit for images, 50MB for videos
    const maxSize = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (req.file.size > maxSize) {
      return res.status(400).json({
        error: `File too large. Max size: ${isVideo ? '50MB' : '10MB'}`
      });
    }

    const streamUpload = () => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: isVideo ? 'video' : 'image',
            folder: 'logoipsum_messages'
          },
          (error, result) => {
            if (result) resolve(result);
            else reject(error);
          }
        );
        streamifier.createReadStream(req.file.buffer).pipe(stream);
      });
    };

    const result = await streamUpload();

    res.json({
      mediaUrl: result.secure_url,
      mediaType: isVideo ? 'video' : 'image',
      thumbnailUrl: isVideo
        ? result.secure_url.replace('/upload/', '/upload/so_0/').replace(/\.[^/.]+$/, '.jpg')
        : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const uploadMessageMediaHandler = (req, res) => {
  uploadSingle(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    uploadMessageMedia(req, res);
  });
};

const createPost = async (req, res) => {
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    try {
      let creator = await Creator.findOne({ userId: req.user._id.toString() });
      if (!creator) creator = await Creator.create({ 
          userId: req.user._id.toString(), 
          name: req.user.name, 
          username: req.user.name.toLowerCase().replace(' ', '') 
      });

      let mediaUrl = '';
      let thumbnailUrl = '';

      const processUpload = async (file, folder) => {
        return new Promise((resolve, reject) => {
          let stream = cloudinary.uploader.upload_stream(
            { resource_type: 'auto', folder },
            (error, result) => {
              if (result) resolve(result);
              else reject(error);
            }
          );
          streamifier.createReadStream(file.buffer).pipe(stream);
        });
      };

      if (req.files && req.files.file) {
        const result = await processUpload(req.files.file[0], 'logoipsum_creator');
        mediaUrl = result.secure_url;
      } else if (req.body.mediaUrl) {
        mediaUrl = req.body.mediaUrl;
      }

      if (req.files && req.files.thumbnail) {
        const result = await processUpload(req.files.thumbnail[0], 'logoipsum_thumbnails');
        thumbnailUrl = result.secure_url;
      } else if (req.body.thumbnailUrl) {
        thumbnailUrl = req.body.thumbnailUrl;
      }

      const { title, description, mediaType, isExclusive, accessTier, status, category, price } = req.body;

      const normalizedAccessTier = ['everyone', 'members_only', 'exclusive_paid'].includes(accessTier)
        ? accessTier
        : (isExclusive === 'true' || isExclusive === true ? 'members_only' : 'everyone');

      if (normalizedAccessTier === 'exclusive_paid') {
        const contentLockEnabled = await isFeatureEnabled('contentLock');
        if (!contentLockEnabled) {
          return res.status(403).json({
            error: 'FeatureDisabled',
            message: 'Paid Content Lock is currently disabled by the administrator.'
          });
        }
      }

      const parsedPrice = parseFloat(price || 0);
      const resolvedPrice = normalizedAccessTier === 'exclusive_paid' ? Math.max(parsedPrice, 0) : 0;
      
      const realMediaType = mediaType || (req.files?.file?.[0]?.mimetype?.startsWith('video/') ? 'video' : 'image');

      // If video and no thumbnail provided, generate one from cloudinary url
      if (realMediaType === 'video' && !thumbnailUrl && mediaUrl.includes('cloudinary')) {
        thumbnailUrl = mediaUrl.replace(/\.[^/.]+$/, ".jpg");
      }

      const newPost = await Post.create({
        title: title || 'Untitled Post',
        description: description || '',
        mediaType: realMediaType,
        mediaUrl: mediaUrl || 'https://via.placeholder.com/600',
        thumbnailUrl: thumbnailUrl || (realMediaType === 'image' ? mediaUrl : 'https://via.placeholder.com/600'),
        isExclusive: normalizedAccessTier !== 'everyone',
        accessTier: normalizedAccessTier,
        status: status || 'published',
        category: category || 'content',
        price: resolvedPrice,
        creatorId: creator._id,
        views: 0,
        likes: 0,
        comments: 0
      });

      res.status(201).json(newPost);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};

const updatePost = async (req, res) => {
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    
    try {
        const { id } = req.params;
        let post = await Post.findById(id);
        if (!post) return res.status(404).json({ message: 'Post not found' });
        
        const creator = await Creator.findOne({ userId: req.user._id.toString() });
        if (!creator || post.creatorId.toString() !== creator._id.toString()) {
            return res.status(403).json({ message: 'Not authorized to edit this post' });
        }

        const updateData = { ...req.body };
        
        // Sanitize data
        if (updateData.isExclusive !== undefined) {
          updateData.isExclusive = updateData.isExclusive === 'true' || updateData.isExclusive === true;
        }
        if (updateData.accessTier !== undefined) {
          const allowedTiers = ['everyone', 'members_only', 'exclusive_paid'];
          if (!allowedTiers.includes(updateData.accessTier)) {
            delete updateData.accessTier;
          }
        }
        if (updateData.price !== undefined) {
          updateData.price = parseFloat(updateData.price || 0);
        }

        if (!updateData.accessTier && updateData.isExclusive !== undefined) {
          updateData.accessTier = updateData.isExclusive ? 'members_only' : 'everyone';
        }

        const requestedAccessTier = updateData.accessTier !== undefined
          ? updateData.accessTier
          : undefined;

        if (requestedAccessTier === 'exclusive_paid') {
          const contentLockEnabled = await isFeatureEnabled('contentLock');
          if (!contentLockEnabled) {
            return res.status(403).json({
              error: 'FeatureDisabled',
              message: 'Paid Content Lock is currently disabled by the administrator.'
            });
          }
        }

        if (updateData.accessTier === 'everyone' || updateData.accessTier === 'members_only') {
          updateData.price = 0;
        }

        if (updateData.accessTier !== undefined) {
          updateData.isExclusive = updateData.accessTier !== 'everyone';
        }

        const processUpload = async (file, folder) => {
            return new Promise((resolve, reject) => {
                let stream = cloudinary.uploader.upload_stream(
                    { resource_type: 'auto', folder },
                    (error, result) => {
                        if (result) resolve(result);
                        else reject(error);
                    }
                );
                streamifier.createReadStream(file.buffer).pipe(stream);
            });
        };

        if (req.files && req.files.file) {
            const result = await processUpload(req.files.file[0], 'logoipsum_creator');
            updateData.mediaUrl = result.secure_url;
            if (req.files.file[0].mimetype.startsWith('video/')) updateData.mediaType = 'video';
            else if (req.files.file[0].mimetype.startsWith('image/')) updateData.mediaType = 'image';
        }

        if (req.files && req.files.thumbnail) {
            const result = await processUpload(req.files.thumbnail[0], 'logoipsum_thumbnails');
            updateData.thumbnailUrl = result.secure_url;
        }

        // Auto-generate thumbnail for video if not provided/changed
        const currentMediaType = updateData.mediaType || post.mediaType;
        const currentMediaUrl = updateData.mediaUrl || post.mediaUrl;
        const currentThumbnailUrl = updateData.thumbnailUrl || post.thumbnailUrl;

        if (currentMediaType === 'video' && !currentThumbnailUrl && currentMediaUrl?.includes('cloudinary')) {
            updateData.thumbnailUrl = currentMediaUrl.replace(/\.[^/.]+$/, ".jpg");
        }

        const updatedPost = await Post.findByIdAndUpdate(id, updateData, { new: true });
        res.json(updatedPost);
    } catch (err) {
        console.error("Update post error:", err);
        res.status(500).json({ error: err.message });
    }
  });
};

const getPostById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
        return res.status(400).json({ message: 'Invalid Post ID' });
    }
    const post = await Post.findById(id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    
    // Ensure the post belongs to the authenticated creator
    const creator = await Creator.findOne({ userId: req.user._id.toString() });
    if (!creator || post.creatorId.toString() !== creator._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to view this post' });
    }
    
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getPosts = async (req, res) => {
  try {
    let creator = await Creator.findOne({ userId: req.user._id.toString() });
    if (!creator) return res.json([]);

    const posts = await Post.find({ creatorId: creator._id }).sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


const deletePost = async (req, res) => {
  try {
    const { id } = req.params;
    await Post.findByIdAndDelete(id);
    res.json({ message: 'Post removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Social Links ---
const updateSocialLinks = async (req, res) => {
  try {
    let creator = await Creator.findOne({ userId: req.user._id.toString() });
    if (!creator) creator = await Creator.create({ 
        userId: req.user._id.toString(), 
        name: req.user.name, 
        username: req.user.name.toLowerCase().replace(' ', '') 
    });

    const { platform, url, links } = req.body;
    
    // Bulk update
    if (links) {
        Object.keys(links).forEach(p => {
            if (creator.socialLinks.hasOwnProperty(p)) {
                creator.socialLinks[p] = links[p];
            }
        });
    } 
    // Single platform update
    else if (platform && url !== undefined) {
        if (creator.socialLinks.hasOwnProperty(platform)) {
            creator.socialLinks[platform] = url;
        }
    }

    await creator.save();
    res.json(creator.socialLinks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getSocialLinks = async (req, res) => {
  try {
    let creator = await Creator.findOne({ userId: req.user._id.toString() });
    res.json(creator ? creator.socialLinks : {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Subscribers ---
const getSubscribers = async (req, res) => {
    try {
        let creator = await Creator.findOne({ userId: req.user._id.toString() }).populate('subscribers', 'name email createdAt');
        if (!creator) return res.json([]);

        // Subscribers are now directly part of the Creator object
        res.json(creator.subscribers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const getInsightsData = async (req, res) => {
  try {
    let creator = await Creator.findOne({ userId: req.user._id.toString() }).populate('subscribers', 'name email avatar createdAt');
    if (!creator) return res.status(404).json({ error: 'Creator not found' });

    const posts = await Post.find({ creatorId: creator._id });
    
    // Aggregating real data
    const totalLikes = posts.reduce((sum, p) => sum + (p.likes || 0), 0);
    const totalViews = posts.reduce((sum, p) => sum + (p.views || 0), 0);
    const totalComments = posts.reduce((sum, p) => sum + (p.comments || 0), 0);

    const audienceStats = {
      totalUsers: creator.followers?.length || 0,
      activeUsers: creator.subscribers?.length || 0,
      profileVisitsRenown: Math.floor(totalViews * 0.4), // Simulated split
      profileVisitsDirect: Math.floor(totalViews * 0.6)
    };

    const salesStats = {
      totalSales: posts.reduce((sum, p) => sum + (p.revenue?.total || 0), 0),
      conversionRate: audienceStats.totalUsers > 0 ? ((audienceStats.activeUsers / audienceStats.totalUsers) * 100).toFixed(1) + '%' : '0%'
    };

    const membershipStats = {
      totalMemberships: 1, // Currently only one type or tier implied
      totalMembershipMembers: creator.subscribers?.length || 0,
      cancelledMembers: 0,
      conversionRate: audienceStats.totalUsers > 0 ? ((creator.subscribers.length / creator.followers.length) * 100).toFixed(1) + '%' : '0%'
    };

    // Revenue chart data from recent posts or earnings
    const revenueChart = posts.slice(0, 7).map(p => ({
      date: new Date(p.createdAt).toLocaleDateString(),
      title: p.title,
      free: 0, 
      membership: creator.subscribers.length, 
      revenue: p.revenue?.total || 0
    }));

    res.json({
      subscribers: creator.subscribers || [],
      audienceStats,
      salesStats,
      membershipStats,
      revenueChart,
      engagement: {
          totalLikes,
          totalViews,
          totalComments
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Notifications ---
const getNotifications = async (req, res) => {
    try {
    const notifications = await Notification.find({ recipient: req.user._id }).sort({ createdAt: -1 });

        res.json(notifications);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const markNotificationRead = async (req, res) => {
    try {
        const { id } = req.params;
    const updatedNotification = await Notification.findOneAndUpdate(
      { _id: id, recipient: req.user._id },
      { $set: { isRead: true } },
      { new: true }
    );

    if (!updatedNotification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

        res.json({ message: 'Marked as read' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const markAllCreatorNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { $set: { isRead: true } }
    );
    res.json({ message: 'All marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Payouts ---
const getPayoutSettings = async (req, res) => {
    try {
        let creator = await Creator.findOne({ userId: req.user._id.toString() });
        if (!creator) return res.status(404).json({ error: 'Creator profile not found' });
        res.json(creator.payoutSettings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const updatePayoutSettings = async (req, res) => {
    try {
        let creator = await Creator.findOne({ userId: req.user._id.toString() });
        if (!creator) return res.status(404).json({ error: 'Creator not found' });

        const { type, data } = req.body; // type: 'kyc', 'billing', 'bank'
        if (creator.payoutSettings[type]) {
            Object.assign(creator.payoutSettings[type], data);
            creator.payoutSettings[type].updatedAt = new Date();
            // If they provided details, set status to pending or verified for demo
            if (type === 'kyc') creator.payoutSettings[type].status = 'pending';
            else creator.payoutSettings[type].status = 'verified';
        }

        await creator.save();
        res.json(creator.payoutSettings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const getFeatureAvailability = async (req, res) => {
  try {
    const defaultToggles = {
      livestreaming: true,
      messaging: true,
      tips: true,
      contentLock: false,
      community: true
    };

    const settings = await AppSetting.findOne().lean();
    const toggles = { ...defaultToggles, ...(settings?.toggles || {}) };

    Object.keys(toggles).forEach((key) => {
      if (toggles[key] === 'false') toggles[key] = false;
      if (toggles[key] === 'true') toggles[key] = true;
    });

    res.json({ toggles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// --- Livestreams ---
const createLivestream = async (req, res) => {
    upload(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        try {
            let creator = await Creator.findOne({ userId: req.user._id.toString() });
            if (!creator) return res.status(404).json({ error: 'Creator profile missing' });

            const { title, description, audience, scheduledTime, settings, status } = req.body;
      const thumbnailFile = req.files?.file?.[0] || req.files?.thumbnail?.[0];

      if (!thumbnailFile) {
        return res.status(400).json({ error: 'Livestream thumbnail is required' });
      }

      if (!thumbnailFile.mimetype || !thumbnailFile.mimetype.startsWith('image/')) {
        return res.status(400).json({ error: 'Thumbnail must be an image file' });
      }

      let thumbnail = '';

      if (thumbnailFile) {
        const streamUpload = (file) => {
                    return new Promise((resolve, reject) => {
                        let stream = cloudinary.uploader.upload_stream(
              { resource_type: 'image', folder: 'logoipsum_livestreams' },
                            (error, result) => {
                                if (result) resolve(result);
                                else reject(error);
                            }
                        );
            streamifier.createReadStream(file.buffer).pipe(stream);
                    });
                };
        const result = await streamUpload(thumbnailFile);
                thumbnail = result.secure_url;
            }

            const newLive = await Livestream.create({
                title,
                description,
        thumbnail,
                audience,
                scheduledTime,
                status: status || 'scheduled',
                startedAt: status === 'live' ? new Date() : undefined,
                creatorId: creator._id,
                settings: settings ? JSON.parse(settings) : { displayChat: true, notificationsEnabled: true, autoModeration: true }
            });

            res.status(201).json(newLive);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};

const getLivestreams = async (req, res) => {
    try {
        let creator = await Creator.findOne({ userId: req.user._id.toString() });
        if (!creator) return res.json([]);
        const livestreams = await Livestream.find({ creatorId: creator._id }).sort({ scheduledTime: 1 });
        res.json(livestreams);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const getParticipantId = (participant) => {
  if (!participant) return '';
  if (typeof participant === 'string') return participant;
  if (participant._id) return participant._id.toString();
  return participant.toString();
};

/** Map creator profile id → user id when clients pass creatorId as recipientId. */
async function resolveRecipientUserId(recipientId) {
  const id = String(recipientId || '').trim();
  if (!id) return '';

  const asUser = await User.findById(id);
  if (asUser) return id;

  const asCreator = await Creator.findById(id);
  if (asCreator?.userId) return String(asCreator.userId);

  return id;
}

const getMessages = async (req, res) => {
  try {
    await Message.updateMany(
      { recipient: req.user._id, status: 'sent' },
      { $set: { status: 'delivered' } }
    );

    const userId = req.user._id.toString();
    const messages = await Message.find({
      $or: [{ sender: req.user._id }, { recipient: req.user._id }],
      hiddenFor: { $nin: [req.user._id] }
    }).sort({ createdAt: -1 }).populate('sender recipient', 'name email avatar');

    const blocks = await Block.find({
      $or: [{ blocker: req.user._id }, { blocked: req.user._id }]
    }).select('blocker blocked');

    const blockedUserIds = new Set(
      blocks.map((blockDoc) =>
        blockDoc.blocker.toString() === userId
          ? blockDoc.blocked.toString()
          : blockDoc.blocker.toString()
      )
    );

    const filteredMessages = messages.filter((message) => {
      const senderId = getParticipantId(message.sender);
      const recipientId = getParticipantId(message.recipient);
      const otherParticipantId = senderId === userId ? recipientId : senderId;
      return !blockedUserIds.has(otherParticipantId);
    });

    res.json(filteredMessages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const sendMessage = async (req, res) => {
  try {
    const { recipientId, text, mediaUrl, mediaType, thumbnailUrl, encryptedText, nonce, isEncrypted, replyTo } = req.body;

    if (!recipientId) {
      return res.status(400).json({ error: 'recipientId is required' });
    }

    const resolvedRecipientId = await resolveRecipientUserId(recipientId);
    if (!resolvedRecipientId) {
      return res.status(400).json({ error: 'Invalid recipient' });
    }

    if (!text && !encryptedText && !mediaUrl) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const existingBlock = await Block.findOne({
      $or: [
        { blocker: req.user._id, blocked: resolvedRecipientId },
        { blocker: resolvedRecipientId, blocked: req.user._id }
      ]
    });

    if (existingBlock) {
      return res.status(403).json({ error: 'Cannot send message. User is blocked.' });
    }

    const conversationId = [req.user._id.toString(), resolvedRecipientId].sort().join('_');
    const message = await Message.create({
      conversationId,
      sender: req.user._id,
      recipient: resolvedRecipientId,
      text: text || '',
      mediaUrl,
      mediaType,
      thumbnailUrl: thumbnailUrl || '',
      encryptedText: encryptedText || '',
      nonce: nonce || '',
      isEncrypted: Boolean(isEncrypted && encryptedText && nonce),
      ...(replyTo ? { replyTo } : {})
    });

    try {
      await Notification.create({
        recipient: resolvedRecipientId,
        sender: req.user._id,
        type: 'message',
        content: `You received a new message from ${req.user.name}`,
        relatedId: message._id
      });
    } catch (notifyErr) {
      console.warn('Message notification failed:', notifyErr?.message || notifyErr);
    }

    const populated = { ...message.toObject(), _id: message._id };
    const senderDoc = await User.findById(String(req.user._id)).select('name email avatar').lean().exec();
    const recipientDoc = await User.findById(resolvedRecipientId).select('name email avatar').lean().exec();
    if (senderDoc) populated.sender = senderDoc;
    if (recipientDoc) populated.recipient = recipientDoc;

    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const deleteMessage = async (req, res) => {
  try {
    const { deleteType } = req.body;
    const message = await Message.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (deleteType === 'for_everyone') {
      if (message.sender.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Only the sender can delete for everyone' });
      }

      message.isDeleted = true;
      message.deletedAt = new Date();
      message.text = '';
      message.encryptedText = '';
      message.nonce = '';

      await message.save();
      return res.json({ ...message.toObject(), deleteType: 'for_everyone' });
    }

    if (deleteType === 'for_me') {
      const hiddenFor = message.hiddenFor || [];
      const alreadyHidden = hiddenFor.some(
        (userId) => userId.toString() === req.user._id.toString()
      );

      if (!alreadyHidden) {
        hiddenFor.push(req.user._id);
      }

      message.hiddenFor = hiddenFor;
      await message.save();
      return res.json({ ...message.toObject(), deleteType: 'for_me' });
    }

    return res.status(400).json({ error: 'Invalid deleteType' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const editMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to edit this message' });
    }

    if (message.isDeleted) {
      return res.status(400).json({ error: 'Cannot edit a deleted message' });
    }

    const { text, encryptedText, nonce } = req.body;
    if (typeof text === 'string') {
      message.text = text;
    }

    if (encryptedText) {
      message.encryptedText = encryptedText;
      message.nonce = nonce || '';
      message.isEncrypted = true;
    } else if (typeof text === 'string') {
      message.isEncrypted = false;
      message.encryptedText = '';
      message.nonce = '';
    }

    message.isEdited = true;
    message.editedAt = new Date();

    await message.save();
    res.json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const reactToMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const { emoji } = req.body;
    if (!emoji) {
      return res.status(400).json({ error: 'emoji is required' });
    }

    const userId = req.user._id.toString();
    const userReactions = message.reactions.filter(
      (reaction) => reaction.userId.toString() === userId
    );
    const hasSameEmoji = userReactions.some((reaction) => reaction.emoji === emoji);

    // Keep at most one reaction per user on each message.
    message.reactions = message.reactions.filter(
      (reaction) => reaction.userId.toString() !== userId
    );

    if (!hasSameEmoji) {
      message.reactions.push({ userId: req.user._id, emoji });
    }

    await message.save();
    res.json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const blockUser = async (req, res) => {
  try {
    const blockedUserId = req.params.userId;
    if (req.user._id.toString() === blockedUserId.toString()) {
      return res.status(400).json({ error: 'You cannot block yourself' });
    }

    const existingBlock = await Block.findOne({
      blocker: req.user._id,
      blocked: blockedUserId
    });

    if (existingBlock) {
      await existingBlock.deleteOne();
      return res.json({ message: 'User unblocked', blocked: false });
    }

    await Block.create({ blocker: req.user._id, blocked: blockedUserId });
    res.json({ message: 'User blocked', blocked: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getBlockStatus = async (req, res) => {
  try {
    const block = await Block.findOne({
      blocker: req.user._id,
      blocked: req.params.userId
    });

    res.json({ isBlocked: Boolean(block) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const markConversationSeen = async (req, res) => {
  try {
    await Message.updateMany(
      {
        conversationId: req.params.conversationId,
        recipient: req.user._id,
        status: { $in: ['sent', 'delivered'] }
      },
      { $set: { status: 'seen' } }
    );

    res.json({ message: 'Marked as seen' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getDashboardData,
  createPost,
  getPosts,
  getPostById,
  updatePost,
  deletePost,
  updateSocialLinks,
  getSocialLinks,
  getAnalytics,
  getSubscribers,
  getInsightsData,
  updateCreatorProfile,
  getNotifications,
  markNotificationRead,
  markAllCreatorNotificationsRead,
  getPayoutSettings,
  updatePayoutSettings,
  getFeatureAvailability,
  createLivestream,
  getLivestreams,
  uploadMessageMediaHandler,
  getMessages,
  sendMessage,
  deleteMessage,
  editMessage,
  reactToMessage,
  blockUser,
  getBlockStatus,
  markConversationSeen
};
