const { query } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

function parseJson(val, fallback) {
  if (val == null) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function fromRow(row) {
  if (!row) return null;
  const reactions = parseJson(row.reactions, []);
  const replyTo = parseJson(row.reply_to, null);
  return {
    id: row.id,
    _id: row.id,
    conversationId: row.conversation_id,
    sender: row.sender,
    recipient: row.recipient,
    text: row.text,
    isRead: row.is_read,
    mediaUrl: row.media_url,
    thumbnailUrl: row.thumbnail_url,
    mediaType: row.media_type,
    isDeleted: row.is_deleted,
    deletedAt: row.deleted_at,
    isEdited: row.is_edited,
    editedAt: row.edited_at,
    reactions: Array.isArray(reactions) ? reactions : [],
    encryptedText: row.encrypted_text,
    nonce: row.nonce,
    isEncrypted: row.is_encrypted,
    status: row.status,
    replyTo,
    hiddenFor: (row.hidden_for || []).map(String),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function persistMessage(plain) {
  await query(
    `UPDATE messages SET
      conversation_id=$2, sender=$3, recipient=$4, text=$5, is_read=$6,
      media_url=$7, thumbnail_url=$8, media_type=$9, is_deleted=$10, deleted_at=$11,
      is_edited=$12, edited_at=$13, reactions=$14::jsonb, encrypted_text=$15, nonce=$16,
      is_encrypted=$17, status=$18, reply_to=$19::jsonb, hidden_for=$20::text[], updated_at=now()
    WHERE id=$1`,
    [
      plain.id,
      plain.conversationId,
      String(plain.sender),
      String(plain.recipient),
      plain.text ?? '',
      !!plain.isRead,
      plain.mediaUrl || null,
      plain.thumbnailUrl || '',
      plain.mediaType || null,
      !!plain.isDeleted,
      plain.deletedAt || null,
      !!plain.isEdited,
      plain.editedAt || null,
      JSON.stringify(plain.reactions || []),
      plain.encryptedText || '',
      plain.nonce || '',
      !!plain.isEncrypted,
      plain.status || 'sent',
      JSON.stringify(plain.replyTo || null),
      (plain.hiddenFor || []).map(String),
    ]
  );
}

function hydrate(plain) {
  if (!plain) return null;
  return {
    ...plain,
    _id: plain.id,
    async save() {
      await persistMessage({ ...plain });
    },
    toObject() {
      return { ...plain, _id: plain.id };
    },
  };
}

async function updateMany(filter, update) {
  if (filter.recipient && filter.status === 'sent' && update.$set?.status === 'delivered') {
    const r = await query(
      `UPDATE messages SET status = 'delivered', updated_at = now() WHERE recipient = $1 AND status = 'sent'`,
      [String(filter.recipient)]
    );
    return { modifiedCount: r.rowCount };
  }
  if (filter.conversationId && filter.recipient && filter.status?.$in && update.$set?.status === 'seen') {
    const r = await query(
      `UPDATE messages SET status = 'seen', updated_at = now()
       WHERE conversation_id = $1 AND recipient = $2 AND status = ANY($3::text[])`,
      [filter.conversationId, String(filter.recipient), filter.status.$in]
    );
    return { modifiedCount: r.rowCount };
  }
  return { modifiedCount: 0 };
}

function findChain(filter) {
  const st = { filter, _populate: null, _sort: null };
  const chain = {
    sort(s) {
      st._sort = s;
      return chain;
    },
    populate(path, fields) {
      st._populate = { paths: String(path).split(/\s+/).filter(Boolean), fields };
      return chain;
    },
    async exec() {
      const f = st.filter || {};
      let uid;
      if (Array.isArray(f.$or) && f.$or.length) {
        uid = String(f.$or[0].sender || f.$or[0].recipient || f.$or[1]?.recipient || '');
      }
      const hideList = f.hiddenFor && f.hiddenFor.$nin ? f.hiddenFor.$nin.map((x) => String(x)) : [];
      const hide = hideList[0] || uid;
      const params = [uid, hide];
      const sql = `(sender = $1 OR recipient = $1) AND NOT ($2 = ANY(hidden_for)) ORDER BY created_at DESC`;
      const res = await query(`SELECT * FROM messages WHERE ${sql}`, params);
      const User = require('./User');
      const out = [];
      for (const row of res.rows) {
        let plain = fromRow(row);
        if (st._populate && st._populate.paths) {
          for (const pth of st._populate.paths) {
            const uidField = plain[pth];
            if (uidField) {
              const u = await User.findById(String(uidField)).select(st._populate.fields).lean().exec();
              plain = { ...plain, [pth]: u || uidField };
            }
          }
        }
        out.push(hydrate(plain));
      }
      return out;
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

const Message = {
  find(filter) {
    return findChain(filter);
  },
  findById(id) {
    const chain = {
      async exec() {
        const row = (await query('SELECT * FROM messages WHERE id=$1', [String(id)])).rows[0];
        return row ? hydrate(fromRow(row)) : null;
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
  async create(data) {
    const id = newObjectId();
    await query(
      `INSERT INTO messages (
        id, conversation_id, sender, recipient, text, is_read, media_url, thumbnail_url, media_type,
        is_deleted, deleted_at, is_edited, edited_at, reactions, encrypted_text, nonce, is_encrypted,
        status, reply_to, hidden_for
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,false,null,false,null,$10::jsonb,$11,$12,$13,$14,$15::jsonb,$16::text[]
      )`,
      [
        id,
        data.conversationId,
        String(data.sender),
        String(data.recipient),
        data.text || '',
        false,
        data.mediaUrl || null,
        data.thumbnailUrl || '',
        data.mediaType || null,
        JSON.stringify(data.reactions || []),
        data.encryptedText || '',
        data.nonce || '',
        !!data.isEncrypted,
        data.status || 'sent',
        JSON.stringify(data.replyTo || null),
        (data.hiddenFor || []).map(String),
      ]
    );
    return hydrate(fromRow((await query('SELECT * FROM messages WHERE id=$1', [id])).rows[0]));
  },
  updateMany,
};

module.exports = Message;
