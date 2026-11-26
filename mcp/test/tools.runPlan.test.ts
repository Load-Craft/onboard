import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import { renderRunPlan, type ProfilesData } from '../src/render/views/runPlan.js';
import { runPlan } from '../src/tools/runPlan.js';
import { goldenText, goldenUrl, SKLEP_IDS } from './golden/index.js';
import { registerDataRoutes } from './fake-backend/routes/data.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import type { Fake } from './fake-backend/server.js';
import { SKLEP_COLLECTIONS, seedSklep, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { createTestClock } from './helpers/clock.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

async function rig(
  locale: 'en' | 'pl' = 'en',
  setup?: (fake: Fake) => void,
  files: Record<string, string> = BOUND,
): Promise<ToolRig> {
  return toolRig({
    tools: [runPlan],
    world: (fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerDataRoutes(fake);
      seedSklep(fake.store, { stage: 'data' });
      setup?.(fake);
    },
    clock: createTestClock(Date.parse('2026-11-22T11:00:00Z')),
    env: { LOADCRAFT_LOCALE: locale },
    files,
  });
}

interface Listed {
  readonly text: string;
  readonly data: ProfilesData;
}

async function list(r: ToolRig, args: Record<string, unknown>): Promise<Listed> {
  const result = await r.call('run_plan', { target_users: 2000, ...args });
  if (result.isError) throw new Error(`run_plan failed: ${result.text}`);
  const structured = result.outcome as { status: string; data: ProfilesData };
  expect(structured.status).toBe('done');
  return { text: result.text, data: structured.data };
}

/** The view wraps long markers; a test reads them as one line. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ');

const viewJson = (file: string): ProfilesData =>
  JSON.parse(readFileSync(goldenUrl(file), 'utf8')) as ProfilesData;

const setCaps =
  (environment: 'perf' | 'qa' | 'prod', caps: Record<string, number> | null) =>
  (fake: Fake): void => {
    fake.store
      .collection(SKLEP_COLLECTIONS.environments)
      .update(SKLEP_WORLD_IDS.environments[environment], { workload_caps: caps });
  };

const preflightBodies = (r: ToolRig): { workload: { type: string; vusers: number } }[] =>
  r.fake.calls
    .filter((call) => call.path.endsWith('/feeders/preflight'))
    .map((call) => call.body as { workload: { type: string; vusers: number } });

describe('run_plan', () => {
  it.each(['en', 'pl'] as const)(
    'every profile of the data can be read from the text alone (%s)',
    async (locale) => {
      const r = await rig(locale);
      const { text, data } = await list(r, { scenario: 'checkout', environment: 'qa' });
      const read = [...text.matchAll(/^\s+(\d+)\. (\{.*\})$/gm)].map((m) => ({
        n: Number(m[1]),
        profile: JSON.parse(m[2] ?? '') as unknown,
      }));
      expect(read).toEqual(data.profiles.map((entry) => ({ n: entry.n, profile: entry.profile })));
    },
  );

  describe('golden views (pl)', () => {
    it('perf: the nine profiles of the mock-up, no limits', async () => {
      const r = await rig('pl');
      const { text, data } = await list(r, { scenario: 'checkout', environment: 'perf' });
      expect(`${text}\n`).toBe(goldenText('run1', '09a-run_plan'));
      expect(data).toEqual(viewJson('run1/09a-run_plan.view.json'));
    });

    it('qa: the same list with what the limit of 100 does', async () => {
      const r = await rig('pl');
      const { text, data } = await list(r, { scenario: 'checkout', environment: 'qa' });
      expect(`${text}\n`).toBe(goldenText('run5', '09a-run_plan-qa'));
      expect(data).toEqual(viewJson('run5/09a-run_plan-qa.view.json'));
    });

    it.each([
      ['run1/09a-run_plan', 'run1', '09a-run_plan'],
      ['run5/09a-run_plan-qa', 'run5', '09a-run_plan-qa'],
    ] as const)('%s: the renderer draws the stored data into the file', (file, run, name) => {
      const t = createTranslator('pl');
      expect(`${renderRunPlan(viewJson(`${file}.view.json`), t)}\n`).toBe(goldenText(run, name));
    });
  });

  describe('views (en)', () => {
    it.each(['perf', 'qa'] as const)('%s', async (environment) => {
      const r = await rig('en');
      const { text } = await list(r, { scenario: 'checkout', environment });
      await expect(text).toMatchFileSnapshot(`__snapshots__/runPlan.${environment}.en.txt`);
    });

    it.each(['en', 'pl'] as const)('with the data check on qa (%s)', async (locale) => {
      const r = await rig(locale);
      const { text } = await list(r, {
        scenario: 'checkout',
        environment: 'qa',
        include_data: true,
      });
      await expect(text).toMatchFileSnapshot(`__snapshots__/runPlan.data.${locale}.txt`);
    });
  });

  it('carries a ready profile object per entry, as it would run, before any limit', async () => {
    const r = await rig();
    const { data } = await list(r, { scenario: 'checkout', environment: 'qa' });
    expect(data.profiles.map((entry) => entry.profile)).toEqual([
      { type: 'smoke', vusers: 1 },
      { type: 'ramp', vusers: 2000, ramp: 600 },
      { type: 'constant', vusers: 4, hold: 900 },
      { type: 'ramp_hold', vusers: 4, ramp: 60, hold: 900 },
      { type: 'stress', vusers: 10, ramp: 180 },
      { type: 'constant_concurrency', vusers: 2000, hold: 900 },
      { type: 'ramp_concurrency', vusers: 2000, ramp: 600 },
      { type: 'spike', vusers: 1000, ramp: 60, hold: 60 },
      { type: 'soak', vusers: 1000, ramp: 60, hold: 7200 },
    ]);
    expect(data.profiles.map((entry) => [entry.n, entry.clamped, entry.applied.vusers])).toEqual([
      [1, false, 1],
      [2, true, 100],
      [3, false, 4],
      [4, false, 4],
      [5, false, 10],
      [6, true, 100],
      [7, true, 100],
      [8, true, 50],
      [9, true, 100],
    ]);
    expect(data.profiles.map((entry) => entry.plannedSeconds)).toEqual([
      null,
      600,
      900,
      960,
      900,
      900,
      600,
      120,
      7260,
    ]);
  });

  it('leaves the rate and stairs profiles alone at the limits of qa (100 users, 20 per second)', async () => {
    const r = await rig();
    const { data } = await list(r, { scenario: 'checkout', environment: 'qa' });
    const untouched = data.profiles.filter((entry) => !entry.clamped).map((entry) => entry.type);
    expect(untouched).toEqual(['smoke', 'constant', 'ramp_hold', 'stress']);
  });

  it('shows the spike rule: the limit is halved, with the reason in the view', async () => {
    const r = await rig();
    const { text, data } = await list(r, { scenario: 'checkout', environment: 'qa' });
    const spike = data.profiles.find((entry) => entry.type === 'spike');
    expect(spike).toMatchObject({
      clamped: true,
      note: 'second_burst_doubles',
      applied: { vusers: 50 },
    });
    expect(oneLine(text)).toContain(
      'clamped to 50 (limit 100 ÷ 2: the second burst is twice the first)',
    );
  });

  it('says a spike is not possible at a limit of one user', async () => {
    const r = await rig('en', setCaps('qa', { max_vu: 1 }));
    const { text, data } = await list(r, { scenario: 'checkout', environment: 'qa' });
    const spike = data.profiles.find((entry) => entry.type === 'spike');
    expect(spike?.refusal).toBe('spike_needs_two_users');
    expect(spike?.clamped).toBe(false);
    expect(oneLine(text)).toContain('not available: a limit of 1 fits no spike');
  });

  it('clamps rate profiles to the per-second limit and warns about the stairs floor', async () => {
    const r = await rig('en', setCaps('qa', { max_rps: 3 }));
    const { text, data } = await list(r, { scenario: 'checkout', environment: 'qa' });
    const byType = Object.fromEntries(data.profiles.map((entry) => [entry.type, entry]));
    expect(byType['constant']?.applied.vusers).toBe(3);
    expect(byType['stress']).toMatchObject({ clamped: true, note: 'stress_step_floor' });
    expect(byType['ramp']?.clamped).toBe(false);
    expect(oneLine(text)).toContain('the steps always climb to at least 5 new/s');
  });

  it('warns that a protected environment without limits will refuse a run', async () => {
    const r = await rig('en', setCaps('prod', null));
    const { text, data } = await list(r, { scenario: 'checkout', environment: 'prod' });
    expect(data.environment).toEqual({ name: 'prod', protected: true, caps: {} });
    expect(text).toContain('prod is protected and has no load limits, so run_start will refuse');
    expect(data.profiles.every((entry) => !entry.clamped)).toBe(true);
  });

  it('follows the number of users the user named', async () => {
    const r = await rig();
    const { data } = await list(r, {
      scenario: 'checkout',
      environment: 'perf',
      target_users: 20,
    });
    expect(data.profiles.map((entry) => entry.profile.vusers)).toEqual([
      1, 20, 1, 1, 5, 20, 20, 10, 10,
    ]);
  });

  it('takes a scenario as the target too', async () => {
    const r = await rig();
    const { data } = await list(r, { scenario: 'zakupy', environment: 'perf' });
    expect(data.target).toEqual({ kind: 'scenario', name: 'zakupy' });
  });

  describe('include_data', () => {
    it('is off by default: no data check is made', async () => {
      const r = await rig();
      const { data } = await list(r, { scenario: 'checkout', environment: 'perf' });
      expect(data.dataCheck).toBe('off');
      expect(preflightBodies(r)).toEqual([]);
    });

    it('checks the nine profiles as they will run, after the limit', async () => {
      const r = await rig();
      const { data } = await list(r, {
        scenario: 'checkout',
        environment: 'qa',
        include_data: true,
      });
      expect(data.dataCheck).toBe('done');
      const sent = preflightBodies(r)
        .map((body) => `${body.workload.type}:${String(body.workload.vusers)}`)
        .sort();
      expect(sent).toEqual(
        [
          'smoke:1',
          'ramp:100',
          'constant:4',
          'ramp_hold:4',
          'stress:10',
          'constant_concurrency:100',
          'ramp_concurrency:100',
          'spike:50',
          'soak:100',
        ].sort(),
      );
      expect(data.profiles.every((entry) => entry.data?.ready === true)).toBe(true);
    });

    it('names the slot that is short of rows for a profile', async () => {
      const r = await rig();
      const { text, data } = await list(r, {
        scenario: 'checkout',
        environment: 'perf',
        target_users: 5000,
        include_data: true,
      });
      // Accounts: 2 000 rows, 60% of the users need one each.
      const ramp = data.profiles.find((entry) => entry.type === 'ramp');
      expect(ramp?.data?.ready).toBe(false);
      expect(ramp?.data?.slots.find((slot) => slot.blocking)).toMatchObject({
        label: 'User accounts',
        have: 2000,
        need: 3000,
      });
      expect(oneLine(text)).toContain('data ✕ User accounts (slot: accounts): 2,000 of 3,000 rows');
      const smoke = data.profiles.find((entry) => entry.type === 'smoke');
      expect(smoke?.data?.ready).toBe(true);
    });

    it('checks no data for a profile the environment refuses', async () => {
      const r = await rig('en', setCaps('qa', { max_vu: 1 }));
      const { data } = await list(r, {
        scenario: 'checkout',
        environment: 'qa',
        include_data: true,
      });
      expect(preflightBodies(r).map((body) => body.workload.type)).not.toContain('spike');
      expect(data.profiles.find((entry) => entry.type === 'spike')?.data).toBeUndefined();
    });

    it('says the check covers compositions only when the target is a scenario', async () => {
      const r = await rig();
      const { text, data } = await list(r, {
        scenario: 'zakupy',
        environment: 'perf',
        include_data: true,
      });
      expect(data.dataCheck).toBe('composition_only');
      expect(preflightBodies(r)).toEqual([]);
      expect(text).toContain('The data check covers compositions only; "zakupy" is a scenario.');
    });
  });

  describe('errors', () => {
    it('names an environment it does not know, with the ones it does, and a hint', async () => {
      const r = await rig();
      const result = await r.call('run_plan', {
        scenario: 'checkout',
        environment: 'staging',
        target_users: 2000,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('staging');
      expect(result.text).toContain('perf');
      expect(result.text).toContain('→ ');
    });

    it('names a scenario it does not know', async () => {
      const r = await rig();
      const result = await r.call('run_plan', {
        scenario: 'nope',
        environment: 'perf',
        target_users: 2000,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('nope');
    });

    it('asks for a project when the directory is not bound to one', async () => {
      const r = await rig('en', undefined, {});
      const result = await r.call('run_plan', {
        scenario: 'checkout',
        environment: 'perf',
        target_users: 2000,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('No project is selected');
    });

    it.each([0, 1_000_001, 2.5])('rejects %s users', async (users) => {
      const r = await rig();
      const result = await r.call('run_plan', {
        scenario: 'checkout',
        environment: 'perf',
        target_users: users,
      });
      expect(result.isError).toBe(true);
      expect(r.fake.calls).toEqual([]);
    });

    it('turns 401 into the invalid-token error with its hint', async () => {
      const r = await rig();
      r.fake.faults.next('GET', '/api/v1/projects/{project_id}/environments', {
        status: 401,
        body: { detail: 'Invalid token' },
      });
      const result = await r.call('run_plan', {
        scenario: 'checkout',
        environment: 'perf',
        target_users: 2000,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('LoadCraft did not accept the API token');
      expect(result.text).toContain('→ Create a new API token in LoadCraft');
    });

    it('turns a refused data check into a message with a hint, not a crash', async () => {
      const r = await rig();
      r.fake.faults.next(
        'POST',
        '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/feeders/preflight',
        { status: 404, body: { detail: 'Composition not found' } },
      );
      const result = await r.call('run_plan', {
        scenario: 'checkout',
        environment: 'perf',
        include_data: true,
        target_users: 2000,
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('LoadCraft does not know this item');
      expect(result.text).toContain('→ ');
    });
  });

  it('is read-only and writes nothing', async () => {
    const r = await rig();
    await list(r, { scenario: 'checkout', environment: 'qa', include_data: true });
    expect(
      r.fake.calls.every((call) => call.method === 'GET' || call.path.endsWith('/preflight')),
    ).toBe(true);
    expect(runPlan.annotations.readOnlyHint).toBe(true);
  });
});
