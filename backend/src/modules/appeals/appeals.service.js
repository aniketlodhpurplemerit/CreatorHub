const { isValidObjectId } = require('../../../utils/objectId');
const { z } = require('zod');
const Appeal = require('../../../models/Appeal');
const Ban = require('../../../models/Ban');
const Creator = require('../../../models/Creator');
const Post = require('../../../models/Post');
const { createTicket } = require('../../../../frontend/UserSupport/services/submitTicket.service');

const MS_PER_DAY = 86400000;

const createAppealSchema = z.object({
  reason: z.string().trim().min(50).max(2000),
  supportingInfo: z.string().max(1000).optional(),
  postId: z.string().trim().optional()
});

const adminDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  adminNote: z.string().trim().min(10)
});

const parsePagination = ({ page, limit }, defaults = { page: 1, limit: 20, maxLimit: 100 }) => {
  const parsedPage = Math.max(parseInt(page, 10) || defaults.page, 1);
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || defaults.limit, 1), defaults.maxLimit);
  const skip = (parsedPage - 1) * parsedLimit;
  return { page: parsedPage, limit: parsedLimit, skip };
};

const toActiveBanResponse = (ban) => {
  if (!ban) return null;

  const isPermanent = ban.banType === 'permanent';
  const endDate = ban.endDate ? new Date(ban.endDate) : null;
  const remainingDays = isPermanent || !endDate
    ? null
    : Math.ceil((endDate.getTime() - Date.now()) / MS_PER_DAY);

  return {
    isActive: true,
    banType: ban.banType,
    reason: ban.reason,
    endDate: endDate ? endDate.toISOString() : null,
    remainingDays
  };
};

const toAppealSummary = (appealDoc) => {
  if (!appealDoc) return null;

  const appeal = appealDoc.toObject ? appealDoc.toObject() : appealDoc;

  return {
    _id: appeal._id,
    status: appeal.status,
    reason: appeal.reason,
    supportingInfo: appeal.supportingInfo,
    submittedAt: appeal.submittedAt,
    reviewedAt: appeal.reviewedAt,
    adminNote: appeal.adminNote,
    ban: appeal.banId
      ? {
          reason: appeal.banId.reason,
          banType: appeal.banId.banType,
          startDate: appeal.banId.startDate,
          endDate: appeal.banId.endDate
        }
      : null
  };
};

const createAppeal = async ({ userId, payload }) => {
  const validated = createAppealSchema.parse(payload);

  const [activeBan, creatorProfile] = await Promise.all([
    Ban.getActiveBan(userId),
    Creator.findOne({ userId: String(userId) }).select('_id').lean()
  ]);

  const lockedPosts = creatorProfile?._id
    ? await Post.find({ creatorId: creatorProfile._id, policyViolationLocked: true })
      .select('_id title thumbnailUrl policyViolationLockedAt policyViolationLabel')
      .sort({ policyViolationLockedAt: -1 })
      .lean()
    : [];

  const hasLockRestriction = lockedPosts.length > 0;

  if (!activeBan && !hasLockRestriction) {
    const error = new Error('You do not have an active ban or locked content restriction to appeal');
    error.statusCode = 400;
    throw error;
  }

  let existingAppeal = null;
  let appealType = 'ban';
  let banId = null;
  let postIds = [];
  let selectedLockedPost = null;

  if (activeBan) {
    appealType = 'ban';
    banId = activeBan._id;
    existingAppeal = await Appeal.findOne({ banId: activeBan._id }).select('status');
  } else {
    appealType = 'post_lock';

    if (!validated.postId || !isValidObjectId(validated.postId)) {
      const error = new Error('A valid locked post selection is required to submit this appeal');
      error.statusCode = 400;
      throw error;
    }

    selectedLockedPost = lockedPosts.find((post) => String(post._id) === String(validated.postId));
    if (!selectedLockedPost) {
      const error = new Error('Selected post is not currently locked or does not belong to your account');
      error.statusCode = 400;
      throw error;
    }

    postIds = [selectedLockedPost._id];
    existingAppeal = await Appeal.findOne({
      creatorId: userId,
      appealType: 'post_lock',
      postIds: selectedLockedPost._id,
      status: { $in: ['pending', 'rejected'] }
    }).sort({ createdAt: -1 }).select('status');
  }

  if (existingAppeal?.status === 'pending') {
    const error = new Error('You already have a pending appeal');
    error.statusCode = 409;
    throw error;
  }

  if (existingAppeal?.status === 'rejected') {
    const error = new Error('Your previous appeal was rejected. Contact support for assistance.');
    error.statusCode = 409;
    throw error;
  }

  const attachmentList = Array.isArray(payload?.attachments) ? payload.attachments : [];

  const appealPayload = {
    creatorId: userId,
    appealType,
    postIds,
    reason: validated.reason,
    supportingInfo: validated.supportingInfo || '',
    attachments: attachmentList
  };

  if (banId) {
    appealPayload.banId = banId;
  }

  const appeal = await Appeal.create(appealPayload);

  try {
    const ticket = await createTicket({
      submittedBy: userId,
      submitterRole: 'creator',
      tag: 'moderation',
      heading: appealType === 'ban'
        ? 'Appeal submitted (ban)'
        : `Appeal submitted (post unlock) · ${selectedLockedPost?.title || 'Untitled post'}`,
      description: `Appeal ${appeal._id}: ${validated.reason}`,
      attachments: attachmentList
    });

    if (ticket?.ticketId) {
      appeal.supportTicketId = ticket.ticketId;
      await appeal.save();
    }
  } catch (_error) {
    // Non-blocking: appeal should still be submitted even if support ticket creation fails.
  }

  return appeal;
};

