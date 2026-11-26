// Setup routes of the fake backend (`project_setup.py`, `project_setup_analyze*.py`): the status of
// the setup gate, the analysis run (started by a multipart request, followed by polling, kept only
// in memory), applying a profile and auto-provisioning validators and test types.
//
// The state of each project's setup lives in the `setup_state` collection. A project without a row
// is the seeded `sklep` project (its setup is finished, as in the session after the setup of step 01) or,
// for any other id, a project nothing has been done for. The analysis runs on the test clock
// (`jobs.ts`), so a test moves it with `clock.advance`; `forgets` simulates a backend restart with
// `fake.faults.restart()` (the run answers 404 afterwards, as the real run store does).
//
// `GET …/openapi` is `routes/suggestions.ts`; it returns the stored document, which this group
// writes when an analysis that carried a document finishes.

import type { components } from '../../../src/http/generated/api.js';
import {
  FakeHttpError,
  type Fake,
  type FakeFile,
  type FakeRequest,
  type Store,
} from '../server.js';
import { SKLEP_COLLECTIONS, SKLEP_WORLD_IDS, type SklepEndpoint } from '../worlds/sklep.js';

type ProjectDetail = components['schemas']['ProjectDetail'];
type EnvironmentResponse = components['schemas']['EnvironmentResponse'];
type SetupStatusResponse = components['schemas']['SetupStatusResponse'];
type ProjectProfile = components['schemas']['ProjectProfile'];
type FieldSuggestion = components['schemas']['FieldSuggestion'];
type ProjectSetupRunResponse = components['schemas']['ProjectSetupRunResponse'];
type OpenAPISpecSummary = components['schemas']['OpenAPISpecSummary'];
type ValidatorResponse = components['schemas']['ValidatorResponse'];
type TestTypeResponse = components['schemas']['TestTypeResponse'];
type ProfileFieldProvenance = components['schemas']['ProfileFieldProvenance'];

/** Collection of `SetupRow`s, one per project whose setup the routes have touched. */
export const SETUP_STATE = 'setup_state';

/** A stored specification: the summary plus the document the analysis saved. */
export type StoredSpec = OpenAPISpecSummary & {
  spec_content?: Record<string, unknown>;
};

export interface SetupRow {
  id: string;
  analysis_completed_at: string | null;
  profile_applied_at: string | null;
  has_asyncapi: boolean;
  validators_needs_review: number;
  test_types_needs_review: number;
  /** The suggestions of the last finished analysis (the run snapshot the backend keeps). */
  last_suggestions?: readonly FieldSuggestion[];
  /** Where each applied profile field came from, as the last apply wrote it. */
  field_provenance?: Readonly<Record<string, ProfileFieldProvenance>>;
}

/** Every key of the profile with the value the backend gives a field the request leaves out. */
export const SETUP_PROFILE_DEFAULTS: Required<{
  [K in keyof ProjectProfile]: ProjectProfile[K] | null;
}> = {
  additional_notes: null,
  agent_guidance: [],
  api_area_prefixes: null,
  api_protocol: 'rest',
  app_architecture: 'spa',
  app_description: null,
  auth_method: 'bearer_jwt',
  auth_token_endpoint: null,
  graphql_endpoint: null,
  has_async_operations: false,
  has_file_uploads: false,
  has_mfa: false,
  has_multi_tenant: false,
  has_pagination: false,
  has_presigned_urls: false,
  has_sse: false,
  has_websockets: false,
  idp_domains: [],
  known_third_party_domains: [],
  self_check_enabled: true,
  uses_csrf: false,
};

const suggestion = (
  path: string,
  value: unknown,
  confidence: number,
  source: FieldSuggestion['source_kinds'][number],
): FieldSuggestion => ({
  field_path: `project_profile.${path}`,
  value,
  confidence,
  status: 'suggested',
  source_kinds: [source],
});

