import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import * as z from 'zod';

import { loadConfig } from '../src/config.js';
import { ToolError } from '../src/errors.js';
import { LoadcraftApiError } from '../src/http/apiError.js';
import { createLinks } from '../src/links.js';
import { createHttp } from '../src/http/client.js';
import { toToolError } from '../src/http/errors.js';
import { noopSecretScope } from './helpers/scope.js';
import { createLogger } from '../src/log.js';
import {
  MAX_CALL_WAIT_S,
  OPERATION_KINDS,
  awaitOperation,
  cancelOperation,
  defineOperationKind,
  encodeHandle,
  listOperations,
  parseHandle,
  recordOperation,
  resumeOperation,
  snapshotOperation,
  startOrJoin,
  viewOperation,
} from '../src/ops/operation.js';
import type { OperationContext } from '../src/ops/operation.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { createStateCache } from '../src/workspace/cache.js';
import { processKey } from '../src/workspace/processKey.js';
import { createProcessStore } from '../src/workspace/reducer.js';
import type { ClientMessage } from '../src/ws/channel.js';
import type { ParsedFrame } from '../src/ws/frames.js';
import { CANARY, assertNoCanary } from './helpers/canary.js';
import { createTestClock } from './helpers/clock.js';
import type { TestClock } from './helpers/clock.js';

// ---- test WebSocket server --------------------------------------------------------------

interface TestServer {
  readonly apiUrl: string;
  /** Resolves with the n-th accepted socket (1-based). */
  accepted(n: number): Promise<WebSocket>;
  close(): Promise<void>;
}

const servers: TestServer[] = [];
const dirs: string[] = [];

async function startServer(onAccept: (ws: WebSocket, n: number) => void): Promise<TestServer> {
  const http: Server = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Set<Socket>();
  const acceptedSockets: WebSocket[] = [];
  const waiters = new Map<number, (ws: WebSocket) => void>();
  http.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  http.on('upgrade', (req, socket: Socket, head: Buffer) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      acceptedSockets.push(ws);
      const n = acceptedSockets.length;
      onAccept(ws, n);
      waiters.get(n)?.(ws);
    });
  });
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  const address = http.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const server: TestServer = {
    apiUrl: `http://127.0.0.1:${String(port)}/api/v1`,
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

async function closedPortUrl(): Promise<string> {
  const server = await startServer(() => undefined);
  await server.close();
  servers.splice(servers.indexOf(server), 1);
  return server.apiUrl;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => undefined)));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function frame(type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ type, payload });
}

// ---- harness ----------------------------------------------------------------------------

interface Report {
  readonly message: string;
  readonly fraction: number | undefined;
}

interface Harness {
  readonly ctx: OperationContext;
  readonly clock: TestClock;
  readonly reports: Report[];
  readonly lines: string[];
  readonly abort: AbortController;
  readonly dir: string;
  stateFile(): string;
}

