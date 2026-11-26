// Migration of the state file from schema 1 (cache sections only) to schema 3 (process state + cache
// sections), and what the cache does with a file it finds in either schema. The fixture is a file a
// previous plugin version left behind with a test run in flight.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { createLogger } from '../src/log.js';
import { OPERATION_KINDS } from '../src/ops/operation.js';
import { createStateCache } from '../src/workspace/cache.js';
import { migrateState } from '../src/workspace/migrate.js';
import { LIMITS, NEW_KEY, State } from '../src/workspace/processState.js';
import { releaseLock, tryAcquire } from '../src/workspace/lock.js';
import { createProcessStore } from '../src/workspace/reducer.js';
import { SKLEP_IDS } from './golden/index.js';
import { CANARY } from './helpers/canary.js';
import { settleClock } from './helpers/clock.js';
import { NOW, PERF, PERF_ARGS, rig as runRig } from './helpers/runStartWait.js';
import { noopSecretScope } from './helpers/scope.js';

vi.setConfig({ testTimeout: 60_000 });

const FIXTURE = readFileSync(
  new URL('./fixtures/state/schema1-operation-in-flight.json', import.meta.url),
  'utf8',
);
const HANDLE = `test_run:${SKLEP_IDS.executionPerf}`;
const SERIES = 'accounts-series:a1';

type Json = Record<string, unknown>;
const legacy = (): Json => JSON.parse(FIXTURE) as Json;

