// In-memory store of the shop. A real shop would use a database; the fixture only needs a place
// where state lives.

export interface Product {
  id: string;
  name: string;
  price_cents: number;
  stock: number;
}

export interface CartLine {
  product_id: string;
  quantity: number;
}

export interface Order {
  id: string;
  user_id: string;
  lines: CartLine[];
  total_cents: number;
  status: 'paid';
}

export interface User {
  id: string;
  email: string;
  password: string;
}

export const products: Product[] = [
  { id: 'product-example-1', name: 'Mug', price_cents: 1900, stock: 40 },
  { id: 'product-example-2', name: 'Poster', price_cents: 2900, stock: 15 },
  { id: 'product-example-3', name: 'Sticker pack', price_cents: 500, stock: 200 },
];

export const users = new Map<string, User>([
  ['user@example.com', { id: 'user-example-1', email: 'user@example.com', password: 'change-me' }],
]);

export const sessions = new Map<string, string>();
export const carts = new Map<string, CartLine[]>();
export const orders: Order[] = [];

let sequence = 0;
export function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(sequence)}`;
}

/**
 * Runs `work` as one database transaction: the row locks it takes are held until it returns.
 * In the fixture it only serializes callers, which is enough to show the cost.
 */
let tail: Promise<unknown> = Promise.resolve();
export function transaction<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work, work);
  tail = run.catch(() => undefined);
  return run;
}
