// Read routes of the module run (src/tools/run/): the stored load profiles, the saved runs, the
// history and compute time of the project, the diagnostics of one run and the headline results of
// the project's runs. The list of runs and the detail of one are the routes of `lookup.ts` and
// `results.ts`. Each route reads its own collection, filled by a seeding function of this file; a
// project with nothing seeded answers as the backend answers a project that has none of it. An error
// a test wants (a 404, a 500) is seeded as `{ error: { status, detail } }`. Registration is
// idempotent per fake.

import type { components } from '../../../src/http/generated/api.js';
import type { Fake, Store, SuccessBody } from '../server.js';
import { FakeHttpError } from '../server.js';
import { SKLEP_COLLECTIONS } from '../worlds/sklep.js';
import { requireRun } from './executionOwner.js';

const registered = new WeakSet<Fake>();

type Project = '/api/v1/projects/{project_id}';

export type ProfileBody = SuccessBody<`${Project}/gatling/configurations/{config_id}`, 'GET'>;
export type SavedRunBody = components['schemas']['SavedRun'];
export type HistoryBody = SuccessBody<`${Project}/gatling/ops/history`, 'GET'>;
export type UsageBody = SuccessBody<`${Project}/gatling/ops/resources`, 'GET'>;
export type DiagnosticsBody = SuccessBody<
  `${Project}/gatling/executions/{execution_id}/diagnostics`,
  'GET'
>;
export type RunResultsBody = SuccessBody<`${Project}/gatling/results`, 'GET'>;

/** An error answer a test seeds in place of a body. */
export interface SeededError {
  readonly error: { readonly status: number; readonly detail: unknown };
}
export type Seeded<T> = T | SeededError;

export const RUN_MODULE_COLLECTIONS = 'run_module_reads';

interface Stored {
  readonly id: string;
  readonly value: unknown;
}

export function put(store: Store, key: string, value: unknown): void {
  const records = store.collection<Stored>(RUN_MODULE_COLLECTIONS);
  records.delete(key);
  records.insert({ id: key, value });
}

export function read<T>(store: Store, key: string): T | undefined {
  return store.collection<Stored>(RUN_MODULE_COLLECTIONS).get(key)?.value as T | undefined;
}

function isSeededError(value: unknown): value is SeededError {
  return typeof value === 'object' && value !== null && 'error' in value;
}

function answered<T>(value: Seeded<T>): T {
  if (isSeededError(value)) {
    throw new FakeHttpError(value.error.status, { detail: value.error.detail });
  }
  return value;
}

/** The stored load profiles of the project, in the order the backend lists them. */
export function seedProfiles(store: Store, profiles: Seeded<readonly ProfileBody[]>): void {
  put(store, 'profiles', profiles);
}

/** The saved runs of the project. */
export function seedSavedRuns(store: Store, runs: Seeded<readonly SavedRunBody[]>): void {
  put(store, 'saved', runs);
}

/** The stored load profiles as the fake holds them now (what a test compares after a write). */
export function storedProfiles(store: Store): readonly ProfileBody[] {
  const value = read<Seeded<readonly ProfileBody[]>>(store, 'profiles') ?? [];
  return isSeededError(value) ? [] : value;
}

/** The finished runs the history of the project lists. */
export function seedHistory(store: Store, history: Seeded<HistoryBody>): void {
  put(store, 'history', history);
}

/** The compute time the project's runs used. */
export function seedUsage(store: Store, usage: Seeded<UsageBody>): void {
  put(store, 'usage', usage);
}

/** What a run kept for the diagnosis of a failure. */
export function seedDiagnostics(
  store: Store,
  executionId: string,
  diagnostics: Seeded<DiagnosticsBody>,
): void {
  put(store, `diagnostics:${executionId}`, diagnostics);
}

/** The headline results `GET …/gatling/results` lists. */
export function seedRunResults(store: Store, results: Seeded<RunResultsBody>): void {
  put(store, 'results', results);
}

function requireProject(store: Store, id: string): void {
  store.collection(SKLEP_COLLECTIONS.projects).require(id, `Project not found: ${id}`);
}

const NOT_FOUND_GATLING = 'Gatling project not found for project';

