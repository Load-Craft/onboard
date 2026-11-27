// `run_start` with `dry_run: true`: the facts a client wants before a test (the environment and its
// limits, what the limits do to the profile, whether consent is needed, whether the data is
// enough, whether the environment is free), with nothing started, nothing recorded and nothing
// held. The same facts come as one JSON block with `format: "data"`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { processGetStatus } from '../src/tools/processGetStatus.js';
import { runStart } from '../src/tools/runStart.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerDataRoutes } from './fake-backend/routes/data.js';
import {
  registerExecutionRoutes,
  scriptRuns,
  seedForeignRun,
  startedRuns,
  type RunScript,
} from './fake-backend/routes/executions.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import type { Fake } from './fake-backend/server.js';
import { SKLEP_COLLECTIONS, seedSklep, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { CANARY, toolRig, type ToolRig } from './helpers/rig.js';

const NOW = Date.parse('2026-11-22T11:00:00Z');
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};
const RAMP_2000 = { type: 'ramp_concurrency', vusers: 2000, ramp: 600 } as const;

const LONG: RunScript = {
  startsAtS: 5,
  loadS: 3600,
  end: 'completed',
  live: () => ({ rps: 0, p95: 0, errorRate: 0 }),
  final: { rps: 0, p95: 0, errorRate: 0 },
  series: [],
};

async function rig(
  options: { locale?: 'en' | 'pl'; setup?: (fake: Fake) => void } = {},
): Promise<ToolRig> {
  const clock = createTestClock(NOW);
  return toolRig({
    tools: [processGetStatus, runStart],
    world: (fake) => {
      scriptRuns(fake, clock, LONG);
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerDataRoutes(fake);
      registerExecutionRoutes(fake);
      seedSklep(fake.store, { stage: 'data' });
      options.setup?.(fake);
    },
    clock,
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: BOUND,
  });
}

interface DryRunFacts {
  readonly dry_run: true;
  readonly environment: {
    name: string;
    protected: boolean;
    limit?: { max_vu?: number; max_rps?: number };
  };
  readonly profile_requested: { type: string; vusers: number; ramp?: number; hold?: number };
  readonly profile_effective: { type: string; vusers: number; ramp?: number; hold?: number };
  readonly capped: boolean;
  readonly consent_required: boolean;
  readonly data: {
    needed: number | null;
    available: number | null;
    ready: boolean;
    slots: { slot: string; have: number | null; need: number | null }[];
  };
  readonly planned_s: number | null;
  readonly busy: { handle: string } | null;
}

const dryRun = (r: ToolRig, args: Record<string, unknown>) => {
  const { format, ...preflight } = args;
  return settleClock(
    r,
    r.call('process_get_status', { preflight, ...(format === undefined ? {} : { format }) }),
  );
};

async function facts(r: ToolRig, args: Record<string, unknown>): Promise<DryRunFacts> {
  const result = await dryRun(r, { format: 'data', ...args });
  if (result.isError) throw new Error(`run_start failed: ${result.text}`);
  expect(result.structured).toBeUndefined();
  return JSON.parse(result.text) as DryRunFacts;
}

const startCalls = (r: ToolRig): string[] =>
  r.fake.calls
    .filter(
      (call) =>
        call.method === 'POST' &&
        (call.path.endsWith('/execute') || call.path.endsWith('/gatling/executions')),
    )
    .map((call) => call.path);

const posts = (r: ToolRig): string[] =>
  r.fake.calls.filter((call) => call.method === 'POST').map((call) => call.path);

const golden = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'golden', 'mod', name), 'utf8').replace(/\n$/u, '');

