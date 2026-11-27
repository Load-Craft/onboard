// Lists the resolver searches by name. Each call keeps only what a lookup needs: the scenario list
// of the backend carries every scenario's full artifact, which must never reach a tool result.

import * as z from 'zod';

import { callOperation } from '../http/operation.js';
import { must, type ApiContext, type SecretApiContext } from './context.js';
import { listFlows as listFlowSummaries } from './flows.js';
import { reads, type ResponseOf } from '../contract/reads.js';

export interface Named {
  readonly id: string;
  readonly name: string;
}

export interface ScenarioRef extends Named {
  readonly source_flow_id: string | null;
  readonly current_version: number | null;
}

export interface ExecutionRef {
  readonly id: string;
  readonly status: string | null;
  readonly scenario_id: string | null;
  readonly composite_id: string | null;
  readonly started_at: string | null;
}

/** Most the Gatling lists return in one page. */
export const LIST_LIMIT = 100;

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

const named = z.object({ id: z.string(), name: z.string() });
const scenarioList = reads<ResponseOf<'/api/v1/projects/{project_id}/gatling/scenarios', 'get'>>()(
  z.object({
    scenarios: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        source_flow_id: nullable(z.string()),
        current_version: nullable(z.number()),
      }),
    ),
  }),
);
const compositionList = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/compositions', 'get'>
>()(z.object({ compositions: z.array(named) }));
const executionList = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/executions', 'get'>
>()(
  z.object({
    executions: z.array(
      z.object({
        id: z.string(),
        status: nullable(z.string()),
        scenario_id: nullable(z.string()),
        composite_id: nullable(z.string()),
        started_at: nullable(z.string()),
      }),
    ),
  }),
);

/** Page size for `GET /api/v1/projects`; the route has no upper bound in the backend. */
export const PROJECT_PAGE = 100;
/** Pages read at most (10 000 projects); a guard against a route that never returns a short page. */
const PROJECT_PAGES_MAX = 100;

/** Every project, read page by page until a page comes back short. */
export async function listProjects(api: ApiContext): Promise<Named[]> {
  const projects: Named[] = [];
  for (let page = 0; page < PROJECT_PAGES_MAX; page += 1) {
    const data = await must(
      api.services.http.GET('/api/v1/projects', {
        params: { query: { limit: PROJECT_PAGE, offset: page * PROJECT_PAGE } },
        signal: api.signal,
      }),
    );
    const items = data.projects;
    for (const item of items) projects.push({ id: item.id, name: item.name });
    if (items.length < PROJECT_PAGE) break;
  }
  return projects;
}

export async function getProject(api: SecretApiContext, projectId: string): Promise<Named> {
  const data = await callOperation(
    api.services.http,
    'get_project_api_v1_projects__project_id__get',
    {
      path: { project_id: projectId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return { id: data.id, name: data.name };
}

export async function listEnvironments(api: SecretApiContext, projectId: string): Promise<Named[]> {
  const data = await callOperation(
    api.services.http,
    'list_project_environments_api_v1_projects__project_id__environments_get',
    {
      path: { project_id: projectId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return data.items.map((item) => ({ id: item.id, name: item.name }));
}

/** Flows by name; the list itself is read by `api/flows.ts`. */
export async function listFlows(api: ApiContext, projectId: string): Promise<Named[]> {
  return (await listFlowSummaries(api, projectId)).map((flow) => ({
    id: flow.id,
    name: flow.name,
  }));
}

export async function listScenarios(api: ApiContext, projectId: string): Promise<ScenarioRef[]> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/gatling/scenarios', {
      params: { path: { project_id: projectId }, query: { limit: LIST_LIMIT } },
      signal: api.signal,
    }),
  );
  return scenarioList.parse(data).scenarios;
}

export async function listCompositions(api: SecretApiContext, projectId: string): Promise<Named[]> {
  const data = await callOperation(
    api.services.http,
    'list_compositions_api_v1_projects__project_id__gatling_compositions_get',
    {
      path: { project_id: projectId },
      query: { limit: LIST_LIMIT },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return compositionList.parse(data).compositions;
}

/** The last `LIST_LIMIT` executions of the project, newest first. */
export async function listExecutions(api: ApiContext, projectId: string): Promise<ExecutionRef[]> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/gatling/executions', {
      params: { path: { project_id: projectId }, query: { limit: LIST_LIMIT } },
      signal: api.signal,
    }),
  );
  return executionList.parse(data).executions;
}
