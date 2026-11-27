// `flows_record_journeys`: the approval of the plan `flows_describe_journeys` returned, and the walk of the approved
// paths by LoadCraft's browser. The approval goes on the run's channel as `split_resume` with the
// chosen paths as the planner proposed them; the walk is followed there (and through REST when the
// channel fails); the flows are saved once, at the end. Help the agent asks for ends the call with
// `needs_user` and the live preview link; `process_cancel` stops the walk gently on the channel.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { createTranslator } from '../src/render/i18n/index.js';
import {
  renderRecordFlows,
  renderWalkProgress,
  type RecordFlowsData,
} from '../src/render/views/recordFlows.js';
import { processCancel } from '../src/tools/processCancel.js';
import { flowsDescribeJourneys } from '../src/tools/flowsDescribeJourneys.js';
import { flowsRecordJourneys } from '../src/tools/flowsRecordJourneys.js';
import { processWait } from '../src/tools/processWait.js';
import { createServer } from '../src/server.js';
import { goldenText, goldenUrl, SKLEP_IDS } from './golden/index.js';
import {
  registerDescribeRoutes,
  SKLEP_PROPOSAL,
  type DescribeHandles,
  type DescribeWorld,
} from './fake-backend/routes/describe.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { rejection, waitFor } from './helpers/async.js';
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
const LINK = `https://app.loadcraft.io/projects/${PROJECT}/scenario-from-description/runs/${RUN}`;
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

/** Waits with the handle until the walk is done; every result on the way is returned. */
async function untilDone(r: ToolRig, first: RigCallResult): Promise<RigCallResult[]> {
  const results = [first];
  let last = first;
  for (let again = 0; again < 8 && !last.isError && last.outcome?.status !== 'done'; again += 1) {
    last = await call(r, 'process_wait', { operation: HANDLE });
    results.push(last);
  }
  return results;
}

const channelOf = (r: ToolRig) => r.fake.channel('describe', { project_id: PROJECT, run_id: RUN });

const sent = (r: ToolRig, type: string): unknown[] =>
  channelOf(r).received.filter(
    (message) =>
      typeof message === 'object' && message !== null && 'type' in message && message.type === type,
  );

const progressOf = (results: readonly RigCallResult[]): string[] =>
  results.flatMap((result) => result.progress.map((entry) => entry.message ?? ''));

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

const data = (result: RigCallResult): RecordFlowsData => result.outcome?.data as RecordFlowsData;

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

// ---- run 3 -----------------------------------------------------------------------------------