/**
 * Nine profile suggestions: two to check (a model wrote one, one is weak); two unsure (the weak one,
 * and one its sources disagree about, which the result of apply does not list).
 */
export const SETUP_SUGGESTIONS: readonly FieldSuggestion[] = [
  suggestion('auth_method', 'bearer_jwt', 0.95, 'openapi'),
  suggestion('api_protocol', 'rest', 0.98, 'openapi'),
  suggestion('app_architecture', 'spa', 0.9, 'llm'),
  suggestion('has_pagination', true, 0.9, 'openapi'),
  suggestion('has_file_uploads', false, 0.85, 'openapi'),
  suggestion('has_websockets', false, 0.9, 'openapi'),
  suggestion('has_sse', false, 0.88, 'openapi'),
  suggestion('has_async_operations', true, 0.6, 'openapi'),
  // the sources disagree: unsure, though confident and read from the documentation
  { ...suggestion('uses_csrf', false, 0.93, 'openapi'), status: 'conflicted' },
];

export interface SetupPlan {
  /** What the analysis proposes. */
  readonly suggestions: readonly FieldSuggestion[];
  /** Milliseconds from the start to the end state. */
  readonly durationMs: number;
  /** The run ends `failed` with this phase and message instead of finishing. */
  readonly failure?: {
    readonly phase: 'analysis_failed' | 'persist_failed' | (string & Record<never, never>);
    readonly error: string;
  };
}

const DEFAULT_PLAN: SetupPlan = { suggestions: SETUP_SUGGESTIONS, durationMs: 9000 };

/** Nodes of the analysis graph with the progress the backend reports (`graph.py:71-93`). */
const STEPS: readonly (readonly [node: string, progress: number, label: string])[] = [
  ['input_to_messages', 5, 'Preparing project setup input...'],
  ['parse_uploaded_evidence', 18, 'Parsing uploaded evidence...'],
  ['fetch_docs_evidence', 34, 'Fetching documentation evidence...'],
  ['fetch_repo_evidence', 46, 'Fetching repository evidence...'],
  ['aggregate_evidence', 58, 'Aggregating evidence and readiness...'],
  ['enrich_profile', 72, 'Inferring project profile with AI...'],
  ['enrich_modules', 84, 'Naming modules with AI...'],
  ['enrich_summary', 92, 'Summarizing application context with AI...'],
  ['finalize_response', 100, 'Finalizing analysis result...'],
];

/** Time stamp of what the routes write (the handlers have no calendar). */
const WRITTEN_AT = '2026-11-22T10:30:00Z';

interface RunState {
  readonly status: ProjectSetupRunResponse['status'];
  readonly phase: string;
  readonly progress: number;
  readonly node?: string;
  readonly label?: string;
  readonly error?: string;
}

interface Run {
  readonly projectId: string;
  /** Documents the request carried, parsed; saved when the run finishes. */
  readonly openapi: Record<string, unknown> | undefined;
  readonly asyncapi: boolean;
  readonly description: string | undefined;
  persisted: boolean;
  /** The specification the finished run saved from its document. */
  specId?: string;
}

interface Handles {
  plan: SetupPlan;
  readonly runs: Map<string, Run>;
  /** Number of `POST …/setup/analyze` calls, for tests that count restarts. */
  starts: number;
}

const registered = new WeakMap<Fake, Handles>();

/** Replaces what the next analyses do (suggestions, duration, failure). */
export function planSetup(fake: Fake, plan: Partial<SetupPlan>): void {
  const handles = registered.get(fake);
  if (handles === undefined) throw new Error('planSetup: the setup routes are not registered');
  handles.plan = { ...handles.plan, ...plan };
}

/** Number of analyses started so far. */
export function setupStarts(fake: Fake): number {
  return registered.get(fake)?.starts ?? 0;
}

const projects = (store: Store) => store.collection<ProjectDetail>(SKLEP_COLLECTIONS.projects);
const rows = (store: Store) => store.collection<SetupRow>(SETUP_STATE);

