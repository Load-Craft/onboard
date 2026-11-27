import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import { Secret } from '../src/secret.js';
import { LoadcraftApiError } from '../src/http/apiError.js';
import { createLogger } from '../src/log.js';
import type { Logger } from '../src/log.js';
import {
  ChannelLost,
  ChannelUnavailable,
  DEFAULT_RECONNECT,
  openChannel,
} from '../src/ws/channel.js';
import type { ChannelContext } from '../src/ws/channel.js';
import { CHANNELS } from '../src/ws/frames.js';
import type { Channel } from '../src/ws/frames.js';
import { channelRequirement } from '../src/ws/url.js';
import { CANARY, assertNoCanary } from './helpers/canary.js';
import { createTestClock } from './helpers/clock.js';
import type { TestClock } from './helpers/clock.js';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');

// ---- test server ------------------------------------------------------------------------

/** What the server does with the n-th upgrade request (1-based). */
type Decision = 'accept' | 'hang' | number;

interface Seen {
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
}

interface TestServer {
  readonly port: number;
  readonly apiUrl: string;
  readonly seen: Seen[];
  /** Resolves with the n-th accepted socket (1-based). */
  accepted(n: number): Promise<WebSocket>;
  /** Stops listening and drops every connection, so the port refuses new ones. */
  close(): Promise<void>;
}

const servers: TestServer[] = [];

const STATUS_TEXT: Record<number, string> = {
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
};

async function startServer(
  decide: (n: number) => Decision = () => 'accept',
  onAccept: (ws: WebSocket) => void = () => undefined,
): Promise<TestServer> {
  const http: Server = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const seen: Seen[] = [];
  const sockets = new Set<Socket>();
  const acceptedSockets: WebSocket[] = [];
  const waiters = new Map<number, (ws: WebSocket) => void>();

  http.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  http.on('upgrade', (req, socket: Socket, head: Buffer) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    const decision = decide(seen.length);
    if (decision === 'hang') return;
    if (typeof decision === 'number') {
      const text = STATUS_TEXT[decision] ?? 'Error';
      socket.end(`HTTP/1.1 ${String(decision)} ${text}\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      onAccept(ws);
      acceptedSockets.push(ws);
      waiters.get(acceptedSockets.length)?.(ws);
    });
  });
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  const address = http.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  const server: TestServer = {
    port,
    apiUrl: `http://127.0.0.1:${String(port)}/api/v1`,
    seen,
    accepted(n) {
      const ready = acceptedSockets[n - 1];
      if (ready !== undefined) return Promise.resolve(ready);
      return new Promise((done) => waiters.set(n, done));
    },
    async close() {
      for (const ws of acceptedSockets) ws.terminate();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => http.close(() => done()));
      wss.close();
    },
  };
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => undefined)));
});

async function closedPort(): Promise<number> {
  const server = await startServer();
  await server.close();
  const at = servers.indexOf(server);
  if (at !== -1) servers.splice(at, 1);
  return server.port;
}

// ---- helpers ----------------------------------------------------------------------------

interface Harness {
  readonly ctx: ChannelContext;
  readonly lines: string[];
  readonly log: Logger;
  readonly clock: TestClock;
}

function harness(apiUrl: string, token = CANARY): Harness {
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  const ctx: ChannelContext = { config: { apiUrl, token: new Secret(token) }, log };
  return { ctx, lines, log, clock: createTestClock() };
}

function frame(type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ type, payload });
}

