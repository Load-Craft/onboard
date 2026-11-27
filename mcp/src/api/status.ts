// Reads behind `process_get_status`: who is calling, which backend answers, and the state of one project.
// Each read keeps only what the status view shows; the scenario list of the backend carries every
// scenario's full artifact, which never leaves this file.

// Namespace import: the bundler keeps only what is used; `import { z } from 'zod'` pulls in all of zod.
import * as z from 'zod';

import { LoadcraftApiError } from '../http/apiError.js';
import { getMeta } from '../http/compat.js';
import { callOperation } from '../http/operation.js';
import type { ToolContext } from '../context.js';
import { runVerdict, type ExecutionStatus, type VerdictState } from '../report/verdict.js';
import { must, type ApiContext } from './context.js';
import { LIST_LIMIT } from './lookup.js';
import { reads, type ResponseOf } from '../contract/reads.js';
import { unmetSteps, type SetupStep } from '../contract/setupGate.js';

export interface Compat {
  readonly backendVersion: string;
  readonly apiRevision: number;
}

// Steps of the setup gate, in the backend's order.
export { SETUP_STEPS, type SetupStep } from '../contract/setupGate.js';

export interface SetupState {
  readonly complete: boolean;
  /** Unmet gate steps, in gate order. */
  readonly missing: SetupStep[];
}

/** What the project holds that flows can be built from, as the setup gate lists its evidence. */
export interface EvidenceState {
  /** An API documentation (OpenAPI or AsyncAPI). */
  readonly docs: boolean;
  /** A HAR recording. */
  readonly recording: boolean;
}

export interface EnvironmentState {
  readonly name: string;
  readonly isDefault: boolean;
  readonly protected: boolean;
  readonly active: boolean;
  /** Load limits of the environment; a limit the environment does not set is absent. */
  readonly caps: { readonly maxVu?: number; readonly maxRps?: number };
}

export interface SlotState {
  /** Key of the slot, the value of the `slot` parameter of the data tools. */
  readonly slot: string;
  readonly label: string;
  /**
   * `bound`: a dataset is pinned; `missing`: the self-check waits for it; `open`: neither. The
   * scenario list does not carry pinned datasets, so this reader gives `missing` or `open`.
   */
  readonly state: 'bound' | 'missing' | 'open';
}

export interface ScenarioState {
  readonly id: string;
  readonly name: string;
  readonly sourceFlowId: string | null;
  readonly version: number | null;
  /** Status of the last self-check (`passed`, `waiting_for_data`, …); null before the first one. */
  readonly selfCheck: string | null;
  readonly slots: SlotState[];
}

export interface RunState {
  readonly id: string;
  readonly status: string;
  readonly scenarioId: string | null;
  readonly compositeId: string | null;
  /** ISO time the load started, or the time the run was created before that; empty when the run carries neither. */
  readonly when: string;
  /** Absent for a status the verdict rule does not know. */
  readonly verdict?: VerdictState;
}

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

const identitySchema = reads<ResponseOf<'/api/v1/auth/me', 'get'>>()(
  z.object({ user_id: nullable(z.string()) }),
);

/** The principal of the API token (`GET /api/v1/auth/me`). */
export async function getIdentity(api: ApiContext): Promise<{ userId: string | null }> {
  const data = await must(api.services.http.GET('/api/v1/auth/me', { signal: api.signal }));
  return { userId: identitySchema.parse(data).user_id };
}

/** Version facts of the backend; throws `backend_too_old` when the plugin cannot work with it. */
export async function getCompat(api: ApiContext): Promise<Compat> {
  const meta = await getMeta(api.services.http);
  return { backendVersion: meta.version, apiRevision: meta.api_revision };
}

/**
 * The gate's verdict (`setup_complete`) and the unmet steps, judged as the gate judges them
 * (the setup gate): an empty category or a missing timestamp is unmet, `needs_review` is not.
 */
export async function getSetupState(api: ApiContext, projectId: string): Promise<SetupState> {
  return (await getSetupFacts(api, projectId)).setup;
}

/** The gate's verdict and the evidence the project holds, from one read of the setup status. */
export async function getSetupFacts(
  api: ApiContext,
  projectId: string,
): Promise<{ readonly setup: SetupState; readonly evidence: EvidenceState }> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/setup/status', {
      params: { path: { project_id: projectId } },
      signal: api.signal,
    }),
  );
  return {
    setup: {
      complete: data.setup_complete,
      missing: unmetSteps(data),
    },
    evidence: {
      docs: data.evidence?.has_openapi === true || data.evidence?.has_asyncapi === true,
      recording: data.evidence?.has_har === true,
    },
  };
}

const capSchema = z.number().positive().optional().catch(undefined);
export const capsSchema = reads<
  ResponseOf<'/api/v1/projects/{project_id}/environments', 'get'>['items'][number]['workload_caps']
>()(
  z
    .object({ max_vu: capSchema, max_rps: capSchema })
    .nullish()
    .catch(null)
    .transform((caps) => ({
      ...(caps?.max_vu === undefined ? {} : { maxVu: caps.max_vu }),
      ...(caps?.max_rps === undefined ? {} : { maxRps: caps.max_rps }),
    })),
);

