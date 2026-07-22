const { AppSetting } = require('../models/AdminData');

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const isConfiguredSecret = (value) => {
  const v = String(value || '').trim();
  if (!v) return false;
  // Treat .env.example placeholders as unset
  if (/^your[_-]/i.test(v)) return false;
  if (/placeholder|changeme|example/i.test(v)) return false;
  return true;
};

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];

  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]);
  }

  return req.ip || req.socket?.remoteAddress || '';
};

const getCaptchaRuntimeConfig = async () => {
  const siteKey = process.env.TURNSTILE_SITE_KEY || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
  const secretKey = process.env.TURNSTILE_SECRET_KEY || '';
  const keysConfigured =
    isConfiguredSecret(siteKey) && isConfiguredSecret(secretKey);

  // No real Turnstile credentials => captcha is fully off (ignore admin toggle).
  if (!keysConfigured) {
    return {
      enabled: false,
      siteKey: '',
      secretKey: '',
      configured: false,
    };
  }

  let enabled = false;
  try {
    const settings = await AppSetting.findOne().select('botProtectionEnabled');
    enabled = Boolean(settings?.botProtectionEnabled);
  } catch {
    // Settings lookup failed — keep captcha off rather than breaking auth.
    enabled = false;
  }

  return {
    enabled,
    siteKey,
    secretKey,
    configured: true,
  };
};

const verifyTurnstileToken = async (token, req, secretKey) => {
  const body = new URLSearchParams();
  body.set('secret', secretKey);
  body.set('response', token);

  const clientIp = getClientIp(req);
  if (clientIp) {
    body.set('remoteip', clientIp);
  }

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    return { success: false, errorCodes: ['verification_request_failed'] };
  }

  const data = await response.json();
  return {
    success: Boolean(data?.success),
    errorCodes: Array.isArray(data?.['error-codes']) ? data['error-codes'] : [],
  };
};

const getCaptchaToken = (req) => {
  const headerValue = req.headers['x-captcha-token'];
  const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return String(req.body?.captchaToken || headerToken || '').trim();
};

const getCaptchaConfig = async (req, res) => {
  try {
    const { enabled, siteKey, configured } = await getCaptchaRuntimeConfig();

    return res.status(200).json({
      enabled: Boolean(enabled && configured && siteKey),
      provider: 'turnstile',
      siteKey: enabled && configured ? siteKey : '',
      configured,
    });
  } catch (error) {
    // Never block login UI on captcha config failures — treat as disabled.
    return res.status(200).json({
      enabled: false,
      provider: 'turnstile',
      siteKey: '',
      configured: false,
    });
  }
};

const requireCaptchaIfEnabled = (actionLabel = 'this action') => {
  return async (req, res, next) => {
    try {
      const { enabled, siteKey, secretKey, configured } = await getCaptchaRuntimeConfig();

      if (!enabled || !configured) {
        return next();
      }

      if (!siteKey || !secretKey) {
        return next();
      }

      const captchaToken = getCaptchaToken(req);
      if (!captchaToken) {
        return res.status(400).json({
          message: `Please complete CAPTCHA verification before ${actionLabel}.`,
        });
      }

      const verification = await verifyTurnstileToken(captchaToken, req, secretKey);
      if (!verification.success) {
        return res.status(400).json({
          message: 'CAPTCHA verification failed. Please try again.',
          errorCodes: verification.errorCodes,
        });
      }

      return next();
    } catch (error) {
      // Fail open when captcha infrastructure errors — auth should still work offline/dev.
      return next();
    }
  };
};

module.exports = {
  getCaptchaConfig,
  requireCaptchaIfEnabled,
};
