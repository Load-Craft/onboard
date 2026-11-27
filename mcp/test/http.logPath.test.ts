// The process log names the route template of a request, never its concrete path: a segment can come
// from the target's own text and carry a secret the log of the process does not mask.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createHttp, type HttpClient } from '../src/http/client.js';
import { createLogger } from '../src/log.js';
import { CANARY, leakedPieces } from './helpers/canary.js';
import { createTestClock } from './helpers/clock.js';

const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTYifQ', 'c2lnbmF0dXJl'].join('.');
const KEY = ['sk', 'live', 'Abcdefgh12345678'].join('_');
const TEMPLATE = '/api/v1/projects/{project_id}';

type Behaviour = 'ok' | 'flaky' | 'redirect' | 'destroy' | 'big';

let server: Server;
let origin: string;
let behaviour: Behaviour;
let hits: number;
let lines: string[];

beforeEach(async () => {
  hits = 0;
  lines = [];
  behaviour = 'ok';
  server = createServer((req, res) => {
    hits += 1;
    if (behaviour === 'destroy') {
      req.socket.destroy();
    } else if (behaviour === 'redirect') {
      res.writeHead(302, { Location: `https://elsewhere.example/${KEY}?t=${JWT}` }).end();
    } else if (behaviour === 'flaky' && hits === 1) {
      res.writeHead(503).end();
    } else if (behaviour === 'big') {
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ x: 'y'.repeat(500) }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
});

function client(): HttpClient {
  const config = loadConfig(
    { LOADCRAFT_API_URL: `${origin}/api/v1`, LOADCRAFT_API_TOKEN: CANARY },
    '/tmp',
  );
  const log = createLogger({ level: 'debug', sink: (line) => void lines.push(line) });
  const clock = createTestClock();
  return createHttp(config, log, {
    clock,
    pauseClock: { now: () => clock.now(), sleep: () => Promise.resolve() },
  });
}

/** One GET whose path segment and query both carry the canaries. */
const get = (http: HttpClient, extra: { maxResponseBytes?: number } = {}) =>
  http.GET(TEMPLATE, {
    params: { path: { project_id: `${JWT}-${KEY}` } },
    querySerializer: () => `token=${JWT}&key=${KEY}`,
    ...extra,
  });

const settled = async (promise: Promise<unknown>): Promise<void> => {
  try {
    await promise;
  } catch {
    // the failure itself is the case
  }
};

describe('the log of the HTTP client names the route, not the path', () => {
  it.each([
    ['a success (debug)', 'ok', 'http response'],
    ['a retry (warn)', 'flaky', 'http retry'],
    ['an unexpected redirect (warn)', 'redirect', 'http unexpected redirect'],
    ['a network error (warn)', 'destroy', 'http network error'],
  ] as const)('%s', async (_, mode, message) => {
    behaviour = mode;
    await settled(get(client()));
    const text = lines.join('\n');
    expect(text).toContain(message);
    expect(text).toContain(TEMPLATE);
    expect(leakedPieces(text, [JWT])).toEqual([]);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('Abcdefgh12345678');
  });

  it('a response that is too large (warn)', async () => {
    behaviour = 'big';
    await settled(get(client(), { maxResponseBytes: 10 }));
    const text = lines.join('\n');
    expect(text).toContain('http response too large');
    expect(text).toContain(TEMPLATE);
    expect(leakedPieces(text, [JWT])).toEqual([]);
    expect(text).not.toContain(KEY);
  });
});
