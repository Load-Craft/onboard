// `flows_export_walk_image` (module flows): Export a walk image to a local file and return its path: a
// live snapshot of a path attempt, or a timeline still.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the read and the view. The
// image is read as bytes and saved under `loadcraft/walks/<handle>/` of the workspace (walkImageFiles.ts):
// an image saved earlier under the same name is replaced only with `overwrite: true`, and that is checked
// before the backend is asked. The name is built from numbers and an id checked against a pattern; the
// bytes are the user's screenshot and never reach the model, only the relative path and the size.
// Exactly one of `path_index` (a live snapshot, with `attempt`) and `still_id` (a still of the timeline).
// Log: args "{walk_id} {path_index}", result "{path}": the log values carry the walk handle and the step
// (or `still:<id>`), the data the path.
// Arguments: walk_id (default: the walk of the workspace), path_index, attempt, still_id, overwrite.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import { renderWalkImage, type WalkImageData } from '../../render/flows/exportWalkImage.js';
import { callBackend, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { FLOWS_EXPORT_WALK_IMAGE } from './meta.generated.js';
import { walkIdOf, walkRefOf } from './shared.js';
import { checkImageTarget, IMAGE_EXTENSIONS, saveImage } from './walkImageFiles.js';

/** GET /projects/{project_id}/scenario-from-description/runs/{run_id}/paths/{path_index}/attempts/{attempt}/snapshot (REST API v1) */
export function takeRunSnapshot(
  ctx: CallContext,
  path: {
    readonly project_id: string;
    readonly run_id: string;
    readonly path_index: number;
    readonly attempt: number;
  },
): Promise<
  OpOutput<'take_run_snapshot_api_v1_projects__project_id__scenario_from_description_runs__run_id__paths__path_index__attempts__attempt__snapshot_get'>
> {
  return callBackend(
    ctx,
    'take_run_snapshot_api_v1_projects__project_id__scenario_from_description_runs__run_id__paths__path_index__attempts__attempt__snapshot_get',
    { path },
  );
}

/** GET /projects/{project_id}/scenario-from-description/runs/{run_id}/stills/{still_id} (REST API v1) */
export function getRunStill(
  ctx: CallContext,
  path: { readonly project_id: string; readonly run_id: string; readonly still_id: string },
): Promise<
  OpOutput<'get_run_still_api_v1_projects__project_id__scenario_from_description_runs__run_id__stills__still_id__get'>
> {
  return callBackend(
    ctx,
    'get_run_still_api_v1_projects__project_id__scenario_from_description_runs__run_id__stills__still_id__get',
    { path },
  );
}

const STILL_ID = /^[A-Za-z0-9_-]{1,100}$/u;

const invalid = (detail: string): ToolError => new ToolError('invalid', { params: { detail } });

export const flowsExportWalkImage = moduleTool(FLOWS_EXPORT_WALK_IMAGE, {
  title: 'Export a walk image to a local file',
  input: {
    walk_id: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('The walk: its handle or id; default: the walk of this workspace.'),
    path_index: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .optional()
      .describe('The step of the walk to capture live (not with still_id).'),
    attempt: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(1)
      .describe('The attempt of that step (with path_index).'),
    still_id: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('A still of the review timeline (not with path_index).'),
    overwrite: z
      .boolean()
      .default(false)
      .describe('true: replace an image saved earlier under the same name.'),
  },
  async run(ctx, args) {
    const live = args.path_index !== undefined;
    if (live === (args.still_id !== undefined)) {
      throw invalid(
        'name exactly one of path_index (a live snapshot) and still_id (a still of the timeline)',
      );
    }
    if (args.still_id !== undefined) {
      if (args.attempt !== 1) throw invalid('attempt goes with path_index, not with still_id');
      if (!STILL_ID.test(args.still_id)) {
        throw invalid(
          'still_id is the id of a still of the timeline: letters, digits, _ and - only',
        );
      }
    }
    const projectId = projectIdOf(ctx, undefined);
    const walkId = walkIdOf(ctx, walkRefOf(ctx, args.walk_id));
    const handle = `r-${walkId.slice(0, 8)}`;
    const name = live
      ? `path-${String(args.path_index)}-attempt-${String(args.attempt)}`
      : `still-${args.still_id ?? ''}`;
    const root = ctx.config.stateRoot;
    // the folder first, then the backend: an image saved before is refused without a request
    checkImageTarget(root, handle, name, args.overwrite);
    const path = { project_id: projectId, run_id: walkId };
    const blob =
      args.path_index !== undefined
        ? await takeRunSnapshot(ctx, {
            ...path,
            path_index: args.path_index,
            attempt: args.attempt,
          })
        : await getRunStill(ctx, { ...path, still_id: args.still_id ?? '' });
    const type = blob.type.split(';')[0]?.trim().toLowerCase() ?? '';
    const extension = IMAGE_EXTENSIONS[type];
    if (extension === undefined) throw new ToolError('flows_walk_image_not_an_image');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const saved = saveImage(root, handle, name, extension, bytes, args.overwrite);
    const data: WalkImageData = {
      project_id: projectId,
      walk: { id: walkId, handle },
      kind: live ? 'snapshot' : 'still',
      path: saved,
      bytes: bytes.byteLength,
      type,
      ...(args.path_index === undefined
        ? {}
        : { path_index: args.path_index, attempt: args.attempt }),
      ...(args.still_id === undefined ? {} : { still_id: args.still_id }),
    };
    return {
      status: 'done',
      data,
      update: {
        log: {
          values: {
            walk_id: handle,
            path_index:
              args.path_index === undefined ? `still:${args.still_id ?? ''}` : args.path_index,
          },
        },
      },
    };
  },
  render: renderWalkImage,
});
