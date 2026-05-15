const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    streamId: row.stream_id,
    userId: row.user_id,
    userName: row.user_name,
    avatar: row.avatar,
    text: row.text,
    isPinned: row.is_pinned,
    isModerated: row.is_moderated,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function chain(filter, multi) {
  const st = { filter, multi, _sort: null, _limit: null };
  const c = {
    sort(s) {
      st._sort = s;
      return c;
    },
    limit(n) {
      st._limit = n;
      return c;
    },
    async exec() {
      const params = [];
      let w = 'TRUE';
      let i = 1;
      if (st.filter.streamId) {
        w = `stream_id = $${i}`;
        params.push(String(st.filter.streamId));
        i += 1;
      }
      if (st.filter.isModerated === false) {
        w += ` AND is_moderated = false`;
      }
      let order = 'ORDER BY created_at ASC';
      if (st._sort && st._sort.createdAt) order = `ORDER BY created_at ${st._sort.createdAt === 1 ? 'ASC' : 'DESC'}`;
      const lim = st._limit != null ? ` LIMIT $${params.length + 1}` : '';
      const p = st._limit != null ? [...params, st._limit] : params;
      const res = await query(`SELECT * FROM live_chat_messages WHERE ${w} ${order}${lim}`, p);
      return res.rows.map((r) => fromRow(r));
    },
    then(onF, onR) {
      return c.exec().then(onF, onR);
    },
    catch(onR) {
      return c.exec().catch(onR);
    },
  };
  return c;
}

const LiveChatMessage = {
  find(f) {
    return chain(f, true);
  },
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO live_chat_messages (id, stream_id, user_id, user_name, avatar, text) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        id,
        String(data.streamId),
        String(data.userId),
        data.userName,
        data.avatar || '',
        data.text,
      ]
    );
    return fromRow((await query('SELECT * FROM live_chat_messages WHERE id=$1', [id])).rows[0]);
  },
};

module.exports = LiveChatMessage;