describe('migrateState', () => {
  it('turns schema 1 into a file that passes State.parse, at schema 3', () => {
    const migrated = migrateState(legacy());
    expect(migrated).toBeDefined();
    expect(migrated?.['schema']).toBe(3);
    expect(State.safeParse(migrated).success).toBe(true);
  });

  it('keeps the operation under its handle: the row in process[_new] and the payload wait reads', () => {
    const migrated = migrateState(legacy()) as Json;
    const state = State.parse(migrated);
    const rows = state.process[NEW_KEY]?.operations ?? [];
    expect(rows.map((row) => row.handle)).toEqual([HANDLE]);
    expect(rows[0]).toMatchObject({ kind: 'test_run', module: 'run', status: 'running' });
    // the payload is what the old section held for the handle, entry and all
    const original = (legacy()['operations'] as Json)[HANDLE];
    expect(Object.keys(state.opPayloads)).toEqual([HANDLE]);
    expect(state.opPayloads[HANDLE]).toEqual({
      savedAt: new Date((original as { savedAt: number }).savedAt).toISOString(),
      value: (original as { value: unknown }).value,
    });
    // an entry that is neither a handle nor a series of account provisioning is not lost: it goes to legacy
    expect((state.drafts as Json)[SERIES]).toBeUndefined();
    expect(((migrated['legacy'] as Json)['operations'] as Json)[SERIES]).toEqual(
      (legacy()['operations'] as Json)[SERIES],
    );
  });

  it('moves the series of account provisioning (`provision:<dataset>`) to accountSeries, keyed by the dataset', () => {
    const old = legacy();
    const saved = 1795344900000;
    old['operations'] = {
      ...(old['operations'] as Json),
      'provision:ds-7': { savedAt: saved, value: { baseline: 4, count: 20 } },
    };
    const migrated = migrateState(old) as Json;
    const state = State.parse(migrated);
    expect(state.accountSeries).toEqual({
      'ds-7': { savedAt: new Date(saved).toISOString(), value: { baseline: 4, count: 20 } },
    });
    expect(Object.keys(state.drafts).some((key) => key.startsWith('provision:'))).toBe(false);
  });

  it('a series record without baseline and count goes to legacy, not to accountSeries', () => {
    const old = legacy();
    old['operations'] = { 'provision:ds-8': { savedAt: 1795344900000, value: { count: 'x' } } };
    const migrated = migrateState(old) as Json;
    expect(State.parse(migrated).accountSeries).toEqual({});
    expect(((migrated['legacy'] as Json)['operations'] as Json)['provision:ds-8']).toBeDefined();
  });

  it('stamps the entries of suggestions, harSessions and drafts with an ISO savedAt', () => {
    const old = legacy();
    const state = State.parse(migrateState(old));
    for (const name of ['suggestions', 'harSessions', 'drafts'] as const) {
      for (const [key, entry] of Object.entries(
        old[name] as Record<string, { savedAt: number; value: unknown }>,
      )) {
        expect(state[name][key], `${name}.${key}`).toEqual({
          savedAt: new Date(entry.savedAt).toISOString(),
          value: entry.value,
        });
      }
    }
  });

  it('keeps the newest entries of a section over its limit, so the migrated file still parses', () => {
    const old = legacy();
    old['drafts'] = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [
        `d${String(i)}`,
        { savedAt: 1795344800000 + i, value: i },
      ]),
    );
    old['operations'] = Object.fromEntries(
      Array.from({ length: 120 }, (_, i) => [
        `provision:s${String(i)}`,
        { savedAt: 1795344800000 + i, value: { baseline: 0, count: i } },
      ]),
    );
    const state = State.parse(migrateState(old));
    expect(Object.keys(state.drafts)).toHaveLength(50);
    expect(state.drafts['d59']).toBeDefined();
    expect(state.drafts['d0']).toBeUndefined();
    expect(Object.keys(state.accountSeries)).toHaveLength(100);
    expect(state.accountSeries['s119']).toBeDefined();
  });

  it('every kind the old wait knew maps to a kind and a module of the new schema', () => {
    for (const kind of OPERATION_KINDS) {
      const old = legacy();
      old['operations'] = {
        [`${kind}:x1`]: { savedAt: NOW, value: { kind, id: 'x1', startedAt: NOW, saved: {} } },
      };
      const rows = State.parse(migrateState(old)).process[NEW_KEY]?.operations ?? [];
      expect(
        rows.map((row) => row.handle),
        kind,
      ).toEqual([`${kind}:x1`]);
    }
  });

  it('keeps the cache sections, moves runLoads, drops progress and keeps unknown sections in legacy', () => {
    const old = legacy();
    const migrated = migrateState(old) as Json;
    const state = State.parse(migrated);
    const iso = (section: unknown): Json =>
      Object.fromEntries(
        Object.entries(section as Record<string, { savedAt: number; value: unknown }>).map(
          ([key, entry]) => [
            key,
            { savedAt: new Date(entry.savedAt).toISOString(), value: entry.value },
          ],
        ),
      );
    expect(state.suggestions).toEqual(iso(old['suggestions']));
    expect(state.harSessions).toEqual(iso(old['harSessions']));
    const drafts = state.drafts as Json;
    expect(drafts['checkout']).toEqual(iso(old['drafts'])['checkout']);
    const load = (old['runLoads'] as Json)[SKLEP_IDS.executionPerf] as { savedAt: number };
    expect(state.runLoads[SKLEP_IDS.executionPerf]).toEqual({
      savedAt: new Date(load.savedAt).toISOString(),
      value: { run_id: SKLEP_IDS.executionPerf, requested_vu: 5000, effective_vu: 2000 },
    });
    expect(state.callProgress).toEqual({});
    expect(Object.keys(drafts).some((key) => key.startsWith('@'))).toBe(false);
    expect(migrated['legacy']).toEqual({
      notes: old['notes'],
      operations: { [SERIES]: (old['operations'] as Json)[SERIES] },
    });
    expect(migrated).not.toHaveProperty('operations');
    expect(migrated).not.toHaveProperty('progress');
  });

  it('is idempotent: a migrated file migrates to itself, and so does a second pass over the legacy', () => {
    const once = migrateState(legacy());
    expect(migrateState(once)).toEqual(once);
    expect(migrateState(legacy())).toEqual(once);
  });

  it('keeps a section that does not have the shape of its schema, instead of dropping it', () => {
    const old = legacy();
    old['harSessions'] = ['not', 'a', 'record'];
    const migrated = migrateState(old) as Json;
    expect(State.safeParse(migrated).success).toBe(true);
    expect((migrated['legacy'] as Json)['harSessions']).toEqual(['not', 'a', 'record']);
  });

  it('puts no secret into legacy: what the scrub masks is masked', () => {
    const old = legacy();
    old['notes'] = { owner: { savedAt: NOW, value: `token ${CANARY}` } };
    const mask = <T>(value: T): T =>
      JSON.parse(JSON.stringify(value).replaceAll(CANARY, '***')) as T;
    const migrated = migrateState(old, { scrubDeep: mask });
    expect(JSON.stringify(migrated)).not.toContain(CANARY);
  });

  it('refuses a schema it does not know', () => {
    expect(migrateState({ schema: 2 })).toBeUndefined();
    expect(migrateState({ schema: 4 })).toBeUndefined();
    expect(migrateState('x')).toBeUndefined();
  });
});

