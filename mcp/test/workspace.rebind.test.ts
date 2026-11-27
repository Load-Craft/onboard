// Moving the process kept under '_new' (card, log, operations written before a project exists) under the
// project key. Every test runs on a real state file in a temporary workspace.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { LIMITS, NEW_KEY, type Process } from '../src/workspace/processState.js';
import { createProcessStore, type ProcessStore } from '../src/workspace/reducer.js';
import { bindProject, forgetProjects } from '../src/workspace/rebind.js';
import { CallSecretScope } from '../src/workspace/secrets.js';
import { CANARY, assertNoCanary } from './helpers/canary.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER = '77777777-7777-4777-8777-777777777777';
const FLOW = '22222222-2222-4222-8222-222222222222';
const NOW_MS = Date.parse('2026-03-01T12:00:00.000Z');
const at = (minutes: number): string => new Date(NOW_MS + minutes * 60_000).toISOString();
const TOOL = { tool: 'test_tool' };
const TOUCH = { checks: { project: { created: { ok: true } } } } as const;

const roots: string[] = [];
function workspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lc-rebind-')));
  roots.push(dir);
  return dir;
}
let root: string;
beforeEach(() => {
  root = workspace();
});
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function open(dir: string): ProcessStore {
  const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
  return createProcessStore(dir, { secrets, clock: { now: () => NOW_MS } });
}
const file = (dir: string): { bound_project_id?: string; process: Record<string, Process> } =>
  JSON.parse(readFileSync(join(dir, 'loadcraft', '.cache', 'state.json'), 'utf8')) as {
    bound_project_id?: string;
    process: Record<string, Process>;
  };

const entry = (id: string, minutes: number, tool = 'project_create') => ({
  id,
  at: at(minutes),
  ms: 3,
  module: 'project' as const,
  tool,
  level: 2 as const,
  effect: 'write' as const,
  origin: 'model' as const,
  args: '',
  result: 'ok',
  status: 'ok' as const,
  has_detail: false,
});
const card = (id: string) => ({
  id,
  kind: 'consent' as const,
  level: 2 as const,
  module: 'project' as const,
  origin: 'model' as const,
  title: 'Create the project',
  fields: [],
  calls: [
    {
      n: 1,
      tool: 'project_create',
      title: 'Create the project',
      fields: [],
      args: { name: 'shop' },
      deferred: [],
      args_hash: 'h1',
      effect: 'write' as const,
      reversible: 'yes' as const,
      status: 'running' as const,
    },
  ],
  reversible: 'yes' as const,
  warnings: [],
  status: 'running' as const,
  created_at: at(0),
});
const operation = (handle: string, minutes: number) => ({
  handle,
  kind: 'record_run' as const,
  module: 'run' as const,
  tool: 'run_start',
  status: 'running' as const,
  started_at: at(minutes),
  updated_at: at(minutes),
});

/** Writes a card, a log entry and an operation under '_new', as the first call in an empty directory does. */
async function writeBeforeProject(store: ProcessStore): Promise<void> {
  await store.write(NEW_KEY, (p) => ({
    ...p,
    pending: [card('p-0000000a')],
    log: [entry('l-0000000a', 1)],
    operations: [operation('record_run:aaa', 1)],
  }));
}

