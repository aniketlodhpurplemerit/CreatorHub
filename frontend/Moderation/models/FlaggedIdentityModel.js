const { query } = require('../../../backend/db/pool');
const { newObjectId } = require('../../../backend/utils/objectId');

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    email: row.email,
    phone: row.phone,
    username: row.username,
    deviceFingerprints: (row.device_fingerprints || []).map(String),
    ipAddresses: (row.ip_addresses || []).map(String),
    relatedBanId: row.related_ban_id,
    flaggedBy: row.flagged_by,
    flaggedAt: row.flagged_at,
  };
}

function buildOrWhereFromClauses(clauses, params) {
  const parts = [];
  let i = params.length + 1;
  for (const c of clauses) {
    if (!c) continue;
    if (c.email) {
      parts.push(`email = $${i}`);
      params.push(c.email);
      i += 1;
    }
    if (c.phone) {
      parts.push(`phone = $${i}`);
      params.push(c.phone);
      i += 1;
    }
    if (c.username) {
      parts.push(`username = $${i}`);
      params.push(c.username);
      i += 1;
    }
    if (c.deviceFingerprints) {
      parts.push(`$${i} = ANY(device_fingerprints)`);
      params.push(String(c.deviceFingerprints));
      i += 1;
    }
  }
  return parts.length ? parts.join(' OR ') : null;
}

async function findRowByFilter(filter) {
  const params = [];
  let w = null;
  if (filter.$or && Array.isArray(filter.$or)) {
    w = buildOrWhereFromClauses(filter.$or, params);
  }
  if (!w && filter.relatedBanId) {
    w = `related_ban_id = $${params.length + 1}`;
    params.push(String(filter.relatedBanId));
  }
  if (!w) return null;
  const res = await query(`SELECT * FROM moderation_flagged_identities WHERE ${w} LIMIT 1`, params);
  return res.rows[0] || null;
}

const FlaggedIdentity = {
  async findOneAndUpdate(filter, update, _opts) {
    const row = await findRowByFilter(filter);
    const set = update.$set || {};
    const addFp = update.$addToSet?.deviceFingerprints;
    const addIp = update.$addToSet?.ipAddresses;

    if (row) {
      const id = row.id;
      let fps = [...(row.device_fingerprints || [])].map(String);
      let ips = [...(row.ip_addresses || [])].map(String);
      if (addFp && !fps.includes(String(addFp))) fps.push(String(addFp));
      if (addIp && !ips.includes(String(addIp))) ips.push(String(addIp));

      await query(
        `UPDATE moderation_flagged_identities SET
          email = COALESCE($2, email),
          phone = COALESCE($3, phone),
          username = COALESCE($4, username),
          related_ban_id = COALESCE($5, related_ban_id),
          flagged_by = COALESCE($6, flagged_by),
          flagged_at = COALESCE($7::timestamptz, flagged_at),
          device_fingerprints = $8::text[],
          ip_addresses = $9::text[]
         WHERE id = $1`,
        [
          id,
          set.email || null,
          set.phone || null,
          set.username || null,
          set.relatedBanId ? String(set.relatedBanId) : null,
          set.flaggedBy ? String(set.flaggedBy) : null,
          set.flaggedAt || null,
          fps,
          ips,
        ]
      );
      return fromRow((await query('SELECT * FROM moderation_flagged_identities WHERE id = $1', [id])).rows[0]);
    }

    const id = newObjectId();
    const fps = addFp ? [String(addFp)] : [];
    const ips = addIp ? [String(addIp)] : [];
    await query(
      `INSERT INTO moderation_flagged_identities (
        id, email, phone, username, device_fingerprints, ip_addresses, related_ban_id, flagged_by, flagged_at
      ) VALUES ($1,$2,$3,$4,$5::text[],$6::text[],$7,$8,$9::timestamptz)`,
      [
        id,
        set.email || null,
        set.phone || null,
        set.username || null,
        fps,
        ips,
        String(set.relatedBanId),
        String(set.flaggedBy),
        set.flaggedAt || new Date(),
      ]
    );
    return fromRow((await query('SELECT * FROM moderation_flagged_identities WHERE id = $1', [id])).rows[0]);
  },

  findOne(filter) {
    const chain = {
      _lean: false,
      lean() {
        chain._lean = true;
        return chain;
      },
      async exec() {
        const row = await findRowByFilter(filter);
        if (!row) return null;
        const pl = fromRow(row);
        return chain._lean ? { ...pl, _id: pl.id } : pl;
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
};

module.exports = FlaggedIdentity;