const getMyAppeal = async ({ userId }) => {
  const [activeBan, latestAppeal, banAppealDoc, postLockAppealDocs, creatorProfile] = await Promise.all([
    Ban.getActiveBan(userId),
    Appeal.findOne({ creatorId: userId })
      .sort({ submittedAt: -1, createdAt: -1 })
      .populate({ path: 'banId', select: 'reason banType startDate endDate' })
      .populate({ path: 'postIds', select: 'title thumbnailUrl policyViolationLabel policyViolationLockedAt' }),
    Appeal.findOne({ creatorId: userId, appealType: 'ban' })
      .sort({ submittedAt: -1, createdAt: -1 })
      .populate({ path: 'banId', select: 'reason banType startDate endDate' }),
    Appeal.find({ creatorId: userId, appealType: 'post_lock' })
      .sort({ submittedAt: -1, createdAt: -1 })
      .limit(100)
      .populate({ path: 'postIds', select: 'title thumbnailUrl policyViolationLabel policyViolationLockedAt' }),
    Creator.findOne({ userId: String(userId) }).select('_id').lean()
  ]);

  const lockedPosts = creatorProfile?._id
    ? await Post.find({ creatorId: creatorProfile._id, policyViolationLocked: true })
      .select('_id title thumbnailUrl policyViolationLabel policyViolationLockedAt')
      .sort({ policyViolationLockedAt: -1 })
      .lean()
    : [];

  const latestAppealObj = latestAppeal ? latestAppeal.toObject() : null;
  const appealSummary = toAppealSummary(latestAppeal);
  const banAppealSummary = toAppealSummary(banAppealDoc);

  const postLockAppeals = (postLockAppealDocs || []).map((doc) => {
    const summary = toAppealSummary(doc);
    const obj = doc.toObject();
    return {
      ...summary,
      appealType: 'post_lock',
      posts: Array.isArray(obj.postIds) ? obj.postIds : [],
      attachments: Array.isArray(obj.attachments) ? obj.attachments : [],
      supportTicketId: obj.supportTicketId || ''
    };
  });

  const latestPostAppealByPostId = new Map();
  for (const item of postLockAppeals) {
    const post = Array.isArray(item.posts) ? item.posts[0] : null;
    const postId = post?._id ? String(post._id) : null;
    if (postId && !latestPostAppealByPostId.has(postId)) {
      latestPostAppealByPostId.set(postId, item);
    }
  }

  const lockedPostsWithAppealMeta = lockedPosts.map((post) => {
    const relatedAppeal = latestPostAppealByPostId.get(String(post._id));
    return {
      ...post,
      appealStatus: relatedAppeal?.status || null,
      appealId: relatedAppeal?._id || null,
      supportTicketId: relatedAppeal?.supportTicketId || ''
    };
  });

  if (appealSummary && latestAppealObj) {
    appealSummary.appealType = latestAppealObj.appealType || 'ban';
    appealSummary.posts = Array.isArray(latestAppealObj.postIds) ? latestAppealObj.postIds : [];
    appealSummary.attachments = Array.isArray(latestAppealObj.attachments) ? latestAppealObj.attachments : [];
    appealSummary.supportTicketId = latestAppealObj.supportTicketId || '';
  }

  if (banAppealSummary && banAppealDoc) {
    const banAppealObj = banAppealDoc.toObject();
    banAppealSummary.appealType = 'ban';
    banAppealSummary.posts = [];
    banAppealSummary.attachments = Array.isArray(banAppealObj.attachments) ? banAppealObj.attachments : [];
    banAppealSummary.supportTicketId = banAppealObj.supportTicketId || '';
  }

  return {
    appeal: appealSummary,
    banAppeal: banAppealSummary,
    postLockAppeals,
    activeBan: toActiveBanResponse(activeBan),
    lockedPosts: lockedPostsWithAppealMeta,
    hasLockedRestrictions: lockedPosts.length > 0
  };
};

