import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { processGetStatus } from '../src/tools/processGetStatus.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerAnalysisReadRoute } from './fake-backend/routes/analysis.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { registerStatusRoutes } from './fake-backend/routes/status.js';
import type { Fake } from './fake-backend/server.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepExecution,
  type SklepStage,
} from './fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { SETUP_TOOLS } from './helpers/projectSetup.js';
import { CANARY, toolRig, type ToolRig } from './helpers/rig.js';

/** Twenty minutes after the perf run ended (2026-11-22 10:40:18). */
const NOW = Date.parse('2026-11-22T11:00:00Z');
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

interface StatusView {
  readonly identity: { readonly userId: string };
  readonly project?: { readonly id: string; readonly name: string };
  readonly setup?: { readonly complete: boolean; readonly missing: readonly string[] };
  readonly counts: { flows: number; scenarios: number; compositions: number };
  readonly recentRuns: readonly {
    handle: string;
    target: string;
    status: string;
    verdict?: string;
  }[];
  readonly operations: readonly { handle: string; kind: string; startedAt: string }[];
  readonly oldDocs?: { readonly flows: readonly string[]; readonly more: number };
  readonly next: {
    readonly step: string;
    readonly hint: string;
    readonly subject?: string;
    readonly skipped?: readonly string[];
  };
}

function sklep(stage: SklepStage) {
  return (fake: Fake): void => {
    registerLookupRoutes(fake);
    registerFlowRoutes(fake);
    registerStatusRoutes(fake);
    seedSklep(fake.store, { stage });
  };
}

async function rig(
  stage: SklepStage,
  options: { bound?: boolean; locale?: 'en' | 'pl'; files?: Record<string, string> } = {},
): Promise<ToolRig> {
  return toolRig({
    tools: [processGetStatus],
    world: sklep(stage),
    clock: createTestClock(NOW),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: { ...(options.bound === false ? {} : BOUND), ...options.files },
  });
}

async function status(
  r: ToolRig,
  args: Record<string, unknown> = {},
): Promise<{ text: string; data: StatusView }> {
  const result = await r.call('process_get_status', args);
  if (result.isError) throw new Error(`process_get_status failed: ${result.text}`);
  const structured = result.outcome as { status: string; data: StatusView };
  expect(structured.status).toBe('done');
  return { text: result.text, data: structured.data };
}

/** The perf run, as a test whose thresholds held (the world's run missed them). */
function passTheRun(r: ToolRig): void {
  const runs = r.fake.store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
  const run = runs.require(SKLEP_IDS.executionPerf);
  runs.update(SKLEP_IDS.executionPerf, {
    run_exit_code: 0,
    result_has_errors: false,
    sla_verdict: run.sla_verdict === null ? null : { ...run.sla_verdict, status: 'passed' },
  });
}

/** Id of a docs version newer than the one the world's flows are pinned to. */
const NEWER_DOCS = '5f0e9c2b-7a41-4d36-8b19-e2c4a7d0f358';

/** The project gets a newer docs version; the flows `left` stay pinned to the earlier one. */
function moveDocs(r: ToolRig, left: readonly string[]): void {
  r.fake.store
    .collection<{ id: string }>(SKLEP_COLLECTIONS.projects)
    .update(SKLEP_IDS.project, { openapi_spec_id: NEWER_DOCS });
  const flows = r.fake.store.collection<{ id: string }>(SKLEP_COLLECTIONS.flows);
  for (const flow of flows.list()) {
    if (!left.includes(flow.id)) flows.update(flow.id, { openapi_spec_id: NEWER_DOCS });
  }
}

interface StateProblem {
  readonly code: string;
  readonly severity: string;
  readonly flow_ids?: readonly string[];
}

function problemsOf(r: ToolRig): StateProblem[] {
  const state = JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as { process: Record<string, { problems: StateProblem[] }> };
  return state.process[SKLEP_IDS.project]?.problems ?? [];
}

const projectCalls = (r: ToolRig): string[] =>
  r.fake.calls.map((call) => call.path).filter((path) => path.startsWith('/api/v1/projects'));

