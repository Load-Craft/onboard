// `run_get` (module run): Get one run: state, configuration, failure stage; include=diagnostics
// adds the build output.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The run is named by its handle (`e-1a2b3c4d`) or its UUID, as in module results. The
// diagnostics are a second read, made only under `include`; the build output and every text of the
// backend or the target pass the mask of a third party's text (`content`).
// Log: args "{run_id}", result "run {run_id}: {status}": the data carries both fields, so the
// result names the run by its UUID (the data's `run_id`) and the args by what was asked.
// Arguments (the catalog's): `run_id` (default: the run of this workspace) and `include`.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGet,
  type RunDetail,
  type RunDiagnostics,
  type RunInvariants,
  type RunSla,
} from '../../render/run/get.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  runIdArgument,
  runOf,
  thirdParty,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { workloadOf } from './common.js';
import { RUN_GET } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/executions/{execution_id} (REST API v1) */
export function getExecution(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
): Promise<
  OpOutput<'get_execution_api_v1_projects__project_id__gatling_executions__execution_id__get'>
> {
  return callBackend(
    ctx,
    'get_execution_api_v1_projects__project_id__gatling_executions__execution_id__get',
    { path },
  );
}

/** GET /projects/{project_id}/gatling/executions/{execution_id}/diagnostics (REST API v1) */
export function getExecutionDiagnostics(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
): Promise<
  OpOutput<'get_execution_diagnostics_api_v1_projects__project_id__gatling_executions__execution_id__diagnostics_get'>
> {
  return callBackend(
    ctx,
    'get_execution_diagnostics_api_v1_projects__project_id__gatling_executions__execution_id__diagnostics_get',
    { path },
  );
}

/** The warnings and the build-output lines the data carries, and the longest text of each. */
const WARNINGS_SHOWN = 5;
const OUTPUT_LINES = 40;

type Execution =
  OpOutput<'get_execution_api_v1_projects__project_id__gatling_executions__execution_id__get'>;
type Diagnostics =
  OpOutput<'get_execution_diagnostics_api_v1_projects__project_id__gatling_executions__execution_id__diagnostics_get'>;

function slaOf(ctx: CallContext, sla: Execution['sla_verdict']): RunSla | null {
  if (sla === null) return null;
  return {
    status: sla.status,
    reason: sla.reason === null ? null : thirdParty(ctx, sla.reason, LIMITS.sentence),
    assertions: sla.assertions.length,
    failed: sla.assertions.filter((assertion) => assertion['passed'] === false).length,
    gatlingDisagrees: sla.gatling_disagrees,
  };
}

function invariantsOf(summary: Execution['invariant_summary']): RunInvariants | null {
  if (summary === null) return null;
  const results = summary.results ?? [];
  return {
    state: summary.state,
    passed: results.filter((row) => row.status === 'evaluated' && row.passed).length,
    failed: results.filter((row) => row.status === 'evaluated' && !row.passed).length,
    noData: results.filter((row) => row.status === 'insufficient_data').length,
  };
}

function diagnosticsOf(ctx: CallContext, diagnostics: Diagnostics): RunDiagnostics {
  const lines = (diagnostics.logs ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(-OUTPUT_LINES)
    .map((line) => thirdParty(ctx, line, LIMITS.sentence));
  return {
    stage: diagnostics.stage,
    cause: diagnostics.cause === null ? null : thirdParty(ctx, diagnostics.cause, LIMITS.sentence),
    lines,
    logChars: diagnostics.log_bytes,
    logTruncated: diagnostics.log_truncated,
  };
}

export const runGet = moduleTool(RUN_GET, {
  title: 'Get one run',
  input: {
    run_id: runIdArgument(),
    include: z
      .array(z.enum(['diagnostics']))
      .max(1)
      .optional()
      .describe('"diagnostics": why the run stopped or failed, when LoadCraft knows.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const { id, run } = await runOf(ctx, projectId, args.run_id);
    const path = { project_id: projectId, execution_id: id };
    const execution = await getExecution(ctx, path);
    const diagnostics =
      args.include?.includes('diagnostics') === true
        ? diagnosticsOf(ctx, await getExecutionDiagnostics(ctx, path))
        : null;
    const manifest = execution.run_manifest;
    const total = execution.total_requests;
    const data: RunDetail = {
      run,
      run_id: id,
      status: execution.status,
      createdAt: execution.created_at,
      startedAt: execution.started_at,
      completedAt: execution.completed_at,
      durationS: execution.duration_seconds,
      loadWindow: execution.load_window_state,
      targetKind:
        execution.scenario_id !== null
          ? 'scenario'
          : execution.composite_id !== null
            ? 'composition'
            : null,
      targetId: execution.scenario_id ?? execution.composite_id,
      profileId: execution.configuration_id,
      totals:
        total === null
          ? null
          : { requests: total, ok: execution.ok_count ?? 0, ko: execution.ko_count ?? 0 },
      exitCode: execution.run_exit_code,
      sla: slaOf(ctx, execution.sla_verdict),
      invariants: invariantsOf(execution.invariant_summary),
      environment:
        manifest?.target_environment_name === null ||
        manifest?.target_environment_name === undefined
          ? null
          : thirdParty(ctx, manifest.target_environment_name, LIMITS.name),
      baseUrl:
        manifest?.target_base_url === null || manifest?.target_base_url === undefined
          ? null
          : thirdParty(ctx, manifest.target_base_url, LIMITS.sentence),
      workload: workloadOf(ctx, manifest?.workload),
      members:
        manifest?.members === null || manifest?.members === undefined
          ? null
          : manifest.members.length,
      errorMessage:
        execution.error_message === null
          ? null
          : thirdParty(ctx, execution.error_message, LIMITS.sentence),
      warnings: execution.warnings
        .slice(0, WARNINGS_SHOWN)
        .map((warning) => thirdParty(ctx, warning, LIMITS.sentence)),
      warningCount: execution.warnings.length,
      diagnostics,
    };
    return { status: 'done', data };
  },
  render: renderGet,
});
