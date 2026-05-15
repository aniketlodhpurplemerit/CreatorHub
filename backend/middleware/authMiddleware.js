const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Creator = require('../models/Creator');
const { getRuntimeSecuritySettings } = require('../utils/securitySettings');
const {
  getJwtSecret,
  isLikelyJwt,
  isValidSessionId,
  timingSafeStringEqual,
} = require('../utils/authSecurity');
const { logAuthEvent } = require('../utils/authLogger');

const SESSION_ACTIVITY_REFRESH_MS = 60 * 1000;

const protect = async (req, res, next) => {
  const attachUserFromToken = async (rawToken) => {
    const decoded = jwt.verify(rawToken, getJwtSecret());
    const { sessionTimeoutMs } = await getRuntimeSecuritySettings();

    if (!decoded?.id) {
      return { ok: false, status: 401, message: 'Not authorized, invalid token' };
    }

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return { ok: false, status: 401, message: 'Not authorized, user not found' };
    }

    if (!isValidSessionId(decoded.sessionId)) {
      return { ok: false, status: 401, message: 'Not authorized, invalid session' };
    }

    const session = Array.isArray(user.sessions)
      ? user.sessions.find((item) => timingSafeStringEqual(item.sessionId, decoded.sessionId))
      : null;

    if (!session) {
      return { ok: false, status: 401, message: 'Not authorized, session revoked' };
    }

    const nowMs = Date.now();
    const lastSeenMs = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : Number.NaN;
    const createdAtMs = session.createdAt ? new Date(session.createdAt).getTime() : Number.NaN;
    const activityMs = Number.isFinite(lastSeenMs) ? lastSeenMs : createdAtMs;

    // Migration path: legacy sessions (without lastSeenAt) are accepted once and upgraded.
    const shouldApplyTimeout = Boolean(session.lastSeenAt);
    const isTimedOut = shouldApplyTimeout
      && Number.isFinite(activityMs)
      && nowMs - activityMs > sessionTimeoutMs;

    if (isTimedOut) {
      user.sessions = user.sessions.filter((item) => !timingSafeStringEqual(item.sessionId, decoded.sessionId));
      await user.save({ validateBeforeSave: false });
      return { ok: false, status: 401, message: 'Not authorized, session expired' };
    }

    const shouldRefreshActivity = !session.lastSeenAt
      || (Number.isFinite(activityMs) && nowMs - activityMs >= SESSION_ACTIVITY_REFRESH_MS);

    if (shouldRefreshActivity) {
      session.lastSeenAt = new Date(nowMs);
      await user.save({ validateBeforeSave: false });
    }

    req.user = user;
    req.sessionId = decoded.sessionId;
    return { ok: true };
  };

  const authHeader = req.headers.authorization;
  let token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]?.trim()
    : '';

  // EventSource cannot send Authorization; moderation stream passes token in query.
  if (
    !token &&
    req.method === 'GET' &&
    typeof req.query?.token === 'string' &&
    String(req.originalUrl || '').includes('/moderation/notifications/stream')
  ) {
    token = req.query.token.trim();
  }

  if (!token) {
    logAuthEvent('auth.denied', req, { reason: 'missing_bearer_token' }, 'warn');
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  if (!isLikelyJwt(token)) {
    logAuthEvent('auth.denied', req, { reason: 'malformed_token' }, 'warn');
    return res.status(401).json({ message: 'Not authorized, invalid token' });
  }

  try {
    const result = await attachUserFromToken(token);
    if (!result.ok) {
      logAuthEvent('auth.denied', req, { reason: result.message }, 'warn');
      return res.status(result.status).json({ message: result.message });
    }

    logAuthEvent('auth.granted', req, { reason: 'token_verified' });
    return next();
  } catch (error) {
    const message = error.name === 'TokenExpiredError'
      ? 'Not authorized, token expired'
      : 'Not authorized, invalid token';

    logAuthEvent(
      'auth.denied',
      req,
      { reason: error.name || 'verify_failed', detail: error.message },
      'warn'
    );
    return res.status(401).json({ message });
  }
};

// Role authorization
const authorize = (roles = []) => {
  if (typeof roles === 'string') {
    roles = [roles];
  }

  return (req, res, next) => {
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
};

/**
 * Creator API: allow `role === 'creator'` or any logged-in user who already has a creators row
 * (fixes 403 when DB role was not updated after creator onboarding / migration drift).
 */
const authorizeCreatorOrProfile = () => async (req, res, next) => {
  if (req.user?.role === 'creator') {
    return next();
  }
  try {
    const creator = await Creator.findOne({ userId: String(req.user._id) });
    if (creator) {
      return next();
    }
  } catch (error) {
    return res.status(500).json({ message: 'Unable to verify creator access' });
  }
  return res.status(403).json({
    message:
      'This area is for creator accounts. Use “Become a creator” / switch to creator mode, or sign in with a creator account.',
  });
};

module.exports = { protect, authorize, authorizeCreatorOrProfile };
