// The self-check view a client beside the chat reads while a check runs: `scenario_check_self` writes it
// to the state file at every change of the check it reads, and `process_get_status` with `progress` hands
// it out. A fake backend walks one check through its states (running, a step that failed, an AI repair,
// a run from the first step again, the end); after each one the status gives the view of that moment.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CheckRunStepView, ScenarioCheck } from '../src/render/views/selfCheckChain.js';
import { processGetStatus } from '../src/tools/processGetStatus.js';
import { processWait } from '../src/tools/processWait.js';
import { scenarioCheckSelf } from '../src/tools/scenarioCheckSelf.js';
import { buildSelfCheckView } from '../src/tools/selfCheckStateView.js';
import { State } from '../src/workspace/processState.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import {
  checkRunDocument,
  failureDocument,
  registerSelfCheckRoutes,
  selfCheckDocument,
  type SelfCheckDocument,
  type SelfCheckFake,
  type SelfCheckRepairDocument,
} from './fake-backend/routes/selfCheck.js';
import type { JobStep } from './fake-backend/server.js';
import { seedSklep, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { createTestClock, realTurn, settleClock } from './helpers/clock.js';
import { CANARY, toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

const NOW = Date.parse('2026-11-22T10:22:00Z');
const IDS = SKLEP_WORLD_IDS;
const FIRST = '5d0c2a7e-9b13-4f68-a1d4-8e3b7c6f0a29';
const SECOND = '7a1f3c9e-2b4d-4e6f-8a0c-1d3e5f7a9b2c';
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

interface Rig extends ToolRig {
  readonly checks: SelfCheckFake;
}

async function rig(): Promise<Rig> {
  let checks: SelfCheckFake | undefined;
  const r = await toolRig({
    tools: [scenarioCheckSelf, processWait, processGetStatus],
    world: (fake) => {
      registerLookupRoutes(fake);
      checks = registerSelfCheckRoutes(fake);
      seedSklep(fake.store, { stage: 'data' });
    },
    clock: createTestClock(NOW),
    env: { LOADCRAFT_LOCALE: 'en' },
    files: BOUND,
  });
  if (checks === undefined) throw new Error('the world was not built');
  return Object.assign(r, { checks });
}

const step = (afterMs: number, state: SelfCheckDocument): JobStep<SelfCheckDocument> => ({
  afterMs,
  state,
});
const doc = selfCheckDocument;
const FAILURE = failureDocument('pay', `HTTP 403 Forbidden ${CANARY}`, null, 403);

const firstRun = (status: 'failed' | null = 'failed') =>
  checkRunDocument(FIRST, 1, status, [
    ['login', 'ok'],
    ['pay', 'failed', 403, `HTTP 403 Forbidden ${CANARY}`],
    ['confirm', 'not_run'],
  ]);

function repair(fields: Partial<SelfCheckRepairDocument>): SelfCheckRepairDocument {
  return {
    round: 1,
    failure: FAILURE,
    changes_summary: 'added a header',
    refused_reason: null,
    refused_code: null,
    refused_message: null,
    scenario_version_after: 2,
    verdict: null,
    recording_available: true,
    ...fields,
  };
}

/** Moves the test clock to `NOW + ms`, letting the call and the fake do their work on the way. */
async function advanceTo(r: ToolRig, ms: number): Promise<void> {
  const target = NOW + ms;
  while (r.clock.now() < target) {
    await realTurn(1);
    const next = r.clock.nextWakeAt();
    const to = next === undefined ? target : Math.min(next, target);
    await r.clock.advance(Math.max(0, to - r.clock.now()));
  }
  await realTurn(1);
}

interface LiveView {
  readonly key: string;
  readonly savedAt: string;
  readonly environment?: string;
  readonly scenarios: readonly Record<string, unknown>[];
}

/** The view `process_get_status` with `progress` hands a client beside the chat, or undefined. */
async function liveView(r: ToolRig): Promise<LiveView | undefined> {
  const result: RigCallResult = await r.call('process_get_status', {
    format: 'data',
    progress: true,
  });
  expect(result.isError, result.text).toBe(false);
  return (result.outcome?.data as { selfCheck?: LiveView }).selfCheck;
}

async function scenarioAt(r: ToolRig): Promise<Record<string, unknown>> {
  const view = await liveView(r);
  expect(view).toBeDefined();
  expect(view?.scenarios).toHaveLength(1);
  return view?.scenarios[0] ?? {};
}

function stateFile(r: ToolRig): unknown {
  return JSON.parse(readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'));
}

describe('scenario_check_self: the view while the check runs', () => {
  it('after each state of a repaired check the status gives the view of that moment', async () => {
    const r = await rig();
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(
        1500,
        doc({ status: 'running', execution_ids: [FIRST], started_at: '2026-11-22T10:22:01Z' }),
      ),
      step(
        7500,
        doc({
          status: 'repairing',
          execution_ids: [FIRST],
          failure: FAILURE,
          runs: [firstRun()],
          started_at: '2026-11-22T10:22:01Z',
        }),
      ),
      step(
        10_500,
        doc({
          status: 'pending',
          scenario_version: 2,
          execution_ids: [FIRST],
          failure: FAILURE,
          runs: [firstRun()],
          repairs: [repair({})],
        }),
      ),
      step(
        13_500,
        doc({
          status: 'running',
          scenario_version: 2,
          execution_ids: [FIRST, SECOND],
          runs: [firstRun(), { ...checkRunDocument(SECOND, 2, null, []) }],
          repairs: [repair({})],
          started_at: '2026-11-22T10:22:13Z',
        }),
      ),
      step(
        16_500,
        doc({
          status: 'passed_after_repair',
          scenario_version: 2,
          execution_ids: [FIRST, SECOND],
          runs: [
            firstRun(),
            checkRunDocument(SECOND, 2, 'passed', [
              ['login', 'ok'],
              ['pay', 'ok'],
              ['confirm', 'ok'],
            ]),
          ],
          repairs: [repair({ verdict: 'passed' })],
          started_at: '2026-11-22T10:22:13Z',
          finished_at: '2026-11-22T10:22:17Z',
        }),
      ),
    ]);
    const call = r.call('scenario_check_self', { scenarios: ['zakupy'] });

    await advanceTo(r, 4000);
    const running = await scenarioAt(r);
    expect(running).toMatchObject({ status: 'running', phase: 'running', run: 1, steps: [] });
    const firstSaved = (await liveView(r))?.savedAt;
    // The same state read again is not written again.
    await advanceTo(r, 7000);
    expect((await liveView(r))?.savedAt).toBe(firstSaved);

    await advanceTo(r, 10_000);
    const repairing = await scenarioAt(r);
    expect(repairing).toMatchObject({
      status: 'repairing',
      phase: 'repairing',
      run: 1,
      repairLimit: 2,
      repairs: [],
      steps: [
        { name: 'login', result: 'ok' },
        { name: 'pay', result: 'failed', http: [403] },
        { name: 'confirm', result: 'skipped' },
      ],
      failure: { step: 'pay', http: 403 },
    });
    expect(repairing['runs']).toEqual([
      {
        run: 1,
        version: 1,
        executionId: FIRST,
        verdict: 'failed',
        results: [
          { step: 0, result: 'ok', http: [200] },
          { step: 1, result: 'failed', http: [403], reason: 'HTTP 403 Forbidden [redacted]' },
          { step: 2, result: 'skipped' },
        ],
      },
    ]);

    // The repair wrote version 2: the check starts again from the first step, so no step has a result yet.
    await advanceTo(r, 13_000);
    const again = await scenarioAt(r);
    expect(again).toMatchObject({
      status: 'pending',
      phase: 'queued',
      version: 2,
      run: 1,
      repairs: [{ round: 1, outcome: 'repaired', text: 'added a header', version: 2 }],
    });
    expect((again['steps'] as Record<string, unknown>[]).map((item) => item['result'])).toEqual([
      undefined,
      undefined,
      undefined,
    ]);

    await advanceTo(r, 16_000);
    const second = await scenarioAt(r);
    expect(second).toMatchObject({ status: 'running', phase: 'running', version: 2, run: 2 });
    expect((second['steps'] as Record<string, unknown>[]).map((item) => item['name'])).toEqual([
      'login',
      'pay',
      'confirm',
    ]);
    expect(
      (second['steps'] as Record<string, unknown>[]).every((item) => !('result' in item)),
    ).toBe(true);

    const result = await settleClock(r, call, { limitMs: 60_000 });
    expect(result.isError, result.text).toBe(false);
    const done = await scenarioAt(r);
    expect(done).toMatchObject({
      status: 'passed_after_repair',
      phase: 'finished',
      run: 2,
      steps: [
        { name: 'login', result: 'ok' },
        { name: 'pay', result: 'ok' },
        { name: 'confirm', result: 'ok' },
      ],
    });
    const state = stateFile(r);
    expect(State.safeParse(state).success).toBe(true);
    expect(JSON.stringify(state)).not.toContain(CANARY);
  });

  it('a check whose repairs were refused ends failed with every refusal in the view', async () => {
    const r = await rig();
    const refused = (round: number): SelfCheckRepairDocument =>
      repair({
        round,
        changes_summary: '',
        refused_reason: `raw words of the model ${CANARY}`,
        refused_code: 'weakens_test',
        refused_message: 'The change would weaken the test.',
        scenario_version_after: null,
      });
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({ status: 'running', execution_ids: [FIRST] })),
      step(
        1500,
        doc({ status: 'repairing', execution_ids: [FIRST], failure: FAILURE, runs: [firstRun()] }),
      ),
      step(
        4500,
        doc({
          status: 'repairing',
          execution_ids: [FIRST],
          failure: FAILURE,
          runs: [firstRun()],
          repairs: [refused(1)],
        }),
      ),
      step(
        7500,
        doc({
          status: 'failed',
          execution_ids: [FIRST],
          failure: FAILURE,
          runs: [firstRun()],
          repairs: [refused(1), refused(2)],
          finished_at: '2026-11-22T10:22:08Z',
        }),
      ),
    ]);
    const call = r.call('scenario_check_self', { scenarios: ['zakupy'] });
    await advanceTo(r, 4000);
    expect(await scenarioAt(r)).toMatchObject({ status: 'repairing', repairs: [] });
    await advanceTo(r, 7000);
    expect(await scenarioAt(r)).toMatchObject({
      status: 'repairing',
      repairs: [
        {
          round: 1,
          outcome: 'refused',
          text: 'The change would weaken the test.',
          reasonCode: 'weakens_test',
        },
      ],
    });
    await settleClock(r, call, { limitMs: 60_000 });
    const done = await scenarioAt(r);
    expect(done).toMatchObject({
      status: 'failed',
      phase: 'finished',
      failure: { step: 'pay', http: 403 },
      repairs: [
        { round: 1, outcome: 'refused' },
        { round: 2, outcome: 'refused' },
      ],
    });
    expect(JSON.stringify(await liveView(r))).not.toContain(CANARY);
  });

  it('a check that was interrupted shows the steps that ran and ends as interrupted', async () => {
    const r = await rig();
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({ status: 'running', execution_ids: [FIRST] })),
      step(
        1500,
        doc({
          status: 'interrupted',
          execution_ids: [FIRST],
          runs: [firstRun(null)],
          finished_at: '2026-11-22T10:22:02Z',
        }),
      ),
    ]);
    const result = await settleClock(r, r.call('scenario_check_self', { scenarios: ['zakupy'] }), {
      limitMs: 60_000,
    });
    expect(result.isError, result.text).toBe(false);
    expect(await scenarioAt(r)).toMatchObject({
      status: 'interrupted',
      phase: 'finished',
      steps: [
        { name: 'login', result: 'ok' },
        { name: 'pay', result: 'failed' },
        { name: 'confirm' },
      ],
    });
  });

  it('the status names no view while no check wrote one', async () => {
    const r = await rig();
    expect(await liveView(r)).toBeUndefined();
  });
});

