// The channel of a tool's effect on the process: a tool returns a ProcessUpdate with its outcome, and
// the registry writes it together with the log entry of the call, in one write of the store. The
// reducer stamps and invalidates by the catalog entry of the call (a split tool of today hits the row
// of the table that its way names), and only a call that succeeded is a trigger: an error or a
// cancelled call leaves every check as it was. A write that is refused leaves its cause in the log.

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_TO_TOOLS } from '../src/catalog.generated.js';
import { loadConfig } from '../src/config.js';
import { ToolError } from '../src/errors.js';
import { createLogger } from '../src/log.js';
import type { ToolOutcome } from '../src/outcome.js';
import { defineTool, registerTools, type JournalFactory, type Tool } from '../src/registry.js';
import { createServices } from '../src/server.js';
import { NEW_KEY } from '../src/workspace/processState.js';
import { createProcessStore, type ProcessUpdateInput } from '../src/workspace/reducer.js';
import { CallSecretScope } from '../src/workspace/secrets.js';
import { CANARY } from './helpers/canary.js';
import { createTestClock } from './helpers/clock.js';
import { connect, type McpSession } from './helpers/mcp.js';

const START = Date.parse('2026-11-26T10:00:00Z');

/** Today's name of the tool whose main way is the catalog entry `way`: the test does not spell a name that goes away. */
function todayOf(way: string): string {
  const found = Object.entries(CURRENT_TO_TOOLS).find(([, ways]) => ways[0] === way);
  if (found === undefined) throw new Error(`no tool of today has ${way} as its main way`);
  return found[0];
}
const FLOWS = todayOf('flows_generate_from_suggestions');
const RUN = 'run_start';
const FLOW_A = '00000000-0000-4000-8000-0000000000a1';
const FLOW_B = '00000000-0000-4000-8000-0000000000b2';

interface Check {
  ok: boolean | null;
  by: string;
}
interface ProcessFile {
  rev: number;
  ids: { flow_ids: string[] };
  steps: Record<string, { checks: Record<string, Check | undefined> }>;
  operations: { handle: string; status: string }[];
  problems: { code: string; ref?: { id: string } }[];
  log: { tool: string; status: string; error_code?: string }[];
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A tool of the registry whose outcome (or failure) the test decides. */
function stub(name: string, run: (signal: AbortSignal) => Promise<ToolOutcome<unknown>>): Tool {
  return defineTool({
    name,
    title: name,
    description: 'stub',
    input: z.strictObject({}),
    annotations: {},
    run: (ctx) => run(ctx.signal),
    render: () => 'ok',
  });
}

const done = (update?: ProcessUpdateInput): Promise<ToolOutcome<unknown>> =>
  Promise.resolve(
    update === undefined ? { status: 'done', data: {} } : { status: 'done', data: {}, update },
  );

interface Bench {
  readonly session: McpSession;
  readonly workspace: string;
  readonly lines: string[];
  process(key?: string): ProcessFile;
  /** A check written before the call, by the real store, as a tool that is no trigger would. */
  seed(update: ProcessUpdateInput): Promise<void>;
}

/** The real registry with the log on, over stub tools, in a workspace bound to no project. */
async function bench(
  tools: readonly Tool[],
  journal: JournalFactory = createProcessStore,
): Promise<Bench> {
  const clock = createTestClock(START);
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'lc-process-update-')));
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  const config = loadConfig(
    { LOADCRAFT_API_URL: 'http://127.0.0.1:9/api/v1', LOADCRAFT_API_TOKEN: CANARY },
    workspace,
  );
  log.registerSecret(config.token.reveal());
  const services = createServices(config, log);
  const session = await connect(() => {
    const server = new McpServer(
      { name: 'loadcraft', version: '0.0.0' },
      { capabilities: { tools: {} } },
    );
    registerTools(server, tools, { config, log, services, clock, journal });
    return server;
  });
  cleanups.push(() => rmSync(workspace, { recursive: true, force: true }));
  cleanups.push(() => session.close());
  const statePath = join(workspace, 'loadcraft', '.cache', 'state.json');
  const bench: Bench = {
    session,
    workspace,
    lines,
    process(key = NEW_KEY) {
      const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as {
        process: Record<string, ProcessFile>;
      };
      const found = parsed.process[key];
      if (found === undefined) throw new Error(`no process under ${key}`);
      return found;
    },
    async seed(update) {
      const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
      const store = createProcessStore(workspace, { secrets, clock });
      await store.applyUpdate(NEW_KEY, update, { tool: 'process_wait' });
    },
  };
  return bench;
}

