// `project_get_activity` (module project): Get recent activity and the runs in progress across all
// projects (the caller's: the backend shows a token only the projects it may see).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Two reads in parallel: the latest events (at most `limit`) and the runs in progress. Names of
// projects, flows and scenarios are written by people: they pass `content()`. A load run is named by
// its handle; the verdict on its thresholds is read from the event's `status` field only, never from
// the verdict's own texts.
// Log: args "", result "{events} events, {running} runs in progress": the data carries both counts.
// Arguments (the catalog's): `limit`, how many events (1-50, default 20).

import * as z from 'zod';

import { settleAll, type OpOutput } from '../../http/operation.js';
import {
  renderGetActivity,
  type ActivityData,
  type ActivityEvent,
  type RunningRun,
} from '../../render/project/getActivity.js';
import { callBackend, content, type CallContext, type QueryOf } from '../moduleCall.js';
import { handleOf } from '../run/common.js';
import { moduleTool } from '../moduleTool.js';
import { PROJECT_GET_ACTIVITY } from './meta.generated.js';

/** GET /activity (REST API v1) */
export function getRecentActivity(
  ctx: CallContext,
  query?: QueryOf<'get_recent_activity_api_v1_activity_get'>,
): Promise<OpOutput<'get_recent_activity_api_v1_activity_get'>> {
  return callBackend(ctx, 'get_recent_activity_api_v1_activity_get', {
    ...(query === undefined ? {} : { query }),
  });
}

/** GET /gatling/executions/active (REST API v1) */
export function getActiveExecutions(
  ctx: CallContext,
  query?: QueryOf<'get_active_executions_api_v1_gatling_executions_active_get'>,
): Promise<OpOutput<'get_active_executions_api_v1_gatling_executions_active_get'>> {
  return callBackend(ctx, 'get_active_executions_api_v1_gatling_executions_active_get', {
    ...(query === undefined ? {} : { query }),
  });
}

const NAME_LIMIT = 120;
const RUNS_SHOWN = 20;

type Event = OpOutput<'get_recent_activity_api_v1_activity_get'>['events'][number];
type Active =
  OpOutput<'get_active_executions_api_v1_gatling_executions_active_get'>['executions'][number];

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'project_created',
  'scenario_created',
  'execution_started',
  'execution_completed',
  'execution_failed',
]);
const STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'building',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

const name = (ctx: CallContext, value: string | null | undefined): string | null =>
  value === null || value === undefined || value === '' ? null : content(ctx, value, NAME_LIMIT);

function slaOf(verdict: Event['sla_verdict']): ActivityEvent['sla'] {
  const status = verdict?.['status'];
  return status === 'passed' || status === 'failed' || status === 'refused' ? status : null;
}

function eventOf(ctx: CallContext, event: Event): ActivityEvent {
  const status = event.metadata?.['status'];
  const gatling = event.metadata?.['source'] === 'gatling';
  return {
    id: event.id,
    type: KNOWN_TYPES.has(event.type) ? event.type : 'other',
    at: event.timestamp,
    project: name(ctx, event.project_name),
    projectId: event.project_id ?? null,
    entity: name(ctx, event.entity_name),
    entityId: event.entity_id ?? null,
    run: gatling && event.entity_id != null ? handleOf(event.entity_id) : null,
    status: typeof status === 'string' && STATUSES.has(status) ? status : null,
    exitCode: event.run_exit_code ?? null,
    sla: slaOf(event.sla_verdict),
    hasErrors: event.result_has_errors ?? null,
  };
}

function runOf(ctx: CallContext, run: Active): RunningRun {
  return {
    run: handleOf(run.id),
    run_id: run.id,
    project: content(ctx, run.project_name, NAME_LIMIT),
    projectId: run.project_id,
    scenario: content(ctx, run.scenario_name, NAME_LIMIT),
    status: STATUSES.has(run.status) ? run.status : 'running',
    progress: run.progress,
    startedAt: run.started_at,
    estimatedCompletionAt: run.estimated_completion_at ?? null,
    rps: run.requests_per_second ?? null,
    errorRate: run.error_rate ?? null,
    supervised: run.supervised,
  };
}

export const projectGetActivity = moduleTool(PROJECT_GET_ACTIVITY, {
  title: 'Get recent activity and the runs in progress across all pro…',
  input: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe('How many recent events to return (1-50).'),
  },
  async run(ctx, args) {
    const [feed, active] = await settleAll([
      getRecentActivity(ctx, { limit: args.limit }),
      getActiveExecutions(ctx),
    ]);
    const items = feed.events.slice(0, args.limit).map((event) => eventOf(ctx, event));
    const runs = active.executions.slice(0, RUNS_SHOWN).map((run) => runOf(ctx, run));
    const data: ActivityData = {
      events: feed.events.length,
      running: active.executions.length,
      limit: args.limit,
      items,
      runs,
    };
    return { status: 'done', data };
  },
  render: renderGetActivity,
});
