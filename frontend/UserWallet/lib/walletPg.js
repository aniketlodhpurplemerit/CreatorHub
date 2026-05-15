import 'server-only';
import { query, withTransaction } from './pgPool.js';
import { newObjectId } from './objectId.js';

function mapTxRow(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    amount: Number(row.amount),
    type: row.type,
    referenceId: row.referenceId ?? row.reference_id ?? null,
    status: row.status,
    createdAt: row.createdAt ?? row.created_at,
  };
}

function mapCardRow(row) {
  if (!row) return null;
  let billing = row.billing;
  if (typeof billing === 'string') {
    try {
      billing = JSON.parse(billing);
    } catch {
      billing = {};
    }
  }
  if (!billing || typeof billing !== 'object') billing = {};
  return {
    _id: row.id,
    id: row.id,
    userId: row.user_id,
    cardHash: row.card_hash,
    last4: row.last4,
    holderName: row.holder_name,
    email: row.email,
    expiryMonth: row.expiry_month,
    expiryYear: row.expiry_year,
    billingAddress: {
      country: billing.country || 'India',
      address1: billing.address1 || '',
      address2: billing.address2 || '',
      city: billing.city || '',
      pinCode: billing.pinCode || '',
      state: billing.state || '',
    },
  };
}

export async function findCardByHash(cardHash) {
  const r = await query('SELECT * FROM wallet_cards WHERE card_hash = $1 LIMIT 1', [String(cardHash)]);
  return mapCardRow(r.rows[0]);
}

export async function insertCard(data) {
  const id = newObjectId();
  const billing = {
    country: data.billingAddress?.country || 'India',
    address1: data.billingAddress?.address1 || '',
    address2: data.billingAddress?.address2 || '',
    city: data.billingAddress?.city || '',
    pinCode: data.billingAddress?.pinCode || '',
    state: data.billingAddress?.state || '',
  };
  await query(
    `INSERT INTO wallet_cards (id, user_id, card_hash, last4, holder_name, email, expiry_month, expiry_year, billing)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      id,
      String(data.userId),
      String(data.cardHash),
      String(data.last4),
      String(data.holderName),
      String(data.email),
      String(data.expiryMonth),
      String(data.expiryYear),
      JSON.stringify(billing),
    ]
  );
  const row = (await query('SELECT * FROM wallet_cards WHERE id = $1', [id])).rows[0];
  return mapCardRow(row);
}

export async function getWalletBalancePayload(userId) {
  const row = (await query('SELECT id, balance FROM wallets WHERE user_id = $1', [String(userId)])).rows[0];
  if (!row) {
    return { balance: 0, transactions: [] };
  }
  const txRes = await query(
    `SELECT id, amount, type, reference_id AS "referenceId", status, created_at AS "createdAt"
     FROM wallet_transactions WHERE wallet_id = $1 ORDER BY created_at DESC`,
    [row.id]
  );
  return {
    balance: Number(row.balance) || 0,
    transactions: txRes.rows.map(mapTxRow),
  };
}

async function ensureWalletRow(client, userId) {
  let row = (await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [String(userId)])).rows[0];
  if (!row) {
    const id = newObjectId();
    await client.query('INSERT INTO wallets (id, user_id, balance) VALUES ($1, $2, 0)', [id, String(userId)]);
    row = (await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [String(userId)])).rows[0];
  }
  return row;
}

export async function creditWallet(userId, amount) {
  return withTransaction(async (client) => {
    const row = await ensureWalletRow(client, userId);
    await client.query('UPDATE wallets SET balance = balance + $2, updated_at = now() WHERE id = $1', [
      row.id,
      amount,
    ]);
    const txId = newObjectId();
    await client.query(
      `INSERT INTO wallet_transactions (id, wallet_id, amount, type, reference_id, status)
       VALUES ($1, $2, $3, 'credit', NULL, 'success')`,
      [txId, row.id, amount]
    );
    const fresh = (await client.query('SELECT * FROM wallets WHERE id = $1', [row.id])).rows[0];
    const txRow = (
      await client.query(
        `SELECT id, amount, type, reference_id AS "referenceId", status, created_at AS "createdAt"
         FROM wallet_transactions WHERE id = $1`,
        [txId]
      )
    ).rows[0];
    return {
      balance: Number(fresh.balance) || 0,
      transaction: mapTxRow(txRow),
    };
  });
}

export async function debitWallet(userId, amount, referenceId) {
  return withTransaction(async (client) => {
    const res = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [String(userId)]);
    const row = res.rows[0];
    if (!row || Number(row.balance) < amount) {
      return null;
    }
    await client.query('UPDATE wallets SET balance = balance - $2, updated_at = now() WHERE id = $1', [
      row.id,
      amount,
    ]);
    const txId = newObjectId();
    await client.query(
      `INSERT INTO wallet_transactions (id, wallet_id, amount, type, reference_id, status)
       VALUES ($1, $2, $3, 'debit', $4, 'success')`,
      [txId, row.id, amount, referenceId]
    );
    const fresh = (await client.query('SELECT * FROM wallets WHERE id = $1', [row.id])).rows[0];
    const txRow = (
      await client.query(
        `SELECT id, amount, type, reference_id AS "referenceId", status, created_at AS "createdAt"
         FROM wallet_transactions WHERE id = $1`,
        [txId]
      )
    ).rows[0];
    return {
      balance: Number(fresh.balance) || 0,
      transaction: mapTxRow(txRow),
    };
  });
}
