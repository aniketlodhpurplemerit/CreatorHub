const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    review: row.review_id,
    user: row.user_id,
    parentReply: row.parent_reply_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function chain(filter, multi) {
  const st = { filter, multi, _populate: null, _sort: null };
  const c = {
    populate(p, s) {
      st._populate = { p, s };
      return c;
    },
    sort(spec) {
      st._sort = spec;
      return c;
    },
    async exec() {
      const p = [];
      let w = 'TRUE';
      if (st.filter.review) {
        w = 'review_id = $1';
        p.push(String(st.filter.review));
      }
      let order = 'ORDER BY created_at ASC';
      if (st._sort && st._sort.createdAt) order = `ORDER BY created_at ${st._sort.createdAt === 1 ? 'ASC' : 'DESC'}`;
      const lim = multi ? '' : 'LIMIT 1';
      const res = await query(`SELECT * FROM review_replies WHERE ${w} ${order} ${lim}`, p);
      const User = require('./User');
      const out = [];
      for (const row of res.rows) {
        let pl = fromRow(row);
        if (st._populate && st._populate.p === 'user') {
          const u = await User.findById(pl.user).select(st._populate.s).lean().exec();
          pl = { ...pl, user: u || pl.user };
        }
        out.push({ ...pl, _id: pl.id, toObject: () => ({ ...pl, _id: pl.id }) });
      }
      return multi ? out : out[0] || null;
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

const ReviewReply = {
  find(f) {
    return chain(f, true);
  },
  findById(id) {
    return chain({ _id: String(id) }, false);
  },
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO review_replies (id, review_id, user_id, parent_reply_id, content) VALUES ($1,$2,$3,$4,$5)`,
      [id, String(data.review), String(data.user), data.parentReply || null, data.content]
    );
    return fromRow((await query('SELECT * FROM review_replies WHERE id=$1', [id])).rows[0]);
  },
};

module.exports = ReviewReply;
