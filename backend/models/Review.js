const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    user: row.user_id,
    creator: row.creator_id,
    content: row.content,
    rating: row.rating,
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
      if (st.filter.creator) {
        w = 'creator_id = $1';
        p.push(String(st.filter.creator));
      }
      let order = 'ORDER BY created_at DESC';
      if (st._sort && st._sort.createdAt) order = `ORDER BY created_at ${st._sort.createdAt === 1 ? 'ASC' : 'DESC'}`;
      const lim = multi ? '' : 'LIMIT 1';
      const res = await query(`SELECT * FROM reviews WHERE ${w} ${order} ${lim}`, p);
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

async function aggregate(pipeline) {
  const m = pipeline[0]?.$match;
  if (m && m.creator) {
    const r = await query(
      `SELECT AVG(rating)::float AS avg, COUNT(*)::int AS cnt FROM reviews WHERE creator_id = $1`,
      [String(m.creator)]
    );
    const row = r.rows[0];
    if (!row || row.cnt === 0) return [];
    return [{ _id: null, avg: row.avg, count: row.cnt }];
  }
  return [];
}

const Review = {
  find(f) {
    return chain(f, true);
  },
  findOne(f) {
    return chain(f, false);
  },
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO reviews (id, user_id, creator_id, content, rating) VALUES ($1,$2,$3,$4,$5)`,
      [id, String(data.user), String(data.creator), data.content, data.rating]
    );
    return fromRow((await query('SELECT * FROM reviews WHERE id=$1', [id])).rows[0]);
  },
  findById(id) {
    return chain({ _id: String(id) }, false);
  },
  countDocuments(filter) {
    return (async () => {
      const p = [];
      let w = 'TRUE';
      if (filter.creator) {
        w = 'creator_id = $1';
        p.push(String(filter.creator));
      }
      const r = await query(`SELECT COUNT(*)::int AS c FROM reviews WHERE ${w}`, p);
      return r.rows[0].c;
    })();
  },
  aggregate,
};

module.exports = Review;