describe('scenario_check_self: a check no call follows', () => {
  it('a snapshot of the operation reads the check now and writes nothing; at the end it says completed', async () => {
    const r = await rig();
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({ status: 'running', execution_ids: [FIRST] })),
      step(
        110_000,
        doc({ status: 'repairing', execution_ids: [FIRST], failure: FAILURE, runs: [firstRun()] }),
      ),
      step(
        130_000,
        doc({
          status: 'failed',
          execution_ids: [FIRST],
          failure: FAILURE,
          runs: [firstRun()],
          repairs: [repair({ scenario_version_after: null, refused_code: 'no_change' })],
        }),
      ),
    ]);
    // The call waits as long as it may and hands the handle back: from then on nobody follows the check.
    const first = await settleClock(r, r.call('scenario_check_self', { scenarios: ['zakupy'] }), {
      limitMs: 105_000,
    });
    const handle = first.outcome?.operation ?? '';
    expect(handle).toMatch(/^self_check:sc-/u);
    const savedBefore = (await liveView(r))?.savedAt;
    await advanceTo(r, 120_000);
    const snapshot = async (): Promise<Record<string, unknown>> => {
      const result = await r.call('process_get_status', { operation: handle, format: 'data' });
      expect(result.isError, result.text).toBe(false);
      return result.outcome?.data as Record<string, unknown>;
    };
    const during = await snapshot();
    expect(during['phase']).toBeUndefined();
    const view = during['selfCheck'] as { key: string; scenarios: Record<string, unknown>[] };
    expect(view.key).toBe(handle.slice('self_check:'.length));
    expect(view.scenarios[0]).toMatchObject({
      status: 'repairing',
      failure: { step: 'pay', http: 403 },
    });
    expect(JSON.stringify(during)).not.toContain(CANARY);
    // A snapshot is a read only: the state file keeps the view the call wrote last.
    expect((await liveView(r))?.savedAt).toBe(savedBefore);

    await advanceTo(r, 140_000);
    const after = await snapshot();
    expect(after['phase']).toBe('completed');
    expect(
      (after['selfCheck'] as { scenarios: Record<string, unknown>[] }).scenarios[0],
    ).toMatchObject({ status: 'failed' });
  });
});

