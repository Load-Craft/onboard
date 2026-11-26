// Reads behind `scenario_check_self`: the start of a check, the `self_check` state of a scenario and the
// per-request rows of a check's run. The scenario document of the backend carries the whole
// artifact (code, headers, data rows); only the state, the name and the labels of the slots the
// check waits for leave this file.

import * as z from 'zod';

import { ToolError } from '../errors.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { must, type ApiContext } from './context.js';
import { reads, type ResponseOf } from '../contract/reads.js';

/** Code of the 409 the backend answers while a check of the scenario is running. */
const IN_PROGRESS_CODE = 'self_check_in_progress';
/** The 409 for a scenario without a modular build, which must be regenerated; the code is in its text. */
const REBUILD_CODE = 'full_rebuild_required';

/** States of a check that is still under way; every other one is final. */
export const IN_FLIGHT_STATUSES: readonly string[] = ['pending', 'running', 'repairing'];

export interface CheckFailure {
  /** Name of the first request that failed; absent for a failure that names none. */
  readonly request: string | null;
  readonly message: string | null;
  /** The status the failing request answered; absent when another check failed. */
  readonly httpStatus: number | null;
  /** Where the journey was meant to end (`goal_step_missing`). */
  readonly goalUrl: string | null;
}

/** One repair round of the AI: a change that created a version, or a refusal. */
export interface CheckRepair {
  /** Number of the round, from 1. */
  readonly round: number | null;
  /** What failed in the run before the round. */
  readonly failure: CheckFailure | null;
  readonly changes: string | null;
  /** The refusal in the model's own words (may be raw validation text); a fallback for a state stored before codes. */
  readonly refused: string | null;
  /** Why no version was written, as a code (`weakens_test`, `no_change`, …). */
  readonly refusedCode: string | null;
  /** The code as one sentence for a person. */
  readonly refusedMessage: string | null;
  /** Version of the scenario the round saved; absent for a refused round. */
  readonly version: number | null;
  /** The verdict of the run of that version. */
  readonly verdict: string | null;
}

/** A step of a run, in the order the run made it; a plan step the run never sent is `not_run`. */
export interface CheckRunStep {
  /** The request name without its group. */
  readonly name: string;
  /** The `group(...)` path of the step; absent outside a group. */
  readonly group: string | null;
  /** Index into the plan of the version run; absent when the plan has no such step. */
  readonly planIndex: number | null;
  /** A CORS preflight sent before the step at `planIndex`. */
  readonly isPreflight: boolean;
  readonly method: string | null;
  /** The path template of the plan, never the resolved address. */
  readonly path: string | null;
  readonly result: 'ok' | 'failed' | 'not_run';
  /** The status the step answered, when exactly one is known. */
  readonly httpStatus: number | null;
  /** The failure message of the failed step, or `connection failed`. */
  readonly reason: string | null;
}

/** One run of the scenario in a check: the first pass, or the run of a version a repair wrote. */
export interface CheckRun {
  readonly executionId: string;
  readonly version: number | null;
  /** The verdict of the run; absent while it runs. */
  readonly status: string | null;
  readonly steps: readonly CheckRunStep[];
  /** How many steps the backend left out of `steps`. */
  readonly stepsOmitted: number;
}

