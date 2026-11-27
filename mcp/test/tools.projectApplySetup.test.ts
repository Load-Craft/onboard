// `project_apply_setup`: the profile composed from the proposals of the analysis it names, the
// validators and test types the project lacks, the documentation and the gate as LoadCraft then has
// them, the conformance of the default environment, the handle checks and the checks it sets.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import {
  planSetup,
  registerSetupRoutes,
  SETUP_PROFILE_DEFAULTS,
  SETUP_STATE,
  type SetupRow,
} from './fake-backend/routes/setup.js';
import type { Fake, FakeCall } from './fake-backend/server.js';
import { seedSklep, SKLEP_COLLECTIONS, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from './golden/index.js';
import { settleClock } from './helpers/clock.js';
import {
  analysisHandle,
  defaultEnvironment,
  SETUP_TOOLS,
  setUpProject,
  type SetupArgs,
  type SetupEnvironment,
} from './helpers/projectSetup.js';
import { CANARY, toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

const SKLEP_ENVIRONMENTS: readonly SetupEnvironment[] = [
  { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
  { name: 'qa', api: 'api.qa.example.com', frontend: 'qa.example.com', limit: [100, 20] },
  { name: 'dev', api: 'api.dev.example.com', frontend: 'dev.example.com' },
  { name: 'prod', api: 'api.example.com', frontend: 'example.com', limit: [20, 5] },
];

const PROJECT_ARGS: SetupArgs = { name: 'sklep', environments: SKLEP_ENVIRONMENTS };
const DOCS_ARGS: SetupArgs = { ...PROJECT_ARGS, openapi: 'loadcraft/openapi.json' };
const DOCS = { openapi: 'loadcraft/openapi.json' };

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function openapiDocument(commit: string): string {
  const paths: Record<string, unknown> = {};
  for (let index = 1; index <= 3; index += 1) {
    paths[`/items/${String(index)}`] = {
      get: { operationId: `getItem${String(index)}`, summary: `Item ${String(index)}` },
    };
  }
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Sklep API', version: '2.14.0', 'x-loadcraft-source': { commit } },
    paths,
  });
}

interface SetupView {
  readonly docs: {
    readonly title: string;
    readonly operations: number;
    readonly areas?: number;
  } | null;
  readonly analysis: 'analyzed' | 'kept' | 'none';
  readonly analysisPct: number;
  readonly fieldsTotal: number;
  readonly needsReview: readonly { field: string; value: unknown; source: string }[];
  readonly auth?: { method: string; tokenEndpoint?: string };
  readonly profileApplied: boolean;
  readonly validators: number;
  readonly testTypes: number;
  readonly testTypesToReview: number;
  readonly complete: boolean;
  readonly missing: readonly string[];
}

interface ApplyView {
  readonly project: { id: string; name: string };
  readonly setup: SetupView;
  readonly conformance?: { environment: string; result: { state: string } };
}

function world(stage: 'empty' | 'project') {
  return (fake: Fake): void => {
    registerLookupRoutes(fake);
    registerProjectRoutes(fake);
    registerSetupRoutes(fake);
    registerOpenapiReadRoute(fake);
    registerApiMapRoute(fake);
    registerConformanceRoute(fake);
    seedSklep(fake.store, { stage });
  };
}

async function rig(
  stage: 'empty' | 'project',
  options: { locale?: 'en' | 'pl' } = {},
): Promise<ToolRig> {
  return toolRig({
    tools: SETUP_TOOLS,
    world: world(stage),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: { 'loadcraft/openapi.json': openapiDocument('a41f9c2') },
  });
}

const settle = (r: ToolRig, call: Promise<RigCallResult>): Promise<RigCallResult> =>
  settleClock(r, call);

/** The project and its environments, as `project_create` and `project_save_env` leave them. */
async function bind(r: ToolRig, args: SetupArgs = PROJECT_ARGS): Promise<void> {
  const first = defaultEnvironment(args);
  const create = await settle(
    r,
    r.call('project_create', {
      name: args.name,
      environment: { name: first.name, api: first.api },
    }),
  );
  expect(create.isError, create.text).toBe(false);
  const saved = await settle(r, r.call('project_save_env', { environments: args.environments }));
  expect(saved.isError, saved.text).toBe(false);
}

/** The handle of a finished analysis of `args`. */
async function analysed(r: ToolRig, args: Record<string, unknown> = DOCS): Promise<string> {
  const result = await settle(r, r.call('project_analyze_setup', args));
  expect(result.isError, result.text).toBe(false);
  const handle = analysisHandle(result);
  if (handle === undefined) throw new Error(`no analysis handle: ${result.text}`);
  return handle;
}

async function apply(
  r: ToolRig,
  analysis?: string,
): Promise<{ text: string; data: ApplyView; result: RigCallResult }> {
  const result = await settle(
    r,
    r.call('project_apply_setup', analysis === undefined ? {} : { analysis }),
  );
  if (result.isError) throw new Error(`project_apply_setup failed: ${result.text}`);
  const structured = result.outcome as { status: string; data: ApplyView };
  expect(structured.status).toBe('done');
  return { text: result.text, data: structured.data, result };
}

const route = (call: FakeCall): string =>
  `${call.method} ${call.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')}`;

const writes = (calls: readonly FakeCall[]): FakeCall[] =>
  calls.filter(
    (call) =>
      WRITES.has(call.method) &&
      !call.path.endsWith('/test-connection') &&
      !call.path.endsWith('/conformance'),
  );

const setupWrites = (calls: readonly FakeCall[]): string[] =>
  writes(calls)
    .map(route)
    .filter((entry) => !entry.includes('/environments') && entry !== 'POST /api/v1/projects');

const appliedProfile = (r: ToolRig): Record<string, unknown> => {
  const call = r.fake.calls.find((item) => item.path.endsWith('/setup/apply'));
  return (call?.body as { project_profile: Record<string, unknown> }).project_profile;
};

/** Makes the seeded project one nothing has been done for: no analysis, no profile applied. */
function freshSetup(r: ToolRig): void {
  r.fake.store.collection<SetupRow>(SETUP_STATE).insert({
    id: SKLEP_WORLD_IDS.project,
    analysis_completed_at: null,
    profile_applied_at: null,
    has_asyncapi: false,
    validators_needs_review: 0,
    test_types_needs_review: 0,
  });
}

interface Check {
  readonly ok: boolean | null;
  readonly by: string;
  readonly note?: string;
}

function projectChecks(r: ToolRig): Record<string, Check | undefined> {
  const id = (
    JSON.parse(readFileSync(join(r.workspace, 'loadcraft', 'project.json'), 'utf8')) as {
      project: { id: string };
    }
  ).project.id;
  const state = JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as {
    process: Record<string, { steps: { project: { checks: Record<string, Check | undefined> } } }>;
  };
  return state.process[id]?.steps.project.checks ?? {};
}

describe('project_apply_setup: profile, provisioning and the setup block', () => {
  it('after the whole setup: apply and provision once each, after the end of the analysis', async () => {
    const r = await rig('empty');
    const calls = await setUpProject(r, DOCS_ARGS);
    expect(calls.apply?.isError, calls.apply?.text).toBe(false);

    expect(setupWrites(r.fake.calls)).toEqual([
      'POST /api/v1/projects/:id/setup/analyze',
      'POST /api/v1/projects/:id/setup/apply',
      'POST /api/v1/projects/:id/setup/auto-provision',
    ]);
    expect(
      r.fake.calls.some((call) => call.path.endsWith('/openapi') && call.method !== 'GET'),
    ).toBe(false);
    const polls = r.fake.calls.filter((call) => call.path.includes('/project-setup/runs/'));
    const at = r.fake.calls.findIndex((call) => call.path.endsWith('/setup/apply'));
    expect(polls.length).toBeGreaterThan(1);
    expect(at).toBeGreaterThan(r.fake.calls.map((c) => c.path).lastIndexOf(polls[0]?.path ?? ''));

    const data = (calls.apply?.outcome as { data: ApplyView }).data;
    expect(data.setup).toEqual({
      docs: { title: 'Sklep API', operations: 3, areas: 1 },
      analysis: 'analyzed',
      analysisPct: 100,
      fieldsTotal: 9,
      needsReview: [
        { field: 'app_architecture', value: 'spa', source: 'llm' },
        { field: 'has_async_operations', value: true, source: 'openapi' },
      ],
      auth: { method: 'bearer_jwt' },
      profileApplied: true,
      validators: 5,
      testTypes: 3,
      testTypesToReview: 3,
      complete: true,
      missing: [],
    });
    expect(data.conformance).toMatchObject({ environment: 'perf', result: { state: 'checked' } });
    expect(calls.apply?.outcome?.links?.[0]?.url).toContain('/settings#application-profile');
    r.assertClean();
  });

  it('applies a profile with every field: suggestions where there are any, the current value elsewhere', async () => {
    const r = await rig('project');
    freshSetup(r);
    const current = {
      ...SETUP_PROFILE_DEFAULTS,
      api_area_prefixes: ['/api'],
      additional_notes: 'Checkout needs a fresh cart.',
      self_check_enabled: false,
      auth_token_endpoint: 'POST /auth/login',
      idp_domains: ['login.example.com'],
      has_mfa: true,
    };
    r.fake.store.collection(SKLEP_COLLECTIONS.projects).update(SKLEP_IDS.project, {
      project_profile: current,
    });
    await bind(r);
    const { data } = await apply(r, await analysed(r));

    const profile = appliedProfile(r);
    expect(Object.keys(profile).sort()).toEqual(Object.keys(SETUP_PROFILE_DEFAULTS).sort());
    // Suggested values.
    expect(profile['app_architecture']).toBe('spa');
    expect(profile['has_pagination']).toBe(true);
    expect(profile['has_async_operations']).toBe(true);
    // Fields without a suggestion keep what the project has.
    expect(profile['api_area_prefixes']).toEqual(['/api']);
    expect(profile['additional_notes']).toBe('Checkout needs a fresh cart.');
    expect(profile['self_check_enabled']).toBe(false);
    expect(profile['auth_token_endpoint']).toBe('POST /auth/login');
    expect(profile['idp_domains']).toEqual(['login.example.com']);
    expect(profile['has_mfa']).toBe(true);
    expect(data.setup.auth).toEqual({ method: 'bearer_jwt', tokenEndpoint: 'POST /auth/login' });
  });

  it('sends the suggestion with the highest confidence and skips a rejected one', async () => {
    const r = await rig('project');
    freshSetup(r);
    planSetup(r.fake, {
      suggestions: [
        {
          field_path: 'project_profile.api_protocol',
          value: 'graphql',
          confidence: 0.5,
          status: 'suggested',
          source_kinds: ['llm'],
        },
        {
          field_path: 'project_profile.api_protocol',
          value: 'rest',
          confidence: 0.9,
          status: 'suggested',
          source_kinds: ['openapi'],
        },
        {
          field_path: 'project_profile.auth_method',
          value: 'basic',
          confidence: 0.99,
          status: 'rejected',
          source_kinds: ['user'],
        },
        {
          // A value outside the profile's choices is not sent.
          field_path: 'project_profile.app_architecture',
          value: 'microfrontends',
          confidence: 0.99,
          status: 'suggested',
          source_kinds: ['openapi'],
        },
        {
          field_path: 'project_profile.has_pagination',
          value: true,
          confidence: 0.8,
          status: 'suggested',
          source_kinds: ['openapi'],
        },
      ],
    });
    await bind(r);
    const { data } = await apply(r, await analysed(r));
    const profile = appliedProfile(r);
    expect(profile['api_protocol']).toBe('rest');
    expect(profile['auth_method']).toBe('bearer_jwt');
    expect(profile['app_architecture']).toBe('spa');
    expect(profile['has_pagination']).toBe(true);
    expect(data.setup.fieldsTotal).toBe(2);
    expect(data.setup.needsReview).toEqual([]);
  });

  it('without a handle leaves the profile alone and only provisions the defaults', async () => {
    const r = await rig('empty');
    await bind(r);
    const before = r.fake.calls.length;
    const { data } = await apply(r);
    expect(setupWrites(r.fake.calls.slice(before))).toEqual([
      'POST /api/v1/projects/:id/setup/auto-provision',
    ]);
    // The data of a setup without documents: run 4 of the mock-up.
    expect(data.setup).toEqual({
      docs: null,
      analysis: 'none',
      analysisPct: 0,
      fieldsTotal: 0,
      needsReview: [],
      profileApplied: false,
      validators: 5,
      testTypes: 3,
      testTypesToReview: 3,
      complete: false,
      missing: ['evidence', 'analysis', 'profile'],
    });
    expect(data.conformance).toBeUndefined();
  });

  it('does nothing that writes when the project is already configured', async () => {
    const r = await rig('project');
    await bind(r);
    const before = r.fake.calls.length;
    const { data } = await apply(r);
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
    expect(data.setup).toMatchObject({
      analysis: 'kept',
      analysisPct: 100,
      profileApplied: true,
      validators: 5,
      testTypes: 3,
      complete: true,
      missing: [],
      docs: {
        title: 'Sklep API',
        operations: expect.any(Number) as number,
        areas: expect.any(Number) as number,
      },
    });
    expect(r.fake.calls.some((call) => call.path.includes('/project-setup/runs/'))).toBe(false);
  });

  it('provisions only the validators and test types that are missing', async () => {
    const r = await rig('project');
    r.fake.store
      .collection(SKLEP_COLLECTIONS.testTypes)
      .list()
      .forEach((row) => r.fake.store.collection(SKLEP_COLLECTIONS.testTypes).delete(row.id));
    await bind(r);
    const { data } = await apply(r);
    expect(setupWrites(r.fake.calls)).toEqual(['POST /api/v1/projects/:id/setup/auto-provision']);
    expect(data.setup).toMatchObject({ analysis: 'kept', testTypes: 3, validators: 5 });
  });

  it('a description analysed without documentation applies with no documentation shown', async () => {
    const r = await rig('empty');
    const calls = await setUpProject(r, {
      ...PROJECT_ARGS,
      description: 'Shop: catalog, cart, orders.',
    });
    const data = (calls.apply?.outcome as { data: ApplyView }).data;
    expect(data.setup).toMatchObject({ analysis: 'analyzed', docs: null, complete: true });
    expect(data.conformance).toBeUndefined();
  });
});

describe('project_apply_setup: conformance of the default environment', () => {
  it('a protected default environment is not probed', async () => {
    const r = await rig('empty');
    const environments = SKLEP_ENVIRONMENTS.map((environment) =>
      environment.name === 'perf' ? { ...environment, limit: [50, 10] } : environment,
    );
    const calls = await setUpProject(r, { ...DOCS_ARGS, environments });
    const data = (calls.apply?.outcome as { data: ApplyView }).data;
    expect(data.conformance).toEqual({ environment: 'perf', result: { state: 'skipped' } });
    expect(r.fake.calls.some((call) => call.path.endsWith('/conformance'))).toBe(false);
  });

  it('a probe that does not answer is shown as failed, and the setup is done', async () => {
    const r = await rig('empty');
    r.fake.faults.next(
      'POST',
      '/api/v1/projects/{project_id}/environments/{environment_id}/conformance',
      { status: 502, body: { detail: 'bad gateway' } },
    );
    const calls = await setUpProject(r, DOCS_ARGS);
    expect(calls.apply?.isError, calls.apply?.text).toBe(false);
    const data = (calls.apply?.outcome as { data: ApplyView }).data;
    expect(data.conformance).toEqual({ environment: 'perf', result: { state: 'failed' } });
    expect(data.setup.complete).toBe(true);
  });
});

describe('project_apply_setup: the handle of the analysis', () => {
  it('an analysis still running is setup_analysis_running, and nothing is applied', async () => {
    const r = await rig('empty');
    await bind(r);
    const first = await settle(r, r.call('project_analyze_setup', { ...DOCS, max_wait_s: 3 }));
    const handle = (first.outcome as { operation?: string }).operation ?? '';
    expect(handle).toMatch(/^setup_analysis:/u);
    const result = await settle(r, r.call('project_apply_setup', { analysis: handle }));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[setup_analysis_running]');
    expect(result.text).toContain(handle);
    expect(result.text).toContain('process_wait');
    expect(setupWrites(r.fake.calls)).toEqual(['POST /api/v1/projects/:id/setup/analyze']);
  });

  it('a handle of another kind is refused before anything is written', async () => {
    const r = await rig('empty');
    await bind(r);
    const before = r.fake.calls.length;
    const result = await settle(
      r,
      r.call('project_apply_setup', { analysis: `test_run:${SKLEP_IDS.executionPerf}` }),
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[operation_kind_unsupported]');
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
  });

  it('a handle of an analysis of another project is refused before anything is written', async () => {
    const r = await rig('empty');
    await bind(r);
    const handle = await analysed(r);
    const other = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
    r.fake.faults.next('GET', '/api/v1/project-setup/runs/{run_id}', {
      status: 200,
      body: {
        run_id: handle.slice(handle.indexOf(':') + 1),
        status: 'awaiting_confirmation',
        phase: 'done',
        progress: 100,
        current_step: null,
        step_label: null,
        logs: [],
        project_id: other,
        flow_id: null,
        openapi_spec_ids: [],
        error: null,
        result: null,
      },
    });
    const before = r.fake.calls.length;
    const result = await settle(r, r.call('project_apply_setup', { analysis: handle }));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[setup_analysis_other_project]');
    expect(result.text).toContain('project_analyze_setup');
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
  });

  it('a run the backend forgot (a restart) is operation_lost', async () => {
    const r = await rig('empty');
    await bind(r);
    const handle = await analysed(r);
    r.fake.faults.next('GET', '/api/v1/project-setup/runs/{run_id}', {
      status: 404,
      body: { detail: 'Run not found: gone' },
    });
    const result = await settle(r, r.call('project_apply_setup', { analysis: handle }));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[operation_lost]');
    expect(setupWrites(r.fake.calls)).not.toContain('POST /api/v1/projects/:id/setup/apply');
  });

  it('keeps the canary out of the result, the log and the state', async () => {
    const r = await rig('empty');
    await setUpProject(r, DOCS_ARGS);
    r.assertClean();
    expect(JSON.stringify(r.fake.calls)).not.toContain(CANARY);
  });
});

const CONFORMANCE_ROUTE = '/api/v1/projects/{project_id}/environments/{environment_id}/conformance';

/** 31 candidates: 10 static GETs answered 400, 7 static non-GET, 14 GETs with path parameters. */
function allBadRequest(): Record<string, unknown> {
  const gets = Array.from({ length: 10 }, (_, index) => ({
    classification: 'inconclusive',
    method: 'GET',
    path: `/items/${String(index)}`,
    http_status: 400,
    reason: 'status_400',
  }));
  const posts = Array.from({ length: 7 }, (_, index) => ({
    classification: 'inconclusive',
    method: 'POST',
    path: `/items/${String(index)}`,
    http_status: null,
    reason: 'method_not_probed',
  }));
  return {
    base_url: 'https://api.perf.example.com',
    checked_at: '2026-11-22T10:00:00Z',
    inconclusive: [...gets, ...posts],
    sampled: { probed: 10, not_probed_methods: 7, skipped_param_paths: 14 },
    status: 'complete',
    totals: { exists: 0, inconclusive: 17, missing: 0 },
  };
}

describe('project_apply_setup: the checks it sets in the process', () => {
  it('a complete setup with documentation sets setup_applied, and env_checked from the conformance', async () => {
    const r = await rig('empty');
    await setUpProject(r, DOCS_ARGS);
    const checks = projectChecks(r);
    expect(checks['setup_applied']).toMatchObject({ ok: true, by: 'project_apply_setup' });
    expect(checks['env_checked']).toMatchObject({ ok: true, by: 'project_apply_setup' });
    // the documentation came with the analysis, which set its check
    expect(checks['docs_imported']).toMatchObject({ ok: true, by: 'project_analyze_setup' });
  });

  it('a default environment that lacks documented operations is not checked ok', async () => {
    const r = await rig('empty');
    r.fake.faults.next(
      'POST',
      '/api/v1/projects/{project_id}/environments/{environment_id}/conformance',
      {
        status: 200,
        body: {
          base_url: 'https://api.perf.example.com',
          checked_at: '2026-11-22T10:00:00Z',
          exists: [],
          missing: [{ classification: 'missing', method: 'GET', path: '/a', http_status: 404 }],
          sampled: { probed: 2, not_probed_methods: 0, skipped_param_paths: 0 },
          status: 'complete',
          totals: { exists: 1, inconclusive: 0, missing: 1 },
        },
      },
    );
    await setUpProject(r, DOCS_ARGS);
    expect(projectChecks(r)['env_checked']).toMatchObject({
      ok: false,
      by: 'project_apply_setup',
      note: 'conformance of perf: 1 documented GET operations answer, 1 missing',
    });
  });

  it('only inconclusive answers leave env_checked undecided: null, not green and not red', async () => {
    const r = await rig('empty');
    r.fake.faults.next('POST', CONFORMANCE_ROUTE, { status: 200, body: allBadRequest() });
    await setUpProject(r, DOCS_ARGS);
    const check = projectChecks(r)['env_checked'];
    expect(check).toMatchObject({ ok: null, by: 'project_apply_setup' });
    expect(check?.note).toContain('no documented GET operation answered');
  });

  it.each(['en', 'pl'] as const)(
    'counts every candidate once and shows the status of the probes with a hint (%s)',
    async (locale) => {
      const r = await rig('empty', { locale });
      r.fake.faults.next('POST', CONFORMANCE_ROUTE, { status: 200, body: allBadRequest() });
      const calls = await setUpProject(r, DOCS_ARGS);
      const data = (calls.apply?.outcome as { data: ApplyView }).data;
      expect(data.conformance).toMatchObject({
        environment: 'perf',
        result: {
          state: 'checked',
          exists: 0,
          missing: 0,
          inconclusive: 10,
          notProbedMethods: 7,
          skippedParams: 14,
          statuses: [{ status: 400, count: 10 }],
        },
      });
      const result = data.conformance?.result as unknown as Record<string, number>;
      const sum =
        (result['exists'] ?? 0) +
        (result['missing'] ?? 0) +
        (result['inconclusive'] ?? 0) +
        (result['notProbedMethods'] ?? 0) +
        (result['skippedParams'] ?? 0);
      expect(sum).toBe(31);
      const text = calls.apply?.text ?? '';
      expect(text).toContain('400 ×10');
      expect(text).toContain('project_save_env');
    },
  );

  it('a report that did not complete is named in the view', async () => {
    const r = await rig('empty');
    r.fake.faults.next('POST', CONFORMANCE_ROUTE, {
      status: 200,
      body: { ...allBadRequest(), status: 'canary_failed' },
    });
    const calls = await setUpProject(r, DOCS_ARGS);
    expect(calls.apply?.text).toContain('canary_failed');
  });

  it('a setup the gate does not let through sets setup_applied false, no docs_imported', async () => {
    const r = await rig('empty');
    await bind(r);
    await apply(r);
    const checks = projectChecks(r);
    expect(checks['setup_applied']).toMatchObject({ ok: false, by: 'project_apply_setup' });
    expect(checks['docs_imported']).toBeUndefined();
  });

  it('after an analysis that ended in process_wait', async () => {
    const r = await rig('empty');
    await bind(r);
    const first = await settle(r, r.call('project_analyze_setup', { ...DOCS, max_wait_s: 3 }));
    const handle = (first.outcome as { operation?: string }).operation ?? '';
    let waited = await settle(r, r.call('process_wait', { operation: handle }));
    for (let again = 0; again < 5 && (waited.outcome as { status: string }).status === 'running';) {
      again += 1;
      waited = await settle(r, r.call('process_wait', { operation: handle }));
    }
    expect((waited.outcome as { status: string }).status).toBe('done');
    const { data } = await apply(r, handle);
    expect(data.setup).toMatchObject({ analysis: 'analyzed', fieldsTotal: 9, complete: true });
    expect(projectChecks(r)['setup_applied']?.ok).toBe(true);
  });
});

describe('project_apply_setup: the text', () => {
  it.each(['en', 'pl'] as const)('a new project analysed from a document (%s)', async (locale) => {
    const r = await rig('empty', { locale });
    const calls = await setUpProject(r, DOCS_ARGS);
    await expect(calls.apply?.text).toMatchFileSnapshot(
      `__snapshots__/projectApplySetup.analysed.${locale}.txt`,
    );
  });

  it('en: everything was done earlier but provisioning leaves the gate open', async () => {
    const r = await rig('project');
    r.fake.store
      .collection(SKLEP_COLLECTIONS.validators)
      .list()
      .forEach((row) => {
        r.fake.store.collection(SKLEP_COLLECTIONS.validators).delete(row.id);
      });
    r.fake.store.collection<SetupRow>(SETUP_STATE).insert({
      id: SKLEP_WORLD_IDS.project,
      analysis_completed_at: '2026-11-22T10:00:00Z',
      profile_applied_at: '2026-11-22T10:00:00Z',
      has_asyncapi: false,
      validators_needs_review: 0,
      test_types_needs_review: 0,
    });
    r.fake.faults.next('POST', '/api/v1/projects/{project_id}/setup/auto-provision', {
      status: 200,
      body: {
        validators_created: 0,
        validators_skipped: true,
        test_types_created: 0,
        test_types_skipped: true,
      },
    });
    await bind(r);
    const { text, data } = await apply(r);
    expect(data.setup.complete).toBe(false);
    await expect(text).toMatchFileSnapshot('__snapshots__/projectApplySetup.incomplete.en.txt');
  });
});