const FINISHED_OK = { checks: { run: { finished: { ok: true } } } } as const;

describe('ProcessUpdate from a tool: effect and entry in one write', () => {
  it('the ids and checks of the outcome land with the log entry; rev moves by one per call', async () => {
    let flow = FLOW_A;
    const b = await bench([
      stub(FLOWS, () =>
        done({
          add: { flow_ids: [flow] },
          checks: { flows: { flows_built: { ok: true } } },
        }),
      ),
    ]);

    const first = await b.session.call(FLOWS, {});
    expect(first.isError, first.text).toBe(false);
    const one = b.process();
    expect(one.ids.flow_ids).toEqual([FLOW_A]);
    // stamped by the catalog entry of the call, not by today's name
    expect(one.steps['flows']?.checks['flows_built']).toMatchObject({
      ok: true,
      by: 'flows_generate_from_suggestions',
    });
    expect(one.log.map((e) => e.tool)).toEqual([FLOWS]);

    flow = FLOW_B;
    await b.session.call(FLOWS, {});
    const two = b.process();
    expect(two.rev).toBe(one.rev + 1);
    expect(two.ids.flow_ids).toEqual([FLOW_A, FLOW_B]);
    expect(two.log).toHaveLength(2);
  });

  it('a split tool of today invalidates by its catalog entry: the run tool is run_start', async () => {
    const b = await bench([stub(RUN, () => done())]);
    await b.seed(FINISHED_OK);

    await b.session.call(RUN, {});
    const p = b.process();
    expect(p.steps['run']?.checks['finished']).toMatchObject({
      ok: null,
      by: 'invalidated:run_start',
    });
    expect(
      p.problems.some((x) => x.code === 'check_invalidated' && x.ref?.id === 'run.finished'),
    ).toBe(true);
  });

  it('the run tool that only asks for consent started nothing: it plans, and invalidates nothing', async () => {
    const b = await bench([
      stub(RUN, () => Promise.resolve({ status: 'done', data: { needsConfirmation: true } })),
    ]);
    await b.seed(FINISHED_OK);

    await b.session.call(RUN, {});
    expect(b.process().steps['run']?.checks['finished']).toMatchObject({ ok: true });
  });

  it('an inert call (a consent card) invalidates nothing; the write after it does', async () => {
    let inert = true;
    const b = await bench([
      stub('project_set_profile', () =>
        Promise.resolve(
          inert
            ? { status: 'done', data: { needsConfirmation: true }, inert: true }
            : { status: 'done', data: {} },
        ),
      ),
    ]);
    await b.seed({ checks: { scenario: { self_check: { ok: true } } } });

    await b.session.call('project_set_profile', {});
    expect(b.process().steps['scenario']?.checks['self_check']).toMatchObject({ ok: true });

    inert = false;
    await b.session.call('project_set_profile', {});
    expect(b.process().steps['scenario']?.checks['self_check']).toMatchObject({
      ok: null,
      by: 'invalidated:project_set_profile',
    });
  });

  it.each(['run_start', RUN])(
    'a failed call of %s invalidates nothing; its error entry is written',
    async (name) => {
      const b = await bench([
        stub(name, () =>
          Promise.reject(
            new ToolError('run_failed', { params: { handle: 'e-1', detail: 'boom' } }),
          ),
        ),
      ]);
      await b.seed(FINISHED_OK);

      const result = await b.session.call(name, {});
      expect(result.isError).toBe(true);
      const p = b.process();
      expect(p.steps['run']?.checks['finished']).toMatchObject({ ok: true, by: 'process_wait' });
      expect(p.problems).toEqual([]);
      expect(p.log.map((e) => e.status)).toEqual(['error']);
    },
  );

  it('a failure whose text the dictionary cannot fill still leaves its error entry, with its code', async () => {
    // the hint of run_failed names parameters this error does not carry
    const b = await bench([stub('flows_get', () => Promise.reject(new ToolError('run_failed')))]);

    await b.session.call('flows_get', {});
    expect(b.process().log).toEqual([
      expect.objectContaining({ status: 'error', error_code: 'run_failed' }),
    ]);
  });

  it('a cancelled call invalidates nothing; its entry says cancelled', async () => {
    let entered = 0;
    const b = await bench([
      stub('run_start', async (signal) => {
        entered += 1;
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new Error('aborted');
      }),
    ]);
    await b.seed(FINISHED_OK);

    const abort = new AbortController();
    const call = b.session.call('run_start', {}, { signal: abort.signal });
    await vi.waitFor(() => {
      expect(entered).toBe(1);
    });
    abort.abort();
    await expect(call).rejects.toThrow();
    await vi.waitFor(() => {
      expect(b.process().log.map((e) => e.status)).toEqual(['cancelled']);
    });
    expect(b.process().steps['run']?.checks['finished']).toMatchObject({ ok: true });
  });
});

