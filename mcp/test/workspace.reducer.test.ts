// The state reducer: the only write path of process[...] in loadcraft/.cache/state.json. Every test runs on a
// real file in a temporary workspace; the lock is a real `.lock` file next to it.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import * as fs from 'node:fs';
import type { PathLike } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolError } from '../src/errors.js';
import { createLogger } from '../src/log.js';
import { Secret } from '../src/secret.js';
import { releaseLock, tryAcquire, type LockHandle } from '../src/workspace/lock.js';
import { CallSecretScope } from '../src/workspace/secrets.js';
import { LIMITS, NEW_KEY, recordCall, type Process } from '../src/workspace/processState.js';
import {
  createProcessStore,
  reduce,
  type ProcessStoreOptions,
  type ProcessUpdateInput,
} from '../src/workspace/reducer.js';
import { CANARY, assertNoCanary } from './helpers/canary.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const FLOW_A = '22222222-2222-4222-8222-222222222222';
const FLOW_B = '33333333-3333-4333-8333-333333333333';
const DATASET = '44444444-4444-4444-8444-444444444444';
const ENV = '55555555-5555-4555-8555-555555555555';
const SCENARIO = '66666666-6666-4666-8666-666666666666';
const NOW_MS = Date.parse('2026-03-01T12:00:00.000Z');
const NOW = new Date(NOW_MS).toISOString();
const TOOL = { tool: 'test_tool' };
/** An update that changes the state (an empty one writes nothing). */
const TOUCH = { checks: { project: { created: { ok: true } } } } satisfies ProcessUpdateInput;
const OTHER = '77777777-7777-4777-8777-777777777777';
const THIRD = '88888888-8888-4888-8888-888888888888';

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lc-reducer-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const statePath = (dir: string = root): string => join(dir, 'loadcraft', '.cache', 'state.json');
const lockPath = (dir: string = root): string => `${statePath(dir)}.lock`;

function secretScope(): CallSecretScope {
  const scope = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
  scope.add(CANARY);
  return scope;
}

function store(options: Partial<ProcessStoreOptions> = {}, dir: string = root) {
  return createProcessStore(dir, {
    secrets: secretScope(),
    clock: { now: () => NOW_MS },
    ...options,
  });
}

function fileText(dir: string = root): string {
  return readFileSync(statePath(dir), 'utf8');
}

function processIn(dir: string = root, key: string = PROJECT): Process {
  const parsed = JSON.parse(fileText(dir)) as { process: Record<string, Process> };
  const found = parsed.process[key];
  if (found === undefined) throw new Error(`no process ${key}`);
  return found;
}

async function rejection(promise: Promise<unknown>): Promise<ToolError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ToolError) return error;
    throw error;
  }
  throw new Error('expected a ToolError');
}

/** A process as the reducer creates it, for the pure `reduce` tests. */
async function freshProcess(): Promise<Process> {
  await store().applyUpdate(PROJECT, TOUCH, TOOL);
  return processIn();
}