describe('flows_record_journeys: run 3', () => {
  it('approves the three paths, shows the walk as it goes and ends with the golden text', async () => {
    const { r, handles } = await rig({ locale: 'pl' });
    await planned(r);
    const result = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(result.isError, result.text).toBe(false);
    expect(result.outcome?.status).toBe('done');
    expect(`${result.text}\n`).toBe(goldenText('run3', '04-flows_record_journeys'));
    // The progress of the walk, as the golden text of the progress shows it at one moment.
    expect(progressOf([result])).toContain(
      goldenText('run3', '04-flows_record_journeys-postep').trim(),
    );
    // The paths went back exactly as the planner proposed them.
    expect(handles.approvals).toEqual([SKLEP_PROPOSAL.map((path) => ({ ...path }))]);
    // Saved once, at the end: no progress line called a path ready before.
    for (const message of progressOf([result])) expect(message).not.toContain('gotowy');
    expect(operations(r)).toEqual({});
  });

  it('every saved flow is named in the text by its link', async () => {
    const { r } = await rig();
    await planned(r);
    const result = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    const flows = data(result).saved.map((outline) => outline.flowId);
    expect(flows).toHaveLength(3);
    for (const id of flows) {
      expect(result.text).toContain(`↗ https://app.loadcraft.io/projects/${PROJECT}/flows/${id}`);
    }
  });

  it('approves a subset: only the chosen paths, in the order of the plan', async () => {
    const { r, handles } = await rig();
    await planned(r);
    const result = await call(r, 'flows_record_journeys', {
      plan: PLAN,
      paths: ['Konto', 'zakupy'],
    });
    expect(result.isError, result.text).toBe(false);
    expect(handles.approvals.map((paths) => paths.map((path) => path['name']))).toEqual([
      ['zakupy', 'konto'],
    ]);
    expect(data(result).paths.map((path) => [path.name, path.status])).toEqual([
      ['zakupy', 'saved'],
      ['konto', 'saved'],
    ]);
    expect(result.text).toContain('2 flows saved');
  });

  it('a name the plan does not have: a named error with the names it has, nothing sent', async () => {
    const { r } = await rig();
    await planned(r);
    const result = await call(r, 'flows_record_journeys', {
      plan: PLAN,
      paths: ['zakupy', 'koszyk'],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[record_unknown_paths\] /u);
    expect(result.text).toContain('"koszyk"');
    expect(result.text).toContain('"przeglądanie"');
    expect(sent(r, 'split_resume')).toEqual([]);
  });

  it('a run already walking (one path) is followed without sending an approval', async () => {
    const { r, handles } = await rig({ world: { paths: [{ name: 'zakupy', steps: ['kup'] }] } });
    await planned(r);
    const result = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(result.isError, result.text).toBe(false);
    expect(sent(r, 'split_resume')).toEqual([]);
    expect(handles.approvals).toEqual([]);
    expect(data(result).paths.map((path) => path.status)).toEqual(['saved']);
  });

  it('takes the operation handle as well as the short one', async () => {
    const { r } = await rig();
    await planned(r);
    const result = await call(r, 'flows_record_journeys', { plan: HANDLE, paths: 'all' });
    expect(result.isError, result.text).toBe(false);
    expect(data(result).saved).toHaveLength(3);
  });
});

// ---- refusals ----------------------------------------------------------------------------------

describe('flows_record_journeys: refusals', () => {
  it('agent_browsers_busy: one named error with a hint, and the plan stays for another try', async () => {
    const { r } = await rig({ world: { approvalBusy: true } });
    await planned(r);
    const result = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[agent_browsers_busy\] /u);
    expect(result.text).toMatch(/\n→ /u);
    await expect(result.text).toMatchFileSnapshot('__snapshots__/recordFlows.busy.en.txt');
    const entry = operations(r)[HANDLE];
    expect(entry?.saved?.['plan']).toBeDefined();
    expect(entry?.saved?.['walk']).toBeUndefined();
  });

  it('a principal without the editor role: record_approval_denied with the link', async () => {
    const { r } = await rig({ world: { approvalDenied: 'editor_role_required' } });
    await planned(r);
    const result = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(result.text).toMatch(/^\[record_approval_denied\] /u);
    expect(result.text).toContain('editor_role_required');
    expect(result.text).toContain(LINK);
  });

  it('a plan this workspace does not know: operation_unknown', async () => {
    const { r } = await rig();
    const result = await call(r, 'flows_record_journeys', { plan: 'r-0badc0de', paths: 'all' });
    expect(result.text).toMatch(/^\[operation_unknown\] /u);
  });

  it('a plan flows_describe_journeys has not shown yet: plan_not_ready with the handle to wait for', async () => {
    const { r } = await rig({ world: { planAtMs: 60_000 } });
    const first = await call(r, 'flows_describe_journeys', { ...DESCRIBE, max_wait_s: 5 });
    expect(first.outcome?.status).toBe('running');
    const result = await call(r, 'flows_record_journeys', { plan: HANDLE, paths: 'all' });
    expect(result.text).toMatch(/^\[plan_not_ready\] /u);
    expect(result.text).toContain(HANDLE);
  });

  it('a backend without token sockets: backend_too_old', async () => {
    const { r } = await rig({ capabilities: ['meta'] });
    const result = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(result.text).toMatch(/^\[backend_too_old\] /u);
  });
});

// ---- the user in the loop ----------------------------------------------------------------------

