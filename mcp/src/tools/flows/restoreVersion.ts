// `flows_restore_version` (module flows): Restore an older flow version as the newest one.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The flow is read first (its name and its current version, which is the way back); the backend
// decides whether the version exists. Restoring the version that already is the current one writes
// nothing. The flow's name is the application's own text and passes `content`.
// Log: args "{flow_id} v{version}", result "{name}: v{version} restored as v{new}; warnings: {warnings}":
// the data carries `name`, `version`, `new` and `warnings`, the log values `flow_id` and the count of warnings; the arguments of the undo are the version that
// was current (`update.log.undo_args`). State: the flow is built (`flows_built`).
// Arguments: flow_id (default: the only flow of the workspace), version, reason.

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { needsInputUpdate } from '../../flow/needsInput.js';
import { needsOfDetail } from '../../flow/questions.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderRestoreVersion,
  type RestoreVersionData,
} from '../../render/flows/restoreVersion.js';
import { createResolver } from '../../resolve/handles.js';
import { callBackend, content, type BodyOf, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { getFlow } from './get.js';
import { FLOWS_RESTORE_VERSION } from './meta.generated.js';

/** POST /projects/{project_id}/flows/{flow_id}/versions/restore (REST API v1) */
export function restoreFlowVersion(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string },
  body: BodyOf<'restore_flow_version_api_v1_projects__project_id__flows__flow_id__versions_restore_post'>,
): Promise<
  OpOutput<'restore_flow_version_api_v1_projects__project_id__flows__flow_id__versions_restore_post'>
> {
  return callBackend(
    ctx,
    'restore_flow_version_api_v1_projects__project_id__flows__flow_id__versions_restore_post',
    { path, body },
  );
}

const NAME_LIMIT = 100;
const ENDPOINTS_SHOWN = 10;

/** The flow the call means: the argument, else the only flow of the workspace, else `missing_argument`. */
function flowRefOf(ctx: ToolContext, given: string | undefined): string {
  if (given !== undefined) return given;
  const kept = ctx.state.process()?.ids.flow_ids ?? [];
  const [only] = kept;
  if (kept.length === 1 && only !== undefined) return only;
  throw new ToolError('missing_argument', { params: { name: 'flow_id' } });
}

export const flowsRestoreVersion = moduleTool(FLOWS_RESTORE_VERSION, {
  title: 'Restore an older flow version as the newest one',
  input: {
    flow_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The flow: its id or name; default: the only flow of this workspace.'),
    version: z
      .number()
      .int()
      .min(1)
      .max(100000)
      .describe('The version to bring back (flows_get_versions lists them).'),
    reason: z
      .string()
      .max(200)
      .optional()
      .describe('Why the version is restored (kept with the new version).'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const found = await createResolver(ctx).flow(projectId, flowRefOf(ctx, args.flow_id));
    const path = { project_id: projectId, flow_id: found.id };
    const before = await getFlow(ctx, path);
    const name = content(ctx, before.name, NAME_LIMIT);
    const base = { project_id: projectId, flow: { id: found.id }, version: args.version };
    const logValues = { flow_id: found.id, version: args.version };
    if (before.current_version === args.version) {
      // the log template says `{name}: v{version} restored as v{new}`: the name carries the truth for
      // a call that restored nothing (the data and the log say the same, so they never disagree)
      const data: RestoreVersionData = {
        ...base,
        name: `${name} ${ctx.t('flows_restore_version.nothing_restored')}`,
        new: null,
        previous: before.current_version,
        changed: false,
        warnings: [],
      };
      return {
        status: 'done',
        data,
        inert: true,
        // the log template names `{new}`: no version was made, so it keeps the current one
        update: {
          log: {
            values: {
              ...logValues,
              name: data.name,
              new: before.current_version,
              warnings: 0,
            },
          },
        },
      };
    }
    const after = await restoreFlowVersion(ctx, path, {
      version: args.version,
      ...(args.reason === undefined || args.reason === '' ? {} : { change_reason: args.reason }),
    });
    const data: RestoreVersionData = {
      ...base,
      name: content(ctx, after.name, NAME_LIMIT),
      new: after.current_version,
      previous: before.current_version,
      changed: true,
      warnings: (after.warnings ?? []).map((warning) => ({
        code: warning.code,
        endpoints: (warning.endpoints ?? [])
          .slice(0, ENDPOINTS_SHOWN)
          .map((endpoint) => content(ctx, endpoint, 150)),
      })),
    };
    const needs = needsInputUpdate(
      ctx.state.process(),
      [needsOfDetail(after)],
      'flows_restore_version',
      'some',
    );
    return {
      status: 'done',
      data,
      links: [ctx.services.links.flow(projectId, found.id)],
      update: {
        ...(needs ?? {}),
        checks: { flows: { flows_built: { ok: true } } },
        log: {
          values: { ...logValues, warnings: data.warnings.length },
          undo_args: { flow_id: found.id, version: before.current_version },
        },
      },
    };
  },
  render: renderRestoreVersion,
});
