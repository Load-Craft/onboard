import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { ToolError } from '../src/errors.js';
import { LoadcraftApiError } from '../src/http/apiError.js';
import {
  createHttp,
  DEFAULT_TIMEOUT_MS,
  ERROR_BODY_LIMIT_BYTES,
  MAX_RESPONSE_BYTES,
  type HttpClient,
} from '../src/http/client.js';
import { createLogger } from '../src/log.js';
import { VERSION } from '../src/version.js';
import { assertNoCanary, CANARY } from './helpers/canary.js';
import { createTestClock, type TestClock } from './helpers/clock.js';

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
  /** Resolves once the client side of the connection went away before a response was sent. */
  aborted: Promise<void>;
}

type Handler = (req: Received, res: ServerResponse) => void;

interface Backend {
  readonly origin: string;
  readonly requests: Received[];
  handle(handler: Handler): void;
  close(): Promise<void>;
}

async function startBackend(): Promise<Backend> {
  const requests: Received[] = [];
  let handler: Handler = (_req, res) => {
    res.writeHead(500).end();
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const aborted = new Promise<void>((resolve) => {
        res.on('close', () => {
          if (!res.writableEnded) resolve();
        });
      });
      const received: Received = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        aborted,
      };
      requests.push(received);
      handler(received, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    requests,
    handle: (next) => {
      handler = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

/** Waits (in real time) for I/O driven by the client to reach the test server. */
async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Gives the client a moment of real time to do anything it was (wrongly) going to do. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail');
}

async function apiError(promise: Promise<unknown>): Promise<LoadcraftApiError> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(LoadcraftApiError);
  expect(error).toBeInstanceOf(ToolError);
  return error as LoadcraftApiError;
}

interface WatchedClock extends TestClock {
  /** True while the code under test waits on a `sleep(ms)` call. */
  sleeping(ms: number): boolean;
}

/** Test clock that also tells which pauses are pending, so time moves only once the client waits. */
function watchedClock(inner: TestClock = createTestClock()): WatchedClock {
  const pending = new Map<number, number>();
  const change = (ms: number, by: number): void =>
    void pending.set(ms, (pending.get(ms) ?? 0) + by);
  return {
    now: () => inner.now(),
    advance: (ms) => inner.advance(ms),
    sleep(ms, signal) {
      change(ms, 1);
      const sleep = inner.sleep(ms, signal);
      sleep.then(
        () => change(ms, -1),
        () => change(ms, -1),
      );
      return sleep;
    },
    sleeping: (ms) => (pending.get(ms) ?? 0) > 0,
  };
}

let backend: Backend;
let clock: WatchedClock;
let logLines: string[];

function client(token: string = CANARY): HttpClient {
  const config = loadConfig(
    { LOADCRAFT_API_URL: `${backend.origin}/api/v1`, LOADCRAFT_API_TOKEN: token },
    '/tmp',
  );
  const log = createLogger({ level: 'debug', sink: (line) => void logLines.push(line) });
  return createHttp(config, log, { clock });
}

const project = {
  name: 'sklep',
  base_url: 'https://example.com',
  environment_name: 'staging',
  project_type: 'api' as const,
};

beforeEach(async () => {
  backend = await startBackend();
  clock = watchedClock();
  logLines = [];
});

afterEach(async () => {
  await backend.close();
});

describe('createHttp: requests', () => {
  it('sends the token, user agent and accept headers to the /api/v1 path of the API origin', async () => {
    backend.handle((_req, res) => json(res, 200, { items: [], total: 0 }));
    const { data } = await client().GET('/api/v1/projects', { params: { query: { limit: 5 } } });

    expect(data).toEqual({ items: [], total: 0 });
    const [req] = backend.requests;
    expect(req?.method).toBe('GET');
    expect(req?.url).toBe('/api/v1/projects?limit=5');
    expect(req?.headers.authorization).toBe(`Bearer ${CANARY}`);
    expect(req?.headers['user-agent']).toBe(`loadcraft-mcp/${VERSION}`);
    expect(req?.headers.accept).toBe('application/json');
  });

  it('returns a compressed JSON answer decoded', async () => {
    const payload = { items: [{ name: 'sklep' }], total: 1 };
    backend.handle((_req, res) => {
      const body = gzipSync(JSON.stringify(payload));
      res
        .writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'Content-Length': String(body.byteLength),
        })
        .end(body);
    });
    const { data } = await client().GET('/api/v1/projects');
    expect(data).toEqual(payload);
  });

  it('keeps its own token when the caller passes an Authorization header', async () => {
    backend.handle((_req, res) => json(res, 200, { id: 'p1' }));
    await client().POST('/api/v1/projects', {
      params: { header: { Authorization: 'Bearer someone-else' } },
      body: project,
    });

    expect(backend.requests[0]?.headers.authorization).toBe(`Bearer ${CANARY}`);
    expect(JSON.parse(backend.requests[0]?.body ?? '')).toEqual(project);
  });

  it('refuses to call without a token and sends nothing', async () => {
    const error = await apiError(client('').GET('/api/v1/projects'));

    expect(error.code).toBe('unauthorized');
    expect(error.hint).toContain('/loadcraft:doctor');
    await settle();
    expect(backend.requests).toHaveLength(0);
  });
});

