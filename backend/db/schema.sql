-- Neon / PostgreSQL schema (Mongo-compatible string ids)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  avatar TEXT NOT NULL DEFAULT '',
  country_of_residence TEXT NOT NULL DEFAULT 'All courses',
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  bio TEXT NOT NULL DEFAULT '',
  reset_password_token TEXT NOT NULL DEFAULT '',
  reset_password_expires TIMESTAMPTZ,
  following TEXT[] NOT NULL DEFAULT '{}',
  favorites TEXT[] NOT NULL DEFAULT '{}',
  memberships TEXT[] NOT NULL DEFAULT '{}',
  last_login TIMESTAMPTZ NOT NULL DEFAULT now(),
  sessions JSONB NOT NULL DEFAULT '[]',
  otp TEXT,
  otp_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS creator_subscriptions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  billing_cycle TEXT NOT NULL DEFAULT 'forever',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  pro_activated_at TIMESTAMPTZ,
  enterprise_details JSONB NOT NULL DEFAULT '{}',
  platform_fee_percent DOUBLE PRECISION NOT NULL DEFAULT 15,
  has_seen_onboarding BOOLEAN NOT NULL DEFAULT FALSE,
  is_backfilled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Alex Morgan',
  username TEXT NOT NULL DEFAULT 'alexcreates',
  avatar TEXT NOT NULL DEFAULT 'https://i.pravatar.cc/150',
  banner TEXT NOT NULL DEFAULT '/assets/creator/banner.png',
  bio TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Art and Design',
  status TEXT NOT NULL DEFAULT 'active',
  social_links JSONB NOT NULL DEFAULT '{}',
  followers TEXT[] NOT NULL DEFAULT '{}',
  subscribers TEXT[] NOT NULL DEFAULT '{}',
  earnings JSONB NOT NULL DEFAULT '{"total":0,"thisMonth":0}',
  subscription_id TEXT,
  subscription_price DOUBLE PRECISION NOT NULL DEFAULT 4.99,
  payout_settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creators_user_id ON creators(user_id);
CREATE INDEX IF NOT EXISTS idx_creators_status ON creators(status);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  media_url TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL,
  is_exclusive BOOLEAN NOT NULL DEFAULT FALSE,
  access_tier TEXT NOT NULL DEFAULT 'everyone',
  creator_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  policy_violation_locked BOOLEAN NOT NULL DEFAULT FALSE,
  policy_violation_label TEXT NOT NULL DEFAULT '',
  policy_violation_locked_at TIMESTAMPTZ,
  policy_violation_locked_by TEXT,
  category TEXT NOT NULL DEFAULT 'content',
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  purchased_users TEXT[] NOT NULL DEFAULT '{}',
  views INTEGER NOT NULL DEFAULT 0,
  unique_viewers TEXT[] NOT NULL DEFAULT '{}',
  likes INTEGER NOT NULL DEFAULT 0,
  dislikes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  revenue JSONB NOT NULL DEFAULT '{"total":0,"breakdown":{"subscriptionPay":0,"directPurchase":0}}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_creator ON posts(creator_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  media_url TEXT,
  thumbnail_url TEXT NOT NULL DEFAULT '',
  media_type TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  is_edited BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at TIMESTAMPTZ,
  reactions JSONB NOT NULL DEFAULT '[]',
  encrypted_text TEXT,
  nonce TEXT,
  is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'sent',
  reply_to JSONB,
  hidden_for TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  sender TEXT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  related_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient);

CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  parent_comment_id TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  content TEXT NOT NULL,
  rating INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, creator_id)
);

CREATE TABLE IF NOT EXISTS review_replies (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  parent_reply_id TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  blocker TEXT NOT NULL,
  blocked TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker, blocked)
);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL,
  type TEXT NOT NULL,
  reference_id TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet ON wallet_transactions(wallet_id);

CREATE TABLE IF NOT EXISTS wallet_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  card_hash TEXT NOT NULL UNIQUE,
  last4 TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  email TEXT NOT NULL,
  expiry_month TEXT NOT NULL,
  expiry_year TEXT NOT NULL,
  billing JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_cards_user ON wallet_cards(user_id);

CREATE TABLE IF NOT EXISTS security_bans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  banned_by TEXT NOT NULL,
  report_id TEXT,
  reason TEXT NOT NULL,
  ban_type TEXT NOT NULL,
  start_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_date TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  lifted_by TEXT,
  lifted_at TIMESTAMPTZ,
  lift_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_bans_user_active ON security_bans(user_id, is_active);

CREATE TABLE IF NOT EXISTS content_reports (
  id TEXT PRIMARY KEY,
  reported_by TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  action_taken TEXT NOT NULL DEFAULT 'none',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reported_by, post_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reports_post ON content_reports(post_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status);

CREATE TABLE IF NOT EXISTS appeals (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  ban_id TEXT,
  appeal_type TEXT NOT NULL DEFAULT 'ban',
  post_ids TEXT[] NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  supporting_info TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]',
  support_ticket_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appeals_creator ON appeals(creator_id);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status);