/** The `self_check` document of a scenario (`SelfCheckState`), narrowed to what a view shows. */
export interface SelfCheckState {
  readonly status: string;
  readonly version: number | null;
  /** Runs of the check, oldest first: the first pass and one more per repair that was tried. */
  readonly executionIds: readonly string[];
  readonly failure: CheckFailure | null;
  readonly notes: readonly string[];
  /** The slots without data: the key (what the data tools take) and the label LoadCraft gives. */
  readonly missingSlots: readonly { readonly slot: string; readonly label: string }[];
  readonly repairs: readonly CheckRepair[];
  /** The limit of repair rounds; absent in a state stored before the backend wrote it. */
  readonly maxRepairRounds: number | null;
  /** The runs of the check, oldest first, with the steps of each in the order they ran; empty in a state stored before runs. */
  readonly runs: readonly CheckRun[];
  /** ISO times; absent while the check has not started or has not ended. */
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface ScenarioSelfCheck {
  readonly name: string;
  /** `null` for a scenario that was never checked. */
  readonly state: SelfCheckState | null;
}

/** A request of a check's run, in the order the backend lists them. */
export interface CheckRequest {
  /** Where the run first answered the request (from 1); absent for a row the console lacks. */
  readonly runOrder: number | null;
  readonly name: string;
  readonly ok: number;
  readonly ko: number;
  readonly meanMs: number;
}

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

const failureSchema = z
  .object({
    request_name: nullable(z.string()),
    message: nullable(z.string()),
    http_status: nullable(z.number().int().min(100).max(599)).catch(null),
    goal_url: nullable(z.string()),
  })
  .nullish()
  .catch(null)
  .transform((failure): CheckFailure | null =>
    failure === null || failure === undefined
      ? null
      : {
          request: failure.request_name,
          message: failure.message,
          httpStatus: failure.http_status,
          goalUrl: failure.goal_url,
        },
  );

const repairSchema = z.object({
  round: nullable(z.number()),
  failure: failureSchema,
  changes_summary: nullable(z.string()),
  refused_reason: nullable(z.string()),
  refused_code: nullable(z.string()),
  refused_message: nullable(z.string()),
  scenario_version_after: nullable(z.number()),
  verdict: nullable(z.string()),
});

const stepSchema = z.object({
  name: z.string(),
  group: nullable(z.string()),
  plan_index: nullable(z.number()),
  is_preflight: z.boolean().catch(false),
  method: nullable(z.string()),
  path: nullable(z.string()),
  // A result the plugin does not know is read as a step that did not run, never as a pass.
  result: z.enum(['ok', 'failed', 'not_run']).catch('not_run'),
  http_status: nullable(z.number().int().min(100).max(599)).catch(null),
  reason: nullable(z.string()),
});

const runSchema = z.object({
  execution_id: z.string(),
  scenario_version: nullable(z.number()),
  status: nullable(z.string()),
  steps: z.array(stepSchema).catch([]),
  steps_omitted: z.number().int().min(0).catch(0),
});

const selfCheckSchema = z.object({
  status: z.string(),
  scenario_version: nullable(z.number()),
  execution_ids: z.array(z.string()).catch([]),
  failure: failureSchema,
  notes: z.array(z.string()).catch([]),
  missing_slots: z.array(z.string()).catch([]),
  repairs: z.array(repairSchema).catch([]),
  max_repair_rounds: nullable(z.number()),
  runs: z.array(runSchema).catch([]),
  started_at: nullable(z.string()),
  finished_at: nullable(z.string()),
});

const scenarioSchema = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}', 'get'>
>()(
  z.object({
    name: z.string(),
    self_check: selfCheckSchema.nullish().catch(null),
    feeder_slots: z.array(z.object({ slot: z.string(), label: nullable(z.string()) })).catch([]),
  }),
);

/**
 * Starts the check of a scenario: one user, one pass, on the project's default environment. The
 * backend answers at once; `false` means a check of this scenario is already running (409) —
 * the caller waits for that one.
 */
export async function startSelfCheck(
  api: ApiContext,
  projectId: string,
  scenarioId: string,
): Promise<{ started: boolean }> {
  try {
    await must(
      api.services.http.POST(
        '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/self-check',
        {
          params: { path: { project_id: projectId, scenario_id: scenarioId } },
          signal: api.signal,
        },
      ),
    );
    return { started: true };
  } catch (error) {
    if (error instanceof LoadcraftApiError && error.status === 409) {
      // Only this code means a check is under way; no check was started for any other 409.
      if (error.code === IN_PROGRESS_CODE) return { started: false };
      if (error.message.includes(REBUILD_CODE)) {
        throw new ToolError(REBUILD_CODE, { message: error.message, cause: error });
      }
    }
    throw error;
  }
}

