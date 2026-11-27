// Write routes of the module run: the deletes of src/tools/run/delete.ts (a run, refused while it builds
// or runs, as the backend refuses it; a stored load profile; a saved run) and the create and the update
// of a saved run (src/tools/run/save.ts): a new one is unscheduled, an update leaves out or keeps a
// field that is omitted or null, and the target never changes. The stored profiles and saved runs are
// the ones `run.ts` seeds; the runs are those of the sklep world. Registration is idempotent per fake.

import type { components } from '../../../src/http/generated/api.js';
import type { Fake } from '../server.js';
import { FakeHttpError } from '../server.js';
import { SKLEP_COLLECTIONS, type SklepExecution } from '../worlds/sklep.js';
import { put, read, type ProfileBody, type SavedRunBody } from './run.js';

const registered = new WeakSet<Fake>();

const LIVE = new Set(['pending', 'building', 'running']);

export function registerRunWriteRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  fake.route(
    'DELETE',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      const runs = store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
      const run = runs.require(req.params.execution_id, 'Execution not found');
      if (LIVE.has(run.status)) {
        throw new FakeHttpError(409, { detail: 'Execution is building or running; cancel first' });
      }
      runs.delete(run.id);
      return { status: 200, body: { message: 'Execution deleted' } };
    },
  );

  fake.route(
    'DELETE',
    '/api/v1/projects/{project_id}/gatling/configurations/{config_id}',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      const profiles = read<readonly ProfileBody[]>(store, 'profiles') ?? [];
      if (!profiles.some((item) => item.id === req.params.config_id)) {
        throw new FakeHttpError(404, { detail: 'Configuration not found' });
      }
      put(
        store,
        'profiles',
        profiles.filter((item) => item.id !== req.params.config_id),
      );
      return { status: 200, body: { message: 'Configuration deleted' } };
    },
  );

  const requireProject = (store: Parameters<typeof put>[0], id: string): void => {
    store.collection(SKLEP_COLLECTIONS.projects).require(id, `Project not found: ${id}`);
  };

  fake.route('POST', '/api/v1/projects/{project_id}/gatling/saved-runs', (req, store) => {
    requireProject(store, req.params.project_id);
    const body = req.body as components['schemas']['CreateSavedRunBody'];
    const saved = read<readonly SavedRunBody[]>(store, 'saved') ?? [];
    if (saved.some((item) => item.name === body.name)) {
      throw new FakeHttpError(400, { detail: 'A saved run with this name already exists' });
    }
    const created: SavedRunBody = {
      id: store.newId(),
      name: body.name,
      project_id: req.params.project_id,
      scenario_id: body.scenario_id ?? null,
      composite_id: body.composite_id ?? null,
      environment_id: body.environment_id ?? null,
      target_base_url: body.target_base_url ?? null,
      source_execution_id: body.source_execution_id ?? null,
      workload: body.workload ?? null,
      feeder_bindings: body.feeder_bindings ?? {},
      feeder_binding_contracts: [],
      feeder_binding_states: {},
      cron_expression: null,
      schedule_enabled: false,
      paused: false,
      auto_paused: false,
      consecutive_failures: 0,
      last_error: null,
      last_run_at: null,
      next_run_at: null,
      created_at: '2026-11-27T12:00:00Z',
      updated_at: '2026-11-27T12:00:00Z',
      created_by: null,
    };
    put(store, 'saved', [...saved, created]);
    return { status: 201, body: created };
  });

  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}/gatling/saved-runs/{saved_run_id}',
    (req, store) => {
      requireProject(store, req.params.project_id);
      const body = req.body as components['schemas']['UpdateSavedRunBody'];
      const saved = read<readonly SavedRunBody[]>(store, 'saved') ?? [];
      const found = saved.find((item) => item.id === req.params.saved_run_id);
      if (found === undefined) throw new FakeHttpError(404, { detail: 'Saved run not found' });
      const updated: SavedRunBody = {
        ...found,
        ...(body.name == null ? {} : { name: body.name }),
        ...(body.environment_id == null ? {} : { environment_id: body.environment_id }),
        ...(body.target_base_url == null ? {} : { target_base_url: body.target_base_url }),
        ...(body.workload == null ? {} : { workload: body.workload }),
        ...(body.feeder_bindings == null ? {} : { feeder_bindings: body.feeder_bindings }),
        updated_at: '2026-11-27T12:00:00Z',
      };
      put(
        store,
        'saved',
        saved.map((item) => (item.id === found.id ? updated : item)),
      );
      return { status: 200, body: updated };
    },
  );

  fake.route(
    'DELETE',
    '/api/v1/projects/{project_id}/gatling/saved-runs/{saved_run_id}',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      const saved = read<readonly SavedRunBody[]>(store, 'saved') ?? [];
      if (!saved.some((item) => item.id === req.params.saved_run_id)) {
        throw new FakeHttpError(404, { detail: 'Saved run not found' });
      }
      put(
        store,
        'saved',
        saved.filter((item) => item.id !== req.params.saved_run_id),
      );
      return { status: 204 };
    },
  );
}
