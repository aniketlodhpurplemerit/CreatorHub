const { query } = require('../../../backend/db/pool');
const { newObjectId } = require('../../../backend/utils/objectId');

function fromRow(row) {
  if (!row) return null;
  let meta = row.metadata;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      meta = {};
    }
  }
  if (!meta || typeof meta !== 'object') meta = {};
  return {
    id: row.id,
    _id: row.id,
    adminId: row.admin_id,
    action: row.action,
    targetId: row.target_id,
    targetType: row.target_type,
    reason: row.reason,
    metadata: meta,
    timestamp: row.timestamp,
  };
}

function buildWhere(filter, params) {
  const parts = [];
  let i = params.length + 1;
  if (filter.adminId) {
    parts.push(`admin_id = $${i}`);
    params.push(String(filter.adminId));
    i += 1;
  }
  if (filter.action) {
    parts.push(`action = $${i}`);
    params.push(filter.action);
    i += 1;
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function createFindChain(filter) {
  const state = { filter: filter || {}, _sort: null, _skip: 0, _limit: null, _lean: false };
  const chain = {
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
    lean() {
      state._lean = true;
      return chain;
    },
    async exec() {
      const params = [];
      const w = buildWhere(state.filter, params);
      let order = 'ORDER BY timestamp DESC';
      if (state._sort && state._sort.timestamp) {
        order = `ORDER BY timestamp ${state._sort.timestamp === 1 ? 'ASC' : 'DESC'}`;
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
      }
      const res = await query(`SELECT * FROM moderation_admin_logs WHERE ${w} ${order}${lim}`, p);
      return res.rows.map((row) => {
        const pl = fromRow(row);
        return state._lean ? { ...pl, _id: pl.id } : pl;
      });
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

const AdminLog = {
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO moderation_admin_logs (id, admin_id, action, target_id, target_type, reason, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        id,
        String(data.adminId),
        data.action,
        String(data.targetId),
        data.targetType || 'unknown',
        data.reason || '',
        JSON.stringify(data.metadata || {}),
      ]
    );
    return fromRow((await query('SELECT * FROM moderation_admin_logs WHERE id=$1', [id])).rows[0]);
  },
  find(filter) {
    return createFindChain(filter);
  },
  async countDocuments(filter) {
    const params = [];
    const w = buildWhere(filter || {}, params);
    const r = await query(`SELECT COUNT(*)::int AS c FROM moderation_admin_logs WHERE ${w}`, params);
    return r.rows[0].c;
  },
};

module.exports = AdminLog;
