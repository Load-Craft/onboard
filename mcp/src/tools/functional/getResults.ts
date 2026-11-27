// `functional_get_results` (module functional): Get the results of a functional run: summary with
// flow results, one flow result, or the captured HTTP log (secrets masked).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The run is named by its UUID (required: the state keeps no functional run). The summary and
// the flows are one read each; one result is read from the flow results of the run. Everything the
// target or a person wrote passes `content`; the bodies of the HTTP log pass `body` (masked, or
// hidden whole when the mask cannot read the format), their text is cut, and header values are never
// read, only the names. `view: "one"` without `result_id` is refused locally.
// Log: args "{run_id}", result "{passed} passed, {failed} failed": the data carries both counts
// (flows of the run, validations of one result, requests of the log that returned below 400).
// Arguments (the catalog's): `run_id`, `view`, `result_id`, `log_type`, `limit`.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import { inline } from '../../render/primitives.js';
import {
  renderGetResults,
  type BlockRow,
  type FailedValidation,
  type FlowResultDetail,
  type FlowResultRow,
  type LogBody,
  type LogLine,
  type ResultsData,
  type RunFigures,
} from '../../render/functional/getResults.js';
import { body, callBackend, type CallContext, type QueryOf } from '../moduleCall.js';
import {
  LIMITS,
  projectIdOf,
  refuseRule,
  thirdParty,
  thirdPartyOrNull,
} from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { FUNCTIONAL_GET_RESULTS } from './meta.generated.js';

/** GET /projects/{project_id}/executions/{execution_id}/with-results (REST API v1) */
export function getExecutionWithResults(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
): Promise<
  OpOutput<'get_execution_with_results_api_v1_projects__project_id__executions__execution_id__with_results_get'>
> {
  return callBackend(
    ctx,
    'get_execution_with_results_api_v1_projects__project_id__executions__execution_id__with_results_get',
    { path },
  );
}

/** GET /projects/{project_id}/executions/{execution_id}/results (REST API v1) */
export function listFlowResults(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
): Promise<
  OpOutput<'list_flow_results_api_v1_projects__project_id__executions__execution_id__results_get'>
> {
  return callBackend(
    ctx,
    'list_flow_results_api_v1_projects__project_id__executions__execution_id__results_get',
    { path },
  );
}

/** GET /projects/{project_id}/executions/{execution_id}/results/{result_id} (REST API v1) */
export function getFlowResult(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string; readonly result_id: string },
): Promise<
  OpOutput<'get_flow_result_api_v1_projects__project_id__executions__execution_id__results__result_id__get'>
> {
  return callBackend(
    ctx,
    'get_flow_result_api_v1_projects__project_id__executions__execution_id__results__result_id__get',
    { path },
  );
}

/** GET /projects/{project_id}/executions/{execution_id}/api-logs (REST API v1) */
export function getApiLogs(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
  query?: QueryOf<'get_execution_api_logs_api_v1_projects__project_id__executions__execution_id__api_logs_get'>,
): Promise<
  OpOutput<'get_execution_api_logs_api_v1_projects__project_id__executions__execution_id__api_logs_get'>
