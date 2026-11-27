// Faults that touch every answer of the fake backend: a proxy in front of it that taints each JSON
// answer with a sentinel secret, or answers every request with an error that quotes the sentinel.
// The fake itself checks its answers against the contract and so cannot be made to send extra keys;
// the proxy sits after that check, on the wire, where a real backend that leaks would also be seen.
//
// Three sentinels, each a different value (helpers/canary.ts): the token, the passwords of the
// customer's files and the secrets of the backend's own data. Free text in an answer carries the
// token (a value the plugin knows and must hide wherever it shows). Fields whose name says they hold
// a secret carry the backend's secret, as does the nested `password` key and the list element.
// Headers carry the token. The plugin can hide a backend secret only after it has seen it in a field
// of a secret name - in an earlier answer of the call (`quoteBackend`) or in the error body itself
// (`secretField`); a secret in free text alone cannot be told from any other word.
// Failure: every request except the two the plugin makes to learn who and what it is talking to
// (`GET /meta`, `GET /auth/me`) - or those of the methods asked for - answers with the given status
// and a body that quotes the request it refused and the secrets.

import { request as httpRequest, createServer, type IncomingMessage, type Server } from 'node:http';
import { connect as netConnect } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

import { onTestFinished } from 'vitest';

import { BACKEND_CANARY, SHAPE_CANARY, TOKEN_CANARY } from '../helpers/canary.js';
import type { Fake } from './server.js';

/** Fields of a backend answer that hold free text a person wrote or the backend composed. */
const TEXT_KEYS: ReadonlySet<string> = new Set([
  'description',
  'message',
  'summary',
  'detail',
  'note',
  'title',
  'reason',
  'label',
  'error',
  'error_message',
  'comment',
  'hint',
  'content',
  'text',
  'body',
]);

/** Fields whose name says they hold a secret: the backend that leaks sends the value itself. */
const SECRET_KEY = /pass(word|wd)?|secret|token|credential|api[_-]?key/iu;

/**
 * A field that names where a token is fetched (`token_endpoint`), not the token: the plugin shows the
 * address of an environment's token endpoint. Nothing else is spared - an address or a path in a field
 * of a secret name (`password_url`) can carry the secret itself.
 */
const LOCATION_KEY = /endpoint$/iu;

export interface TaintOptions {
  /** Also taint `name`, the one free-text field the plugin resolves objects by. */
  readonly names?: boolean;
  /** Only answers to these methods are tainted (default: all); the rest pass untouched. */
  readonly methods?: readonly string[];
  /**
   * Every free text also carries a credential known only by its shape (`SHAPE_CANARY` after
   * `Authorization: Bearer`): a view that prints a third party's text without its mask leaks it.
   */
  readonly shapes?: boolean;
}

function taintValue(value: unknown, options: TaintOptions): unknown {
  if (Array.isArray(value)) return value.map((item) => taintValue(item, options));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && SECRET_KEY.test(key) && !LOCATION_KEY.test(key)) {
      out[key] = BACKEND_CANARY;
    } else if (
      typeof item === 'string' &&
      (TEXT_KEYS.has(key) || (options.names === true && key === 'name'))
    ) {
      out[key] =
        options.shapes === true
          ? `${item} (${TOKEN_CANARY}) Authorization: Bearer ${SHAPE_CANARY}`
          : `${item} (${TOKEN_CANARY})`;
    } else {
      out[key] = taintValue(item, options);
    }
  }
  return out;
}

/**
 * The body with the sentinel in a text value, under a nested `password` key and in a list. The three
 * additions go to the top level of an object body only: nested maps are typed by the plugin as
 * records of numbers and must keep their shape.
 */
export function taintBody(body: unknown, options: TaintOptions = {}): unknown {
  const tainted = taintValue(body, options);
  if (typeof tainted !== 'object' || tainted === null || Array.isArray(tainted)) return tainted;
  return {
    ...tainted,
    x_note: `diagnostic ${TOKEN_CANARY} end`,
    x_nested: { account: { password: BACKEND_CANARY } },
    x_list: ['first', BACKEND_CANARY],
  };
}

/** How the error body of a failing request carries the secrets. */
export interface FailureQuote {
  /** The backend's own secret (a value an earlier answer carried) instead of a second token. */
  readonly backendSecret?: boolean;
  /** The backend's secret in fields of a secret name only, a value no earlier answer carried. */
  readonly secretField?: boolean;
  /** The message is the secret written back to back after `shift` filler characters. */
  readonly run?: number;
  /**
   * The backend's secret bare in a text, in no field of a secret name and in no earlier answer:
   * a stack trace that prints a connection string. Only the status of the error can keep it away.
   */
  readonly bare?: boolean;
}

