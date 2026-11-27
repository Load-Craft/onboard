// Checkout: turns the user's cart into an order.

import { carts, nextId, orders, products, type Order } from '../db.ts';
import { payAndStore } from './pay.ts';

export class CheckoutError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function checkout(userId: string, cardNumber: string): Promise<Order> {
  const lines = carts.get(userId) ?? [];
  if (lines.length === 0) throw new CheckoutError(409, 'Cart is empty');
  let total = 0;
  for (const line of lines) {
    const product = products.find((candidate) => candidate.id === line.product_id);
    if (product === undefined) throw new CheckoutError(409, `Unknown product ${line.product_id}`);
    if (product.stock < line.quantity) throw new CheckoutError(409, `Not enough ${product.name}`);
    total += product.price_cents * line.quantity;
  }
  const order: Order = {
    id: nextId('order'),
    user_id: userId,
    lines: lines.map((line) => ({ ...line })),
    total_cents: total,
    status: 'paid',
  };
  await payAndStore(cardNumber, total, () => {
    for (const line of lines) {
      const product = products.find((candidate) => candidate.id === line.product_id);
      if (product !== undefined) product.stock -= line.quantity;
    }
    orders.push(order);
    carts.delete(userId);
  });
  return order;
}