> {
  return callBackend(
    ctx,
    'get_execution_api_logs_api_v1_projects__project_id__executions__execution_id__api_logs_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

const VALUE_LIMIT = 120;
const BODY_LIMIT = 400;
const FAILED_SHOWN = 20;
const BLOCKS_SHOWN = 40;

type FlowResult =
  OpOutput<'get_flow_result_api_v1_projects__project_id__executions__execution_id__results__result_id__get'>;
type FlowSummary =
  OpOutput<'get_execution_with_results_api_v1_projects__project_id__executions__execution_id__with_results_get'>['flow_results'][number];
type LogEntry =
  OpOutput<'get_execution_api_logs_api_v1_projects__project_id__executions__execution_id__api_logs_get'>['logs'][number];

/** A plain value as one masked text; a list or an object is shown as its JSON, masked and cut. */
function value(ctx: CallContext, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return thirdParty(ctx, raw, LIMITS.name);
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  const shown = body(ctx, JSON.stringify(raw), 'application/json');
  return shown.kind === 'shown' ? inline(shown.text, VALUE_LIMIT) : null;
}

function rowOf(ctx: CallContext, result: FlowSummary | FlowResult): FlowResultRow {
  return {
    id: result.id,
    flowId: result.flow_id,
    flowVersion: result.flow_version,
    testType: thirdParty(ctx, result.test_type_name, LIMITS.name),
    status: thirdParty(ctx, result.status, LIMITS.name),
    durationMs: result.duration_ms,
    validations: {
      total: result.total_validations,
      passed: result.passed_validations,
      failed: result.failed_validations,
    },
    errorMessage: thirdPartyOrNull(ctx, result.error_message, LIMITS.sentence),
  };
}

function detailOf(ctx: CallContext, result: FlowResult): FlowResultDetail {
  const failed = result.validation_results.filter((item) => !item.passed);
  const failedValidations: FailedValidation[] = failed.slice(0, FAILED_SHOWN).map((item) => ({
    validator: thirdParty(ctx, item.validator_name, LIMITS.name),
    type: thirdPartyOrNull(ctx, item.validator_type, LIMITS.name),
    message: thirdPartyOrNull(ctx, item.message, LIMITS.sentence),
    expected: value(ctx, item.expected),
    actual: value(ctx, item.actual),
    reasoning: thirdPartyOrNull(ctx, item.ai_reasoning, LIMITS.sentence),
  }));
  const blocks: BlockRow[] = result.block_results.slice(0, BLOCKS_SHOWN).map((block) => ({
    name: thirdParty(ctx, block.block_name, LIMITS.name),
    type: thirdParty(ctx, block.block_type, LIMITS.name),
    status: thirdParty(ctx, block.status, LIMITS.name),
    method: thirdPartyOrNull(ctx, block.request_method, LIMITS.name),
    url: thirdPartyOrNull(ctx, block.request_url, LIMITS.sentence),
    httpStatus: block.response_status_code ?? null,
    durationMs: block.duration_ms,
    errorMessage: thirdPartyOrNull(ctx, block.error_message, LIMITS.sentence),
    assertionMessage: thirdPartyOrNull(
      ctx,
      block.assertion_message ?? block.validator_message,
      LIMITS.sentence,
    ),
  }));
  return {
    ...rowOf(ctx, result),
    startedAt: result.started_at,
    failedValidations,
    failedValidationCount: failed.length,
    blocks,
    blockCount: result.block_results.length,
  };
}

function logBody(
  ctx: CallContext,
  raw: Readonly<Record<string, unknown>> | null | undefined,
  side: 'request' | 'response',
): LogBody | null {
  if (raw === null || raw === undefined) return null;
  const shown = body(ctx, JSON.stringify(raw), 'application/json', side);
  return shown.kind === 'shown'
    ? { kind: 'shown', text: inline(shown.text, BODY_LIMIT) }
    : { kind: 'hidden', type: shown.type, bytes: shown.bytes };
}

function lineOf(ctx: CallContext, entry: LogEntry): LogLine {
  return {
    seq: entry.sequence_number,
    logType: thirdParty(ctx, entry.log_type, LIMITS.name),
    level: thirdPartyOrNull(ctx, entry.level, LIMITS.name),
    method: thirdPartyOrNull(ctx, entry.method, LIMITS.name),
    url: thirdPartyOrNull(ctx, entry.url, LIMITS.sentence),
    statusCode: entry.status_code ?? null,
    durationMs: entry.duration_ms ?? null,
    block: thirdPartyOrNull(ctx, entry.block_name, LIMITS.name),
    message: thirdPartyOrNull(ctx, entry.message, LIMITS.sentence),
    headerNames: [
      ...Object.keys(entry.request_headers ?? {}),
      ...Object.keys(entry.response_headers ?? {}),
    ]
      .slice(0, 20)
      .map((name) => thirdParty(ctx, name, LIMITS.name)),
    requestBody: logBody(ctx, entry.request_body, 'request'),
    responseBody: logBody(ctx, entry.response_body, 'response'),
  };
}

export const functionalGetResults = moduleTool(FUNCTIONAL_GET_RESULTS, {
  title: 'Get the results of a functional run',
  input: {
    run_id: uuidArgument().describe('The functional run.'),
    view: z
      .enum(['summary', 'flows', 'one', 'http_log'])
      .default('summary')
      .describe('summary (default), per flow, one result, or the HTTP log.'),
    result_id: uuidArgument().optional().describe('With view one: the result.'),
    log_type: z
      .enum(['request', 'response', 'log'])
      .optional()
      .describe('With view http_log: which part.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe('How many entries to return (1-200).'),
  },
  async run(ctx, args) {
    if (args.view === 'one' && args.result_id === undefined) {
      refuseRule('results_one_without_result');
    }
    const projectId = projectIdOf(ctx, undefined);
    const runId = args.run_id.toLowerCase();
    const path = { project_id: projectId, execution_id: runId };
    const base = {
      run_id: runId,
      view: args.view,
      passed: 0,
      failed: 0,
      count: 0,
      shown: 0,
      run: null,
      flows: [],
      result: null,
      log: [],
    } satisfies ResultsData;
    if (args.view === 'http_log') {
      const answer = await getApiLogs(ctx, path, {
        ...(args.log_type === undefined ? {} : { log_type: args.log_type }),
      });
      const log = answer.logs.slice(0, args.limit).map((entry) => lineOf(ctx, entry));
      const failedRequests = answer.logs.filter((entry) => (entry.status_code ?? 0) >= 400).length;
      const withStatus = answer.logs.filter((entry) => entry.status_code != null).length;
      const data: ResultsData = {
        ...base,
        passed: withStatus - failedRequests,
        failed: failedRequests,
        count: answer.total,
        shown: log.length,
        log,
      };
      return { status: 'done', data };
    }
    if (args.view === 'one' && args.result_id !== undefined) {
      const result = await getFlowResult(ctx, { ...path, result_id: args.result_id.toLowerCase() });
      const detail = detailOf(ctx, result);
      const data: ResultsData = {
        ...base,
        passed: detail.validations.passed,
        failed: detail.validations.failed,
        count: 1,
        result: detail,
      };
      return { status: 'done', data };
    }
    if (args.view === 'flows') {
      const list = await listFlowResults(ctx, path);
      const rows = list.results.slice(0, args.limit).map((flow) => rowOf(ctx, flow));
      const data: ResultsData = {
        ...base,
        passed: list.results.filter((flow) => flow.failed_validations === 0).length,
        failed: list.results.filter((flow) => flow.failed_validations > 0).length,
        count: list.total,
        shown: rows.length,
        flows: rows,
      };
      return { status: 'done', data };
    }
    const answer = await getExecutionWithResults(ctx, path);
    const flows = answer.flow_results.slice(0, args.limit).map((flow) => rowOf(ctx, flow));
    const run: RunFigures = {
      id: answer.id,
      status: thirdParty(ctx, answer.status, LIMITS.name),
      durationMs: answer.duration_ms,
      flows: {
        total: answer.total_flows,
        passed: answer.passed_flows,
        failed: answer.failed_flows,
      },
      validations: {
        total: answer.total_validations,
        passed: answer.passed_validations,
        failed: answer.failed_validations,
      },
      errorMessage: thirdPartyOrNull(ctx, answer.error_message, LIMITS.sentence),
    };
    const data: ResultsData = {
      ...base,
      passed: answer.passed_flows,
      failed: answer.failed_flows,
      count: answer.flow_results.length,
      shown: flows.length,
      run,
      flows,
    };
    return { status: 'done', data };
  },
  render: renderGetResults,
});