/** Environments, the default first, then by name (the backend's order). */
export async function listEnvironmentStates(
  api: ApiContext & Pick<ToolContext, 'secrets'>,
  projectId: string,
): Promise<EnvironmentState[]> {
  return (await listEnvironmentFacts(api, projectId)).states;
}

/** The environments and whether any of them has a frontend address, from one read. */
export async function listEnvironmentFacts(
  api: ApiContext & Pick<ToolContext, 'secrets'>,
  projectId: string,
): Promise<{ readonly states: EnvironmentState[]; readonly frontend: boolean }> {
  // The list holds the environments' own secrets: they are registered with the call before any
  // later refusal of LoadCraft can quote them.
  const data = await callOperation(
    api.services.http,
    'list_project_environments_api_v1_projects__project_id__environments_get',
    { path: { project_id: projectId } },
    { signal: api.signal, secrets: api.secrets },
  );
  return {
    states: data.items.map((item) => ({
      name: item.name,
      isDefault: item.is_default,
      protected: item.protected,
      active: item.is_active,
      caps: capsSchema.parse(item.workload_caps),
    })),
    frontend: data.items.some((item) => (item.frontend_url?.trim() ?? '') !== ''),
  };
}

const scenarioList = reads<ResponseOf<'/api/v1/projects/{project_id}/gatling/scenarios', 'get'>>()(
  z.object({
    scenarios: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        source_flow_id: nullable(z.string()),
        current_version: nullable(z.number()),
        self_check: z
          .object({ status: z.string(), missing_slots: z.array(z.string()).catch([]) })
          .nullish()
          .catch(null),
        feeder_slots: z
          .array(z.object({ slot: z.string(), label: nullable(z.string()) }))
          .catch([]),
      }),
    ),
  }),
);

/** Up to `LIST_LIMIT` scenarios: name, source flow, version, self-check and data slots. */
export async function listScenarioStates(
  api: ApiContext,
  projectId: string,
): Promise<ScenarioState[]> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/gatling/scenarios', {
      params: { path: { project_id: projectId }, query: { limit: LIST_LIMIT } },
      signal: api.signal,
    }),
  );
  return scenarioList.parse(data).scenarios.map((scenario) => {
    const missing = new Set(scenario.self_check?.missing_slots ?? []);
    return {
      id: scenario.id,
      name: scenario.name,
      sourceFlowId: scenario.source_flow_id,
      version: scenario.current_version,
      selfCheck: scenario.self_check?.status ?? null,
      slots: scenario.feeder_slots.map((slot) => ({
        slot: slot.slot,
        label: slot.label ?? slot.slot,
        state: missing.has(slot.slot) ? 'missing' : 'open',
      })),
    };
  });
}

const EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  'pending',
  'building',
  'running',
  'completed',
  'failed',
  'cancelled',
];

const isExecutionStatus = (value: string): value is ExecutionStatus =>
  (EXECUTION_STATUSES as readonly string[]).includes(value);

const slaVerdictSchema = z
  .object({ status: z.enum(['passed', 'failed', 'refused']), reason: nullable(z.string()) })
  .nullish()
  .catch(null)
  .transform((verdict) => verdict ?? null);

const executionList = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/executions', 'get'>
>()(
  z.object({
    executions: z.array(
      z.object({
        id: z.string(),
        status: z.string(),
        scenario_id: nullable(z.string()),
        composite_id: nullable(z.string()),
        started_at: nullable(z.string()),
        created_at: nullable(z.string()),
        source: nullable(z.string()),
        run_exit_code: nullable(z.number()),
        result_has_errors: nullable(z.boolean()),
        sla_verdict: slaVerdictSchema,
      }),
    ),
  }),
);

/** A run the plugin starts as a step of its own, not a test of the user. */
const SELF_CHECK_SOURCE = 'self_check';

/**
 * The newest tests of the project (self-check runs left out), newest first. The verdict ignores
 * the invariant report, which the list carries only in summary form; `results_get_report` reads it.
 */
export async function listRecentRuns(api: ApiContext, projectId: string): Promise<RunState[]> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/gatling/executions', {
      params: { path: { project_id: projectId }, query: { limit: LIST_LIMIT } },
      signal: api.signal,
    }),
  );
  return executionList
    .parse(data)
    .executions.filter((run) => run.source !== SELF_CHECK_SOURCE)
    .map((run) => {
      const base = {
        id: run.id,
        status: run.status,
        scenarioId: run.scenario_id,
        compositeId: run.composite_id,
        when: run.started_at ?? run.created_at ?? '',
      };
      if (!isExecutionStatus(run.status)) return base;
      const verdict = runVerdict({
        status: run.status,
        run_exit_code: run.run_exit_code,
        sla_verdict: run.sla_verdict,
        result_has_errors: run.result_has_errors,
      });
      return { ...base, verdict: verdict.state };
    });
}

/** Whether an AI analysis of the run is stored; the backend answers 404 while there is none. */
export async function hasAnalysis(
  api: ApiContext,
  projectId: string,
  executionId: string,
): Promise<boolean> {
  try {
    await must(
      api.services.http.GET(
        '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/analysis',
        {
          params: { path: { project_id: projectId, execution_id: executionId } },
          signal: api.signal,
        },
      ),
    );
    return true;
  } catch (error) {
    if (error instanceof LoadcraftApiError && error.status === 404) return false;
    throw error;
  }
}