/** A word of the bare text that no view or hint of the plugin contains. */
export const BARE_MARKER = 'db-internal.example';

/** Copies enough to carry the secret past any quote limit of a view. */
const RUN_COPIES = 40;

/**
 * The error body a backend of status `status` sends. It quotes the request it refused (`echo`, the
 * request body as text) and the backend's own secret, the way a backend that repeats its input and
 * its data in an error does; the token goes in too.
 */
export function failureBody(status: number, echo: string, quote: FailureQuote = {}): unknown {
  if (quote.bare === true) {
    const text = `Traceback (most recent call last): connect to ${BARE_MARKER} failed, dsn=${BACKEND_CANARY}`;
    if (status === 409) return { detail: { code: 'conflict', message: text } };
    return { detail: text };
  }
  if (quote.run !== undefined) {
    // No field of a secret name: only a value the call registered can hide the secret, and the
    // limit of the quote falls inside one of the copies.
    const secret = quote.backendSecret === true ? BACKEND_CANARY : TOKEN_CANARY;
    const text = `${'y'.repeat(quote.run)}${secret.repeat(RUN_COPIES)}`;
    if (status === 422) {
      return { detail: [{ type: 'value_error', loc: ['body', 'name'], msg: text }] };
    }
    if (status === 409) return { detail: { code: 'conflict', message: text } };
    return { detail: text };
  }
  if (quote.secretField === true && (status === 422 || status === 409)) {
    // A secret the plugin never saw, in a field whose name says what it is, and quoted in the text.
    const resetUrl = `https://example.com/reset?key=${BACKEND_CANARY}`;
    if (status === 422) {
      return {
        detail: [
          {
            type: 'string_too_short',
            loc: ['body', 'account', 'password'],
            msg: `value rejected: ${BACKEND_CANARY}`,
            input: BACKEND_CANARY,
          },
        ],
      };
    }
    return {
      detail: {
        code: 'conflict',
        message: `already exists, reset it at ${resetUrl} ${echo}`,
        password_url: resetUrl,
      },
    };
  }
  const secret = quote.backendSecret === true ? BACKEND_CANARY : TOKEN_CANARY;
  const quoted = `${secret} ${TOKEN_CANARY} ${echo}`;
  if (status === 422) {
    return {
      detail: [
        {
          type: 'string_too_short',
          loc: ['body', 'password'],
          msg: `value rejected: ${quoted}`,
          input: quoted,
        },
      ],
    };
  }
  if (status === 409) {
    return {
      detail: { code: 'conflict', message: `already exists ${quoted}`, password: secret },
    };
  }
  return { detail: `request failed for credentials ${quoted}` };
}

export interface FailOptions {
  /** Only requests of these methods fail (default: all but the identity reads). */
  readonly methods?: readonly string[];
  /**
   * The error quotes a secret of the backend's own data (a value an earlier answer of the same call
   * carried), not only the token and the request. A secret the plugin never saw cannot be hidden.
   */
  readonly quoteBackend?: boolean;
  /**
   * The error names a secret of the backend in a field of a secret name (`password_url`, the input
   * of a validation error about `password`) and quotes it, a value no earlier answer carried: the
   * plugin can hide it only by the name of the field. Statuses 422 and 409.
   */
  readonly secretField?: boolean;
  /**
   * The error's text is the secret (the backend's with `quoteBackend`, else the token) written back
   * to back after this many filler characters, in no field of a secret name: wherever a view cuts
   * the quote, the cut falls inside a copy.
   */
  readonly quoteRun?: number;
  /** The error text holds the backend's secret bare (see `FailureQuote.bare`). */
  readonly bareSecret?: boolean;
  /** Only requests whose path matches fail. */
  readonly path?: RegExp;
  /** Matching requests that pass before the first one fails. */
  readonly skip?: number;
}

export interface TaintProxy {
  /** Address the plugin is pointed at instead of the fake's (the same `/api/v1` prefix applies). */
  readonly url: string;
  /** From now on every request except the identity ones fails with `status`; `undefined` ends it. */
  failWith(status: number | undefined, options?: FailOptions): void;
  /** Switches the taint off (the steps before the call under test) and on again. */
  taint(on: boolean): void;
  /** Number of answers that carried the sentinel so far (a test proves the proxy was in the way). */
  readonly tainted: number;
}

