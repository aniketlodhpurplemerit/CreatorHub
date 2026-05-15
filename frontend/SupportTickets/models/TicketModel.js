const { query } = require('../../../backend/db/pool');
const { newObjectId } = require('../../../backend/utils/objectId');

function reportFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    reportedBy: row.reported_by,
    targetId: row.target_id,
    targetType: row.target_type,
    reason: row.reason,
    comment: row.comment,
    status: row.status,
    additionalReporters: (row.additional_reporters || []).map(String),
    resolvedBy: row.resolved_by,
    resolution: row.resolution,
    duplicateOf: row.duplicate_of,
    targetOwnerId: row.target_owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function attachReportSave(pl) {
  const o = { ...pl, _id: pl.id };
  o.save = async () => {
    await query(
      `UPDATE moderation_reports SET
        reported_by=$2, target_id=$3, target_type=$4, reason=$5, comment=$6, status=$7,
        additional_reporters=$8::text[], resolved_by=$9, resolution=$10, duplicate_of=$11,
        target_owner_id=$12, updated_at=now()
       WHERE id=$1`,
      [
        o.id,
        String(o.reportedBy),
        String(o.targetId),
        o.targetType,
        o.reason,
        o.comment || '',
        o.status,
        (o.additionalReporters || []).map(String),
        o.resolvedBy ? String(o.resolvedBy) : null,
        o.resolution || '',
        o.duplicateOf ? String(o.duplicateOf) : null,
        o.targetOwnerId ? String(o.targetOwnerId) : null,
      ]
    );
  };
  return o;
}