describe('process_get_status preflight', () => {
  it('on a protected environment with a limit of 100 reports the clamped profile, and starts nothing', async () => {
    const r = await rig();
    const answer = await facts(r, {
      scenario: 'checkout',
      environment: 'qa',
      profile: RAMP_2000,
    });
    expect(answer).toMatchObject({
      dry_run: true,
      environment: { name: 'qa', protected: true, limit: { max_vu: 100, max_rps: 20 } },
      profile_requested: RAMP_2000,
      capped: true,
      consent_required: true,
      planned_s: 600,
      busy: null,
    });
    expect(answer.profile_effective.vusers).toBeLessThanOrEqual(100);
    expect(answer.data.ready).toBe(true);

    // The only POST is the read-only data check; no execute, no executions, nothing recorded.
    expect(startCalls(r)).toEqual([]);
    expect(posts(r)).toEqual([
      `/api/v1/projects/${SKLEP_IDS.project}/gatling/compositions/${SKLEP_WORLD_IDS.composition}/feeders/preflight`,
    ]);
    expect(startedRuns(r.fake)).toHaveLength(0);
    expect(() =>
      readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
    ).toThrow();
  });

  it('on an environment without limits and without protection needs no consent', async () => {
    const r = await rig();
    const answer = await facts(r, {
      scenario: 'checkout',
      environment: 'perf',
      profile: RAMP_2000,
    });
    expect(answer).toMatchObject({
      environment: { name: 'perf', protected: false },
      capped: false,
      consent_required: false,
      profile_effective: RAMP_2000,
    });
    expect(answer.environment.limit).toBeUndefined();
  });

  it('answers ready: false with the numbers when the data is short, instead of refusing', async () => {
    const r = await rig();
    const answer = await facts(r, {
      scenario: 'checkout',
      environment: 'perf',
      profile: { type: 'ramp_concurrency', vusers: 5000, ramp: 600 },
    });
    expect(answer.data).toMatchObject({ ready: false, needed: 3000, available: 2000 });
    expect(answer.data.slots).toContainEqual(
      expect.objectContaining({ slot: 'User accounts', have: 2000, need: 3000 }),
    );
    expect(startCalls(r)).toEqual([]);
  });

  it('reports a busy environment as a fact, with the handle of the test that runs there', async () => {
    const r = await rig({
      setup: (fake) =>
        seedForeignRun(fake, {
          id: SKLEP_IDS.executionQa,
          status: 'running',
          environment_id: SKLEP_WORLD_IDS.environments.perf,
        }),
    });
    const answer = await facts(r, {
      scenario: 'checkout',
      environment: 'perf',
      profile: RAMP_2000,
    });
    expect(answer.busy).toEqual({ handle: expect.stringContaining('8c2d4f17') as string });
    expect(startCalls(r)).toEqual([]);
  });

  it('does not report a free environment when the list of runs cannot be read', async () => {
    const r = await rig();
    r.fake.faults.next(
      'GET',
      '/api/v1/projects/{project_id}/gatling/executions',
      {
        status: 200,
        body: { executions: 'none', total: 0 },
      },
      { outsideContract: true },
    );
    const result = await dryRun(r, {
      format: 'data',
      scenario: 'checkout',
      environment: 'perf',
      profile: RAMP_2000,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[run_occupancy_unknown]');
    expect(startCalls(r)).toEqual([]);
  });

  it('refuses what the real call refuses before a start (a protected environment without limits)', async () => {
    const r = await rig({
      setup: (fake) =>
        fake.store
          .collection(SKLEP_COLLECTIONS.environments)
          .update(SKLEP_WORLD_IDS.environments.prod, { workload_caps: null }),
    });
    const result = await dryRun(r, {
      scenario: 'checkout',
      environment: 'prod',
      profile: { type: 'smoke', vusers: 1 },
    });
    expect(result.isError).toBe(true);
    expect(startCalls(r)).toEqual([]);
  });

  it('does not hold the environment: a real start right after the dry run goes through', async () => {
    const r = await rig();
    await facts(r, { scenario: 'checkout', environment: 'perf', profile: RAMP_2000 });
    const started = await settleClock(
      r,
      r.call('run_start', {
        scenario: 'checkout',
        environment: 'perf',
        profile: RAMP_2000,
        max_wait_s: 1,
      }),
    );
    expect(started.isError).toBe(false);
    expect(startedRuns(r.fake)).toHaveLength(1);
  });

  it.each(['en', 'pl'] as const)(
    'draws the one-line view (%s) as the pattern says',
    async (locale) => {
      const r = await rig({ locale });
      const result = await dryRun(r, {
        scenario: 'checkout',
        environment: 'qa',
        profile: RAMP_2000,
      });
      expect(result.isError).toBe(false);
      expect(result.text).toBe(golden(`preflight-qa-clamped.${locale}.txt`));
      expect(result.text.split('\n')).toHaveLength(1);
    },
  );

  it('keeps the token out of the JSON block when LoadCraft data carries it', async () => {
    const leaky = `perf-${CANARY}`;
    const r = await rig({
      setup: (fake) =>
        fake.store
          .collection(SKLEP_COLLECTIONS.environments)
          .update(SKLEP_WORLD_IDS.environments.perf, { name: leaky }),
    });
    const result = await dryRun(r, {
      format: 'data',
      scenario: 'checkout',
      environment: leaky,
      profile: RAMP_2000,
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('"dry_run":true');
    expect(result.text).not.toContain(CANARY);
    r.assertClean();
  });

  it('keeps the token out of the answer', async () => {
    const r = await rig();
    const result = await dryRun(r, {
      format: 'data',
      scenario: 'checkout',
      environment: 'qa',
      profile: RAMP_2000,
    });
    expect(result.text).not.toContain(CANARY);
    r.assertClean();
  });

  it('is part of a read-only tool without the consent prompt, and run_start has no dry_run', async () => {
    const r = await rig();
    const tools = await r.session.listTools();
    const status = tools.find((tool) => tool.name === 'process_get_status');
    expect(status?.annotations?.['readOnlyHint']).toBe(true);
    expect(status?.meta).toBeUndefined();
    expect(status?.description).toMatch(/preflight/u);
    const run = tools.find((tool) => tool.name === 'run_start');
    expect(run?.description).not.toMatch(/dry_run/u);
  });
});