function flat(type: string, keys: Record<string, unknown>): string {
  return JSON.stringify({ type, ...keys });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

function waitForLog(lines: string[], fragment: string, count = 1): Promise<void> {
  return vi.waitFor(
    () => {
      const hits = lines.filter((line) => line.includes(fragment)).length;
      if (hits < count) throw new Error(`waiting for ${String(count)} x "${fragment}"`);
    },
    { timeout: 3000, interval: 5 },
  );
}

function closeEvent(ws: WebSocket): Promise<number> {
  return new Promise((done) => ws.once('close', (code: number) => done(code)));
}

// ---- tests ------------------------------------------------------------------------------

describe('openChannel: frames', () => {
  it('reads payload-enveloped frames and skips heartbeat, ping and unknown frames', async () => {
    const server = await startServer();
    const { ctx, lines } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'scenario',
      params: { run_id: 'run-1' },
    });
    const ws = await server.accepted(1);
    ws.send(JSON.stringify({ type: 'heartbeat' }));
    ws.send(JSON.stringify({ type: 'ping' }));
    ws.send(frame('gatling-scenario:shiny-new', { x: 1 }));
    ws.send(frame('gatling-scenario:progress', { progress: 40, step_label: 'Compiling' }));
    ws.send(frame('gatling-scenario:complete', { scenario_id: 'sc-1' }));

    const it = channel.frames[Symbol.asyncIterator]();
    const first = await it.next();
    const second = await it.next();
    expect(first.value).toEqual({
      kind: 'frame',
      channel: 'scenario',
      type: 'gatling-scenario:progress',
      data: { progress: 40, step_label: 'Compiling' },
    });
    expect(second.value).toMatchObject({
      type: 'gatling-scenario:complete',
      data: { scenario_id: 'sc-1' },
    });
    const debug = lines.filter((line) => line.includes('"level":"debug"'));
    for (const skipped of ['heartbeat', 'ping', 'gatling-scenario:shiny-new']) {
      expect(
        debug.some((line) => line.includes(skipped)),
        skipped,
      ).toBe(true);
    }
    channel.close();
  });

  it('does not lose a frame the server sends in the same tick as it accepts', async () => {
    const state = { job_id: 'j', status: 'running', progress: 30 };
    const server = await startServer(
      () => 'accept',
      (ws) => ws.send(frame('flow-suggestions-refine:progress', state)),
    );
    const { ctx } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'refine',
      params: { job_id: 'j' },
    });
    const it = channel.frames[Symbol.asyncIterator]();
    expect((await it.next()).value).toMatchObject({ data: state });
    channel.close();
  });

  it('a frame outside the contract sent as the server accepts fails the stream, not the opening', async () => {
    const server = await startServer(
      () => 'accept',
      (ws) => {
        ws.send(frame('gatling-scenario:progress', { progress: 30 }));
        ws.send(frame('gatling-scenario:complete', {}));
      },
    );
    const { ctx } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'scenario',
      params: { run_id: 'r' },
    });
    const it = channel.frames[Symbol.asyncIterator]();
    expect((await it.next()).value).toMatchObject({ data: { progress: 30 } });
    const error = await rejection(it.next());
    expect(error).toMatchObject({ name: 'FrameParseError', field: 'payload.scenario_id' });
  });

  it('reads flat frames of the describe channel', async () => {
    const server = await startServer();
    const { ctx } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'describe',
      params: { project_id: 'p-1', run_id: 'r-1' },
    });
    const ws = await server.accepted(1);
    ws.send(flat('path_done', { path_index: 2, path_name: 'Checkout' }));

    const it = channel.frames[Symbol.asyncIterator]();
    expect((await it.next()).value).toEqual({
      kind: 'frame',
      channel: 'describe',
      type: 'path_done',
      data: { path_index: 2, path_name: 'Checkout' },
    });
    channel.close();
  });

  it('ends the stream after a normal close from the server', async () => {
    const server = await startServer();
    const { ctx } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'analysis',
      params: { run_id: 'r' },
    });
    const ws = await server.accepted(1);
    ws.send(frame('gatling-analysis:complete', { analysis: {} }));
    ws.close(1000, 'done');

    const types: string[] = [];
    for await (const item of channel.frames) types.push(item.type);
    expect(types).toEqual(['gatling-analysis:complete']);
    await expect(channel.closed).resolves.toMatchObject({ code: 1000, reason: 'done' });
  });

  it('fails the stream with FrameParseError when a known frame breaks the contract', async () => {
    const server = await startServer();
    const { ctx } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'scenario',
      params: { run_id: 'r' },
    });
    const ws = await server.accepted(1);
    ws.send(frame('gatling-scenario:complete', {}));
    const error = await rejection(channel.frames[Symbol.asyncIterator]().next());
    expect(error).toMatchObject({ name: 'FrameParseError', field: 'payload.scenario_id' });
  });
});