const getAdminAppeals = async ({ query }) => {
  const pagination = parsePagination(query, { page: 1, limit: 20, maxLimit: 100 });
  const filter = {};

  if (['pending', 'approved', 'rejected'].includes(query.status)) {
    filter.status = query.status;
  }

  const [items, total] = await Promise.all([
    Appeal.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .populate({ path: 'creatorId', select: 'name email avatar' })
      .populate({ path: 'banId', select: 'reason banType startDate endDate reportId' })
      .populate({ path: 'postIds', select: 'title thumbnailUrl policyViolationLabel policyViolationLockedAt' }),
    Appeal.countDocuments(filter)
  ]);

  return {
    data: items,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit) || 1
    }
  };
};

const getAdminAppealById = async (appealId) => {
  const appeal = await Appeal.findById(appealId)
    .populate({ path: 'creatorId', select: 'name email avatar role createdAt' })
    .populate({ path: 'reviewedBy', select: 'name email avatar' })
    .populate({ path: 'postIds', select: 'title thumbnailUrl policyViolationLabel policyViolationLockedAt creatorId' })
    .populate({
      path: 'banId',
      select: 'userId bannedBy reportId reason banType startDate endDate isActive liftedBy liftedAt liftReason',
      populate: [
        { path: 'bannedBy', select: 'name email avatar' },
        { path: 'liftedBy', select: 'name email avatar' },
        {
          path: 'reportId',
          populate: [
            { path: 'reportedBy', select: 'name email avatar' },
            { path: 'creatorId', select: 'name email avatar' },
            { path: 'postId', select: 'title thumbnailUrl mediaType' }
          ]
        }
      ]
    });

  if (!appeal) {
    const error = new Error('Appeal not found');
    error.statusCode = 404;
    throw error;
  }

  return appeal;
};

const decideAppeal = async ({ appealId, adminUserId, payload }) => {
  const validated = adminDecisionSchema.parse(payload);

  const appeal = await Appeal.findById(appealId).populate({ path: 'banId' });
  if (!appeal) {
    const error = new Error('Appeal not found');
    error.statusCode = 404;
    throw error;
  }

  if (appeal.status !== 'pending') {
    const error = new Error('Appeal has already been reviewed');
    error.statusCode = 409;
    throw error;
  }

  const now = new Date();
  appeal.status = validated.decision === 'approve' ? 'approved' : 'rejected';
  appeal.reviewedBy = adminUserId;
  appeal.reviewedAt = now;
  appeal.adminNote = validated.adminNote;
  await appeal.save();

  if (validated.decision === 'reject') {
    return {
      appeal,
      message: 'Appeal rejected.'
    };
  }

  if (appeal.appealType === 'post_lock') {
    const ids = Array.isArray(appeal.postIds) ? appeal.postIds : [];
    if (ids.length > 0) {
      await Post.updateMany(
        { _id: { $in: ids } },
        {
          $set: {
            policyViolationLocked: false,
            policyViolationLabel: '',
            policyViolationLockedAt: null,
            policyViolationLockedBy: null,
          }
        }
      );

      // Backward compatibility: older moderation flows archived locked posts.
      // Restore those posts to published once the lock appeal is approved.
      await Post.updateMany(
        {
          _id: { $in: ids },
          status: 'archived'
        },
        {
          $set: {
            status: 'published'
          }
        }
      );
    }

    return {
      appeal,
      message: "Appeal approved. Locked post restrictions have been lifted."
    };
  }

  if (!appeal.banId) {
    const error = new Error('Linked ban record not found');
    error.statusCode = 404;
    throw error;
  }

  appeal.banId.isActive = false;
  appeal.banId.liftedBy = adminUserId;
  appeal.banId.liftedAt = now;
  appeal.banId.liftReason = `Appeal approved: ${validated.adminNote}`;
  await appeal.banId.save();

  await Creator.updateMany(
    { userId: String(appeal.banId.userId) },
    { $set: { status: 'active' } }
  );

  return {
    appeal,
    message: "Appeal approved. Creator's ban has been lifted."
  };
};

module.exports = {
  createAppealSchema,
  adminDecisionSchema,
  createAppeal,
  getMyAppeal,
  getAdminAppeals,
  getAdminAppealById,
  decideAppeal
};