function fromRow(row) {
  if (!row) return null;
  let attachments = row.attachments;
  if (attachments == null) attachments = [];
  else if (typeof attachments === 'string') {
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
    ticketId: row.ticket_id,
    reportId: row.report_id || null,
    sourceType: row.source_type,
    submittedBy: row.submitted_by || null,
    submitterRole: row.submitter_role || null,
    tag: row.tag || null,
    heading: row.heading,
    description: row.description,
    attachments,
    adminResponse: row.admin_response,
    respondedAt: row.responded_at,
    status: row.status,
    priority: row.priority,
    issueType: row.issue_type,
    assignedTo: row.assigned_to || null,
    assignedBy: row.assigned_by || null,
    assignedAt: row.assigned_at,
    resolvedBy: row.resolved_by || null,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    reporterCount: row.reporter_count,
    escalatedTo: row.escalated_to || null,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pickFields(obj, selectStr) {
  if (!selectStr) return obj;
  const keys = selectStr.split(/\s+/).filter(Boolean);
  const out = { _id: obj._id || obj.id, id: obj.id };
  keys.forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

async function persistTicket(p) {
  await query(
    `UPDATE support_tickets SET
      ticket_id=$2, report_id=$3, source_type=$4, submitted_by=$5, submitter_role=$6,
      tag=$7, heading=$8, description=$9, attachments=$10::jsonb, admin_response=$11,
      responded_at=$12, status=$13, priority=$14, issue_type=$15, assigned_to=$16,
      assigned_by=$17, assigned_at=$18, resolved_by=$19, resolved_at=$20,
      resolution_note=$21, reporter_count=$22, escalated_to=$23, last_activity_at=$24,
      updated_at=now()
     WHERE id=$1`,
    [
      p.id,
      p.ticketId,
      p.reportId ? String(p.reportId) : null,
      p.sourceType,
      p.submittedBy ? String(p.submittedBy) : null,
      p.submitterRole || null,
      p.tag || null,
      p.heading || '',
      p.description || '',
      JSON.stringify(p.attachments || []),
      p.adminResponse ?? null,
      p.respondedAt || null,
      p.status,
      p.priority,
      p.issueType,
      p.assignedTo ? String(p.assignedTo) : null,
      p.assignedBy ? String(p.assignedBy) : null,
      p.assignedAt || null,
      p.resolvedBy ? String(p.resolvedBy) : null,
      p.resolvedAt || null,
      p.resolutionNote || '',
      p.reporterCount ?? 1,
      p.escalatedTo || null,
      p.lastActivityAt || new Date(),
    ]
  );
}

function hydrateTicket(plain) {
  if (!plain) return null;
  const o = { ...plain, _id: plain.id };
  o.save = async () => persistTicket(o);
  return o;
}

function leanTicket(plain) {
  const o = { ...plain, _id: plain.id };
  return o;
}

function buildWhere(filter, params) {
  const parts = [];
  let i = params.length + 1;

  if (filter.ticketId) {
    parts.push(`ticket_id = $${i}`);
    params.push(String(filter.ticketId));
    i += 1;
  }
  if (filter.reportId != null && filter.reportId !== '') {
    parts.push(`report_id = $${i}`);
    params.push(String(filter.reportId));
    i += 1;
  }
  if (filter.sourceType) {
    parts.push(`source_type = $${i}`);
    params.push(filter.sourceType);
    i += 1;
  }
  if (filter.submittedBy) {
    parts.push(`submitted_by = $${i}`);
    params.push(String(filter.submittedBy));
    i += 1;
  }
  if (filter.status) {
    if (filter.status.$in && Array.isArray(filter.status.$in)) {
      parts.push(`status = ANY($${i}::text[])`);
      params.push(filter.status.$in);
      i += 1;
    } else {
      parts.push(`status = $${i}`);
      params.push(filter.status);
      i += 1;
    }
  }
  if (filter.priority) {
    parts.push(`priority = $${i}`);
    params.push(filter.priority);
    i += 1;
  }
  if (filter.assignedTo === null) {
    parts.push('assigned_to IS NULL');
  } else if (filter.assignedTo != null && filter.assignedTo !== undefined) {
    if (filter.assignedTo.$in && Array.isArray(filter.assignedTo.$in)) {
      parts.push(`assigned_to = ANY($${i}::text[])`);
      params.push(filter.assignedTo.$in.map(String));
      i += 1;
    } else {
      parts.push(`assigned_to = $${i}`);
      params.push(String(filter.assignedTo));
      i += 1;
    }
  }
  if (filter.createdAt && filter.createdAt.$lte != null) {
    parts.push(`created_at <= $${i}::timestamptz`);
    params.push(new Date(filter.createdAt.$lte));
    i += 1;
  }
  if (filter.resolvedAt && filter.resolvedAt.$gte != null) {
    parts.push(`resolved_at >= $${i}::timestamptz`);
    params.push(new Date(filter.resolvedAt.$gte));
    i += 1;
  }

  return parts.length ? parts.join(' AND ') : 'TRUE';
}

function applyTicketSelect(plain, selectStr) {
  if (!selectStr) return plain;
  const fields = selectStr.split(/\s+/).filter(Boolean);
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
}

function sortSql(spec) {
  if (!spec || !Object.keys(spec).length) return 'ORDER BY last_activity_at DESC';
  const k = Object.keys(spec)[0];
  const dir = spec[k] === 1 ? 'ASC' : 'DESC';
  const col = k === 'createdAt' ? 'created_at' : k === 'lastActivityAt' ? 'last_activity_at' : 'updated_at';
  return `ORDER BY ${col} ${dir}`;
}

async function loadUserLean(userId, selectStr) {
  if (!userId) return null;
  const row = (await query('SELECT * FROM users WHERE id = $1', [String(userId)])).rows[0];
  if (!row) return null;
  const u = {
    _id: row.id,
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatar: row.avatar,
  };
  return pickFields(u, selectStr);
}

async function loadAdminLean(adminId, selectStr) {
  if (!adminId) return null;
  const row = (await query('SELECT * FROM admins WHERE id = $1', [String(adminId)])).rows[0];
  if (!row) return null;
  const a = {
    _id: row.id,
    id: row.id,
    name: row.name,
    avatarInitials: row.avatar_initials,
    avatarColor: row.avatar_color,
    role: row.role,
  };
  return pickFields(a, selectStr);
}

async function populateTicketDoc(doc, specs, ticketLean) {
  let out = { ...doc };
  for (const spec of specs) {
    const path = spec.path || spec;
    if (path === 'reportId' && out.reportId && typeof out.reportId === 'string') {
      const row = (await query('SELECT * FROM moderation_reports WHERE id = $1', [String(out.reportId)])).rows[0];
      if (!row) {
        out.reportId = null;
        continue;
      }
      let r = reportFromRow(row);
      r = pickFields(r, spec.select);
      if (spec.populate?.path === 'reportedBy' && r.reportedBy) {
        const ru = await loadUserLean(r.reportedBy, spec.populate.select);
        r.reportedBy = ru;
      }
      if (ticketLean) {
        r = { ...r, _id: r.id };
      } else {
        r = attachReportSave(r);
      }
      out.reportId = r;
    } else if (path === 'submittedBy' && out.submittedBy) {
      out.submittedBy = await loadUserLean(out.submittedBy, spec.select);
    } else if (path === 'assignedTo' && out.assignedTo) {
      out.assignedTo = await loadAdminLean(out.assignedTo, spec.select);
    } else if (path === 'assignedBy' && out.assignedBy) {
      out.assignedBy = await loadAdminLean(out.assignedBy, spec.select);
    } else if (path === 'resolvedBy' && out.resolvedBy) {
      out.resolvedBy = await loadAdminLean(out.resolvedBy, spec.select);
    }
  }
  return out;
}

function createTicketChain(filter, multi) {
  const state = {
    filter: filter || {},
    multi,
    _sort: null,
    _skip: 0,
    _limit: null,
    _select: null,
    _lean: false,
    _populates: [],
  };
  const chain = {
    sort(s) {
      state._sort = s;
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
    select(s) {
      state._select = s;
      return chain;
    },
    lean() {
      state._lean = true;
      return chain;
    },
    populate(spec) {
      state._populates.push(typeof spec === 'string' ? { path: spec } : spec);
      return chain;
    },
    async exec() {
      const params = [];
      const w = buildWhere(state.filter, params);
      const order = sortSql(state._sort);
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
        limSql += ` LIMIT 1`;
      }
      const res = await query(`SELECT * FROM support_tickets WHERE ${w} ${order}${limSql}`, p);
      const rows = res.rows.map((r) => fromRow(r));

      const mapOne = async (plain) => {
        let shaped = applyTicketSelect(plain, state._select);
        if (state._populates.length) {
          shaped = await populateTicketDoc(shaped, state._populates, state._lean);
        }
        return state._lean ? leanTicket(shaped) : hydrateTicket(shaped);
      };

      if (state.multi) {
        return Promise.all(rows.map(mapOne));
      }
      const first = rows[0];
      if (!first) return null;
      return mapOne(first);
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

const TicketCounter = {
  async findOneAndUpdate(filter, update /* , opts */) {
    const key = filter.key || 'support_ticket';
    const r = await query(
      `INSERT INTO support_ticket_counters (key, seq) VALUES ($1, 1)
       ON CONFLICT (key) DO UPDATE SET seq = support_ticket_counters.seq + 1
       RETURNING key, seq`,
      [key]
    );
    return { key: r.rows[0].key, seq: r.rows[0].seq };
  },
};

const Ticket = {
  find(filter) {
    return createTicketChain(filter, true);
  },
  findOne(filter) {
    return createTicketChain(filter, false);
  },
  async countDocuments(filter) {
    const params = [];
    const w = buildWhere(filter || {}, params);
    const r = await query(`SELECT COUNT(*)::int AS c FROM support_tickets WHERE ${w}`, params);
    return r.rows[0].c;
  },
  async create(data) {
    const id = newObjectId();
    const attachments = Array.isArray(data.attachments) ? data.attachments : [];
    await query(
      `INSERT INTO support_tickets (
        id, ticket_id, report_id, source_type, submitted_by, submitter_role, tag,
        heading, description, attachments, admin_response, responded_at, status, priority, issue_type,
        assigned_to, assigned_by, assigned_at, resolved_by, resolved_at, resolution_note,
        reporter_count, escalated_to, last_activity_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
      )`,
      [
        id,
        data.ticketId,
        data.reportId ? String(data.reportId) : null,
        data.sourceType || 'user_report',
        data.submittedBy ? String(data.submittedBy) : null,
        data.submitterRole || null,
        data.tag || null,
        data.heading ?? '',
        data.description ?? '',
        JSON.stringify(attachments),
        data.adminResponse ?? null,
        data.respondedAt || null,
        data.status || 'open',
        data.priority,
        data.issueType,
        data.assignedTo ? String(data.assignedTo) : null,
        data.assignedBy ? String(data.assignedBy) : null,
        data.assignedAt || null,
        data.resolvedBy ? String(data.resolvedBy) : null,
        data.resolvedAt || null,
        data.resolutionNote ?? '',
        data.reporterCount ?? 1,
        data.escalatedTo || null,
        data.lastActivityAt || new Date(),
      ]
    );
    return hydrateTicket(fromRow((await query('SELECT * FROM support_tickets WHERE id=$1', [id])).rows[0]));
  },
  async aggregate(pipeline) {
    const first = pipeline[0];
    if (first.$facet) {
      const facet = first.$facet;
      const startOfToday = new Date();
      const rtGte = facet.resolvedToday?.[0]?.$match?.resolvedAt?.$gte;
      if (rtGte != null) {
        startOfToday.setTime(new Date(rtGte).getTime());
      } else {
        startOfToday.setHours(0, 0, 0, 0);
      }
      const r = await query(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
          COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_count,
          COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at >= $1::timestamptz)::int AS resolved_today_count,
          COUNT(*) FILTER (WHERE priority = 'high' AND status IN ('open','in_progress'))::int AS high_priority_count
         FROM support_tickets`,
        [startOfToday]
      );
      const row = r.rows[0];
      return [
        {
          open: [{ count: row.open_count }],
          in_progress: [{ count: row.in_progress_count }],
          resolvedToday: [{ count: row.resolved_today_count }],
          highPriority: [{ count: row.high_priority_count }],
        },
      ];
    }
    if (first.$match && pipeline[1]?.$group) {
      const m = first.$match;
      const params = [];
      const parts = [];
      let i = 1;
      if (m.status?.$in) {
        parts.push(`status = ANY($${i}::text[])`);
        params.push(m.status.$in);
        i += 1;
      }
      if (m.assignedTo?.$in) {
        parts.push(`assigned_to = ANY($${i}::text[])`);
        params.push(m.assignedTo.$in.map(String));
        i += 1;
      }
      const w = parts.length ? parts.join(' AND ') : 'TRUE';
      const res = await query(
        `SELECT assigned_to AS _id, COUNT(*)::int AS count FROM support_tickets WHERE ${w} AND assigned_to IS NOT NULL GROUP BY assigned_to`,
        params
      );
      return res.rows;
    }
    return [];
  },
};

module.exports = {
  Ticket,
  TicketCounter,
};
