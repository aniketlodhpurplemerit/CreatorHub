const express = require('express');
const router = express.Router();
const { protect, authorizeCreatorOrProfile } = require('../middleware/authMiddleware');
const { checkBan } = require('../middleware/checkBan');
const { checkFeatureToggle } = require('../middleware/featureToggleMiddleware');
const {
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
  markAllCreatorNotificationsRead,
  markNotificationRead,
  getPayoutSettings,
  updatePayoutSettings,
  getFeatureAvailability,
  createLivestream,
  getLivestreams,
  getMessages,
  uploadMessageMediaHandler,
  sendMessage,
  deleteMessage,
  editMessage,
  reactToMessage,
  blockUser,
  getBlockStatus,
  markConversationSeen
} = require('../controllers/creatorController');
const creatorSubscriptionRoutes = require('../../frontend/CreatorSubscription/routes/subscription.routes');

router.use(protect);
router.use(authorizeCreatorOrProfile());
router.use('/subscription', creatorSubscriptionRoutes);

router.get('/dashboard', getDashboardData);
router.get('/features', getFeatureAvailability);
router.put('/update-profile', updateCreatorProfile);
router.get('/analytics', getAnalytics);
router.get('/subscribers', getSubscribers);
router.get('/insights', getInsightsData);

// Notifications
router.get('/notifications', getNotifications);
router.put('/notifications/mark-all-read', markAllCreatorNotificationsRead);
router.put('/notifications/:id/read', markNotificationRead);

// Payouts
router.get('/payout-settings', getPayoutSettings);
router.put('/payout-settings', checkBan, updatePayoutSettings);

// Livestreams
router.post('/livestreams', checkFeatureToggle('livestreaming'), createLivestream);
router.get('/livestreams', getLivestreams);

// Messaging
router.get('/messages', checkFeatureToggle('messaging'), getMessages);
router.post('/messages/upload-media', checkBan, checkFeatureToggle('messaging'), uploadMessageMediaHandler);
router.post('/messages', checkFeatureToggle('messaging'), sendMessage);
router.put('/messages/seen/:conversationId', checkFeatureToggle('messaging'), markConversationSeen);
router.put('/messages/:id/delete', checkFeatureToggle('messaging'), deleteMessage);
router.put('/messages/:id/edit', checkFeatureToggle('messaging'), editMessage);
router.post('/messages/:id/react', reactToMessage);
router.post('/block/:userId', blockUser);
router.get('/block/:userId', getBlockStatus);

// Post routing
router.post('/posts', checkBan, createPost);
router.get('/posts', getPosts);
router.get('/posts/:id', getPostById);
router.patch('/posts/:id', checkBan, updatePost);
router.put('/posts/:id', checkBan, updatePost);
router.delete('/posts/:id', checkBan, deletePost);

// Social links routing
router.get('/social-links', getSocialLinks);
router.post('/social-links', updateSocialLinks);

module.exports = router;