function requireProject(store: Store, id: string): ProjectDetail {
  return projects(store).require(id, `Project not found: ${id}`);
}

/** The row of a project; the seeded project is finished, any other one is new. */
function rowOf(store: Store, projectId: string): SetupRow {
  const stored = rows(store).get(projectId);
  if (stored !== undefined) return stored;
  const finished = projectId === SKLEP_WORLD_IDS.project;
  return {
    id: projectId,
    analysis_completed_at: finished ? WRITTEN_AT : null,
    profile_applied_at: finished ? WRITTEN_AT : null,
    has_asyncapi: false,
    validators_needs_review: 0,
    test_types_needs_review: 0,
  };
}

function saveRow(store: Store, row: SetupRow): void {
  if (rows(store).get(row.id) === undefined) rows(store).insert(row);
  else rows(store).update(row.id, row);
}

const good = (ok: boolean): string => (ok ? 'good' : 'missing');

function validatorsOf(store: Store, projectId: string): ValidatorResponse[] {
  return store
    .collection<ValidatorResponse>(SKLEP_COLLECTIONS.validators)
    .list((item) => item.project_id === projectId);
}

function testTypesOf(store: Store, projectId: string): TestTypeResponse[] {
  return store
    .collection<TestTypeResponse>(SKLEP_COLLECTIONS.testTypes)
    .list((item) => item.project_id === projectId);
}

const VALIDATOR_TARGET = 5;
const TEST_TYPE_TARGET = 3;

function category(count: number, needsReview: number, target: number) {
  return {
    count,
    needs_review: needsReview,
    target,
    state: count === 0 ? 'missing' : needsReview > 0 ? 'review' : 'good',
  };
}

/** `GET …/setup/status` (`project_setup.py:110-122`) computed from the records and the row. */
function setupStatus(store: Store, projectId: string): SetupStatusResponse {
  const project = requireProject(store, projectId);
  const row = rowOf(store, projectId);
  const environments = store
    .collection<EnvironmentResponse>(SKLEP_COLLECTIONS.environments)
    .list((item) => item.project_id === projectId);
  const validators = validatorsOf(store, projectId);
  const testTypes = testTypesOf(store, projectId);
  const hasOpenapi = project.openapi_spec_id != null;
  const hasDescription = (project.description ?? '').trim() !== '';
  const evidenceGood = hasOpenapi || row.has_asyncapi || hasDescription;
  const steps = [
    environments.length > 0,
    evidenceGood,
    row.analysis_completed_at !== null,
    row.profile_applied_at !== null,
    validators.length > 0,
    testTypes.length > 0,
  ];
  return {
    validators: category(validators.length, row.validators_needs_review, VALIDATOR_TARGET),
    test_types: category(testTypes.length, row.test_types_needs_review, TEST_TYPE_TARGET),
    ready: validators.length > 0 && testTypes.length > 0,
    environments: {
      count: environments.length,
      state: good(environments.length > 0),
      probes: environments
        .filter((environment) => environment.last_probe != null)
        .map((environment) => ({
          environment_id: environment.id,
          name: environment.name,
          status: 'ok',
          checked_at: project.created_at,
        })),
    },
    evidence: {
      has_openapi: hasOpenapi,
      has_asyncapi: row.has_asyncapi,
      has_har: false,
      has_description: hasDescription,
      state: good(evidenceGood),
    },
    analysis: {
      completed_at: row.analysis_completed_at,
      state: good(row.analysis_completed_at !== null),
    },
    profile: {
      applied_at: row.profile_applied_at,
      state: good(row.profile_applied_at !== null),
      derived_from_environments: [],
      field_provenance: currentProvenance(row, project.project_profile ?? {}),
    },
    setup_complete: steps.every(Boolean),
  };
}

