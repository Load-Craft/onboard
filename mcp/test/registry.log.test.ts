// The log of calls is written by the registration layer, not by the tools: every tool of the
// registry leaves an entry in the state file after a success and after a failure. The summary of
// the arguments and of the result comes from the tool's log template in the catalog, registered
// secrets are masked, a read has no `undo`, and a write gets the first undo way of the catalog.
// The registry walked here is today's (`LEGACY_TOOLS`); the test of each tool of a module checks
// the entry of that tool.

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CURRENT_CHANGE,
  CURRENT_KIND,
  CURRENT_TO_TOOLS,
  LOG_META,
} from '../src/catalog.generated.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import type { ToolOutcome } from '../src/outcome.js';
import { registerTools, type Tool } from '../src/registry.js';
import { createServices } from '../src/server.js';
import { LEGACY_TOOLS } from '../src/tools/index.js';
import { fillTemplate, logToolOf } from '../src/workspace/logEntry.js';
import { NEW_KEY } from '../src/workspace/processState.js';
import { createProcessStore } from '../src/workspace/reducer.js';
import { startFake, type Fake } from './fake-backend/server.js';
import { BACKEND_CANARY, CANARY, FILE_CANARY, leakedPieces } from './helpers/canary.js';
import { createTestClock } from './helpers/clock.js';
import { connect, type McpSession } from './helpers/mcp.js';

const START = Date.parse('2026-11-26T10:00:00Z');

/** Arguments that pass the input schema of each of today's tools. */
const ARGS: Readonly<Record<string, Record<string, unknown>>> = {
  process_get_status: {},
  flows_generate_from_suggestions: { suggestions: ['checkout'] },
  flows_generate_from_endpoints: {
    name: 'checkout',
    description: 'browse the shop and buy one item',
    endpoints: ['GET /api/orders'],
  },
  flows_generate_from_har: { har: 'loadcraft/shop.har', split: false, name: 'checkout' },
  scenario_suggest_split: { name: 'checkout', flows: ['checkout'] },
  scenario_generate: { name: 'checkout', flows: ['checkout'], proportions: { checkout: 100 } },
  flows_describe_journeys: { description: 'browse the shop and buy one item', environment: 'perf' },
  results_analyze_run: { execution: 'run-1' },
  results_get_report: { execution: 'run-1' },
  results_get_errors: { execution: 'run-1' },
  results_get_traces: { execution: 'run-1' },
  flows_import_har: { file: 'loadcraft/missing.har' },
  project_create: { name: 'shop', environment: { name: 'perf', api: 'api.perf.example.com' } },
  project_save_env: {
    environments: [{ name: 'perf', api: 'api.perf.example.com', default: true }],
  },
  project_check_env: {},
  project_analyze_setup: { description: 'a shop' },
  project_apply_setup: {},
  project_get: {},
  project_set_profile: { fields: { app_architecture: 'spa' } },
  project_delete: { kind: 'project', ids: ['5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61'] },
  flows_delete: { kind: 'flow', flow_ids: ['a7d2e914-3c5b-4e8f-b061-9f4c2d7e8a35'] },
  run_plan: { scenario: 'checkout', environment: 'perf', target_users: 10 },
  data_suggest_actions: { scenario: 'checkout' },
  data_check_readiness: { scenario: 'checkout' },
  data_set_bindings: { scenario: 'checkout', bindings: {} },
  data_create_dataset: { scenario: 'checkout', slot: 'coupons' },
  data_create_accounts: { scenario: 'checkout', slot: 'buyer', count: 2 },
  flows_record_journeys: { plan: 'plan-1' },
  run_start: {
    scenario: 'checkout',
    environment: 'perf',
    profile: { type: 'ramp_concurrency', vusers: 10, ramp: 60 },
  },
  project_connect_telemetry: { label: 'shop-logs', url: 'https://logs.example.com/mcp' },
  flows_suggest_journeys: {},
  scenario_check_self: { scenarios: ['checkout'] },
  project_import_docs: { openapi: 'loadcraft/openapi.json' },
  flows_migrate_docs: { preview: true },
  process_wait: { operation: 'flow_generation:00000000-0000-4000-8000-000000000001' },
  process_cancel: {},
};

