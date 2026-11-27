// Read-only lookups the handle resolver relies on, answered from the collections of the sklep
// world: the project list and detail, and the project's environments, scenarios, compositions and
// executions. The scenario list carries the full artifact, as the backend's list does. The flow list
// is registered once, by `registerFlowRoutes` (`routes/flows.ts`); a test that resolves flows
// registers both groups.

import type { components } from '../../../src/http/generated/api.js';
import type { Fake, Store } from '../server.js';
import { scenarioReadHooks } from './data.js';
import {
  SKLEP_COLLECTIONS,
  type SklepComposition,
  type SklepExecution,
  type SklepScenario,
} from '../worlds/sklep.js';

type ProjectDetail = components['schemas']['ProjectDetail'];
type EnvironmentResponse = components['schemas']['EnvironmentResponse'];

const LIST_DEFAULT_LIMIT = 50;

function limitOf(raw: string | undefined, fallback: number): number {
  const parsed = raw === undefined ? fallback : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Newest first, as the backend sorts its lists (`updated_at` / `created_at` descending). */
function newestFirst<T>(items: readonly T[], at: (item: T) => string): T[] {
  return [...items].sort((a, b) => at(b).localeCompare(at(a)));
}

function requireProject(store: Store, id: string): void {
  store
    .collection<ProjectDetail>(SKLEP_COLLECTIONS.projects)
    .require(id, `Project not found: ${id}`);
}

export function registerLookupRoutes(fake: Fake): void {
  fake.route('GET', '/api/v1/projects', (req, store) => {
    const limit = limitOf(req.query['limit'], LIST_DEFAULT_LIMIT);
    const offset = Number(req.query['offset'] ?? 0);
    const active = req.query['is_active'];
    const all = newestFirst(
      store
        .collection<ProjectDetail>(SKLEP_COLLECTIONS.projects)
        .list((project) => active === undefined || String(project.is_active) === active),
      (project) => project.updated_at,
    );
    const projects = all.slice(offset, offset + limit).map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description ?? null,
      project_type: project.project_type,
      base_url: project.base_url,
      is_active: project.is_active,
      created_at: project.created_at,
      updated_at: project.updated_at,
      flows_count: 0,
      has_asyncapi_spec: false,
      has_openapi_spec: project.openapi_spec_id !== null,
      test_types_count: 0,
      validators_count: 0,
    }));
    return { status: 200, body: { projects, total: all.length } };
  });

  fake.route('GET', '/api/v1/projects/{project_id}', (req, store) => ({
    status: 200,
    body: store
      .collection<ProjectDetail>(SKLEP_COLLECTIONS.projects)
      .require(req.params.project_id, `Project not found: ${req.params.project_id}`),
  }));

  // `GET …/stats`: the flows and the runs of the world (one project), the share of runs that passed.
  fake.route('GET', '/api/v1/projects/{project_id}/stats', (req, store) => {
    const projectId = req.params.project_id;
    requireProject(store, projectId);
    const flows = store
      .collection<{ id: string; project_id: string }>(SKLEP_COLLECTIONS.flows)
      .list((flow) => flow.project_id === projectId);
    const runs = newestFirst(
      store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).list(),
      (run) => run.completed_at,
    );
    const passed = runs.filter((run) => run.run_exit_code === 0).length;
    return {
      status: 200,
      body: {
        total_flows: flows.length,
        total_executions: runs.length,
        total_templates: 0,
        pass_rate: runs.length === 0 ? 0 : (passed * 100) / runs.length,
        last_executed_at: runs[0]?.completed_at ?? null,
        recent_executions: [],
      },
    };
  });

  fake.route('GET', '/api/v1/projects/{project_id}/environments', (req, store) => {
    requireProject(store, req.params.project_id);
    const items = store
      .collection<EnvironmentResponse>(SKLEP_COLLECTIONS.environments)
      .list((e) => e.project_id === req.params.project_id);
    return { status: 200, body: { items, total: items.length } };
  });

  fake.route('GET', '/api/v1/projects/{project_id}/gatling/scenarios', (req, store) => {
    requireProject(store, req.params.project_id);
    scenarioReadHooks.get(fake)?.();
    const limit = limitOf(req.query['limit'], LIST_DEFAULT_LIMIT);
    const scenarios = newestFirst(
      store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios).list(),
      (scenario) => scenario.updated_at,
    ).slice(0, limit);
    return { status: 200, body: { scenarios, total: scenarios.length } };
  });

  fake.route('GET', '/api/v1/projects/{project_id}/gatling/compositions', (req, store) => {
    requireProject(store, req.params.project_id);
    const limit = limitOf(req.query['limit'], LIST_DEFAULT_LIMIT);
    const wanted = req.query['status'];
    const compositions = newestFirst(
      store
        .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
        .list((composition) => wanted === undefined || composition.status === wanted),
      (composition) => composition.updated_at,
    ).slice(0, limit);
    return { status: 200, body: { compositions, total: compositions.length } };
  });

  fake.route('GET', '/api/v1/projects/{project_id}/gatling/executions', (req, store) => {
    requireProject(store, req.params.project_id);
    const limit = limitOf(req.query['limit'], LIST_DEFAULT_LIMIT);
    const executions = newestFirst(
      store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).list(),
      (execution) => execution.created_at,
    ).slice(0, limit);
    return { status: 200, body: { executions, total: executions.length } };
  });
}
