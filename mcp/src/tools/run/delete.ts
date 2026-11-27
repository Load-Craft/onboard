// `run_delete` (module run): Delete a run, a load profile or a saved run (kind + item_id). Runs in
// progress are refused.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Consent: level 3, `delete` (docs/consent-card.md). The first call reads what goes and makes
// the card; a repeat with the same arguments asks the person; only their yes sends the DELETE.
// One object per card: `kind` says what `item_id` is, never a default from the state (a deletion
// names its target). A run that builds or runs is refused before any card (`delete_busy`; the
// backend refuses it too). The card names the object (a run is its handle), what it holds and what
// stays; no cell, no report text. No undo (permanent).
// Log: args "Delete {kind}: {names}", result "{count} {kind} deleted".
// Arguments (the catalog's): kind (run, profile, saved_run), item_id.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  cardViewRunDelete,
  renderRunDelete,
  type RunDeleteData,
  type RunDeleteFacts,
} from '../../render/run/delete.js';
import { busy, testName } from '../delete/checks.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  runHandle,
  thirdParty,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { getExecution } from './get.js';
import { getConfiguration } from './getProfiles.js';
import { getSavedRun } from './getSaved.js';
import { RUN_DELETE } from './meta.generated.js';

/** DELETE /projects/{project_id}/gatling/executions/{execution_id} (REST API v1) */
export function deleteExecution(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
): Promise<
  OpOutput<'delete_execution_api_v1_projects__project_id__gatling_executions__execution_id__delete'>
> {
  return callBackend(
    ctx,
    'delete_execution_api_v1_projects__project_id__gatling_executions__execution_id__delete',
    { path },
  );
}

/** DELETE /projects/{project_id}/gatling/configurations/{config_id} (REST API v1) */
export function deleteConfiguration(
  ctx: CallContext,
  path: { readonly project_id: string; readonly config_id: string },
): Promise<
  OpOutput<'delete_configuration_api_v1_projects__project_id__gatling_configurations__config_id__delete'>
> {
  return callBackend(
    ctx,
    'delete_configuration_api_v1_projects__project_id__gatling_configurations__config_id__delete',
    { path },
  );
}

/** DELETE /projects/{project_id}/gatling/saved-runs/{saved_run_id} (REST API v1) */
export function deleteSavedRun(
  ctx: CallContext,
  path: { readonly project_id: string; readonly saved_run_id: string },
): Promise<
  OpOutput<'delete_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__delete'>
> {
  return callBackend(
    ctx,
    'delete_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__delete',
    { path },
  );
}

/** The statuses of a run that is still being made: the backend refuses to delete it. */
const LIVE = new Set<string>(['pending', 'building', 'running']);

export const runDelete = moduleTool(RUN_DELETE, {
  title: 'Delete a run, a load profile or a saved run',
  input: {
    kind: z.enum(['run', 'profile', 'saved_run']).describe('What to delete.'),
    item_id: uuidArgument().describe('The run, load profile or saved run to delete.'),
  },
  async card(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const id = args.item_id.toLowerCase();
    if (args.kind === 'run') {
      const run = await getExecution(ctx, { project_id: projectId, execution_id: id });
      const handle = runHandle(id);
      if (LIVE.has(run.status)) {
        throw busy(
          testName({
            id,
            status: run.status,
            scenarioId: run.scenario_id,
            compositeId: run.composite_id,
          }),
          `run ${handle}`,
        );
      }
      const facts: RunDeleteFacts = {
        kind: 'run',
        names: handle,
        id,
        status: run.status,
        day: (run.started_at ?? run.created_at)?.slice(0, 10) ?? null,
        requests: run.total_requests,
      };
      return { facts };
    }
    if (args.kind === 'profile') {
      const profile = await getConfiguration(ctx, { project_id: projectId, config_id: id });
      const facts: RunDeleteFacts = {
        kind: 'profile',
        names: thirdParty(ctx, profile.name, LIMITS.name),
        id,
        users: profile.users,
        seconds: profile.duration_seconds,
        is_default: profile.is_default,
      };
      return { facts };
    }
    const saved = await getSavedRun(ctx, { project_id: projectId, saved_run_id: id });
    const facts: RunDeleteFacts = {
      kind: 'saved run',
      names: thirdParty(ctx, saved.name, LIMITS.name),
      id,
      cron:
        saved.cron_expression === null ? null : thirdParty(ctx, saved.cron_expression, LIMITS.word),
      scheduled: saved.schedule_enabled,
    };
    return { facts };
  },
  cardView: cardViewRunDelete,
  async run(ctx, args, facts) {
    const projectId = projectIdOf(ctx, undefined);
    if (facts.kind === 'run') {
      await deleteExecution(ctx, { project_id: projectId, execution_id: facts.id });
    } else if (facts.kind === 'profile') {
      await deleteConfiguration(ctx, { project_id: projectId, config_id: facts.id });
    } else {
      await deleteSavedRun(ctx, { project_id: projectId, saved_run_id: facts.id });
    }
    const data: RunDeleteData = { kind: facts.kind, id: facts.id, names: facts.names, count: 1 };
    const forget = facts.kind === 'run' && ctx.state.process()?.ids.run_id === facts.id;
    return {
      status: 'done',
      data,
      update: {
        ...(forget ? { unset: ['run_id' as const] } : {}),
        log: { values: { names: facts.names, kind: facts.kind, count: 1 } },
      },
    };
  },
  render: renderRunDelete,
});