describe('flows_record_journeys: help the agent asks for', () => {
  it('needs_user with the live preview link; after the hand-back wait finishes the walk', async () => {
    const { r } = await rig({
      world: {
        walk: {
          zakupy: {
            help: {
              atStep: 1,
              reason: 'second_factor',
              agentSays: 'Podaj kod z SMS',
              returnedAfterMs: 150_000,
            },
          },
        },
      },
    });
    await planned(r);
    const first = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(first.isError, first.text).toBe(false);
    expect(first.outcome?.status).toBe('needs_user');
    expect(first.outcome?.operation).toBe(HANDLE);
    expect(first.text).toContain('zakupy');
    expect(first.text).toContain('one-time code');
    expect(first.text).toContain('Podaj kod z SMS');
    expect(first.text).toMatch(/only the user who started the run[\s\S]*LoadCraft\s+app/iu);
    expect(first.text).toContain(`↗ live preview: ${LINK}`);
    expect(first.text).toMatch(new RegExp(`wait[^\\n]*${HANDLE}`, 'u'));
    // The entry stays for process_wait.
    expect(operations(r)[HANDLE]).toBeDefined();

    const results = await untilDone(r, first);
    const last = results.at(-1);
    expect(last?.isError, last?.text).toBe(false);
    expect(last?.outcome?.status).toBe('done');
    expect(data(last as RigCallResult).saved).toHaveLength(3);
    // A wait while the user still helps says so again, rather than "running".
    expect(results.slice(1, -1).every((result) => result.outcome?.status === 'needs_user')).toBe(
      true,
    );
    // The server never connects to the live preview: only the run's channel was opened.
    for (const address of channelOf(r).addresses) expect(address).not.toMatch(/\/live/u);
  });
});

describe('flows_record_journeys: help handed back between two reads', () => {
  it('a REST read after the hand-back no longer says the user is needed', async () => {
    const { r } = await rig({
      world: {
        walk: { zakupy: { help: { atStep: 0, reason: 'captcha', returnedAfterMs: 20_000 } } },
      },
    });
    await planned(r);
    const first = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(first.outcome?.status).toBe('needs_user');
    const statuses: (string | undefined)[] = [];
    const texts: string[] = [];
    let last = first;
    for (let again = 0; again < 40 && last.outcome?.status !== 'done'; again += 1) {
      last = await call(r, 'process_wait', { operation: HANDLE, max_wait_s: 1 });
      statuses.push(last.outcome?.status);
      texts.push(last.text);
    }
    expect(last.outcome?.status).toBe('done');
    // While the agent waits, each short process_wait says so; after the hand-back it says running,
    // already while the path whose agent asked is walked on.
    expect(statuses[0]).toBe('needs_user');
    const handedBack = statuses.indexOf('running');
    expect(handedBack).toBeGreaterThan(0);
    expect(statuses.slice(handedBack)).not.toContain('needs_user');
    expect(texts[handedBack]).toMatch(/zakupy +walking…|zakupy +\d\/5 · /u);
  });

  it('a REST read no longer reports help for a path that failed without a hand-back', async () => {
    const { r } = await rig({
      world: {
        walk: { zakupy: { help: { atStep: 0, reason: 'captcha', gaveUpAfterMs: 20_000 } } },
      },
    });
    await planned(r);
    const first = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(first.outcome?.status).toBe('needs_user');
    const statuses: (string | undefined)[] = [];
    let last = first;
    for (let again = 0; again < 60 && last.outcome?.status !== 'done'; again += 1) {
      last = await call(r, 'process_wait', { operation: HANDLE, max_wait_s: 1 });
      statuses.push(last.outcome?.status);
    }
    expect(last.outcome?.status).toBe('done');
    const movedOn = statuses.indexOf('running');
    expect(movedOn).toBeGreaterThan(0);
    expect(statuses.slice(movedOn)).not.toContain('needs_user');
    expect(data(last).paths.map((path) => path.status)).toEqual(['failed', 'saved', 'saved']);
  });
});

// ---- the approval belongs to the call that carries it ---------------------------------------------

const APPROVAL_PENDING = /waiting for approval/u;

