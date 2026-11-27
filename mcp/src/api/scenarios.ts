// Scenario generation of the LoadCraft REST API and the reads it depends on: the start of a
// generation, the scenario list narrowed to what tells one generation's result from another, and
// the project's enabled test types, whose effective names key a data mix. The scenario list of the
// backend carries every scenario's full artifact (code, headers, data rows); none of it leaves
// this file except the source flow and the resolved data mix.

import * as z from 'zod';

import { must, stopRequest, type ApiContext } from './context.js';
import { LIST_LIMIT } from './lookup.js';
import { reads, type ResponseOf } from '../contract/reads.js';

/** A scenario as generation sees it. */
export interface ScenarioSource {
  readonly id: string;
  readonly name: string;
  readonly sourceFlowId: string | null;
  readonly createdAt: string | null;
  /** The data mix the scenario was generated with, percent by test type; `null` when unknown. */
  readonly classMix: Readonly<Record<string, number>> | null;
}

/** An enabled test type of the project. */
export interface TestTypeRef {
  /** Effective name: the key of a data mix. */
  readonly name: string;
  /** Name of the built-in type it is based on (`negative_testing`, `edge_cases`…). */
  readonly baseName: string | null;
  readonly label: string;
}

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

const mixSchema = z
  .record(z.string(), z.number())
  .nullish()
  .catch(null)
  .transform((mix) => mix ?? null);

const scenarioList = reads<ResponseOf<'/api/v1/projects/{project_id}/gatling/scenarios', 'get'>>()(
  z.object({
    scenarios: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        source_flow_id: nullable(z.string()),
        created_at: nullable(z.string()),
        scenario_artifact: z
          .object({
            generation_metadata: z.object({ resolved_class_mix: mixSchema }).nullish().catch(null),
          })
          .nullish()
          .catch(null),
      }),
    ),
  }),
);

/** The newest scenarios of the project (the backend sorts by last change), narrowed. */
export async function listScenarioSources(
  api: ApiContext,
  projectId: string,
): Promise<ScenarioSource[]> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/gatling/scenarios', {
      params: { path: { project_id: projectId }, query: { limit: LIST_LIMIT } },
      signal: api.signal,
    }),
  );
  return scenarioList.parse(data).scenarios.map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    sourceFlowId: scenario.source_flow_id,
    createdAt: scenario.created_at,
    classMix: scenario.scenario_artifact?.generation_metadata?.resolved_class_mix ?? null,
  }));
}

const started = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/scenarios/generate-async', 'post'>
>()(z.object({ run_id: z.string().min(1) }));

/**
 * The backend's default class name: sent as is, it makes the backend derive the class name from
 * the flow name and add a number on a clash.
 */
const DERIVED_CLASS_NAME = 'GeneratedSimulation';

/**
 * Starts the generation of one scenario from one flow. The backend answers at once with the id of
 * the run; progress, result and failure come only on the `scenario` channel of that run.
 */
export async function startScenarioGeneration(
  api: ApiContext,
  projectId: string,
  request: {
    readonly flowId: string;
    readonly scenarioName: string;
    readonly classMix: Readonly<Record<string, number>> | null;
  },
): Promise<{ runId: string }> {
  const data = await must(
    api.services.http.POST('/api/v1/projects/{project_id}/gatling/scenarios/generate-async', {
      params: { path: { project_id: projectId } },
      body: {
        flow_id: request.flowId,
        scenario_name: request.scenarioName,
        class_name: DERIVED_CLASS_NAME,
        ...(request.classMix === null ? {} : { class_mix: { ...request.classMix } }),
      },
      signal: api.signal,
    }),
  );
  return { runId: started.parse(data).run_id };
}

/** Stops a running generation; `false` when it is unknown or has already ended. */
export function cancelGeneration(
  api: ApiContext,
  projectId: string,
  runId: string,
): Promise<boolean> {
  return stopRequest(async () => {
    await must(
      api.services.http.POST(
        '/api/v1/projects/{project_id}/gatling/scenarios/generate-async/{run_id}/cancel',
        { params: { path: { project_id: projectId, run_id: runId } }, signal: api.signal },
      ),
    );
    return true;
  });
}

/** The enabled test types of the project, in the backend's order. */
export async function listEnabledTestTypes(
  api: ApiContext,
  projectId: string,
): Promise<TestTypeRef[]> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/test-types', {
      params: { path: { project_id: projectId }, query: { is_enabled: true } },
      signal: api.signal,
    }),
  );
  return data.items
    .filter((item) => item.is_enabled)
    .map((item) => ({
      name: item.effective_name,
      baseName: item.base_type_name ?? null,
      label: item.effective_display_name,
    }));
}
