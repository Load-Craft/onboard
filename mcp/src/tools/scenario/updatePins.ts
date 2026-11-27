// `scenario_update_pins` (module scenario): Update every drifted member of a composition to its
// scenario's current version.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The composition is read first (which members have drifted, and the versions they are pinned
// to), then each drifted member is moved by its own write, one after another; nothing is written when
// none has drifted. A write that fails leaves the members moved before it moved and ends the call (a
// repeat continues). The checks that depend on the composition are reset by the reducer (the table of
// the catalog), not here. The way back is saving the composition with the previous pins
// (`scenario_save_composition`, a level 2 tool the entry only names with `undo_tool`). The names are
// the application's own text and pass `content`.
// Log: args "{composition_id}", result "{count} members moved to current versions": the data carries
// `count`, the log values `composition_id`.
// Arguments: composition_id (id or name; default: the one of the workspace).

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderUpdatePins,
  type PinMove,
  type UpdatePinsData,
} from '../../render/scenario/updatePins.js';
import { createResolver } from '../../resolve/handles.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { SCENARIO_UPDATE_PINS } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/compositions/{composition_id} (REST API v1) */
export function getComposition(
  ctx: CallContext,
  path: { readonly project_id: string; readonly composition_id: string },
): Promise<
  OpOutput<'get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get'>
> {
  return callBackend(
    ctx,
    'get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get',
    { path },
  );
}

/** PUT /projects/{project_id}/gatling/compositions/{composition_id}/links/{link_id}/pin (REST API v1) */
export function repinCompositionLink(
  ctx: CallContext,
  path: { readonly project_id: string; readonly composition_id: string; readonly link_id: string },
): Promise<
  OpOutput<'repin_composition_link_api_v1_projects__project_id__gatling_compositions__composition_id__links__link_id__pin_put'>
> {
  return callBackend(
    ctx,
    'repin_composition_link_api_v1_projects__project_id__gatling_compositions__composition_id__links__link_id__pin_put',
    { path },
  );
}

const NAME_LIMIT = 100;
const MEMBERS_SHOWN = 50;

/** The composition the call means: the argument, else the one of the workspace, else `missing_argument`. */
function compositionRefOf(ctx: ToolContext, given: string | undefined): string {
  const kept = given ?? ctx.state.process()?.ids.composition_id;
  if (kept === undefined) {
    throw new ToolError('missing_argument', { params: { name: 'composition_id' } });
  }
  return kept;
}

export const scenarioUpdatePins = moduleTool(SCENARIO_UPDATE_PINS, {
  title: 'Update every drifted member of a composition to its scenario’s current version',
  input: {
    composition_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The composition: its id or name; default: the one of this workspace.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const found = await createResolver(ctx).composition(
      projectId,
      compositionRefOf(ctx, args.composition_id),
    );
    const path = { project_id: projectId, composition_id: found.id };
    const before = await getComposition(ctx, path);
    const drifted = before.scenarios.filter((member) => member.has_drift);
    const name = content(ctx, before.name, NAME_LIMIT);
    const logValues = { composition_id: found.id };
    // why nothing drifted, told plainly: a member pinned to no version follows its scenario by itself, and
    // drift is decided by the content, so an older number over the same content is no drift either
    const quiet = before.scenarios.filter((member) => !member.has_drift);
    const unpinned = quiet.filter((member) => member.pinned_version === null).length;
    const sameContent = quiet.filter(
      (member) =>
        member.pinned_version !== null &&
        member.current_version !== null &&
        member.pinned_version < member.current_version,
    ).length;
    if (drifted.length === 0) {
      const data: UpdatePinsData = {
        project_id: projectId,
        composition: { id: found.id },
        name,
        count: 0,
        members: [],
        still_drifted: 0,
        unpinned,
        same_content: sameContent,
      };
      return { status: 'done', data, inert: true, update: { log: { values: logValues } } };
    }
    let after = before;
    for (const member of drifted) {
      after = await repinCompositionLink(ctx, { ...path, link_id: member.link_id });
    }
    const moves: PinMove[] = drifted.map((member) => {
      const now = after.scenarios.find((item) => item.link_id === member.link_id);
      return {
        link_id: member.link_id,
        scenario_id: member.scenario_id,
        scenario: content(ctx, member.scenario_name ?? member.scenario_id, NAME_LIMIT),
        from: member.pinned_version,
        to: now?.pinned_version ?? null,
      };
    });
    const data: UpdatePinsData = {
      project_id: projectId,
      composition: { id: found.id },
      name,
      count: moves.length,
      members: moves.slice(0, MEMBERS_SHOWN),
      still_drifted: after.scenarios.filter((member) => member.has_drift).length,
      unpinned,
      same_content: sameContent,
    };
    return {
      status: 'done',
      data,
      update: {
        log: {
          values: logValues,
          undo_args: {
            undo_tool: 'scenario_save_composition',
            composition_id: found.id,
            members: drifted.map((member) => ({
              link_id: member.link_id,
              scenario_id: member.scenario_id,
              version: member.pinned_version,
            })),
          },
        },
      },
    };
  },
  render: renderUpdatePins,
});