describe('the state view of a step made more than once', () => {
  const pass = (result: CheckRunStepView['result'], http: number | null, reason: string | null) =>
    ({
      name: 'poll',
      group: null,
      planIndex: 0,
      isPreflight: false,
      method: 'GET',
      path: '/status',
      result,
      httpStatus: http,
      reason,
    }) satisfies CheckRunStepView;

  it('shows the worst pass of a loop, with its status and reason', () => {
    const check: ScenarioCheck = {
      name: 'zakupy',
      status: 'failed',
      steps: [],
      requests: 0,
      responseMs: 0,
      failure: null,
      notes: [],
      missingSlots: [],
      repairs: [],
      runs: [
        {
          executionId: FIRST,
          version: 1,
          status: 'failed',
          stepsOmitted: 0,
          steps: [pass('ok', 200, null), pass('failed', 500, 'HTTP 500'), pass('ok', 200, null)],
        },
      ],
    };
    const [scenario] = buildSelfCheckView(null, [
      { id: 's1', check, version: 1, startedAt: null, finishedAt: null },
    ]).scenarios;
    expect(scenario?.steps).toEqual([
      { name: 'poll', method: 'GET', path: '/status', result: 'failed', http: [500] },
    ]);
    expect(scenario?.runs[0]?.results).toEqual([
      { step: 0, result: 'failed', http: [500], reason: 'HTTP 500' },
    ]);
  });
});
