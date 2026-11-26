// Entry point of the sklep API: eight routes on node:http.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { carts, nextId, orders, products, sessions, users } from './db.ts';
import { checkout, CheckoutError } from './checkout/checkout.ts';

interface Context {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  userId: string | undefined;
}

type Handler = (context: Context) => Promise<[number, unknown]> | [number, unknown];

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  secured: boolean;
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, path: string, secured: boolean, handler: Handler): void {
  const names: string[] = [];
  const source = path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    names.push(name);
    return '([^/]+)';
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), names, secured, handler });
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

route('POST', '/api/auth/register', false, ({ body }) => {
  const email = String(body.email ?? '');
  const password = String(body.password ?? '');
  if (!email.includes('@') || password.length < 8) throw new HttpError(400, 'Invalid registration');
  if (users.has(email)) throw new HttpError(409, 'Email already registered');
  const user = { id: nextId('user'), email, password };
  users.set(email, user);
  return [201, { id: user.id, email }];
});

route('POST', '/api/auth/login', false, ({ body }) => {
  const user = users.get(String(body.email ?? ''));
  if (user === undefined || user.password !== body.password) {
    throw new HttpError(401, 'Wrong email or password');
  }
  const sessionId = nextId('session');
  sessions.set(sessionId, user.id);
  return [200, { session_id: sessionId }];
});

route('GET', '/api/products', false, ({ query }) => {
  const q = (query.get('q') ?? '').toLowerCase();
  return [200, { items: products.filter((product) => product.name.toLowerCase().includes(q)) }];
});

route('GET', '/api/products/{id}', false, ({ params }) => {
  const product = products.find((candidate) => candidate.id === params.id);
  if (product === undefined) throw new HttpError(404, 'Product not found');
  return [200, product];
});

route('POST', '/api/cart/items', true, ({ body, userId }) => {
  const productId = String(body.product_id ?? '');
  const quantity = Number(body.quantity ?? 0);
  if (!products.some((product) => product.id === productId)) {
    throw new HttpError(404, 'Product not found');
  }
  if (!Number.isInteger(quantity) || quantity < 1) throw new HttpError(400, 'Invalid quantity');
  const lines = carts.get(userId ?? '') ?? [];
  lines.push({ product_id: productId, quantity });
  carts.set(userId ?? '', lines);
  return [201, { lines }];
});

route('GET', '/api/cart', true, ({ userId }) => [200, { lines: carts.get(userId ?? '') ?? [] }]);

route('POST', '/api/checkout', true, async ({ body, userId }) => {
  try {
    return [201, await checkout(userId ?? '', String(body.card_number ?? ''))];
  } catch (error) {
    if (error instanceof CheckoutError) throw new HttpError(error.status, error.message);
    throw error;
  }
});

route('GET', '/api/orders', true, ({ userId }) => [
  200,
  { items: orders.filter((order) => order.user_id === userId) },
]);

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://example.com');
    try {
      for (const candidate of routes) {
        const match = candidate.pattern.exec(url.pathname);
        if (match === null || candidate.method !== request.method) continue;
        const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
        const userId = bearer === undefined ? undefined : sessions.get(bearer);
        if (candidate.secured && userId === undefined) throw new HttpError(401, 'Not signed in');
        const params = Object.fromEntries(candidate.names.map((name, i) => [name, match[i + 1] ?? '']));
        const [status, body] = await candidate.handler({
          params,
          query: url.searchParams,
          body: request.method === 'POST' ? await readJson(request) : {},
          userId,
        });
        send(response, status, body);
        return;
      }
      throw new HttpError(404, 'Not found');
    } catch (error) {
      if (error instanceof HttpError) send(response, error.status, { message: error.message });
      else send(response, 500, { message: 'Internal error' });
    }
  })();
});

server.listen(Number(process.env.PORT ?? 3000));
