// `results_get_logs` (module results): Get Gatling log lines of a run (masked, truncated).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. A log line is whatever the load generator printed (a header with a token, a body with a
// password), so every line passes the mask of a third party's text (`content`) before the view, and
// the labels of the log streams are never read into the data. `level` is one of four fixed words,
// sent in lower case.
// Log: args "{run_id}", result "{lines} lines": the log values carry the fields.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetLogs,
  type LogLine,
  type LogsData,
  type LogsSeriesSource,
  type LogsStoreSource,
} from '../../render/results/getLogs.js';
import {
  LIMITS,
  callBackend,
  projectIdOf,
  runOf,
  thirdParty,
  type CallContext,
  type QueryOf,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { RESULTS_GET_LOGS } from './meta.generated.js';
import { RunRef } from './run.js';

const RETENTION_LIMIT = 20;
const NANOS_PER_MS = 1_000_000n;

const LEVELS = ['error', 'warn', 'info', 'debug'] as const;

const SERIES_SOURCES: ReadonlySet<string> = new Set([
  'prometheus',
  'absent_retention',
  'absent_unmeasured',
  'metrics_backend_unreachable',
]);

type LogsOp =
  'get_execution_logs_api_v1_projects__project_id__gatling_executions__execution_id__logs_get';

/** GET /projects/{project_id}/gatling/executions/{execution_id}/logs (REST API v1) */
export function getExecutionLogs(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
  query?: QueryOf<LogsOp>,
): Promise<OpOutput<LogsOp>> {
  return callBackend(
    ctx,
    'get_execution_logs_api_v1_projects__project_id__gatling_executions__execution_id__logs_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

/**
 * The instant of a timestamp in Unix nanoseconds, as ISO 8601; null for one that is no whole
 * number of nanoseconds or no date (`1e18`, `-1`, a number past the year 275760).
 */
export function instantOf(timestamp: string): string | null {
  if (!/^\d{1,30}$/u.test(timestamp)) return null;
  const date = new Date(Number(BigInt(timestamp) / NANOS_PER_MS));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function seriesSourceOf(value: string): LogsSeriesSource {
  return SERIES_SOURCES.has(value) ? (value as LogsSeriesSource) : 'other';
}

const LOGS_SOURCES: ReadonlySet<string> = new Set([
  'loki',
  'partial_retention',
  'absent_retention',
]);

function logsSourceOf(value: string): LogsStoreSource {
  return LOGS_SOURCES.has(value) ? (value as LogsStoreSource) : 'other';
}

export const resultsGetLogs = moduleTool(RESULTS_GET_LOGS, {
  title: 'Get the log lines of a run',
  input: {
    run_id: RunRef.optional().describe(
      'The run, as a handle (e-xxxxxxxx) or UUID; default: the run of this workspace.',
    ),
    level: z
      .enum(LEVELS)
      .optional()
      .describe('Only lines of this level: error, warn, info or debug.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe('How many lines to return (1-200).'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const { id, run } = await runOf(ctx, projectId, args.run_id);
    const level = args.level ?? null;
    const answer = await getExecutionLogs(
      ctx,
      { project_id: projectId, execution_id: id },
      { limit: args.limit, ...(level === null ? {} : { level }) },
    );
    const lines: LogLine[] = answer.logs.slice(0, args.limit).map((entry) => ({
      at: instantOf(entry.timestamp),
      text: thirdParty(ctx, entry.message, LIMITS.sentence),
    }));
    const data: LogsData = {
      run,
      run_id: id,
      level,
      limit: args.limit,
      lines,
      count: lines.length,
      seriesSource: seriesSourceOf(answer.series_source),
      retention:
        answer.series_retention === null
          ? null
          : thirdParty(ctx, answer.series_retention, RETENTION_LIMIT),
      logsSource: logsSourceOf(answer.logs_source),
      logsRetention:
        answer.logs_retention === null
          ? null
          : thirdParty(ctx, answer.logs_retention, RETENTION_LIMIT),
      runWindow: answer.logs_window_start !== null && answer.logs_window_end !== null,
    };
    return {
      status: 'done',
      data,
      update: { log: { values: { run_id: run, lines: lines.length } } },
    };
  },
  render: renderGetLogs,
});
