const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function fromRow(row) {
  if (!row) return null;
  let revenue = row.revenue;
  if (revenue && typeof revenue === 'string') {
    try {
      revenue = JSON.parse(revenue);
    } catch {
      revenue = { total: 0, breakdown: { subscriptionPay: 0, directPurchase: 0 } };
    }
  }
  if (!revenue || typeof revenue !== 'object') {
    revenue = { total: 0, breakdown: { subscriptionPay: 0, directPurchase: 0 } };
  }
  return {
    id: row.id,
    _id: row.id,
    title: row.title,
    description: row.description,
    mediaUrl: row.media_url,
    thumbnailUrl: row.thumbnail_url,
    mediaType: row.media_type,
    isExclusive: row.is_exclusive,
    accessTier: row.access_tier,
    creatorId: row.creator_id,
    status: row.status,
    policyViolationLocked: row.policy_violation_locked,
    policyViolationLabel: row.policy_violation_label,
    policyViolationLockedAt: row.policy_violation_locked_at,
    policyViolationLockedBy: row.policy_violation_locked_by,
    category: row.category,
    price: Number(row.price) || 0,
    purchasedUsers: (row.purchased_users || []).map(String),
    views: row.views,
    uniqueViewers: (row.unique_viewers || []).map(String),
    likes: row.likes,
    dislikes: row.dislikes,
    comments: row.comments,
    revenue,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function persistPost(plain) {
  await query(
    `UPDATE posts SET
      title=$2, description=$3, media_url=$4, thumbnail_url=$5, media_type=$6,
      is_exclusive=$7, access_tier=$8, creator_id=$9, status=$10,
      policy_violation_locked=$11, policy_violation_label=$12,
      policy_violation_locked_at=$13, policy_violation_locked_by=$14,
      category=$15, price=$16, purchased_users=$17::text[], views=$18,
      unique_viewers=$19::text[], likes=$20, dislikes=$21, comments=$22,
      revenue=$23::jsonb, updated_at=now()
    WHERE id=$1`,
    [
      plain.id,
      plain.title,
      plain.description,
      plain.mediaUrl,
      plain.thumbnailUrl,
      plain.mediaType,
      plain.isExclusive,
      plain.accessTier,
      String(plain.creatorId),
      plain.status,
      !!plain.policyViolationLocked,
      plain.policyViolationLabel || '',
      plain.policyViolationLockedAt || null,
      plain.policyViolationLockedBy || null,
      plain.category,
      plain.price,
      (plain.purchasedUsers || []).map(String),
      plain.views,
      (plain.uniqueViewers || []).map(String),
      plain.likes,
      plain.dislikes,
      plain.comments,
      JSON.stringify(plain.revenue || { total: 0, breakdown: { subscriptionPay: 0, directPurchase: 0 } }),
    ]
  );
}

function hydrate(plain, { lean = false } = {}) {
  if (!plain) return null;
  const base = { ...plain, _id: plain.id };
  if (lean) {
    return {
      ...base,
      toObject() {
        return { ...base };
      },
    };
  }
  return {
    ...base,
    async save() {
      await persistPost({ ...plain, ...this });
    },
    toObject() {
      return { ...base };
    },
  };
}

function buildMatchSql(filter, params) {
  const parts = [];
  let i = params.length + 1;
  if (filter.creatorId) {
    if (filter.creatorId.$in) {
      parts.push(`creator_id = ANY($${i}::text[])`);
      params.push(filter.creatorId.$in.map(String));
      i += 1;
    } else {
      parts.push(`creator_id = $${i}`);
      params.push(String(filter.creatorId));
      i += 1;
    }
  }
  if (filter.status) {
    parts.push(`status = $${i}`);
    params.push(filter.status);
    i += 1;
  }
  if (filter.policyViolationLocked != null) {
    if (filter.policyViolationLocked.$ne === true) {
      parts.push(`(policy_violation_locked IS NOT TRUE)`);
    } else {
      parts.push(`policy_violation_locked = $${i}`);
      params.push(!!filter.policyViolationLocked);
      i += 1;
    }
  }
  if (filter.policyViolationLocked === true) {
    parts.push(`policy_violation_locked = TRUE`);
  }
  if (filter._id) {
    if (typeof filter._id === 'object' && filter._id.$in) {
      parts.push(`id = ANY($${i}::text[])`);
      params.push(filter._id.$in.map(String));
      i += 1;
    } else {
      parts.push(`id = $${i}`);
      params.push(String(filter._id));
      i += 1;
    }
  }
  return { sql: parts.length ? parts.join(' AND ') : 'TRUE', nextIndex: i };
}

function createQuery(filter, multi) {
  const state = { filter, multi, _select: null, _lean: false, _sort: null, _skip: 0, _limit: null, _populate: null };

  const chain = {
    select(s) {
      state._select = s;
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
      const params = [];
      const { sql } = buildMatchSql(state.filter, params);
      let order = 'ORDER BY created_at DESC';
      if (state._sort) {
        const k = Object.keys(state._sort)[0];
        const dir = state._sort[k] === 1 ? 'ASC' : 'DESC';
        const map = { createdAt: 'created_at', policyViolationLockedAt: 'policy_violation_locked_at' };
        order = `ORDER BY ${map[k] || k} ${dir}`;
      }
      const p = [...params];
      let lim = '';
      if (state._skip) {
        lim += ` OFFSET $${p.length + 1}`;
        p.push(state._skip);
      }
      if (state._limit != null) {
        lim += ` LIMIT $${p.length + 1}`;
        p.push(state._limit);
      } else if (!state.multi) {
        lim += ` LIMIT $${p.length + 1}`;
        p.push(1);
      }

      const res = await query(`SELECT * FROM posts WHERE ${sql} ${order}${lim}`, p);
      const rows = res.rows;
      const mapOne = async (row) => {
        let plain = fromRow(row);
        if (state._populate) {
          const Creator = require('./Creator');
          const path =
            typeof state._populate === 'string' ? state._populate : state._populate.path;
          const sel =
            typeof state._populate === 'object' && state._populate.select
              ? state._populate.select
              : '';
          if (path === 'creatorId') {
            let q = Creator.findById(plain.creatorId);
            if (sel) q = q.select(sel);
            const c = await q.lean().exec();
            plain = { ...plain, creatorId: c || plain.creatorId };
          }
        }
        return hydrate(plain, { lean: state._lean });
      };
      if (multi) {
        return Promise.all(rows.map((row) => mapOne(row)));
      }
      if (!rows[0]) return null;
      return mapOne(rows[0]);
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

async function aggregate(pipeline) {
  const first = pipeline[0];
  const m = first && first.$match;
  if (m && m.creatorId && m.creatorId.$in) {
    const ids = m.creatorId.$in.map(String);
    const res = await query(
      `SELECT * FROM posts WHERE creator_id = ANY($1::text[]) AND status = $2 AND (policy_violation_locked IS NOT TRUE) ORDER BY created_at DESC`,
      [ids, m.status || 'published']
    );
    const byCreator = new Map(ids.map((id) => [id, []]));
    for (const row of res.rows) {
      const p = fromRow(row);
      const cid = String(p.creatorId);
      const arr = byCreator.get(cid);
      if (arr && arr.length < 6) arr.push({ ...p, _id: p.id });
    }
    return ids.map((id) => ({ _id: id, posts: byCreator.get(id) || [] }));
  }
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

async function updateMany(filter, update) {
  const params = [];
  const { sql } = buildMatchSql(filter, params);
  const sets = [];
  let i = params.length + 1;
  if (update.$set) {
    if (update.$set.policyViolationLocked !== undefined) {
      sets.push(`policy_violation_locked = $${i++}`);
      params.push(!!update.$set.policyViolationLocked);
    }
    if (update.$set.policyViolationLabel !== undefined) {
      sets.push(`policy_violation_label = $${i++}`);
      params.push(update.$set.policyViolationLabel);
    }
    if (update.$set.policyViolationLockedAt !== undefined) {
      sets.push(`policy_violation_locked_at = $${i++}`);
      params.push(update.$set.policyViolationLockedAt);
    }
    if (update.$set.policyViolationLockedBy !== undefined) {
      sets.push(`policy_violation_locked_by = $${i++}`);
      params.push(update.$set.policyViolationLockedBy);
    }
    if (update.$set.status !== undefined) {
      sets.push(`status = $${i++}`);
      params.push(update.$set.status);
    }
  }
  if (!sets.length) return { modifiedCount: 0 };
  sets.push('updated_at = now()');
  const r = await query(`UPDATE posts SET ${sets.join(', ')} WHERE ${sql}`, params);
  return { modifiedCount: r.rowCount };
}

async function countDocuments(filter) {
  const params = [];
  const { sql } = buildMatchSql(filter, params);
  const r = await query(`SELECT COUNT(*)::int AS c FROM posts WHERE ${sql}`, params);
  return r.rows[0].c;
}

async function findByIdAndUpdate(id, update, opts = {}) {
  const row = (await query('SELECT * FROM posts WHERE id = $1', [String(id)])).rows[0];
  if (!row) return null;
  const plain = fromRow(row);
  if (update.$set) Object.assign(plain, update.$set);
  if (update.$inc) {
    if (update.$inc.views) plain.views = (plain.views || 0) + update.$inc.views;
    if (update.$inc.likes) plain.likes = (plain.likes || 0) + update.$inc.likes;
    if (update.$inc.dislikes) plain.dislikes = (plain.dislikes || 0) + update.$inc.dislikes;
    if (update.$inc.comments) plain.comments = (plain.comments || 0) + update.$inc.comments;
    if (update.$inc['revenue.total']) {
      plain.revenue = plain.revenue || { total: 0, breakdown: { subscriptionPay: 0, directPurchase: 0 } };
      plain.revenue.total = (Number(plain.revenue.total) || 0) + update.$inc['revenue.total'];
    }
    if (update.$inc['revenue.breakdown.directPurchase']) {
      plain.revenue = plain.revenue || { total: 0, breakdown: { subscriptionPay: 0, directPurchase: 0 } };
      plain.revenue.breakdown = plain.revenue.breakdown || { subscriptionPay: 0, directPurchase: 0 };
      plain.revenue.breakdown.directPurchase =
        (Number(plain.revenue.breakdown.directPurchase) || 0) + update.$inc['revenue.breakdown.directPurchase'];
    }
  }
  if (update.$addToSet && update.$addToSet.purchasedUsers) {
    const uid = String(update.$addToSet.purchasedUsers);
    plain.purchasedUsers = plain.purchasedUsers || [];
    if (!plain.purchasedUsers.some((x) => String(x) === uid)) plain.purchasedUsers = [...plain.purchasedUsers, uid];
  }
  await persistPost(plain);
  const fresh = fromRow((await query('SELECT * FROM posts WHERE id = $1', [String(id)])).rows[0]);
  return opts.new ? hydrate(fresh, { lean: false }) : hydrate(fresh, { lean: false });
}

async function findByIdAndDelete(id) {
  await query('DELETE FROM posts WHERE id = $1', [String(id)]);
}

async function create(data) {
  const id = newObjectId();
  const revenue = data.revenue || { total: 0, breakdown: { subscriptionPay: 0, directPurchase: 0 } };
  await query(
    `INSERT INTO posts (
      id, title, description, media_url, thumbnail_url, media_type, is_exclusive, access_tier, creator_id, status,
      policy_violation_locked, policy_violation_label, policy_violation_locked_at, policy_violation_locked_by,
      category, price, purchased_users, views, unique_viewers, likes, dislikes, comments, revenue
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::text[],$18,$19::text[],$20,$21,$22,$23::jsonb
    )`,
    [
      id,
      data.title,
      data.description ?? '',
      data.mediaUrl,
      data.thumbnailUrl ?? '',
      data.mediaType,
      !!data.isExclusive,
      data.accessTier || 'everyone',
      String(data.creatorId),
      data.status || 'published',
      !!data.policyViolationLocked,
      data.policyViolationLabel || '',
      data.policyViolationLockedAt || null,
      data.policyViolationLockedBy || null,
      data.category || 'content',
      data.price ?? 0,
      (data.purchasedUsers || []).map(String),
      data.views ?? 0,
      (data.uniqueViewers || []).map(String),
      data.likes ?? 0,
      data.dislikes ?? 0,
      data.comments ?? 0,
      JSON.stringify(revenue),
    ]
  );
  return hydrate(fromRow((await query('SELECT * FROM posts WHERE id = $1', [id])).rows[0]));
}

const Post = {
  find(filter = {}) {
    return createQuery(filter, true);
  },
  findById(id) {
    return createQuery({ _id: String(id) }, false);
  },
  findOne(filter) {
    return createQuery(filter || {}, false);
  },
  create,
  findByIdAndUpdate,
  findByIdAndDelete,
  updateMany,
  countDocuments,
  aggregate,
};

module.exports = Post;