describe('reduce', () => {
  it('replaces ids, merges scenario_ids, unsets, adds without duplicates and removes', async () => {
    const p = await freshProcess();
    const first = reduce(
      p,
      {
        ids: { env_id: ENV, scenario_ids: { [FLOW_A]: SCENARIO } },
        add: { flow_ids: [FLOW_A, FLOW_B, FLOW_A], dataset_ids: [DATASET] },
      },
      { tool: 'flows_generate', now: NOW },
    );
    expect(first.ids).toMatchObject({
      project_id: PROJECT,
      env_id: ENV,
      flow_ids: [FLOW_A, FLOW_B],
      dataset_ids: [DATASET],
      scenario_ids: { [FLOW_A]: SCENARIO },
    });
    const second = reduce(
      first,
      {
        ids: { scenario_ids: { [FLOW_B]: SCENARIO } },
        unset: ['env_id', 'dataset_ids'],
        remove: { flow_ids: [FLOW_A] },
      },
      { tool: 'flows_delete', now: NOW },
    );
    expect(second.ids.env_id).toBeUndefined();
    expect(second.ids.dataset_ids).toEqual([]);
    expect(second.ids.flow_ids).toEqual([FLOW_B]);
    expect(second.ids.scenario_ids).toEqual({ [FLOW_A]: SCENARIO, [FLOW_B]: SCENARIO });
  });

  it('stamps labels, checks and problems with the time and the tool, and merges choices per module', async () => {
    const p = await freshProcess();
    const next = reduce(
      p,
      {
        labels: { [ENV]: { name: 'staging', env: { protected: true, default: true } } },
        choices: { flows: { method: 'har' }, run: { env_id: ENV } },
        checks: { project: { env_saved: { ok: true, note: 'one env' } } },
        problems: {
          open: [
            {
              module: 'project',
              tool: 'project_check_env',
              code: 'env_down',
              severity: 'warning',
              message: 'no answer',
            },
          ],
        },
      },
      { tool: 'project_save_env', now: NOW },
    );
    expect(next.labels[ENV]).toEqual({
      name: 'staging',
      env: { protected: true, default: true },
      at: NOW,
    });
    expect(next.steps.project.checks.env_saved).toEqual({
      ok: true,
      note: 'one env',
      at: NOW,
      by: 'project_save_env',
    });
    expect(next.choices.flows.method).toBe('har');
    expect(next.choices.run.env_id).toBe(ENV);
    expect(next.problems).toHaveLength(1);
    expect(next.problems[0]).toMatchObject({ code: 'env_down', at: NOW });
    expect(next.problems[0]?.id).toMatch(/^.{1,16}$/);

    const later = reduce(
      next,
      {
        labels: { [ENV]: { name: 'staging-2' } },
        choices: { flows: { har_split: true } },
        problems: { close: [{ code: 'env_down' }] },
      },
      { tool: 'project_check_env', now: NOW },
    );
    // a label update keeps the env flags it does not name; choices of a module are merged, not replaced
    expect(later.labels[ENV]).toEqual({
      name: 'staging-2',
      env: { protected: true, default: true },
      at: NOW,
    });
    expect(later.choices.flows).toEqual({ method: 'har', har_split: true });
    expect(later.problems).toEqual([]);
  });

  it('upserts operations by handle', async () => {
    const p = await freshProcess();
    const started = reduce(
      p,
      {
        operations: [
          {
            handle: 'test_run:1',
            kind: 'test_run',
            module: 'run',
            tool: 'run_start',
            status: 'running',
          },
        ],
      },
      { tool: 'run_start', now: NOW },
    );
    expect(started.operations).toEqual([
      expect.objectContaining({
        handle: 'test_run:1',
        status: 'running',
        started_at: NOW,
        updated_at: NOW,
      }),
    ]);
    const later = new Date(NOW_MS + 60_000).toISOString();
    const done = reduce(
      started,
      { operations: [{ handle: 'test_run:1', status: 'done' }] },
      { tool: 'process_wait', now: later },
    );
    expect(done.operations).toEqual([
      expect.objectContaining({
        handle: 'test_run:1',
        kind: 'test_run',
        status: 'done',
        started_at: NOW,
        updated_at: later,
      }),
    ]);
  });
});