describe('flows_record_journeys: only the call that approves sends the approval', () => {
  it('max_wait_s 0: nothing approved, the result says so, and no wait sends the approval', async () => {
    const { r, handles } = await rig();
    await planned(r);
    const first = await call(r, 'flows_record_journeys', {
      plan: PLAN,
      paths: 'all',
      max_wait_s: 0,
    });
    expect(first.isError, first.text).toBe(false);
    expect(first.outcome?.status).toBe('needs_user');
    expect(first.text).toMatch(APPROVAL_PENDING);
    expect(first.text).toContain(`call flows_record_journeys with plan "${PLAN}"`);
    expect(first.text).toContain(LINK);
    // The paths the user is to approve are named, and process_wait (which says the same) is not offered.
    expect(first.text).toContain('zakupy, przeglądanie, konto');
    expect(first.text).not.toMatch(/call process_wait/u);
    expect(handles.approvals).toEqual([]);
    expect(operations(r)[HANDLE]?.saved?.['plan']).toBeDefined();
    expect(operations(r)[HANDLE]?.saved?.['walk']).toBeUndefined();

    const short = await call(r, 'process_wait', { operation: HANDLE, max_wait_s: 1 });
    const long = await call(r, 'process_wait', { operation: HANDLE });
    for (const waited of [short, long]) {
      expect(waited.isError, waited.text).toBe(false);
      expect(waited.outcome?.status).toBe('needs_user');
      expect(waited.text).toMatch(APPROVAL_PENDING);
      expect(waited.text).toContain(LINK);
      expect(waited.text).toContain('zakupy, przeglądanie, konto');
      expect(waited.text).not.toMatch(/call process_wait/u);
    }
    expect(handles.approvals).toEqual([]);
    expect(sent(r, 'split_resume')).toEqual([]);
    // Only the plan socket of flows_describe_journeys: a wait of a plan opens none.
    expect(channelOf(r).opened).toBe(1);

    // The approval goes with the next flows_record_journeys, once.
    const results = await untilDone(
      r,
      await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' }),
    );
    expect(results.at(-1)?.outcome?.status).toBe('done');
    expect(handles.approvals).toHaveLength(1);
    expect(sent(r, 'split_resume')).toHaveLength(1);
  });

  it('Esc before the proposal came: the entry keeps no approval, and process_wait sends none', async () => {
    const { r, handles } = await rig();
    await planned(r);
    const opened = (): number => r.lines.filter((line) => line.includes('channel opening')).length;
    const before = opened();
    r.fake.faults.holdWebSocket();
    const controller = new AbortController();
    const pending = r.call(
      'flows_record_journeys',
      { plan: PLAN, paths: 'all' },
      { signal: controller.signal },
    );
    await waitFor(() => opened() > before, 'the handshake of the walk socket');
    controller.abort();
    await rejection(pending);
    r.fake.faults.allowWebSocket();
    expect(operations(r)[HANDLE]?.saved?.['walk']).toBeUndefined();

    const waited = await call(r, 'process_wait', { operation: HANDLE });
    expect(waited.outcome?.status).toBe('needs_user');
    expect(waited.text).toMatch(APPROVAL_PENDING);
    expect(handles.approvals).toEqual([]);
    expect(sent(r, 'split_resume')).toEqual([]);
  });

  it('a restart while the plan waits: the new process sends nothing until flows_record_journeys', async () => {
    const { r, handles } = await rig();
    await planned(r);
    // The process dies in flows_record_journeys before the proposal came: only the state file is left.
    r.fake.faults.holdWebSocket();
    const controller = new AbortController();
    const pending = r.call(
      'flows_record_journeys',
      { plan: PLAN, paths: 'all' },
      { signal: controller.signal },
    );
    await waitFor(
      () => r.lines.some((line) => line.includes('"tool":"flows_record_journeys"')),
      'the call',
    );
    controller.abort();
    await rejection(pending);
    r.fake.faults.allowWebSocket();

    const next = await restarted(r);
    const first = await next.call('process_wait', { operation: HANDLE });
    const second = await next.call('process_wait', { operation: HANDLE });
    for (const waited of [first, second]) {
      expect(waited.isError, waited.text).toBe(false);
      expect(waited.text).toMatch(APPROVAL_PENDING);
    }
    expect(handles.approvals).toEqual([]);
    expect(sent(r, 'split_resume')).toEqual([]);

    const approved = await next.call('flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(approved.isError, approved.text).toBe(false);
    expect(handles.approvals).toHaveLength(1);
    expect(sent(r, 'split_resume')).toHaveLength(1);
  });

  it('a restart while the walk runs: one approval in all, the walk is followed to the end', async () => {
    const { r, handles } = await rig();
    await planned(r);
    const first = await call(r, 'flows_record_journeys', {
      plan: PLAN,
      paths: 'all',
      max_wait_s: 5,
    });
    expect(first.outcome?.status).toBe('running');
    expect(handles.approvals).toHaveLength(1);
    expect(operations(r)[HANDLE]?.saved?.['walk']).toBeDefined();

    const next = await restarted(r);
    let last = await next.call('process_wait', { operation: HANDLE });
    for (let again = 0; again < 8 && !/flows? saved/u.test(last.text); again += 1) {
      last = await next.call('process_wait', { operation: HANDLE });
    }
    expect(last.isError, last.text).toBe(false);
    expect(last.text).toContain('3 flows saved');
    expect(handles.approvals).toHaveLength(1);
    expect(sent(r, 'split_resume')).toHaveLength(1);
    expect(starts(r)).toBe(1);
  });

  it('wait after describe_channel_unavailable sends nothing, whether the channel is back or not', async () => {
    const { r, handles } = await rig();
    await planned(r);
    r.fake.faults.blockWebSocket();
    const refused = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(refused.text).toMatch(/^\[describe_channel_unavailable\] /u);
    const blocked = await call(r, 'process_wait', { operation: HANDLE });
    r.fake.faults.allowWebSocket();
    const back = await call(r, 'process_wait', { operation: HANDLE });
    for (const waited of [blocked, back]) {
      expect(waited.isError, waited.text).toBe(false);
      expect(waited.text).toMatch(APPROVAL_PENDING);
    }
    expect(handles.approvals).toEqual([]);
    expect(channelOf(r).received).toEqual([]);
    expect(channelOf(r).opened).toBe(1);
    expect(starts(r)).toBe(1);
    expect(r.fake.calls.filter((entry) => entry.path === CANCEL_PATH)).toEqual([]);
  });
});

// ---- the password of the account -----------------------------------------------------------------

describe('flows_record_journeys: the password of the account', () => {
  /** Run 3 where the backend repeats the password: in a step, in a request for help, in a failure. */
  const LEAKY: DescribeWorld = {
    walk: {
      zakupy: { label: `wpisuje haslo ${FILE_CANARY}` },
      przeglądanie: {
        help: {
          atStep: 0,
          reason: 'captcha',
          agentSays: `wpisalem ${FILE_CANARY}`,
          returnedAfterMs: 20_000,
        },
      },
      konto: { outcome: 'failed', failure: `bad password ${FILE_CANARY}` },
    },
  };

  it('never leaves the server: not in a result, the progress, the log or the state file', async () => {
    const { r } = await rig({ world: LEAKY });
    await planned(r);
    const first = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(first.outcome?.status).toBe('needs_user');
    const results = await untilDone(r, first);
    const last = results.at(-1) as RigCallResult;
    expect(last.outcome?.status).toBe('done');
    // The backend's texts reached the views, masked.
    expect(
      progressOf(results).some((message) => message.includes('wpisuje haslo [redacted]')),
    ).toBe(true);
    expect(first.text).toContain('wpisalem [redacted]');
    expect(last.text).toContain('bad password [redacted]');
    r.assertClean();
  });

  it('a wait in a restarted server masks it too', async () => {
    const { r } = await rig({ world: LEAKY });
    await planned(r);
    const first = await call(r, 'flows_record_journeys', {
      plan: PLAN,
      paths: 'all',
      max_wait_s: 5,
    });
    expect(first.outcome?.status).toBe('running');
    const next = await restarted(r);
    const texts: string[] = [];
    let last = await next.call('process_wait', { operation: HANDLE });
    texts.push(last.text);
    for (let again = 0; again < 8 && !/flows? saved/u.test(last.text); again += 1) {
      last = await next.call('process_wait', { operation: HANDLE });
      texts.push(last.text);
    }
    expect(texts.join('\n')).toContain('wpisalem [redacted]');
    expect(last.text).toContain('bad password [redacted]');
  });
});

// ---- the channel -------------------------------------------------------------------------------

describe('flows_record_journeys: the channel', () => {
  it('a channel dropped mid-walk reconnects and rebuilds the state from drive_snapshot', async () => {
    const { r } = await rig();
    await planned(r);
    // Cut during the second path and kept out until it was built (at 16.5 s of the walk): its
    // `path_done` goes to nobody, and only the snapshot of the next socket tells it.
    void r.clock.sleep(15_000).then(() => {
      r.fake.faults.blockWebSocket();
      r.fake.faults.dropChannel('describe');
    });
    void r.clock.sleep(17_000).then(() => {
      r.fake.faults.allowWebSocket();
    });
    const result = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(result.isError, result.text).toBe(false);
    expect(data(result).saved).toHaveLength(3);
    // The plan socket of flows_describe_journeys, the walk's, and the one after the drop.
    expect(channelOf(r).opened).toBe(3);
    // The approval was sent once: the new socket is told where the walk stands, not asked again.
    expect(sent(r, 'split_resume')).toHaveLength(1);
    const after = progressOf([result]).filter((message) =>
      /zakupy +built · saved at the end\nprzeglądanie +built · saved at the end\nkonto +waiting…/u.test(
        message,
      ),
    );
    expect(after.length).toBeGreaterThan(0);
  });

  it('a refused handshake of the run channel: describe_channel_refused with the link', async () => {
    const { r } = await rig();
    await planned(r);
    // A restarted backend no longer knows the run's channel: the handshake is refused.
    r.fake.faults.restart();
    const result = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[describe_channel_refused\] /u);
    expect(result.text).toContain(LINK);
  });

  it('a blocked WebSocket while the plan waits: describe_channel_unavailable with the link', async () => {
    const { r, handles } = await rig();
    await planned(r);
    r.fake.faults.blockWebSocket();
    const result = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[describe_channel_unavailable\] /u);
    expect(result.text).toContain(LINK);
    expect(handles.approvals).toEqual([]);
    // The plan stays without the approval: a later wait only reads, it never sends one.
    expect(operations(r)[HANDLE]?.saved?.['plan']).toBeDefined();
    expect(operations(r)[HANDLE]?.saved?.['walk']).toBeUndefined();
  });

  it('a blocked WebSocket while the walk runs: the result comes through REST', async () => {
    const { r } = await rig();
    await planned(r);
    const first = await call(r, 'flows_record_journeys', {
      plan: PLAN,
      paths: 'all',
      max_wait_s: 5,
    });
    expect(first.outcome?.status).toBe('running');
    expect(first.text).toContain(HANDLE);
    r.fake.faults.blockWebSocket();
    r.fake.faults.dropChannel('describe');
    const done = await call(r, 'process_wait', { operation: HANDLE });
    expect(done.isError, done.text).toBe(false);
    expect(done.outcome?.status).toBe('done');
    expect(data(done).paths.map((path) => path.status)).toEqual(['saved', 'saved', 'saved']);
    expect(progressOf([done]).some((message) => message.includes('channel is unavailable'))).toBe(
      true,
    );
  });
});

