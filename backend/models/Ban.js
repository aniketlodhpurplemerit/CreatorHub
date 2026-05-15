const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
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
        `UPDATE security_bans SET
          user_id=$2, banned_by=$3, report_id=$4, reason=$5, ban_type=$6, start_date=$7, end_date=$8,
          is_active=$9, lifted_by=$10, lifted_at=$11, lift_reason=$12, updated_at=now()
        WHERE id=$1`,
        [
          plain.id,
          String(plain.userId),
          String(plain.bannedBy),
          plain.reportId || null,
          plain.reason,
          plain.banType,
          plain.startDate || new Date(),
          plain.endDate || null,
          !!plain.isActive,
          plain.liftedBy || null,
          plain.liftedAt || null,
          plain.liftReason || '',
        ]
      );
    },
    toObject() {
      return { ...plain, _id: plain.id };
    },
  };
}

async function getActiveBan(userId) {
  const r = await query(
    `SELECT * FROM security_bans WHERE user_id = $1 AND is_active = true
     AND (ban_type = 'permanent' OR end_date IS NULL OR end_date > now())
     ORDER BY created_at DESC LIMIT 1`,
    [String(userId)]
  );
  return r.rows[0] ? hydrate(fromRow(r.rows[0])) : null;
}

async function expireOldBans() {
  return query(
    `UPDATE security_bans SET is_active = false, updated_at = now()
     WHERE ban_type = 'temporary' AND is_active = true AND end_date IS NOT NULL AND end_date <= now()`
  );
}

async function create(data) {
  const id = newObjectId();
  await query(
    `INSERT INTO security_bans (id, user_id, banned_by, report_id, reason, ban_type, start_date, end_date, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()),$8,true)`,
    [
      id,
      String(data.userId),
      String(data.bannedBy),
      data.reportId ? String(data.reportId) : null,
      data.reason,
      data.banType,
      data.startDate || null,
      data.endDate || null,
    ]
  );
  return hydrate(fromRow((await query('SELECT * FROM security_bans WHERE id=$1', [id])).rows[0]));
}

const Ban = {
  getActiveBan,
  expireOldBans,
  create,
};

module.exports = Ban;
