// `process_cancel` and `process_wait` with the plan handle (r-xxxxxxxx) `flows_describe_journeys` returned: a plan the user
// turned down is stopped by that handle, so it does not hold the browser of the agent.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { renderCancel } from '../src/render/views/cancel.js';
import { processCancel } from '../src/tools/processCancel.js';
import { flowsDescribeJourneys } from '../src/tools/flowsDescribeJourneys.js';
import { flowsRecordJourneys } from '../src/tools/flowsRecordJourneys.js';
import { processWait } from '../src/tools/processWait.js';
import { createServer } from '../src/server.js';
import { SKLEP_IDS } from './golden/index.js';
import {
  registerDescribeRoutes,
  type DescribeHandles,
  type DescribeWorld,
} from './fake-backend/routes/describe.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { assertNoCanary, FILE_CANARY } from './helpers/canary.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { connect, type CallResult } from './helpers/mcp.js';
import { toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

const NOW = Date.parse('2026-11-22T10:00:00Z');
const RUN = SKLEP_IDS.recordRun;
const PLAN = `r-${RUN.slice(0, 8)}`;
const HANDLE = `record_run:${RUN}`;
const PROJECT = SKLEP_IDS.project;
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: PROJECT, name: 'sklep' },
  }),
  '.env.perf': `TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=${FILE_CANARY}\n`,
};
const DESCRIBE = {
  description:
    'Klient loguje się, szuka produktu, dodaje go do koszyka i płaci kartą, część z kodem ' +
    'rabatowym. Część klientów przegląda katalog, część sprawdza swoje zamówienia.',
  environment: 'perf',
  account: { from_env: '.env.perf' },
} as const;
const CANCEL_PATH = `/api/v1/projects/${PROJECT}/scenario-from-description/runs/${RUN}/cancel`;

// ---- the rig ---------------------------------------------------------------------------------

interface Setup {
  readonly world?: DescribeWorld;
  readonly locale?: 'en' | 'pl';
  readonly capabilities?: readonly string[];
}

interface Started {
  readonly r: ToolRig;
  readonly handles: DescribeHandles;
}

async function rig(setup: Setup = {}): Promise<Started> {
  let handles: DescribeHandles | undefined;
  const r = await toolRig({
    tools: [flowsDescribeJourneys, flowsRecordJourneys, processWait, processCancel],
    clock: createTestClock(NOW),
    fake: { meta: { capabilities: setup.capabilities ?? ['meta', 'api_token_sockets'] } },
    env: { LOADCRAFT_LOCALE: setup.locale ?? 'en' },
    files: BOUND,
    world: (fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      seedSklep(fake.store, { stage: 'project' });
      handles = registerDescribeRoutes(fake, { runIds: [RUN], ...setup.world });
    },
  });
  if (handles === undefined) throw new Error('the world did not register the describe routes');
  return { r, handles };
}

const call = (r: ToolRig, tool: string, args: Record<string, unknown>): Promise<RigCallResult> =>
  settleClock(r, r.call(tool, args), { limitMs: 400_000 });

/** `flows_describe_journeys` of run 3: the plan waits for the approval. */
async function planned(r: ToolRig): Promise<void> {
  const plan = await call(r, 'flows_describe_journeys', DESCRIBE);
  expect(plan.isError, plan.text).toBe(false);
  expect(plan.text).toContain(PLAN);
}

const channelOf = (r: ToolRig) => r.fake.channel('describe', { project_id: PROJECT, run_id: RUN });

const sent = (r: ToolRig, type: string): unknown[] =>
  channelOf(r).received.filter(
    (message) =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === type,
  );

const stateText = (r: ToolRig): string => {
  try {
    return readFileSync(join(r.workspace, 'loadcraft/.cache/state.json'), 'utf8');
  } catch {
    return '';
  }
};

interface Entry {
  readonly saved?: Record<string, unknown>;
}

/** Operations recorded in the workspace, by handle. */
const operations = (r: ToolRig): Record<string, Entry> => {
  const text = stateText(r);
  if (text === '') return {};
  const parsed = JSON.parse(text) as { opPayloads?: Record<string, { value?: Entry }> };
  return Object.fromEntries(
    Object.entries(parsed.opPayloads ?? {}).map(([handle, item]) => [handle, item.value ?? {}]),
  );
};

/** The row of an operation in the process of the project, as the state file holds it. */
const rowOf = (r: ToolRig, handle: string): { status: string } | undefined => {
  const text = stateText(r);
  if (text === '') return undefined;
  const parsed = JSON.parse(text) as {
    process: Record<string, { operations: { handle: string; status: string }[] }>;
  };
  return parsed.process[PROJECT]?.operations.find((row) => row.handle === handle);
};

/** Starts on the run's backend: in flows_record_journeys, the approval of the split; on a walk, nothing. */
const starts = (r: ToolRig): number =>
  r.fake.calls.filter(
    (entry) =>
      entry.method === 'POST' && entry.path.endsWith('/scenario-from-description/generate'),
  ).length;

/**
 * A second server process on the same workspace and backend: what is left after a restart of the
 * MCP server is the state file, nothing in memory. Its results are checked for the canary too.
 */