// ---- provenance of the applied profile ----------------------------------------------------

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The stored entries whose value the profile still holds (a later save drops the others). */
function currentProvenance(
  row: SetupRow,
  profile: Partial<ProjectProfile>,
): Record<string, ProfileFieldProvenance> {
  return Object.fromEntries(
    Object.entries(row.field_provenance ?? {}).filter(([field, entry]) =>
      same(entry.value, (profile as Record<string, unknown>)[field]),
    ),
  );
}

/**
 * The provenance an apply writes, by the backend's rule: a field holding the suggested value keeps
 * the suggestion's sources, confidence, rationale and status (`suggested` becomes `accepted`); a
 * confirmed one is `accepted` with `user` among its sources; another value is `edited` by the user.
 */
function appliedProvenance(
  applied: Record<string, unknown>,
  suggestions: readonly FieldSuggestion[],
  confirmed: ReadonlySet<string>,
): Record<string, ProfileFieldProvenance> {
  const suggested = new Map(
    suggestions
      .filter((item) => item.field_path.startsWith('project_profile.'))
      .map((item) => [item.field_path.slice('project_profile.'.length), item] as const)
      .filter(([field]) => field in applied),
  );
  const fields = [...new Set([...suggested.keys(), ...[...confirmed].filter((f) => f in applied)])];
  const entries: Record<string, ProfileFieldProvenance> = {};
  for (const field of fields.sort()) {
    const value = applied[field];
    const found = suggested.get(field);
    if (found === undefined || !same(found.value, value)) {
      entries[field] = {
        value,
        source_kinds: ['user'],
        status: found === undefined ? 'accepted' : 'edited',
        applied_at: WRITTEN_AT,
      };
      continue;
    }
    const sources = [...found.source_kinds];
    if (confirmed.has(field) && !sources.includes('user')) sources.push('user');
    entries[field] = {
      value,
      source_kinds: sources,
      confidence: found.confidence,
      rationale: found.rationale ?? null,
      status: confirmed.has(field)
        ? 'accepted'
        : found.status === 'suggested'
          ? 'accepted'
          : (found.status ?? 'accepted'),
      applied_at: WRITTEN_AT,
    };
  }
  return entries;
}

/** Puts provenance entries on a project's row, as an apply before this session left them. */
export function seedProvenance(
  store: Store,
  projectId: string,
  entries: Readonly<Record<string, ProfileFieldProvenance>>,
): void {
  saveRow(store, { ...rowOf(store, projectId), field_provenance: entries });
}

// ---- analysis -----------------------------------------------------------------------------

function parseJson(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new FakeHttpError(422, { detail: 'The document is not a JSON object' });
  }
  return parsed as Record<string, unknown>;
}

function filesOf(req: FakeRequest, field: string): FakeFile[] {
  return req.files.filter((file) => file.field === field);
}

/** `metadata` of the form: a JSON object (`project_setup_analyze_for_project.py`). */
function metadataOf(req: FakeRequest): Record<string, unknown> {
  const body = req.body as Record<string, unknown> | undefined;
  const raw = body?.['metadata'];
  if (typeof raw !== 'string') return {};
  try {
    return parseJson(raw);
  } catch {
    throw new FakeHttpError(422, { detail: 'Invalid metadata JSON' });
  }
}

/** The states of a run over its duration: queued, one state per node, then the end state. */
function schedule(plan: SetupPlan) {
  const gap = Math.max(1, Math.floor(plan.durationMs / (STEPS.length + 1)));
  const running = STEPS.slice(0, -1).map(([node, progress, label], index) => {
    const state: RunState = { status: 'analyzing', phase: 'analyzing', progress, node, label };
    return { afterMs: (index + 1) * gap, state };
  });
  const last = STEPS[STEPS.length - 1];
  const end: RunState =
    plan.failure === undefined
      ? {
          status: 'awaiting_confirmation',
          phase: 'analysis_complete',
          progress: 100,
          ...(last === undefined ? {} : { node: last[0], label: last[2] }),
        }
      : {
          status: 'failed',
          phase: plan.failure.phase,
          progress: 40,
          error: plan.failure.error,
        };
  return [
    { afterMs: 0, state: { status: 'queued', phase: 'queued', progress: 0 } as RunState },
    ...running,
    { afterMs: plan.durationMs, state: end },
  ];
}