describe('openChannel: address and headers', () => {
  it("a channel that requires 'none' gets no Authorization header and no token in the address", async () => {
    const server = await startServer();
    const { ctx } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'batch',
      params: { run_id: 'run-7' },
    });
    const [seen] = server.seen;
    expect(seen?.url).toBe('/ws/batch-generation/run-7');
    expect(seen?.headers.authorization).toBeUndefined();
    expect(seen?.headers.origin).toBeUndefined();
    assertNoCanary(server.seen);
    channel.close();
  });

  it("a channel that requires 'identity' gets the bearer token in a header only", async () => {
    const server = await startServer();
    const { ctx } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'har',
      params: { project_id: 'p-1', session_id: 's-1' },
    });
    const [seen] = server.seen;
    expect(seen?.url).toBe('/ws/projects/p-1/har/s-1');
    expect(seen?.headers.authorization).toBe(`Bearer ${CANARY}`);
    expect(seen?.headers.origin).toBeUndefined();
    expect(seen?.url).not.toContain(CANARY);
    channel.close();
  });

  it("a channel that requires 'identity_and_origin' gets Authorization and an Origin equal to the address origin", async () => {
    const server = await startServer();
    const { ctx } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'describe',
      params: { project_id: 'p-1', run_id: 'r-1' },
    });
    const [seen] = server.seen;
    expect(seen?.url).toBe('/ws/projects/p-1/scenario-from-description/runs/r-1');
    expect(seen?.headers.authorization).toBe(`Bearer ${CANARY}`);
    expect(seen?.headers.origin).toBe(`http://127.0.0.1:${String(server.port)}`);
    expect(seen?.headers.host).toBe(`127.0.0.1:${String(server.port)}`);
    expect(seen?.url).not.toContain(CANARY);
    channel.close();
  });

  const PARAMS_OF: Record<Channel, Readonly<Record<string, string>>> = {
    refine: { job_id: 'j' },
    batch: { run_id: 'r' },
    scenario: { run_id: 'r' },
    analysis: { run_id: 'r' },
    har: { project_id: 'p', session_id: 's' },
    describe: { project_id: 'p', run_id: 'r' },
    healthCheck: { session_id: 's' },
    testTypes: { run_id: 'r' },
    payloadGen: { run_id: 'r' },
    gatlingFeeder: { run_id: 'r' },
  };

  // The caller names only the channel: what the connection presents follows the frame contract, so
  // the token goes exactly to the channels that require it.
  it.each(CHANNELS.map((name) => [name, channelRequirement(name)] as const))(
    'channel %s presents what the contract requires (%s)',
    async (name, requires) => {
      const server = await startServer();
      const { ctx } = harness(server.apiUrl);
      const channel = await openChannel(ctx, { channel: name, params: PARAMS_OF[name] });
      const [seen] = server.seen;
      expect(seen?.headers.authorization).toBe(
        requires === 'none' ? undefined : `Bearer ${CANARY}`,
      );
      expect(seen?.headers.origin).toBe(
        requires === 'identity_and_origin' ? `http://127.0.0.1:${String(server.port)}` : undefined,
      );
      expect(seen?.url).not.toContain(CANARY);
      channel.close();
    },
  );
});

describe('openChannel: refusals and close codes', () => {
  it.each([
    [4001, 'unauthorized', 401],
    [4003, 'forbidden', 403],
    [4404, 'not_found', 404],
  ] as const)(
    'close code %i fails the stream with LoadcraftApiError %s',
    async (code, kind, status) => {
      const server = await startServer();
      const { ctx } = harness(server.apiUrl);
      const channel = await openChannel(ctx, {
        channel: 'describe',
        params: { project_id: 'p', run_id: 'r' },
      });
      const ws = await server.accepted(1);
      ws.close(code, 'refused');
      const error = await rejection(channel.frames[Symbol.asyncIterator]().next());
      expect(error).toBeInstanceOf(LoadcraftApiError);
      expect(error).toMatchObject({ code: kind, status, retryable: false });
      await expect(channel.closed).resolves.toMatchObject({ code });
    },
  );

  it('delivers the error frame sent before a 4404 close, then fails with not_found', async () => {
    const server = await startServer();
    const { ctx } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'refine',
      params: { job_id: 'gone' },
    });
    const ws = await server.accepted(1);
    ws.send(
      frame('flow-suggestions-refine:error', {
        job_id: 'gone',
        error: 'Job not found',
        reason: 'job_not_found',
      }),
    );
    ws.close(4404);
    const it = channel.frames[Symbol.asyncIterator]();
    expect((await it.next()).value).toMatchObject({ type: 'flow-suggestions-refine:error' });
    const error = await rejection(it.next());
    expect(error).toBeInstanceOf(LoadcraftApiError);
    expect(error).toMatchObject({ code: 'not_found' });
  });

  it('an HTTP 403 refusal before accept is forbidden and names the Origin header', async () => {
    const server = await startServer(() => 403);
    const { ctx } = harness(server.apiUrl);
    const error = await rejection(
      openChannel(ctx, {
        channel: 'describe',
        params: { project_id: 'p', run_id: 'r' },
      }),
    );
    expect(error).toBeInstanceOf(LoadcraftApiError);
    expect(error).toMatchObject({ code: 'forbidden', status: 403 });
    expect((error as Error).message).toMatch(/Origin/);
  });

  it('an HTTP 401 refusal before accept is unauthorized', async () => {
    const server = await startServer(() => 401);
    const { ctx } = harness(server.apiUrl);
    const error = await rejection(
      openChannel(ctx, { channel: 'har', params: { project_id: 'p', session_id: 's' } }),
    );
    expect(error).toBeInstanceOf(LoadcraftApiError);
    expect(error).toMatchObject({ code: 'unauthorized', status: 401 });
  });

  it('another unexpected close fails the stream with ChannelLost when reconnect is off', async () => {
    const server = await startServer();
    const { ctx } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'batch',
      params: { run_id: 'r' },
    });
    const ws = await server.accepted(1);
    ws.close(1011, 'boom');
    const error = await rejection(channel.frames[Symbol.asyncIterator]().next());
    expect(error).toBeInstanceOf(ChannelLost);
    expect(error).not.toBeInstanceOf(LoadcraftApiError);
    expect(error).toMatchObject({ channel: 'batch', closeCode: 1011, attempts: 0 });
  });
});