/** Tools of the catalog that no tool of the first version became: they carry their catalog name. */
const ADDED: readonly string[] = [
  'flows_migrate_docs',
  'project_get',
  'project_set_profile',
  'project_delete',
  'flows_delete',
  'results_get_errors',
  'results_get_traces',
];

/** Arguments of the failing call where the ones above succeed in an unbound workspace. */
const FAIL_ARGS: Readonly<Record<string, Record<string, unknown>>> = {
  process_get_status: { project: 'shop' },
};

interface Entry {
  id: string;
  tool: string;
  module: string;
  level: number;
  effect: string;
  origin: string;
  args: string;
  result: string;
  status: string;
  error_code?: string;
  link?: string;
  handle?: string;
  has_detail?: boolean;
  undo?: { tool: string; args: Record<string, unknown>; level: number; note?: string };
}

interface ProcessFile {
  rev: number;
  log: Entry[];
  reads: Entry[];
  reads_total: number;
}

type Mode = 'real' | 'done' | 'running' | 'hang' | 'secret';

interface Bench {
  readonly session: McpSession;
  readonly fake: Fake;
  readonly workspace: string;
  readonly lines: string[];
  /**
   * How the next call of every tool runs (`mode`: the real tool, a finished or running outcome, or
   * a call that waits for its cancellation), the data of the finished outcome, and how many calls
   * entered the waiting mode.
   */
  readonly control: { mode: Mode; data: Record<string, unknown>; entered: number };
  process(key?: string): ProcessFile;
  details(): Record<string, { value: { request: string; response: string }; truncated?: true }>;
  stateText(): string;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * The real registry (`registerTools`) with the log enabled, over the real definitions of today's
 * tools. In mode `real` a call runs the tool itself against the fake backend in an unbound
 * workspace, where each one fails; the other modes stand in for a successful run, which the log
 * reads only through the outcome.
 */
async function bench(tools: readonly Tool[] = LEGACY_TOOLS): Promise<Bench> {
  const clock = createTestClock(START);
  const fake = await startFake({ clock, scope: 'manual' });
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'lc-registry-log-')));
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  const config = loadConfig(
    { LOADCRAFT_API_URL: `${fake.url}/api/v1`, LOADCRAFT_API_TOKEN: fake.token },
    workspace,
  );
  log.registerSecret(config.token.reveal());
  const services = createServices(config, log);
  const control: Bench['control'] = { mode: 'real', data: {}, entered: 0 };
  const wrapped = tools.map((tool): Tool => ({
    ...tool,
    async invoke(ctx, args) {
      if (control.mode === 'real') return tool.invoke(ctx, args);
      if (control.mode === 'secret') {
        // the tool learns two secrets during the call: a password it was given and a token the
        // backend returned; only then are they registered in the scope of the call
        ctx.secrets.add(FILE_CANARY);
        ctx.secrets.add(BACKEND_CANARY);
        return {
          outcome: { status: 'done', data: { name: `shop ${BACKEND_CANARY}` } },
          text: 'ok',
        };
      }
      if (control.mode === 'hang') {
        control.entered += 1;
        await new Promise<void>((resolve) => {
          ctx.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new Error('aborted');
      }
      const outcome: ToolOutcome<unknown> =
        control.mode === 'done'
          ? {
              status: 'done',
              data: ctx.secrets.scrubDeep(control.data),
              links: [services.links.flow('00000000-0000-4000-8000-0000000000aa', 'f-1')],
            }
          : {
              status: 'running',
              operation: 'flow_generation:00000000-0000-4000-8000-0000000000bb',
              data: { message: 'generating' },
            };
      return { outcome, text: 'ok' };
    },
  }));
  const session = await connect(() => {
    const server = new McpServer(
      { name: 'loadcraft', version: '0.0.0' },
      { capabilities: { tools: {} } },
    );
    registerTools(server, wrapped, { config, log, services, clock, journal: createProcessStore });
    return server;
  });
  cleanups.push(() => rmSync(workspace, { recursive: true, force: true }));
  cleanups.push(async () => {
    await session.close();
    fake.takeViolations();
    fake.takeErrors();
    await fake.close();
  });
  const statePath = join(workspace, 'loadcraft', '.cache', 'state.json');
  return {
    session,
    fake,
    workspace,
    lines,
    control,
    stateText: () => readFileSync(statePath, 'utf8'),
    details() {
      const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as {
        logDetails: Record<
          string,
          { value: { request: string; response: string }; truncated?: true }
        >;
      };
      return parsed.logDetails;
    },
    process(key = NEW_KEY) {
      const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as {
        process: Record<string, ProcessFile>;
      };
      const process = parsed.process[key];
      if (process === undefined) throw new Error(`no process under ${key}`);
      return process;
    },
  };
}

/** The tools the project setup split into, with the one of them whose call is not a server tool. */
const SETUP_SPLIT = Object.entries(CURRENT_TO_TOOLS).find(([, ways]) =>
  (ways as readonly string[]).includes('project_analyze_setup'),
);
const SETUP_TOOLS = [
  'project_create',
  'project_save_env',
  'project_check_env',
  'project_analyze_setup',
  'project_apply_setup',
];

/** The catalog tool whose log metadata an entry of `tool` called with `args` uses. */
function metaOf(
  tool: string,
  args: Record<string, unknown>,
): (typeof LOG_META)[keyof typeof LOG_META] {
  const name = logToolOf(tool, args);
  if (name === undefined) throw new Error(`${tool} has no catalog entry`);
  return LOG_META[name];
}

function effectOf(tool: string, args: Record<string, unknown>): string {
  return metaOf(tool, args).class.split('+')[0] ?? '';
}

const argsOf = (tool: string): Record<string, unknown> => ARGS[tool] ?? {};
const failArgsOf = (tool: string): Record<string, unknown> => FAIL_ARGS[tool] ?? argsOf(tool);

describe('log of calls: every tool of the registry', () => {
  it('finds the catalog entry of each of the 36 tools of today among its ways in the migration map', () => {
    expect(LEGACY_TOOLS).toHaveLength(36);
    const map = CURRENT_TO_TOOLS as Readonly<Record<string, readonly string[]>>;
    // A tool renamed 1:1 already carries its catalog name: the map holds it under its old name.
    const renamedTo = (name: string): boolean =>
      Object.entries(map).some(
        ([old, ways]) =>
          ['rename', 'rename_and_role'].includes(
            CURRENT_CHANGE[old as keyof typeof CURRENT_CHANGE],
          ) && ways[0] === name,
      );
    // A tool split off an old one carries its catalog name: one of the ways of the old name.
    const splitFrom = (name: string): boolean =>
      Object.entries(map).some(
        ([old, ways]) =>
          CURRENT_CHANGE[old as keyof typeof CURRENT_CHANGE] === 'split' && ways.includes(name),
      );
    for (const tool of LEGACY_TOOLS) {
      const ways =
        map[tool.name] ??
        (renamedTo(tool.name) || splitFrom(tool.name) || ADDED.includes(tool.name)
          ? [tool.name]
          : undefined);
      expect(ways, tool.name).toBeDefined();
      expect(ways, tool.name).toContain(logToolOf(tool.name, {}));
    }
    // the old setup name keeps its main way for an entry written before the split
    expect(SETUP_SPLIT).toBeDefined();
    expect(logToolOf(SETUP_SPLIT?.[0] ?? '', {})).toBe('project_create');
    for (const name of SETUP_TOOLS) {
      expect(SETUP_SPLIT?.[1], name).toContain(name);
      expect(logToolOf(name, {}), name).toBe(name);
    }
    // helper files of the map (kind `helper`) are not tools: no entry, whatever their change says
    const helpers = Object.entries(CURRENT_KIND)
      .filter(([, kind]) => kind === 'helper')
      .map(([name]) => name);
    expect(helpers.sort()).toEqual(['operationKinds', 'recordWalk']);
    for (const name of helpers) expect(logToolOf(name, {}), name).toBeUndefined();
    for (const [name, kind] of Object.entries(CURRENT_KIND)) {
      if (kind === 'tool')
        expect(CURRENT_CHANGE[name as keyof typeof CURRENT_CHANGE], name).not.toBe('library');
    }
    // a tool that already carries its catalog name keeps it; a name in neither has no entry
    expect(logToolOf('flows_get', {})).toBe('flows_get');
    expect(logToolOf('helper_probe', {})).toBeUndefined();
  });

  it('leaves 72 entries after a success and a failure of each of the 36 tools; no read entry has undo', async () => {
    const b = await bench();
    for (const tool of LEGACY_TOOLS) {
      b.control.mode = 'done';
      const ok = await b.session.call(tool.name, argsOf(tool.name));
      expect(ok.isError, `${tool.name} in mode done: ${ok.text}`).toBe(false);
      b.control.mode = 'real';
      const failed = await b.session.call(tool.name, failArgsOf(tool.name));
      expect(failed.isError, `${tool.name} should fail unbound: ${failed.text}`).toBe(true);
    }
    const p = b.process();
    const entries = [...p.log, ...p.reads];
    expect(entries).toHaveLength(72);
    expect(p.rev).toBe(72);
    for (const tool of LEGACY_TOOLS) {
      const own = entries.filter((e) => e.tool === tool.name);
      expect(own.map((e) => e.status).sort(), tool.name).toEqual(['error', 'ok']);
      for (const e of own) {
        const args = e.status === 'ok' ? argsOf(tool.name) : failArgsOf(tool.name);
        expect(e.effect, tool.name).toBe(effectOf(tool.name, args));
        expect(e.origin).toBe('model');
        expect(e.module).toBe(metaOf(tool.name, args).module);
        expect(e.level).toBe(metaOf(tool.name, args).level);
        // a slot the arguments of today's tool do not fill gives a summary of the arguments
        expect(`${e.args} | ${e.result}`, tool.name).not.toContain('?');
      }
      const failed = own.find((e) => e.status === 'error');
      expect(failed?.error_code, tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
    // a successful read goes to the ring of reads; everything else to the log
    expect(p.reads.every((e) => e.effect === 'read' && e.status === 'ok')).toBe(true);
    expect(p.reads).toHaveLength(
      LEGACY_TOOLS.filter((t) => effectOf(t.name, argsOf(t.name)) === 'read').length,
    );
    expect(p.reads_total).toBe(p.reads.length);
    for (const e of entries) {
      if (e.effect === 'read') expect(e, `${e.tool} ${e.status}`).not.toHaveProperty('undo');
      if (e.status !== 'ok') expect(e, `${e.tool} ${e.status}`).not.toHaveProperty('undo');
    }
    // the data of these successes names no object: nothing could be undone, so no entry has undo
    expect(entries.filter((e) => e.undo !== undefined)).toEqual([]);
  });
});

describe('log of calls: the five tools of the project setup', () => {
  it('each call has its own entry, with the module, level and effect of its catalog entry', async () => {
    const b = await bench();
    b.control.mode = 'done';
    for (const name of SETUP_TOOLS) {
      const result = await b.session.call(name, argsOf(name));
      expect(result.isError, `${name}: ${result.text}`).toBe(false);
    }
    const entries = b.process().log;
    expect(entries.map((e) => e.tool)).toEqual(SETUP_TOOLS);
    for (const e of entries) {
      const meta = LOG_META[e.tool as keyof typeof LOG_META];
      expect(e.module, e.tool).toBe('project');
      expect(e.level, e.tool).toBe(2);
      expect(meta.level, e.tool).toBe(2);
      expect(e.effect, e.tool).toBe(meta.class.split('+')[0]);
    }
    expect(entries.find((e) => e.tool === 'project_analyze_setup')?.effect).toBe('costly');
  });
});

describe('log of calls: content of an entry', () => {
  it('summarises the arguments and the result from the catalog templates, with the link of the outcome', async () => {
    const b = await bench();
    b.control.mode = 'done';
    b.control.data = { name: 'shop', created: true };
    await b.session.call('project_create', ARGS.project_create ?? {});
    const [entry] = b.process().log;
    expect(entry?.args).toBe('Create project shop');
    expect(entry?.result).toBe('project shop created');
    expect(entry?.link).toBe(
      'https://app.loadcraft.io/projects/00000000-0000-4000-8000-0000000000aa/flows/f-1',
    );
    expect(entry?.id).toMatch(/^l-[0-9a-f]{8}$/);
  });

  it('keeps the handle of an operation still running', async () => {
    const b = await bench();
    b.control.mode = 'running';
    await b.session.call(
      'flows_generate_from_suggestions',
      ARGS.flows_generate_from_suggestions ?? {},
    );
    const [entry] = b.process().log;
    expect(entry?.status).toBe('ok');
    expect(entry?.handle).toBe('flow_generation:00000000-0000-4000-8000-0000000000bb');
  });

  it('records the code and the message of a failure', async () => {
    const b = await bench();
    await b.session.call('project_get', ARGS.project_get ?? {});
    const [entry] = b.process().log;
    expect(entry?.status).toBe('error');
    expect(entry?.error_code).toBe('no_project');
    expect(entry?.result.length).toBeGreaterThan(0);
    expect(b.process().reads).toEqual([]);
  });

  it('masks a secret given in an argument and one returned in the response; the state file never holds it', async () => {
    const b = await bench();
    b.control.mode = 'done';
    b.control.data = { name: `shop ${CANARY}`, created: true };
    await b.session.call('project_create', {
      ...ARGS.project_create,
      name: `shop ${CANARY}`,
    });
    const [entry] = b.process().log;
    expect(entry?.args).toContain('[redacted]');
    expect(entry?.result).toContain('[redacted]');
    expect(b.stateText()).not.toContain(CANARY);
    expect(b.stateText()).not.toContain(CANARY.slice(0, 12));
  });

  it('records a call the client cancelled', async () => {
    const b = await bench();
    b.control.mode = 'hang';
    const abort = new AbortController();
    const call = b.session.call('results_get_report', ARGS.results_get_report ?? {}, {
      signal: abort.signal,
    });
    await vi.waitFor(() => {
      expect(b.control.entered).toBe(1);
    });
    abort.abort();
    await expect(call).rejects.toThrow();
    await vi.waitFor(() => {
      expect(b.process().log.map((e) => e.status)).toEqual(['cancelled']);
    });
  });

  it('a call with format=data writes nothing', async () => {
    const b = await bench();
    b.control.mode = 'done';
    await b.session.call('process_get_status', { format: 'data' });
    expect(() => b.stateText()).toThrow();
  });

  it('a tool without a catalog entry is registered without a log', async () => {
    const [first] = LEGACY_TOOLS;
    if (first === undefined) throw new Error('no tools');
    const helper: Tool = { ...first, name: 'helper_probe' };
    const b = await bench([helper]);
    b.control.mode = 'done';
    const result = await b.session.call('helper_probe', {});
    expect(result.isError).toBe(false);
    expect(() => b.stateText()).toThrow();
  });

  it('a failed write of the log leaves the result of the tool as it was', async () => {
    const b = await bench();
    b.control.mode = 'done';
    // a state file this version does not know: the reducer refuses it
    mkdirSync(join(b.workspace, 'loadcraft', '.cache'), { recursive: true });
    writeFileSync(join(b.workspace, 'loadcraft', '.cache', 'state.json'), '{"schema":99}\n');
    const result = await b.session.call('project_get', ARGS.project_get ?? {});
    expect(result.isError).toBe(false);
    expect(result.text.split('\n')[0]).toBe('ok');
    expect(b.lines.some((line) => line.includes('log entry not saved'))).toBe(true);
  });
});

describe('log of calls: the way of a split tool', () => {
  it('a start is logged under its own entry, a start that only asks for consent as planning', () => {
    const args = ARGS.run_start ?? {};
    expect(logToolOf('run_start', args)).toBe('run_start');
    expect(logToolOf('run_start', args, { status: 'started' })).toBe('run_start');
    expect(logToolOf('run_start', args, { needsConfirmation: true })).toBe('run_plan');
    expect(logToolOf('run_plan', ARGS.run_plan ?? {}, { needsConfirmation: true })).toBe(
      'run_plan',
    );
  });

  it('the data hub suggestion is a costly call in the log', async () => {
    const b = await bench();
    b.control.mode = 'done';
    b.control.data = { ready: false, proposed: [] };
    await b.session.call('data_suggest_actions', { scenario: 'checkout' });
    const p = b.process();
    expect(p.reads).toEqual([]);
    expect(p.log.map((e) => [e.tool, e.effect, e.level])).toEqual([
      ['data_suggest_actions', 'costly', 2],
    ]);
  });

  it('the readiness check of the data is a read: its success goes to the ring of reads', async () => {
    const b = await bench();
    b.control.mode = 'done';
    b.control.data = { ready: true, proposed: [] };
    await b.session.call('data_check_readiness', { scenario: 'checkout' });
    const p = b.process();
    expect(p.log).toEqual([]);
    expect(p.reads.map((e) => [e.tool, e.effect, e.level])).toEqual([
      ['data_check_readiness', 'read', 1],
    ]);
  });
});

describe('log of calls: summary and undo from the result', () => {
  const PROJECT = '00000000-0000-4000-8000-0000000000cc';
  const FLOWS = ['00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2'];

  it('keeps the sentence of the template when a slot has no value: none in its place, no fields of the call', async () => {
    const b = await bench();
    b.control.mode = 'done';
    await b.session.call('flows_describe_journeys', ARGS.flows_describe_journeys ?? {});
    const [entry] = b.process().log;
    expect(entry?.args).toBe('Open none in the backend browser and sign in');
    expect(entry?.args).not.toContain('environment=');
    expect(entry?.args).not.toContain('browse the shop');
  });

  it('a new project can be undone by deleting it; the id comes from the result', async () => {
    const b = await bench();
    b.control.mode = 'done';
    b.control.data = { project: { id: PROJECT, name: 'shop', reused: false } };
    await b.session.call('project_create', ARGS.project_create ?? {});
    const [entry] = b.process().log;
    expect(entry?.undo).toEqual({
      tool: 'project_delete',
      args: { kind: 'project', ids: [PROJECT] },
      level: 3,
      note: 'kind=project',
    });
  });

  it('a project that existed (reused) is not undone by deleting it', async () => {
    const b = await bench();
    b.control.mode = 'done';
    b.control.data = { project: { id: PROJECT, name: 'shop', reused: true } };
    await b.session.call('project_create', ARGS.project_create ?? {});
    const [entry] = b.process().log;
    expect(entry?.status).toBe('ok');
    expect(entry).not.toHaveProperty('undo');
  });

  it('new flows are undone by deleting them by the ids of the result', async () => {
    const b = await bench();
    b.control.mode = 'done';
    b.control.data = { built: FLOWS.map((flowId) => ({ flowId, name: 'checkout' })), failed: [] };
    await b.session.call(
      'flows_generate_from_suggestions',
      ARGS.flows_generate_from_suggestions ?? {},
    );
    const [entry] = b.process().log;
    expect(entry?.undo?.tool).toBe('flows_delete');
    expect(entry?.undo?.args).toEqual({ kind: 'flow', ids: FLOWS });
  });

  it('a load run still running is undone by cancelling its handle', async () => {
    const b = await bench();
    b.control.mode = 'running';
    await b.session.call('run_start', ARGS.run_start ?? {});
    const [entry] = b.process().log;
    expect(entry?.undo?.tool).toBe('process_cancel');
    expect(entry?.undo?.args).toEqual({
      handle: 'flow_generation:00000000-0000-4000-8000-0000000000bb',
    });
  });

  it('a write whose result does not name what to undo has no undo (never empty arguments)', async () => {
    const b = await bench();
    b.control.mode = 'done';
    await b.session.call('project_import_docs', ARGS.project_import_docs ?? {});
    await b.session.call('project_create', ARGS.project_create ?? {});
    const p = b.process();
    expect(p.log.map((e) => e.status)).toEqual(['ok', 'ok']);
    expect(p.log.filter((e) => e.undo !== undefined)).toEqual([]);
  });

  it('masks secrets the tool registers during the call, given in an argument and returned by the backend', async () => {
    const b = await bench();
    b.control.mode = 'secret';
    await b.session.call('project_create', { ...ARGS.project_create, name: `shop ${FILE_CANARY}` });
    const [entry] = b.process().log;
    expect(entry?.args).toContain('[redacted]');
    expect(entry?.result).toContain('[redacted]');
    for (const secret of [FILE_CANARY, BACKEND_CANARY]) {
      expect(leakedPieces(b.stateText(), [secret])).toEqual([]);
      expect(b.stateText()).not.toContain(secret.slice(0, 10));
    }
  });
});

describe('the detail of an entry', () => {
  it('a write keeps its request and response in logDetails, linked by the id, masked', async () => {
    const b = await bench();
    b.control.mode = 'secret';
    await b.session.call('project_create', { ...ARGS.project_create, name: `shop ${FILE_CANARY}` });
    const [entry] = b.process().log;
    expect(entry?.has_detail).toBe(true);
    const detail = entry === undefined ? undefined : b.details()[entry.id];
    expect(detail?.value.request).toContain('shop [redacted]');
    expect(detail?.value.response).toContain('[redacted]');
    for (const secret of [FILE_CANARY, BACKEND_CANARY])
      expect(leakedPieces(b.stateText(), [secret])).toEqual([]);
  });

  it('a read that succeeds has no detail, and the section stays empty', async () => {
    const b = await bench();
    b.control.mode = 'done';
    await b.session.call('process_get_status', {});
    const p = b.process();
    expect(p.log).toEqual([]);
    expect(p.reads.map((e) => e.has_detail)).toEqual([false]);
    expect(b.details()).toEqual({});
  });

  it('a failure keeps the code and text of the error as the response', async () => {
    const b = await bench();
    await b.session.call('process_get_status', { project: 'shop' });
    const [entry] = b.process().log;
    expect(entry?.status).toBe('error');
    expect(entry?.has_detail).toBe(true);
    const detail = entry === undefined ? undefined : b.details()[entry.id];
    expect(detail?.value.request).toContain('shop');
    expect(detail?.value.response).toContain(entry?.error_code ?? 'missing');
  });
});

describe('fillTemplate', () => {
  it.each([
    ['Create project {name}', { name: 'shop' }, 'Create project shop'],
    ['project {name} {created|adopted}', { name: 'shop', adopted: true }, 'project shop adopted'],
    ['project {name} {created|adopted}', { name: 'shop' }, undefined],
    ['{count} journeys proposed', { count: 3 }, '3 journeys proposed'],
    ['{handle}: {status}', {}, undefined],
    ['Delete {kind}: {names}', { kind: 'flow', names: ['a', 'b'] }, 'Delete flow: a, b'],
  ])('%s with %j → %s', (template, values, expected) => {
    expect(fillTemplate(template, values)).toBe(expected);
  });
});
