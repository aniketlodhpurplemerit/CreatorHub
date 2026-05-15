const { query, withTransaction } = require('../db/pool');
const { newObjectId } = require('../utils/objectId');

async function loadTransactions(walletId) {
  const r = await query(
    `SELECT id, amount, type, reference_id AS "referenceId", status, created_at AS "createdAt"
     FROM wallet_transactions WHERE wallet_id = $1 ORDER BY created_at DESC`,
    [walletId]
  );
  return r.rows.map((t) => ({
    ...t,
    _id: t.id,
    toObject() {
      return { ...t, _id: t.id };
    },
  }));
}

function fromWalletRow(row, txs) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    userId: row.user_id,
    balance: Number(row.balance) || 0,
    transactions: txs || [],
    updatedAt: row.updated_at,
  };
}

function chain(filter, multi) {
  const st = { filter, multi, _populate: null, _lean: false };
  const c = {
    select() {
      return c;
    },
    populate(path, fields) {
      st._populate = { path, fields };
      return c;
    },
    lean() {
      st._lean = true;
      return c;
    },
    async exec() {
      const p = [];
      let w = 'TRUE';
      if (st.filter.userId) {
        w = 'user_id = $1';
        p.push(String(st.filter.userId));
      }
      const lim = multi ? '' : 'LIMIT 1';
      const res = await query(`SELECT * FROM wallets WHERE ${w} ${lim}`, p);
      const User = require('./User');
      const out = [];
      for (const row of res.rows) {
        const txs = await loadTransactions(row.id);
        let doc = fromWalletRow(row, txs);
        if (st._populate && st._populate.path === 'userId') {
          const u = await User.findById(doc.userId).select(st._populate.fields).lean().exec();
          doc = { ...doc, userId: u || doc.userId };
        }
        out.push(doc);
      }
      return multi ? out : out[0] || null;
    },
    then(onF, onR) {
      return c.exec().then(onF, onR);
    },
    catch(onR) {
      return c.exec().catch(onR);
    },
  };
  return c;
}

const Wallet = {
  find(f = {}) {
    return chain(f, true);
  },
  findOne(f) {
    return chain(f, false);
  },
  findOneAndUpdate(filter, update, opts) {
    return (async () => {
      const price = update.$inc && update.$inc.balance != null ? -update.$inc.balance : null;
      if (!price || price <= 0) return null;
      return withTransaction(async (client) => {
        const uid = String(filter.userId);
        const lockRes = await client.query(
          `SELECT * FROM wallets WHERE user_id = $1 AND balance >= $2 FOR UPDATE`,
          [uid, price]
        );
        if (!lockRes.rowCount) return null;
        const w = lockRes.rows[0];
        await client.query(`UPDATE wallets SET balance = balance - $2, updated_at = now() WHERE id = $1`, [
          w.id,
          price,
        ]);
        const txId = newObjectId();
        const ref = update.$push?.transactions?.referenceId || null;
        await client.query(
          `INSERT INTO wallet_transactions (id, wallet_id, amount, type, reference_id, status)
           VALUES ($1,$2,$3,'debit',$4,'success')`,
          [txId, w.id, price, ref]
        );
        const fresh = (await client.query('SELECT * FROM wallets WHERE id = $1', [w.id])).rows[0];
        const txs = (
          await client.query(
            `SELECT id, amount, type, reference_id AS "referenceId", status, created_at AS "createdAt"
             FROM wallet_transactions WHERE wallet_id = $1 ORDER BY created_at DESC`,
            [w.id]
          )
        ).rows;
        const mappedTxs = txs.map((t) => ({
          ...t,
          _id: t.id,
          toObject() {
            return { ...t, _id: t.id };
          },
        }));
        return fromWalletRow(fresh, mappedTxs);
      });
    })();
  },
};

module.exports = Wallet;
