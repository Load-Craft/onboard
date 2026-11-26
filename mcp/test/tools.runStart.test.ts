import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import {
  renderRunStarted,
  type RunConfirmData,
  type RunDoneData,
} from '../src/render/views/run.js';
import { runStart } from '../src/tools/runStart.js';
import { goldenText, SKLEP_IDS } from './golden/index.js';
import { registerDataRoutes } from './fake-backend/routes/data.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
  startedRuns,
  type RunScript,
} from './fake-backend/routes/executions.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import type { Fake } from './fake-backend/server.js';
import { SKLEP_COLLECTIONS, seedSklep, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

type GoldenRun = Parameters<typeof goldenText>[0];

const NOW = Date.parse('2026-11-22T11:00:00Z');

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

const EXECUTE = '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/execute';
const START = '/api/v1/projects/{project_id}/gatling/executions';
const RAMP_2000 = { type: 'ramp_concurrency', vusers: 2000, ramp: 600 } as const;

/** A run that is over at the first read: the call returns the finished view at once. */
const INSTANT: RunScript = {
  startsAtS: 0,
  loadS: 0,
  end: 'completed',
  live: () => ({ rps: 0, p95: 0, errorRate: 0 }),
  final: { rps: 690, p95: 1120, errorRate: 0.006 },
  series: [10, 20, 30],
};

/** A run that is still going when the call stops waiting. */
const LONG: RunScript = { ...INSTANT, startsAtS: 5, loadS: 3600 };

interface RigOptions {
  /** The run is still going after the first second of the wait; default: it is over at once. */
  readonly running?: boolean;
  readonly locale?: 'en' | 'pl';
  readonly setup?: (fake: Fake) => void;
  readonly files?: Record<string, string>;
  readonly meta?: { api_revision: number };
}

async function rig(options: RigOptions = {}): Promise<ToolRig> {
  const clock = createTestClock(NOW);
  return toolRig({
    tools: [runStart],
    world: (fake) => {
      scriptRuns(fake, clock, options.running === true ? LONG : INSTANT);
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerDataRoutes(fake);
      registerExecutionRoutes(fake);
      seedSklep(fake.store, { stage: 'data' });
      options.setup?.(fake);
    },
    ...(options.meta === undefined ? {} : { fake: { meta: options.meta } }),
    clock,
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: options.files ?? BOUND,
  });
}

interface Finished {
  readonly text: string;
  readonly data: RunDoneData;
}

/** A call whose run is over at the first read: the finished view, with its data. */
async function start(r: ToolRig, args: Record<string, unknown>): Promise<Finished> {
  const result = await settleClock(r, r.call('run_start', args));
  if (result.isError) throw new Error(`run_start failed: ${result.text}`);
  const structured = result.outcome as { status: string; data: RunDoneData };
  expect(structured.status).toBe('done');
  return { text: result.text, data: structured.data };
}

interface Running {
  readonly text: string;
  readonly operation: string;
}

/** A call that stops waiting while the run goes on: the text and the handle. */
async function startRunning(r: ToolRig, args: Record<string, unknown>): Promise<Running> {
  const result = await settleClock(r, r.call('run_start', { ...args, max_wait_s: 1 }));
  if (result.isError) throw new Error(`run_start failed: ${result.text}`);
  const structured = result.outcome as { status: string; operation: string };
  expect(structured.status).toBe('running');
  return { text: result.text, operation: structured.operation };
}

const setCaps =
  (
    environment: 'perf' | 'qa' | 'prod',
    caps: Record<string, unknown> | null,
    isProtected?: boolean,
  ) =>
  (fake: Fake): void => {
    fake.store
      .collection(SKLEP_COLLECTIONS.environments)
      .update(SKLEP_WORLD_IDS.environments[environment], {
        workload_caps: caps,
        ...(isProtected === undefined ? {} : { protected: isProtected }),
      });
  };

const posts = (r: ToolRig): string[] =>
  r.fake.calls.filter((call) => call.method === 'POST').map((call) => call.path);

const executeCalls = (r: ToolRig): number =>
  r.fake.calls.filter(
    (call) =>
      call.method === 'POST' &&
      (call.path.endsWith('/execute') || call.path.endsWith('/gatling/executions')),
  ).length;

/** Lines of a golden file this stage draws: everything before the link of the live run. */
function goldenHead(run: GoldenRun, name: string): string {
  const lines = goldenText(run, name).split('\n');
  return lines
    .slice(
      0,
      lines.findIndex((line) => line.startsWith('↗ ')),
    )
    .join('\n');
}

function goldenLink(run: GoldenRun, name: string): string {
  const line = goldenText(run, name)
    .split('\n')
    .find((candidate) => candidate.startsWith('↗ '));
  return (line ?? '').slice(2);
}

function savedOperations(
  r: ToolRig,
): Record<string, { value: { kind: string; id: string; saved: Record<string, unknown> } }> {
  const file = join(r.workspace, 'loadcraft', '.cache', 'state.json');
  const state = JSON.parse(readFileSync(file, 'utf8')) as {
    opPayloads?: Record<
      string,
      { value: { kind: string; id: string; saved: Record<string, unknown> } }
    >;
  };
  return state.opPayloads ?? {};
}

/** The view wraps long lines; a test reads them as one line. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ');

describe('run_start', () => {
  describe('composition on perf (no limits)', () => {
    it('checks the data with the profile, then starts the run with the thresholds inside workload', async () => {
      const r = await rig({
        locale: 'pl',
        setup: (fake) => planExecutionIds(fake, [SKLEP_IDS.executionPerf]),
      });
      const started = await start(r, {
        scenario: 'checkout',
        environment: 'perf',
        profile: RAMP_2000,
        thresholds: { p95_ms: 1500, error_rate_pct: 1 },
      });

      expect(posts(r)).toEqual([
        `/api/v1/projects/${SKLEP_IDS.project}/gatling/compositions/${SKLEP_WORLD_IDS.composition}/feeders/preflight`,
        `/api/v1/projects/${SKLEP_IDS.project}/gatling/compositions/${SKLEP_WORLD_IDS.composition}/execute`,
      ]);
      const preflight = r.fake.calls.find((call) => call.path.endsWith('/feeders/preflight'));
      expect(preflight?.body).toEqual({
        workload: { type: 'ramp_concurrency', vusers: 2000, ramp: 600, hold: 0 },
      });
      const [run] = startedRuns(r.fake);
      expect(run?.body).toEqual({
        environment_id: SKLEP_WORLD_IDS.environments.perf,
        workload: {
          type: 'ramp_concurrency',
          vusers: 2000,
          ramp: 600,
          hold: 0,
          thresholds: [
            { type: 'responseTime', percentile: 95, max_ms: 1500 },
            { type: 'failedRequests', max_percent: 1 },
          ],
        },
      });

      expect(started.text.startsWith(`${goldenHead('run1', '10-run_start')}\n`)).toBe(true);
      expect(started.text.split('\n')).toContain(`↗ ${goldenLink('run1', '10-run_start')}`);
      expect(started.data).toMatchObject({
        execution: { id: SKLEP_IDS.executionPerf, handle: 'e-3f9a12c4' },
        target: { kind: 'composition', name: 'checkout' },
        environment: { name: 'perf', protected: false, caps: {} },
        requested: RAMP_2000,
        effective: RAMP_2000,
        clamped: false,
        dataCheck: [
          { slot: 'Search terms', dataset: 'frazy wyszukiwania', have: 500, need: null },
          { slot: 'Quantity & cardnumber', dataset: 'zamówienia', have: 2000, need: null },
          { slot: 'User accounts', dataset: 'konta', have: 2000, need: 1200 },
        ],
        link: goldenLink('run1', '10-run_start'),
      });
    });

    it('records the run in the workspace with what was asked for and what was sent', async () => {
      const r = await rig({
        running: true,
        setup: (fake) => planExecutionIds(fake, [SKLEP_IDS.executionPerf]),
      });
      await startRunning(r, {
        scenario: 'checkout',
        environment: 'perf',
        profile: RAMP_2000,
        thresholds: { p95_ms: 1500 },
      });
      const entry = savedOperations(r)[`test_run:${SKLEP_IDS.executionPerf}`];
      expect(entry?.value).toMatchObject({
        kind: 'test_run',
        id: SKLEP_IDS.executionPerf,
        saved: {
          requested: RAMP_2000,
          effective: RAMP_2000,
          clamped: false,
          environment: {
            id: SKLEP_WORLD_IDS.environments.perf,
            name: 'perf',
            protected: false,
            caps: {},
          },
          thresholds: [{ type: 'responseTime', percentile: 95, max_ms: 1500 }],
          startedAt: NOW,
        },
      });
    });

    it('sends no thresholds when none are asked for', async () => {
      const r = await rig();
      await start(r, { scenario: 'checkout', environment: 'perf', profile: RAMP_2000 });
      expect(startedRuns(r.fake)[0]?.workload).toEqual({
        type: 'ramp_concurrency',
        vusers: 2000,
        ramp: 600,
        hold: 0,
      });
    });

    it('ignores confirm_capped on an environment that neither protects nor clamps', async () => {
      const r = await rig();
      await start(r, {
        scenario: 'checkout',
        environment: 'perf',
        profile: RAMP_2000,
        confirm_capped: true,
      });
      expect(startedRuns(r.fake)).toHaveLength(1);
    });
  });

  describe('protected environment qa (limit 100 users, 20 new/s)', () => {
    it('without confirm_capped: a consent request with the numbers, and nothing is sent', async () => {
      const r = await rig();
      const result = await r.call('run_start', {
        scenario: 'checkout',
        environment: 'qa',
        profile: RAMP_2000,
      });
      expect(result.isError).toBe(false);
      const structured = result.outcome as { status: string; data: RunConfirmData };
      expect(structured.status).toBe('done');
      expect(structured.data).toEqual({
        needsConfirmation: true,
        target: { kind: 'composition', name: 'checkout' },
        environment: { name: 'qa', protected: true, caps: { maxVu: 100, maxRps: 20 } },
        label: 'Ramp load (closed)',
        requested: RAMP_2000,
        effective: { ...RAMP_2000, vusers: 100 },
        clamped: true,
      });
      // The model may see only the text: the numbers and the next step are there.
      const text = oneLine(result.text);
      expect(text).toContain(
        'Test of checkout not started: qa is protected and the profile is above its limits',
      );
      expect(text).toContain('Asked for: Ramp load (closed), 2,000 · would run with: 100');
      expect(text).toContain('limit of qa: 100 users / 20 new/s');
      expect(text).toContain('Ask the user');
      expect(text).toContain('confirm_capped: true');
      expect(executeCalls(r)).toBe(0);
      expect(posts(r)).toEqual([]);
    });

    it('asks for consent on a protected environment even when nothing is clamped', async () => {
      const r = await rig();
      const result = await r.call('run_start', {
        scenario: 'checkout',
        environment: 'qa',
        profile: { type: 'smoke', vusers: 1 },
      });
      expect(result.isError).toBe(false);
      expect((result.outcome as { data: RunConfirmData }).data.clamped).toBe(false);
      expect(oneLine(result.text)).toContain('Test of checkout not started: qa is protected;');
      expect(posts(r)).toEqual([]);
    });

    it('asks for consent on an unprotected environment when the profile is clamped (pl)', async () => {
      const r = await rig({ locale: 'pl', setup: setCaps('perf', { max_vu: 500 }) });
      const result = await r.call('run_start', {
        scenario: 'checkout',
        environment: 'perf',
        profile: RAMP_2000,
      });
      expect(result.isError).toBe(false);
      await expect(result.text).toMatchFileSnapshot('__snapshots__/runStart.confirm.pl.txt');
      expect(posts(r)).toEqual([]);
    });

    it('with confirm_capped: the run carries the clamped load, 100 users', async () => {
      const r = await rig({
        running: true,
        locale: 'pl',
        setup: (fake) => planExecutionIds(fake, [SKLEP_IDS.executionQa]),
      });
      const started = await startRunning(r, {
        scenario: 'checkout',
        environment: 'qa',
        profile: RAMP_2000,
        confirm_capped: true,
      });
      const [run] = startedRuns(r.fake);
      expect(run?.workload).toMatchObject({ type: 'ramp_concurrency', vusers: 100, ramp: 600 });
      const preflight = r.fake.calls.find((call) => call.path.endsWith('/feeders/preflight'));
      expect(preflight?.body).toMatchObject({ workload: { vusers: 100 } });
      expect(started.text.startsWith(`${goldenHead('run5', '11-run_start-qa')}\n`)).toBe(true);
      expect(started.text.split('\n')).toContain(`↗ ${goldenLink('run5', '11-run_start-qa')}`);
      expect(started.operation).toBe(`test_run:${SKLEP_IDS.executionQa}`);
      expect(savedOperations(r)[`test_run:${SKLEP_IDS.executionQa}`]?.value.saved).toMatchObject({
        clamped: true,
        requested: { vusers: 2000 },
        effective: { vusers: 100 },
      });
    });

    it('a spike is halved: its second burst stays within the limit', async () => {
      const r = await rig();
      await start(r, {
        scenario: 'checkout',
        environment: 'qa',
        profile: { type: 'spike', vusers: 1000, ramp: 60, hold: 60 },
        confirm_capped: true,
      });
      expect(startedRuns(r.fake)[0]?.workload).toMatchObject({ type: 'spike', vusers: 50 });
    });

    it('refuses a spike at a limit of one user, before anything is sent', async () => {
      const r = await rig({ setup: setCaps('qa', { max_vu: 1 }) });
      const result = await r.call('run_start', {
        scenario: 'checkout',
        environment: 'qa',
        profile: { type: 'spike', vusers: 10, ramp: 60, hold: 60 },
        confirm_capped: true,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('→ ');
      expect(posts(r)).toEqual([]);
    });

    it('refuses stress stairs whose lowest top (5 new/s) is above the per-second limit', async () => {
      const r = await rig({ setup: setCaps('qa', { max_rps: 3 }) });
      const result = await r.call('run_start', {
        scenario: 'checkout',
        environment: 'qa',
        profile: { type: 'stress', vusers: 10, ramp: 60 },
        confirm_capped: true,
      });
      expect(result.isError).toBe(true);
      expect(oneLine(result.text)).toContain('5 new/s');
      expect(posts(r)).toEqual([]);
    });
  });

  it('refuses when the data is short for the profile, with the numbers, and starts nothing', async () => {
    const r = await rig();
    const result = await r.call('run_start', {
      scenario: 'checkout',
      environment: 'perf',
      profile: { type: 'ramp_concurrency', vusers: 5000, ramp: 600 },
    });
    expect(result.isError).toBe(true);
    const text = oneLine(result.text);
    // Accounts: 2 000 rows, 60% of 5 000 users need one each.
    expect(text).toContain('User accounts (slot: accounts): 2,000 of 3,000 rows');
    expect(text).toContain('data_check_readiness');
    expect(executeCalls(r)).toBe(0);
  });

  it('refuses a protected environment without limits before anything is sent', async () => {
    const r = await rig({ setup: setCaps('prod', null) });
    const result = await r.call('run_start', {
      scenario: 'checkout',
      environment: 'prod',
      profile: { type: 'smoke', vusers: 1 },
      confirm_capped: true,
    });
    expect(result.isError).toBe(true);
    expect(oneLine(result.text)).toContain('prod is protected and has no load limits');
    expect(result.text).toContain('→ ');
    expect(posts(r)).toEqual([]);
  });

  // An unprotected environment is the dangerous case: with an unreadable limit read as "no
  // limit", nothing would be clamped and no consent asked, and the full load would start.
  it.each([
    ['a word', { max_vu: 'many' }],
    ['zero', { max_vu: 0 }],
    ['a negative rate', { max_rps: -5 }],
  ])(
    'refuses limits it cannot read (%s), even on an unprotected environment',
    async (_name, caps) => {
      const r = await rig({ setup: setCaps('perf', caps) });
      const result = await r.call('run_start', {
        scenario: 'checkout',
        environment: 'perf',
        profile: RAMP_2000,
        confirm_capped: true,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('The load limits of perf cannot be read');
      expect(result.text).toContain('→ Check max_vu and max_rps of perf');
      expect(posts(r)).toEqual([]);
    },
  );

  it('refuses unreadable limits on a protected environment the same way', async () => {
    const r = await rig({ setup: setCaps('qa', { max_vu: 'many' }) });
    const result = await r.call('run_start', {
      scenario: 'checkout',
      environment: 'qa',
      profile: { type: 'smoke', vusers: 1 },
      confirm_capped: true,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('The load limits of qa cannot be read');
    expect(posts(r)).toEqual([]);
  });

  it('starts a single scenario with POST executions, after its own data check', async () => {
    const r = await rig();
    await start(r, {
      scenario: 'przeglądanie',
      environment: 'perf',
      profile: { type: 'constant', vusers: 4, hold: 900 },
    });
    const scenarioId = startedRuns(r.fake)[0]?.target_id;
    expect(posts(r)).toEqual([
      `/api/v1/projects/${SKLEP_IDS.project}/gatling/executions/preflight`,
      `/api/v1/projects/${SKLEP_IDS.project}/gatling/executions`,
    ]);
    expect(r.fake.calls.find((call) => call.path.endsWith('/executions/preflight'))?.body).toEqual({
      scenario_id: scenarioId,
      environment_id: SKLEP_WORLD_IDS.environments.perf,
      workload: { type: 'constant', vusers: 4, ramp: 0, hold: 900 },
    });
    expect(startedRuns(r.fake)[0]?.body).toEqual({
      scenario_id: scenarioId,
      environment_id: SKLEP_WORLD_IDS.environments.perf,
      workload: { type: 'constant', vusers: 4, ramp: 0, hold: 900 },
    });
  });

  describe('input', () => {
    it.each([
      ['no environment', { scenario: 'checkout', profile: RAMP_2000 }],
      ['a version', { scenario: 'checkout', environment: 'perf', profile: RAMP_2000, version: 2 }],
      [
        'no users for smoke',
        { scenario: 'checkout', environment: 'perf', profile: { type: 'smoke' } },
      ],
      [
        'a production plan',
        { scenario: 'checkout', environment: 'perf', profile: { type: 'production', vusers: 10 } },
      ],
      [
        'thresholds outside the range',
        {
          scenario: 'checkout',
          environment: 'perf',
          profile: RAMP_2000,
          thresholds: { error_rate_pct: 101 },
        },
      ],
    ])('rejects %s before calling LoadCraft', async (_name, args) => {
      const r = await rig();
      const result = await r.call('run_start', args);
      expect(result.isError).toBe(true);
      expect(r.fake.calls).toEqual([]);
    });
  });

  describe('errors', () => {
    it('turns 409 full_rebuild_required into "generate the scenario again"', async () => {
      const r = await rig();
      r.fake.faults.next(
        'POST',
        EXECUTE,
        {
          status: 409,
          body: {
            detail:
              "full_rebuild_required: scenario 'x' ('zakupy') has no modular build — Regenerate this scenario.",
          },
        },
        { outsideContract: true },
      );
      const result = await r.call('run_start', {
        scenario: 'checkout',
        environment: 'perf',
        profile: RAMP_2000,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('generated again');
      expect(result.text).toContain('→ ');
      expect(result.text).toContain('scenario_generate');
    });

    it('maps the same refusal on the start of a single scenario', async () => {
      const r = await rig();
      r.fake.faults.next(
        'POST',
        START,
        {
          status: 409,
          body: {
            detail: "full_rebuild_required: scenario 'x' ('przeglądanie') has no modular build",
          },
        },
        { outsideContract: true },
      );
      const result = await r.call('run_start', {
        scenario: 'przeglądanie',
        environment: 'perf',
        profile: { type: 'smoke', vusers: 1 },
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('scenario_generate');
      expect(startedRuns(r.fake)).toEqual([]);
    });

    it.each([
      [
        'workload_exceeds_environment_caps',
        'This run would put 120 users at its peak, above max_vu 100 of environment "qa" (checkout: ramp of 60 users puts 60 users and zakupy: ramp of 60 users puts 60 users).',
      ],
      [
        'spike_exceeds_environment_caps',
        'A spike workload bursts to 2 times its users at its peak, so it needs max_vu of at least 2.',
      ],
    ])(
      'maps the refusal %s on the start of a composition: code, backend sentence, no retry',
      async (code, message) => {
        for (const locale of ['en', 'pl'] as const) {
          const r = await rig({ locale });
          r.fake.faults.next(
            'POST',
            EXECUTE,
            {
              status: 409,
              body: { detail: { code, message, project_id: SKLEP_IDS.project } },
            },
            { outsideContract: true },
          );
          const result = await r.call('run_start', {
            scenario: 'checkout',
            environment: 'perf',
            profile: RAMP_2000,
          });
          expect(result.isError).toBe(true);
          expect(result.text).toContain(`[${code}]`);
          expect(result.text).toContain(message);
          expect(result.text).toContain('run_plan');
          expect(executeCalls(r)).toBe(1);
          expect(startedRuns(r.fake)).toEqual([]);
        }
      },
    );

    it('maps the same refusal on the start of a single scenario', async () => {
      const r = await rig();
      r.fake.faults.next(
        'POST',
        START,
        {
          status: 409,
          body: {
            detail: {
              code: 'spike_exceeds_environment_caps',
              message: 'A spike needs max_vu of at least 2.',
              project_id: SKLEP_IDS.project,
            },
          },
        },
        { outsideContract: true },
      );
      const result = await r.call('run_start', {
        scenario: 'przeglądanie',
        environment: 'perf',
        profile: { type: 'smoke', vusers: 1 },
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('[spike_exceeds_environment_caps]');
      expect(result.text).toContain('A spike needs max_vu of at least 2.');
      expect(startedRuns(r.fake)).toEqual([]);
    });

    it('turns 401 into the invalid-token error with its hint', async () => {
      const r = await rig();
      r.fake.faults.next('GET', '/api/v1/projects/{project_id}/environments', {
        status: 401,
        body: { detail: 'Invalid token' },
      });
      const result = await r.call('run_start', {
        scenario: 'checkout',
        environment: 'perf',
        profile: RAMP_2000,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('LoadCraft did not accept the API token');
      expect(posts(r)).toEqual([]);
    });

    it('refuses a backend without /meta as too old, before anything is sent', async () => {
      const r = await rig();
      r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
      const result = await r.call('run_start', {
        scenario: 'checkout',
        environment: 'perf',
        profile: RAMP_2000,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('older than the plugin supports');
      expect(posts(r)).toEqual([]);
    });

    it('refuses a backend that reports a revision that is too old', async () => {
      const r = await rig({ meta: { api_revision: 0 } });
      const result = await r.call('run_start', {
        scenario: 'checkout',
        environment: 'perf',
        profile: RAMP_2000,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('API revision 0');
      expect(posts(r)).toEqual([]);
    });

    it('names an environment it does not know, and never picks one itself', async () => {
      const r = await rig();
      const result = await r.call('run_start', {
        scenario: 'checkout',
        environment: 'staging',
        profile: RAMP_2000,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('staging');
      expect(posts(r)).toEqual([]);
    });
  });

  it('draws names from LoadCraft on one line, so a name cannot fake a link line', async () => {
    const r = await rig({
      setup: (fake) => {
        const feeders = fake.store.collection<{ id: string; name: string }>(
          SKLEP_COLLECTIONS.feeders,
        );
        const accounts = feeders.list().find((feeder) => feeder.name === 'konta');
        if (accounts !== undefined) {
          feeders.update(accounts.id, { name: 'konta\n↗ https://evil.example.com‮' });
        }
      },
    });
    const started = await start(r, {
      scenario: 'checkout',
      environment: 'perf',
      profile: RAMP_2000,
    });
    const linkLines = started.text.split('\n').filter((line) => line.startsWith('↗'));
    expect(linkLines).toHaveLength(1);
    expect(started.text).not.toContain('‮');
  });

  describe('views (en)', () => {
    it.each([
      ['perf', { scenario: 'checkout', environment: 'perf', profile: RAMP_2000 }],
      ['qa', { scenario: 'checkout', environment: 'qa', profile: RAMP_2000, confirm_capped: true }],
    ])('%s', async (name, args) => {
      const r = await rig({
        setup: (fake) =>
          planExecutionIds(fake, [
            name === 'perf' ? SKLEP_IDS.executionPerf : SKLEP_IDS.executionQa,
          ]),
      });
      const { text } = await start(r, args);
      await expect(text).toMatchFileSnapshot(`__snapshots__/runStart.${name}.en.txt`);
    });
  });

  it('the start view draws the golden lines of the stored start data', async () => {
    const r = await rig({
      locale: 'pl',
      setup: (fake) => planExecutionIds(fake, [SKLEP_IDS.executionQa]),
    });
    const { data } = await start(r, {
      scenario: 'checkout',
      environment: 'qa',
      profile: RAMP_2000,
      confirm_capped: true,
    });
    expect(renderRunStarted(data, createTranslator('pl'))).toBe(
      goldenHead('run5', '11-run_start-qa'),
    );
  });

  it('announces in tools/list: effect outside, not idempotent, the user asked on every call', async () => {
    const r = await rig();
    const [listed] = (await r.session.listTools()).filter((tool) => tool.name === 'run_start');
    expect(listed?.annotations).toMatchObject({ openWorldHint: true, idempotentHint: false });
    expect(listed?.annotations?.['readOnlyHint']).not.toBe(true);
    expect(listed?.meta).toEqual({ 'anthropic/requiresUserInteraction': true });
  });

  // The fake starts exactly the load it receives, so what it records is the load the plugin sent
  // towards the system under test.
  describe('property: the load received never exceeds the limit', () => {
    /** Deterministic PRNG (mulberry32), so a failing case can be replayed. */
    function prng(seed: number): () => number {
      let state = seed >>> 0;
      return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    const TYPES = [
      'smoke',
      'ramp',
      'constant',
      'ramp_hold',
      'stress',
      'ramp_concurrency',
      'constant_concurrency',
      'spike',
      'soak',
    ] as const;

    /**
     * Peak of every phase the backend injects, per limit family (`config_generator.py:664-765`):
     * users or concurrency bounded by `max_vu`, arrivals per second bounded by `max_rps`.
     */
    function peaks(workload: { type: string; vusers: number }): { vu: number[]; rps: number[] } {
      const v = workload.vusers;
      switch (workload.type) {
        case 'smoke':
        case 'ramp':
        case 'ramp_concurrency':
        case 'constant_concurrency':
        case 'soak':
          return { vu: [v], rps: [] };
        case 'spike':
          return { vu: [v, v * 2], rps: [] };
        case 'constant':
          return { vu: [], rps: [v] };
        case 'ramp_hold':
          return { vu: [v], rps: [v] };
        case 'stress': {
          const step = Math.max(v / 5, 1);
          return { vu: [], rps: [1, 2, 3, 4, 5].map((level) => level * step) };
        }
        default:
          throw new Error(`unknown type ${workload.type}`);
      }
    }

    /** Runs one case on qa with confirmation; checks every phase that reached the fake. */
    async function tryCase(
      r: ToolRig,
      type: (typeof TYPES)[number],
      vusers: number,
      caps: Record<string, number>,
    ): Promise<'started' | 'refused'> {
      r.fake.store
        .collection(SKLEP_COLLECTIONS.environments)
        .update(SKLEP_WORLD_IDS.environments.qa, { workload_caps: caps });
      const before = startedRuns(r.fake).length;
      const result = await r.call('run_start', {
        scenario: 'checkout',
        environment: 'qa',
        profile: { type, vusers, ramp: 60, hold: 60 },
        confirm_capped: true,
      });
      const runs = startedRuns(r.fake);
      const label = JSON.stringify({ type, vusers, caps });
      if (result.isError) {
        expect(runs, label).toHaveLength(before);
        return 'refused';
      }
      expect(runs, label).toHaveLength(before + 1);
      const workload = runs.at(-1)?.workload as { type: string; vusers: number };
      const { vu, rps } = peaks(workload);
      const sent = JSON.stringify({ caps, workload });
      for (const peak of vu) expect(peak, sent).toBeLessThanOrEqual(caps['max_vu'] ?? Infinity);
      for (const peak of rps) expect(peak, sent).toBeLessThanOrEqual(caps['max_rps'] ?? Infinity);
      return 'started';
    }

    // 20 seeded cases by default, every type at least twice (the type goes round, the users and the
    // limits are drawn); RUN_TEST_PROPERTY_CASES=60 (or more) for a longer run by hand. The small
    // limits and the users at the limit are the edge cases below, one test each.
    const RANDOM_CASES = Number(process.env.RUN_TEST_PROPERTY_CASES ?? '20');

    it('over random profiles and limits, with confirmation', async () => {
      const random = prng(0x15_2026);
      const r = await rig();
      let started = 0;
      for (let i = 0; i < RANDOM_CASES; i += 1) {
        const type = TYPES[i % TYPES.length] ?? 'ramp';
        const vusers = 1 + Math.floor(random() * 5000);
        const caps: Record<string, number> = {};
        if (random() < 0.8) caps['max_vu'] = 1 + Math.floor(random() * 300);
        if (random() < 0.8) caps['max_rps'] = 1 + Math.floor(random() * 40);
        if (Object.keys(caps).length === 0) caps['max_vu'] = 1 + Math.floor(random() * 300);
        if ((await tryCase(r, type, vusers, caps)) === 'started') started += 1;
      }
      expect(started).toBeGreaterThan(RANDOM_CASES / 2);
    }, 30_000);

    // Small limits, and users at, just under and just over the limit, for every type and both
    // limit families: the cases a seed may never hit.
    const FAMILIES: [string, (limit: number) => Record<string, number>][] = [
      ['max_vu', (limit) => ({ max_vu: limit })],
      ['max_rps', (limit) => ({ max_rps: limit })],
      ['max_vu + max_rps', (limit) => ({ max_vu: limit, max_rps: limit })],
    ];
    const EDGE_CASES = TYPES.flatMap((type) =>
      FAMILIES.map(([name, family]) => [type, name, family] as const),
    );

    // One test per type and limit family, each with its own rig and time budget, so a slow machine
    // fails one named case instead of one test that makes hundreds of calls.
    it.each(EDGE_CASES)(
      'at the edges: %s under %s, limits 1, 2, 5 and users 1, limit, limit + 1',
      async (type, _name, family) => {
        const r = await rig();
        for (const limit of [1, 2, 5]) {
          for (const vusers of new Set([1, limit, limit + 1])) {
            const caps = family(limit);
            const outcome = await tryCase(r, type, vusers, caps);
            // Only the two profiles no clamp can fit may be refused.
            const unfit =
              (type === 'spike' && caps['max_vu'] === 1) ||
              (type === 'stress' && (caps['max_rps'] ?? Infinity) < 5);
            expect(outcome, JSON.stringify({ type, vusers, caps })).toBe(
              unfit ? 'refused' : 'started',
            );
          }
        }
      },
    );
  });
});