// ---- the end of the walk -----------------------------------------------------------------------

describe('flows_record_journeys: what the walk left', () => {
  it('a partial path that met a payment: the reason, and a warning that a load test will not pass it', async () => {
    const { r } = await rig({
      locale: 'pl',
      world: {
        walk: {
          zakupy: {
            outcome: 'partial',
            note: 'płatność: potrzebna testowa metoda płatności',
            help: {
              atStep: 4,
              reason: 'unknown_blocker',
              returnedAfterMs: 5000,
              obstacle: 'payment',
            },
          },
        },
      },
    });
    await planned(r);
    const results = await untilDone(
      r,
      await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' }),
    );
    const last = results.at(-1) as RigCallResult;
    expect(last.isError, last.text).toBe(false);
    const lines = last.text.split('\n');
    expect(lines).toContain(
      'zakupy         częściowy · płatność: potrzebna testowa metoda płatności',
    );
    expect(last.text).toMatch(/⚠ zakupy: płatność z 3-D Secure — test obciążeniowy nie przejdzie/u);
    expect(last.text).toMatch(/otwórz podgląd na żywo/u);
    expect(data(last).paths[0]?.obstacles).toEqual(['payment']);
  });

  it('a failed path: its reason and the number of attempts', async () => {
    const { r } = await rig({
      world: { walk: { konto: { outcome: 'failed', failure: 'The orders page never loaded.' } } },
    });
    await planned(r);
    const result = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toMatch(/konto +failed after 2 attempts · The orders page never loaded\./u);
    expect(result.text).toContain('2 flows saved');
    expect(progressOf([result]).some((message) => /konto +attempt 1 failed/u.test(message))).toBe(
      true,
    );
  });

  it('a run cancelled in the app before anything was saved: record_run_failed', async () => {
    const { r } = await rig();
    await planned(r);
    void r.clock.sleep(4000).then(() =>
      fetch(`${r.fake.url}${CANCEL_PATH}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${r.fake.token}` },
      }),
    );
    const result = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[record_run_failed\] /u);
    expect(result.text).toContain('cancelled');
  });

  it('the text LoadCraft gave for a failed walk goes to the log, not to the model', async () => {
    const { r } = await rig({ world: { cancelMessage: 'Traceback at db-internal.example' } });
    await planned(r);
    void r.clock.sleep(4000).then(() =>
      fetch(`${r.fake.url}${CANCEL_PATH}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${r.fake.token}` },
      }),
    );
    const result = await call(r, 'flows_record_journeys', { plan: PLAN, paths: 'all' });
    expect(result.text).toMatch(/^\[record_run_failed\] /u);
    expect(result.text).not.toContain('db-internal');
    expect(
      r.logRecords('warn').filter((record) => record.msg === 'backend error text'),
    ).toMatchObject([
      { source: 'flows_record_journeys', text: 'Traceback at db-internal.example' },
    ]);
  });
});

