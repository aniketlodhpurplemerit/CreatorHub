const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    user: row.user_id,
    post: row.post_id,
    parentComment: row.parent_comment_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hydrate(plain) {
  if (!plain) return null;
  return {
    ...plain,
    _id: plain.id,
    async save() {
      await query(
        `UPDATE comments SET content=$2, updated_at=now() WHERE id=$1`,
        [plain.id, plain.content]
      );
    },
    toObject() {
      return { ...plain, _id: plain.id };
    },
  };
}

function makeChain(filter, multi) {
  const st = { filter, multi, _populate: null, _sort: null };
  const ch = {
    populate(path, sel) {
      st._populate = { path, sel };
      return ch;
    },
    sort(s) {
      st._sort = s;
      return ch;
    },
    async exec() {
      const p = [];
      let w = 'TRUE';
      if (st.filter.post) {
        w = 'post_id = $1';
        p.push(String(st.filter.post));
      }
      if (st.filter._id) {
        w = 'id = $1';
        p.push(String(st.filter._id));
      }
      let order = 'ORDER BY created_at ASC';
      if (st._sort && st._sort.createdAt) order = `ORDER BY created_at ${st._sort.createdAt === 1 ? 'ASC' : 'DESC'}`;
      const lim = multi ? '' : 'LIMIT 1';
      const res = await query(`SELECT * FROM comments WHERE ${w} ${order} ${lim}`, p);
      const User = require('./User');
      const rows = res.rows.map((row) => {
        let pl = fromRow(row);
        return pl;
      });
      const out = [];
      for (const pl of rows) {
        let doc = hydrate(pl);
        if (st._populate && st._populate.path === 'user') {
          const u = await User.findById(pl.user).select(st._populate.sel).lean().exec();
          doc = { ...doc, user: u || pl.user };
        }
        out.push(doc);
      }
      return multi ? out : out[0] || null;
    },
    then(onF, onR) {
      return ch.exec().then(onF, onR);
    },
    catch(onR) {
      return ch.exec().catch(onR);
    },
  };
  return ch;
}

const Comment = {
  find(f) {
    return makeChain(f, true);
  },
  findById(id) {
    return makeChain({ _id: String(id) }, false);
  },
  async deleteOne(q) {
    await query('DELETE FROM comments WHERE id=$1', [String(q._id)]);
  },
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO comments (id, user_id, post_id, parent_comment_id, content) VALUES ($1,$2,$3,$4,$5)`,
      [id, String(data.user), String(data.post), data.parentComment || null, data.content]
    );
    return hydrate(fromRow((await query('SELECT * FROM comments WHERE id=$1', [id])).rows[0]));
  },
};

module.exports = Comment;
