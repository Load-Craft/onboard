// `run_get_saved` (module run): Get saved runs with their schedules: the list, or one.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. A saved run is named by its id or its name (a name matches without regard to case) and is
// found in the list first. Names, cron expressions, errors and slot names are written by people and
// by the scheduler, so they pass the mask of a third party's text (`content`).
// Log: args "", result "{count} saved runs": the data of the result carries the fields.
// Arguments (the catalog's): `saved_run`, an id or a name; none lists them.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetSaved,
  type SlotState,
  type SavedData,
  type SavedDetail,
  type SavedRow,
} from '../../render/run/getSaved.js';
import {
  callBackend,
  projectIdOf,
  runHandle,
  thirdParty,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { pickNamed, workloadOf } from './common.js';
import { RUN_GET_SAVED } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/saved-runs (REST API v1) */
export function listSavedRuns(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'list_saved_runs_api_v1_projects__project_id__gatling_saved_runs_get'>> {
  return callBackend(ctx, 'list_saved_runs_api_v1_projects__project_id__gatling_saved_runs_get', {
    path,
  });
}

/** GET /projects/{project_id}/gatling/saved-runs/{saved_run_id} (REST API v1) */
export function getSavedRun(
  ctx: CallContext,
  path: { readonly project_id: string; readonly saved_run_id: string },
): Promise<
  OpOutput<'get_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__get'>
> {
  return callBackend(
    ctx,
    'get_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__get',
    { path },
  );
}

/** The saved runs the data lists, and the slots of one. */
const SAVED_SHOWN = 50;
const SLOTS_SHOWN = 20;
const TEXT_LIMIT = 200;
const CRON_LIMIT = 60;
const SLOT_LIMIT = 60;

type Saved =
  OpOutput<'list_saved_runs_api_v1_projects__project_id__gatling_saved_runs_get'>['saved_runs'][number];

function rowOf(ctx: CallContext, saved: Saved): SavedRow {
  const targetId = saved.scenario_id ?? saved.composite_id;
  return {
    id: saved.id,
    name: thirdParty(ctx, saved.name, TEXT_LIMIT),
    targetKind:
      saved.scenario_id !== null ? 'scenario' : saved.composite_id !== null ? 'composition' : null,
    targetId,
    environmentId: saved.environment_id,
    workload: workloadOf(ctx, saved.workload),
    schedule: {
      enabled: saved.schedule_enabled,
      cron:
        saved.cron_expression === null ? null : thirdParty(ctx, saved.cron_expression, CRON_LIMIT),
      paused: saved.paused,
      autoPaused: saved.auto_paused,
      nextRunAt: saved.next_run_at,
      lastRunAt: saved.last_run_at,
      consecutiveFailures: saved.consecutive_failures,
      lastError: saved.last_error === null ? null : thirdParty(ctx, saved.last_error, TEXT_LIMIT),
    },
  };
}

const SLOT_STATES: ReadonlySet<string> = new Set(['pinned', 'reconciled', 'stale']);

/** The state of a slot as the contract names it; a word it does not know is `unknown`. */
function slotStateOf(state: string): SlotState {
  return SLOT_STATES.has(state) ? (state as SlotState) : 'unknown';
}

function detailOf(ctx: CallContext, saved: Saved): SavedDetail {
  const slots = Object.entries(saved.feeder_binding_states);
  return {
    ...rowOf(ctx, saved),
    targetBaseUrl:
      saved.target_base_url === null ? null : thirdParty(ctx, saved.target_base_url, TEXT_LIMIT),
    sourceRun: saved.source_execution_id === null ? null : runHandle(saved.source_execution_id),
    slots: slots.slice(0, SLOTS_SHOWN).map(([slot, state]) => ({
      slot: thirdParty(ctx, slot, SLOT_LIMIT),
      state: slotStateOf(state),
    })),
    slotCount: slots.length,
    createdAt: saved.created_at,
    updatedAt: saved.updated_at,
  };
}

export const runGetSaved = moduleTool(RUN_GET_SAVED, {
  title: 'Get saved runs with their schedules',
  input: {
    saved_run: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe('One saved run (name or id); without it, the list.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const all = await listSavedRuns(ctx, path);
    if (args.saved_run === undefined) {
      const items = all.saved_runs.slice(0, SAVED_SHOWN).map((saved) => rowOf(ctx, saved));
      const data: SavedData = {
        project_id: projectId,
        count: all.saved_runs.length,
        shown: items.length,
        items,
        saved: null,
      };
      return { status: 'done', data };
    }
    const picked = pickNamed(ctx, 'saved_run', args.saved_run, all.saved_runs);
    const one = await getSavedRun(ctx, { ...path, saved_run_id: picked.id });
    const data: SavedData = {
      project_id: projectId,
      count: 1,
      shown: 0,
      items: [],
      saved: detailOf(ctx, one),
    };
    return { status: 'done', data };
  },
  render: renderGetSaved,
});
