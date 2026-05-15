const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    reportedBy: row.reported_by,
    creatorId: row.creator_id,
    postId: row.post_id,
    reason: row.reason,
    description: row.description,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    actionTaken: row.action_taken,
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
        `UPDATE content_reports SET
          reported_by=$2, creator_id=$3, post_id=$4, reason=$5, description=$6, status=$7,
          reviewed_by=$8, reviewed_at=$9, action_taken=$10, updated_at=now()
        WHERE id=$1`,
        [
          plain.id,
          String(plain.reportedBy),
          String(plain.creatorId),
          String(plain.postId),
          plain.reason,
          plain.description || '',
          plain.status,
          plain.reviewedBy || null,
          plain.reviewedAt || null,
          plain.actionTaken || 'none',
        ]
      );
    },
    toObject() {
      return { ...plain, _id: plain.id };
    },
  };
}

function buildWhere(f, params) {
  const parts = [];
  let i = params.length + 1;
  if (f.reportedBy && f.postId) {
    parts.push(`reported_by = $${i} AND post_id = $${i + 1}`);
    params.push(String(f.reportedBy), String(f.postId));
    return parts.join(' AND ');
  }
  if (f.reportedBy) {
    parts.push(`reported_by = $${i}`);
    params.push(String(f.reportedBy));
    i += 1;
  }
  if (f.status) {
    parts.push(`status = $${i}`);
    params.push(f.status);
    i += 1;
  }
  if (f._id) {
    parts.push(`id = $${i}`);
    params.push(String(f._id));
    i += 1;
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function makeChain(filter, multi) {
  const st = { filter, multi, _select: null, _lean: false, _sort: null, _skip: 0, _limit: null, _populates: [] };
  const ch = {
    select(s) {
      st._select = s;
      return ch;
    },
    lean() {
      st._lean = true;
      return ch;
    },
    sort(s) {
      st._sort = s;
      return ch;
    },
    skip(n) {
      st._skip = n;
      return ch;
    },
    limit(n) {
      st._limit = n;
      return ch;
    },
    populate(spec) {
      st._populates.push(spec);
      return ch;
    },
    async exec() {
      const params = [];
      const w = buildWhere(st.filter, params);
      let order = 'ORDER BY created_at DESC';
      if (st._sort && st._sort.createdAt) order = `ORDER BY created_at ${st._sort.createdAt === 1 ? 'ASC' : 'DESC'}`;
      const p = [...params];
      let lim = '';
      if (st._skip) {
        lim += ` OFFSET $${p.length + 1}`;
        p.push(st._skip);
      }
      if (st._limit != null) {
        lim += ` LIMIT $${p.length + 1}`;
        p.push(st._limit);
      } else if (!st.multi) {
        lim += ` LIMIT 1`;
      }
      const res = await query(`SELECT * FROM content_reports WHERE ${w} ${order}${lim}`, p);
      const User = require('./User');
      const Post = require('./Post');
      const rows = res.rows;
      const mapRow = async (row) => {
        let pl = fromRow(row);
        if (st._populates.length) {
          for (const pop of st._populates) {
            const path = pop.path;
            const sel = pop.select || '';
            if (path === 'reportedBy' || path === 'creatorId' || path === 'reviewedBy') {
              const uid = pl[path];
              if (uid) {
                const u = await User.findById(String(uid)).select(sel).lean().exec();
                pl[path] = u || uid;
              }
            }
            if (path === 'postId') {
              const po = await Post.findById(String(pl.postId)).select(sel).lean().exec();
              pl.postId = po || pl.postId;
            }
          }
        }
        if (st._lean) {
          return { ...pl, _id: pl.id, toObject: () => ({ ...pl, _id: pl.id }) };
        }
        return hydrate(pl);
      };
      if (multi) return Promise.all(rows.map((row) => mapRow(row)));
      return rows[0] ? mapRow(rows[0]) : null;
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

async function aggregate(pipeline) {
  const m = pipeline[0]?.$match;
  if (m && m.postId && m.postId.$in) {
    const ids = m.postId.$in.map(String);
    const r = await query(
      `SELECT post_id AS _id, COUNT(*)::int AS count FROM content_reports WHERE post_id = ANY($1::text[]) GROUP BY post_id`,
      [ids]
    );
    return r.rows;
  }
  return [];
}

const Report = {
  find(f) {
    return makeChain(f, true);
  },
  findOne(f) {
    return makeChain(f, false);
  },
  findById(id) {
    return makeChain({ _id: String(id) }, false);
  },
  async create(data) {
    const id = newObjectId();
    try {
      await query(
        `INSERT INTO content_reports (id, reported_by, creator_id, post_id, reason, description, status, action_taken)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          String(data.reportedBy),
          String(data.creatorId),
          String(data.postId),
          data.reason,
          data.description || '',
          data.status || 'pending',
          data.actionTaken || 'none',
        ]
      );
    } catch (e) {
      if (e.code === '23505') {
        const err = new Error('duplicate');
        err.code = 11000;
        throw err;
      }
      throw e;
    }
    return hydrate(fromRow((await query('SELECT * FROM content_reports WHERE id=$1', [id])).rows[0]));
  },
  countDocuments(filter) {
    return (async () => {
      const params = [];
      const w = buildWhere(filter, params);
      const r = await query(`SELECT COUNT(*)::int AS c FROM content_reports WHERE ${w}`, params);
      return r.rows[0].c;
    })();
  },
  aggregate,
};

module.exports = Report;