describe('openChannel: reconnect', () => {
  it('reconnects after a drop, continues the stream and gives up with ChannelLost after 3 attempts', async () => {
    const server = await startServer();
    const { ctx, lines, clock } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'batch',
      params: { run_id: 'r' },
      reconnect: { attempts: 3, delaysMs: [500, 2000, 5000] },
      clock,
    });
    const it = channel.frames[Symbol.asyncIterator]();

    const first = await server.accepted(1);
    first.send(frame('batch-generation:basket-progress', { basket_id: 'b1', progress: 10 }));
    expect((await it.next()).value).toMatchObject({ data: { basket_id: 'b1' } });

    first.terminate();
    await waitForLog(lines, 'channel reconnect scheduled');
    await clock.advance(499);
    expect(server.seen).toHaveLength(1);
    await clock.advance(1);
    const second = await server.accepted(2);
    second.send(frame('batch-generation:basket-progress', { basket_id: 'b2', progress: 20 }));
    expect((await it.next()).value).toMatchObject({ data: { basket_id: 'b2' } });

    const failed = rejection(it.next());
    await server.close();
    for (const [attempt, delay] of [
      [1, 500],
      [2, 2000],
      [3, 5000],
    ] as const) {
      // One scheduled reconnect happened before (the successful one), hence `attempt + 1`.
      await waitForLog(lines, 'channel reconnect scheduled', attempt + 1);
      const scheduled = lines.filter((line) => line.includes('channel reconnect scheduled'));
      expect(scheduled.at(-1)).toContain(`"attempt":${String(attempt)},"delayMs":${String(delay)}`);
      await clock.advance(delay - 1);
      expect(server.seen).toHaveLength(2);
      await clock.advance(1);
    }
    const error = await failed;
    expect(error).toBeInstanceOf(ChannelLost);
    expect(error).toMatchObject({ channel: 'batch', attempts: 3 });
    expect(server.seen).toHaveLength(2);
  });

  it('does not retry a reconnect that is refused with 4404', async () => {
    const server = await startServer();
    const { ctx, lines, clock } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'refine',
      params: { job_id: 'j' },
      reconnect: { attempts: 3, delaysMs: [500, 2000, 5000] },
      clock,
    });
    const it = channel.frames[Symbol.asyncIterator]();
    (await server.accepted(1)).terminate();
    await waitForLog(lines, 'channel reconnect scheduled');
    await clock.advance(500);
    (await server.accepted(2)).close(4404);
    const error = await rejection(it.next());
    expect(error).toBeInstanceOf(LoadcraftApiError);
    expect(error).toMatchObject({ code: 'not_found' });
    await clock.advance(10_000);
    expect(server.seen).toHaveLength(2);
  });
});