const PASSED_IN_FAIL_MODE = new Set(['GET /api/v1/meta', 'GET /api/v1/auth/me']);

function readAll(stream: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    stream.on('error', reject);
  });
}

function forward(
  fake: Fake,
  req: IncomingMessage,
  body: Buffer,
): Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer }> {
  const target = new URL(fake.url);
  return new Promise((resolve, reject) => {
    const upstream = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        headers: { ...req.headers, host: target.host },
        agent: false,
      },
      (res) => {
        readAll(res).then((payload) => {
          resolve({ status: res.statusCode ?? 502, headers: res.headers, body: payload });
        }, reject);
      },
    );
    upstream.on('error', reject);
    upstream.end(body);
  });
}

const SECRET_HEADERS: Record<string, string> = {
  'x-debug-token': TOKEN_CANARY,
  'set-cookie': `session=${TOKEN_CANARY}; Path=/`,
};

/**
 * Starts the proxy in front of `fake`; it is closed when the test ends. WebSocket upgrades are
 * tunnelled untouched, so the plugin may reach the channels of the fake through it.
 */
export async function taintProxy(fake: Fake, options: TaintOptions = {}): Promise<TaintProxy> {
  let failing: number | undefined;
  let failOptions: FailOptions = {};
  let failSkipped = 0;
  let taintOn = true;
  let tainted = 0;
  const sockets = new Set<Duplex>();

  const server: Server = createServer((req, res) => {
    const respond = async (): Promise<void> => {
      const body = await readAll(req);
      const key = `${req.method ?? 'GET'} ${(req.url ?? '/').split('?')[0] ?? '/'}`;
      let failsHere =
        failing !== undefined &&
        !PASSED_IN_FAIL_MODE.has(key) &&
        (failOptions.methods === undefined || failOptions.methods.includes(req.method ?? 'GET')) &&
        (failOptions.path === undefined || failOptions.path.test(key));
      if (failsHere && failSkipped < (failOptions.skip ?? 0)) {
        failSkipped += 1;
        failsHere = false;
      }
      if (failing !== undefined && failsHere) {
        tainted += 1;
        res.writeHead(failing, {
          'content-type': 'application/json',
          'www-authenticate': `Bearer realm="${TOKEN_CANARY}"`,
          ...SECRET_HEADERS,
        });
        res.end(
          JSON.stringify(
            failureBody(failing, body.toString('utf8'), {
              backendSecret: failOptions.quoteBackend === true,
              secretField: failOptions.secretField === true,
              bare: failOptions.bareSecret === true,
              ...(failOptions.quoteRun === undefined ? {} : { run: failOptions.quoteRun }),
            }),
          ),
        );
        return;
      }
      const answer = await forward(fake, req, body);
      const type = String(answer.headers['content-type'] ?? '');
      const headers: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(answer.headers)) {
        if (value === undefined || name === 'content-length' || name === 'transfer-encoding') {
          continue;
        }
        headers[name] = value;
      }
      const method = req.method ?? 'GET';
      const selected = options.methods === undefined || options.methods.includes(method);
      if (taintOn && selected && type.includes('json') && answer.body.length > 0) {
        tainted += 1;
        const text = JSON.stringify(
          taintBody(JSON.parse(answer.body.toString('utf8')) as unknown, options),
        );
        res.writeHead(answer.status, { ...headers, ...SECRET_HEADERS });
        res.end(text);
        return;
      }
      res.writeHead(answer.status, headers);
      res.end(answer.body);
    };
    respond().catch((error: unknown) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`proxy failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const target = new URL(fake.url);
    const upstream = netConnect(Number(target.port), target.hostname, () => {
      const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        lines.push(`${req.rawHeaders[i] ?? ''}: ${req.rawHeaders[i + 1] ?? ''}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    sockets.add(socket);
    sockets.add(upstream);
    const drop = (): void => {
      socket.destroy();
      upstream.destroy();
    };
    socket.on('error', drop);
    upstream.on('error', drop);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;

  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  );

  return {
    url: `http://127.0.0.1:${String(port)}`,
    failWith(status, options = {}) {
      failing = status;
      failOptions = options;
      failSkipped = 0;
    },
    taint(on) {
      taintOn = on;
    },
    get tainted() {
      return tainted;
    },
  };
}
