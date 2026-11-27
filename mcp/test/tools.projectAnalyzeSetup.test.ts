// `project_analyze_setup`: the analysis of the bound project's documentation or description as a
// long operation, the profile fields it proposes, joining a running analysis, a run the backend
// forgot, a failed analysis, the handle for `process_wait` and the checks it sets in the process.
// Nothing is applied here: `tools.projectApplySetup.test.ts` covers the profile and provisioning.

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
  SETUP_STATE,
  type SetupRow,
  type StoredSpec,
  setupStarts,
} from './fake-backend/routes/setup.js';
import type { Fake, FakeCall } from './fake-backend/server.js';
import { seedSklep, SKLEP_COLLECTIONS, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { settleClock } from './helpers/clock.js';
import {
  defaultEnvironment,
  SETUP_TOOLS,
  setUpProject,
  type SetupArgs,
} from './helpers/projectSetup.js';
import { CANARY, toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

const SKLEP_ENVIRONMENTS = [
  { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
  { name: 'qa', api: 'api.qa.example.com', frontend: 'qa.example.com', limit: [100, 20] },
  { name: 'dev', api: 'api.dev.example.com', frontend: 'dev.example.com' },
  { name: 'prod', api: 'api.example.com', frontend: 'example.com', limit: [20, 5] },
];

const PROJECT_ARGS: SetupArgs = { name: 'sklep', environments: SKLEP_ENVIRONMENTS };
const DOCS = { openapi: 'loadcraft/openapi.json' };

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** An OpenAPI document of `operations` GET operations, stamped with the commit it was made from. */
function openapiDocument(commit: string | null, operations = 3, title = 'Sklep API'): string {
  const paths: Record<string, unknown> = {};
  for (let index = 1; index <= operations; index += 1) {
    paths[`/items/${String(index)}`] = {
      get: { operationId: `getItem${String(index)}`, summary: `Item ${String(index)}` },
    };
  }
  return JSON.stringify({
    openapi: '3.0.3',
    info: {
      title,
      version: '2.14.0',
      ...(commit === null ? {} : { 'x-loadcraft-source': { commit } }),
    },
    paths,
  });
}

interface AnalyzeView {
  readonly analysis: 'analyzed' | 'kept' | 'none';
  readonly fieldsTotal: number;
  readonly needsReview: readonly { field: string; value: unknown; source: string }[];
  readonly operation?: string;
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
  options: { locale?: 'en' | 'pl'; files?: Record<string, string> } = {},
): Promise<ToolRig> {
  return toolRig({
    tools: SETUP_TOOLS,
    world: world(stage),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: options.files ?? { 'loadcraft/openapi.json': openapiDocument('a41f9c2') },
  });
}

/** Moves the test clock until the call settles (see `settleClock`). */
const settle = (r: ToolRig, call: Promise<RigCallResult>): Promise<RigCallResult> =>
  settleClock(r, call);

/** The project and its environments, as `project_create` and `project_save_env` leave them. */
async function bind(r: ToolRig, args: SetupArgs = PROJECT_ARGS): Promise<void> {
  const first = defaultEnvironment(args);
  const create = await settle(
    r,
    r.call('project_create', {
      name: args.name,
      ...(args.description === undefined ? {} : { description: args.description }),
      environment: { name: first.name, api: first.api },
    }),
  );
  expect(create.isError, create.text).toBe(false);
  const saved = await settle(r, r.call('project_save_env', { environments: args.environments }));
  expect(saved.isError, saved.text).toBe(false);
}

async function analyze(
  r: ToolRig,
  args: Record<string, unknown> = DOCS,
): Promise<{ text: string; data: AnalyzeView; result: RigCallResult }> {
  const result = await settle(r, r.call('project_analyze_setup', args));
  if (result.isError) throw new Error(`project_analyze_setup failed: ${result.text}`);
  const structured = result.outcome as { status: string; data: AnalyzeView };
  expect(structured.status).toBe('done');
  return { text: result.text, data: structured.data, result };
}

/** Calls `process_wait` until the operation ends (at most six times). */
async function waitFor(r: ToolRig, handle: string): Promise<RigCallResult> {
  let result = await settle(r, r.call('process_wait', { operation: handle }));
  for (let again = 0; again < 5 && (result.outcome as { status: string }).status === 'running';) {
    again += 1;
    result = await settle(r, r.call('process_wait', { operation: handle }));
  }
  return result;
}

/** The text with its wrapped lines joined. */
const flat = (text: string): string => text.replace(/\s+/gu, ' ');

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
}

/** The checks of the project in the process of the bound project. */
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

describe('project_analyze_setup: the analysis and its proposals', () => {
  it('sends the documentation with the analysis once, polls it, and applies nothing', async () => {
    const r = await rig('empty');
    await bind(r);
    const before = r.fake.calls.length;
    const { data, text } = await analyze(r);
    const calls = r.fake.calls.slice(before);

    expect(setupWrites(calls)).toEqual(['POST /api/v1/projects/:id/setup/analyze']);
    expect(calls.some((call) => call.path.endsWith('/openapi') && call.method !== 'GET')).toBe(
      false,
    );
    const at = calls.findIndex((call) => call.path.endsWith('/setup/analyze'));
    const polls = calls.filter((call) => call.path.includes('/project-setup/runs/'));
    expect(polls.length).toBeGreaterThan(1);
    expect(calls.findIndex((call) => call.path.includes('/project-setup/runs/'))).toBeGreaterThan(
      at,
    );
    const body = calls[at]?.body as Record<string, unknown>;
    expect(body['openApiFiles']).toEqual({
      file: 'openapi.json',
      size: openapiDocument('a41f9c2').length,
    });

    expect(data).toEqual({
      analysis: 'analyzed',
      fieldsTotal: 9,
      needsReview: [
        { field: 'app_architecture', value: 'spa', source: 'llm' },
        { field: 'has_async_operations', value: true, source: 'openapi' },
      ],
      // weak, or the sources disagree: the user is asked before apply
      uncertain: [
        { field: 'has_async_operations', value: true, confidence: 0.6, conflicted: false },
        { field: 'uses_csrf', value: false, confidence: 0.93, conflicted: true },
      ],
      operation: expect.stringMatching(/^setup_analysis:[0-9a-f-]{36}$/u) as string,
    });
    // the next step names the handle project_apply_setup takes
    expect(flat(text)).toContain(`project_apply_setup with analysis "${data.operation ?? '?'}"`);
    r.assertClean();
  });

  it('counts the suggestion with the highest confidence and skips a rejected or unusable one', async () => {
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
          // A value outside the profile's choices is not counted.
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
    const { data } = await analyze(r);
    expect(data.fieldsTotal).toBe(2);
    // 0.8 is high confidence (the frontend's threshold); nothing is left to check.
    expect(data.needsReview).toEqual([]);
    expect(r.fake.calls.some((call) => call.path.endsWith('/setup/apply'))).toBe(false);
  });

  it('marks a field below the confidence threshold or written by a model for review', async () => {
    const r = await rig('project');
    freshSetup(r);
    planSetup(r.fake, {
      suggestions: [
        ['has_sse', 0.79, ['openapi']],
        ['has_pagination', 0.8, ['openapi']],
        ['uses_csrf', 0.95, ['openapi', 'llm']],
        ['has_websockets', 0.2, ['har', 'llm']],
      ].map(([path, confidence, sources]) => ({
        field_path: `project_profile.${String(path)}`,
        value: true,
        confidence: confidence as number,
        status: 'suggested' as const,
        source_kinds: sources as ('openapi' | 'har' | 'llm')[],
      })),
    });
    await bind(r);
    const { data } = await analyze(r);
    expect(data.needsReview.map((item) => [item.field, item.source])).toEqual([
      ['has_sse', 'openapi'],
      ['uses_csrf', 'llm'],
      ['has_websockets', 'llm'],
    ]);
  });

  it('keeps an analysis done before: no write, no run, no handle', async () => {
    const r = await rig('project');
    await bind(r);
    const before = r.fake.calls.length;
    const { data, text } = await analyze(r);
    const calls = r.fake.calls.slice(before);
    expect(writes(calls)).toEqual([]);
    expect(data).toEqual({ analysis: 'kept', fieldsTotal: 0, needsReview: [] });
    expect(calls.some((call) => call.path.includes('/project-setup/runs/'))).toBe(false);
    expect(flat(text)).toContain('project_apply_setup without analysis');
  });

  it('leaves the documentation out when the project already has it (same commit)', async () => {
    const r = await rig('empty');
    await bind(r);
    const [project] = r.fake.store.collection<{ id: string }>(SKLEP_COLLECTIONS.projects).list();
    r.fake.store.collection<StoredSpec>(SKLEP_COLLECTIONS.specs).insert({
      id: 'spec-1',
      title: 'Sklep API',
      version: '2.14.0',
      created_at: '2026-11-22T10:00:00Z',
      endpoints_count: 0,
      is_active: true,
      is_current: true,
      spec_content: JSON.parse(openapiDocument('a41f9c2')) as Record<string, unknown>,
    });
    r.fake.store
      .collection(SKLEP_COLLECTIONS.projects)
      .update(project?.id ?? '', { openapi_spec_id: 'spec-1' });
    const before = r.fake.calls.length;
    await analyze(r);
    const call = r.fake.calls.slice(before).find((item) => item.path.endsWith('/setup/analyze'));
    expect(call).toBeDefined();
    expect((call?.body as Record<string, unknown>)['openApiFiles']).toBeUndefined();
  });

  it('sends the documentation when the commit differs from the stored one', async () => {
    const r = await rig('project', {
      files: { 'loadcraft/openapi.json': openapiDocument('b72e0d1') },
    });
    freshSetup(r);
    await bind(r);
    await analyze(r);
    const call = r.fake.calls.find((item) => item.path.endsWith('/setup/analyze'));
    expect((call?.body as Record<string, unknown>)['openApiFiles']).toBeDefined();
  });

  it('sends the AsyncAPI document with the analysis', async () => {
    const r = await rig('empty', {
      files: {
        'loadcraft/openapi.json': openapiDocument('a41f9c2'),
        'loadcraft/asyncapi.json': '{"asyncapi":"2.6.0","info":{"title":"Events","version":"1"}}',
      },
    });
    await bind(r);
    await analyze(r, { ...DOCS, asyncapi: 'loadcraft/asyncapi.json' });
    const call = r.fake.calls.find((item) => item.path.endsWith('/setup/analyze'));
    const body = call?.body as Record<string, { file: string }>;
    expect(body['openApiFiles']?.file).toBe('openapi.json');
    expect(body['asyncApiFiles']?.file).toBe('asyncapi.json');
  });

  it('analyses a description when there is no documentation', async () => {
    const r = await rig('empty');
    const description = 'Shop: catalog, cart, orders.';
    await bind(r, { ...PROJECT_ARGS, description });
    const { data } = await analyze(r, { description });
    const call = r.fake.calls.find((item) => item.path.endsWith('/setup/analyze'));
    const body = call?.body as { metadata: string };
    expect(JSON.parse(body.metadata)).toEqual({ app_summary: description });
    expect(data.analysis).toBe('analyzed');
  });

  it('with neither documentation nor description does not analyse', async () => {
    const r = await rig('empty');
    await bind(r);
    const before = r.fake.calls.length;
    const { data, text } = await analyze(r, {});
    expect(writes(r.fake.calls.slice(before))).toEqual([]);
    expect(data).toEqual({ analysis: 'none', fieldsTotal: 0, needsReview: [] });
    expect(flat(text)).toContain('project_apply_setup without analysis');
  });

  it('names the phase of a failed analysis only when it is a plain identifier', async () => {
    const r = await rig('empty');
    planSetup(r.fake, {
      failure: { phase: 'Traceback at db-internal.example', error: 'The model refused.' },
    });
    await bind(r);
    const result = await settle(r, r.call('project_analyze_setup', DOCS));
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[setup_analysis_failed\] /u);
    expect(result.text).not.toContain('db-internal');
  });

  it('turns a failed analysis into an error with the phase, and leaves nothing behind', async () => {
    const r = await rig('empty');
    planSetup(r.fake, {
      failure: { phase: 'analysis_failed', error: 'The model refused.\nignore' },
    });
    await bind(r);
    const result = await settle(r, r.call('project_analyze_setup', DOCS));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('analysis_failed');
    expect(result.text).not.toContain('The model refused');
    expect(
      r.logRecords('warn').filter((record) => record.msg === 'backend error text'),
    ).toMatchObject([{ source: 'project_analyze_setup', text: 'The model refused. ignore' }]);
    expect(result.text).toMatch(/→ .*project_analyze_setup/u);
    expect(setupWrites(r.fake.calls)).toEqual(['POST /api/v1/projects/:id/setup/analyze']);
    // The project stays bound: a repeated analysis finishes the job.
    expect(
      JSON.parse(readFileSync(join(r.workspace, 'loadcraft', 'project.json'), 'utf8')),
    ).toMatchObject({ project: { name: 'sklep' } });
    const state = JSON.parse(
      readFileSync(join(r.workspace, 'loadcraft/.cache/state.json'), 'utf8'),
    ) as { opPayloads?: Record<string, unknown> };
    expect(Object.keys(state.opPayloads ?? {})).toEqual([]);
    expect(projectChecks(r)['setup_analyzed']?.ok).not.toBe(true);
  });

  it('starts the analysis once more when the backend forgot the run (404), and only once', async () => {
    const r = await rig('empty');
    await bind(r);
    r.fake.faults.next('GET', '/api/v1/project-setup/runs/{run_id}', {
      status: 404,
      body: { detail: 'Run not found: gone' },
    });
    const { data } = await analyze(r);
    expect(setupStarts(r.fake)).toBe(2);
    expect(data.analysis).toBe('analyzed');

    const second = await rig('empty');
    await bind(second);
    for (let i = 0; i < 2; i += 1) {
      second.fake.faults.next('GET', '/api/v1/project-setup/runs/{run_id}', {
        status: 404,
        body: { detail: 'Run not found: gone' },
      });
    }
    const result = await settle(second, second.call('project_analyze_setup', DOCS));
    expect(result.isError).toBe(true);
    expect(setupStarts(second.fake)).toBe(2);
    expect(setupWrites(second.fake.calls)).not.toContain('POST /api/v1/projects/:id/setup/apply');
  });

  it('returns a handle when max_wait_s passes, and keeps the operation for process_wait', async () => {
    const r = await rig('empty');
    await bind(r);
    const result = await settle(r, r.call('project_analyze_setup', { ...DOCS, max_wait_s: 3 }));
    expect(result.isError, result.text).toBe(false);
    const body = result.outcome as { status: string; operation?: string };
    expect(body.status).toBe('running');
    expect(body.operation).toMatch(/^setup_analysis:[0-9a-f-]{36}$/u);
    expect(result.text).toContain(body.operation ?? '?');
    const state = JSON.parse(
      readFileSync(join(r.workspace, 'loadcraft/.cache/state.json'), 'utf8'),
    ) as { opPayloads: Record<string, unknown> };
    expect(Object.keys(state.opPayloads)).toEqual([body.operation]);
    expect(setupWrites(r.fake.calls)).toEqual(['POST /api/v1/projects/:id/setup/analyze']);
  });

  it('process_wait continues the analysis and draws the result of project_analyze_setup', async () => {
    const r = await rig('empty');
    await bind(r);
    const first = await settle(r, r.call('project_analyze_setup', { ...DOCS, max_wait_s: 3 }));
    const handle = (first.outcome as { operation?: string }).operation ?? '';
    expect(handle).toMatch(/^setup_analysis:/u);
    const result = await waitFor(r, handle);
    expect(result.isError, result.text).toBe(false);
    expect((result.outcome as { status: string }).status).toBe('done');
    expect((result.outcome as { data: AnalyzeView }).data).toMatchObject({
      analysis: 'analyzed',
      fieldsTotal: 9,
      operation: handle,
    });
    expect(flat(result.text)).toContain(`project_apply_setup with analysis "${handle}"`);
    expect(setupWrites(r.fake.calls).filter((call) => call.endsWith('/analyze'))).toHaveLength(1);
    expect(setupWrites(r.fake.calls)).not.toContain('POST /api/v1/projects/:id/setup/apply');
  });

  it('called again while the analysis runs joins it: no second POST, the same handle', async () => {
    const r = await rig('empty');
    await bind(r);
    const first = await settle(r, r.call('project_analyze_setup', { ...DOCS, max_wait_s: 3 }));
    const handle = (first.outcome as { operation?: string }).operation ?? '';
    expect(handle).toMatch(/^setup_analysis:/u);

    const again = await settle(r, r.call('project_analyze_setup', { ...DOCS, max_wait_s: 1 }));
    expect(again.isError, again.text).toBe(false);
    expect((again.outcome as { operation?: string }).operation).toBe(handle);
    expect(again.text).toContain(handle);
    expect(setupWrites(r.fake.calls)).toEqual(['POST /api/v1/projects/:id/setup/analyze']);
  });

  it('other material in the repeated call is other work: it is not answered with the older analysis', async () => {
    const r = await rig('empty');
    await bind(r);
    const first = await settle(r, r.call('project_analyze_setup', { ...DOCS, max_wait_s: 3 }));
    const handle = (first.outcome as { operation?: string }).operation ?? '';
    const other = await settle(
      r,
      r.call('project_analyze_setup', {
        ...DOCS,
        description: 'A shop with a cart',
        max_wait_s: 1,
      }),
    );
    expect(setupWrites(r.fake.calls)).toHaveLength(2);
    expect(other.text).not.toContain(handle);
  });

  it('a named backend error carries a hint', async () => {
    const r = await rig('empty');
    await bind(r);
    r.fake.faults.next('POST', '/api/v1/projects/{project_id}/setup/analyze', {
      status: 409,
      body: {
        detail:
          'Stored OpenAPI spec could not be parsed: bad. Upload the specification again to replace it.',
      },
    });
    const result = await settle(r, r.call('project_analyze_setup', DOCS));
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/→ /u);
  });

  it('without a bound project it sends nothing', async () => {
    const r = await rig('empty');
    const result = await settle(r, r.call('project_analyze_setup', DOCS));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[no_project]');
    expect(writes(r.fake.calls)).toEqual([]);
  });

  it('refuses a documentation file that is not there, and sends nothing', async () => {
    const r = await rig('empty');
    await bind(r);
    const before = r.fake.calls.length;
    const result = await settle(
      r,
      r.call('project_analyze_setup', { openapi: 'loadcraft/missing.json' }),
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain('loadcraft/missing.json');
    expect(r.fake.calls.slice(before)).toEqual([]);
  });

  it('refuses a description longer than LoadCraft keeps, and sends nothing', async () => {
    const r = await rig('empty');
    await bind(r);
    const before = r.fake.calls.length;
    const result = await settle(
      r,
      r.call('project_analyze_setup', { description: 'x'.repeat(8001) }),
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[init_project_description_too_long]');
    expect(r.fake.calls.slice(before)).toEqual([]);
  });

  it('keeps the canary out of the result, the log and the state', async () => {
    const r = await rig('empty');
    await setUpProject(r, { ...PROJECT_ARGS, ...DOCS });
    r.assertClean();
    expect(JSON.stringify(r.fake.calls)).not.toContain(CANARY);
  });
});

describe('project_analyze_setup: the checks it sets in the process', () => {
  it('a finished analysis of a document sets setup_analyzed and docs_imported', async () => {
    const r = await rig('empty');
    await bind(r);
    await analyze(r);
    const checks = projectChecks(r);
    expect(checks['setup_analyzed']).toMatchObject({ ok: true, by: 'project_analyze_setup' });
    expect(checks['docs_imported']).toMatchObject({ ok: true, by: 'project_analyze_setup' });
  });

  it('an analysis of a description sets setup_analyzed, not docs_imported', async () => {
    const r = await rig('empty');
    await bind(r);
    await analyze(r, { description: 'Shop: catalog, cart, orders.' });
    const checks = projectChecks(r);
    expect(checks['setup_analyzed']).toMatchObject({ ok: true });
    expect(checks['docs_imported']).toBeUndefined();
  });

  it('nothing to analyse sets neither', async () => {
    const r = await rig('empty');
    await bind(r);
    await analyze(r, {});
    const checks = projectChecks(r);
    expect(checks['setup_analyzed']).toBeUndefined();
    expect(checks['docs_imported']).toBeUndefined();
  });

  it('an analysis that ends in process_wait sets them there', async () => {
    const r = await rig('empty');
    await bind(r);
    const first = await settle(r, r.call('project_analyze_setup', { ...DOCS, max_wait_s: 3 }));
    const handle = (first.outcome as { operation?: string }).operation ?? '';
    expect(projectChecks(r)['setup_analyzed']).toBeUndefined();
    const result = await waitFor(r, handle);
    expect((result.outcome as { status: string }).status).toBe('done');
    const checks = projectChecks(r);
    expect(checks['setup_analyzed']?.ok).toBe(true);
    expect(checks['docs_imported']?.ok).toBe(true);
  });
});

describe('project_analyze_setup: the text', () => {
  it.each(['en', 'pl'] as const)('a new project analysed from a document (%s)', async (locale) => {
    const r = await rig('empty', { locale });
    await bind(r);
    const { text, data } = await analyze(r);
    const shown = text.replace(data.operation ?? '?', 'setup_analysis:<id>');
    await expect(shown).toMatchFileSnapshot(
      `__snapshots__/projectAnalyzeSetup.analysed.${locale}.txt`,
    );
  });
});
