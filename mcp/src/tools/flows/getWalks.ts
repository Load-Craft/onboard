// `flows_get_walks` (module flows): Get description runs (browser walks): the list, or one with its
// paths and optional review timeline.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. A walk is a run of the LoadCraft browser that builds flows from a description: the
// description, the names of the paths, the labels and reasons of the steps, the failure texts and the
// notes come from the user, the application and the agent and pass the mask of a third party's text
// (`content`); the addresses of pages and the technical error are not read. The timeline is an
// auxiliary read: the backend serves it while the review session is open, to the creator of the walk.
// Log: args "{walk_id}", result "{count} walks": the data carries `count`.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { settleAll, type OpOutput } from '../../http/operation.js';
import {
  renderGetWalks,
  type SavedFlow,
  type Timeline,
  type WalkDetail,
  type WalkPath,
  type WalkRow,
  type WalksData,
} from '../../render/flows/getWalks.js';
import { callBackend, content, type CallContext, type QueryOf } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { FLOWS_GET_WALKS } from './meta.generated.js';
import { walkIdOf } from './shared.js';

/** GET /projects/{project_id}/scenario-from-description/runs (REST API v1) */
export function listScenarioRuns(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'list_scenario_runs_api_v1_projects__project_id__scenario_from_description_runs_get'>,
): Promise<
  OpOutput<'list_scenario_runs_api_v1_projects__project_id__scenario_from_description_runs_get'>