/** Name and `self_check` state of a scenario; the artifact in the same answer is dropped. */
export async function readSelfCheck(
  api: ApiContext,
  projectId: string,
  scenarioId: string,
): Promise<ScenarioSelfCheck> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}', {
      params: { path: { project_id: projectId, scenario_id: scenarioId } },
      signal: api.signal,
    }),
  );
  const scenario = scenarioSchema.parse(data);
  const check = scenario.self_check;
  if (check === null || check === undefined) return { name: scenario.name, state: null };
  const labels = new Map(scenario.feeder_slots.map((slot) => [slot.slot, slot.label ?? slot.slot]));
  return {
    name: scenario.name,
    state: {
      status: check.status,
      version: check.scenario_version,
      executionIds: check.execution_ids,
      failure: check.failure,
      notes: check.notes,
      missingSlots: check.missing_slots.map((slot) => ({ slot, label: labels.get(slot) ?? slot })),
      repairs: check.repairs.map((repair) => ({
        round: repair.round,
        failure: repair.failure,
        changes: repair.changes_summary,
        refused: repair.refused_reason,
        refusedCode: repair.refused_code,
        refusedMessage: repair.refused_message,
        version: repair.scenario_version_after,
        verdict: repair.verdict,
      })),
      maxRepairRounds: check.max_repair_rounds,
      runs: check.runs.map((run) => ({
        executionId: run.execution_id,
        version: run.scenario_version,
        status: run.status,
        steps: run.steps.map((step) => ({
          name: step.name,
          group: step.group,
          planIndex: step.plan_index,
          isPreflight: step.is_preflight,
          method: step.method,
          path: step.path,
          result: step.result,
          httpStatus: step.http_status,
          reason: step.reason,
        })),
        stepsOmitted: run.steps_omitted,
      })),
      startedAt: check.started_at,
      finishedAt: check.finished_at,
    },
  };
}

const endpointsSchema = reads<
  ResponseOf<'/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints', 'get'>
>()(
  z.object({
    endpoints: z
      .array(
        z.object({
          name: z.string(),
          run_order: nullable(z.number()),
          ok_count: nullable(z.number()),
          ko_count: nullable(z.number()),
          mean_response_time: nullable(z.number()),
        }),
      )
      .catch([]),
    series_source: z.string().nullish().catch(null),
  }),
);

/** The series source of a run whose samples are there; any other one means the rows are empty. */
const SERIES_PRESENT = 'prometheus';

/**
 * The requests of one run of a check, in the order the run first answered them (rows the console lacks last). A run without samples
 * (they rolled out of retention, or the run left none) and a run the backend does not know give
 * an empty list, and so does a metrics store that does not answer (503): that is a fact about the data, not a failure of the check.
 */
export async function readSelfCheckRequests(
  api: ApiContext,
  projectId: string,
  executionId: string,
): Promise<CheckRequest[]> {
  let data: unknown;
  try {
    data = await must(
      api.services.http.GET(
        '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints',
        {
          params: {
            path: { project_id: projectId, execution_id: executionId },
            query: { order: 'run' },
          },
          signal: api.signal,
        },
      ),
    );
  } catch (error) {
    // The rows are a convenience for the totals (404: the backend does not know the run; 5xx: the metrics
    // store does not answer or fails). Whatever the backend says, the check has its result and only the
    // request rows are missing: the answer of the tool must not fail over them.
    if (error instanceof LoadcraftApiError) return [];
    throw error;
  }
  const answer = endpointsSchema.parse(data);
  if (answer.series_source !== SERIES_PRESENT) return [];
  return answer.endpoints.map((row) => ({
    runOrder: row.run_order,
    name: row.name,
    ok: row.ok_count ?? 0,
    ko: row.ko_count ?? 0,
    meanMs: row.mean_response_time ?? 0,
  }));
}