// ---- stopping ----------------------------------------------------------------------------------

describe('flows_record_journeys: cancel', () => {
  it('sends stop on the channel; the built path is saved and process_wait shows it', async () => {
    const { r } = await rig();
    await planned(r);
    const first = await call(r, 'flows_record_journeys', {
      plan: PLAN,
      paths: 'all',
      max_wait_s: 15,
    });
    expect(first.outcome?.status).toBe('running');
    const stopped = await call(r, 'process_cancel', { operation: HANDLE });
    expect(stopped.isError, stopped.text).toBe(false);
    expect(stopped.text).toContain('is stopping');
    expect(stopped.text).toMatch(new RegExp(`→ Call process_wait with ${HANDLE}`, 'u'));
    expect(sent(r, 'stop')).toHaveLength(1);
    expect(r.fake.calls.filter((item) => item.path === CANCEL_PATH)).toEqual([]);
    expect(operations(r)[HANDLE]).toBeDefined();

    const done = await call(r, 'process_wait', { operation: HANDLE });
    expect(done.outcome?.status).toBe('done');
    expect(data(done).paths.map((path) => [path.name, path.status])).toEqual([
      ['zakupy', 'saved'],
      ['przeglądanie', 'stopped'],
      ['konto', 'stopped'],
    ]);
    expect(done.text).toContain('1 flow saved');
  });

  it('without the channel the walk is cancelled through REST', async () => {
    const { r } = await rig();
    await planned(r);
    const first = await call(r, 'flows_record_journeys', {
      plan: PLAN,
      paths: 'all',
      max_wait_s: 5,
    });
    expect(first.outcome?.status).toBe('running');
    r.fake.faults.blockWebSocket();
    const stopped = await call(r, 'process_cancel', { operation: HANDLE });
    expect(stopped.isError, stopped.text).toBe(false);
    expect(r.fake.calls.filter((item) => item.path === CANCEL_PATH)).toHaveLength(1);
    expect(stopped.outcome?.data).toMatchObject({ cancelled: true, note: 'stopped' });
  });

  it('a plan waiting for the approval is cancelled through REST: nothing to stop gently', async () => {
    const { r } = await rig();
    await planned(r);
    const stopped = await call(r, 'process_cancel', { operation: HANDLE });
    expect(stopped.isError, stopped.text).toBe(false);
    expect(r.fake.calls.filter((item) => item.path === CANCEL_PATH)).toHaveLength(1);
    expect(channelOf(r).received).toEqual([]);
    expect(operations(r)[HANDLE]).toBeUndefined();
  });
});

