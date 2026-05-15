const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function fromRow(row) {
  if (!row) return null;
  let attachments = row.attachments;
  if (attachments && typeof attachments === 'string') {
    try {
      attachments = JSON.parse(attachments);
    } catch {
      attachments = [];
    }
  }
  if (!Array.isArray(attachments)) attachments = [];
  return {
    id: row.id,
    _id: row.id,
    creatorId: row.creator_id,
    banId: row.ban_id,
    appealType: row.appeal_type,
    postIds: (row.post_ids || []).map(String),
    reason: row.reason,
    supportingInfo: row.supporting_info,
    attachments,
    supportTicketId: row.support_ticket_id,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function persistAppeal(plain) {
  await query(
    `UPDATE appeals SET
      creator_id=$2, ban_id=$3, appeal_type=$4, post_ids=$5::text[], reason=$6, supporting_info=$7,
      attachments=$8::jsonb, support_ticket_id=$9, status=$10, submitted_at=$11, reviewed_by=$12,
      reviewed_at=$13, admin_note=$14, updated_at=now()
    WHERE id=$1`,
    [
      plain.id,
      String(plain.creatorId),
      plain.banId || null,
      plain.appealType,
      (plain.postIds || []).map(String),
      plain.reason,
      plain.supportingInfo || '',
      JSON.stringify(plain.attachments || []),
      plain.supportTicketId || '',
      plain.status,
      plain.submittedAt || new Date(),
      plain.reviewedBy || null,
      plain.reviewedAt || null,
      plain.adminNote || '',
    ]
  );
}

async function expandBanForAppeal(banId, popSpec) {
  const row = (await query('SELECT * FROM security_bans WHERE id = $1', [String(banId)])).rows[0];
  if (!row) return null;
  const User = require('./User');
  const Report = require('./Report');
  const b = {
    _id: row.id,
    id: row.id,
    userId: row.user_id,
    bannedBy: row.banned_by,
    reportId: row.report_id,
    reason: row.reason,
    banType: row.ban_type,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: row.is_active,
    liftedBy: row.lifted_by,
    liftedAt: row.lifted_at,
    liftReason: row.lift_reason,
    async save() {
      await query(
        `UPDATE security_bans SET is_active=$2, lifted_by=$3, lifted_at=$4, lift_reason=$5, updated_at=now() WHERE id=$1`,
        [row.id, !!b.isActive, b.liftedBy || null, b.liftedAt || null, b.liftReason || '']
      );
    },
  };
  const nested = popSpec && popSpec.populate ? popSpec.populate : [];
  for (const p of nested) {
    if (p.path === 'bannedBy' && b.bannedBy) {
      b.bannedBy = await User.findById(String(b.bannedBy)).select(p.select).lean().exec();
    }
    if (p.path === 'liftedBy' && b.liftedBy) {
      b.liftedBy = await User.findById(String(b.liftedBy)).select(p.select).lean().exec();
    }
    if (p.path === 'reportId' && b.reportId) {
      let rep = await Report.findById(String(b.reportId)).lean().exec();
      if (rep && p.populate) {
        for (const rp of p.populate) {
          if (rp.path === 'reportedBy' && rep.reportedBy) {
            rep = { ...rep, reportedBy: await User.findById(String(rep.reportedBy)).select(rp.select).lean().exec() };
          }
          if (rp.path === 'creatorId' && rep.creatorId) {
            rep = { ...rep, creatorId: await User.findById(String(rep.creatorId)).select(rp.select).lean().exec() };
          }
          if (rp.path === 'postId' && rep.postId) {
            const Post = require('./Post');
            rep = { ...rep, postId: await Post.findById(String(rep.postId)).select(rp.select).lean().exec() };
          }
        }
      }
      b.reportId = rep || b.reportId;
    }
  }
  return b;
}

function hydrate(plain) {
  if (!plain) return null;
  plain._id = plain.id;
  plain.save = async () => persistAppeal(plain);
  plain.toObject = () => ({ ...plain, _id: plain.id });
  return plain;
}

async function applyPopulates(pl, pops) {
  const User = require('./User');
  const Post = require('./Post');
  let out = { ...pl };
  for (const pop of pops) {
    if (pop.path === 'creatorId' && out.creatorId) {
      out.creatorId = await User.findById(String(out.creatorId)).select(pop.select).lean().exec();
    }
    if (pop.path === 'reviewedBy' && out.reviewedBy) {
      out.reviewedBy = await User.findById(String(out.reviewedBy)).select(pop.select).lean().exec();
    }
    if (pop.path === 'postIds' && Array.isArray(out.postIds)) {
      const posts = [];
      for (const pid of out.postIds) {
        const po = await Post.findById(String(pid)).select(pop.select).lean().exec();
        if (po) posts.push(po);
      }
      out.postIds = posts;
    }
    if (pop.path === 'banId' && out.banId) {
      if (pop.populate) {
        out.banId = await expandBanForAppeal(out.banId, pop);
      } else {
        const r = (await query('SELECT * FROM security_bans WHERE id = $1', [String(out.banId)])).rows[0];
        if (r) {
          out.banId = {
            _id: r.id,
            userId: r.user_id,
            bannedBy: r.banned_by,
            reportId: r.report_id,
            reason: r.reason,
            banType: r.ban_type,
            startDate: r.start_date,
            endDate: r.end_date,
            isActive: r.is_active,
            liftedBy: r.lifted_by,
            liftedAt: r.lifted_at,
            liftReason: r.lift_reason,
            async save() {
              await query(
                `UPDATE security_bans SET is_active=$2, lifted_by=$3, lifted_at=$4, lift_reason=$5, updated_at=now() WHERE id=$1`,
                [r.id, !!out.banId.isActive, out.banId.liftedBy || null, out.banId.liftedAt || null, out.banId.liftReason || '']
              );
            },
          };
        }
      }
    }
  }
  return out;
}

function buildWhere(f, params) {
  const parts = [];
  let i = params.length + 1;
  if (f._id) {
    parts.push(`id = $${i}`);
    params.push(String(f._id));
    i += 1;
  }
  if (f.status) {
    if (f.status.$in) {
      parts.push(`status = ANY($${i}::text[])`);
      params.push(f.status.$in);
      i += 1;
    } else if (f.status.$ne) {
      parts.push(`status <> $${i}`);
      params.push(String(f.status.$ne));
      i += 1;
    } else {
      parts.push(`status = $${i}`);
      params.push(f.status);
      i += 1;
    }
  }
  if (f.creatorId) {
    parts.push(`creator_id = $${i}`);
    params.push(String(f.creatorId));
    i += 1;
  }
  if (f.appealType) {
    parts.push(`appeal_type = $${i}`);
    params.push(f.appealType);
    i += 1;
  }
  if (f.banId) {
    parts.push(`ban_id = $${i}`);
    params.push(String(f.banId));
    i += 1;
  }
  if (f.postIds) {
    parts.push(`$${i} = ANY(post_ids)`);
    params.push(String(f.postIds));
    i += 1;
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function makeChain(filter, multi) {
  const st = { filter, multi, _sort: null, _skip: 0, _limit: null, _populates: [] };
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
    populate(spec) {
      st._populates.push(spec);
      return ch;
    },
    async exec() {
      const params = [];
      const w = buildWhere(st.filter, params);
      let order = 'ORDER BY COALESCE(submitted_at, created_at) DESC, created_at DESC';
      if (st._sort && st._sort.createdAt) order = `ORDER BY created_at ${st._sort.createdAt === 1 ? 'ASC' : 'DESC'}`;
      if (st._sort && st._sort.submittedAt) order = `ORDER BY submitted_at ${st._sort.submittedAt === 1 ? 'ASC' : 'DESC'}`;
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
      const res = await query(`SELECT * FROM appeals WHERE ${w} ${order}${lim}`, p);
      const rows = res.rows;
      const mapRow = async (row) => {
        let pl = fromRow(row);
        pl = await applyPopulates(pl, st._populates);
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

const Appeal = {
  exists(filter) {
    return (async () => {
      const params = [];
      const w = buildWhere(filter, params);
      const r = await query(`SELECT EXISTS(SELECT 1 FROM appeals WHERE ${w}) AS e`, params);
      return Boolean(r.rows[0].e);
    })();
  },
  find(f) {
    return makeChain(f, true);
  },
  findOne(f) {
    return makeChain(f, false);
  },
  findById(id) {
    return makeChain({ _id: String(id) }, false);
  },
  countDocuments(filter) {
    return (async () => {
      const params = [];
      const w = buildWhere(filter, params);
      const r = await query(`SELECT COUNT(*)::int AS c FROM appeals WHERE ${w}`, params);
      return r.rows[0].c;
    })();
  },
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO appeals (id, creator_id, ban_id, appeal_type, post_ids, reason, supporting_info, attachments, support_ticket_id, status, submitted_at)
       VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8::jsonb,$9,$10,COALESCE($11::timestamptz, now()))`,
      [
        id,
        String(data.creatorId),
        data.banId ? String(data.banId) : null,
        data.appealType || 'ban',
        (data.postIds || []).map(String),
        data.reason,
        data.supportingInfo || '',
        JSON.stringify(data.attachments || []),
        data.supportTicketId || '',
        data.status || 'pending',
        data.submittedAt || null,
      ]
    );
    return hydrate(fromRow((await query('SELECT * FROM appeals WHERE id=$1', [id])).rows[0]));
  },
};

module.exports = Appeal;
