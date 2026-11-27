// `scenario_restore_version` (module scenario): Restore a scenario version as the newest one; its
// self-check is cleared.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The scenario is read first (its name and its current version, which is the way back); the
// backend decides whether the version exists and has a snapshot. Restoring the version that already is
// the current one writes nothing. The checks that depend on the scenario are reset by the reducer
// (the table of the catalog), not here. The name is the application's own text and passes `content`.
// Log: args "{scenario_id} v{version}", result "{name}: v{version} restored; self-check cleared": the
// data carries `name` and `version`, the log values `scenario_id`; the arguments of the undo are the
// version that was current (`update.log.undo_args`).
// The scenario is named by its id or its name (the resolver), or is the only scenario of the workspace.
// Arguments: scenario_id, version.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderRestoreVersion,
  type RestoreVersionData,
} from '../../render/scenario/restoreVersion.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { createResolver } from '../../resolve/handles.js';
import { moduleTool } from '../moduleTool.js';
import { getScenario } from './get.js';
import { SCENARIO_RESTORE_VERSION } from './meta.generated.js';
import { scenarioIdOf } from './scenarioId.js';

/** POST /projects/{project_id}/gatling/scenarios/{scenario_id}/versions/{version}/restore (REST API v1) */
export function restoreScenarioVersion(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string; readonly version: number },
): Promise<
  OpOutput<'restore_scenario_version_api_v1_projects__project_id__gatling_scenarios__scenario_id__versions__version__restore_post'>
> {
  return callBackend(
    ctx,
    'restore_scenario_version_api_v1_projects__project_id__gatling_scenarios__scenario_id__versions__version__restore_post',
    { path },
  );
}

const NAME_LIMIT = 100;

export const scenarioRestoreVersion = moduleTool(SCENARIO_RESTORE_VERSION, {
  title: 'Restore a scenario version as the newest one',
  input: {
    scenario_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The scenario: its id or name; default: the only one in this workspace.'),
    version: z.number().int().min(1).max(100000).describe('The version to make current.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const found = await createResolver(ctx).scenario(
      projectId,
      scenarioIdOf(ctx, args.scenario_id),
    );
    const scenarioId = found.id;
    const before = await getScenario(ctx, { project_id: projectId, scenario_id: scenarioId });
    const name = content(ctx, before.name, NAME_LIMIT);
    const base = { project_id: projectId, scenario: { id: scenarioId }, version: args.version };
    const logValues = { scenario_id: scenarioId, version: args.version };
    if (before.current_version === args.version) {
      // the log template says `{name}: v{version} restored`: the name carries the truth for a
      // call that restored nothing (the data and the log say the same, so they never disagree)
      const data: RestoreVersionData = {
        ...base,
        name: `${name} ${ctx.t('scenario_restore_version.nothing_restored')}`,
        new: null,
        previous: before.current_version,
        changed: false,
      };
      return {
        status: 'done',
        data,
        inert: true,
        update: { log: { values: { ...logValues, name: data.name } } },
      };
    }
    const after = await restoreScenarioVersion(ctx, {
      project_id: projectId,
      scenario_id: scenarioId,
      version: args.version,
    });
    const data: RestoreVersionData = {
      ...base,
      name: content(ctx, after.name, NAME_LIMIT),
      new: after.current_version,
      previous: before.current_version,
      changed: true,
    };
    return {
      status: 'done',
      data,
      links: [ctx.services.links.scenario(projectId, scenarioId)],
      update: {
        log: {
          values: logValues,
          undo_args: { scenario_id: scenarioId, version: before.current_version },
        },
      },
    };
  },
  render: renderRestoreVersion,
});