async function restarted(r: ToolRig): Promise<{
  call(tool: string, args: Record<string, unknown>): Promise<CallResult>;
}> {
  const lines: string[] = [];
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  const config = loadConfig(
    {
      LOADCRAFT_API_URL: `${r.fake.url}/api/v1`,
      LOADCRAFT_API_TOKEN: r.fake.token,
      LOADCRAFT_LOCALE: 'en',
    },
    r.workspace,
  );
  log.registerSecret(config.token.reveal());
  const session = await connect(() =>
    createServer({
      config,
      log,
      tools: [flowsDescribeJourneys, flowsRecordJourneys, processWait, processCancel],
      clock: r.clock,
    }),
  );
  const results: CallResult[] = [];
  onTestFinished(async () => {
    await session.close();
    assertNoCanary(results, lines);
  });
  return {
    async call(tool, args) {
      const result = await settleClock(r, session.call(tool, args), { limitMs: 400_000 });
      results.push(result);
      return result;
    },
  };
}

const rigCancels = (r: ToolRig) => r.fake.calls.filter((item) => item.path === CANCEL_PATH);

/** The run ends in LoadCraft without this server: what the application's own cancel does. */
async function endInTheApp(r: ToolRig): Promise<void> {
  const answer = await fetch(`${r.fake.url}${CANCEL_PATH}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${r.fake.token}` },
  });
  expect(answer.status).toBe(200);
}

describe('cancel with the plan handle', () => {
  it('stops the plan waiting for the approval with one POST …/cancel', async () => {
    const { r } = await rig();
    await planned(r);
    const stopped = await call(r, 'process_cancel', { operation: PLAN });
    expect(stopped.isError, stopped.text).toBe(false);
    expect(rigCancels(r)).toHaveLength(1);
    expect(stopped.outcome?.data).toMatchObject({
      operation: HANDLE,
      cancelled: true,
      note: 'stopped',
    });
    expect(stopped.text).toContain(`Stopped ${HANDLE}`);
    expect(operations(r)[HANDLE]).toBeUndefined();
    r.assertClean();
  });

  it('a run that already ended gets a message and no POST', async () => {
    const { r } = await rig();
    await planned(r);
    await endInTheApp(r);
    const before = rigCancels(r).length;
    const stopped = await call(r, 'process_cancel', { operation: PLAN });
    expect(stopped.isError, stopped.text).toBe(false);
    expect(rigCancels(r)).toHaveLength(before);
    expect(stopped.outcome?.data).toMatchObject({
      cancelled: false,
      note: 'plan_ended',
      ended: 'cancelled',
    });
    expect(stopped.text.replace(/\s+/gu, ' ')).toContain('has already ended (cancelled)');
  });

  it('an unknown plan is a named error with the list of what can be stopped, and no POST', async () => {
    const { r } = await rig();
    await planned(r);
    const stopped = await call(r, 'process_cancel', { operation: 'r-deadbeef' });
    expect(stopped.isError).toBe(true);
    expect(stopped.text).toMatch(/^\[cancel_target_unknown\] /u);
    expect(stopped.text).toContain(HANDLE);
    expect(rigCancels(r)).toEqual([]);
  });

  it('a plan whose run LoadCraft forgot: a named error, and the row of the run says lost', async () => {
    const { r } = await rig();
    await planned(r);
    r.fake.faults.next(
      'GET',
      '/api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}',
      {
        status: 404,
        body: { detail: 'Not Found' },
      },
    );
    const stopped = await call(r, 'process_cancel', { operation: PLAN });
    expect(stopped.isError).toBe(true);
    expect(stopped.text).toMatch(/^\[cancel_target_unknown\] /u);
    expect(rowOf(r, HANDLE)).toMatchObject({ status: 'lost' });
    expect(operations(r)[HANDLE]).toBeUndefined();
    expect(rigCancels(r)).toEqual([]);
  });

  it('works in a new server process: the plan is read from state.json', async () => {
    const { r } = await rig();
    await planned(r);
    const next = await restarted(r);
    const stopped = await next.call('process_cancel', { operation: PLAN });
    expect(stopped.isError, stopped.text).toBe(false);
    expect(rigCancels(r)).toHaveLength(1);
  });

  it('says it in Polish', async () => {
    const { r } = await rig({ locale: 'pl' });
    await planned(r);
    const stopped = await call(r, 'process_cancel', { operation: PLAN });
    expect(stopped.text).toContain('Zatrzymano');
    expect(stopped.text).toContain(HANDLE);
  });

  it('draws the ended message in en and pl', () => {
    const data = {
      operation: HANDLE,
      cancelled: false,
      note: 'plan_ended',
      ended: 'cancelled',
    } as const;
    expect(renderCancel(data, createTranslator('en'))).toMatchSnapshot();
    expect(renderCancel(data, createTranslator('pl')).replace(/\s+/gu, ' ')).toContain(
      'zakończył się już (zatrzymane)',
    );
  });
});

describe('wait with the plan handle', () => {
  it('shows the plan again and approves nothing', async () => {
    const { r } = await rig();
    await planned(r);
    const waited = await call(r, 'process_wait', { operation: PLAN });
    expect(waited.isError, waited.text).toBe(false);
    expect(waited.outcome?.status).toBe('needs_user');
    expect(waited.text).toContain('flows_record_journeys');
    expect(sent(r, 'split_resume')).toEqual([]);
    expect(starts(r)).toBe(1);
    expect(rigCancels(r)).toEqual([]);
    r.assertClean();
  });

  it('an unknown plan is operation_unknown', async () => {
    const { r } = await rig();
    const waited = await call(r, 'process_wait', { operation: 'r-deadbeef' });
    expect(waited.text).toMatch(/^\[operation_unknown\] /u);
  });
});