describe('bindProject', () => {
  it('reads the card back from an empty directory, then moves it under the project key in one write', async () => {
    const store = open(root);
    await writeBeforeProject(store);
    const before = file(root);
    expect(Object.keys(before.process)).toEqual([NEW_KEY]);
    expect(before.bound_project_id).toBeUndefined();
    const written = before.process[NEW_KEY];

    const result = await bindProject(store, PROJECT);
    expect(result).toMatchObject({ written: true, attempts: 1 });

    const after = file(root);
    expect(after.bound_project_id).toBe(PROJECT);
    expect(Object.keys(after.process)).toEqual([PROJECT]);
    const moved = after.process[PROJECT];
    expect(moved?.ids.project_id).toBe(PROJECT);
    expect(moved?.pending).toEqual(written?.pending);
    expect(moved?.log).toEqual(written?.log);
    expect(moved?.operations).toEqual(written?.operations);
    expect(moved?.rev).toBe((written?.rev ?? 0) + 1);
  });

  it('is idempotent: a second call writes nothing', async () => {
    const store = open(root);
    await writeBeforeProject(store);
    await bindProject(store, PROJECT);
    const text = readFileSync(join(root, 'loadcraft', '.cache', 'state.json'), 'utf8');
    const again = await bindProject(store, PROJECT);
    expect(again.written).toBe(false);
    expect(readFileSync(join(root, 'loadcraft', '.cache', 'state.json'), 'utf8')).toBe(text);
  });

  it('writes nothing when there is no process under _new', async () => {
    const store = open(root);
    await store.applyUpdate(PROJECT, TOUCH, TOOL);
    const result = await bindProject(store, PROJECT);
    expect(result.written).toBe(false);
    expect(file(root).bound_project_id).toBeUndefined();
  });

  it('merges into a process that already exists under the project key, keeping the log in time order', async () => {
    const store = open(root);
    await store.write(PROJECT, (p) => ({
      ...p,
      log: [entry('l-00000001', 0, 'flows_save'), entry('l-00000003', 5, 'flows_save')],
      operations: [operation('record_run:bbb', 2)],
      pending: [{ ...card('p-0000000b'), status: 'done' as const, resolved_at: at(3) }],
    }));
    await store.write(NEW_KEY, (p) => ({
      ...p,
      log: [entry('l-00000002', 2), entry('l-00000004', 6)],
      operations: [operation('record_run:aaa', 1)],
      pending: [card('p-0000000a')],
    }));
    const projectRev = file(root).process[PROJECT]?.rev ?? 0;

    const result = await bindProject(store, PROJECT);
    expect(result.written).toBe(true);

    const after = file(root);
    expect(Object.keys(after.process)).toEqual([PROJECT]);
    const merged = after.process[PROJECT];
    expect(merged?.log.map((e) => e.id)).toEqual([
      'l-00000001',
      'l-00000002',
      'l-00000003',
      'l-00000004',
    ]);
    expect(merged?.operations.map((o) => o.handle).sort()).toEqual([
      'record_run:aaa',
      'record_run:bbb',
    ]);
    expect(merged?.pending.map((c) => c.id).sort()).toEqual(['p-0000000a', 'p-0000000b']);
    expect(merged?.rev).toBe(projectRev + 1);
    expect(after.bound_project_id).toBe(PROJECT);
  });

  it('keeps another key written in parallel and moves _new in the same single write', async () => {
    const store = open(root);
    await writeBeforeProject(store);
    await store.applyUpdate(OTHER, TOUCH, TOOL);
    const [moved, parallel] = await Promise.all([
      bindProject(open(root), PROJECT),
      open(root).applyUpdate(OTHER, { add: { flow_ids: [FLOW] } }, TOOL),
    ]);
    expect([moved.attempts, parallel.attempts].sort()).toEqual([1, 2]);
    const after = file(root);
    expect(Object.keys(after.process).sort()).toEqual([OTHER, PROJECT].sort());
    expect(after.process[OTHER]?.ids.flow_ids).toEqual([FLOW]);
    expect(after.process[PROJECT]?.pending.map((c) => c.id)).toEqual(['p-0000000a']);
    expect(after.bound_project_id).toBe(PROJECT);
  });

  it('does not leak the state of one workspace into another', async () => {
    const second = workspace();
    mkdirSync(join(second, 'loadcraft'), { recursive: true });
    const first = open(root);
    const other = open(second);
    await writeBeforeProject(first);
    await other.write(NEW_KEY, (p) => ({ ...p, log: [entry('l-0000000z', 9, 'flows_save')] }));
    await bindProject(first, PROJECT);

    expect(file(second).bound_project_id).toBeUndefined();
    expect(Object.keys(file(second).process)).toEqual([NEW_KEY]);
    expect(file(second).process[NEW_KEY]?.log.map((e) => e.id)).toEqual(['l-0000000z']);
    expect(file(root).process[PROJECT]?.log.map((e) => e.id)).toEqual(['l-0000000a']);
  });

  describe('merging into an existing project process', () => {
    const FLOW_2 = '33333333-3333-4333-8333-333333333333';
    const ENV = '55555555-5555-4555-8555-555555555555';
    const ENV_2 = '66666666-6666-4666-8666-666666666666';
    const SCEN = '99999999-9999-4999-8999-999999999999';

    it('keeps ids, choices and checks of _new that the project does not have', async () => {
      const store = open(root);
      await store.write(PROJECT, (p) => ({
        ...p,
        ids: { ...p.ids, project_id: PROJECT, env_id: ENV, flow_ids: [FLOW], dataset_ids: [] },
        choices: { ...p.choices, flows: { method: 'har' } },
        steps: {
          ...p.steps,
          project: {
            ...p.steps.project,
            checks: { created: { ok: true, at: at(1), by: 'project_create' } },
          },
        },
      }));
      await store.write(NEW_KEY, (p) => ({
        ...p,
        ids: {
          env_id: ENV_2,
          docs_id: ENV_2,
          flow_ids: [FLOW_2],
          dataset_ids: [],
          scenario_ids: { [FLOW_2]: SCEN },
        },
        choices: {
          ...p.choices,
          flows: { method: 'description', har_split: true },
          data: { needs_accounts: true },
        },
        steps: {
          ...p.steps,
          project: {
            ...p.steps.project,
            checks: {
              created: { ok: false, at: at(0), by: 'older' },
              env_saved: { ok: true, at: at(2), by: 'x' },
            },
          },
        },
      }));
      await bindProject(store, PROJECT);
      const merged = file(root).process[PROJECT];
      expect(merged?.ids).toMatchObject({
        project_id: PROJECT,
        env_id: ENV,
        docs_id: ENV_2,
        flow_ids: [FLOW, FLOW_2],
        scenario_ids: { [FLOW_2]: SCEN },
      });
      expect(merged?.choices.flows).toEqual({ method: 'har', har_split: true });
      expect(merged?.choices.data).toEqual({ needs_accounts: true });
      expect(merged?.steps.project.checks).toMatchObject({
        created: { ok: true, by: 'project_create' },
        env_saved: { ok: true, by: 'x' },
      });
    });

    it('a newer check of _new replaces an older one of the project', async () => {
      const store = open(root);
      await store.write(PROJECT, (p) => ({
        ...p,
        steps: {
          ...p.steps,
          project: { ...p.steps.project, checks: { created: { ok: false, at: at(0), by: 'a' } } },
        },
      }));
      await store.write(NEW_KEY, (p) => ({
        ...p,
        steps: {
          ...p.steps,
          project: { ...p.steps.project, checks: { created: { ok: true, at: at(4), by: 'b' } } },
        },
      }));
      await bindProject(store, PROJECT);
      expect(file(root).process[PROJECT]?.steps.project.checks.created).toMatchObject({
        ok: true,
        by: 'b',
      });
    });

    it('does not duplicate a log entry present on both sides', async () => {
      const store = open(root);
      await store.write(PROJECT, (p) => ({ ...p, log: [entry('l-00000001', 0)] }));
      await store.write(NEW_KEY, (p) => ({
        ...p,
        log: [entry('l-00000001', 0), entry('l-00000002', 1)],
      }));
      await bindProject(store, PROJECT);
      expect(file(root).process[PROJECT]?.log.map((e) => e.id)).toEqual([
        'l-00000001',
        'l-00000002',
      ]);
    });

    it('merges two live cards with the same call into one, covers joined', async () => {
      const withCovers = (id: string, tools: string[], calls_left: number) => ({
        ...card(id),
        covers: { tools, calls_left, ttl_min: 10 },
      });
      const store = open(root);
      await store.write(PROJECT, (p) => ({
        ...p,
        pending: [withCovers('p-0000000b', ['flows_save', 'env_save'], 2)],
      }));
      await store.write(NEW_KEY, (p) => ({
        ...p,
        pending: [withCovers('p-0000000a', ['env_save', 'docs_save'], 4)],
      }));
      await bindProject(store, PROJECT);
      const pending = file(root).process[PROJECT]?.pending ?? [];
      expect(pending.map((c) => c.id)).toEqual(['p-0000000b']);
      expect(pending[0]?.covers?.tools.sort()).toEqual(['docs_save', 'env_save', 'flows_save']);
      expect(pending[0]?.covers?.calls_left).toBe(4);
    });

    it('succeeds when the live cards of both sides exceed the limit: the oldest of _new are dropped and noted', async () => {
      const many = (prefix: string, count: number, minutes: number) =>
        Array.from({ length: count }, (_, i) => ({
          ...card(`p-${prefix}${String(i).padStart(6, '0')}`),
          calls: card('x').calls.map((call) => ({ ...call, args_hash: `${prefix}${String(i)}` })),
          created_at: at(minutes + i),
        }));
      const store = open(root);
      await store.write(PROJECT, (p) => ({ ...p, pending: many('b', 30, 10) }));
      await store.write(NEW_KEY, (p) => ({ ...p, pending: many('a', 30, 0) }));
      const result = await bindProject(store, PROJECT);
      expect(result.written).toBe(true);
      const after = file(root);
      expect(Object.keys(after.process)).toEqual([PROJECT]);
      const merged = after.process[PROJECT];
      expect(merged?.pending).toHaveLength(LIMITS.pending);
      // the project's cards stay; the 10 oldest of _new are gone
      expect(merged?.pending.filter((c) => c.id.startsWith('p-b'))).toHaveLength(30);
      expect(merged?.pending.some((c) => c.id === 'p-a000000')).toBe(false);
      expect(merged?.pending.some((c) => c.id === 'p-a000029')).toBe(true);
      expect(merged?.problems.find((pr) => pr.code === 'rebind_cards_dropped')?.message).toContain(
        '10',
      );
    });
  });

  describe('the steps after the merge are those of the merged checks and problems', () => {
    const check = (minutes: number) => ({ ok: true, at: at(minutes), by: 'project_create' });

    it('checks of _new that complete the project step: the step is done and the process moves to flows', async () => {
      const store = open(root);
      await store.applyUpdate(PROJECT, TOUCH, { tool: 'project_create' });
      await store.write(NEW_KEY, (p) => ({
        ...p,
        steps: {
          ...p.steps,
          project: {
            ...p.steps.project,
            checks: { env_saved: check(1), env_checked: check(1), setup_applied: check(1) },
          },
        },
      }));
      expect(file(root).process[PROJECT]?.step).toBe('project');
      await bindProject(store, PROJECT);
      const merged = file(root).process[PROJECT];
      expect(merged?.steps.project.status).toBe('done');
      expect(merged?.step).toBe('flows');
      // the move settles the steps without warnings of its own
      expect(merged?.problems.map((x) => x.code)).toEqual([]);
    });

    it('an open blocker of _new blocks the step of the project it joins', async () => {
      const store = open(root);
      await store.applyUpdate(
        PROJECT,
        {
          checks: {
            project: {
              created: { ok: true },
              env_saved: { ok: true },
              env_checked: { ok: true },
              setup_applied: { ok: true },
            },
          },
        },
        { tool: 'project_create' },
      );
      expect(file(root).process[PROJECT]?.step).toBe('flows');
      await store.write(NEW_KEY, (p) => ({
        ...p,
        problems: [
          {
            id: 'pr-00000001',
            module: 'project',
            tool: 'project_check_env',
            code: 'env_unreachable',
            severity: 'blocker',
            message: 'The environment does not answer.',
            at: at(1),
          },
        ],
      }));
      await bindProject(store, PROJECT);
      const merged = file(root).process[PROJECT];
      expect(merged?.steps.project.status).toBe('blocked');
      expect(merged?.step).toBe('project');
    });
  });

  it('masks a secret that sat in _new when the state is moved', async () => {
    const plain = open(root);
    await plain.write(NEW_KEY, (p) => ({
      ...p,
      log: [{ ...entry('l-0000000a', 1), result: `token ${CANARY}` }],
    }));
    expect(readFileSync(join(root, 'loadcraft', '.cache', 'state.json'), 'utf8')).toContain(CANARY);
    const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
    secrets.add(CANARY);
    const guarded = createProcessStore(root, { secrets, clock: { now: () => NOW_MS } });
    await bindProject(guarded, PROJECT);
    assertNoCanary(readFileSync(join(root, 'loadcraft', '.cache', 'state.json'), 'utf8'));
  });
});

describe('forgetProjects: the processes of deleted projects leave the file', () => {
  it('drops the deleted processes, unbinds only from a deleted project, and writes nothing twice', async () => {
    const dir = workspace();
    const store = open(dir);
    await store.applyUpdate(PROJECT, TOUCH, TOOL);
    await store.applyUpdate(OTHER, TOUCH, { ...TOOL, bound: OTHER });
    await store.applyUpdate(NEW_KEY, TOUCH, TOOL);

    await forgetProjects(store, [PROJECT]);
    expect(Object.keys(file(dir).process).sort()).toEqual([NEW_KEY, OTHER].sort());
    expect(file(dir).bound_project_id).toBe(OTHER);

    await forgetProjects(store, [OTHER]);
    expect(Object.keys(file(dir).process)).toEqual([NEW_KEY]);
    expect(file(dir).bound_project_id).toBeUndefined();

    const again = await forgetProjects(store, [OTHER, PROJECT]);
    expect(again.written).toBe(false);
  });
});
