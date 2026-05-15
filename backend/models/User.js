const bcrypt = require('bcryptjs');
const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function decorateOidArray(initial) {
  const base = Array.isArray(initial) ? [...initial.map((x) => String(x))] : [];
  base.pull = function pullFn(id) {
    const s = String(id);
    const i = this.findIndex((x) => String(x) === s);
    if (i >= 0) this.splice(i, 1);
  };
  base.addToSet = function addToSetFn(id) {
    const s = String(id);
    if (!this.some((x) => String(x) === s)) this.push(s);
  };
  return base;
}

function fromRow(row) {
  if (!row) return null;
  let sessions = row.sessions;
  if (sessions == null) sessions = [];
  else if (typeof sessions === 'string') {
    try {
      sessions = JSON.parse(sessions);
    } catch {
      sessions = [];
    }
  }
  if (!Array.isArray(sessions)) sessions = [];
  return {
    id: row.id,
    _id: row.id,
    name: row.name,
    username: row.username,
    phone: row.phone,
    email: row.email,
    password: row.password,
    role: row.role,
    avatar: row.avatar,
    countryOfResidence: row.country_of_residence,
    isVerified: row.is_verified,
    bio: row.bio,
    resetPasswordToken: row.reset_password_token,
    resetPasswordExpires: row.reset_password_expires,
    following: (row.following || []).map(String),
    favorites: (row.favorites || []).map(String),
    memberships: (row.memberships || []).map(String),
    lastLogin: row.last_login,
    sessions,
    otp: row.otp,
    otpExpires: row.otp_expires,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function persistUser(plain) {
  // Auth routes load users with .select('-password'); never overwrite the hash with NULL/undefined.
  if (plain.password === undefined) {
    const pwRow = (await query('SELECT password FROM users WHERE id = $1', [plain.id])).rows[0];
    if (pwRow) plain.password = pwRow.password;
  }

  const following = plain.following || [];
  const favorites = plain.favorites || [];
  const memberships = plain.memberships || [];
  await query(
    `UPDATE users SET
      name = $2, username = $3, phone = $4, email = $5, password = $6, role = $7, avatar = $8,
      country_of_residence = $9, is_verified = $10, bio = $11,
      reset_password_token = $12, reset_password_expires = $13,
      following = $14::text[], favorites = $15::text[], memberships = $16::text[],
      last_login = $17, sessions = $18::jsonb, otp = $19, otp_expires = $20,
      updated_at = now()
    WHERE id = $1`,
    [
      plain.id,
      plain.name,
      plain.username,
      plain.phone,
      plain.email,
      plain.password,
      plain.role,
      plain.avatar,
      plain.countryOfResidence,
      plain.isVerified,
      plain.bio,
      plain.resetPasswordToken || '',
      plain.resetPasswordExpires || null,
      following.map(String),
      favorites.map(String),
      memberships.map(String),
      plain.lastLogin || new Date(),
      JSON.stringify(plain.sessions || []),
      plain.otp ?? null,
      plain.otpExpires ?? null,
    ]
  );
}

function hydrateDoc(plain, { forLean = false } = {}) {
  if (!plain) return null;
  if (forLean) {
    return {
      ...plain,
      _id: plain.id,
      toObject() {
        return { ...plain, _id: plain.id };
      },
    };
  }
  const doc = {
    ...plain,
    _id: plain.id,
    following: decorateOidArray(plain.following),
    favorites: decorateOidArray(plain.favorites),
    memberships: decorateOidArray(plain.memberships),
    async save() {
      await persistUser({
        ...plain,
        name: doc.name,
        username: doc.username,
        phone: doc.phone,
        email: doc.email,
        password: doc.password,
        role: doc.role,
        avatar: doc.avatar,
        countryOfResidence: doc.countryOfResidence,
        isVerified: doc.isVerified,
        bio: doc.bio,
        resetPasswordToken: doc.resetPasswordToken,
        resetPasswordExpires: doc.resetPasswordExpires,
        lastLogin: doc.lastLogin,
        otp: doc.otp,
        otpExpires: doc.otpExpires,
        following: [...doc.following],
        favorites: [...doc.favorites],
        memberships: [...doc.memberships],
        sessions: doc.sessions,
      });
    },
    async matchPassword(entered) {
      return bcrypt.compare(entered, plain.password);
    },
    toObject() {
      return {
        ...plain,
        _id: plain.id,
        following: [...doc.following],
        favorites: [...doc.favorites],
        memberships: [...doc.memberships],
      };
    },
  };
  return doc;
}

function buildWhereClause(filter, startIndex = 1) {
  const parts = [];
  const params = [];
  let i = startIndex;

  const pushEq = (col, val) => {
    parts.push(`${col} = $${i}`);
    params.push(val);
    i += 1;
  };

  if (!filter || Object.keys(filter).length === 0) {
    return { sql: 'TRUE', params: [], nextIndex: i };
  }

  if (filter.email && typeof filter.email === 'object' && Array.isArray(filter.email.$in)) {
    parts.push(`LOWER(email) = ANY($${i}::text[])`);
    params.push(filter.email.$in.map((e) => String(e).toLowerCase()));
    i += 1;
  } else if (filter.email) pushEq('LOWER(email)', String(filter.email).toLowerCase());
  if (filter.username) pushEq('LOWER(username)', String(filter.username).toLowerCase());
  if (filter.phone) pushEq('phone', filter.phone);
  if (filter._id || filter.id) {
    parts.push(`id = $${i}`);
    params.push(String(filter._id || filter.id));
    i += 1;
  }
  if (filter.resetPasswordToken) {
    parts.push(`reset_password_token = $${i}`);
    params.push(filter.resetPasswordToken);
    i += 1;
  }
  if (filter.resetPasswordExpires && filter.resetPasswordExpires.$gt != null) {
    parts.push(`reset_password_expires > $${i}::timestamptz`);
    params.push(new Date(filter.resetPasswordExpires.$gt));
    i += 1;
  }
  if (filter.role) pushEq('role', filter.role);

  return { sql: parts.length ? parts.join(' AND ') : 'TRUE', params, nextIndex: i };
}

function createFindQuery(filter, multi = false) {
  const state = {
    filter,
    multi,
    _select: null,
    _lean: false,
    _sort: null,
    _skip: 0,
    _limit: null,
    _populate: null,
  };

  const chain = {
    select(sel) {
      state._select = sel;
      return chain;
    },
    lean() {
      state._lean = true;
      return chain;
    },
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
    populate(spec) {
      state._populate = spec;
      return chain;
    },
    async exec() {
      const { sql, params } = buildWhereClause(state.filter);
      let orderSql = 'ORDER BY created_at DESC';
      if (state._sort) {
        const keys = Object.keys(state._sort);
        if (keys.length) {
          const k = keys[0];
          const dir = state._sort[k] === 1 ? 'ASC' : 'DESC';
          const colMap = { createdAt: 'created_at', updatedAt: 'updated_at' };
          const col = colMap[k] || k;
          orderSql = `ORDER BY ${col} ${dir}`;
        }
      }
      const p = [...params];
      let limSql = '';
      if (state._skip) {
        limSql += ` OFFSET $${p.length + 1}`;
        p.push(state._skip);
      }
      if (state._limit != null) {
        limSql += ` LIMIT $${p.length + 1}`;
        p.push(state._limit);
      } else if (!state.multi) {
        limSql += ` LIMIT $${p.length + 1}`;
        p.push(1);
      }

      const qtext = `SELECT * FROM users WHERE ${sql} ${orderSql}${limSql}`;
      const res = await query(qtext, p);

      const rows = res.rows;
      const applySelect = (plain) => {
        if (!state._select) return plain;
        const fields = state._select.split(/\s+/).filter(Boolean);
        const omit = new Set(
          fields.filter((f) => f.startsWith('-')).map((f) => f.slice(1).replace(/^-/, ''))
        );
        const pick = fields.filter((f) => !f.startsWith('-'));
        let out = { ...plain };
        if (omit.has('password')) delete out.password;
        if (pick.length) {
          out = { id: plain.id, _id: plain.id };
          pick.forEach((f) => {
            if (f === '_id' || f === 'id') return;
            if (plain[f] !== undefined) out[f] = plain[f];
          });
        }
        return out;
      };

      const mapRow = (row) => {
        let plain = fromRow(row);
        plain = applySelect(plain);
        return state._lean ? hydrateDoc(plain, { forLean: true }) : hydrateDoc(plain);
      };

      if (state.multi) {
        let list = rows.map(mapRow);
        if (state._populate && state._populate.path === 'favorites') {
          const Post = require('./Post');
          for (const u of list) {
            const ids = [...(u.favorites || [])].map(String);
            const posts = [];
            for (const pid of ids) {
              const nested = state._populate.populate;
              let pdoc = await Post.findById(pid).populate(nested).lean().exec();
              if (pdoc) posts.push(pdoc);
            }
            u.favorites = posts;
          }
        }
        return list;
      }
      const row = rows[0];
      if (!row) return null;
      let doc = mapRow(row);
      if (state._populate && state._populate.path === 'favorites') {
        const Post = require('./Post');
        const ids = [...(doc.favorites || [])].map(String);
        const posts = [];
        for (const pid of ids) {
          const nested = state._populate.populate;
          let pdoc = await Post.findById(pid).populate(nested).lean().exec();
          if (!pdoc) {
            pdoc = await Post.findById(pid).lean().exec();
          }
          if (pdoc) posts.push(pdoc);
        }
        doc.favorites = posts;
      }
      return doc;
    },
    then(onFulfilled, onRejected) {
      return chain.exec().then(onFulfilled, onRejected);
    },
    catch(onRejected) {
      return chain.exec().catch(onRejected);
    },
  };
  return chain;
}

async function findByIdAndUpdate(id, update, opts = {}) {
  const user = fromRow((await query('SELECT * FROM users WHERE id = $1', [String(id)])).rows[0]);
  if (!user) return null;

  if (update.$set) {
    Object.assign(user, update.$set);
  }
  if (update.$unset) {
    Object.keys(update.$unset).forEach((k) => {
      user[k] = undefined;
    });
  }
  if (update.$pull && update.$pull.favorites) {
    const rid = String(update.$pull.favorites);
    user.favorites = (user.favorites || []).filter((x) => String(x) !== rid);
  }
  if (update.$addToSet && update.$addToSet.favorites) {
    const rid = String(update.$addToSet.favorites);
    if (!(user.favorites || []).some((x) => String(x) === rid)) user.favorites = [...(user.favorites || []), rid];
  }

  await persistUser({
    ...user,
    otp: user.otp,
    otpExpires: user.otpExpires,
    resetPasswordToken: user.resetPasswordToken,
    resetPasswordExpires: user.resetPasswordExpires,
  });

  const fresh = (await query('SELECT * FROM users WHERE id = $1', [String(id)])).rows[0];
  const plain = fromRow(fresh);
  return opts.new ? hydrateDoc(plain) : hydrateDoc(plain);
}

async function create(data) {
  const id = newObjectId();
  let password = data.password;
  if (password) {
    const salt = await bcrypt.genSalt(10);
    password = await bcrypt.hash(password, salt);
  }
  let phone = data.phone != null && String(data.phone).trim() !== '' ? String(data.phone).trim() : null;
  if (!phone) {
    phone = `9${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`.slice(0, 15);
  }
  const row = {
    id,
    name: data.name,
    username: String(data.username || '').toLowerCase().trim(),
    phone,
    email: String(data.email || '').toLowerCase().trim(),
    password,
    role: data.role || 'user',
    avatar: data.avatar ?? '',
    country_of_residence: data.countryOfResidence || 'All courses',
    is_verified: data.isVerified ?? false,
    bio: data.bio ?? '',
    reset_password_token: data.resetPasswordToken || '',
    reset_password_expires: data.resetPasswordExpires || null,
    following: data.following || [],
    favorites: data.favorites || [],
    memberships: data.memberships || [],
    last_login: data.lastLogin || new Date(),
    sessions: JSON.stringify(data.sessions || []),
    otp: data.otp ?? null,
    otp_expires: data.otpExpires ?? null,
  };

  await query(
    `INSERT INTO users (
      id, name, username, phone, email, password, role, avatar, country_of_residence, is_verified, bio,
      reset_password_token, reset_password_expires, following, favorites, memberships, last_login, sessions, otp, otp_expires
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::text[],$15::text[],$16::text[],$17,$18::jsonb,$19,$20
    )`,
    [
      row.id,
      row.name,
      row.username,
      row.phone,
      row.email,
      row.password,
      row.role,
      row.avatar,
      row.country_of_residence,
      row.is_verified,
      row.bio,
      row.reset_password_token,
      row.reset_password_expires,
      row.following.map(String),
      row.favorites.map(String),
      row.memberships.map(String),
      row.last_login,
      row.sessions,
      row.otp,
      row.otp_expires,
    ]
  );

  return hydrateDoc(fromRow((await query('SELECT * FROM users WHERE id = $1', [id])).rows[0]));
}

const User = {
  findById(id) {
    return createFindQuery({ _id: String(id) }, false);
  },
  findOne(filter) {
    return createFindQuery(filter || {}, false);
  },
  find(filter = {}) {
    return createFindQuery(filter, true);
  },
  findByIdAndUpdate,
  create,
};

module.exports = User;
