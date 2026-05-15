const { isValidObjectId } = require('../../../utils/objectId');
const { z } = require('zod');
const Report = require('../../../models/Report');
const Post = require('../../../models/Post');
const Creator = require('../../../models/Creator');
const Ban = require('../../../models/Ban');

const reportReasonEnum = [
  'spam',
  'hate_speech',
  'misinformation',
  'nudity',
  'harassment',
  'violence',
  'copyright',
  'other'
];

const createReportSchema = z.object({
  postId: z.string().trim().refine((value) => isValidObjectId(value), {
    message: 'Invalid postId'
  }),
  reason: z.enum(reportReasonEnum),
  description: z.string().max(500).optional()
});

const adminActionSchema = z.object({
  action: z.enum(['dismiss', 'lock_post', 'ban_creator']),
  banType: z.enum(['temporary', 'permanent']).optional(),
  banDuration: z.number().int().positive().optional(),
  banReason: z.string().trim().min(1).optional()
}).superRefine((data, ctx) => {
  if (data.action !== 'ban_creator') return;

  if (!data.banType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['banType'],
      message: 'banType is required when action is ban_creator'
    });
  }

  if (!data.banReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['banReason'],
      message: 'banReason is required when action is ban_creator'
    });
  }

  if (data.banType === 'temporary' && !data.banDuration) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['banDuration'],
      message: 'banDuration is required for temporary bans'
    });
  }
});

const parsePagination = ({ page, limit }, defaults = { page: 1, limit: 10, maxLimit: 100 }) => {
  const parsedPage = Math.max(parseInt(page, 10) || defaults.page, 1);
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || defaults.limit, 1), defaults.maxLimit);
  const skip = (parsedPage - 1) * parsedLimit;

  return { page: parsedPage, limit: parsedLimit, skip };
};

const normalizePostType = (postDoc) => {
  if (!postDoc || typeof postDoc !== 'object') return postDoc;
  const normalized = postDoc.toObject ? postDoc.toObject() : { ...postDoc };
  if (normalized.mediaType && !normalized.type) {
    normalized.type = normalized.mediaType;
  }
  return normalized;
};

const createReport = async ({ userId, payload }) => {
  const validated = createReportSchema.parse(payload);

  const post = await Post.findById(validated.postId).select('title thumbnailUrl mediaType creatorId status policyViolationLocked');
  if (!post || post.status === 'archived' || post.policyViolationLocked) {
    const error = new Error('Post not found or unavailable for reporting');
    error.statusCode = 404;
    throw error;
  }

  const creator = await Creator.findById(post.creatorId).select('userId');
  if (!creator || !creator.userId) {
    const error = new Error('Post creator not found');
    error.statusCode = 404;
    throw error;
  }

  if (String(creator.userId) === String(userId)) {
    const error = new Error('You cannot report your own post');
    error.statusCode = 400;
    throw error;
  }

  if (!isValidObjectId(creator.userId)) {
    const error = new Error('Post creator account is invalid');
    error.statusCode = 400;
    throw error;
  }

  const existing = await Report.findOne({ reportedBy: userId, postId: post._id }).select('_id');
  if (existing) {
    const error = new Error('You have already reported this post');
    error.statusCode = 409;
    throw error;
  }

  const creatorUserId = String(creator.userId);

  try {
    const report = await Report.create({
      reportedBy: userId,
      creatorId: creatorUserId,
      postId: post._id,
      reason: validated.reason,
      description: validated.description || ''
    });

    return {
      message: 'Report submitted successfully',
      report
    };
  } catch (error) {
    if (error?.code === 11000) {
      const duplicateError = new Error('You have already reported this post');
      duplicateError.statusCode = 409;
      throw duplicateError;
    }
    throw error;
  }
};

const getMyReports = async ({ userId, query }) => {
  const pagination = parsePagination(query, { page: 1, limit: 10, maxLimit: 100 });

  const [items, total] = await Promise.all([
    Report.find({ reportedBy: userId })
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate({
        path: 'postId',
        select: 'title thumbnailUrl mediaType',
        model: 'Post'
      }),
    Report.countDocuments({ reportedBy: userId })
  ]);

  const reports = items.map((item) => {
    const report = item.toObject();
    report.postId = normalizePostType(report.postId);
    return report;
  });

  return {
    data: reports,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit) || 1
    }
  };
};

