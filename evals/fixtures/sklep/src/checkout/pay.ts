// Payment step of the checkout.

import { transaction } from '../db.ts';

/** Calls the payment provider; takes about 800 ms (network round trip to the provider). */
export async function chargeCard(cardNumber: string, amountCents: number): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (cardNumber.length < 12 || amountCents <= 0) throw new Error('card declined');
  return `payment-${String(amountCents)}`;
}

/**
 * Charges the card and stores the order. The charge sits INSIDE the transaction, so every
 * checkout holds the stock row locks for the whole provider round trip: under load the
 * checkouts queue behind each other.
 */
export function payAndStore(
  cardNumber: string,
  amountCents: number,
  store: () => void,
): Promise<string> {
  return transaction(async () => {
    const paymentId = await chargeCard(cardNumber, amountCents);
    store();
    return paymentId;
  });
}
