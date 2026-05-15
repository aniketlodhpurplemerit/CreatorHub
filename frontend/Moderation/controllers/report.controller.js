const { isValidObjectId } = require('../../../backend/utils/objectId');
const Report = require('../models/ReportModel');
const Post = require('../../../backend/models/Post');
const Creator = require('../../../backend/models/Creator');
const Message = require('../../../backend/models/Message');
const { fileReport } = require('../services/dedup.service');
const { REPORT_REASONS, TARGET_TYPES } = require('../utils/moderationConstants');

/**
 * Resolve target owner userId.
 * @param {string} targetId
 * @param {'post'|'user'|'dm'} targetType
 * @param {string} reporterId
 * @returns {Promise<string|null>}
 */
async function resolveTargetOwner(targetId, targetType, reporterId) {
  if (targetType === 'user') return targetId;

  if (targetType === 'post') {
    const post = await Post.findById(targetId).select('creatorId').lean();
    if (!post) return null;
    const creator = await Creator.findById(post.creatorId).select('userId').lean();
    return creator?.userId || null;
  }

  if (targetType === 'dm') {
    const message = await Message.findById(targetId).select('sender recipient').lean();
    if (!message) return null;
    if (message.sender?.toString() === reporterId.toString()) return message.recipient?.toString();
    return message.sender?.toString();
  }

  return null;
}

/**
 * File a moderation report.
 */
async function createReport(req, res) {
  try {
    const { targetId, targetType, reason, comment } = req.body;

    if (!targetId || !targetType || !reason) {
      return res.status(400).json({ message: 'targetId, targetType and reason are required.' });
    }

    if (!TARGET_TYPES.includes(targetType)) {
      return res.status(400).json({ message: 'Invalid targetType.' });
    }

    if (!REPORT_REASONS.includes(reason)) {
      return res.status(400).json({ message: 'Invalid reason.' });
    }

    if (!isValidObjectId(targetId)) {
      return res.status(400).json({ message: 'Invalid targetId.' });
    }

    const targetOwnerId = await resolveTargetOwner(targetId, targetType, req.user._id);
    if (!targetOwnerId) {
      return res.status(404).json({ message: 'Target not found.' });
    }

    if (targetOwnerId.toString() === req.user._id.toString() && targetType !== 'dm') {
      return res.status(400).json({ message: 'You cannot report your own content.' });
    }

    const { report, isDuplicate } = await fileReport({
      reportedBy: req.user._id,
      targetId,
      targetType,
      reason,
      comment: (comment || '').slice(0, 500),
      targetOwnerId,
    });

    return res.status(200).json({
      reportId: report._id,
      status: report.status,
      duplicate: isDuplicate,
      message: isDuplicate
        ? 'A report is already open for this target. Your report was added.'
        : 'Report submitted successfully.',
    });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to file report.' });
  }
}

/**
 * Get reports filed by user and reports received against user content.
 */
async function getMyReports(req, res) {
  try {
    const userId = req.user._id;

    const [submitted, received] = await Promise.all([
      Report.find({
        $or: [{ reportedBy: userId }, { additionalReporters: userId }],
      })
        .sort({ createdAt: -1 })
        .lean(),
      Report.find({ targetOwnerId: userId }).sort({ createdAt: -1 }).lean(),
    ]);

    const sanitizedReceived = received.map((report) => ({
      _id: report._id,
      targetId: report.targetId,
      targetType: report.targetType,
      reason: report.reason,
      status: report.status,
      resolution: report.resolution || '',
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    }));

    return res.status(200).json({
      submitted,
      received: sanitizedReceived,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to fetch reports.' });
  }
}

/**
 * Get one report if requester is reporter or admin.
 */
async function getReportById(req, res) {
  try {
    const report = await Report.findById(req.params.id).lean();
    if (!report) {
      return res.status(404).json({ message: 'Report not found.' });
    }

    const isAdmin = req.user.role === (process.env.ADMIN_ROLE || 'admin');
    const isReporter =
      report.reportedBy?.toString() === req.user._id.toString() ||
      (report.additionalReporters || []).some((id) => id.toString() === req.user._id.toString());

    if (!isAdmin && !isReporter) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return res.status(200).json(report);
  } catch (error) {
    return res.status(500).json({ message: 'Unable to fetch report.' });
  }
}

module.exports = {
  createReport,
  getMyReports,
  getReportById,
};
