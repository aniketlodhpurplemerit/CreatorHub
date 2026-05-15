const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function mapSettingsRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    platformName: row.platform_name,
    platformUrl: row.platform_url,
    defaultLanguage: row.default_language,
    timezone: row.timezone,
    termsOfService: row.terms_of_service,
    privacyPolicy: row.privacy_policy,
    commission: row.commission,
    transactionFee: row.transaction_fee,
    minPayout: row.min_payout,
    currency: row.currency,
    razorpayConnected: row.razorpay_connected,
    stripeConnected: row.stripe_connected,
    twoFactorEnabled: row.two_factor_enabled,
    botProtectionEnabled: row.bot_protection_enabled,
    sessionTimeout: row.session_timeout,
    minPasswordLength: row.min_password_length,
    blockedEmailDomains: row.blocked_email_domains || [],
    toggles: row.toggles || {},
    subscriptionPlans: row.subscription_plans || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function persistSettings(plain) {
  await query(
    `UPDATE app_settings SET
      platform_name=$2, platform_url=$3, default_language=$4, timezone=$5,
      terms_of_service=$6, privacy_policy=$7, commission=$8, transaction_fee=$9, min_payout=$10,
      currency=$11, razorpay_connected=$12, stripe_connected=$13, two_factor_enabled=$14,
      bot_protection_enabled=$15, session_timeout=$16, min_password_length=$17,
      blocked_email_domains=$18::text[], toggles=$19::jsonb, subscription_plans=$20::jsonb, updated_at=now()
    WHERE id=$1`,
    [
      plain.id || 'main',
      plain.platformName,
      plain.platformUrl,
      plain.defaultLanguage,
      plain.timezone,
      plain.termsOfService,
      plain.privacyPolicy,
      plain.commission,
      plain.transactionFee,
      plain.minPayout,
      plain.currency,
      !!plain.razorpayConnected,
      !!plain.stripeConnected,
      !!plain.twoFactorEnabled,
      !!plain.botProtectionEnabled,
      plain.sessionTimeout,
      plain.minPasswordLength,
      Array.isArray(plain.blockedEmailDomains) ? plain.blockedEmailDomains : [],
      JSON.stringify(plain.toggles || {}),
      JSON.stringify(plain.subscriptionPlans || []),
    ]
  );
}

function hydrateSettings(plain) {
  if (!plain) return null;
  plain._id = plain.id;
  plain.save = async () => persistSettings(plain);
  plain.toObject = () => ({ ...plain, _id: plain.id });
  return plain;
}

const AppSetting = {
  buildDefault() {
    const defaults = {
      id: 'main',
      platformName: 'Nexus Enterprise',
      platformUrl: 'https://admin.nexus-ent.com',
      defaultLanguage: 'English (US)',
      timezone: '(GMT+05:30) India Standard Time',
      termsOfService:
        '## Platform Usage Rules\n1. Users must be 18+...\n2. All content must comply with global standards...',
      privacyPolicy:
        '## Data Privacy\nWe value your data security. This document outlines how we process information...',
      commission: 10,
      transactionFee: 2,
      minPayout: 1000,
      currency: 'INR',
      razorpayConnected: false,
      stripeConnected: false,
      twoFactorEnabled: true,
      botProtectionEnabled: false,
      sessionTimeout: '30 Minutes',
      minPasswordLength: 12,
      blockedEmailDomains: [],
      toggles: {},
      subscriptionPlans: [],
    };
    return hydrateSettings({ ...defaults });
  },
  findOne() {
    const chain = {
      _lean: false,
      select() {
        return chain;
      },
      lean() {
        chain._lean = true;
        return chain;
      },
      async exec() {
        const row = (await query(`SELECT * FROM app_settings WHERE id = 'main'`)).rows[0];
        const pl = mapSettingsRow(row);
        if (!pl) return null;
        return chain._lean ? { ...pl, toObject: () => ({ ...pl }) } : hydrateSettings(pl);
      },
      then(onF, onR) {
        return chain.exec().then(onF, onR);
      },
      catch(onR) {
        return chain.exec().catch(onR);
      },
    };
    return chain;
  },
  findOneAndUpdate(_filter, update, opts) {
    return (async () => {
      let row = (await query(`SELECT * FROM app_settings WHERE id = 'main'`)).rows[0];
      let pl = mapSettingsRow(row);
      if (!pl) {
        pl = AppSetting.buildDefault();
        await pl.save();
        row = (await query(`SELECT * FROM app_settings WHERE id = 'main'`)).rows[0];
        pl = mapSettingsRow(row);
      }
      const merged = { ...pl, ...update };
      await persistSettings(merged);
      const fresh = mapSettingsRow((await query(`SELECT * FROM app_settings WHERE id = 'main'`)).rows[0]);
      return opts?.new ? hydrateSettings(fresh) : hydrateSettings(fresh);
    })();
  },
};

function mapLegacyUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    _id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    status: r.status,
    avatar: r.avatar,
    joined: r.joined,
    password: r.password,
  };
}

const AppUser = {
  find() {
    return {
      async exec() {
        const res = await query('SELECT * FROM legacy_app_users ORDER BY id');
        return res.rows.map((r) => mapLegacyUser(r));
      },
      then(onF, onR) {
        return this.exec().then(onF, onR);
      },
    };
  },
  findById(id) {
    return {
      async exec() {
        const r = (await query('SELECT * FROM legacy_app_users WHERE id = $1', [String(id)])).rows[0];
        return r ? mapLegacyUser(r) : null;
      },
      then(onF, onR) {
        return this.exec().then(onF, onR);
      },
    };
  },
  findByIdAndUpdate(id, data, opts) {
    return (async () => {
      await query(
        `UPDATE legacy_app_users SET name=$2, email=$3, role=$4, status=$5, password=COALESCE($6, password) WHERE id=$1`,
        [String(id), data.name, data.email, data.role, data.status, data.password || null]
      );
      const r = (await query('SELECT * FROM legacy_app_users WHERE id = $1', [String(id)])).rows[0];
      return mapLegacyUser(r);
    })();
  },
  async findByIdAndDelete(id) {
    await query('DELETE FROM legacy_app_users WHERE id = $1', [String(id)]);
  },
};

const AppReport = {
  find() {
    return {
      async exec() {
        const res = await query('SELECT * FROM legacy_app_reports');
        return res.rows.map((r) => ({
          _id: r.id,
          id: r.id,
          title: r.title,
          creator: r.creator,
          reason: r.reason,
          status: r.status,
          img: r.img,
        }));
      },
      then(onF, onR) {
        return this.exec().then(onF, onR);
      },
    };
  },
};

const AppTransaction = {
  find() {
    return {
      async exec() {
        const res = await query('SELECT * FROM legacy_app_transactions');
        return res.rows.map((r) => ({
          _id: r.id,
          id: r.id,
          txnId: r.txn_id,
          user: r.user_ref,
          initial: r.initial,
          amount: r.amount,
          status: r.status,
          date: r.date,
        }));
      },
      then(onF, onR) {
        return this.exec().then(onF, onR);
      },
    };
  },
};

const AppTicket = {
  find() {
    return {
      async exec() {
        const res = await query('SELECT * FROM legacy_app_tickets');
        return res.rows.map((r) => ({
          _id: r.id,
          id: r.id,
          ticketId: r.ticket_id,
          user: r.user_ref,
          issue: r.issue,
          desc: r.ticket_desc,
          priority: r.priority,
          assigned: r.assigned,
          updated: r.updated,
        }));
      },
      then(onF, onR) {
        return this.exec().then(onF, onR);
      },
    };
  },
};

const AppDashboard = {
  findOne() {
    return {
      async exec() {
        const r = (await query(`SELECT * FROM app_dashboard WHERE id = 'main'`)).rows[0];
        if (!r) return { payload: {}, toObject: () => ({}) };
        const payload = r.payload || {};
        const doc = { ...payload, _id: r.id, id: r.id };
        doc.save = async () => {
          await query(`UPDATE app_dashboard SET payload = $2::jsonb, updated_at = now() WHERE id = $1`, [
            'main',
            JSON.stringify(payload),
          ]);
        };
        doc.toObject = () => ({ ...payload });
        return doc;
      },
      then(onF, onR) {
        return this.exec().then(onF, onR);
      },
    };
  },
};

module.exports = { AppUser, AppReport, AppTransaction, AppTicket, AppSetting, AppDashboard };