const getAdminReports = async ({ query }) => {
  const status = ['pending', 'reviewed', 'dismissed'].includes(query.status) ? query.status : 'pending';
  const pagination = parsePagination(query, { page: 1, limit: 20, maxLimit: 100 });

  const filter = { status };

  const [items, total] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate({ path: 'reportedBy', select: 'name email avatar' })
      .populate({ path: 'creatorId', select: 'name email avatar' })
      .populate({ path: 'postId', select: 'title thumbnailUrl mediaType' }),
    Report.countDocuments(filter)
  ]);

  const postIds = [...new Set(items.map((item) => String(item.postId?._id || item.postId)).filter(Boolean))];

  const counts = postIds.length
    ? await Report.aggregate([
      { $match: { postId: { $in: postIds } } },
      { $group: { _id: '$postId', count: { $sum: 1 } } }
    ])
    : [];

  const countMap = new Map(counts.map((entry) => [String(entry._id), entry.count]));

  const reports = items.map((item) => {
    const report = item.toObject();
    report.postId = normalizePostType(report.postId);
    report.totalReportsOnThisPost = countMap.get(String(report.postId?._id || report.postId)) || 0;
    return report;
  });

  return {
    data: reports,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit) || 1
    }
  };
};

const getAdminReportById = async (reportId) => {
  if (!isValidObjectId(reportId)) {
    const error = new Error('Invalid report id');
    error.statusCode = 400;
    throw error;
  }

  const report = await Report.findById(reportId)
    .populate({ path: 'reportedBy', select: 'name email avatar' })
    .populate({ path: 'creatorId', select: 'name email avatar' })
    .populate({ path: 'postId', select: 'title description thumbnailUrl mediaType status policyViolationLocked' })
    .populate({ path: 'reviewedBy', select: 'name email avatar' });

  if (!report) {
    const error = new Error('Report not found');
    error.statusCode = 404;
    throw error;
  }

  const out = report.toObject();
  out.postId = normalizePostType(out.postId);
  return out;
};

const takeAdminAction = async ({ reportId, adminUserId, payload }) => {
  if (!isValidObjectId(reportId)) {
    const error = new Error('Invalid report id');
    error.statusCode = 400;
    throw error;
  }

  const validated = adminActionSchema.parse(payload);

  const report = await Report.findById(reportId);
  if (!report) {
    const error = new Error('Report not found');
    error.statusCode = 404;
    throw error;
  }

  const reviewedAt = new Date();

  if (validated.action === 'dismiss') {
    report.status = 'dismissed';
    report.reviewedBy = adminUserId;
    report.reviewedAt = reviewedAt;
    report.actionTaken = 'none';
    await report.save();

    return { report };
  }

  if (validated.action === 'lock_post') {
    const updatedPost = await Post.findByIdAndUpdate(
      report.postId,
      {
        $set: {
          policyViolationLocked: true,
          policyViolationLabel: 'Locked by moderation action',
          policyViolationLockedAt: reviewedAt,
          policyViolationLockedBy: adminUserId
        }
      },
      { new: true }
    );

    if (!updatedPost) {
      const error = new Error('Post not found');
      error.statusCode = 404;
      throw error;
    }

    report.status = 'reviewed';
    report.actionTaken = 'post_locked';
    report.reviewedBy = adminUserId;
    report.reviewedAt = reviewedAt;
    await report.save();

    const postObj = normalizePostType(updatedPost);
    return { report, post: postObj };
  }

  const activeBan = await Ban.getActiveBan(report.creatorId);
  if (activeBan) {
    const error = new Error('Creator already has an active ban');
    error.statusCode = 409;
    throw error;
  }

  const endDate = validated.banType === 'temporary'
    ? new Date(Date.now() + validated.banDuration * 86400000)
    : null;

  const ban = await Ban.create({
    userId: report.creatorId,
    bannedBy: adminUserId,
    reportId: report._id,
    reason: validated.banReason,
    banType: validated.banType,
    endDate
  });

  report.status = 'reviewed';
  report.actionTaken = 'creator_banned';
  report.reviewedBy = adminUserId;
  report.reviewedAt = reviewedAt;
  await report.save();

  return { report, ban };
};

module.exports = {
  createReportSchema,
  adminActionSchema,
  createReport,
  getMyReports,
  getAdminReports,
  getAdminReportById,
  takeAdminAction
};