function endpointsOf(document: Record<string, unknown>, specId: string): SklepEndpoint[] {
  const paths = document['paths'];
  if (typeof paths !== 'object' || paths === null) return [];
  const found: SklepEndpoint[] = [];
  for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
    if (typeof item !== 'object' || item === null) continue;
    for (const [method, operation] of Object.entries(item as Record<string, unknown>)) {
      const meta = (typeof operation === 'object' && operation !== null ? operation : {}) as {
        operationId?: string;
        summary?: string;
        tags?: unknown;
      };
      found.push({
        id: `${specId}:${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        operation_id: meta.operationId ?? null,
        summary: meta.summary ?? null,
        tags: Array.isArray(meta.tags) ? meta.tags.filter((tag) => typeof tag === 'string') : [],
        async_pattern: 'none',
        crud_operation: null,
        has_request_body: false,
        is_crud: false,
        is_paginated: false,
        parameters_count: 0,
        spec_id: specId,
      });
    }
  }
  return found;
}

/**
 * Saves a document as the project's current specification: a new row (every upload makes one),
 * its operations, and the project's pointer moved to it. Returns the id of the new specification.
 */
export function saveSpecification(
  store: Store,
  projectId: string,
  document: Record<string, unknown>,
): string {
  const info = (document['info'] ?? {}) as { title?: string; version?: string };
  const specId = store.newId();
  const specs = store.collection<StoredSpec>(SKLEP_COLLECTIONS.specs);
  for (const earlier of specs.list()) specs.update(earlier.id, { is_current: false });
  specs.insert({
    id: specId,
    title: info.title ?? 'API',
    version: info.version ?? '1',
    description: null,
    created_at: WRITTEN_AT,
    endpoints_count: 0,
    is_active: true,
    is_current: true,
    source_url: null,
    spec_content: document,
  });
  const endpoints = store.collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints);
  for (const endpoint of endpointsOf(document, specId)) endpoints.insert(endpoint);
  projects(store).update(projectId, { openapi_spec_id: specId });
  return specId;
}

/** The specification the project points to (the first stored one for a project with no pointer). */
export function currentSpec(store: Store, projectId: string): StoredSpec | undefined {
  const specs = store.collection<StoredSpec>(SKLEP_COLLECTIONS.specs);
  const pointer = projects(store).get(projectId)?.openapi_spec_id;
  return (pointer == null ? undefined : specs.get(pointer)) ?? specs.list()[0];
}

/** Operations of one specification. */
export function operationsOf(store: Store, specId: string): SklepEndpoint[] {
  return store
    .collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints)
    .list((endpoint) => endpoint.spec_id === specId);
}

/** `POST /auth/login` when the document has a POST operation on a login path. */
function detectLogin(document: Record<string, unknown>): string | undefined {
  const paths = document['paths'];
  if (typeof paths !== 'object' || paths === null) return undefined;
  for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
    if (/\/login$/u.test(path) && typeof item === 'object' && item !== null && 'post' in item) {
      return `POST ${path}`;
    }
  }
  return undefined;
}

/** What a finished analysis writes: the document as the current specification and the stamp. */
function persist(store: Store, run: Run, plan: SetupPlan): void {
  if (run.persisted) return;
  run.persisted = true;
  const row = rowOf(store, run.projectId);
  if (run.openapi !== undefined) {
    run.specId = saveSpecification(store, run.projectId, run.openapi);
    // The analysis notes where the API hands out its token, as a read of the document shows it.
    const login = detectLogin(run.openapi);
    const project = projects(store).get(run.projectId);
    if (login !== undefined && project?.project_profile?.auth_token_endpoint == null) {
      projects(store).update(run.projectId, {
        project_profile: {
          ...SETUP_PROFILE_DEFAULTS,
          ...project?.project_profile,
          auth_token_endpoint: login,
        } as ProjectProfile,
      });
    }
  }
  if (run.description !== undefined) {
    projects(store).update(run.projectId, { description: run.description });
  }
  saveRow(store, {
    ...row,
    analysis_completed_at: WRITTEN_AT,
    has_asyncapi: row.has_asyncapi || run.asyncapi,
    last_suggestions: [...plan.suggestions],
  });
}

function runBody(id: string, run: Run, state: RunState, plan: SetupPlan): ProjectSetupRunResponse {
  const done = state.status === 'awaiting_confirmation';
  return {
    run_id: id,
    status: state.status,
    phase: state.phase,
    progress: state.progress,
    current_step: state.node ?? null,
    step_label: state.label ?? null,
    logs: [],
    project_id: run.projectId,
    flow_id: null,
    openapi_spec_ids: run.specId === undefined ? [] : [run.specId],
    error: state.error ?? null,
    result: done
      ? {
          suggestions: [...plan.suggestions],
          project_summary: 'A shop API: catalog, cart, orders.',
          project_profile_draft: {},
          suggested_headers: [],
          detected_modules: [],
          analysis_summary: { parse_duration_ms: 120, sources_parsed: ['openapi'], warnings: [] },
          readiness: {
            can_create_project: true,
            can_generate_scenario: true,
            completeness_pct: 100,
            missing_required: [],
            missing_for_generation: [],
          },
        }
      : null,
  };
}

// ---- provisioning -------------------------------------------------------------------------

/** `auto_provision_service.py:29-61`: five validators, three test types; one validator is sure. */
const PROVISIONED_VALIDATORS: readonly [string, string, boolean][] = [
  ['status_code', 'Status code', false],
  ['schema_validation', 'Schema validation', true],
  ['response_status', 'Response status', true],
  ['response_time', 'Response time', true],
  ['data_consistency', 'Data consistency', true],
];
const PROVISIONED_TEST_TYPES: readonly [name: string, display: string, base: string | null][] = [
  ['invalid_input', 'Invalid input', 'negative_testing'],
  ['boundary_values', 'Boundary values', 'edge_cases'],
  ['missing_required_fields', 'Missing required fields', null],
];

/** Registers the setup routes; idempotent per fake. */
export function registerSetupRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  const handles: Handles = { plan: DEFAULT_PLAN, runs: new Map(), starts: 0 };
  registered.set(fake, handles);

  fake.route('GET', '/api/v1/projects/{project_id}/setup/status', (req, store) => ({
    status: 200,
    body: setupStatus(store, req.params.project_id),
  }));

  // `project_setup_analyze_for_project.py:184`.
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/setup/analyze',
    (req, store, jobs) => {
      requireProject(store, req.params.project_id);
      const metadata = metadataOf(req);
      const [openapiFile] = filesOf(req, 'openApiFiles');
      const summary = metadata['app_summary'];
      const run: Run = {
        projectId: req.params.project_id,
        openapi: openapiFile === undefined ? undefined : parseJson(openapiFile.content.toString()),
        asyncapi: filesOf(req, 'asyncApiFiles').length > 0,
        description: typeof summary === 'string' && summary.trim() !== '' ? summary : undefined,
        persisted: false,
      };
      handles.starts += 1;
      const job = jobs.start<RunState>('setup_analysis', { steps: schedule(handles.plan) });
      handles.runs.set(job.id, run);
      return { status: 200, body: { run_id: job.id, status: 'queued' as const } };
    },
    { auth: 'none' },
  );

  // `project_setup_analyze.py:151`: 404 for a run the process does not know (also after a restart).
  fake.route(
    'GET',
    '/api/v1/project-setup/runs/{run_id}',
    (req, store, jobs) => {
      const id = req.params.run_id;
      const job = jobs.find<RunState>(id);
      const run = handles.runs.get(id);
      if (job === undefined || run === undefined) {
        throw new FakeHttpError(404, { detail: `Run not found: ${id}` });
      }
      if (job.state.status === 'awaiting_confirmation') persist(store, run, handles.plan);
      return { status: 200, body: runBody(id, run, job.state, handles.plan) };
    },
    { auth: 'none' },
  );

  // `project_setup.py:325`: the profile sent is the whole model, a missing field takes its default.
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/setup/apply',
    (req, store) => {
      const id = req.params.project_id;
      requireProject(store, id);
      const body = req.body as components['schemas']['ApplySetupRequest'];
      const profile = body.project_profile;
      const stored =
        profile == null ? undefined : ({ ...SETUP_PROFILE_DEFAULTS, ...profile } as ProjectProfile);
      projects(store).update(id, {
        ...(stored === undefined ? {} : { project_profile: stored }),
        ...(body.description == null ? {} : { description: body.description }),
      });
      const row = rowOf(store, id);
      saveRow(store, {
        ...row,
        profile_applied_at: WRITTEN_AT,
        // the profile is replaced, so is its provenance
        ...(stored === undefined
          ? {}
          : {
              field_provenance: appliedProvenance(
                stored,
                row.last_suggestions ?? [],
                new Set(body.confirmed_fields ?? []),
              ),
            }),
      });
      return { status: 200, body: requireProject(store, id) };
    },
    { auth: 'none' },
  );

  // `project_setup.py:379`: a category that has rows is skipped unless `force`.
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/setup/auto-provision',
    (req, store) => {
      const id = req.params.project_id;
      requireProject(store, id);
      const force = (req.body as { force?: boolean } | undefined)?.force === true;
      const row = rowOf(store, id);
      const validators = store.collection<ValidatorResponse>(SKLEP_COLLECTIONS.validators);
      const testTypes = store.collection<TestTypeResponse>(SKLEP_COLLECTIONS.testTypes);
      const skipValidators = validatorsOf(store, id).length > 0 && !force;
      const skipTestTypes = testTypesOf(store, id).length > 0 && !force;
      if (!skipValidators) {
        PROVISIONED_VALIDATORS.forEach(([name, display, review], index) => {
          validators.insert({
            id: store.newId(),
            project_id: id,
            default_params: {},
            is_enabled: true,
            priority: index + 1,
            effective_name: name,
            effective_display_name: display,
            effective_validator_type: 'assertion',
            effective_category: 'http',
            evaluated_after_run: false,
            needs_review: review,
          });
        });
      }
      if (!skipTestTypes) {
        PROVISIONED_TEST_TYPES.forEach(([name, display, base], index) => {
          testTypes.insert({
            id: store.newId(),
            project_id: id,
            default_count: 3,
            is_enabled: true,
            priority: index + 1,
            base_type_name: base,
            effective_name: name,
            effective_display_name: display,
            effective_category: base === 'edge_cases' ? 'edge' : 'negative',
          });
        });
      }
      saveRow(store, {
        ...row,
        validators_needs_review: skipValidators
          ? row.validators_needs_review
          : PROVISIONED_VALIDATORS.filter(([, , review]) => review).length,
        test_types_needs_review: skipTestTypes
          ? row.test_types_needs_review
          : PROVISIONED_TEST_TYPES.length,
      });
      return {
        status: 200,
        body: {
          validators_created: skipValidators ? 0 : PROVISIONED_VALIDATORS.length,
          validators_skipped: skipValidators,
          test_types_created: skipTestTypes ? 0 : PROVISIONED_TEST_TYPES.length,
          test_types_skipped: skipTestTypes,
        },
      };
    },
    { auth: 'none' },
  );
}