describe('openChannel: reconnect refused before accept', () => {
  it('does not retry a reconnect whose handshake is refused with HTTP 403', async () => {
    const server = await startServer((n) => (n === 1 ? 'accept' : 403));
    const { ctx, lines, clock } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'describe',
      params: { project_id: 'p', run_id: 'r' },
      reconnect: DEFAULT_RECONNECT,
      clock,
    });
    const it = channel.frames[Symbol.asyncIterator]();
    (await server.accepted(1)).terminate();
    await waitForLog(lines, 'channel reconnect scheduled');
    await clock.advance(500);
    const error = await rejection(it.next());
    expect(error).toBeInstanceOf(LoadcraftApiError);
    expect(error).toMatchObject({ code: 'forbidden', status: 403 });
    await clock.advance(10_000);
    expect(server.seen).toHaveLength(2);
    expect(lines.filter((line) => line.includes('channel reconnect scheduled'))).toHaveLength(1);
  });
});

describe('openChannel: availability, timeouts and abort', () => {
  it('a closed port is ChannelUnavailable with the network cause', async () => {
    const port = await closedPort();
    const { ctx } = harness(`http://127.0.0.1:${String(port)}/api/v1`);
    const error = await rejection(
      openChannel(ctx, { channel: 'scenario', params: { run_id: 'r' } }),
    );
    expect(error).toBeInstanceOf(ChannelUnavailable);
    expect(error).toMatchObject({ channel: 'scenario' });
    expect((error as Error).cause).toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('a handshake that does not finish within 10 s is ChannelUnavailable', async () => {
    const server = await startServer(() => 'hang');
    const { ctx, clock } = harness(server.apiUrl);
    const opening = rejection(
      openChannel(ctx, { channel: 'scenario', params: { run_id: 'r' }, clock }),
    );
    await vi.waitFor(() => expect(server.seen).toHaveLength(1));
    await clock.advance(9_999);
    await clock.advance(1);
    const error = await opening;
    expect(error).toBeInstanceOf(ChannelUnavailable);
    expect((error as Error).message).toMatch(/10 s|10000 ms|timed out/);
  });

  it('a channel silent for longer than its limit is lost', async () => {
    const server = await startServer();
    const { ctx, clock } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'scenario',
      params: { run_id: 'r' },
      silenceMs: 30_000,
      clock,
    });
    const ws = await server.accepted(1);
    const it = channel.frames[Symbol.asyncIterator]();

    await clock.advance(20_000);
    ws.send(JSON.stringify({ type: 'heartbeat' }));
    ws.send(frame('gatling-scenario:progress', { progress: 5 }));
    expect((await it.next()).value).toMatchObject({ data: { progress: 5 } });
    await clock.advance(20_000);
    ws.send(frame('gatling-scenario:progress', { progress: 6 }));
    expect((await it.next()).value).toMatchObject({ data: { progress: 6 } });

    const closed = closeEvent(ws);
    const lost = rejection(it.next());
    await clock.advance(30_000);
    const error = await lost;
    expect(error).toBeInstanceOf(ChannelLost);
    expect(error).toMatchObject({ reason: 'silence' });
    await closed;
  });

  it('aborting the signal fails the stream at once and closes the socket', async () => {
    const server = await startServer();
    const { ctx } = harness(server.apiUrl);
    const controller = new AbortController();
    const channel = await openChannel(ctx, {
      channel: 'scenario',
      params: { run_id: 'r' },
      signal: controller.signal,
    });
    const ws = await server.accepted(1);
    const serverSawClose = closeEvent(ws);
    const pending = rejection(channel.frames[Symbol.asyncIterator]().next());
    controller.abort();
    const error = await pending;
    expect(error).toMatchObject({ name: 'AbortError' });
    // terminate(): the socket is destroyed without a closing handshake, so both ends see 1006.
    expect(await serverSawClose).toBe(1006);
    await expect(channel.closed).resolves.toMatchObject({ code: 1006 });
  });

  it('aborting while the handshake is pending rejects the open', async () => {
    const server = await startServer(() => 'hang');
    const { ctx } = harness(server.apiUrl);
    const controller = new AbortController();
    const opening = rejection(
      openChannel(ctx, {
        channel: 'scenario',
        params: { run_id: 'r' },
        signal: controller.signal,
      }),
    );
    await vi.waitFor(() => expect(server.seen).toHaveLength(1));
    controller.abort();
    expect(await opening).toMatchObject({ name: 'AbortError' });
  });

  it('honours the abort signal of the tool context', async () => {
    const server = await startServer();
    const { ctx } = harness(server.apiUrl);
    const controller = new AbortController();
    const channel = await openChannel(
      { ...ctx, signal: controller.signal },
      { channel: 'scenario', params: { run_id: 'r' } },
    );
    const pending = rejection(channel.frames[Symbol.asyncIterator]().next());
    controller.abort();
    expect(await pending).toMatchObject({ name: 'AbortError' });
  });
});

