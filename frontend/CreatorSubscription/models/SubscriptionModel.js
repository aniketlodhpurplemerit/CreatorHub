const { query } = require('../../../backend/db/pool');
const { newObjectId } = require('../../../backend/utils/objectId');
const Creator = require('../../../backend/models/Creator');

function normalizeEnterpriseDetails(raw) {
  const ed = raw && typeof raw === 'object' ? raw : {};
  return {
    agencyName: ed.agencyName || '',
    gstin: ed.gstin || '',
    address: ed.address || '',
    email: ed.email || '',
    managerName: ed.managerName || '',
    phone: ed.phone || '',
    submittedAt: ed.submittedAt ? new Date(ed.submittedAt) : null,
    approvedAt: ed.approvedAt ? new Date(ed.approvedAt) : null,
    approvedBy: ed.approvedBy ? String(ed.approvedBy) : null,
    notes: ed.notes || '',
  };
}

function fromRow(row) {
  if (!row) return null;
  let ed = row.enterprise_details;
  if (typeof ed === 'string') {
    try {
      ed = JSON.parse(ed);
    } catch {
      ed = {};
    }
  }
  return {
    id: row.id,
    _id: row.id,
    creatorId: row.creator_id,
    plan: row.plan,
    status: row.status,
    billingCycle: row.billing_cycle,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    proActivatedAt: row.pro_activated_at,
    enterpriseDetails: normalizeEnterpriseDetails(ed),
    platformFeePercent: row.platform_fee_percent,
    hasSeenOnboarding: row.has_seen_onboarding,
    isBackfilled: row.is_backfilled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function creatorIdForSql(p) {
  const c = p.creatorId;
  if (c && typeof c === 'object') return String(c._id ?? c.id ?? '');
  return String(c);
}

async function persistSubscription(p) {
  await query(
    `UPDATE creator_subscriptions SET
      creator_id=$2, plan=$3, status=$4, billing_cycle=$5, current_period_start=$6, current_period_end=$7,
      pro_activated_at=$8, enterprise_details=$9::jsonb, platform_fee_percent=$10, has_seen_onboarding=$11,
      is_backfilled=$12, updated_at=now()
     WHERE id=$1`,
    [
      p.id,
      creatorIdForSql(p),
      p.plan,
      p.status,
      p.billingCycle,
      p.currentPeriodStart || null,
      p.currentPeriodEnd || null,
      p.proActivatedAt || null,
      JSON.stringify(p.enterpriseDetails || {}),
      p.platformFeePercent ?? 15,
      Boolean(p.hasSeenOnboarding),
      Boolean(p.isBackfilled),
    ]
  );
}

function hydrate(plain, forLean) {
  if (!plain) return null;
  if (forLean) return { ...plain, _id: plain.id };
  const o = { ...plain, _id: plain.id };
  o.save = async () => persistSubscription(o);
  return o;
}

function buildWhere(filter, params) {
  const parts = [];
  let i = params.length + 1;
  if (filter._id) {
    parts.push(`id = $${i}`);
    params.push(String(filter._id));
    i += 1;
  }
  if (filter.creatorId) {
    parts.push(`creator_id = $${i}`);
    params.push(String(filter.creatorId));
    i += 1;
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function applySelect(plain, selectStr) {
  if (!selectStr) return plain;
  const fields = selectStr.split(/\s+/).filter(Boolean);
  const pick = fields.filter((f) => !f.startsWith('-'));
  if (!pick.length) return { ...plain };
  const o = { _id: plain.id, id: plain.id };
  pick.forEach((k) => {
    if (k === '_id' || k === 'id') return;
    if (plain[k] !== undefined) o[k] = plain[k];
  });
  return o;
}

function createChain(filter, multi) {
  const state = {
    filter: filter || {},
    multi,
    _select: null,
    _lean: false,
    _populate: null,
  };
  const chain = {
    select(s) {
      state._select = s;
      return chain;
    },
    lean() {
      state._lean = true;
      return chain;
    },
    populate(path) {
      state._populate = typeof path === 'string' ? { path } : path;
      return chain;
    },
    async exec() {
      const params = [];
      const w = buildWhere(state.filter, params);
      const lim = state.multi ? '' : ' LIMIT 1';
      const res = await query(`SELECT * FROM creator_subscriptions WHERE ${w}${lim}`, params);
      const rows = res.rows.map((r) => fromRow(r));

      const finish = async (plain) => {
        if (!plain) return null;
        let p = plain;
        if (state._populate?.path === 'creatorId' && p.creatorId) {
          const cdoc = await Creator.findById(String(p.creatorId)).lean().exec();
          p = { ...p, creatorId: cdoc };
        }
        p = applySelect(p, state._select);
        return hydrate(p, state._lean);
      };

      if (state.multi) {
        return Promise.all(rows.map((r) => finish(r)));
      }
      return finish(rows[0] || null);
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

const Subscription = {
  findOne(filter) {
    return createChain(filter, false);
  },
  findById(id) {
    return createChain({ _id: String(id) }, false);
  },
  find(filter) {
    return createChain(filter, true);
  },
  async countDocuments(filter) {
    const params = [];
    const w = buildWhere(filter || {}, params);
    const r = await query(`SELECT COUNT(*)::int AS c FROM creator_subscriptions WHERE ${w}`, params);
    return r.rows[0].c;
  },
  async create(data) {
    const id = newObjectId();
    const ed = normalizeEnterpriseDetails(data.enterpriseDetails);
    await query(
      `INSERT INTO creator_subscriptions (
        id, creator_id, plan, status, billing_cycle, current_period_start, current_period_end,
        pro_activated_at, enterprise_details, platform_fee_percent, has_seen_onboarding, is_backfilled
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)`,
      [
        id,
        String(data.creatorId),
        data.plan || 'free',
        data.status || 'active',
        data.billingCycle || 'forever',
        data.currentPeriodStart || null,
        data.currentPeriodEnd || null,
        data.proActivatedAt || null,
        JSON.stringify(ed),
        data.platformFeePercent ?? 15,
        data.hasSeenOnboarding ?? false,
        data.isBackfilled ?? false,
      ]
    );
    return hydrate(fromRow((await query('SELECT * FROM creator_subscriptions WHERE id=$1', [id])).rows[0]), false);
  },
};

module.exports = Subscription;