function harness(apiUrl = 'http://127.0.0.1:9/api/v1'): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'loadcraft-ops-'));
  dirs.push(dir);
  const clock = createTestClock(1_000_000);
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  const reports: Report[] = [];
  const abort = new AbortController();
  const config = loadConfig({ LOADCRAFT_API_URL: apiUrl, LOADCRAFT_API_TOKEN: CANARY }, dir);
  const secrets = noopSecretScope();
  // The operation context is the tool context: the same state and clock a tool receives.
  const ctx: OperationContext = {
    config,
    log,
    signal: abort.signal,
    t: createTranslator('en'),
    progress: {
      report: (message, fraction) => reports.push({ message, fraction }),
      stop: () => undefined,
    },
    secrets,
    services: { http: createHttp(config, log, { clock }), links: createLinks(config.appUrl) },
    state: createStateCache(dir, { logger: log, secrets, clock }),
    clock,
  };
  return {
    ctx,
    clock,
    reports,
    lines,
    abort,
    dir,
    stateFile: () => readFileSync(join(dir, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  };
}

/** Waits for `check`, then lets pending continuations (e.g. registering the next sleep) run. */
async function waitFor(check: () => boolean, what: string): Promise<void> {
  await vi.waitFor(
    () => {
      if (!check()) throw new Error(`waiting for ${what}`);
    },
    { timeout: 3000, interval: 5 },
  );
  await new Promise<void>((done) => setImmediate(done));
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

// ---- trial kinds ------------------------------------------------------------------------

interface GenState {
  readonly progress: number;
  readonly status: 'running' | 'done' | 'failed';
  readonly scenarioId?: string;
}

interface Counters {
  recover: number;
  cancel: number;
  finish: number;
}

function counters(): Counters {
  return { recover: 0, cancel: 0, finish: 0 };
}

const RUNNING: GenState = { progress: 0, status: 'running' };

/** A kind whose state comes from the `scenario` channel, recovered by REST when the channel fails. */
function channelKind(recover: () => Promise<GenState>, count: Counters, recoverIsRead = false) {
  return defineOperationKind({
    ...(recoverIsRead ? { recoverIsRead } : {}),
    kind: 'scenario_generation',
    saved: z.object({ flowId: z.string() }),
    initial: (): GenState => RUNNING,
    channel: {
      name: 'scenario',
      params: (id) => ({ run_id: id }),
      reduce(state: GenState, parsed): GenState {
        switch (parsed.type) {
          case 'gatling-scenario:progress':
            return { ...state, progress: parsed.data.progress };
          case 'gatling-scenario:complete':
            return { progress: 100, status: 'done', scenarioId: parsed.data.scenario_id };
          case 'gatling-scenario:error':
          case 'gatling-scenario:cancelled':
            return { ...state, status: 'failed' };
        }
      },
    },
    recover: () => {
      count.recover += 1;
      return recover();
    },
    isTerminal: (state) => state.status !== 'running',
    describe: (state) => ({
      message: `Generating the scenario (${String(state.progress)}%)`,
      fraction: state.progress / 100,
    }),
    finish: (_ctx, id, state, saved) => {
      count.finish += 1;
      return Promise.resolve({
        status: 'done' as const,
        data: { id, flowId: saved.flowId, scenarioId: state.scenarioId ?? null },
      });
    },
    view: (data, t) => `[${t.locale}] scenario ${data.scenarioId ?? '-'} of ${data.flowId}`,
    cancel: () => {
      count.cancel += 1;
      return Promise.resolve(true);
    },
  });
}

/** A kind read by REST only. */
function restKind(recover: () => Promise<GenState>, count: Counters, pollIntervalMs?: number) {
  return defineOperationKind({
    kind: 'setup_analysis',
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
    saved: z.looseObject({}),
    initial: (): GenState => RUNNING,
    recover: () => {
      count.recover += 1;
      return recover();
    },
    isTerminal: (state) => state.status !== 'running',
    describe: (state) => ({ message: `Analysing (${String(state.progress)}%)` }),
    finish: (_ctx, id, state) => {
      count.finish += 1;
      return Promise.resolve({ status: 'done' as const, data: { id, status: state.status } });
    },
    view: (data, t) => `[${t.locale}] analysis ${data.id}: ${data.status}`,
  });
}

/** Recover answers taken from a list; the last one repeats. */
function scripted(...states: GenState[]): () => Promise<GenState> {
  let at = 0;
  return () => {
    const state = states[Math.min(at, states.length - 1)] ?? RUNNING;
    at += 1;
    return Promise.resolve(state);
  };
}

const DONE: GenState = { progress: 100, status: 'done', scenarioId: 'sc-9' };

/**
 * Writes what the registry writes after the call: the ends of the operations the call noted, through
 * the store. Until then the payload stays in the file; that write drops it with the row's end.
 */
async function written(h: Harness): Promise<void> {
  const ended = h.ctx.state.endedOperations();
  if (ended === undefined) return;
  const store = createProcessStore(h.dir, { secrets: noopSecretScope(), clock: h.clock });
  await store.applyUpdate(processKey(h.dir, h.ctx.config.appUrl), ended, { tool: 'process_wait' });
}

function cachedHandles(h: Harness): string[] {
  const state = JSON.parse(h.stateFile()) as { opPayloads: Record<string, unknown> };
  return Object.keys(state.opPayloads);
}

// ---- tests ------------------------------------------------------------------------------

describe('operation handles', () => {
  it('encodes and parses kind:id for every kind of the process_wait tool', () => {
    expect(OPERATION_KINDS).toEqual([
      'setup_analysis',
      'refine',
      'batch_generation',
      'flow_generation',
      'har_generation',
      'har_split',
      'scenario_generation',
      'self_check',
      'record_run',
      'test_run',
      'analysis',
      'account_provision',
      'drift_check',
      'test_types_generation',
      'payload_generation',
      'dataset_generation',
    ]);
    const handle = encodeHandle('test_run', '0b5c-77aa');
    expect(handle).toBe('test_run:0b5c-77aa');
    expect(parseHandle(handle)).toEqual({ kind: 'test_run', id: '0b5c-77aa' });
  });

  it.each([
    ['unknown kind', 'coffee_break:abc'],
    ['no separator', 'test_run'],
    ['empty id', 'test_run:'],
    ['empty kind', ':abc'],
    ['space in id', 'test_run:a b'],
    ['path in id', 'test_run:../etc'],
    ['not a string', 42],
  ])('rejects a bad handle (%s) with invalid_operation', (_label, handle) => {
    const error = (() => {
      try {
        parseHandle(handle);
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe('invalid_operation');
  });

  it('refuses to encode an id that would not parse back', () => {
    expect(() => encodeHandle('refine', 'a:b c')).toThrow(ToolError);
  });

  it('resumeOperation rejects a bad handle and a kind nobody defined', async () => {
    const h = harness();
    const kind = restKind(scripted(DONE), counters());
    const bad = await rejection(resumeOperation(h.ctx, [kind], 'nope', { maxWaitS: 5 }));
    expect((bad as ToolError).code).toBe('invalid_operation');
    const undefinedKind = await rejection(
      resumeOperation(h.ctx, [kind], 'test_run:abc', { maxWaitS: 5 }),
    );
    expect((undefinedKind as ToolError).code).toBe('operation_kind_unsupported');
    expect((undefinedKind as ToolError).params).toMatchObject({
      value: 'test_run:abc',
      kind: 'test_run',
    });
  });

  it.each(['en', 'pl'] as const)(
    'operation_unknown and operation_kind_unsupported have their own texts naming the handle (%s)',
    (locale) => {
      const t = createTranslator(locale);
      const unknown = toToolError(
        new ToolError('operation_unknown', { params: { value: 'refine:j-1' } }),
        t,
      );
      const unsupported = toToolError(
        new ToolError('operation_kind_unsupported', {
          params: { value: 'test_run:abc', kind: 'test_run' },
        }),
        t,
      );
      const invalid = toToolError(
        new ToolError('invalid_operation', { params: { value: 'refine:j-1' } }),
        t,
      );
      expect(unknown.message).toContain('refine:j-1');
      expect(unknown.hint).toContain('process_get_status');
      expect(unsupported.message).toContain('test_run');
      expect(unknown.message).not.toBe(invalid.message);
      expect(unsupported.message).not.toBe(invalid.message);
    },
  );
});

describe('viewOperation', () => {
  it('draws finished data with the view of the kind named by the handle, in the call language', () => {
    const scenario = channelKind(scripted(DONE), counters());
    const analysis = restKind(scripted(DONE), counters());
    const data = { id: 'run-1', flowId: 'flow-7', scenarioId: 'sc-1' };
    expect(
      viewOperation(
        [analysis, scenario],
        'scenario_generation:run-1',
        data,
        createTranslator('pl'),
      ),
    ).toBe('[pl] scenario sc-1 of flow-7');
    expect(
      viewOperation(
        [analysis, scenario],
        'setup_analysis:run-2',
        { id: 'run-2', status: 'done' },
        createTranslator('en'),
      ),
    ).toBe('[en] analysis run-2: done');
  });

  it('refuses a kind nobody defined and a bad handle', () => {
    const analysis = restKind(scripted(DONE), counters());
    const t = createTranslator('en');
    expect(() => viewOperation([analysis], 'test_run:abc', {}, t)).toThrow(
      expect.objectContaining({ code: 'operation_kind_unsupported' }),
    );
    expect(() => viewOperation([analysis], 'nope', {}, t)).toThrow(
      expect.objectContaining({ code: 'invalid_operation' }),
    );
  });
});

describe('listOperations', () => {
  it('lists an operation left running by awaitOperation with its handle, kind, id and start', async () => {
    const h = harness();
    const count = counters();
    const kind = restKind(() => Promise.resolve({ progress: 10, status: 'running' }), count);
    const first = awaitOperation(h.ctx, kind, 'run-31', { maxWaitS: 10, saved: {} });
    await waitFor(() => count.recover === 1, 'first recover');
    await h.clock.advance(10_000);
    await expect(first).resolves.toMatchObject({ status: 'running' });
    expect(listOperations(h.ctx.state)).toEqual([
      {
        handle: 'setup_analysis:run-31',
        kind: 'setup_analysis',
        id: 'run-31',
        startedAt: 1_000_000,
      },
    ]);
  });

  it('is empty when the workspace has no state file', () => {
    expect(listOperations(harness().ctx.state)).toEqual([]);
  });

  it('orders by start time and skips entries that do not match the schema', async () => {
    const h = harness();
    const valid = (kind: string, id: string, startedAt: number) => ({
      kind,
      id,
      startedAt,
      saved: {},
    });
    await h.ctx.state.set('operations', 'test_run:late', valid('test_run', 'late', 300));
    await h.ctx.state.set('operations', 'refine:early', valid('refine', 'early', 100));
    // a key that is not a handle of a known kind has no place in the section
    await expect(h.ctx.state.set('operations', 'not-an-entry', 'text')).rejects.toThrow();
    await expect(
      h.ctx.state.set('operations', 'mystery:x', valid('mystery', 'x', 200)),
    ).rejects.toThrow();
    await h.ctx.state.set('operations', 'test_run:no-start', { kind: 'test_run', id: 'no-start' });
    await h.ctx.state.set('operations', 'test_run:other', valid('test_run', 'mismatch', 200));
    await h.ctx.state.set('drafts', 'refine:draft', valid('refine', 'draft', 50));
    // a foreign key that already lies in the payload section of the file (an older writer) is skipped
    const file = join(h.ctx.config.stateRoot, 'loadcraft', '.cache', 'state.json');
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { opPayloads: Record<string, unknown> };
    raw.opPayloads['not-an-entry'] = { savedAt: new Date(1_000_000).toISOString(), value: 'text' };
    raw.opPayloads['mystery:x'] = {
      savedAt: new Date(1_000_000).toISOString(),
      value: valid('mystery', 'x', 200),
    };
    writeFileSync(file, JSON.stringify(raw));
    expect(listOperations(h.ctx.state)).toEqual([
      { handle: 'refine:early', kind: 'refine', id: 'early', startedAt: 100 },
      { handle: 'test_run:late', kind: 'test_run', id: 'late', startedAt: 300 },
    ]);
  });
});

describe('awaitOperation without a channel', () => {
  it('a finish that throws ends the operation as failed; the payload stays until the call writes the end', async () => {
    const h = harness();
    const kind = defineOperationKind({
      kind: 'setup_analysis',
      saved: z.looseObject({}),
      initial: (): GenState => RUNNING,
      recover: scripted(DONE),
      isTerminal: (state) => state.status !== 'running',
      describe: () => ({ message: 'Analysing' }),
      finish: () => Promise.reject(new ToolError('setup_analysis_failed')),
      view: () => '',
    });
    const error = await rejection(
      awaitOperation(h.ctx, kind, 'run-9', { maxWaitS: 60, saved: {} }),
    );
    expect((error as ToolError).code).toBe('setup_analysis_failed');
    expect(h.ctx.state.endOf('setup_analysis:run-9')).toMatchObject({
      kind: 'setup_analysis',
      module: 'project',
      status: 'failed',
    });
    // the call no longer sees it, the file still holds it: a write that fails leaves it for the next wait
    expect(listOperations(h.ctx.state)).toEqual([]);
    expect(cachedHandles(h)).toEqual(['setup_analysis:run-9']);
    await written(h);
    expect(cachedHandles(h)).toEqual([]);
  });

  it('shows each running state to observe, never the end, and a view that fails is only a warning', async () => {
    const h = harness();
    const seen: number[] = [];
    const kind = defineOperationKind({
      kind: 'setup_analysis',
      saved: z.looseObject({}),
      initial: (): GenState => RUNNING,
      recover: scripted(
        { progress: 10, status: 'running' },
        { progress: 60, status: 'running' },
        DONE,
      ),
      isTerminal: (state) => state.status !== 'running',
      describe: () => ({ message: 'Analysing' }),
      observe: (_ctx, _id, state) => {
        seen.push(state.progress);
        return Promise.reject(new Error('the state file is locked'));
      },
      finish: (_ctx, id) => Promise.resolve({ status: 'done' as const, data: { id } }),
      view: () => '',
      pollIntervalMs: 1000,
    });
    const call = awaitOperation(h.ctx, kind, 'run-7', { maxWaitS: 60, saved: {} });
    await waitFor(() => seen.length === 1, 'the first view');
    await h.clock.advance(1000);
    await waitFor(() => seen.length === 2, 'the second view');
    await h.clock.advance(1000);
    await expect(call).resolves.toMatchObject({ status: 'done', data: { id: 'run-7' } });
    expect(seen).toEqual([10, 60]);
    const warnings = h.lines.filter((line) => line.includes('operation view not written'));
    expect(warnings).toHaveLength(2);
  });

  it('a view of a running state still being written lands before finish writes the end', async () => {
    const h = harness();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const kind = defineOperationKind({
      kind: 'setup_analysis',
      saved: z.looseObject({}),
      initial: (): GenState => RUNNING,
      recover: scripted({ progress: 10, status: 'running' }, DONE),
      isTerminal: (state) => state.status !== 'running',
      describe: () => ({ message: 'Analysing' }),
      observe: async () => {
        order.push('observe started');
        await new Promise<void>((done) => {
          release = done;
        });
        order.push('observe written');
      },
      finish: (_ctx, id) => {
        order.push('finish');
        return Promise.resolve({ status: 'done' as const, data: { id } });
      },
      view: () => '',
      pollIntervalMs: 1000,
    });
    const call = awaitOperation(h.ctx, kind, 'run-8', { maxWaitS: 60, saved: {} });
    await waitFor(() => order.length === 1, 'the view of the running state');
    await h.clock.advance(1000);
    await new Promise<void>((done) => setImmediate(done));
    expect(order).toEqual(['observe started']);
    release();
    await expect(call).resolves.toMatchObject({ status: 'done' });
    expect(order).toEqual(['observe started', 'observe written', 'finish']);
  });

  it('tells the progress reporter which operation it follows, before the first report', async () => {
    const h = harness();
    const told: string[] = [];
    const ctx: OperationContext = {
      ...h.ctx,
      progress: {
        report: (message) => told.push(`report ${message}`),
        attach: (handle) => told.push(`attach ${handle}`),
        stop: () => undefined,
      },
    };
    const count = counters();
    const kind = restKind(scripted(DONE), count);
    await awaitOperation(ctx, kind, 'run-9', { maxWaitS: 60, saved: {} });
    expect(told[0]).toBe('attach setup_analysis:run-9');
    expect(told.some((line) => line.startsWith('report '))).toBe(true);
  });

  it('finishes through recover and removes the cache entry', async () => {
    const h = harness();
    const count = counters();
    const kind = restKind(scripted({ progress: 40, status: 'running' }, DONE), count);
    const outcome = awaitOperation(h.ctx, kind, 'run-1', { maxWaitS: 60, saved: {} });
    await waitFor(() => count.recover === 1, 'first recover');
    expect(cachedHandles(h)).toEqual(['setup_analysis:run-1']);
    await h.clock.advance(5000);
    const finished = await outcome;
    expect(finished).toEqual({
      status: 'done',
      data: { id: 'run-1', status: 'done' },
    });
    expect(count.recover).toBe(2);
    expect(h.reports.map((r) => r.message)).toContain('Analysing (40%)');
    await written(h);
    expect(cachedHandles(h)).toEqual([]);
  });

  it('reads the state at the interval of the kind, not at the default 2 s growing to 5 s', async () => {
    const h = harness();
    const count = counters();
    const kind = restKind(
      scripted({ progress: 1, status: 'running' }, { progress: 2, status: 'running' }, DONE),
      count,
      3000,
    );
    const outcome = awaitOperation(h.ctx, kind, 'run-iv', { maxWaitS: 60, saved: {} });
    await waitFor(() => count.recover === 1, 'first recover');
    await h.clock.advance(2999);
    expect(count.recover).toBe(1);
    await h.clock.advance(1);
    await waitFor(() => count.recover === 2, 'second recover');
    await h.clock.advance(3000);
    await expect(outcome).resolves.toMatchObject({ status: 'done' });
    expect(count.recover).toBe(3);
  });

  it('turns a 404 from recover into operation_lost and forgets the operation', async () => {
    const h = harness();
    const kind = restKind(
      () =>
        Promise.reject(
          new LoadcraftApiError({ status: 404, code: 'not_found', message: 'Run not found' }),
        ),
      counters(),
    );
    const error = await rejection(
      awaitOperation(h.ctx, kind, 'run-2', { maxWaitS: 60, saved: {} }),
    );
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe('operation_lost');
    expect((error as ToolError).hint).toMatch(/restarted/);
    expect((error as ToolError).hint).toMatch(/process_get_status/);
    await written(h);
    expect(cachedHandles(h)).toEqual([]);
  });

  it('after the time limit returns running with the handle, keeps the entry, and a later resume finishes', async () => {
    const h = harness();
    const count = counters();
    let answer: GenState = { progress: 10, status: 'running' };
    const kind = restKind(() => Promise.resolve(answer), count);

    const first = awaitOperation(h.ctx, kind, 'run-3', { maxWaitS: 10, saved: {} });
    await waitFor(() => count.recover === 1, 'first recover');
    await h.clock.advance(10_000);
    await expect(first).resolves.toEqual({
      status: 'running',
      operation: 'setup_analysis:run-3',
      data: { message: 'Analysing (10%)' },
    });
    expect(count.finish).toBe(0);
    expect(cachedHandles(h)).toEqual(['setup_analysis:run-3']);
    const entry = JSON.parse(h.stateFile()) as {
      opPayloads: Record<string, { value: { kind: string; id: string; startedAt: number } }>;
    };
    expect(entry.opPayloads['setup_analysis:run-3']?.value).toMatchObject({
      kind: 'setup_analysis',
      id: 'run-3',
      startedAt: 1_000_000,
    });

    answer = DONE;
    const finished = await resumeOperation(h.ctx, [kind], 'setup_analysis:run-3', {
      maxWaitS: 10,
    });
    expect(finished).toEqual({
      status: 'done',
      data: { id: 'run-3', status: 'done' },
    });
    await written(h);
    expect(cachedHandles(h)).toEqual([]);
  });
});

describe('the longest a single call waits', () => {
  it('stops at the call limit however long a wait the caller asks for, and returns the handle', async () => {
    const h = harness();
    const count = counters();
    const kind = restKind(() => Promise.resolve({ progress: 5, status: 'running' }), count);
    expect(MAX_CALL_WAIT_S).toBe(100);

    let settled = false;
    const call = awaitOperation(h.ctx, kind, 'run-9', { maxWaitS: 3600, saved: {} }).finally(() => {
      settled = true;
    });
    await waitFor(() => count.recover === 1, 'first recover');
    await h.clock.advance((MAX_CALL_WAIT_S - 1) * 1000);
    expect(settled).toBe(false);
    await h.clock.advance(1000);
    await expect(call).resolves.toMatchObject({
      status: 'running',
      operation: 'setup_analysis:run-9',
    });
  });

  it('applies to a resume by handle as well, with the same clock', async () => {
    const h = harness();
    const count = counters();
    const kind = restKind(() => Promise.resolve({ progress: 5, status: 'running' }), count);
    const first = awaitOperation(h.ctx, kind, 'run-8', { maxWaitS: 1, saved: {} });
    await waitFor(() => count.recover === 1, 'first recover');
    await h.clock.advance(1000);
    await first;

    const resumed = resumeOperation(h.ctx, [kind], 'setup_analysis:run-8', { maxWaitS: 1500 });
    const started = h.clock.now();
    await waitFor(() => count.recover >= 2, 'recover of the resume');
    await h.clock.advance(MAX_CALL_WAIT_S * 1000);
    await expect(resumed).resolves.toMatchObject({ status: 'running' });
    expect(h.clock.now() - started).toBe(MAX_CALL_WAIT_S * 1000);
  });

  it('keeps a shorter wait as asked', async () => {
    const h = harness();
    const count = counters();
    const kind = restKind(() => Promise.resolve({ progress: 5, status: 'running' }), count);
    const call = awaitOperation(h.ctx, kind, 'run-7', { maxWaitS: 5, saved: {} });
    await waitFor(() => count.recover === 1, 'first recover');
    await h.clock.advance(5000);
    await expect(call).resolves.toMatchObject({ status: 'running' });
  });
});

describe('startOrJoin', () => {
  function plan(h: Harness, starts: string[], answer: () => GenState, target = 'a') {
    const count = counters();
    const kind = restKind(() => Promise.resolve(answer()), count);
    const call = (maxWaitS: number, wanted = target) =>
      startOrJoin(h.ctx, kind, {
        maxWaitS,
        matches: (saved) => saved['target'] === wanted,
        start: () => {
          const id = `run-${String(starts.length + 1)}`;
          starts.push(id);
          return Promise.resolve({ id, saved: { target: wanted } });
        },
      });
    return { kind, call, count };
  }

  it('a second call for the same work joins the running operation: no second start, the same handle', async () => {
    const h = harness();
    const starts: string[] = [];
    let state: GenState = { progress: 10, status: 'running' };
    const { call } = plan(h, starts, () => state);
    const first = call(0);
    await expect(first).resolves.toMatchObject({
      status: 'running',
      operation: 'setup_analysis:run-1',
    });
    await expect(call(0)).resolves.toMatchObject({
      status: 'running',
      operation: 'setup_analysis:run-1',
    });
    expect(starts).toEqual(['run-1']);

    state = DONE;
    const finished = await call(0);
    expect(finished).toMatchObject({
      status: 'done',
      data: { id: 'run-1' },
    });
    await written(h);
    expect(cachedHandles(h)).toEqual([]);
    // Finished work is not joined: the next call starts new work.
    state = { progress: 0, status: 'running' };
    await expect(call(0)).resolves.toMatchObject({ operation: 'setup_analysis:run-2' });
    expect(starts).toEqual(['run-1', 'run-2']);
  });

  it('other work is started beside the running one', async () => {
    const h = harness();
    const starts: string[] = [];
    const { call } = plan(h, starts, () => ({ progress: 1, status: 'running' }));
    await call(0, 'a');
    await expect(call(0, 'b')).resolves.toMatchObject({ operation: 'setup_analysis:run-2' });
    expect(starts).toHaveLength(2);
  });

  it('an operation the backend forgot is started again instead of failing the call', async () => {
    const h = harness();
    const starts: string[] = [];
    let forgot = false;
    const count = counters();
    const kind = restKind(
      () =>
        forgot
          ? Promise.reject(new LoadcraftApiError({ status: 404, code: 'not_found', message: 'x' }))
          : Promise.resolve({ progress: 1, status: 'running' }),
      count,
    );
    const call = () =>
      startOrJoin(h.ctx, kind, {
        maxWaitS: 0,
        matches: () => true,
        start: () => {
          starts.push('s');
          return Promise.resolve({ id: `run-${String(starts.length)}`, saved: {} });
        },
      });
    await call();
    forgot = true;
    const second = call();
    // The forgotten run-1 is lost; the new run-2 is read through the same failing recover.
    await expect(second).rejects.toMatchObject({ code: 'operation_lost' });
    expect(starts).toEqual(['s', 's']);
  });
});

describe('awaitOperation with a channel', () => {
  it('reduces frames to state, reports progress and finishes without REST', async () => {
    const server = await startServer((ws) => {
      ws.send(frame('gatling-scenario:progress', { progress: 30, step_label: 'Planning' }));
      ws.send(frame('gatling-scenario:progress', { progress: 70, step_label: 'Compiling' }));
      ws.send(frame('gatling-scenario:complete', { scenario_id: 'sc-1' }));
    });
    const h = harness(server.apiUrl);
    const count = counters();
    const kind = channelKind(scripted(RUNNING), count);
    const outcome = await awaitOperation(h.ctx, kind, 'run-10', {
      maxWaitS: 600,
      saved: { flowId: 'flow-7' },
    });
    expect(outcome).toEqual({
      status: 'done',
      data: { id: 'run-10', flowId: 'flow-7', scenarioId: 'sc-1' },
    });
    expect(count.recover).toBe(0);
    expect(h.reports).toContainEqual({ message: 'Generating the scenario (30%)', fraction: 0.3 });
    expect(h.reports).toContainEqual({ message: 'Generating the scenario (70%)', fraction: 0.7 });
    await written(h);
    expect(cachedHandles(h)).toEqual([]);
    assertNoCanary(h.lines.join('\n'));
  });

  it('reconnects once after a drop and still returns the right result', async () => {
    const server = await startServer((ws, n) => {
      if (n === 1) {
        ws.send(frame('gatling-scenario:progress', { progress: 40 }));
        setImmediate(() => ws.terminate());
      } else {
        ws.send(frame('gatling-scenario:complete', { scenario_id: 'sc-2' }));
      }
    });
    const h = harness(server.apiUrl);
    const count = counters();
    const kind = channelKind(scripted(RUNNING), count);
    const outcome = awaitOperation(h.ctx, kind, 'run-11', {
      maxWaitS: 600,
      saved: { flowId: 'flow-7' },
    });
    await waitFor(
      () => h.lines.some((line) => line.includes('channel reconnect scheduled')),
      'reconnect scheduled',
    );
    await h.clock.advance(500);
    await expect(outcome).resolves.toMatchObject({
      status: 'done',
      data: { scenarioId: 'sc-2' },
    });
    expect(count.recover).toBe(0);
    expect(h.reports).toContainEqual({ message: 'Generating the scenario (40%)', fraction: 0.4 });
  });

  it('falls back to polling recover every 5 s when the channel cannot be opened', async () => {
    const h = harness(await closedPortUrl());
    const count = counters();
    const kind = channelKind(scripted({ progress: 50, status: 'running' }, DONE), count);
    const outcome = awaitOperation(h.ctx, kind, 'run-12', {
      maxWaitS: 600,
      saved: { flowId: 'flow-7' },
    });
    await waitFor(() => count.recover === 1, 'first recover');
    await h.clock.advance(4999);
    expect(count.recover).toBe(1);
    await h.clock.advance(1);
    const finished = await outcome;
    expect(finished).toEqual({
      status: 'done',
      data: { id: 'run-12', flowId: 'flow-7', scenarioId: 'sc-9' },
    });
    expect(count.recover).toBe(2);
    const note = h.ctx.t('operation.channelUnavailable');
    const noted = h.reports.filter((r) => r.message.includes(note));
    expect(noted.length).toBeGreaterThan(0);
    // One sentence, not repeated within a message.
    for (const r of noted) expect(r.message.split(note)).toHaveLength(2);
    await written(h);
    expect(cachedHandles(h)).toEqual([]);
  });

  it('client abort closes the socket, keeps the cache entry and never calls cancel', async () => {
    const server = await startServer((ws) => {
      ws.send(frame('gatling-scenario:progress', { progress: 20 }));
    });
    const h = harness(server.apiUrl);
    const count = counters();
    const kind = channelKind(scripted(RUNNING), count);
    const outcome = awaitOperation(h.ctx, kind, 'run-13', {
      maxWaitS: 600,
      saved: { flowId: 'flow-7' },
    });
    const ws = await server.accepted(1);
    const closed = new Promise<void>((done) => ws.once('close', () => done()));
    await waitFor(() => h.reports.some((r) => r.fraction === 0.2), 'first frame');
    h.abort.abort();
    const error = await rejection(outcome);
    expect((error as Error).name).toBe('AbortError');
    await closed;
    expect(count.cancel).toBe(0);
    expect(count.recover).toBe(0);
    expect(cachedHandles(h)).toEqual(['scenario_generation:run-13']);
  });

  it('returns running when the time limit passes on an open channel, and resume finishes from cache', async () => {
    let serve: 'quiet' | 'complete' = 'quiet';
    const server = await startServer((ws) => {
      if (serve === 'quiet') ws.send(frame('gatling-scenario:progress', { progress: 60 }));
      else ws.send(frame('gatling-scenario:complete', { scenario_id: 'sc-5' }));
    });
    const h = harness(server.apiUrl);
    const count = counters();
    const kind = channelKind(scripted(RUNNING), count);
    const first = awaitOperation(h.ctx, kind, 'run-14', {
      maxWaitS: 30,
      saved: { flowId: 'flow-3' },
    });
    await waitFor(() => h.reports.some((r) => r.fraction === 0.6), 'progress frame');
    const ws = await server.accepted(1);
    const closed = new Promise<void>((done) => ws.once('close', () => done()));
    await h.clock.advance(30_000);
    await expect(first).resolves.toEqual({
      status: 'running',
      operation: 'scenario_generation:run-14',
      data: { message: 'Generating the scenario (60%)', fraction: 0.6 },
    });
    await closed;
    expect(cachedHandles(h)).toEqual(['scenario_generation:run-14']);

    serve = 'complete';
    const finished = await resumeOperation(h.ctx, [kind], 'scenario_generation:run-14', {
      maxWaitS: 30,
    });
    expect(finished).toEqual({
      status: 'done',
      data: { id: 'run-14', flowId: 'flow-3', scenarioId: 'sc-5' },
    });
    await written(h);
    expect(cachedHandles(h)).toEqual([]);
  });

  it('at the time limit on a quiet channel one REST read decides: a result that exists finishes the call', async () => {
    const server = await startServer((ws) => {
      ws.send(frame('gatling-scenario:progress', { progress: 60 }));
    });
    const h = harness(server.apiUrl);
    const count = counters();
    const kind = channelKind(scripted(DONE), count, true);
    const call = awaitOperation(h.ctx, kind, 'run-15', {
      maxWaitS: 30,
      saved: { flowId: 'flow-3' },
    });
    await waitFor(() => h.reports.some((r) => r.fraction === 0.6), 'progress frame');
    await h.clock.advance(30_000);
    const finished = await call;
    expect(finished).toEqual({
      status: 'done',
      data: { id: 'run-15', flowId: 'flow-3', scenarioId: 'sc-9' },
    });
    expect(count.recover).toBe(1);
    await written(h);
    expect(cachedHandles(h)).toEqual([]);
  });

  it('at the time limit a kind whose recover may write is not called: the operation stays running', async () => {
    const server = await startServer((ws) => {
      ws.send(frame('gatling-scenario:progress', { progress: 60 }));
    });
    const h = harness(server.apiUrl);
    const count = counters();
    const kind = channelKind(scripted(DONE), count);
    const call = awaitOperation(h.ctx, kind, 'run-16', {
      maxWaitS: 30,
      saved: { flowId: 'flow-3' },
    });
    await waitFor(() => h.reports.some((r) => r.fraction === 0.6), 'progress frame');
    await h.clock.advance(30_000);
    await expect(call).resolves.toMatchObject({
      status: 'running',
      operation: 'scenario_generation:run-16',
    });
    expect(count.recover).toBe(0);
    expect(cachedHandles(h)).toEqual(['scenario_generation:run-16']);
  });

  it('not_found from the channel with no result from recover is operation_lost', async () => {
    const server = await startServer((ws) => ws.close(4404, 'unknown run'));
    const h = harness(server.apiUrl);
    const count = counters();
    const kind = channelKind(scripted(RUNNING), count);
    const error = await rejection(
      awaitOperation(h.ctx, kind, 'run-15', { maxWaitS: 600, saved: { flowId: 'flow-7' } }),
    );
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe('operation_lost');
    expect(count.recover).toBe(1);
    expect(count.cancel).toBe(0);
    await written(h);
    expect(cachedHandles(h)).toEqual([]);
  });

  it('not_found from the channel finishes when recover shows the result already exists', async () => {
    const server = await startServer((ws) => ws.close(4404, 'unknown run'));
    const h = harness(server.apiUrl);
    const count = counters();
    const kind = channelKind(scripted(DONE), count);
    await expect(
      awaitOperation(h.ctx, kind, 'run-16', { maxWaitS: 600, saved: { flowId: 'flow-7' } }),
    ).resolves.toMatchObject({ status: 'done', data: { scenarioId: 'sc-9' } });
    expect(count.recover).toBe(1);
  });

  it('a handle with no record in this workspace is operation_unknown', async () => {
    const h = harness();
    const count = counters();
    const kind = channelKind(scripted(DONE), count);
    const error = await rejection(
      resumeOperation(h.ctx, [kind], 'scenario_generation:never-seen', { maxWaitS: 5 }),
    );
    expect((error as ToolError).code).toBe('operation_unknown');
    expect((error as ToolError).params).toEqual({ value: 'scenario_generation:never-seen' });
    expect(count.recover).toBe(0);
  });

  it('a handle with no record is operation_unknown even when the kind saves nothing', async () => {
    const h = harness();
    const count = counters();
    const kind = restKind(scripted(DONE), count);
    const error = await rejection(
      resumeOperation(h.ctx, [kind], 'setup_analysis:never-seen', { maxWaitS: 5 }),
    );
    expect((error as ToolError).code).toBe('operation_unknown');
    expect(count.recover).toBe(0);
    expect(listOperations(h.ctx.state)).toEqual([]);
  });

  it('a frame that breaks the contract falls back to REST with a warning instead of failing', async () => {
    const server = await startServer((ws) => {
      ws.send(frame('gatling-scenario:progress', { progress: 30 }));
      ws.send(frame('gatling-scenario:complete', {}));
    });
    const h = harness(server.apiUrl);
    const count = counters();
    const kind = channelKind(scripted(DONE), count);
    const outcome = await awaitOperation(h.ctx, kind, 'run-17', {
      maxWaitS: 600,
      saved: { flowId: 'flow-7' },
    });
    expect(outcome).toEqual({
      status: 'done',
      data: { id: 'run-17', flowId: 'flow-7', scenarioId: 'sc-9' },
    });
    expect(count.recover).toBe(1);
    const warned = h.lines
      .map((line) => JSON.parse(line) as { level: string; msg: string })
      .filter((line) => line.level === 'warn' && /REST/.test(line.msg));
    expect(warned).toHaveLength(1);
    await written(h);
    expect(cachedHandles(h)).toEqual([]);
  });

  it('describe and the channel note use the translator of the call; running keeps the note apart', async () => {
    const h = harness(await closedPortUrl());
    const seen: unknown[] = [];
    const count = counters();
    const base = channelKind(scripted({ progress: 50, status: 'running' }), count);
    const kind = defineOperationKind({
      ...base.spec,
      describe: (state: GenState, t) => {
        seen.push(t);
        return {
          message: `${t.locale}: ${String(state.progress)}%`,
          fraction: state.progress / 100,
        };
      },
    });
    const outcome = awaitOperation(h.ctx, kind, 'run-18', {
      maxWaitS: 10,
      saved: { flowId: 'flow-7' },
    });
    await waitFor(() => count.recover === 1, 'first recover');
    await h.clock.advance(10_000);
    const note = h.ctx.t('operation.channelUnavailable');
    await expect(outcome).resolves.toEqual({
      status: 'running',
      operation: 'scenario_generation:run-18',
      data: { message: 'en: 50%', fraction: 0.5, note },
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const t of seen) expect(t).toBe(h.ctx.t);
    expect(h.reports.map((r) => r.message)).toContain(
      h.ctx.t('operation.progressNote', { message: 'en: 50%', note }),
    );
  });
});

// ---- a run that asks: answers on the socket, the user in the loop, a stop that keeps going ------

interface AskState {
  readonly asked: number;
  readonly help: boolean;
  readonly done: boolean;
  readonly answered: boolean;
}

const ASK_START: AskState = { asked: 0, help: false, done: false, answered: false };

interface AskCounters {
  recover: number;
  lost: number;
}

/** The answer a call carries to a `split_proposal` (`AwaitOptions.respond`). */
const ASK_RESPOND = (
  _state: AskState,
  parsed: ParsedFrame<'describe'>,
): ClientMessage | undefined =>
  parsed.type === 'split_proposal'
    ? { type: 'split_resume', paths: [{ name: 'zakupy', steps: [] }] }
    : undefined;

/**
 * A kind on the `describe` channel: a call that carries `ASK_RESPOND` answers every
 * `split_proposal` with `split_resume`; it waits for the user while a `help_requested` stands and
 * ends with `complete`. Saved `follow: false` keeps it off the channel. Saved `carried` is kept out
 * of the entry until the socket took an answer (`answered`).
 */
function askKind(
  recover: () => Promise<AskState>,
  count: AskCounters,
  options: {
    lost?: (state: AskState) => Promise<void>;
    cancel?: () => Promise<boolean | 'stopping'>;
    secrets?: () => Promise<void>;
  } = {},
) {
  return defineOperationKind({
    kind: 'record_run',
    recoverIsRead: true,
    saved: z.object({
      follow: z.boolean(),
      carried: z.string().optional(),
      answered: z.boolean().optional(),
    }),
    initial: (): AskState => ASK_START,
    advance: (state, saved) =>
      state.answered && saved.answered !== true ? { ...saved, answered: true } : saved,
    stored: (saved) => (saved.answered === true ? saved : { follow: saved.follow }),
    ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
    channel: {
      name: 'describe',
      params: (id) => ({ project_id: 'p-1', run_id: id }),
      enabled: (saved) => saved.follow,
      reduce(state: AskState, parsed): AskState {
        switch (parsed.type) {
          case 'split_proposal':
            return { ...state, asked: state.asked + 1 };
          case 'help_requested':
            return { ...state, help: true };
          case 'control_returned':
            return { ...state, help: false };
          case 'complete':
            return { ...state, done: true };
          default:
            return state;
        }
      },
      sent: (state) => ({ ...state, answered: true }),
    },
    recover: () => {
      count.recover += 1;
      return recover();
    },
    isTerminal: (state) => state.done,
    needsUser: (ctx, id, state) =>
      state.help
        ? { message: `help on ${id}`, links: [ctx.services.links.describeRun('p-1', id)] }
        : undefined,
    channelLost: async (_ctx, _id, state) => {
      count.lost += 1;
      await options.lost?.(state);
    },
    describe: (state) => ({ message: `asked ${String(state.asked)}` }),
    finish: (_ctx, id) => Promise.resolve({ status: 'done' as const, data: { id } }),
    view: (data) => `done ${data.id}`,
    ...(options.cancel === undefined ? {} : { cancel: options.cancel }),
  });
}

const flat = (type: string, keys: Record<string, unknown> = {}): string =>
  JSON.stringify({ type, ...keys });

describe('awaitOperation: a run that asks', () => {
  it('answers a question of the channel on the same socket', async () => {
    const received: unknown[] = [];
    const server = await startServer((ws) => {
      ws.on('message', (raw: Buffer) => {
        received.push(JSON.parse(raw.toString('utf8')));
        ws.send(flat('complete', { result: {} }));
      });
      ws.send(flat('split_proposal', { proposed_paths: [{ name: 'zakupy', steps: [] }] }));
    });
    const h = harness(server.apiUrl);
    const count: AskCounters = { recover: 0, lost: 0 };
    const kind = askKind(() => Promise.resolve(ASK_START), count);
    const outcome = await awaitOperation(h.ctx, kind, 'run-30', {
      maxWaitS: 60,
      saved: { follow: true },
      respond: ASK_RESPOND,
    });
    expect(outcome).toEqual({ status: 'done', data: { id: 'run-30' } });
    expect(received).toEqual([{ type: 'split_resume', paths: [{ name: 'zakupy', steps: [] }] }]);
    expect(count.recover).toBe(0);
  });

  it('a resume of the handle never sends the answer the starting call carried', async () => {
    const received: unknown[] = [];
    let closed = 0;
    const server = await startServer((ws, n) => {
      ws.on('message', (raw: Buffer) => received.push(JSON.parse(raw.toString('utf8'))));
      ws.on('close', () => {
        closed += 1;
      });
      // The question comes only to the socket of the second call.
      if (n === 2) {
        ws.send(flat('split_proposal', { proposed_paths: [{ name: 'zakupy', steps: [] }] }));
      }
    });
    const h = harness(server.apiUrl);
    const count: AskCounters = { recover: 0, lost: 0 };
    const kind = askKind(() => Promise.resolve(ASK_START), count);
    const first = awaitOperation(h.ctx, kind, 'run-37', {
      maxWaitS: 5,
      saved: { follow: true, carried: 'the answer' },
      respond: ASK_RESPOND,
    });
    await waitFor(() => h.lines.some((line) => line.includes('channel open')), 'the first socket');
    await h.clock.advance(5000);
    await expect(first).resolves.toMatchObject({ status: 'running' });
    // Nothing went out, so the entry keeps nothing of what the call carried.
    expect(JSON.parse(h.stateFile())).toMatchObject({
      opPayloads: { 'record_run:run-37': { value: { saved: { follow: true } } } },
    });
    expect(h.stateFile()).not.toContain('the answer');

    const second = resumeOperation(h.ctx, [kind], 'record_run:run-37', { maxWaitS: 5 });
    // The question was folded in (and any answer to it sent) before the time limit closes the
    // socket; the server hears everything sent before it sees the close.
    await waitFor(() => h.reports.some((report) => report.message === 'asked 1'), 'the question');
    await h.clock.advance(5000);
    await expect(second).resolves.toMatchObject({ status: 'running' });
    await waitFor(() => closed === 2, 'both sockets closed at the server');
    expect(received).toEqual([]);
  });

  it('once the socket took the answer, the entry keeps what advance settled, all of it', async () => {
    const server = await startServer((ws) => {
      ws.on('message', () => ws.send(flat('help_requested', { path_index: 0, reason: 'captcha' })));
      ws.send(flat('split_proposal', { proposed_paths: [{ name: 'zakupy', steps: [] }] }));
    });
    const h = harness(server.apiUrl);
    const count: AskCounters = { recover: 0, lost: 0 };
    const kind = askKind(() => Promise.resolve(ASK_START), count);
    const outcome = await awaitOperation(h.ctx, kind, 'run-38', {
      maxWaitS: 60,
      saved: { follow: true, carried: 'kept now' },
      respond: ASK_RESPOND,
    });
    expect(outcome).toMatchObject({ status: 'needs_user' });
    expect(JSON.parse(h.stateFile())).toMatchObject({
      opPayloads: {
        'record_run:run-38': {
          value: { saved: { follow: true, carried: 'kept now', answered: true } },
        },
      },
    });
  });

  it('secrets runs before the first read, in a wait, a snapshot and a cancel', async () => {
    const order: string[] = [];
    const h = harness(await closedPortUrl());
    const count: AskCounters = { recover: 0, lost: 0 };
    const kind = askKind(
      () => {
        order.push('recover');
        return Promise.resolve({ ...ASK_START, done: true });
      },
      count,
      {
        secrets: () => {
          order.push('secrets');
          return Promise.resolve();
        },
        cancel: () => {
          order.push('cancel');
          return Promise.resolve(false);
        },
      },
    );
    await awaitOperation(h.ctx, kind, 'run-39', { maxWaitS: 60, saved: { follow: false } });
    expect(order).toEqual(['secrets', 'recover']);
    order.length = 0;
    await recordOperation(h.ctx.state, {
      kind: 'record_run',
      id: 'run-39',
      startedAt: h.clock.now(),
      saved: { follow: false },
    });
    await snapshotOperation(h.ctx, [kind], 'record_run:run-39');
    await cancelOperation(h.ctx, [kind], 'record_run:run-39');
    expect(order).toEqual(['secrets', 'secrets', 'cancel']);
  });

  it('a saved part without a channel is read through REST only', async () => {
    let accepted = 0;
    const server = await startServer(() => {
      accepted += 1;
    });
    const h = harness(server.apiUrl);
    const count: AskCounters = { recover: 0, lost: 0 };
    const kind = askKind(() => Promise.resolve({ ...ASK_START, done: true }), count);
    const outcome = await awaitOperation(h.ctx, kind, 'run-31', {
      maxWaitS: 60,
      saved: { follow: false },
    });
    expect(outcome).toMatchObject({ status: 'done' });
    expect(accepted).toBe(0);
    expect(count.recover).toBe(1);
  });

  it('a request for help ends the wait with needs_user and keeps the entry; wait goes on after it', async () => {
    const server = await startServer((ws, n) => {
      if (n === 1) ws.send(flat('help_requested', { path_index: 0, reason: 'captcha' }));
      else ws.send(flat('complete', { result: {} }));
    });
    const h = harness(server.apiUrl);
    const count: AskCounters = { recover: 0, lost: 0 };
    const kind = askKind(() => Promise.resolve(ASK_START), count);
    const outcome = await awaitOperation(h.ctx, kind, 'run-32', {
      maxWaitS: 60,
      saved: { follow: true },
    });
    expect(outcome).toEqual({
      status: 'needs_user',
      operation: 'record_run:run-32',
      data: { message: 'help on run-32' },
      links: [h.ctx.services.links.describeRun('p-1', 'run-32')],
    });
    expect(cachedHandles(h)).toEqual(['record_run:run-32']);
    const finished = await resumeOperation(h.ctx, [kind], 'record_run:run-32', { maxWaitS: 60 });
    expect(finished).toEqual({
      status: 'done',
      data: { id: 'run-32' },
    });
    await written(h);
    expect(cachedHandles(h)).toEqual([]);
  });

  it('at the time limit, a REST read that shows the user is still needed says needs_user, not running', async () => {
    const server = await startServer(() => undefined);
    const h = harness(server.apiUrl);
    const count: AskCounters = { recover: 0, lost: 0 };
    const kind = askKind(() => Promise.resolve({ ...ASK_START, help: true }), count);
    const outcome = awaitOperation(h.ctx, kind, 'run-33', { maxWaitS: 5, saved: { follow: true } });
    await waitFor(() => h.lines.some((line) => line.includes('channel open')), 'the socket');
    await h.clock.advance(5000);
    await expect(outcome).resolves.toMatchObject({
      status: 'needs_user',
      operation: 'record_run:run-33',
    });
    expect(count.recover).toBe(1);
  });

  it('polling through REST stops at a request for help', async () => {
    const h = harness(await closedPortUrl());
    const count: AskCounters = { recover: 0, lost: 0 };
    const kind = askKind(scriptedAsk(ASK_START, { ...ASK_START, help: true }), count);
    const outcome = awaitOperation(h.ctx, kind, 'run-34', {
      maxWaitS: 60,
      saved: { follow: true },
    });
    await waitFor(() => count.recover === 1, 'first recover');
    await h.clock.advance(5000);
    await expect(outcome).resolves.toMatchObject({ status: 'needs_user' });
    expect(count.recover).toBe(2);
  });

  it('a failed channel calls channelLost once, before REST, and its error ends the wait with the entry kept', async () => {
    const h = harness(await closedPortUrl());
    const count: AskCounters = { recover: 0, lost: 0 };
    const kind = askKind(() => Promise.resolve(ASK_START), count, {
      lost: (state) => {
        expect(state.answered).toBe(false);
        return Promise.reject(
          new ToolError('describe_channel_unavailable', { params: { link: 'x' } }),
        );
      },
    });
    const error = await rejection(
      awaitOperation(h.ctx, kind, 'run-35', { maxWaitS: 60, saved: { follow: true } }),
    );
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe('describe_channel_unavailable');
    expect(count.lost).toBe(1);
    expect(count.recover).toBe(0);
    expect(cachedHandles(h)).toEqual(['record_run:run-35']);
  });

  it('a channel that works never calls channelLost', async () => {
    const server = await startServer((ws) => ws.send(flat('complete', { result: {} })));
    const h = harness(server.apiUrl);
    const count: AskCounters = { recover: 0, lost: 0 };
    const kind = askKind(() => Promise.resolve(ASK_START), count);
    await awaitOperation(h.ctx, kind, 'run-36', { maxWaitS: 60, saved: { follow: true } });
    expect(count.lost).toBe(0);
  });
});

function scriptedAsk(...states: AskState[]): () => Promise<AskState> {
  let at = 0;
  return () => {
    const state = states[Math.min(at, states.length - 1)] ?? ASK_START;
    at += 1;
    return Promise.resolve(state);
  };
}

describe('cancelOperation: a stop that keeps going', () => {
  async function recorded(answer: boolean | 'stopping') {
    const h = harness();
    const kind = askKind(
      () => Promise.resolve(ASK_START),
      { recover: 0, lost: 0 },
      {
        cancel: () => Promise.resolve(answer),
      },
    );
    const outcome = await awaitOperation(h.ctx, kind, 'run-40', {
      maxWaitS: 0,
      saved: { follow: false },
    });
    expect(outcome.status).toBe('running');
    return { h, kind };
  }

  it('stopping: reported as stopped and stopping, the entry stays for process_wait', async () => {
    const { h, kind } = await recorded('stopping');
    await expect(cancelOperation(h.ctx, [kind], 'record_run:run-40')).resolves.toEqual({
      kind: 'record_run',
      cancelled: true,
      stopping: true,
    });
    expect(cachedHandles(h)).toEqual(['record_run:run-40']);
  });

  it('stopped: the entry goes', async () => {
    const { h, kind } = await recorded(true);
    const finished = await cancelOperation(h.ctx, [kind], 'record_run:run-40');
    expect(finished).toEqual({
      kind: 'record_run',
      cancelled: true,
      stopping: false,
    });
    await written(h);
    expect(cachedHandles(h)).toEqual([]);
  });
});