describe('a schema 3 file written before the cache sections carried ISO times', () => {
  const MS = 1795344600000;
  const early = (): Json => ({
    schema: 3,
    process: {},
    suggestions: { [SKLEP_IDS.project]: { savedAt: MS, value: { journeys: ['checkout'] } } },
    harSessions: { 'rec-1': 'bare' },
    drafts: {
      'provision:ds-1': { savedAt: MS + 1, value: { baseline: 2, count: 10 } },
      checkout: { savedAt: MS + 2, value: { flows: ['f1'] } },
    },
  });

  it('stamps savedAt given in milliseconds as ISO', () => {
    const state = State.parse(migrateState(early()));
    expect(state.suggestions[SKLEP_IDS.project]).toEqual({
      savedAt: new Date(MS).toISOString(),
      value: { journeys: ['checkout'] },
    });
    expect(state.drafts['checkout']).toEqual({
      savedAt: new Date(MS + 2).toISOString(),
      value: { flows: ['f1'] },
    });
  });

  it('moves a series of account provisioning from drafts to accountSeries', () => {
    const state = State.parse(migrateState(early()));
    expect(state.accountSeries).toEqual({
      'ds-1': { savedAt: new Date(MS + 1).toISOString(), value: { baseline: 2, count: 10 } },
    });
    expect(Object.keys(state.drafts)).toEqual(['checkout']);
  });

  it('keeps an entry of another shape under legacy.<section>', () => {
    const migrated = migrateState(early()) as Json;
    expect(State.parse(migrated).harSessions).toEqual({});
    expect((migrated['legacy'] as Json)['harSessions']).toEqual({ 'rec-1': 'bare' });
  });

  it('is idempotent, and a file already in the new shape comes back as it is', () => {
    const once = migrateState(early()) as Json;
    expect(migrateState(once)).toBe(once);
    const current: Json = {
      schema: 3,
      process: {},
      suggestions: { s: { savedAt: new Date(MS).toISOString(), value: 1 } },
      accountSeries: {
        'ds-2': { savedAt: new Date(MS).toISOString(), value: { baseline: 0, count: 1 } },
      },
    };
    const text = JSON.stringify(current);
    expect(migrateState(current)).toBe(current);
    expect(JSON.stringify(current)).toBe(text);
  });

  it('the cache reads such a file and its first write leaves it in the new shape', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'lc-early3-')));
    try {
      mkdirSync(join(root, 'loadcraft', '.cache'), { recursive: true });
      const file = join(root, 'loadcraft', '.cache', 'state.json');
      writeFileSync(file, JSON.stringify(early()));
      const c = createStateCache(root, {
        logger: createLogger({ level: 'error', sink: () => undefined }),
        secrets: noopSecretScope(),
        clock: { now: () => MS + 3_600_000 },
      });
      expect(c.get('drafts', 'checkout')?.value).toEqual({ flows: ['f1'] });
      expect(c.get('accountSeries', 'ds-1')?.value).toEqual({ baseline: 2, count: 10 });
      await c.set('drafts', 'next', 1);
      const written = JSON.parse(readFileSync(file, 'utf8')) as Json;
      expect(State.safeParse(written).success).toBe(true);
      expect((written['legacy'] as Json)['harSessions']).toEqual({ 'rec-1': 'bare' });
      expect(Object.keys(written['accountSeries'] as Json)).toEqual(['ds-1']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the cache on a file in the old schema', () => {
  let root: string;
  const file = (): string => join(root, 'loadcraft', '.cache', 'state.json');
  const cache = () =>
    createStateCache(root, {
      logger: createLogger({ level: 'debug', sink: () => undefined }),
      secrets: noopSecretScope(),
      clock: { now: () => NOW },
    });
  const put = (text: string): void => {
    mkdirSync(join(root, 'loadcraft', '.cache'), { recursive: true });
    writeFileSync(file(), text);
  };

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'lc-migrate-')));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the old file as it is (the sections and the handle) and does not rewrite it', () => {
    put(FIXTURE);
    const c = cache();
    const entry = c.get('operations', HANDLE);
    expect((entry?.value as { kind: string }).kind).toBe('test_run');
    expect(c.entries('operations').map(([key]) => key)).toEqual([HANDLE]);
    expect(c.get('runLoads', SKLEP_IDS.executionPerf)?.value).toMatchObject({ effective_vu: 2000 });
    expect(c.get('drafts', 'checkout')).toBeDefined();
    expect(readFileSync(file(), 'utf8')).toBe(FIXTURE);
  });

  it('the first write leaves a schema 3 file with the process, the sections and the unknown ones', async () => {
    put(FIXTURE);
    await cache().set('suggestions', 'other', { n: 1 });
    const text = readFileSync(file(), 'utf8');
    const written = JSON.parse(text) as Json;
    expect(written['schema']).toBe(3);
    expect(State.safeParse(written).success).toBe(true);
    expect(written).toHaveProperty('process');
    expect(written['legacy']).toEqual({
      notes: legacy()['notes'],
      operations: { [SERIES]: (legacy()['operations'] as Json)[SERIES] },
    });
    const c = cache();
    expect(c.get('operations', HANDLE)).toEqual((legacy()['operations'] as Json)[HANDLE]);
    expect(c.get('suggestions', 'other')?.value).toEqual({ n: 1 });
    expect(c.get('suggestions', SKLEP_IDS.project)).toBeDefined();
  });

  it('a second pass over the migrated file changes nothing but what is written', async () => {
    put(FIXTURE);
    await cache().set('suggestions', 'a', 1);
    const first = JSON.parse(readFileSync(file(), 'utf8')) as Json;
    expect(migrateState(first)).toEqual(first);
  });

  it('writes never change a process the reducer wrote: not set, not delete, not prune', async () => {
    const store = createProcessStore(root, {
      secrets: noopSecretScope(),
      clock: { now: () => NOW },
    });
    await store.applyUpdate(
      NEW_KEY,
      {
        ids: { env_id: '55555555-5555-4555-8555-555555555555' },
        checks: { project: { created: { ok: true } } },
      },
      { tool: 'project_create' },
    );
    const first = store.read(NEW_KEY);
    const before = JSON.stringify(first);
    const c = cache();
    await c.set('drafts', 'd', 1);
    await c.delete('drafts', 'd');
    await c.set('suggestions', 's', 1);
    await c.prune(1);
    expect(JSON.stringify(store.read(NEW_KEY))).toBe(before);
    await c.set('operations', 'test_run:late', {
      kind: 'test_run',
      id: 'late',
      startedAt: NOW,
      saved: {},
    });
    await c.delete('operations', 'test_run:late');
    const after = store.read(NEW_KEY);
    expect(after?.ids).toEqual(first?.ids);
    expect(after?.steps).toEqual(first?.steps);
    expect(after?.operations).toEqual([]);
  });

  it('setting an operation again keeps what the reducer put on its row', async () => {
    const c = cache();
    const entry = { kind: 'test_run', id: 'x1', startedAt: NOW, saved: {} };
    await c.set('operations', 'test_run:x1', entry);
    const store = createProcessStore(root, {
      secrets: noopSecretScope(),
      clock: { now: () => NOW },
    });
    await store.write(NEW_KEY, (p) => ({
      ...p,
      operations: p.operations.map((row) => ({
        ...row,
        status: 'waiting_user' as const,
        pending_id: 'c-1',
        progress: { stage: 'asking', percent: 50 },
      })),
    }));
    await c.set('operations', 'test_run:x1', { ...entry, saved: { more: 1 } });
    const [row] = store.read(NEW_KEY)?.operations ?? [];
    expect(row).toMatchObject({
      status: 'waiting_user',
      pending_id: 'c-1',
      progress: { stage: 'asking', percent: 50 },
    });
  });

  it('the row names the tool of the call that saved the operation', async () => {
    const named = createStateCache(root, {
      logger: createLogger({ level: 'debug', sink: () => undefined }),
      secrets: noopSecretScope(),
      clock: { now: () => NOW },
      tool: 'process_wait',
    });
    await named.set('operations', 'test_run:x2', {
      kind: 'test_run',
      id: 'x2',
      startedAt: NOW,
      saved: {},
    });
    const state = State.parse(JSON.parse(readFileSync(file(), 'utf8')));
    expect(state.process[NEW_KEY]?.operations[0]?.tool).toBe('process_wait');
  });

  it('a bar write waits briefly for a held lock and gives up with state_locked', async () => {
    const c = cache();
    await c.set('drafts', 'd', 1);
    const held = tryAcquire(file());
    expect(held).toBeDefined();
    const started = Date.now();
    try {
      await expect(
        c.setProgress('x:1:1', { tool: 'x', stage: 's', startedAt: NOW }, { quick: true }),
      ).rejects.toMatchObject({
        code: 'state_locked',
      });
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      if (held !== undefined) await releaseLock(held);
    }
  });

  it('an operation set now has a row in the process and goes when it is deleted', async () => {
    const c = cache();
    await c.set('operations', 'record_run:r1', {
      kind: 'record_run',
      id: 'r1',
      startedAt: NOW,
      saved: { a: 1 },
    });
    const rows = (): string[] =>
      Object.values(State.parse(JSON.parse(readFileSync(file(), 'utf8'))).process).flatMap((p) =>
        p.operations.map((o) => o.handle),
      );
    expect(rows()).toEqual(['record_run:r1']);
    expect(cache().get('operations', 'record_run:r1')?.value).toMatchObject({ saved: { a: 1 } });
    await c.delete('operations', 'record_run:r1');
    expect(rows()).toEqual([]);
    expect(cache().get('operations', 'record_run:r1')).toBeUndefined();
  });

  it('a new operation makes room among finished rows: its row and its payload are both written', async () => {
    const c = cache();
    const store = createProcessStore(root, {
      secrets: noopSecretScope(),
      clock: { now: () => NOW },
    });
    await c.set('operations', 'test_run:live', {
      kind: 'test_run',
      id: 'live',
      startedAt: NOW,
      saved: {},
    });
    await store.write(NEW_KEY, (p) => ({
      ...p,
      operations: [
        ...p.operations,
        ...Array.from({ length: 49 }, (_, i) => ({
          ...p.operations[0],
          handle: `test_run:old${String(i)}`,
          status: 'done' as const,
        })),
      ] as typeof p.operations,
    }));
    expect(store.read(NEW_KEY)?.operations).toHaveLength(50);
    await c.set('operations', 'test_run:n51', {
      kind: 'test_run',
      id: 'n51',
      startedAt: NOW,
      saved: { a: 1 },
    });
    const handles = store.read(NEW_KEY)?.operations.map((o) => o.handle) ?? [];
    expect(handles).toHaveLength(50);
    expect(handles).toContain('test_run:n51');
    expect(handles).toContain('test_run:live');
    expect(cache().get('operations', 'test_run:n51')?.value).toMatchObject({ saved: { a: 1 } });
    expect(cache().get('operations', 'test_run:live')).toBeDefined();
  });

  it('fifty rows that say running for over a day are lost: a new operation gets its row and its payload', async () => {
    const day = 24 * 3_600_000;
    let now = NOW - day - 60_000;
    const timed = createStateCache(root, {
      logger: createLogger({ level: 'debug', sink: () => undefined }),
      secrets: noopSecretScope(),
      clock: { now: () => now },
    });
    const store = createProcessStore(root, {
      secrets: noopSecretScope(),
      clock: { now: () => now },
    });
    await timed.set('operations', 'test_run:r0', {
      kind: 'test_run',
      id: 'r0',
      startedAt: now,
      saved: {},
    });
    await store.write(NEW_KEY, (p) => ({
      ...p,
      operations: Array.from({ length: 50 }, (_, i) => ({
        ...p.operations[0],
        handle: `test_run:r${String(i)}`,
      })) as typeof p.operations,
    }));
    now = NOW;
    await timed.set('operations', 'test_run:n1', {
      kind: 'test_run',
      id: 'n1',
      startedAt: NOW,
      saved: { a: 1 },
    });
    const rows = store.read(NEW_KEY)?.operations ?? [];
    expect(rows.map((o) => o.handle)).toContain('test_run:n1');
    expect(rows.find((o) => o.handle === 'test_run:n1')?.status).toBe('running');
    expect(rows.filter((o) => o.status === 'running')).toHaveLength(1);
    expect(timed.get('operations', 'test_run:n1')?.value).toMatchObject({ saved: { a: 1 } });
    // the payloads of the lost ones go with their rows
    expect(timed.get('operations', 'test_run:r0')).toBeUndefined();
  });

  it('with fifty fresh operations running a new one keeps its handle: its payload is saved without a row', async () => {
    const c = cache();
    const store = createProcessStore(root, {
      secrets: noopSecretScope(),
      clock: { now: () => NOW },
    });
    await c.set('operations', 'test_run:r0', {
      kind: 'test_run',
      id: 'r0',
      startedAt: NOW,
      saved: {},
    });
    await store.write(NEW_KEY, (p) => ({
      ...p,
      operations: Array.from({ length: 50 }, (_, i) => ({
        ...p.operations[0],
        handle: `test_run:r${String(i)}`,
      })) as typeof p.operations,
    }));
    await expect(
      c.set('operations', 'test_run:r50', {
        kind: 'test_run',
        id: 'r50',
        startedAt: NOW,
        saved: { b: 2 },
      }),
    ).resolves.toBeUndefined();
    const rows = store.read(NEW_KEY)?.operations ?? [];
    expect(rows).toHaveLength(50);
    expect(rows.map((o) => o.handle)).not.toContain('test_run:r50');
    expect(cache().get('operations', 'test_run:r50')?.value).toMatchObject({ saved: { b: 2 } });
    expect(cache().get('operations', 'test_run:r0')).toBeDefined();
  });

  it('the row of an operation gets its progress although its entry is saved more often than once a second', async () => {
    let now = NOW;
    const timed = createStateCache(root, {
      logger: createLogger({ level: 'debug', sink: () => undefined }),
      secrets: noopSecretScope(),
      clock: { now: () => now },
    });
    const handle = 'record_run:rr';
    for (let i = 0; i < 6; i += 1) {
      await timed.set('operations', handle, {
        kind: 'record_run',
        id: 'rr',
        startedAt: NOW,
        saved: { step: i },
      });
      await timed.setProgress('wait:1:1', {
        tool: 'process_wait',
        handle,
        stage: `step ${String(i)}`,
        startedAt: NOW,
      });
      now += 400;
    }
    const row = State.parse(JSON.parse(readFileSync(file(), 'utf8'))).process[NEW_KEY]
      ?.operations[0];
    // at most once a second: of six bars in 2 s, the first and the one a second later reach the row
    expect(row?.progress?.stage).toBe('step 3');
  });

  it('a bar written again with the same progress leaves the row and its rev alone', async () => {
    let now = NOW;
    const timed = createStateCache(root, {
      logger: createLogger({ level: 'debug', sink: () => undefined }),
      secrets: noopSecretScope(),
      clock: { now: () => now },
    });
    const handle = 'test_run:hb';
    await timed.set('operations', handle, {
      kind: 'test_run',
      id: 'hb',
      startedAt: NOW,
      saved: {},
    });
    const bar = { tool: 'process_wait', handle, stage: 'running', percent: 40, startedAt: NOW };
    await timed.setProgress('wait:1:1', bar);
    const read = () => State.parse(JSON.parse(readFileSync(file(), 'utf8')));
    const before = read().process[NEW_KEY];
    now += 30_000;
    await timed.setProgress('wait:1:1', bar);
    const after = read();
    expect(after.process[NEW_KEY]).toEqual(before);
    expect(after.callProgress['wait:1:1']?.updatedAt).toBe(new Date(now).toISOString());
  });

  it('the operations a call ended live beside its bar, go with it, and an earlier reader still parses the file', async () => {
    let now = NOW;
    const timed = createStateCache(root, {
      logger: createLogger({ level: 'debug', sink: () => undefined }),
      secrets: noopSecretScope(),
      clock: { now: () => now },
    });
    const handle = 'test_run:e1';
    await timed.set('operations', handle, {
      kind: 'test_run',
      id: 'e1',
      startedAt: NOW,
      saved: {},
    });
    timed.endOperation({
      handle,
      kind: 'test_run',
      module: 'run',
      tool: 'run_start',
      status: 'failed',
      started_at: new Date(NOW).toISOString(),
    });
    const bar = { tool: 'scenario_generate', stage: 'next', startedAt: NOW };
    await timed.setProgress('call:1:1', bar);
    const raw = () => JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>;
    expect(raw()['callEnded']).toEqual({ 'call:1:1': [handle] });
    expect(timed.progressRows()[0]?.ended).toEqual([handle]);
    // a reader that does not know the section drops it on read and keeps it on write (unknown keys)
    const earlier = Object.fromEntries(
      Object.entries(State.shape).filter(([field]) => field !== 'callEnded'),
    );
    expect(z.object(earlier).safeParse(raw()).success).toBe(true);
    // the bar of a call that is gone (past its time to live) takes the section with it
    now += 11 * 60_000;
    await timed.set('drafts', 'other', { x: 1 });
    expect(raw()['callProgress']).toEqual({});
    expect(raw()['callEnded']).toBeUndefined();
    // the bar removed at the end of a call removes the entry too
    await timed.setProgress('call:2:2', { ...bar, startedAt: now });
    expect(raw()['callEnded']).toEqual({ 'call:2:2': [handle] });
    await timed.deleteProgress('call:2:2');
    expect(raw()['callEnded']).toBeUndefined();
  });

  it('a call that ended more operations than the section holds keeps the newest, and its bar is still written', async () => {
    const timed = createStateCache(root, {
      logger: createLogger({ level: 'debug', sink: () => undefined }),
      secrets: noopSecretScope(),
      clock: { now: () => NOW },
    });
    const handles = Array.from(
      { length: LIMITS.operations + 5 },
      (_, i) => `test_run:m${String(i)}`,
    );
    for (const handle of handles) {
      timed.endOperation({
        handle,
        kind: 'test_run',
        module: 'run',
        tool: 'run_start',
        status: 'done',
        started_at: new Date(NOW).toISOString(),
      });
    }
    await timed.setProgress('call:9:9', { tool: 'run_start', stage: 'next', startedAt: NOW });
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as {
      callProgress: Record<string, unknown>;
      callEnded?: Record<string, string[]>;
    };
    expect(Object.keys(raw.callProgress)).toEqual(['call:9:9']);
    expect(raw.callEnded?.['call:9:9']).toEqual(handles.slice(-LIMITS.operations));
  });

  it('a key that starts with @ is stored encoded, since the schema forbids it, and reads back as given', async () => {
    const c = cache();
    await c.set('drafts', '@runLoads/x', { mine: true });
    await c.set('drafts', '%40y', { other: true });
    await c.set('runLoads', 'x', { execution_id: 'x', requested_vu: 5, effective_vu: 2 });
    expect(c.entries('drafts').map(([key]) => key)).toEqual(['@runLoads/x', '%40y']);
    expect(c.get('drafts', '@runLoads/x')?.value).toEqual({ mine: true });
    expect(c.get('drafts', '%40y')?.value).toEqual({ other: true });
    expect(c.get('runLoads', 'x')?.value).toEqual({
      execution_id: 'x',
      requested_vu: 5,
      effective_vu: 2,
    });
    const written = State.parse(JSON.parse(readFileSync(file(), 'utf8')));
    expect(Object.keys(written.drafts).some((key) => key.startsWith('@'))).toBe(false);
  });

  it('a payload of a finished operation does not outlive its row, and call bars expire', async () => {
    let now = NOW;
    const timed = createStateCache(root, {
      logger: createLogger({ level: 'debug', sink: () => undefined }),
      secrets: noopSecretScope(),
      clock: { now: () => now },
    });
    await timed.set('operations', 'test_run:p1', {
      kind: 'test_run',
      id: 'p1',
      startedAt: NOW,
      saved: {},
    });
    await timed.setProgress('wait:1:1', { tool: 'process_wait', stage: 'x', startedAt: NOW });
    expect(timed.progressRows().map((row) => row.key)).toEqual(['wait:1:1']);
    // the reducer ends the operation: its payload is pruned with the next write
    const store = createProcessStore(root, {
      secrets: noopSecretScope(),
      clock: { now: () => now },
    });
    await store.write(NEW_KEY, (p) => ({
      ...p,
      operations: p.operations.map((row) => ({ ...row, status: 'done' as const })),
    }));
    now += 11 * 60_000;
    await timed.set('drafts', 'tick', 1);
    expect(timed.get('operations', 'test_run:p1')).toBeUndefined();
    expect(timed.progressRows()).toEqual([]);
  });

  it('a file that is not JSON goes to state.json.bak and a fresh state is written', async () => {
    put('{ this is not json');
    await cache().set('drafts', 'd', 1);
    const dir = join(root, 'loadcraft', '.cache');
    expect(readFileSync(join(dir, 'state.json.bak'), 'utf8')).toBe('{ this is not json');
    const written = JSON.parse(readFileSync(file(), 'utf8')) as Json;
    expect(written['schema']).toBe(3);
    expect(cache().get('drafts', 'd')?.value).toBe(1);
  });

  it('a second unreadable file does not overwrite the first bak', async () => {
    put('{ first');
    await cache().set('drafts', 'd', 1);
    put('{ second');
    await cache().set('drafts', 'e', 1);
    const dir = join(root, 'loadcraft', '.cache');
    expect(readFileSync(join(dir, 'state.json.bak'), 'utf8')).toBe('{ first');
    const others = readdirSync(dir).filter((n) => n.endsWith('.bak') && n !== 'state.json.bak');
    expect(others.map((n) => readFileSync(join(dir, n), 'utf8'))).toEqual(['{ second']);
  });

  it('a schema 3 file with a wrong structure is refused as unreadable, not moved: the process stays', () => {
    const broken = JSON.stringify({ schema: 3, process: { 'not-a-uuid': {} } });
    put(broken);
    expect(() => cache().get('drafts', 'a')).toThrow(/unreadable/u);
    expect(readFileSync(file(), 'utf8')).toBe(broken);
    expect(
      readdirSync(join(root, 'loadcraft', '.cache')).filter((n) => n.includes('.bak')),
    ).toEqual([]);
  });

  it('a file that is JSON but not a state goes to the bak as well', () => {
    put(JSON.stringify({ hello: 1 }));
    const c = cache();
    expect(c.get('suggestions', 'a')).toBeUndefined();
    expect(readFileSync(join(root, 'loadcraft', '.cache', 'state.json.bak'), 'utf8')).toContain(
      '"hello"',
    );
  });

  it('a schema this version does not know is refused, not moved', () => {
    put(JSON.stringify({ schema: 9 }));
    expect(() => cache().get('drafts', 'a')).toThrow(/schema 9/);
    expect(readFileSync(file(), 'utf8')).toBe(JSON.stringify({ schema: 9 }));
  });
});

