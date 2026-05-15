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
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    metadata: meta,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

function buildWhere(filter, params) {
  const parts = [];
  let i = params.length + 1;
  if (filter.userId) {
    parts.push(`user_id = $${i}`);
    params.push(String(filter.userId));
    i += 1;
  }
  if (filter.isRead === false) {
    parts.push('is_read = FALSE');
  }
  if (filter._id) {
    parts.push(`id = $${i}`);
    params.push(String(filter._id));
    i += 1;
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function createFindChain(filter) {
  const state = { filter: filter || {}, _sort: null, _lean: false };
  const chain = {
    sort(spec) {
      state._sort = spec;
      return chain;
    },
    lean() {
      state._lean = true;
      return chain;
    },
    async exec() {
      const params = [];
      const w = buildWhere(state.filter, params);
      let order = 'ORDER BY created_at DESC';
      if (state._sort && state._sort.createdAt) {
        order = `ORDER BY created_at ${state._sort.createdAt === 1 ? 'ASC' : 'DESC'}`;
      }
      const res = await query(`SELECT * FROM moderation_notifications WHERE ${w} ${order}`, params);
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

const ModerationNotification = {
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO moderation_notifications (id, user_id, type, title, body, metadata, is_read)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        id,
        String(data.userId),
        data.type,
        data.title || '',
        data.body || '',
        JSON.stringify(data.metadata || {}),
        data.isRead ?? false,
      ]
    );
    return fromRow((await query('SELECT * FROM moderation_notifications WHERE id=$1', [id])).rows[0]);
  },
  find(filter) {
    return createFindChain(filter);
  },
  async findOneAndUpdate(filter, update) {
    await query(
      `UPDATE moderation_notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2`,
      [String(filter._id), String(filter.userId)]
    );
    return null;
  },
};

module.exports = ModerationNotification;
