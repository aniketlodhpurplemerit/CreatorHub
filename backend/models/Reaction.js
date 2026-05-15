const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    user: row.user_id,
    post: row.post_id,
    type: row.type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function chain(filter, multi) {
  const st = { filter, multi };
  const c = {
    async exec() {
      const p = [];
      let w = 'TRUE';
      if (st.filter.user && st.filter.post) {
        w = 'user_id = $1 AND post_id = $2';
        p.push(String(st.filter.user), String(st.filter.post));
      }
      const lim = st.multi ? '' : 'LIMIT 1';
      const res = await query(`SELECT * FROM reactions WHERE ${w} ${lim}`, p);
      if (st.multi) return res.rows.map((r) => fromRow(r));
      return res.rows[0] ? fromRow(res.rows[0]) : null;
    },
    then(onF, onR) {
      return c.exec().then(onF, onR);
    },
  };
  return c;
}

const Reaction = {
  findOne(f) {
    return chain(f, false);
  },
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO reactions (id, user_id, post_id, type) VALUES ($1,$2,$3,$4)`,
      [id, String(data.user), String(data.post), data.type]
    );
    return fromRow((await query('SELECT * FROM reactions WHERE id=$1', [id])).rows[0]);
  },
  async findByIdAndDelete(id) {
    await query('DELETE FROM reactions WHERE id=$1', [String(id)]);
  },
  findByIdAndUpdate(id, upd) {
    return (async () => {
      if (upd.type) {
        await query('UPDATE reactions SET type=$2, updated_at=now() WHERE id=$1', [String(id), upd.type]);
      }
      return fromRow((await query('SELECT * FROM reactions WHERE id=$1', [String(id)])).rows[0]);
    })();
  },
};

module.exports = Reaction;
