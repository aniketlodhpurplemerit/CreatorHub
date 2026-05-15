const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function decorateOidArray(initial) {
  const base = Array.isArray(initial) ? [...initial.map((x) => String(x))] : [];
  base.pull = function pullFn(id) {
    const s = String(id);
    const i = this.findIndex((x) => String(x) === s);
    if (i >= 0) this.splice(i, 1);
  };
  base.addToSet = function addToSetFn(id) {
    const s = String(id);
    if (!this.some((x) => String(x) === s)) this.push(s);
  };
  return base;
}

function fromRow(row) {
  if (!row) return null;
  let social = row.social_links;
  if (social && typeof social === 'string') {
    try {
      social = JSON.parse(social);
    } catch {
      social = {};
    }
  }
  if (!social || typeof social !== 'object') social = {};
  let earnings = row.earnings;
  if (earnings && typeof earnings === 'string') {
    try {
      earnings = JSON.parse(earnings);
    } catch {
      earnings = { total: 0, thisMonth: 0 };
    }
  }
  if (!earnings || typeof earnings !== 'object') earnings = { total: 0, thisMonth: 0 };
  let payout = row.payout_settings;
  if (payout && typeof payout === 'string') {
    try {
      payout = JSON.parse(payout);
    } catch {
      payout = {};
    }
  }
  if (!payout || typeof payout !== 'object') payout = {};
  return {
    id: row.id,
    _id: row.id,
    userId: row.user_id,
    name: row.name,
    username: row.username,
    avatar: row.avatar,
    banner: row.banner,
    bio: row.bio,
    category: row.category,
    status: row.status,
    socialLinks: {
      instagram: social.instagram ?? '',
      facebook: social.facebook ?? '',
      twitter: social.twitter ?? '',
      tiktok: social.tiktok ?? '',
    },
    followers: (row.followers || []).map(String),
    subscribers: (row.subscribers || []).map(String),
    earnings,
    subscriptionId: row.subscription_id,
    subscriptionPrice: Number(row.subscription_price) || 0,
    payoutSettings: payout,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function persistCreator(plain) {
  const social = plain.socialLinks || {};
  await query(
    `UPDATE creators SET
      user_id=$2, name=$3, username=$4, avatar=$5, banner=$6, bio=$7, category=$8, status=$9,
      social_links=$10::jsonb, followers=$11::text[], subscribers=$12::text[], earnings=$13::jsonb,
      subscription_id=$14, subscription_price=$15, payout_settings=$16::jsonb, updated_at=now()
    WHERE id=$1`,
    [
      plain.id,
      String(plain.userId),
      plain.name,
      plain.username,
      plain.avatar,
      plain.banner,
      plain.bio,
      plain.category,
      plain.status,
      JSON.stringify({
        instagram: social.instagram ?? '',
        facebook: social.facebook ?? '',
        twitter: social.twitter ?? '',
        tiktok: social.tiktok ?? '',
      }),
      (plain.followers || []).map(String),
      (plain.subscribers || []).map(String),
      JSON.stringify(plain.earnings || { total: 0, thisMonth: 0 }),
      plain.subscriptionId || null,
      plain.subscriptionPrice ?? 4.99,
      JSON.stringify(plain.payoutSettings || {}),
    ]
  );
}

function hydrate(plain, { lean = false } = {}) {
  if (!plain) return null;
  const base = { ...plain, _id: plain.id };
  if (lean) {
    return { ...base, toObject: () => ({ ...base }) };
  }
  const doc = {
    ...base,
    followers: decorateOidArray(plain.followers),
    subscribers: decorateOidArray(plain.subscribers),
    async save() {
      await persistCreator({
        ...plain,
        name: doc.name,
        username: doc.username,
        avatar: doc.avatar,
        banner: doc.banner,
        bio: doc.bio,
        category: doc.category,
        status: doc.status,
        socialLinks: doc.socialLinks,
        earnings: doc.earnings,
        subscriptionId: doc.subscriptionId,
        subscriptionPrice: doc.subscriptionPrice,
        payoutSettings: doc.payoutSettings,
        followers: [...doc.followers],
        subscribers: [...doc.subscribers],
      });
    },
    toObject() {
      return {
        ...plain,
        _id: plain.id,
        followers: [...doc.followers],
        subscribers: [...doc.subscribers],
      };
    },
  };
  return doc;
}

function buildWhere(filter, params) {
  const parts = [];
  let i = params.length + 1;
  if (filter.userId) {
    parts.push(`user_id = $${i}`);
    params.push(String(filter.userId));
    i += 1;
  }
  if (filter._id || filter.id) {
    parts.push(`id = $${i}`);
    params.push(String(filter._id || filter.id));
    i += 1;
  }
  if (filter.status) {
    parts.push(`status = $${i}`);
    params.push(filter.status);
    i += 1;
  }
  return { sql: parts.length ? parts.join(' AND ') : 'TRUE' };
}

function createQuery(filter, multi) {
  const state = { filter, multi, _select: null, _lean: false, _sort: null, _skip: 0, _limit: null, _populate: null };

  const chain = {
    select(s) {
      state._select = s;
      return chain;
    },
    lean() {
      state._lean = true;
      return chain;
    },
    sort(spec) {
      state._sort = spec;
      return chain;
    },
    skip(n) {
      state._skip = n;
      return chain;
    },
    limit(n) {
      state._limit = n;
      return chain;
    },
    populate(path, select) {
      state._populate = typeof path === 'string' ? { path, select } : path;
      return chain;
    },
    async exec() {
      const params = [];
      const { sql } = buildWhere(state.filter, params);
      let order = 'ORDER BY created_at DESC';
      if (state._sort) {
        const k = Object.keys(state._sort)[0];
        const dir = state._sort[k] === 1 ? 'ASC' : 'DESC';
        if (k === 'earnings.total') {
          order = `ORDER BY (earnings->>'total')::numeric ${dir}`;
        } else {
          const map = { createdAt: 'created_at' };
          order = `ORDER BY ${map[k] || k} ${dir}`;
        }
      }
      const p = [...params];
      let lim = '';
      if (state._skip) {
        lim += ` OFFSET $${p.length + 1}`;
        p.push(state._skip);
      }
      if (state._limit != null) {
        lim += ` LIMIT $${p.length + 1}`;
        p.push(state._limit);
      } else if (!state.multi) {
        lim += ` LIMIT $${p.length + 1}`;
        p.push(1);
      }
      const res = await query(`SELECT * FROM creators WHERE ${sql} ${order}${lim}`, p);
      const rows = res.rows;

      const applySelect = (pl) => {
        if (!state._select) return pl;
        const fields = state._select.split(/\s+/).filter(Boolean);
        const out = { id: pl.id, _id: pl.id };
        fields.forEach((f) => {
          if (f === '_id') return;
          if (pl[f] !== undefined) out[f] = pl[f];
        });
        return out;
      };

      const enrich = async (row) => {
        let pl = fromRow(row);
        pl = applySelect(pl);
        if (state._populate) {
          const User = require('./User');
          if (state._populate.path === 'subscribers' && Array.isArray(pl.subscribers)) {
            const ids = [...pl.subscribers].map(String);
            const users = [];
            for (const uid of ids) {
              const u = await User.findById(uid).select(state._populate.select || '').lean().exec();
              if (u) users.push(u);
            }
            pl.subscribers = users;
          }
          if (state._populate.path === 'subscriptionId' && pl.subscriptionId) {
            const r = await query('SELECT * FROM creator_subscriptions WHERE id = $1', [String(pl.subscriptionId)]);
            const srow = r.rows[0];
            if (srow) {
              pl.subscriptionId = {
                _id: srow.id,
                id: srow.id,
                creatorId: srow.creator_id,
                plan: srow.plan,
                status: srow.status,
                billingCycle: srow.billing_cycle,
                currentPeriodStart: srow.current_period_start,
                currentPeriodEnd: srow.current_period_end,
                proActivatedAt: srow.pro_activated_at,
                enterpriseDetails: srow.enterprise_details || {},
                platformFeePercent: srow.platform_fee_percent,
                hasSeenOnboarding: srow.has_seen_onboarding,
                isBackfilled: srow.is_backfilled,
                createdAt: srow.created_at,
                updatedAt: srow.updated_at,
              };
            }
          }
        }
        return hydrate(pl, { lean: state._lean });
      };

      if (multi) return Promise.all(rows.map((row) => enrich(row)));
      if (!rows[0]) return null;
      return enrich(rows[0]);
    },
    then(onF, onR) {
      return chain.exec().then(onF, onR);
    },
    catch(onR) {
      return chain.exec().catch(onR);
    },
  };
  return chain;
}

async function updateMany(filter, update) {
  const params = [];
  const { sql } = buildWhere(filter, params);
  if (update.$set && update.$set.status) {
    const r = await query(`UPDATE creators SET status = $${params.length + 1}, updated_at = now() WHERE ${sql}`, [
      ...params,
      update.$set.status,
    ]);
    return { modifiedCount: r.rowCount };
  }
  return { modifiedCount: 0 };
}

async function create(data) {
  const id = newObjectId();
  const social = data.socialLinks || {};
  await query(
    `INSERT INTO creators (
      id, user_id, name, username, avatar, banner, bio, category, status, social_links, followers, subscribers,
      earnings, subscription_id, subscription_price, payout_settings
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::text[],$12::text[],$13::jsonb,$14,$15,$16::jsonb)`,
    [
      id,
      String(data.userId),
      data.name || 'Alex Morgan',
      data.username || 'alexcreates',
      data.avatar || 'https://i.pravatar.cc/150',
      data.banner || '/assets/creator/banner.png',
      data.bio || '',
      data.category || 'Art and Design',
      data.status || 'active',
      JSON.stringify({
        instagram: social.instagram ?? '',
        facebook: social.facebook ?? '',
        twitter: social.twitter ?? '',
        tiktok: social.tiktok ?? '',
      }),
      (data.followers || []).map(String),
      (data.subscribers || []).map(String),
      JSON.stringify(data.earnings || { total: 0, thisMonth: 0 }),
      data.subscriptionId || null,
      data.subscriptionPrice ?? 4.99,
      JSON.stringify(data.payoutSettings || {}),
    ]
  );
  return hydrate(fromRow((await query('SELECT * FROM creators WHERE id = $1', [id])).rows[0]));
}

async function findByIdAndUpdate(id, update, opts = {}) {
  const row = (await query('SELECT * FROM creators WHERE id = $1', [String(id)])).rows[0];
  if (!row) return null;
  const plain = fromRow(row);
  if (update.$set) Object.assign(plain, update.$set);
  if (update.$inc) {
    plain.earnings = plain.earnings || { total: 0, thisMonth: 0 };
    if (update.$inc['earnings.total']) plain.earnings.total = (Number(plain.earnings.total) || 0) + update.$inc['earnings.total'];
    if (update.$inc['earnings.thisMonth']) {
      plain.earnings.thisMonth = (Number(plain.earnings.thisMonth) || 0) + update.$inc['earnings.thisMonth'];
    }
  }
  await persistCreator(plain);
  const fresh = fromRow((await query('SELECT * FROM creators WHERE id = $1', [String(id)])).rows[0]);
  return opts.new ? hydrate(fresh, { lean: false }) : hydrate(fresh, { lean: false });
}

const Creator = {
  find(filter = {}) {
    return createQuery(filter, true);
  },
  findById(id) {
    return createQuery({ _id: String(id) }, false);
  },
  findOne(filter) {
    return createQuery(filter || {}, false);
  },
  create,
  updateMany,
  findByIdAndUpdate,
};

module.exports = Creator;