describe('openChannel: secrets', () => {
  it('the token never shows up in logs or error texts', async () => {
    const server = await startServer((n) => (n === 1 ? 'accept' : 403));
    const { ctx, lines, log } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'describe',
      params: { project_id: 'p', run_id: 'r' },
    });
    log.info('echo', { token: CANARY });
    const ws = await server.accepted(1);
    ws.close(4003, CANARY);
    const closeError = await rejection(channel.frames[Symbol.asyncIterator]().next());

    const refused = await rejection(
      openChannel(ctx, {
        channel: 'describe',
        params: { project_id: 'p', run_id: 'r' },
      }),
    );
    const port = await closedPort();
    const unavailable = await rejection(
      openChannel(
        { ...ctx, config: { ...ctx.config, apiUrl: `http://127.0.0.1:${String(port)}/api/v1` } },
        { channel: 'har', params: { project_id: 'p', session_id: 's' } },
      ),
    );

    for (const error of [closeError, refused, unavailable]) {
      assertNoCanary(error, String(error), JSON.stringify(error), (error as Error).stack);
    }
    assertNoCanary(lines);
    expect(server.seen[0]?.headers.authorization).toBe(`Bearer ${CANARY}`);
  });

  it('logs the address without query parameters', async () => {
    const server = await startServer();
    const { ctx, lines } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'scenario',
      params: { run_id: 'r-9' },
    });
    expect(lines.some((line) => line.includes('/ws/gatling-scenario/r-9'))).toBe(true);
    expect(lines.some((line) => line.includes('?'))).toBe(false);
    channel.close();
  });
});

describe('openChannel: send and close', () => {
  it('sends client messages of the contract as flat JSON', async () => {
    const server = await startServer();
    const { ctx } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'describe',
      params: { project_id: 'p', run_id: 'r' },
    });
    const ws = await server.accepted(1);
    const received = new Promise<string>((done) =>
      ws.once('message', (data: Buffer) => done(data.toString('utf8'))),
    );
    channel.send({ type: 'stop' });
    expect(JSON.parse(await received)).toEqual({ type: 'stop' });

    expect(() => channel.send({ type: 'hint', text: 'x' })).toThrow(/hint/);
    expect(() => channel.send({ type: 'split_resume' })).toThrow(/paths/);
    channel.close();
  });

  it('refuses to send on a channel that takes no client messages', async () => {
    const server = await startServer();
    const { ctx } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'scenario',
      params: { run_id: 'r' },
    });
    expect(() => channel.send({ type: 'gatling-scenario:cancel' })).toThrow(/scenario/);
    channel.close();
  });

  it('send after close throws a readable error and the stream ends', async () => {
    const server = await startServer();
    const { ctx } = harness(server.apiUrl);
    const channel = await openChannel(ctx, {
      channel: 'describe',
      params: { project_id: 'p', run_id: 'r' },
    });
    const ws = await server.accepted(1);
    const serverSawClose = closeEvent(ws);
    channel.close();
    expect(() => channel.send({ type: 'stop' })).toThrow(/closed/);
    expect(await channel.frames[Symbol.asyncIterator]().next()).toEqual({
      done: true,
      value: undefined,
    });
    expect(await serverSawClose).toBe(1000);
    await expect(channel.closed).resolves.toMatchObject({ code: 1000 });
  });
});

describe('bundle', () => {
  it('bundles into one ESM file that opens a channel', async () => {
    const server = await startServer();
    const dir = await mkdtemp(join(tmpdir(), 'lc-mcp-ws-bundle-'));
    try {
      const out = join(dir, 'entry.mjs');
      await run(process.execPath, [
        join(ROOT, 'scripts', 'build.mjs'),
        '--entry',
        'test/fixtures/ws-bundle-entry.ts',
        '--out',
        out,
      ]);
      expect(await readdir(dir)).toEqual(['entry.mjs']);

      const child = spawn(process.execPath, [out], {
        env: { ...process.env, WS_API_URL: server.apiUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
      const exited = new Promise<number | null>((done) => child.once('exit', done));

      const ws = await Promise.race([
        server.accepted(1),
        exited.then(() => {
          throw new Error(`bundle exited before connecting: ${stderr}`);
        }),
      ]);
      ws.send(frame('gatling-scenario:progress', { progress: 1 }));
      expect(await exited, stderr).toBe(0);
      expect(stdout.trim()).toBe('gatling-scenario:progress');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
