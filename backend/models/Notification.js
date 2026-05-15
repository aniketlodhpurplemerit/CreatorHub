const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    recipient: row.recipient,
    sender: row.sender,
    type: row.type,
    content: row.content,
    relatedId: row.related_id,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

function buildWhere(f, params) {
  const parts = [];
  let i = params.length + 1;
  if (f.recipient) {
    parts.push(`recipient = $${i}`);
    params.push(String(f.recipient));
    i += 1;
  }
  if (f.isRead === false) {
    parts.push(`is_read = false`);
  }
  if (f._id) {
    parts.push(`id = $${i}`);
    params.push(String(f._id));
    i += 1;
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function makeChain(filter, multi) {
  const st = { filter: filter || {}, multi, _sort: null, _lean: false, _limit: null };
  const chain = {
    sort(s) {
      st._sort = s;
      return chain;
    },
    lean() {
      st._lean = true;
      return chain;
    },
    limit(n) {
      st._limit = n;
      return chain;
    },
    async exec() {
      const params = [];
      const w = buildWhere(st.filter, params);
      let order = 'ORDER BY created_at DESC';
      if (st._sort && st._sort.createdAt) {
        order = `ORDER BY created_at ${st._sort.createdAt === 1 ? 'ASC' : 'DESC'}`;
      }
      let lim = '';
      if (st._limit != null) {
        lim = ` LIMIT $${params.length + 1}`;
        params.push(st._limit);
      } else if (!st.multi) {
        lim = ' LIMIT 1';
      }
      const res = await query(`SELECT * FROM notifications WHERE ${w} ${order}${lim}`, params);
      const rows = res.rows;
      const map = (row) => {
        const o = fromRow(row);
        return st._lean ? { ...o, toObject: () => ({ ...o }) } : { ...o, toObject: () => ({ ...o }) };
      };
      return st.multi ? rows.map(map) : rows[0] ? map(rows[0]) : null;
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

const Notification = {
  find(f) {
    return makeChain(f, true);
  },
  findOne(f) {
    return makeChain(f, false);
  },
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO notifications (id, recipient, sender, type, content, related_id, is_read, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, now()))`,
      [
        id,
        String(data.recipient),
        data.sender ? String(data.sender) : null,
        data.type,
        data.content,
        data.relatedId ? String(data.relatedId) : null,
        data.isRead ?? false,
        data.createdAt || null,
      ]
    );
    return fromRow((await query('SELECT * FROM notifications WHERE id=$1', [id])).rows[0]);
  },
  async updateMany(filter, update) {
    const params = [];
    const w = buildWhere(filter, params);
    if (update.$set && update.$set.isRead === true) {
      const r = await query(`UPDATE notifications SET is_read = true WHERE ${w}`, params);
      return { modifiedCount: r.rowCount };
    }
    return { modifiedCount: 0 };
  },
  findOneAndUpdate(filter, update, opts) {
    const p = (async () => {
      const params = [];
      const w = buildWhere(filter, params);
      const row = (await query(`SELECT * FROM notifications WHERE ${w} LIMIT 1`, params)).rows[0];
      if (!row) return null;
      if (update.$set && update.$set.isRead != null) {
        await query('UPDATE notifications SET is_read=$2 WHERE id=$1', [row.id, !!update.$set.isRead]);
      }
      const fresh = (await query('SELECT * FROM notifications WHERE id=$1', [row.id])).rows[0];
      const o = fromRow(fresh);
      return opts?.new ? o : fromRow(row);
    })();
    p.exec = () => p;
    return p;
  },
};

module.exports = Notification;