describe('applyUpdate', () => {
  it('creates the process on the first write and raises rev by one on every write', async () => {
    const s = store();
    expect(s.read(PROJECT)).toBeUndefined();
    const first = await s.applyUpdate(PROJECT, { ids: { env_id: ENV } }, TOOL);
    expect(first).toMatchObject({ written: true, attempts: 1 });
    expect(first.process.rev).toBe(1);
    const second = await s.applyUpdate(PROJECT, { add: { flow_ids: [FLOW_A] } }, TOOL);
    expect(second.process.rev).toBe(2);
    expect(s.read(PROJECT)).toMatchObject({
      rev: 2,
      ids: { project_id: PROJECT, env_id: ENV, flow_ids: [FLOW_A] },
    });
    expect(JSON.parse(fileText())).toMatchObject({ schema: 3 });
    // the process before a project exists lives under '_new' with empty ids
    const fresh = await s.applyUpdate(NEW_KEY, TOUCH, TOOL);
    expect(fresh.process.ids.project_id).toBeUndefined();
    expect(readFileSync(join(root, 'loadcraft', '.cache', '.gitignore'), 'utf8')).toBe('*\n');
  });

  it.each([
    ['an unknown top-level key', { bogus: 1 }],
    ['an unknown key inside ids', { ids: { env_id: ENV, bogus: 1 } }],
    ['an unknown key inside choices', { choices: { run: { env_id: ENV, speed: 'fast' } } }],
    ['an unknown check of a module', { checks: { project: { not_a_check: { ok: true } } } }],
    ['a key named after a secret', { [CANARY]: true }],
    ['the step (only the reducer moves it)', { step: 'flows' }],
  ])('rejects %s and leaves the file as it was', async (_name, update) => {
    const s = store();
    await s.applyUpdate(PROJECT, { ids: { env_id: ENV } }, TOOL);
    const before = readFileSync(statePath());
    const error = await rejection(s.applyUpdate(PROJECT, update as ProcessUpdateInput, TOOL));
    expect(error.code).toBe('state_update_invalid');
    assertNoCanary(error.message, error.params, error.details, error.hint);
    expect(readFileSync(statePath()).equals(before)).toBe(true);
  });

  it('never writes a registered secret to the file: not in values, keys or nested records', async () => {
    const s = store();
    await s.applyUpdate(
      PROJECT,
      {
        labels: {
          [ENV]: { name: `env ${CANARY}` },
          [`key-${CANARY}`]: { name: 'flow' },
        },
        choices: {
          flows: { journeys: [`checkout ${CANARY}`], account_ref: CANARY },
          scenario: { data_mix: { [`mix-${CANARY}`]: 40, normal: 60 } },
        },
        checks: { project: { env_checked: { ok: false, note: `token ${CANARY} rejected` } } },
        problems: {
          open: [
            {
              module: 'project',
              tool: 'project_check_env',
              code: 'env_down',
              severity: 'blocker',
              message: `401 for ${CANARY}`,
            },
          ],
        },
        operations: [
          {
            handle: 'test_run:9',
            kind: 'test_run',
            module: 'run',
            tool: 'run_start',
            status: 'running',
            label: CANARY,
          },
        ],
      },
      TOOL,
    );
    // a write that is not a ProcessUpdate (the registration layer) goes through the same filter
    await s.write(PROJECT, (p, now) => ({
      ...p,
      pending: [
        {
          id: 'p-00000001',
          kind: 'consent',
          level: 2,
          module: 'data',
          origin: 'model',
          title: 'Create accounts',
          fields: [{ label: 'file', value: `accounts ${CANARY}` }],
          calls: [
            {
              n: 1,
              tool: 'data_create_accounts',
              title: 'Create accounts',
              fields: [],
              args: { deep: { [CANARY]: { list: [`x ${CANARY}`] } }, token: new Secret(CANARY) },
              deferred: [],
              args_hash: 'h',
              effect: 'write',
              reversible: 'no',
              status: 'queued',
            },
          ],
          reversible: 'no',
          warnings: [],
          status: 'open',
          created_at: now,
        },
      ],
    }));
    const bytes = readFileSync(statePath());
    expect(bytes.includes(Buffer.from(CANARY))).toBe(false);
    assertNoCanary(bytes.toString('utf8'));
    // what is not secret is still there
    const p = processIn();
    expect(p.labels[ENV]?.name).toMatch(/^env /);
    expect(p.choices.scenario.data_mix).toMatchObject({ normal: 60 });
    expect(p.steps.project.checks.env_checked).toMatchObject({ ok: false });
    expect(p.pending[0]?.calls[0]?.args).toMatchObject({ deep: expect.any(Object) as unknown });
  });

  it('two parallel writes with the same rev: one retry on the fresh state and both effects kept (20 runs)', async () => {
    for (let run = 0; run < 20; run += 1) {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lc-reducer-par-')));
      try {
        // two server processes (the conversation and a subagent): two stores, one file
        const conversation = store({}, dir);
        const subagent = store({}, dir);
        await conversation.applyUpdate(PROJECT, TOUCH, TOOL);
        const results = await Promise.all([
          conversation.applyUpdate(
            PROJECT,
            { add: { flow_ids: [FLOW_A] }, checks: { flows: { flows_built: { ok: true } } } },
            { tool: 'flows_generate' },
          ),
          subagent.applyUpdate(
            PROJECT,
            { add: { dataset_ids: [DATASET] }, labels: { [DATASET]: { name: 'orders' } } },
            { tool: 'data_create_dataset' },
          ),
        ]);
        expect(results.map((r) => r.attempts).sort()).toEqual([1, 2]);
        const p = processIn(dir);
        expect(p.rev).toBe(3);
        expect(p.ids.flow_ids).toEqual([FLOW_A]);
        expect(p.ids.dataset_ids).toEqual([DATASET]);
        expect(p.steps.flows.checks.flows_built).toMatchObject({ ok: true, by: 'flows_generate' });
        expect(p.labels[DATASET]?.name).toBe('orders');
        expect(existsSync(lockPath(dir))).toBe(false);
        expect(
          readdirSync(join(dir, 'loadcraft', '.cache')).filter((f) => f.endsWith('.tmp')),
        ).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('eight parallel writers lose nothing: every flow is in the file and rev counts every write', async () => {
    const flows = Array.from(
      { length: 8 },
      (_, i) => `a${String(i)}aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    );
    await store().applyUpdate(PROJECT, TOUCH, TOOL);
    const results = await Promise.all(
      flows.map((flow) => store().applyUpdate(PROJECT, { add: { flow_ids: [flow] } }, TOOL)),
    );
    expect(results.every((r) => r.attempts <= 2)).toBe(true);
    const p = processIn();
    expect([...p.ids.flow_ids].sort()).toEqual([...flows].sort());
    expect(p.rev).toBe(1 + flows.length);
  });

  it('a second conflict in a row ends with state_conflict and keeps the other writer’s file', async () => {
    const s = store();
    await s.applyUpdate(PROJECT, TOUCH, TOOL);
    let calls = 0;
    // Every time the reducer computes, another writer commits a newer rev first (a writer that does not
    // take the lock: three conflicts would follow in a row, the reducer gives up at the second).
    const error = await rejection(
      s.write(PROJECT, (p) => {
        calls += 1;
        const raw = JSON.parse(fileText()) as { process: Record<string, Process> };
        const current = raw.process[PROJECT];
        if (current === undefined) throw new Error('missing process');
        raw.process[PROJECT] = {
          ...current,
          rev: current.rev + 1,
          ids: { ...current.ids, env_id: ENV },
        };
        writeFileSync(statePath(), JSON.stringify(raw));
        return { ...p, ids: { ...p.ids, flow_ids: [FLOW_A] } };
      }),
    );
    expect(error.code).toBe('state_conflict');
    expect(calls).toBe(2);
    const p = processIn();
    expect(p.rev).toBe(3);
    expect(p.ids.env_id).toBe(ENV);
    expect(p.ids.flow_ids).toEqual([]);
    expect(existsSync(lockPath())).toBe(false);
  });

  it('a read with format=data or from the panel writes nothing; a conversation read raises rev by one', async () => {
    const s = store();
    await s.applyUpdate(PROJECT, TOUCH, TOOL);
    const entry = {
      id: 'l-00000001',
      at: NOW,
      ms: 5,
      module: 'project' as const,
      tool: 'project_get',
      level: 1 as const,
      effect: 'read' as const,
      origin: 'panel' as const,
      args: '',
      result: 'ok',
      status: 'ok' as const,
    };
    const before = readFileSync(statePath());
    const mtime = statSync(statePath()).mtimeMs;
    const panel = await s.write(PROJECT, (p, now) => recordCall(p, { entry }, now));
    const data = await s.write(PROJECT, (p, now) =>
      recordCall(p, { entry: { ...entry, origin: 'model' }, format: 'data' }, now),
    );
    expect(panel.written).toBe(false);
    expect(data.written).toBe(false);
    expect(readFileSync(statePath()).equals(before)).toBe(true);
    expect(statSync(statePath()).mtimeMs).toBe(mtime);
    const read = await s.write(PROJECT, (p, now) =>
      recordCall(p, { entry: { ...entry, origin: 'model' } }, now),
    );
    expect(read.written).toBe(true);
    expect(processIn()).toMatchObject({ rev: 2, reads_total: 1, log: [] });
  });

  it('prunes before validating: the 301st log entry and finished cards older than a day do not break the write', async () => {
    const s = store();
    await s.applyUpdate(PROJECT, TOUCH, TOOL);
    const old = new Date(NOW_MS - 48 * 3_600_000).toISOString();
    const logEntry = (i: number) => ({
      id: `l-${String(i).padStart(8, '0')}`,
      at: NOW,
      ms: 1,
      module: 'flows' as const,
      tool: 'flows_save',
      level: 1 as const,
      effect: 'write' as const,
      origin: 'model' as const,
      args: '',
      result: 'ok',
      status: 'ok' as const,
      has_detail: false,
    });
    const card = (i: number, status: 'done' | 'open', at: string) => ({
      id: `p-${String(i).padStart(8, '0')}`,
      kind: 'question' as const,
      level: 1 as const,
      module: 'flows' as const,
      origin: 'model' as const,
      title: 'q',
      fields: [],
      calls: [],
      reversible: 'no' as const,
      warnings: [],
      status,
      created_at: at,
      ...(status === 'done' ? { resolved_at: at } : {}),
    });
    const result = await s.write(PROJECT, (p) => ({
      ...p,
      log: Array.from({ length: LIMITS.log + 1 }, (_, i) => logEntry(i)),
      pending: [
        ...Array.from({ length: LIMITS.pending }, (_, i) => card(i, 'done', old)),
        card(999, 'open', NOW),
      ],
    }));
    expect(result.written).toBe(true);
    const p = processIn();
    expect(p.log).toHaveLength(LIMITS.log);
    expect(p.log[0]?.id).toBe('l-00000001');
    expect(p.pending.map((c) => c.id)).toEqual(['p-00000999']);
  });

  it('refuses a state file of another schema and leaves it untouched', async () => {
    mkdirSync(join(root, 'loadcraft', '.cache'), { recursive: true });
    writeFileSync(statePath(), JSON.stringify({ schema: 1, suggestions: {} }));
    const before = readFileSync(statePath());
    const error = await rejection(store().applyUpdate(PROJECT, TOUCH, TOOL));
    expect(error.code).toBe('state_schema_unsupported');
    expect(readFileSync(statePath()).equals(before)).toBe(true);
  });
});

describe('more of the single write path', () => {
  const logEntry = {
    id: 'l-0000000a',
    at: NOW,
    ms: 3,
    module: 'flows' as const,
    tool: 'flows_generate',
    level: 2 as const,
    effect: 'write' as const,
    origin: 'model' as const,
    args: '',
    result: 'ok',
    status: 'ok' as const,
  };

  it('recordCall leaves rev to the store: the entry alone does not raise it', async () => {
    const s = store();
    await s.applyUpdate(PROJECT, TOUCH, TOOL);
    const p = processIn();
    const next = recordCall(p, { entry: logEntry }, NOW);
    expect(next.log.map((e) => e.id)).toEqual(['l-0000000a']);
    expect(next.rev).toBe(p.rev);
  });

  it('the first write of a new process with a log entry is rev 1', async () => {
    const s = store();
    await s.applyUpdate(
      NEW_KEY,
      {},
      { tool: 'flows_generate', then: (p, now) => recordCall(p, { entry: logEntry }, now) },
    );
    expect(processIn(root, NEW_KEY).rev).toBe(1);
  });

  it('keeps choices.data.needs_accounts, merged with the other choices', async () => {
    const s = store();
    await s.applyUpdate(PROJECT, { choices: { run: { env_id: ENV } } }, TOOL);
    await s.applyUpdate(PROJECT, { choices: { data: { needs_accounts: true } } }, TOOL);
    const p = processIn();
    expect(p.choices.data).toEqual({ needs_accounts: true });
    expect(p.choices.run.env_id).toBe(ENV);
  });

  it('an update without state fields writes nothing and keeps rev', async () => {
    const s = store();
    await s.applyUpdate(PROJECT, TOUCH, TOOL);
    const before = readFileSync(statePath());
    const result = await s.applyUpdate(PROJECT, {}, TOOL);
    expect(result.written).toBe(false);
    expect(result.process.rev).toBe(1);
    expect(readFileSync(statePath()).equals(before)).toBe(true);
  });

  it('more live cards than the limit end with pending_full and the file stays as it was', async () => {
    const s = store();
    await s.applyUpdate(PROJECT, TOUCH, TOOL);
    const before = readFileSync(statePath());
    const card = (i: number) => ({
      id: `p-${String(i).padStart(8, '0')}`,
      kind: 'question' as const,
      level: 1 as const,
      module: 'flows' as const,
      origin: 'model' as const,
      title: 'q',
      fields: [],
      calls: [],
      reversible: 'no' as const,
      warnings: [],
      status: 'open' as const,
      created_at: NOW,
    });
    const error = await rejection(
      s.write(PROJECT, (p) => ({
        ...p,
        pending: Array.from({ length: LIMITS.pending + 1 }, (_, i) => card(i)),
      })),
    );
    expect(error.code).toBe('pending_full');
    expect(readFileSync(statePath()).equals(before)).toBe(true);
  });

  it('applyUpdate with `then`: the effect and the log entry land in one write, with one new rev', async () => {
    const s = store();
    await s.applyUpdate(PROJECT, TOUCH, TOOL);
    const result = await s.applyUpdate(
      PROJECT,
      { add: { flow_ids: [FLOW_A] } },
      { tool: 'flows_generate', then: (p, now) => recordCall(p, { entry: logEntry }, now) },
    );
    expect(result).toMatchObject({ written: true, attempts: 1 });
    const p = processIn();
    expect(p.rev).toBe(2);
    expect(p.ids.flow_ids).toEqual([FLOW_A]);
    expect(p.log.map((e) => e.id)).toEqual(['l-0000000a']);
  });

  it('`then` runs again on the fresh state when a parallel write came first', async () => {
    await store().applyUpdate(PROJECT, TOUCH, TOOL);
    const [a, b] = await Promise.all([
      store().applyUpdate(
        PROJECT,
        { add: { flow_ids: [FLOW_A] } },
        { tool: 'flows_generate', then: (p, now) => recordCall(p, { entry: logEntry }, now) },
      ),
      store().applyUpdate(
        PROJECT,
        { add: { flow_ids: [FLOW_B] } },
        {
          tool: 'flows_generate',
          then: (p, now) => recordCall(p, { entry: { ...logEntry, id: 'l-0000000b' } }, now),
        },
      ),
    ]);
    expect([a.attempts, b.attempts].sort()).toEqual([1, 2]);
    const p = processIn();
    expect(p.rev).toBe(3);
    expect([...p.ids.flow_ids].sort()).toEqual([FLOW_A, FLOW_B].sort());
    expect(p.log.map((e) => e.id).sort()).toEqual(['l-0000000a', 'l-0000000b']);
  });
});

describe('writeState', () => {
  it('changes two process keys and a top-level field in one write while a parallel write lands', async () => {
    const s = store();
    await s.applyUpdate(NEW_KEY, TOUCH, TOOL);
    await s.applyUpdate(OTHER, TOUCH, TOOL);
    await s.applyUpdate(THIRD, TOUCH, TOOL);
    const [adopt, parallel] = await Promise.all([
      // what adoption after project creation does: _new moves under the project key, bound_project_id set,
      // another process and a cache section change in the same write
      store().writeState((state) => {
        const { [NEW_KEY]: fresh, ...rest } = state.process;
        const other = rest[OTHER];
        if (fresh === undefined || other === undefined) throw new Error('missing process');
        return {
          ...state,
          bound_project_id: PROJECT,
          drafts: { ...state.drafts, d1: { savedAt: NOW, value: 'draft' } },
          process: {
            ...rest,
            [PROJECT]: { ...fresh, ids: { ...fresh.ids, project_id: PROJECT } },
            [OTHER]: { ...other, labels: { [OTHER]: { name: 'other', at: NOW } } },
          },
        };
      }),
      store().applyUpdate(THIRD, { add: { flow_ids: [FLOW_A] } }, TOOL),
    ]);
    expect([adopt.attempts, parallel.attempts].sort()).toEqual([1, 2]);
    expect(adopt.written).toBe(true);
    const file = JSON.parse(fileText()) as {
      bound_project_id?: string;
      drafts: Record<string, unknown>;
      process: Record<string, Process>;
    };
    expect(file.bound_project_id).toBe(PROJECT);
    expect(file.drafts).toEqual({ d1: { savedAt: NOW, value: 'draft' } });
    expect(Object.keys(file.process).sort()).toEqual([OTHER, PROJECT, THIRD].sort());
    // every changed process key got a new rev, the parallel write kept its effect
    expect(file.process[PROJECT]).toMatchObject({ rev: 2, ids: { project_id: PROJECT } });
    expect(file.process[OTHER]).toMatchObject({ rev: 2, labels: { [OTHER]: { name: 'other' } } });
    expect(file.process[THIRD]).toMatchObject({ rev: 2, ids: { flow_ids: [FLOW_A] } });
  });

  it('a change that edits the state in place never brings a secret into the file', async () => {
    const s = store();
    await s.applyUpdate(PROJECT, TOUCH, TOOL);
    try {
      await s.writeState((state) => {
        state.suggestions.k = { savedAt: NOW, value: { text: CANARY } };
        return { ...state };
      });
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
    }
    assertNoCanary(fileText());
  });

  it('a process edited in place is refused: it would skip the rev and the secret filter', async () => {
    const s = store();
    await s.applyUpdate(PROJECT, TOUCH, TOOL);
    const before = readFileSync(statePath());
    await expect(
      s.writeState((state) => {
        state.process[PROJECT]?.ids.flow_ids.push(FLOW_A);
        return { ...state };
      }),
    ).rejects.toThrow(TypeError);
    expect(readFileSync(statePath()).equals(before)).toBe(true);
  });

  it('a field the change leaves out is removed from the file; an unknown field of the file stays', async () => {
    const s = store();
    await s.applyUpdate(PROJECT, TOUCH, TOOL);
    await s.writeState((state) => ({ ...state, bound_project_id: PROJECT }));
    const raw = JSON.parse(fileText()) as Record<string, unknown>;
    writeFileSync(statePath(), JSON.stringify({ ...raw, extra: 1 }));
    await s.writeState((state) => {
      const rest = { ...state };
      delete rest.bound_project_id;
      return rest;
    });
    const file = JSON.parse(fileText()) as Record<string, unknown>;
    expect(file.bound_project_id).toBeUndefined();
    expect(file.extra).toBe(1);
  });

  it('a cache write between our read and our lock: a second attempt, the process rev moves by one', async () => {
    const s = store();
    await s.applyUpdate(PROJECT, TOUCH, TOOL);
    // a cache writer holds the lock while our write reads the file and computes
    const held = tryAcquire(statePath());
    if (held === undefined) throw new Error('not acquired');
    const pending = s.applyUpdate(PROJECT, { add: { flow_ids: [FLOW_A] } }, TOOL);
    const raw = JSON.parse(fileText()) as Record<string, unknown>;
    writeFileSync(
      statePath(),
      JSON.stringify({ ...raw, drafts: { d1: { savedAt: NOW, value: 'x' } } }),
    );
    await releaseLock(held);
    const result = await pending;
    expect(result.attempts).toBe(2);
    expect(result.process.rev).toBe(2);
    const file = JSON.parse(fileText()) as { drafts: Record<string, unknown> };
    expect(file.drafts).toEqual({ d1: { savedAt: NOW, value: 'x' } });
    expect(processIn()).toMatchObject({ rev: 2, ids: { flow_ids: [FLOW_A] } });
  });

  it('returning the same state writes nothing; a secret in a cache section is masked', async () => {
    const s = store();
    await s.applyUpdate(PROJECT, TOUCH, TOOL);
    const before = readFileSync(statePath());
    const same = await s.writeState((state) => state);
    expect(same.written).toBe(false);
    expect(readFileSync(statePath()).equals(before)).toBe(true);
    await s.writeState((state) => ({
      ...state,
      suggestions: { [`k-${CANARY}`]: { savedAt: NOW, value: { text: CANARY } } },
    }));
    assertNoCanary(fileText());
    expect(processIn().rev).toBe(1);
  });
});

describe('file lock', () => {
  function plantLock(owner: { pid: number; at: number; host?: string }): string {
    mkdirSync(join(root, 'loadcraft', '.cache'), { recursive: true });
    const text = JSON.stringify({ token: 'other', host: hostname(), ...owner });
    writeFileSync(lockPath(), text);
    return text;
  }

  it('takes over a lock whose process no longer exists', async () => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    if (dead === undefined) throw new Error('no pid');
    plantLock({ pid: dead, at: Date.now() });
    // a fresh lock: only the pid can tell it is dead (the time limit is far away)
    const result = await store({ lock: { timeoutMs: 10_000, staleMs: 600_000 } }).applyUpdate(
      PROJECT,
      TOUCH,
      TOOL,
    );
    expect(result.written).toBe(true);
    expect(existsSync(lockPath())).toBe(false);
  });

  it('waits for the lock of a live process until the limit, then fails without touching anything', async () => {
    const text = plantLock({ pid: process.ppid, at: Date.now() });
    const started = Date.now();
    const error = await rejection(
      store({ lock: { timeoutMs: 300, staleMs: 600_000 } }).applyUpdate(PROJECT, TOUCH, TOOL),
    );
    expect(error.code).toBe('state_locked');
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(readFileSync(lockPath(), 'utf8')).toBe(text);
    expect(existsSync(statePath())).toBe(false);
  });

  it('takes over the lock of a live pid once it is older than the stale limit (the pid was reused)', async () => {
    plantLock({ pid: process.ppid, at: Date.now() - 120_000 });
    const result = await store({ lock: { timeoutMs: 60_000, staleMs: 30_000 } }).applyUpdate(
      PROJECT,
      TOUCH,
      TOOL,
    );
    expect(result.written).toBe(true);
    expect(existsSync(lockPath())).toBe(false);
  });

  it('takes over an unreadable lock file only when its file is older than the stale limit', async () => {
    mkdirSync(join(root, 'loadcraft', '.cache'), { recursive: true });
    writeFileSync(lockPath(), '');
    const fresh = await rejection(
      store({ lock: { timeoutMs: 200, staleMs: 30_000 } }).applyUpdate(PROJECT, TOUCH, TOOL),
    );
    expect(fresh.code).toBe('state_locked');
    const past = (Date.now() - 120_000) / 1000;
    utimesSync(lockPath(), past, past);
    const result = await store({ lock: { timeoutMs: 60_000, staleMs: 30_000 } }).applyUpdate(
      PROJECT,
      TOUCH,
      TOOL,
    );
    expect(result.written).toBe(true);
  });

  // Two processes find the same dead lock. The step of the other one is put between our check of the dead
  // lock and our removal of it: it must not end with both of us holding the lock.
  it('two takeovers of one dead lock: the other step between our check and our removal leaves one owner', () => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    if (dead === undefined) throw new Error('no pid');
    plantLock({ pid: dead, at: Date.now() });
    const options = { staleMs: 600_000 };
    let other: LockHandle | undefined | null = null;
    const ours = tryAcquire(statePath(), {
      ...options,
      fs: {
        ...fs,
        unlinkSync: (path: PathLike) => {
          if (path === lockPath() && other === null) other = tryAcquire(statePath(), options);
          fs.unlinkSync(path);
        },
      },
    });
    const holders = [ours, other].filter((h): h is LockHandle => h !== undefined && h !== null);
    expect(holders).toHaveLength(1);
    expect(fs.readFileSync(lockPath(), 'utf8')).toContain(holders[0]?.token);
  });

  // We hold a lock long enough to be judged dead; another process takes it over right between our check
  // that the lock is still ours and our removal: our release must not delete the new owner's lock.
  it('a release does not remove the lock of a process that took it over in the meantime', async () => {
    mkdirSync(join(root, 'loadcraft', '.cache'), { recursive: true });
    // our lock was taken a minute ago: by now the others judge it dead
    const ours = tryAcquire(statePath(), { now: () => Date.now() - 60_000 });
    if (ours === undefined) throw new Error('not acquired');
    const stale = { staleMs: 1_000 };
    let other: LockHandle | undefined | null = null;
    await releaseLock(ours, {
      fs: {
        ...fs,
        unlinkSync: (path: PathLike) => {
          if (path === lockPath() && other === null) other = tryAcquire(statePath(), stale);
          fs.unlinkSync(path);
        },
      },
    });
    const taken = other as LockHandle | undefined | null;
    if (taken !== undefined && taken !== null) {
      expect(fs.readFileSync(lockPath(), 'utf8')).toContain(taken.token);
    } else {
      expect(existsSync(lockPath())).toBe(false);
    }
  });
});
