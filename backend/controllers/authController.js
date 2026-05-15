const User = require('../models/User');
const Creator = require('../models/Creator');
const Admin = require('../../frontend/AdminManagement/models/AdminModel');
const { AppSetting } = require('../models/AdminData');
const generateToken = require('../utils/generateToken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const { getRuntimeSecuritySettings } = require('../utils/securitySettings');
const {
  DISPOSABLE_EMAIL_BLOCK_MESSAGE,
  normalizeEmailAddress,
  isValidEmailFormat,
  evaluateDisposableEmail,
} = require('../utils/disposableEmail');
const { checkFlagged } = require('../../frontend/Moderation/services/flaggedIdentity.service');
const { logAuthEvent } = require('../utils/authLogger');

/** Prefer creator profile avatar/bio when a creators row exists (keeps UI aligned with creator dashboard). */
async function mergeCreatorPresentation(user) {
  if (!user) return { avatar: '', bio: '' };
  const c = await Creator.findOne({ userId: String(user._id) }).lean();
  const avatar = c?.avatar ? c.avatar : user.avatar || '';
  const bio = c && c.bio != null && String(c.bio).trim() !== '' ? c.bio : user.bio || '';
  return { avatar, bio };
}

const DEFAULT_TERMS_OF_SERVICE =
  '## Platform Usage Rules\n1. Users must be 18+...\n2. All content must comply with global standards...';
const DEFAULT_PRIVACY_POLICY =
  '## Data Privacy\nWe value your data security. This document outlines how we process information...';

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
// Helper: Generate 6-digit OTP
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];

  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]);
  }

  return req.ip || req.socket?.remoteAddress || 'Unknown';
};

const parseUserAgent = (uaRaw) => {
  const ua = String(uaRaw || '');
  const lower = ua.toLowerCase();

  let browser = 'Unknown Browser';
  if (lower.includes('edg/')) browser = 'Edge';
  else if (lower.includes('opr/') || lower.includes('opera')) browser = 'Opera';
  else if (lower.includes('chrome/')) browser = 'Chrome';
  else if (lower.includes('safari/') && !lower.includes('chrome/')) browser = 'Safari';
  else if (lower.includes('firefox/')) browser = 'Firefox';
  else if (lower.includes('msie') || lower.includes('trident/')) browser = 'Internet Explorer';

  let os = 'Unknown OS';
  if (lower.includes('windows')) os = 'Windows';
  else if (lower.includes('android')) os = 'Android';
  else if (lower.includes('iphone') || lower.includes('ipad') || lower.includes('ios')) os = 'iOS';
  else if (lower.includes('mac os') || lower.includes('macintosh')) os = 'macOS';
  else if (lower.includes('linux')) os = 'Linux';

  return { browser, os };
};

const issueSessionToken = async (user, req) => {
  const sessionId = crypto.randomUUID();
  const userAgent = req.headers['user-agent'] || '';
  const { browser, os } = parseUserAgent(userAgent);
  const ipAddress = getClientIp(req);

  if (!Array.isArray(user.sessions)) {
    user.sessions = [];
  }

  user.sessions.push({
    sessionId,
    userAgent,
    browser,
    os,
    ipAddress,
    createdAt: new Date(),
    lastSeenAt: new Date(),
  });

  // Keep only the latest 20 sessions to prevent unbounded growth.
  if (user.sessions.length > 20) {
    user.sessions = user.sessions.slice(-20);
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  logAuthEvent('auth.session.issued', req, {
    userId: String(user._id),
    role: user.role,
    sessionId,
  });

  return generateToken(user._id, sessionId);
};

// Helper: Send OTP email
const sendOtpEmail = async (email, otp) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@logoipsum.app',
    to: email,
    subject: 'Your Logoipsum Verification Code',
    text: `Your verification code is: ${otp}. It expires in 5 minutes.`,
    html: `<div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:32px;">
      <h2 style="color:#1a1a1a;">Verify your email</h2>
      <p style="color:#5a5a5a;">Your verification code is:</p>
      <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#e14517;margin:24px 0;">${otp}</div>
      <p style="color:#9a9a9a;font-size:14px;">This code expires in 5 minutes.</p>
    </div>`,
  });
};

