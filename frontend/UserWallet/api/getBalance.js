import { NextResponse } from 'next/server';
import { getAuthenticatedUserId } from './auth';
import { connectWalletDB } from '../utils/db';
import { getWalletBalancePayload } from '../lib/walletPg';
import { sortTransactionsByLatest } from '../utils/walletHelpers';

/**
 * GET /api/wallet/balance
 * @param {import('next/server').NextRequest} req
 * @returns {Promise<import('next/server').NextResponse>}
 */
export async function getBalance(req) {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    await connectWalletDB();

    const wallet = await getWalletBalancePayload(userId);

    return NextResponse.json(
      {
        balance: wallet.balance,
        transactions: sortTransactionsByLatest(wallet.transactions || [])
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { message: 'Something went wrong while fetching wallet balance.' },
      { status: 500 }
    );
  }
}