describe('process_get_status', () => {
  it('without a binding and without a project shows identity and the first step, not an error', async () => {
    const r = await rig('empty', { bound: false });
    const { text, data } = await status(r);
    expect(data.identity.userId).toBe('user@example.com');
    expect(data.project).toBeUndefined();
    expect(data.next).toEqual({ step: 'project_create', hint: 'unbound' });
    expect(text).toContain('user@example.com');
    expect(text).toContain(
      'This repository is not bound to a project — start with project_create.',
    );
    expect(projectCalls(r)).toEqual([]);
  });

  it('points at scenario_suggest_split when flows exist but no composition', async () => {
    const r = await rig('flows');
    const { data } = await status(r);
    expect(data.project).toEqual({ id: SKLEP_IDS.project, name: 'sklep' });
    expect(data.setup).toEqual({ complete: true, missing: [] });
    expect(data.counts).toEqual({ flows: 3, scenarios: 0, compositions: 0 });
    expect(data.next.step).toBe('scenario_suggest_split');
  });

  it('warns about the flows on an older docs version, names the migration and records the warning', async () => {
    const r = await rig('flows');
    moveDocs(r, [SKLEP_IDS.flowZakupy, SKLEP_WORLD_IDS.flowKonto]);
    const { text, data } = await status(r);
    expect(data.oldDocs).toEqual({ flows: ['konto', 'zakupy'], more: 0 });
    expect(text).toMatch(/2 flows on an older docs version: konto, zakupy/u);
    expect(text).toMatch(/→ [^\n]*flows_migrate_docs[^\n]*preview: true/u);
    const warning = problemsOf(r).filter((problem) => problem.code === 'flows_on_old_docs');
    expect(warning).toHaveLength(1);
    expect([...(warning[0]?.flow_ids ?? [])].sort()).toEqual(
      [SKLEP_IDS.flowZakupy, SKLEP_WORLD_IDS.flowKonto].sort(),
    );
    // the same reading again keeps the warning as it was (no second one, no new stamp)
    await status(r);
    expect(problemsOf(r).filter((problem) => problem.code === 'flows_on_old_docs')).toEqual(
      warning,
    );
  });

  it('says nothing about old docs while every flow is on the current version', async () => {
    const r = await rig('flows');
    const { text, data } = await status(r);
    expect(data.oldDocs).toBeUndefined();
    expect(text).not.toContain('flows_migrate_docs');
  });

  it('shows the last run with its verdict and e- handle, without the self-check runs', async () => {
    const r = await rig('executed');
    const { text, data } = await status(r);
    expect(data.recentRuns).toEqual([
      {
        handle: 'e-3f9a12c4',
        id: SKLEP_IDS.executionPerf,
        target: 'checkout',
        status: 'completed',
        verdict: 'sla_failed',
        when: '2026-11-22T10:30:00Z',
      },
    ]);
    expect(text).toMatch(/e-3f9a12c4 +checkout +SLA FAILED +30 min ago/);
    // The perf run has a stored analysis, so nothing in the list is unmet.
    expect(data.next.step).toBe('run_start');
  });

  it('sends a run without an analysis to results_get_report', async () => {
    const r = await rig('executed');
    r.fake.store.collection('gatling_execution_analyses').delete(SKLEP_WORLD_IDS.analysis);
    const { data } = await status(r);
    expect(data.next).toEqual({
      step: 'results_get_report',
      hint: 'no_analysis',
      subject: 'e-3f9a12c4',
    });
  });

  it('does not send a passed test to the diagnosis', async () => {
    const r = await rig('executed');
    r.fake.store.collection('gatling_execution_analyses').delete(SKLEP_WORLD_IDS.analysis);
    passTheRun(r);
    const { data } = await status(r);
    expect(data.recentRuns[0]?.verdict).toBe('sla_passed');
    expect(data.next).toEqual({
      step: 'results_get_report',
      hint: 'passed_no_diagnosis',
      subject: 'e-3f9a12c4',
      skipped: ['results_analyze_run'],
    });
  });

  it('says in the text that a passed test needs no diagnosis unless asked', async () => {
    for (const [locale, expected] of [
      ['en', /results_get_report for e-3f9a12c4.*diagnosis only if you ask/s],
      ['pl', /results_get_report dla e-3f9a12c4.*diagnoza tylko na prośbę/s],
    ] as const) {
      const r = await rig('executed', { locale });
      r.fake.store.collection('gatling_execution_analyses').delete(SKLEP_WORLD_IDS.analysis);
      passTheRun(r);
      const result = await r.call('process_get_status', {});
      expect(result.text).toMatch(expected);
      expect(result.text).not.toMatch(/results_analyze_run/);
    }
  });

  it('keeps the diagnosis for a failed test without one', async () => {
    const r = await rig('executed');
    r.fake.store.collection('gatling_execution_analyses').delete(SKLEP_WORLD_IDS.analysis);
    const { data } = await status(r);
    expect(data.recentRuns[0]?.verdict).toBe('sla_failed');
    expect(data.next.hint).toBe('no_analysis');
    expect(data.next).not.toHaveProperty('skipped');
  });

  it('shares the analysis route with tests that register it first', async () => {
    const r = await toolRig({
      tools: [processGetStatus],
      world: (fake) => {
        registerAnalysisReadRoute(fake);
        sklep('executed')(fake);
      },
      clock: createTestClock(NOW),
      files: BOUND,
    });
    const { data } = await status(r);
    expect(data.next.step).toBe('run_start');
  });

  it('lists an operation recorded in the workspace state with its handle', async () => {
    const handle = `test_run:${SKLEP_IDS.executionPerf}`;
    const state = {
      schema: 1,
      operations: {
        [handle]: {
          savedAt: NOW - 120_000,
          value: {
            kind: 'test_run',
            id: SKLEP_IDS.executionPerf,
            startedAt: NOW - 120_000,
            saved: {},
          },
        },
      },
    };
    const r = await rig('executed', {
      files: { 'loadcraft/.cache/state.json': JSON.stringify(state) },
    });
    const { text, data } = await status(r);
    expect(data.operations).toEqual([
      { handle, kind: 'test_run', startedAt: '2026-11-22T10:58:00.000Z' },
    ]);
    expect(text).toContain(`${handle}  started 2 min ago`);
  });

  it('turns 401 into the invalid-token error with its hint', async () => {
    const r = await rig('executed');
    r.fake.faults.next('GET', '/api/v1/auth/me', {
      status: 401,
      body: { detail: 'Invalid token' },
    });
    const result = await r.call('process_get_status', {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft did not accept the API token');
    expect(result.text).toContain('→ Create a new API token in LoadCraft');
  });

  it('refuses a backend without /meta as too old', async () => {
    const r = await rig('executed');
    r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const result = await r.call('process_get_status', {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain('older than the plugin supports');
    expect(result.text).toContain('the server does not report its version');
  });

  it('keeps scenario artifacts and the canary out of every detail level', async () => {
    const r = await rig('executed');
    for (const detail of ['summary', 'flows', 'scenarios', 'data', 'runs']) {
      const result = await r.call('process_get_status', { detail });
      expect(result.isError, result.text).toBe(false);
      const everything = JSON.stringify(result);
      for (const leak of [
        'scenario_artifact',
        'simulation_class_name',
        'ZakupySimulation',
        'feeder_slots',
        CANARY,
      ]) {
        expect(everything, `${detail}: ${leak}`).not.toContain(leak);
      }
    }
  });

  it('names the missing setup steps and sends the user back to project_analyze_setup', async () => {
    const r = await rig('flows');
    const validators = r.fake.store.collection('project_validators');
    for (const validator of validators.list()) validators.delete(validator.id);
    const { text, data } = await status(r);
    expect(data.setup).toEqual({ complete: false, missing: ['validators'] });
    expect(data.next).toEqual({ step: 'project_analyze_setup', hint: 'setup_incomplete' });
    expect(text).toContain('setup incomplete · missing: validators');
  });

  it('asks for data while a scenario waits for it', async () => {
    const r = await rig('scenario');
    const { data } = await status(r);
    expect(data.next).toEqual({
      step: 'data_check_readiness',
      hint: 'needs_data',
      slots: [{ slot: 'accounts', label: 'User accounts' }],
    });
  });

  it('suggests the flow step for a project without flows', async () => {
    const r = await rig('project');
    const { data } = await status(r);
    expect(data.next.step).toBe('flows_suggest_journeys');
  });

  it('suggests run_start once data is ready and only self-checks ran', async () => {
    const r = await rig('data');
    const { data } = await status(r);
    expect(data.recentRuns).toEqual([]);
    expect(data.next.step).toBe('run_start');
    expect(data.next.hint).toBe('no_runs');
  });

  it.each([
    ['en', 'next: choose the environment and the profile, then run_start'],
    ['pl', 'dalej: wybierz środowisko i profil, potem run_start'],
  ] as const)(
    'does not send straight to run_start: the server holds no chosen environment (%s)',
    async (locale, expected) => {
      const r = await rig('data', { locale });
      const { text } = await status(r);
      const next = text.split('\n').find((line) => /^(next|dalej):/u.test(line));
      expect(next).toBeDefined();
      expect(next).toContain(expected);
      expect(next).not.toMatch(/^(next|dalej): run_start/u);
    },
  );

  it.each([
    ['en', 'next: choose the environment and the profile, then run_start — the last run has'],
    ['pl', 'dalej: wybierz środowisko i profil, potem run_start — ostatni test ma'],
  ] as const)(
    'keeps the environment choice after a finished run too (%s)',
    async (locale, start) => {
      const r = await rig('executed', { locale });
      const { text } = await status(r);
      expect(text.replace(/\s+/gu, ' ')).toContain(start);
    },
  );

  it('reads the project named in the call instead of the binding', async () => {
    const r = await rig('flows', { bound: false });
    const { data } = await status(r, { project: 'sklep' });
    expect(data.project?.name).toBe('sklep');
    expect(data.next.step).toBe('scenario_suggest_split');
  });

  it('keeps the summary within 25 lines', async () => {
    const r = await rig('executed');
    const { text } = await status(r);
    expect(text.split('\n').length).toBeLessThanOrEqual(25);
  });

  it('cuts a detail list at 20 items and says how many more there are', async () => {
    const r = await rig('flows');
    const flows = r.fake.store.collection<{ id: string; name: string }>('flows');
    const [first] = flows.list();
    if (first === undefined) throw new Error('no flow in the world');
    for (let i = 0; i < 22; i += 1) {
      flows.insert({
        ...first,
        id: r.fake.store.newId(),
        name: `extra-${String(i).padStart(2, '0')}`,
      });
    }
    const { text } = await status(r, { detail: 'flows' });
    expect(text).toContain('… and 5 more');
  });

  describe('views', () => {
    it.each(['en', 'pl'] as const)('executed world, summary (%s)', async (locale) => {
      const r = await rig('executed', { locale });
      const { text } = await status(r);
      await expect(text).toMatchFileSnapshot(`__snapshots__/getStatus.executed.${locale}.txt`);
    });

    it.each(['en', 'pl'] as const)('scenario world, data detail (%s)', async (locale) => {
      const r = await rig('scenario', { locale });
      const { text } = await status(r, { detail: 'data' });
      await expect(text).toMatchFileSnapshot(`__snapshots__/getStatus.data.${locale}.txt`);
    });

    it.each(['en', 'pl'] as const)('without a binding (%s)', async (locale) => {
      const r = await rig('empty', { bound: false, locale });
      const { text } = await status(r);
      await expect(text).toMatchFileSnapshot(`__snapshots__/getStatus.unbound.${locale}.txt`);
    });
  });
});

describe('process_get_status between the analysis and the apply of the setup', () => {
  it('a finished analysis whose profile is not applied yet sends to project_apply_setup with its handle', async () => {
    const r = await toolRig({
      tools: [...SETUP_TOOLS, processGetStatus],
      world: (fake: Fake) => {
        sklep('empty')(fake);
        registerProjectRoutes(fake);
      },
      env: { LOADCRAFT_LOCALE: 'en' },
    });
    const settle = (name: string, args: Record<string, unknown>) =>
      settleClock(r, r.call(name, args), { limitMs: 120_000 });
    const environment = { name: 'perf', api: 'api.perf.example.com' };
    for (const [name, args] of [
      ['project_create', { name: 'sklep', description: 'Sklep API', environment }],
      ['project_save_env', { environments: [{ ...environment, default: true }] }],
    ] as const) {
      const result = await settle(name, args);
      expect(result.isError, result.text).toBe(false);
    }
    const analysed = await settle('project_analyze_setup', { description: 'Sklep API' });
    const handle = (analysed.outcome?.data as { operation?: string } | undefined)?.operation;
    expect(handle).toMatch(/^setup_analysis:/u);

    const { text, data } = await status(r);
    expect(data.next).toEqual({
      step: 'project_apply_setup',
      hint: 'analysis_done',
      subject: handle,
    });
    expect(text.replace(/\s+/gu, ' ')).toContain(
      `next: project_apply_setup with analysis "${handle ?? ''}"`,
    );

    // applied: the setup is complete and the status goes on to the flows
    const applied = await settle('project_apply_setup', { analysis: handle });
    expect(applied.isError, applied.text).toBe(false);
    expect((await status(r)).data.next.step).toBe('flows_suggest_journeys');
  });
});