export function registerRunModuleRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  fake.route('GET', `${'/api/v1/projects/{project_id}'}/gatling/configurations`, (req, store) => {
    requireProject(store, req.params.project_id);
    const profiles = answered(read<Seeded<readonly ProfileBody[]>>(store, 'profiles') ?? []);
    const configurations = profiles.map((profile) => {
      const item: Record<string, unknown> = { ...profile };
      delete item['injection_steps'];
      return item as Omit<ProfileBody, 'injection_steps'>;
    });
    return { status: 200, body: { configurations, total: configurations.length } };
  });

  fake.route('POST', '/api/v1/projects/{project_id}/gatling/configurations', (req, store) => {
    requireProject(store, req.params.project_id);
    const body = (req.body ?? {}) as components['schemas']['CreateConfigurationBody'];
    const profiles = [...answered(read<Seeded<readonly ProfileBody[]>>(store, 'profiles') ?? [])];
    const id = store.newId();
    profiles.push({
      id,
      name: body.name,
      description: body.description ?? null,
      injection_profile: body.injection_profile,
      users: body.users ?? 10,
      duration_seconds: body.duration_seconds ?? 60,
      ramp_duration_seconds: body.ramp_duration_seconds ?? null,
      is_default: body.is_default ?? false,
      created_at: '2026-11-27T12:00:00Z',
      injection_steps: body.injection_steps ?? [],
    });
    put(store, 'profiles', profiles);
    return { status: 200, body: { id, message: 'Configuration created' } };
  });

  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}/gatling/configurations/{config_id}',
    (req, store) => {
      requireProject(store, req.params.project_id);
      const body = (req.body ?? {}) as components['schemas']['UpdateConfigurationBody'];
      const profiles = [...answered(read<Seeded<readonly ProfileBody[]>>(store, 'profiles') ?? [])];
      const index = profiles.findIndex((item) => item.id === req.params.config_id);
      const current = profiles[index];
      if (current === undefined)
        throw new FakeHttpError(404, { detail: 'Configuration not found' });
      // a field that is not sent, or is sent as null, stays as it is
      const next: ProfileBody = { ...current };
      if (body.name != null) next.name = body.name;
      if (body.description != null) next.description = body.description;
      if (body.injection_profile != null) next.injection_profile = body.injection_profile;
      if (body.users != null) next.users = body.users;
      if (body.duration_seconds != null) next.duration_seconds = body.duration_seconds;
      if (body.ramp_duration_seconds != null)
        next.ramp_duration_seconds = body.ramp_duration_seconds;
      if (body.is_default != null) next.is_default = body.is_default;
      profiles[index] = next;
      put(store, 'profiles', profiles);
      return { status: 200, body: { message: 'Configuration updated' } };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/configurations/{config_id}',
    (req, store) => {
      requireProject(store, req.params.project_id);
      const profiles = answered(read<Seeded<readonly ProfileBody[]>>(store, 'profiles') ?? []);
      const profile = profiles.find((item) => item.id === req.params.config_id);
      if (profile === undefined) {
        throw new FakeHttpError(404, { detail: 'Configuration not found' });
      }
      return { status: 200, body: { ...profile } };
    },
  );

  fake.route('GET', '/api/v1/projects/{project_id}/gatling/saved-runs', (req, store) => {
    requireProject(store, req.params.project_id);
    const runs = answered(read<Seeded<readonly SavedRunBody[]>>(store, 'saved') ?? []);
    return {
      status: 200,
      body: { saved_runs: runs.map((run) => ({ ...run })), total: runs.length },
    };
  });

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/saved-runs/{saved_run_id}',
    (req, store) => {
      requireProject(store, req.params.project_id);
      const runs = answered(read<Seeded<readonly SavedRunBody[]>>(store, 'saved') ?? []);
      const run = runs.find((item) => item.id === req.params.saved_run_id);
      if (run === undefined) throw new FakeHttpError(404, { detail: 'Saved run not found' });
      return { status: 200, body: { ...run } };
    },
  );

  fake.route('GET', '/api/v1/projects/{project_id}/gatling/ops/history', (req, store) => {
    requireProject(store, req.params.project_id);
    const history = answered(
      read<Seeded<HistoryBody>>(store, 'history') ?? { entries: [], total: 0 },
    );
    return { status: 200, body: history };
  });

  fake.route('GET', '/api/v1/projects/{project_id}/gatling/ops/resources', (req, store) => {
    requireProject(store, req.params.project_id);
    const usage = answered(
      read<Seeded<UsageBody>>(store, 'usage') ?? {
        measured_execution_count: 0,
        total_burn_seconds: 0,
      },
    );
    return { status: 200, body: usage };
  });

  fake.route('GET', '/api/v1/projects/{project_id}/gatling/results', (req, store) => {
    requireProject(store, req.params.project_id);
    const results = answered(
      read<Seeded<RunResultsBody>>(store, 'results') ?? { results: [], total: 0 },
    );
    return { status: 200, body: results };
  });

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/diagnostics',
    (req, store) => {
      requireRun(store, req.params.execution_id, req.params.project_id);
      const seeded = read<Seeded<DiagnosticsBody>>(store, `diagnostics:${req.params.execution_id}`);
      if (seeded === undefined) {
        throw new FakeHttpError(404, {
          detail: `${NOT_FOUND_GATLING} ${req.params.project_id}. Initialize it first.`,
        });
      }
      return { status: 200, body: answered(seeded) };
    },
  );
}