describe('wait on a handle saved before the migration', () => {
  it('finishes the operation, and the file is in schema 3 afterwards', async () => {
    const r = await runRig({ script: PERF });
    // The run exists in the backend; what the old plugin version had saved about it is put back as the file.
    const started = await settleClock(r, r.call('run_start', { ...PERF_ARGS, max_wait_s: 5 }));
    expect(started.isError, started.text).toBe(false);
    const stateFile = join(r.workspace, 'loadcraft', '.cache', 'state.json');
    writeFileSync(stateFile, FIXTURE);
    const first = await settleClock(r, r.call('process_wait', { operation: HANDLE }));
    expect(first.isError, `${first.text}\n${r.lines.join('\n')}`).toBe(false);
    expect(first.text).not.toContain('operation_unknown');
    // the first write turned the file into schema 3; the handle is still there, as a row and as its payload
    const mid = State.parse(JSON.parse(readFileSync(stateFile, 'utf8')));
    // the run is made in a bound workspace, so the old `_new` moved under its project with the first write
    expect(Object.keys(mid.process)).not.toContain(NEW_KEY);
    expect(
      Object.values(mid.process).flatMap((p) => p.operations.map((row) => row.handle)),
    ).toEqual([HANDLE]);
    expect(Object.keys(mid.opPayloads)).toContain(HANDLE);

    let last = first;
    for (let again = 0; again < 12; again += 1) {
      const seen = last.outcome as { status: string; operation?: string } | undefined;
      if (last.isError || seen?.status !== 'running') break;
      last = await settleClock(r, r.call('process_wait', { operation: HANDLE }));
    }
    expect(last.isError, last.text).toBe(false);
    expect((last.outcome as { status: string }).status).toBe('done');
    const after = JSON.parse(readFileSync(stateFile, 'utf8')) as Json;
    expect(after['schema']).toBe(3);
    expect(after).toHaveProperty('process');
    // the payload of the finished operation left the file, its row says how it ended, and the rest of
    // the old file is still there
    const state = State.parse(after);
    expect(Object.values(state.process).flatMap((p) => p.operations)).toEqual([
      expect.objectContaining({ handle: HANDLE, status: 'done' }),
    ]);
    expect(Object.keys(state.opPayloads)).not.toContain(HANDLE);
    expect(Object.keys(state.drafts)).not.toContain(SERIES);
    expect(Object.keys((after['legacy'] as Json)['operations'] as Json)).toContain(SERIES);
    expect(Object.keys(state.suggestions)).toEqual([SKLEP_IDS.project]);
  });
});
