import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAuthenticatedUserId } from './auth';
import { connectWalletDB } from '../utils/db';
import { creditWallet, findCardByHash, insertCard } from '../lib/walletPg';
import { validateTopUpAmount } from '../utils/walletHelpers';

const normalizeCardNumber = (value = '') => String(value).replace(/\D/g, '');

/**
 * POST /api/wallet/add-funds
 * @param {import('next/server').NextRequest} req
 * @returns {Promise<import('next/server').NextResponse>}
 */
export async function addFunds(req) {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const amount = Number(body?.amount);
    const paymentMethod = body?.paymentMethod || 'wallet';
    const card = body?.card || null;

    const validation = validateTopUpAmount(amount);
    if (!validation.valid) {
      return NextResponse.json({ message: validation.message }, { status: 400 });
    }

    await connectWalletDB();

    if (paymentMethod === 'card') {
      if (!card) {
        return NextResponse.json({ message: 'Card details are required.' }, { status: 400 });
      }

      const normalizedCard = normalizeCardNumber(card.number);
      if (normalizedCard.length < 12) {
        return NextResponse.json({ message: 'Please enter a valid card number.' }, { status: 400 });
      }

      if (!card.email || !card.holderName || !card.expiryMonth || !card.expiryYear) {
        return NextResponse.json({ message: 'Please complete all required card fields.' }, { status: 400 });
      }

      const cardHash = crypto.createHash('sha256').update(normalizedCard).digest('hex');
      const existingCard = await findCardByHash(cardHash);

      if (existingCard && String(existingCard.userId) !== String(userId)) {
        return NextResponse.json(
          { message: 'This card is already linked to another user account.' },
          { status: 400 }
        );
      }

      if (!existingCard) {
        await insertCard({
          userId,
          cardHash,
          last4: normalizedCard.slice(-4),
          holderName: String(card.holderName),
          email: String(card.email),
          expiryMonth: String(card.expiryMonth),
          expiryYear: String(card.expiryYear),
          billingAddress: {
            country: card.country || 'India',
            address1: card.address1 || '',
            address2: card.address2 || '',
            city: card.city || '',
            pinCode: card.pinCode || '',
            state: card.state || ''
          }
        });
      }
    }

    const { balance, transaction } = await creditWallet(userId, amount);

    return NextResponse.json(
      {
        success: true,
        balance,
        transaction
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { message: 'Unable to add funds right now.' },
      { status: 500 }
    );
  }
}
