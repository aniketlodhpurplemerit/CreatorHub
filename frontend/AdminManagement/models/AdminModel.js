const { query } = require('../../../backend/db/pool');
const { newObjectId } = require('../../../backend/utils/objectId');

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    password: row.password,
    role: row.role,
    status: row.status,
    avatarInitials: row.avatar_initials,
    avatarColor: row.avatar_color,
    lastActiveAt: row.last_active_at,
    addedBy: row.added_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function persist(plain) {
  await query(
    `UPDATE admins SET name=$2, username=$3, email=$4, password=$5, role=$6, status=$7,
     avatar_initials=$8, avatar_color=$9, last_active_at=$10, added_by=$11, updated_at=now()
     WHERE id=$1`,
    [
      plain.id,
      plain.name,
      plain.username,
      plain.email,
      plain.password,
      plain.role,
      plain.status,
      plain.avatarInitials,
      plain.avatarColor,
      plain.lastActiveAt || new Date(),
      plain.addedBy || null,
    ]
  );
}

function hydrate(plain) {
  if (!plain) return null;
  plain._id = plain.id;
  plain.save = async () => persist(plain);
  plain.toJSON = function toJSON() {
    const o = { ...this };
    delete o.password;
    delete o.save;
    delete o.toJSON;
    return o;
  };
  plain.toObject = () => ({ ...plain, _id: plain.id });
  return plain;
}

function buildMatch(m, params) {
  const parts = [];
  let i = params.length + 1;
  if (m.role) {
    parts.push(`role = $${i}`);
    params.push(m.role);
    i += 1;
  }
  if (m.status) {
    parts.push(`status = $${i}`);
    params.push(m.status);
    i += 1;
  }
  if (m.email) {
    parts.push(`LOWER(email) = $${i}`);
    params.push(String(m.email).toLowerCase());
    i += 1;
  }
  if (m.username) {
    parts.push(`LOWER(username) = $${i}`);
    params.push(String(m.username).toLowerCase());
    i += 1;
  }
  if (m._id) {
    parts.push(`id = $${i}`);
    params.push(String(m._id));
    i += 1;
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

const Admin = {
  find(filter = {}) {
    const state = { filter, _select: null, _lean: false };
    const chain = {
      select(sel) {
        state._select = sel;
        return chain;
      },
      lean() {
        state._lean = true;
        return chain;
      },
      async exec() {
        const params = [];
        const w = buildMatch(state.filter || {}, params);
        const res = await query(`SELECT * FROM admins WHERE ${w}`, params);
        const applySelect = (plain) => {
          if (!state._select) return plain;
          const fields = state._select.split(/\s+/).filter(Boolean);
          const omit = new Set(fields.filter((f) => f.startsWith('-')).map((f) => f.slice(1)));
          const pick = fields.filter((f) => !f.startsWith('-'));
          let o = { ...plain };
          omit.forEach((k) => {
            delete o[k];
          });
          if (pick.length) {
            o = { _id: plain.id, id: plain.id };
            pick.forEach((k) => {
              if (k === '_id' || k === 'id') return;
              if (plain[k] !== undefined) o[k] = plain[k];
            });
          }
          return o;
        };
        return res.rows.map((row) => {
          const plain = fromRow(row);
          const shaped = applySelect(plain);
          if (state._lean) {
            const o = { ...shaped, _id: shaped.id || shaped._id };
            delete o.password;
            return o;
          }
          return hydrate(shaped);
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
  },
  async findOne(filter) {
    const params = [];
    const w = buildMatch(filter || {}, params);
    const row = (await query(`SELECT * FROM admins WHERE ${w} LIMIT 1`, params)).rows[0];
    return row ? hydrate(fromRow(row)) : null;
  },
  async countDocuments(filter) {
    const params = [];
    const w = buildMatch(filter || {}, params);
    const r = await query(`SELECT COUNT(*)::int AS c FROM admins WHERE ${w}`, params);
    return r.rows[0].c;
  },
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO admins (id, name, username, email, password, role, status, avatar_initials, avatar_color, last_active_at, added_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10)`,
      [
        id,
        data.name,
        data.username,
        data.email,
        data.password,
        data.role,
        data.status || 'active',
        data.avatarInitials || '',
        data.avatarColor || '',
        data.addedBy || null,
      ]
    );
    return hydrate(fromRow((await query('SELECT * FROM admins WHERE id=$1', [id])).rows[0]));
  },
  findById(id) {
    const chain = {
      _lean: false,
      select() {
        return chain;
      },
      lean() {
        chain._lean = true;
        return chain;
      },
      async exec() {
        const row = (await query('SELECT * FROM admins WHERE id = $1', [String(id)])).rows[0];
        if (!row) return null;
        const plain = fromRow(row);
        return chain._lean ? leanDoc(plain) : hydrate(plain);
      },
      then(onF, onR) {
        return chain.exec().then(onF, onR);
      },
      catch(onR) {
        return chain.exec().catch(onR);
      },
    };
    return chain;
  },
  async aggregate(pipeline) {
    const facet = pipeline[0].$facet;
    const matchStage = facet.admins.find((s) => s.$match)?.$match || {};
    const params = [];
    const w = buildMatch(matchStage, params);
    const sortStage = facet.admins.find((s) => s.$sort)?.$sort || { lastActiveAt: -1 };
    const sortKey = Object.keys(sortStage)[0];
    const sortDir = sortStage[sortKey] === 1 ? 'ASC' : 'DESC';
    const col = sortKey === 'createdAt' ? 'created_at' : 'last_active_at';
    const skip = facet.admins.find((s) => s.$skip != null)?.$skip || 0;
    const limit = facet.admins.find((s) => s.$limit != null)?.$limit || 10;

    const [adminsRes, roleRes, totalRes] = await Promise.all([
      query(
        `SELECT * FROM admins WHERE ${w} ORDER BY ${col} ${sortDir} OFFSET $${params.length + 1} LIMIT $${params.length + 2}`,
        [...params, skip, limit]
      ),
      query(`SELECT role AS _id, COUNT(*)::int AS count FROM admins WHERE ${w} GROUP BY role`, [...params]),
      query(`SELECT COUNT(*)::int AS count FROM admins WHERE ${w}`, [...params]),
    ]);

    const admins = [];
    for (const row of adminsRes.rows) {
      const a = fromRow(row);
      delete a.password;
      let addedByName = 'System';
      if (a.addedBy) {
        const ab = (await query('SELECT name FROM admins WHERE id = $1', [String(a.addedBy)])).rows[0];
        if (ab) addedByName = ab.name;
      }
      admins.push({ ...a, _id: a.id, addedByName });
    }

    const roleStats = roleRes.rows;
    const total = totalRes.rows[0]?.count || 0;

    return [
      {
        admins,
        roleStats,
        totalMatched: [{ count: total }],
      },
    ];
  },
  async deleteOne(q) {
    await query('DELETE FROM admins WHERE id = $1', [String(q._id)]);
  },
  async findByIdAndUpdate(id, update) {
    const row = (await query('SELECT * FROM admins WHERE id = $1', [String(id)])).rows[0];
    if (!row) return null;
    const pl = fromRow(row);
    if (update.$set) Object.assign(pl, update.$set);
    await persist(pl);
  },
};

function leanDoc(plain) {
  const o = { ...plain, _id: plain.id };
  delete o.password;
  return o;
}

module.exports = Admin;
