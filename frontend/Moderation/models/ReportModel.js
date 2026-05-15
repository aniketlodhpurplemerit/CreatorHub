const { query } = require('../../../backend/db/pool');
const { newObjectId } = require('../../../backend/utils/objectId');

function fromRow(row) {
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

function leanDoc(pl) {
  return { ...pl, _id: pl.id, toObject: () => ({ ...pl, _id: pl.id }) };
}

function attachSave(pl) {
  if (!pl) return null;
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

function makeChain(filter, multi) {
  const st = { filter: filter || {}, multi, _sort: null, _lean: false };
  const ch = {
    sort(s) {
      st._sort = s;
      return ch;
    },
    lean() {
      st._lean = true;
      return ch;
    },
    async exec() {
      const f = st.filter;
      const params = [];
      const parts = [];
      let i = 1;

      if (f._id) {
        parts.push(`id = $${i}`);
        params.push(String(f._id));
        i += 1;
      } else if (f.targetId && f.targetType && f.status) {
        parts.push(`target_id = $${i} AND target_type = $${i + 1} AND status = $${i + 2}`);
        params.push(String(f.targetId), f.targetType, f.status);
        i += 3;
      } else if (f.targetOwnerId) {
        parts.push(`target_owner_id = $${i}`);
        params.push(String(f.targetOwnerId));
        i += 1;
      } else if (f.$or && Array.isArray(f.$or)) {
        const uidEntry = f.$or.find((x) => x.reportedBy);
        const uid = String(uidEntry?.reportedBy || f.$or[0]?.additionalReporters || '');
        parts.push(`(reported_by = $${i} OR $${i} = ANY(additional_reporters))`);
        params.push(uid);
        i += 1;
      }

      const w = parts.length ? parts.join(' AND ') : 'TRUE';
      let order = 'ORDER BY created_at DESC';
      if (st._sort && st._sort.createdAt) order = `ORDER BY created_at ${st._sort.createdAt === 1 ? 'ASC' : 'DESC'}`;
      const lim = multi ? '' : ' LIMIT 1';
      const res = await query(`SELECT * FROM moderation_reports WHERE ${w} ${order}${lim}`, params);
      const rows = res.rows.map((r) => fromRow(r));
      const mapOne = (pl) => (st._lean ? leanDoc(pl) : attachSave(pl));
      return multi ? rows.map(mapOne) : rows[0] ? mapOne(rows[0]) : null;
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

const Report = {
  find(filter) {
    return makeChain(filter, true);
  },
  findOne(filter) {
    return makeChain(filter, false);
  },
  findById(id) {
    return makeChain({ _id: String(id) }, false);
  },
  async updateOne(filter, update) {
    if (filter._id && update.$addToSet?.additionalReporters) {
      const rid = String(update.$addToSet.additionalReporters);
      await query(
        `UPDATE moderation_reports SET additional_reporters = array_append(additional_reporters, $2::text)
         WHERE id = $1 AND NOT ($2::text = ANY(additional_reporters))`,
        [String(filter._id), rid]
      );
    }
  },
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO moderation_reports (id, reported_by, target_id, target_type, reason, comment, status, additional_reporters, target_owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9)`,
      [
        id,
        String(data.reportedBy),
        String(data.targetId),
        data.targetType,
        data.reason,
        data.comment || '',
        data.status || 'pending',
        [],
        data.targetOwnerId ? String(data.targetOwnerId) : null,
      ]
    );
    return fromRow((await query('SELECT * FROM moderation_reports WHERE id=$1', [id])).rows[0]);
  },
};

module.exports = Report;