describe('createHttp: response size limit', () => {
  /** Writes chunks until the client goes away; resolves with the number of bytes written. */
  function endless(res: ServerResponse, status: number, chunk: Buffer): Promise<number> {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    let written = 0;
    return new Promise((resolve) => {
      const pump = (): void => {
        while (!res.destroyed && !res.writableEnded) {
          written += chunk.byteLength;
          if (!res.write(chunk)) {
            res.once('drain', pump);
            return;
          }
        }
      };
      res.on('close', () => resolve(written));
      pump();
    });
  }

  it('has a default limit of tens of MiB', () => {
    expect(MAX_RESPONSE_BYTES).toBeGreaterThanOrEqual(32 * 1024 * 1024);
    expect(MAX_RESPONSE_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(ERROR_BODY_LIMIT_BYTES).toBe(64 * 1024);
  });

  it('stops reading an endless answer after the limit', async () => {
    let written: Promise<number> = Promise.resolve(0);
    backend.handle((_req, res) => {
      written = endless(res, 200, Buffer.alloc(16 * 1024, 0x61));
    });
    const error = await apiError(client().GET('/api/v1/projects', { maxResponseBytes: 100_000 }));

    expect(error.code).toBe('response_too_large');
    expect(error.status).toBe(200);
    expect(error.details).toEqual({ limitBytes: 100_000 });
    expect(error.retryable).toBe(false);
    // The server was cut off soon after the limit, far from "the whole body".
    expect(await written).toBeLessThan(100_000 + 4 * 1024 * 1024);
  });

  it('does not retry a GET that was too large', async () => {
    backend.handle((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('x'.repeat(5000));
    });
    const error = await apiError(client().GET('/api/v1/projects', { maxResponseBytes: 1000 }));
    expect(error.code).toBe('response_too_large');
    await settle();
    expect(backend.requests).toHaveLength(1);
  });

  it('counts the decoded size of a compressed answer', async () => {
    const body = gzipSync(JSON.stringify({ blob: 'a'.repeat(200_000) }));
    expect(body.byteLength).toBeLessThan(5000);
    backend.handle((_req, res) => {
      res
        .writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
        .end(body);
    });
    const error = await apiError(client().GET('/api/v1/projects', { maxResponseBytes: 50_000 }));
    expect(error.code).toBe('response_too_large');
  });

  it('accepts an answer exactly at the limit', async () => {
    const text = JSON.stringify({ items: [], total: 0 });
    backend.handle((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(text);
    });
    const { data } = await client().GET('/api/v1/projects', {
      maxResponseBytes: Buffer.byteLength(text),
    });
    expect(data).toEqual({ items: [], total: 0 });
  });

  it('a per-call limit above the default lets a larger answer through', async () => {
    backend.handle((_req, res) => json(res, 200, { items: [], total: 0, pad: 'p'.repeat(3000) }));
    const { data } = await client().GET('/api/v1/projects', { maxResponseBytes: 10_000 });
    expect(data).toBeDefined();
  });

  it('rejects a non-positive per-call limit', async () => {
    backend.handle((_req, res) => json(res, 200, {}));
    const error = await rejection(client().GET('/api/v1/projects', { maxResponseBytes: 0 }));
    expect(error).toBeInstanceOf(TypeError);
  });

  it('reads an oversized error body only up to 64 KiB and still reports the API error', async () => {
    let written: Promise<number> = Promise.resolve(0);
    backend.handle((_req, res) => {
      written = endless(res, 409, Buffer.alloc(16 * 1024, 0x62));
    });
    const error = await apiError(client().POST('/api/v1/projects', { body: project }));

    expect(error.code).toBe('conflict');
    expect(error.status).toBe(409);
    expect(await written).toBeLessThan(ERROR_BODY_LIMIT_BYTES + 4 * 1024 * 1024);
  });

  it('an error body larger than the success limit is not response_too_large', async () => {
    backend.handle((_req, res) => json(res, 422, { detail: 'd'.repeat(100_000) }));
    const error = await apiError(
      client().POST('/api/v1/projects', { body: project, maxResponseBytes: 10 }),
    );
    expect(error.code).toBe('invalid');
  });
});

describe('createHttp: error bodies', () => {
  const longHtml = `<html><body>${'x'.repeat(500)}</body></html>`;

  const cases: {
    name: string;
    status: number;
    body: unknown;
    raw?: string;
    code: string;
    message?: string;
    details?: unknown;
    retryable: boolean;
  }[] = [
    {
      name: '{detail: text} 401',
      status: 401,
      body: { detail: 'Authentication required' },
      code: 'unauthorized',
      message: 'LoadCraft API answered HTTP 401.',
      retryable: false,
    },
    {
      name: '{detail: text} 403',
      status: 403,
      body: { detail: "Role 'viewer' does not permit access requiring 'editor'" },
      code: 'forbidden',
      message: "Role 'viewer' does not permit access requiring 'editor'",
      retryable: false,
    },
    {
      name: '{detail: text} 404',
      status: 404,
      body: { detail: 'Project not found: p1' },
      code: 'not_found',
      message: 'Project not found: p1',
      retryable: false,
    },
    {
      name: '{detail: text} 409',
      status: 409,
      body: { detail: 'Flow name already taken' },
      code: 'conflict',
      retryable: false,
    },
    {
      name: '{detail: text} 422',
      status: 422,
      body: { detail: 'Bad value' },
      code: 'invalid',
      retryable: false,
    },
    {
      name: '{detail: {error, ...}} setup gate',
      status: 409,
      body: { detail: { error: 'setup_incomplete', missing: ['profile'] } },
      code: 'setup_incomplete',
      details: { missing: ['profile'] },
      retryable: false,
    },
    {
      name: '{detail: {code, message, ...}}',
      status: 409,
      body: { detail: { code: 'agent_browsers_busy', message: 'Both busy', retry_after: 60 } },
      code: 'agent_browsers_busy',
      message: 'Both busy',
      details: { retry_after: 60 },
      retryable: false,
    },
    {
      name: '{error, message, ...} with retryable from the body',
      status: 502,
      body: {
        error: 'llm_generation_failed',
        message: 'Generation failed',
        detail: 'model refused',
        pipeline: 'flow',
        node: 'plan',
        retryable: true,
      },
      code: 'llm_generation_failed',
      // 5xx: the code, the retry flag and the data stay; the text does not.
      message: 'LoadCraft API answered HTTP 502.',
      details: { detail: 'model refused', pipeline: 'flow', node: 'plan' },
      retryable: true,
    },
    {
      name: 'retryable false in the body wins over a 503 status',
      status: 503,
      body: { error: 'llm_not_configured', message: 'No model', detail: 'x', retryable: false },
      code: 'llm_not_configured',
      message: 'LoadCraft API answered HTTP 503.',
      details: { detail: 'x' },
      retryable: false,
    },
    {
      name: 'validation error list',
      status: 422,
      body: { detail: [{ loc: ['body', 'name'], msg: 'Field required', type: 'missing' }] },
      code: 'invalid',
      details: { errors: [{ loc: ['body', 'name'], msg: 'Field required', type: 'missing' }] },
      retryable: false,
    },
    {
      name: 'non-JSON body',
      status: 502,
      body: undefined,
      raw: longHtml,
      code: 'bad_gateway',
      retryable: true,
    },
  ];

  it.each(cases)('$name → $code', async (c) => {
    backend.handle((_req, res) => {
      if (c.raw !== undefined) res.writeHead(c.status, { 'Content-Type': 'text/html' }).end(c.raw);
      else json(res, c.status, c.body);
    });
    // POST: never retried, so every status maps from exactly one response.
    const error = await apiError(client().POST('/api/v1/projects', { body: project }));

    expect(error.status).toBe(c.status);
    expect(error.code).toBe(c.code);
    expect(error.retryable).toBe(c.retryable);
    expect(error.details).toEqual(c.details);
    if (c.message !== undefined) expect(error.message).toBe(c.message);
    expect(backend.requests).toHaveLength(1);
  });

  it('validation errors name the failing field in the message', async () => {
    backend.handle((_req, res) =>
      json(res, 422, {
        detail: [{ loc: ['body', 'name'], msg: 'Field required', type: 'missing' }],
      }),
    );
    const error = await apiError(client().POST('/api/v1/projects', { body: project }));
    expect(error.message).toContain('Field required');
    expect(error.message).toContain('name');
  });

  it('a non-JSON body of a 5xx is not quoted', async () => {
    backend.handle((_req, res) => res.writeHead(502).end(longHtml));
    const error = await apiError(client().POST('/api/v1/projects', { body: project }));
    expect(error.code).toBe('bad_gateway');
    expect(error.message).toBe('LoadCraft API answered HTTP 502.');
  });

  it('a non-JSON body of a 4xx is quoted up to its first 200 characters', async () => {
    backend.handle((_req, res) => res.writeHead(400).end(longHtml));
    const error = await apiError(client().POST('/api/v1/projects', { body: project }));
    expect(error.message).toContain(longHtml.slice(0, 200));
    expect(error.message).not.toContain(longHtml.slice(0, 201));
  });
});

describe('createHttp: the text of a 5xx or 401 is kept for the log, not in the error', () => {
  const NAMED_SECRET = 'hunter2-named-by-field';

  it.each([500, 503, 401])(
    '%i: the message and details are bare, the body is in logText',
    async (status) => {
      backend.handle((_req, res) =>
        json(res, status, { detail: 'connection to db-internal failed', trace: ['frame 1'] }),
      );
      const error = await apiError(client().POST('/api/v1/projects', { body: project }));
      expect(error.message).toBe(`LoadCraft API answered HTTP ${String(status)}.`);
      expect(error.details).toBeUndefined();
      expect(error.logText).toContain('connection to db-internal failed');
    },
  );

  it('masks the value of a field of a secret name in logText', async () => {
    backend.handle((_req, res) =>
      json(res, 500, { detail: `failed for ${NAMED_SECRET}`, password: NAMED_SECRET }),
    );
    const error = await apiError(client().POST('/api/v1/projects', { body: project }));
    expect(error.logText).toContain('failed for');
    expect(error.logText).not.toContain(NAMED_SECRET);
  });

  it('masks the token and cuts logText to one short line', async () => {
    backend.handle((_req, res) =>
      res
        .writeHead(502, { 'Content-Type': 'text/html' })
        .end(`<html>\n${CANARY} ${'x'.repeat(5000)}</html>`),
    );
    const error = await apiError(client().POST('/api/v1/projects', { body: project }));
    const text = error.logText ?? '';
    expect(text.length).toBeLessThanOrEqual(501);
    expect(text).not.toContain('\n');
    expect(text).not.toContain(CANARY);
    expect(text.endsWith('…')).toBe(true);
  });

  it('a refusal of the input has no logText: its text is quoted to the model', async () => {
    backend.handle((_req, res) => json(res, 422, { detail: 'Name must be unique' }));
    const error = await apiError(client().POST('/api/v1/projects', { body: project }));
    expect(error.message).toBe('Name must be unique');
    expect(error.logText).toBeUndefined();
  });
});

describe('createHttp: retries', () => {
  it('retries a GET after 503 twice, 250 ms and then 1 s apart', async () => {
    backend.handle((_req, res) => json(res, 503, { detail: 'Service unavailable' }));
    const call = apiError(client().GET('/api/v1/projects'));

    await until(() => clock.sleeping(250), 'pause after the first attempt');
    await clock.advance(249);
    await settle();
    expect(backend.requests).toHaveLength(1);
    await clock.advance(1);
    await until(() => clock.sleeping(1000), 'pause after the second attempt');
    expect(backend.requests).toHaveLength(2);
    await clock.advance(999);
    await settle();
    expect(backend.requests).toHaveLength(2);
    await clock.advance(1);
    await until(() => backend.requests.length === 3, 'third attempt');

    const error = await call;
    expect(error.status).toBe(503);
    expect(error.retryable).toBe(true);
    await clock.advance(10_000);
    await settle();
    expect(backend.requests).toHaveLength(3);
  });

  it('returns the data of a GET that succeeds on a retry', async () => {
    backend.handle((_req, res) => {
      if (backend.requests.length === 1) res.writeHead(504).end();
      else json(res, 200, { items: [], total: 0 });
    });
    const call = client().GET('/api/v1/projects');
    await until(() => clock.sleeping(250), 'pause after the first attempt');
    await clock.advance(250);

    const { data } = await call;
    expect(data).toEqual({ items: [], total: 0 });
    expect(backend.requests).toHaveLength(2);
  });

  it('pauseClock drives only the pauses between retries; the time limit stays on clock', async () => {
    backend.handle((_req, res) => {
      if (backend.requests.length === 1) res.writeHead(502).end();
      else json(res, 200, { items: [], total: 0 });
    });
    const pauses = watchedClock();
    const config = loadConfig(
      { LOADCRAFT_API_URL: `${backend.origin}/api/v1`, LOADCRAFT_API_TOKEN: CANARY },
      '/tmp',
    );
    const log = createLogger({ level: 'debug', sink: (line) => void logLines.push(line) });
    const call = createHttp(config, log, { clock, pauseClock: pauses }).GET('/api/v1/projects');

    await until(() => pauses.sleeping(250), 'pause after the first attempt on pauseClock');
    expect(clock.sleeping(250)).toBe(false);
    expect(clock.sleeping(DEFAULT_TIMEOUT_MS)).toBe(true);
    expect(pauses.sleeping(DEFAULT_TIMEOUT_MS)).toBe(false);
    await pauses.advance(250);

    await expect(call).resolves.toMatchObject({ data: { items: [], total: 0 } });
    expect(backend.requests).toHaveLength(2);
  });

  it('retries a GET after a network error', async () => {
    backend.handle((req, res) => {
      if (backend.requests.length === 1) res.socket?.destroy();
      else json(res, 200, { items: [], total: 0 });
      void req;
    });
    const call = client().GET('/api/v1/projects');
    await until(() => clock.sleeping(250), 'pause after the first attempt');
    await clock.advance(250);

    await expect(call).resolves.toMatchObject({ data: { items: [], total: 0 } });
  });

  it('never retries a POST after 503', async () => {
    backend.handle((_req, res) => json(res, 503, { detail: 'Service unavailable' }));
    const error = await apiError(client().POST('/api/v1/projects', { body: project }));

    expect(error.code).toBe('unavailable');
    await clock.advance(10_000);
    await settle();
    expect(backend.requests).toHaveLength(1);
  });

  it('never retries a POST after a network error', async () => {
    backend.handle((_req, res) => res.socket?.destroy());
    const error = await apiError(client().POST('/api/v1/projects', { body: project }));

    expect(error.code).toBe('network_error');
    expect(error.retryable).toBe(true);
    await clock.advance(10_000);
    await settle();
    expect(backend.requests).toHaveLength(1);
  });

  it('does not retry a GET after 500 or 4xx', async () => {
    backend.handle((_req, res) => json(res, 500, { detail: 'boom' }));
    const error = await apiError(client().GET('/api/v1/projects'));

    expect(error.retryable).toBe(false);
    await clock.advance(10_000);
    await settle();
    expect(backend.requests).toHaveLength(1);
  });
});

describe('createHttp: redirects', () => {
  let target: Backend;

  beforeEach(async () => {
    target = await startBackend();
  });

  afterEach(async () => {
    await target.close();
  });

  const targetHost = (): string => new URL(target.origin).host;

  it.each([
    ['GET', 307],
    ['GET', 302],
    ['POST', 307],
    ['POST', 302],
  ] as const)(
    '%s answered %i is a named error, not followed, not repeated',
    async (method, status) => {
      backend.handle((_req, res) => {
        res
          .writeHead(status, {
            Location: `${target.origin}/api/v1/projects?key=${CANARY}`,
            'Content-Type': 'text/plain',
          })
          .end('moved');
      });
      const http = client();
      const call =
        method === 'GET'
          ? http.GET('/api/v1/projects')
          : http.POST('/api/v1/projects', { body: project });
      const error = await apiError(call);

      expect(error.code).toBe('unexpected_redirect');
      expect(error.status).toBe(status);
      expect(error.retryable).toBe(false);
      expect(error.message).toContain(method);
      expect(error.message).toContain('/api/v1/projects');
      expect(error.message).toContain(String(status));
      expect(error.message).toContain(targetHost());
      expect(error.message).not.toContain('key=');
      expect(error.message).not.toContain('Bearer');
      await clock.advance(10_000);
      await settle();
      expect(target.requests).toHaveLength(0);
      expect(backend.requests).toHaveLength(1);
      assertNoCanary(error.message, JSON.stringify(error), error.details, logLines);
    },
  );

  it('names only the host of a relative Location, which is the configured one', async () => {
    backend.handle((_req, res) => {
      res.writeHead(307, { Location: '/api/v1/projects/' }).end();
    });
    const error = await apiError(client().GET('/api/v1/projects'));

    expect(error.code).toBe('unexpected_redirect');
    expect(error.message).toContain(new URL(backend.origin).host);
  });

  it('copes with a redirect that carries no usable Location', async () => {
    backend.handle((_req, res) => {
      res.writeHead(302).end();
    });
    const error = await apiError(client().GET('/api/v1/projects'));

    expect(error.code).toBe('unexpected_redirect');
    expect(error.message).toContain('302');
  });
});

describe('createHttp: time limit and cancellation', () => {
  it(`gives up after ${String(DEFAULT_TIMEOUT_MS)} ms with code timeout`, async () => {
    backend.handle(() => undefined);
    const call = apiError(client().GET('/api/v1/projects'));
    await until(() => backend.requests.length === 1, 'request');

    await clock.advance(DEFAULT_TIMEOUT_MS - 1);
    await settle();
    let settled = false;
    void call.then(() => (settled = true));
    await settle();
    expect(settled).toBe(false);

    await clock.advance(1);
    const error = await call;
    expect(error.code).toBe('timeout');
    await backend.requests[0]?.aborted;
  });

  it('takes a per-call time limit', async () => {
    backend.handle(() => undefined);
    const call = apiError(client().POST('/api/v1/projects', { body: project, timeoutMs: 300_000 }));
    await until(() => backend.requests.length === 1, 'request');
    await clock.advance(DEFAULT_TIMEOUT_MS);
    await settle();
    let settled = false;
    void call.then(() => (settled = true));
    await settle();
    expect(settled).toBe(false);

    await clock.advance(300_000 - DEFAULT_TIMEOUT_MS);
    expect((await call).code).toBe('timeout');
  });

  it('the time limit also ends the wait between retries', async () => {
    backend.handle((_req, res) => json(res, 503, { detail: 'Service unavailable' }));
    const call = apiError(client().GET('/api/v1/projects', { timeoutMs: 100 }));
    await until(() => clock.sleeping(250), 'pause after the first attempt');

    await clock.advance(100);
    expect((await call).code).toBe('timeout');
    await clock.advance(10_000);
    await settle();
    expect(backend.requests).toHaveLength(1);
  });

  it("the caller's signal ends the request", async () => {
    backend.handle(() => undefined);
    const controller = new AbortController();
    const call = rejection(client().GET('/api/v1/projects', { signal: controller.signal }));
    await until(() => backend.requests.length === 1, 'request');

    controller.abort();
    const error = await call;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('AbortError');
    await backend.requests[0]?.aborted;
  });

  it("the caller's signal also ends the wait between retries", async () => {
    backend.handle((_req, res) => json(res, 503, { detail: 'Service unavailable' }));
    const controller = new AbortController();
    const call = rejection(client().GET('/api/v1/projects', { signal: controller.signal }));
    await until(() => clock.sleeping(250), 'pause after the first attempt');

    controller.abort();
    expect(((await call) as Error).name).toBe('AbortError');
    await clock.advance(10_000);
    await settle();
    expect(backend.requests).toHaveLength(1);
  });
});

describe('createHttp: secrets', () => {
  it('the token never reaches error messages, serialized errors or the log', async () => {
    const http = client();
    const errors: unknown[] = [];

    backend.handle((_req, res) => json(res, 401, { detail: `Invalid token ${CANARY}` }));
    errors.push(await rejection(http.GET('/api/v1/projects')));

    backend.handle((_req, res) =>
      json(res, 409, { detail: { error: 'conflict', echo: `Bearer ${CANARY}` } }),
    );
    errors.push(await rejection(http.POST('/api/v1/projects', { body: project })));

    backend.handle((_req, res) => res.socket?.destroy());
    errors.push(await rejection(http.POST('/api/v1/projects', { body: project })));

    backend.handle(() => undefined);
    const slow = rejection(http.POST('/api/v1/projects', { body: project }));
    await until(() => backend.requests.length === 4, 'slow request');
    await clock.advance(DEFAULT_TIMEOUT_MS);
    errors.push(await slow);

    expect(logLines.length).toBeGreaterThan(0);
    for (const error of errors) {
      expect(error).toBeInstanceOf(LoadcraftApiError);
      const { message } = error as LoadcraftApiError;
      assertNoCanary(message, JSON.stringify(error), error, (error as LoadcraftApiError).details);
    }
    assertNoCanary(logLines);
  });

  it('a non-JSON error body cut to its quote leaves no head of the token in the message', async () => {
    // The quote of a page that is not JSON keeps its first 200 characters: the token is masked in
    // the body before that cut, or its first characters would stay behind.
    backend.handle((_req, res) => {
      res.writeHead(400, { 'content-type': 'text/html' });
      res.end(`<p>${'x'.repeat(181)} ${CANARY}</p>`);
    });
    const error = await apiError(client().GET('/api/v1/projects'));
    expect(error.code).toBe('bad_gateway');
    expect(error.message).toContain('xxx');
    expect(error.message).not.toContain(CANARY.slice(0, 8));
  });

  it('errors and log lines never carry request headers or the request body', async () => {
    const marker = 'BODY-MARKER-91c2';
    backend.handle((_req, res) => json(res, 500, { detail: 'boom' }));
    const error = await apiError(
      client().POST('/api/v1/projects', { body: { ...project, description: marker } }),
    );

    const outputs = [error.message, JSON.stringify(error), JSON.stringify(error.details ?? null)];
    outputs.push(...logLines);
    for (const text of outputs) {
      expect(text).not.toContain(marker);
      expect(text).not.toContain('Bearer');
      expect(text).not.toContain('loadcraft-mcp/');
    }
  });
});
