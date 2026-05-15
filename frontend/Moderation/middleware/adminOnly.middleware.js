const { newObjectId } = require('../../../backend/utils/objectId');
const { ADMIN_ROLE } = require('../utils/moderationConstants');
const { log } = require('../services/adminLog.service');

/**
 * Restrict route access to admin users.
 */
async function adminOnly(req, res, next) {
  try {
    const role = req.user?.role;
    if (role !== ADMIN_ROLE) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    await log(
      req.user._id,
      'admin_route_access',
      newObjectId(),
      'route',
      `Accessed ${req.originalUrl}`,
      { method: req.method }
    );

    return next();
  } catch (error) {
    return res.status(500).json({ message: 'Unable to authorize admin route.' });
  }
}

module.exports = {
  adminOnly,
};