const sendDisposableEmailRejected = (res) =>
  res.status(422).json({
    code: 'DISPOSABLE_EMAIL_NOT_ALLOWED',
    message: DISPOSABLE_EMAIL_BLOCK_MESSAGE,
  });

// @desc    Check whether an email can be used for signup
// @route   POST /api/auth/email/check
// @access  Public
const checkEmailEligibility = async (req, res) => {
  const normalizedEmail = normalizeEmailAddress(req.body?.email);

  if (!normalizedEmail) {
    return res.status(400).json({
      code: 'EMAIL_REQUIRED',
      message: 'Email is required',
    });
  }

  if (!isValidEmailFormat(normalizedEmail)) {
    return res.status(400).json({
      code: 'INVALID_EMAIL',
      message: 'Please enter a valid email address',
    });
  }

  try {
    const emailStatus = await evaluateDisposableEmail(normalizedEmail);
    if (emailStatus.isDisposable) {
      return res.json({
        valid: true,
        disposable: true,
        code: 'DISPOSABLE_EMAIL_NOT_ALLOWED',
        message: DISPOSABLE_EMAIL_BLOCK_MESSAGE,
      });
    }

    return res.json({
      valid: true,
      disposable: false,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const registerUser = async (req, res) => {
  const { name, email, password, role, username, phone, deviceFingerprint } = req.body;
  const normalizedEmail = normalizeEmailAddress(email);

  try {
    const { minPasswordLength } = await getRuntimeSecuritySettings();

    if (typeof password !== 'string' || password.length < minPasswordLength) {
      return res
        .status(400)
        .json({ message: `Password must be at least ${minPasswordLength} characters long` });
    }

    if (!isValidEmailFormat(normalizedEmail)) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }

    const emailStatus = await evaluateDisposableEmail(normalizedEmail);
    if (emailStatus.isDisposable) {
      return sendDisposableEmailRejected(res);
    }

    const flagged = await checkFlagged({
      email: normalizedEmail,
      phone,
      username,
      deviceFingerprint,
    });

    if (flagged) {
      return res.status(403).json({
        message: 'Account creation is not available.',
      });
    }

    const userExists = await User.findOne({ email: normalizedEmail });

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Generate OTP
    const otp = generateOtp();

    const user = await User.create({
      name,
      username: username || name.toLowerCase().replace(/\s+/g, ''),
      phone: phone || '',
      email: normalizedEmail,
      password,
      role: role || 'user',
      otp,
      otpExpires: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    });

    if (user) {
      // Send OTP email
      try {
        await sendOtpEmail(normalizedEmail, otp);
      } catch (emailErr) {
        console.error('OTP email failed:', emailErr.message);
        // Don't fail registration if email fails — user can resend
      }

      res.status(201).json({
        success: true,
        message: 'Account created. Check your email for verification code.',
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = normalizeEmailAddress(email);

  if (!normalizedEmail || !isValidEmailFormat(normalizedEmail)) {
    logAuthEvent('auth.login.denied', req, { reason: 'invalid_email_format' }, 'warn');
    return res.status(400).json({ message: 'Please enter a valid email address' });
  }

  if (typeof password !== 'string' || !password.trim()) {
    logAuthEvent('auth.login.denied', req, { reason: 'missing_password' }, 'warn');
    return res.status(400).json({ message: 'Password is required' });
  }

  try {
    const user = await User.findOne({ email: normalizedEmail });

    if (user && (await user.matchPassword(password))) {
      const token = await issueSessionToken(user, req);
      logAuthEvent('auth.login.success', req, { userId: String(user._id), role: user.role });
      const { avatar } = await mergeCreatorPresentation(user);
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar,
        countryOfResidence: user.countryOfResidence,
        token,
      });
      return;
    }

    // Fallback: allow AdminManagement credentials to log in via shared auth.
    const admin = await Admin.findOne({ email: normalizedEmail });
    if (!admin || admin.status !== 'active') {
      logAuthEvent('auth.login.denied', req, { reason: 'invalid_credentials' }, 'warn');
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isAdminPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isAdminPasswordValid) {
      logAuthEvent('auth.login.denied', req, { reason: 'invalid_credentials' }, 'warn');
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    let linkedUser = await User.findOne({ email: normalizedEmail });
    if (!linkedUser) {
      const baseUsername = (admin.username || normalizedEmail.split('@')[0] || 'admin')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, 24) || 'admin';

      let username = baseUsername;
      let usernameSuffix = 0;
      while (await User.findOne({ username })) {
        usernameSuffix += 1;
        username = `${baseUsername}_${usernameSuffix}`.slice(0, 30);
      }

      let phone = `9${String(Date.now()).slice(-9)}`;
      let phoneSuffix = 0;
      while (await User.findOne({ phone })) {
        phoneSuffix += 1;
        phone = `9${String(Date.now() + phoneSuffix).slice(-9)}`;
      }

      linkedUser = await User.create({
        name: admin.name,
        username,
        phone,
        email: normalizedEmail,
        password,
        role: 'admin',
        isVerified: true,
      });
    } else if (linkedUser.role !== 'admin') {
      linkedUser.role = 'admin';
      await linkedUser.save();
    }

    const token = await issueSessionToken(linkedUser, req);
    logAuthEvent('auth.login.success', req, { userId: String(linkedUser._id), role: linkedUser.role });

    const { avatar } = await mergeCreatorPresentation(linkedUser);

    return res.json({
      _id: linkedUser._id,
      name: linkedUser.name,
      email: linkedUser.email,
      role: linkedUser.role,
      avatar,
      countryOfResidence: linkedUser.countryOfResidence,
      token,
    });
  } catch (error) {
    logAuthEvent('auth.login.error', req, { reason: error.message }, 'error');
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user profile (example protected route)
const getUserProfile = async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  const { avatar, bio } = await mergeCreatorPresentation(user);

  res.json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar,
    bio,
    countryOfResidence: user.countryOfResidence,
  });
};

// @desc    Get deterministic conversation encryption key
// @route   GET /api/auth/conversation-key/:conversationId
// @access  Private
const getConversationKey = async (req, res) => {
  try {
    const secret = process.env.CONVERSATION_ENCRYPTION_SECRET;
    if (!secret) {
      return res.status(500).json({ message: 'Conversation encryption secret is not configured' });
    }

    const key = crypto
      .createHmac('sha256', secret)
      .update(req.params.conversationId)
      .digest('hex');

    res.json({ key });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Send forgot password email
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = normalizeEmailAddress(email);

  if (!normalizedEmail) {
    return res.status(400).json({ message: 'Email is required' });
  }

  if (!isValidEmailFormat(normalizedEmail)) {
    return res.status(400).json({ message: 'Please enter a valid email address' });
  }

  try {
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ message: 'No account found with this email' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000;
    await user.save({ validateBeforeSave: false });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            }
          : undefined,
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@renown.app',
      to: user.email,
      subject: 'Reset your Renown password',
      text: `You requested a password reset. Use this link to continue: ${resetLink}`,
      html: `<p>You requested a password reset.</p><p>Use this link to continue:</p><p><a href="${resetLink}">${resetLink}</a></p>`,
    });

    res.json({ message: 'Password reset link sent to your email' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Reset password using token
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  const hasValidTokenFormat = /^[a-f0-9]{64}$/i.test(normalizedToken);

  if (!normalizedToken || !newPassword) {
    return res.status(400).json({ message: 'Token and new password are required' });
  }

  if (!hasValidTokenFormat) {
    return res.status(400).json({ message: 'Invalid reset token format' });
  }

  if (typeof newPassword !== 'string' || !newPassword.trim()) {
    return res.status(400).json({ message: 'New password is required' });
  }

  try {
    const { minPasswordLength } = await getRuntimeSecuritySettings();
    if (String(newPassword).length < minPasswordLength) {
      return res
        .status(400)
        .json({ message: `Password must be at least ${minPasswordLength} characters long` });
    }

    const user = await User.findOne({
      resetPasswordToken: normalizedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await User.findByIdAndUpdate(user._id, {
      $set: { password: hashedPassword },
      $unset: { resetPasswordToken: 1, resetPasswordExpires: 1 },
    });

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Request OTP (resend)
// @route   POST /api/auth/request-otp
// @access  Public
const requestOtp = async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = normalizeEmailAddress(email);

  if (!isValidEmailFormat(normalizedEmail)) {
    return res.status(400).json({ message: 'Please enter a valid email address' });
  }

  try {
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.isVerified) {
      return res.json({ success: true, message: 'Email already verified' });
    }

    const otp = generateOtp();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    try {
      await sendOtpEmail(normalizedEmail, otp);
    } catch (emailErr) {
      console.error('OTP email failed:', emailErr.message);
      return res.status(500).json({ message: 'Failed to send OTP email' });
    }

    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;
  const normalizedEmail = normalizeEmailAddress(email);

  if (!isValidEmailFormat(normalizedEmail)) {
    return res.status(400).json({ message: 'Please enter a valid email address' });
  }

  try {
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check OTP
    if (!user.otp || user.otp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Check expiry
    if (user.otpExpires && user.otpExpires < new Date()) {
      return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
    }

    // Mark as verified, clear OTP fields
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save({ validateBeforeSave: false });

    // If creator, create creator profile
    if (user.role === 'creator') {
      const existingCreator = await Creator.findOne({ userId: user._id.toString() });
      if (!existingCreator) {
        await Creator.create({
          userId: user._id.toString(),
          name: user.name,
          username: user.name.toLowerCase().replace(/\s+/g, ''),
        });
      }
    }

    const token = await issueSessionToken(user, req);

    const { avatar, bio } = await mergeCreatorPresentation(user);

    res.json({
      success: true,
      message: 'Email verified successfully',
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar,
        bio,
        countryOfResidence: user.countryOfResidence,
        token,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get runtime security policy
// @route   GET /api/auth/security-config
// @access  Public
const getSecurityConfig = async (req, res) => {
  try {
    const { sessionTimeout, minPasswordLength } = await getRuntimeSecuritySettings();
    res.json({ sessionTimeout, minPasswordLength });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get legal documents configured by admin
// @route   GET /api/auth/legal-documents
// @access  Public
const getLegalDocuments = async (req, res) => {
  try {
    const settings = await AppSetting.findOne()
      .select('termsOfService privacyPolicy updatedAt')
      .lean();

    const termsOfService =
      typeof settings?.termsOfService === 'string' && settings.termsOfService.trim().length > 0
        ? settings.termsOfService
        : DEFAULT_TERMS_OF_SERVICE;

    const privacyPolicy =
      typeof settings?.privacyPolicy === 'string' && settings.privacyPolicy.trim().length > 0
        ? settings.privacyPolicy
        : DEFAULT_PRIVACY_POLICY;

    res.json({
      termsOfService,
      privacyPolicy,
      updatedAt: settings?.updatedAt || null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Set user role (after verification)
// @route   PATCH /api/auth/set-role
// @access  Private
const setRole = async (req, res) => {
  const { role } = req.body;

  if (!['user', 'creator'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role. Must be user or creator.' });
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.role = role;
    await user.save({ validateBeforeSave: false });

    // If creator, create creator profile
    if (role === 'creator') {
      const existingCreator = await Creator.findOne({ userId: user._id.toString() });
      if (!existingCreator) {
        await Creator.create({
          userId: user._id.toString(),
          name: user.name,
          username: user.username || user.name.toLowerCase().replace(/\s+/g, ''),
        });
      }
    }

    const token = await issueSessionToken(user, req);

    const { avatar, bio } = await mergeCreatorPresentation(user);

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar,
        bio,
        countryOfResidence: user.countryOfResidence,
        token,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  checkEmailEligibility,
  registerUser,
  loginUser,
  getUserProfile,
  getConversationKey,
  forgotPassword,
  resetPassword,
  requestOtp,
  verifyOtp,
  setRole,
  getSecurityConfig,
  getLegalDocuments,
};