> {
  return callBackend(
    ctx,
    'list_scenario_runs_api_v1_projects__project_id__scenario_from_description_runs_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

/** GET /projects/{project_id}/scenario-from-description/runs/{run_id} (REST API v1) */
export function getScenarioRun(
  ctx: CallContext,
  path: { readonly project_id: string; readonly run_id: string },
): Promise<
  OpOutput<'get_scenario_run_api_v1_projects__project_id__scenario_from_description_runs__run_id__get'>
> {
  return callBackend(
    ctx,
    'get_scenario_run_api_v1_projects__project_id__scenario_from_description_runs__run_id__get',
    { path },
  );
}

/** GET /projects/{project_id}/scenario-from-description/runs/{run_id}/timeline (REST API v1) */
export function getRunTimeline(
  ctx: CallContext,
  path: { readonly project_id: string; readonly run_id: string },
): Promise<
  OpOutput<'get_run_timeline_api_v1_projects__project_id__scenario_from_description_runs__run_id__timeline_get'>
> {
  return callBackend(
    ctx,
    'get_run_timeline_api_v1_projects__project_id__scenario_from_description_runs__run_id__timeline_get',
    { path },
  );
}

const EXCERPT_LIMIT = 200;
const TEXT_LIMIT = 300;
const PATHS_SHOWN = 30;
const PLANS_SHOWN = 30;
const PLAN_STEPS_SHOWN = 12;
const STEPS_SHOWN = 150;
const NOTES_SHOWN = 50;

type Run =
  OpOutput<'get_scenario_run_api_v1_projects__project_id__scenario_from_description_runs__run_id__get'>;
type Summary = NonNullable<
  OpOutput<'list_scenario_runs_api_v1_projects__project_id__scenario_from_description_runs_get'>['runs']
>[number];
type TimelineAnswer =
  OpOutput<'get_run_timeline_api_v1_projects__project_id__scenario_from_description_runs__run_id__timeline_get'>;

const maybe = (
  ctx: CallContext,
  text: string | null | undefined,
  max = TEXT_LIMIT,
): string | null =>
  text === null || text === undefined || text === '' ? null : content(ctx, text, max);

function rowOf(
  ctx: CallContext,
  walk: Pick<Summary, 'run_id' | 'status' | 'current_step' | 'awaiting_split_approval'> & {
    readonly created_at: string | null;
    readonly description: string;
  },
  selectedId: string | undefined,
): WalkRow {
  return {
    id: walk.run_id,
    handle: `r-${walk.run_id.slice(0, 8).toLowerCase()}`,
    status: content(ctx, walk.status, 40),
    created_at: walk.created_at === null ? null : content(ctx, walk.created_at, 40),
    current_step: maybe(ctx, walk.current_step, 60),
    awaiting_split_approval: walk.awaiting_split_approval,
    description: content(ctx, walk.description, EXCERPT_LIMIT),
    selected: walk.run_id === selectedId,
  };
}

function detailOf(ctx: CallContext, run: Run, selectedId: string | undefined): WalkDetail {
  const paths: WalkPath[] = (run.paths ?? []).slice(0, PATHS_SHOWN).map((path) => ({
    path_index: path.path_index,
    name: content(ctx, path.name, 100),
    status: path.status,
    steps: path.step_count,
    attempts: path.attempts ?? [],
    partial: path.partial,
    failure_reason: maybe(ctx, path.failure_reason, 200),
    stop_cause: maybe(ctx, path.stop_cause, 60),
    flow_id: path.flow_id ?? null,
  }));
  const saved: SavedFlow[] = (run.flows_saved ?? []).slice(0, PATHS_SHOWN).map((flow) => ({
    name: content(ctx, flow.name, 100),
    flow_id: flow.flow_id ?? null,
    version: flow.version ?? null,
    note: maybe(ctx, flow.note, 200),
  }));
  return {
    ...rowOf(
      ctx,
      {
        run_id: run.run_id,
        status: run.status,
        created_at: run.created_at ?? null,
        current_step: run.current_step ?? null,
        awaiting_split_approval: run.awaiting_split_approval,
        description: run.description ?? '',
      },
      selectedId,
    ),
    title: content(ctx, run.title, 100),
    error: maybe(ctx, run.error_message, 200),
    all_paths_failed: run.all_paths_failed,
    paths,
    flows_saved: saved,
  };
}

function timelineOf(ctx: CallContext, answer: TimelineAnswer): Timeline {
  const plans: Timeline['plans'][number][] = [];
  const steps: Timeline['steps'][number][] = [];
  const others: Record<string, number> = {};
  for (const event of answer.events ?? []) {
    if (event.type === 'agent_plan' && event.plan !== undefined) {
      plans.push({
        path_index: event.plan.path_index,
        attempt: event.plan.attempt,
        steps: (event.plan.steps ?? [])
          .slice(0, PLAN_STEPS_SHOWN)
          .map((step) => content(ctx, step, 120)),
      });
    } else if (event.type === 'agent_step' && event.step !== undefined) {
      const step = event.step;
      steps.push({
        path_index: step.path_index,
        attempt: step.attempt ?? null,
        step: step.step_number ?? null,
        label: content(ctx, step.label, 120),
        outcome: step.outcome,
        source: step.source,
        failure_code: step.failure_code ?? null,
        reason: maybe(ctx, step.reason, 160),
        still_id: step.still_id ?? null,
      });
    } else {
      others[event.type] = (others[event.type] ?? 0) + 1;
    }
  }
  return {
    review_expires_at: maybe(ctx, answer.review_expires_at, 40),
    plans: plans.slice(0, PLANS_SHOWN),
    steps: steps.slice(0, STEPS_SHOWN),
    notes: (answer.notes ?? []).slice(0, NOTES_SHOWN).map((note) => ({
      id: note.id ?? null,
      step: note.step_number,
      text: content(ctx, note.text, TEXT_LIMIT),
      kind: note.kind,
      path_index: note.path_index,
      attempt: note.attempt,
    })),
    other_events: others,
  };
}

/** The timeline is an auxiliary read: an error of the API leaves the walk and says it is unavailable. */
async function readTimeline(
  ctx: CallContext,
  path: { readonly project_id: string; readonly run_id: string },
): Promise<TimelineAnswer | null> {
  try {
    return await getRunTimeline(ctx, path);
  } catch (error) {
    if (error instanceof LoadcraftApiError) return null;
    throw error;
  }
}

export const flowsGetWalks = moduleTool(FLOWS_GET_WALKS, {
  title: 'Get description runs',
  input: {
    walk_id: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('One walk: its handle or id; without it, the list of your walks.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe('How many walks of the list to return (1-50).'),
    include: z
      .array(z.enum(['timeline']))
      .max(1)
      .optional()
      .describe('"timeline": the review timeline of the walk (with walk_id only).'),
  },
  async run(ctx, args) {
    if (args.walk_id === undefined && args.include !== undefined) {
      throw new ToolError('invalid', {
        params: { detail: 'include applies to one walk: pass walk_id with it' },
      });
    }
    const projectId = projectIdOf(ctx, undefined);
    const stateWalk = ctx.state.process()?.ids.walk_id;
    const selectedId = typeof stateWalk === 'string' ? stateWalk : undefined;
    const logValues = { walk_id: args.walk_id ?? '' };
    const base = { project_id: projectId, timeline_state: 'none', timeline: null } as const;

    if (args.walk_id === undefined) {
      const list = await listScenarioRuns(
        ctx,
        { project_id: projectId },
        { status: 'all', limit: args.limit },
      );
      const runs = list.runs ?? [];
      const rows = runs
        .slice(0, args.limit)
        .map((run) => rowOf(ctx, { ...run, description: run.description_excerpt }, selectedId));
      const data: WalksData = {
        ...base,
        mode: 'list',
        count: runs.length,
        shown: rows.length,
        walks: rows,
        walk: null,
      };
      return { status: 'done', data, update: { log: { values: logValues } } };
    }

    const runId = walkIdOf(ctx, args.walk_id);
    const path = { project_id: projectId, run_id: runId };
    const wantsTimeline = args.include?.includes('timeline') === true;
    const [run, answer] = await settleAll([
      getScenarioRun(ctx, path),
      wantsTimeline ? readTimeline(ctx, path) : Promise.resolve(null),
    ]);
    const data: WalksData = {
      project_id: projectId,
      mode: 'walk',
      count: 1,
      shown: 1,
      walks: [],
      walk: detailOf(ctx, run, selectedId),
      timeline_state: !wantsTimeline ? 'none' : answer === null ? 'unavailable' : 'read',
      timeline: answer === null ? null : timelineOf(ctx, answer),
    };
    return { status: 'done', data, update: { log: { values: logValues } } };
  },
  render: renderGetWalks,
});