describe('ProcessUpdate from a tool: a refused write leaves its cause in the log', () => {
  it('an update outside the schema is logged with its code and fields; the entry is still saved', async () => {
    const b = await bench([
      stub(FLOWS, () => done({ checks: { flows: { no_such_check: { ok: true } } } })),
    ]);

    const result = await b.session.call(FLOWS, {});
    expect(result.isError, result.text).toBe(false);
    const warned = b.lines.filter((line) => line.includes('state_update_invalid'));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('no_such_check');
    expect(warned[0]).toContain('"fields"');
    expect(b.process().log.map((e) => e.tool)).toEqual([FLOWS]);
  });

  it('a write that fails outside the store logs the cause, masked', async () => {
    const failing: JournalFactory = (root, options) => {
      const store = createProcessStore(root, options);
      return {
        ...store,
        applyUpdate: () => Promise.reject(new Error(`disk full while writing ${CANARY}`)),
      };
    };
    const b = await bench([stub('flows_get', () => done())], failing);

    const result = await b.session.call('flows_get', {});
    expect(result.isError, result.text).toBe(false);
    const warned = b.lines.filter((line) => line.includes('log entry not saved'));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('internal_error');
    expect(warned[0]).toContain('disk full while writing');
    expect(warned[0]).not.toContain(CANARY);
  });
});

describe('the store: a failed call is no trigger', () => {
  it('applyUpdate with failed applies the update, but its tool invalidates nothing', async () => {
    const b = await bench([]);
    await b.seed(FINISHED_OK);
    const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
    const store = createProcessStore(b.workspace, { secrets, clock: { now: () => START } });

    const handle = 'test_run:00000000-0000-4000-8000-0000000000c3';
    await store.applyUpdate(
      NEW_KEY,
      {
        operations: [
          {
            handle,
            kind: 'test_run',
            module: 'run',
            tool: RUN,
            status: 'failed',
            started_at: new Date(START).toISOString(),
          },
        ],
      },
      { tool: 'run_start', failed: true },
    );
    const p = b.process();
    expect(p.steps['run']?.checks['finished']).toMatchObject({ ok: true });
    expect(p.operations).toEqual([expect.objectContaining({ handle, status: 'failed' })]);
  });
});