CREATE TABLE IF NOT EXISTS livestreams (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  thumbnail TEXT NOT NULL DEFAULT 'https://via.placeholder.com/600x400',
  audience TEXT NOT NULL DEFAULT 'All members',
  scheduled_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'scheduled',
  creator_id TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration DOUBLE PRECISION NOT NULL DEFAULT 0,
  peak_viewers INTEGER NOT NULL DEFAULT 0,
  recording_url TEXT NOT NULL DEFAULT '',
  settings JSONB NOT NULL DEFAULT '{"displayChat":true,"notificationsEnabled":true,"autoModeration":true}',
  viewer_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS live_chat_messages (
  id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  is_moderated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_chat_stream ON live_chat_messages(stream_id);

CREATE TABLE IF NOT EXISTS moderation_reports (
  id TEXT PRIMARY KEY,
  reported_by TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  additional_reporters TEXT[] NOT NULL DEFAULT '{}',
  resolved_by TEXT,
  resolution TEXT NOT NULL DEFAULT '',
  duplicate_of TEXT,
  target_owner_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mod_reports_target ON moderation_reports(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_mod_reports_status ON moderation_reports(status);

CREATE TABLE IF NOT EXISTS moderation_bans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  duration TEXT NOT NULL,
  reason TEXT NOT NULL,
  issued_by TEXT,
  related_report_id TEXT,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  appeal_status TEXT NOT NULL DEFAULT 'none',
  appeal_note TEXT NOT NULL DEFAULT '',
  appeal_reviewed_by TEXT,
  notified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mod_bans_user ON moderation_bans(user_id, is_active);

CREATE TABLE IF NOT EXISTS moderation_admin_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'unknown',
  reason TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mod_admin_logs_ts ON moderation_admin_logs(timestamp DESC);

CREATE TABLE IF NOT EXISTS moderation_flagged_identities (
  id TEXT PRIMARY KEY,
  email TEXT,
  phone TEXT,
  username TEXT,
  device_fingerprints TEXT[] NOT NULL DEFAULT '{}',
  ip_addresses TEXT[] NOT NULL DEFAULT '{}',
  related_ban_id TEXT NOT NULL,
  flagged_by TEXT NOT NULL,
  flagged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS moderation_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mod_notif_user ON moderation_notifications(user_id);

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  avatar_initials TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '',
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_ticket_counters (
  key TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL UNIQUE,
  report_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'user_report',
  submitted_by TEXT,
  submitter_role TEXT,
  tag TEXT,
  heading TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]',
  admin_response TEXT,
  responded_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  assigned_to TEXT,
  assigned_by TEXT,
  assigned_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT NOT NULL DEFAULT '',
  reporter_count INTEGER NOT NULL DEFAULT 1,
  escalated_to TEXT,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, updated_at DESC);

-- One support ticket per moderation report (when report-linked)
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_tickets_report_id_unique
  ON support_tickets (report_id)
  WHERE report_id IS NOT NULL AND report_id <> '';

CREATE TABLE IF NOT EXISTS legacy_app_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'Active',
  avatar TEXT,
  joined TEXT,
  password TEXT
);

CREATE TABLE IF NOT EXISTS legacy_app_reports (
  id TEXT PRIMARY KEY,
  title TEXT,
  creator TEXT,
  reason TEXT,
  status TEXT,
  img TEXT
);

CREATE TABLE IF NOT EXISTS legacy_app_transactions (
  id TEXT PRIMARY KEY,
  txn_id TEXT,
  user_ref TEXT,
  initial TEXT,
  amount TEXT,
  status TEXT,
  date TEXT
);

CREATE TABLE IF NOT EXISTS legacy_app_tickets (
  id TEXT PRIMARY KEY,
  ticket_id TEXT,
  user_ref TEXT,
  issue TEXT,
  ticket_desc TEXT,
  priority TEXT,
  assigned TEXT,
  updated TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY DEFAULT 'main',
  platform_name TEXT NOT NULL DEFAULT 'Nexus Enterprise',
  platform_url TEXT NOT NULL DEFAULT 'https://admin.nexus-ent.com',
  default_language TEXT NOT NULL DEFAULT 'English (US)',
  timezone TEXT NOT NULL DEFAULT '(GMT+05:30) India Standard Time',
  terms_of_service TEXT NOT NULL,
  privacy_policy TEXT NOT NULL,
  commission DOUBLE PRECISION NOT NULL DEFAULT 10,
  transaction_fee DOUBLE PRECISION NOT NULL DEFAULT 2,
  min_payout DOUBLE PRECISION NOT NULL DEFAULT 1000,
  currency TEXT NOT NULL DEFAULT 'INR',
  razorpay_connected BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_connected BOOLEAN NOT NULL DEFAULT FALSE,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  bot_protection_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  session_timeout TEXT NOT NULL DEFAULT '30 Minutes',
  min_password_length INTEGER NOT NULL DEFAULT 12,
  blocked_email_domains TEXT[] NOT NULL DEFAULT '{}',
  toggles JSONB NOT NULL DEFAULT '{}',
  subscription_plans JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_dashboard (
  id TEXT PRIMARY KEY DEFAULT 'main',
  payload JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id, terms_of_service, privacy_policy)
VALUES (
  'main',
  '## Platform Usage Rules\n1. Users must be 18+...\n2. All content must comply with global standards...',
  '## Data Privacy\nWe value your data security. This document outlines how we process information...'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_dashboard (id, payload)
VALUES ('main', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO support_ticket_counters (key, seq)
VALUES ('ticket', 0)
ON CONFLICT (key) DO NOTHING;