// ---- the view --------------------------------------------------------------------------------

/** The golden text without the link lines the registry adds after the view. */
function goldenView(): string {
  const lines = goldenText('run3', '04-flows_record_journeys').replace(/\n$/u, '').split('\n');
  while (lines.at(-1)?.startsWith('↗ https://app.loadcraft.io/projects/') === true) lines.pop();
  return `${lines.join('\n')}\n`;
}

describe('flows_record_journeys: view', () => {
  const golden = JSON.parse(
    readFileSync(goldenUrl('run3/04-flows_record_journeys.view.json'), 'utf8'),
  ) as RecordFlowsData;

  it('draws the pl golden text from the golden data', () => {
    expect(`${renderRecordFlows(golden, createTranslator('pl'))}\n`).toBe(goldenView());
  });

  it('draws the same data in English', async () => {
    const text = renderRecordFlows(golden, createTranslator('en'));
    await expect(`${text}\n`).toMatchFileSnapshot('__snapshots__/recordFlows.golden.en.txt');
  });

  it('names every state a path can end in, never wider than the view', () => {
    const text = renderRecordFlows(
      {
        ...golden,
        paths: [
          {
            name: 'zakupy',
            status: 'failed',
            reason: 'strona nie odpowiada '.repeat(12),
            attempts: 2,
            obstacles: [],
          },
          { name: 'zwrot', status: 'not_driven', reason: null, attempts: 0, obstacles: [] },
          { name: 'konto', status: 'stopped', reason: null, attempts: 1, obstacles: [] },
          { name: 'opinie', status: 'unfinished', reason: null, attempts: 0, obstacles: [] },
          {
            name: 'płatność',
            status: 'partial',
            steps: 4,
            reason: null,
            attempts: 1,
            obstacles: ['captcha', 'one_time_code'],
          },
        ],
        saved: [],
      },
      createTranslator('pl'),
    );
    expect(text).toContain('zakupy     nieudany po 2 próbach · strona nie odpowiada strona');
    expect(text).toContain(
      'zwrot      nieprzejechany: ścieżka, którą kontynuuje, nie doszła do celu',
    );
    expect(text).toContain('konto      zatrzymany');
    expect(text).toContain('opinie     nieprzejechany: przebieg skończył się wcześniej');
    expect(text).toContain('płatność   częściowy · 4 kroki');
    expect(text).toContain('⚠ płatność: CAPTCHA, kod jednorazowy');
    expect(text).toContain('żaden flow nie został zapisany');
    for (const line of text.split('\n')) {
      if (!line.startsWith('↗ ')) expect([...line].length).toBeLessThanOrEqual(77);
    }
  });

  it('the progress of a walk: the step of the plan, the label, and the paths that wait', () => {
    const t = createTranslator('pl');
    const text = renderWalkProgress(
      {
        lines: [
          { name: 'zakupy', state: 'driving', step: 3, steps: 5, label: 'klika: koszyk' },
          { name: 'przeglądanie', state: 'queued' },
          { name: 'konto', state: 'help', help: 'captcha' },
        ],
        setup: true,
        awaiting: false,
        stopping: true,
      },
      t,
    );
    expect(text.split('\n')).toEqual([
      'logowanie wspólne…',
      'zakupy         3/5 · klika: koszyk…',
      'przeglądanie   czeka…',
      'konto          czeka na pomoc: CAPTCHA',
      'LoadCraft zatrzymuje przejście: bieżąca ścieżka się kończy, zbudowane ścieżki',
      'zostaną zapisane.',
    ]);
  });
});
