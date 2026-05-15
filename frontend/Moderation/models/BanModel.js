const { query } = require('../../../backend/db/pool');
const { newObjectId } = require('../../../backend/utils/objectId');

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    userId: row.user_id,
    type: row.type,
    duration: row.duration,
    reason: row.reason,
    issuedBy: row.issued_by,
    relatedReportId: row.related_report_id,
    expiresAt: row.expires_at,
    isActive: row.is_active,
    appealStatus: row.appeal_status,
    appealNote: row.appeal_note,
    appealReviewedBy: row.appeal_reviewed_by,
    notified: row.notified,
    createdAt: row.created_at,
  };
}

async function persist(plain) {
  await query(
    `UPDATE moderation_bans SET
      user_id=$2, type=$3, duration=$4, reason=$5, issued_by=$6, related_report_id=$7, expires_at=$8,
      is_active=$9, appeal_status=$10, appeal_note=$11, appeal_reviewed_by=$12, notified=$13
    WHERE id=$1`,
    [
      plain.id,
      String(plain.userId),
      plain.type,
      plain.duration,
      plain.reason,
      plain.issuedBy || null,
      plain.relatedReportId || null,
      plain.expiresAt || null,
      !!plain.isActive,
      plain.appealStatus || 'none',
      plain.appealNote || '',
      plain.appealReviewedBy || null,
      !!plain.notified,
    ]
  );
}

function hydrate(plain, lean) {
  if (!plain) return null;
  if (lean) return { ...plain, _id: plain.id, toObject: () => ({ ...plain, _id: plain.id }) };
  const doc = { ...plain, _id: plain.id };
  doc.save = async () => persist(doc);
  doc.toObject = () => ({ ...plain, _id: plain.id });
  return doc;
}

function buildWhere(f, params) {
  const parts = [];
  let i = params.length + 1;
  if (f.userId) {
    parts.push(`user_id = $${i}`);
    params.push(String(f.userId));
    i += 1;
  }
  if (f.isActive === true) {
    parts.push(`is_active = true`);
  }
  if (f.appealStatus) {
    parts.push(`appeal_status = $${i}`);
    params.push(f.appealStatus);
    i += 1;
  }
  if (f.$or && f.userId) {
    const now = f.$or[0]?.expiresAt?.$gt || f.$or[1]?.expiresAt?.$gt;
    if (now) {
      parts.push(`(expires_at > $${i} OR expires_at IS NULL)`);
      params.push(now);
      i += 1;
    }
  }
  if (f._id) {
    parts.push(`id = $${i}`);
    params.push(String(f._id));
    i += 1;
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function makeChain(filter, multi) {
  const st = { filter, multi, _sort: null, _skip: 0, _limit: null, _lean: false };
  const ch = {
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
    lean() {
      st._lean = true;
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
      } else if (!multi) {
        lim += ' LIMIT 1';
      }
      const res = await query(`SELECT * FROM moderation_bans WHERE ${w} ${order}${lim}`, p);
      const rows = res.rows.map((r) => hydrate(fromRow(r), st._lean));
      return multi ? rows : rows[0] || null;
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

const Ban = {
  find(filter) {
    return makeChain(filter, true);
  },
  findOne(filter) {
    return makeChain(filter, false);
  },
  findById(id) {
    return makeChain({ _id: String(id) }, false);
  },
  findByIdAndUpdate(id, update, opts) {
    const ch = {
      _lean: false,
      lean() {
        ch._lean = true;
        return ch;
      },
      async exec() {
        const row = (await query('SELECT * FROM moderation_bans WHERE id = $1', [String(id)])).rows[0];
        if (!row) return null;
        const pl = fromRow(row);
        if (update.$set) Object.assign(pl, update.$set);
        await persist(pl);
        const fresh = fromRow((await query('SELECT * FROM moderation_bans WHERE id = $1', [String(id)])).rows[0]);
        return hydrate(fresh, ch._lean);
      },
      then(onF, onR) {
        return ch.exec().then(onF, onR);
      },
    };
    return ch;
  },
  async countDocuments(filter) {
    const params = [];
    const w = buildWhere(filter, params);
    const r = await query(`SELECT COUNT(*)::int AS c FROM moderation_bans WHERE ${w}`, params);
    return r.rows[0].c;
  },
  async updateMany(filter, update) {
    if (update.$set?.isActive !== false) return { modifiedCount: 0 };
    const uid = String(filter.userId);
    if (filter.expiresAt && filter.expiresAt.$lte != null) {
      const r = await query(
        `UPDATE moderation_bans SET is_active = false WHERE user_id = $1 AND is_active = true AND expires_at IS NOT NULL AND expires_at <= $2`,
        [uid, filter.expiresAt.$lte]
      );
      return { modifiedCount: r.rowCount };
    }
    const r = await query(
      `UPDATE moderation_bans SET is_active = false WHERE user_id = $1 AND is_active = true`,
      [uid]
    );
    return { modifiedCount: r.rowCount };
  },
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO moderation_bans (id, user_id, type, duration, reason, issued_by, related_report_id, expires_at, is_active, appeal_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        String(data.userId),
        data.type,
        data.duration,
        data.reason,
        data.issuedBy ? String(data.issuedBy) : null,
        data.relatedReportId ? String(data.relatedReportId) : null,
        data.expiresAt || null,
        data.isActive !== false,
        data.appealStatus || 'none',
      ]
    );
    return hydrate(fromRow((await query('SELECT * FROM moderation_bans WHERE id=$1', [id])).rows[0]), false);
  },
};

module.exports = Ban;
