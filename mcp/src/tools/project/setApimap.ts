// `project_set_apimap` (module project): Set the URL prefixes that define the project's API areas.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// The map is read first (its saved prefixes are the way back; null: the areas were the detected
// ones), then written; what a prefix may look like is the backend's rule (422), the tool refuses
// locally only what cannot be sent (neither or both arguments, over 64 prefixes, an empty or too
// long one). The answer's saved prefixes decide whether anything changed.
// Log: args "{prefixes}" (`detected` for the way back to the detected areas), result "{count} area
// prefixes": the data carries `count`; the arguments of the undo are the previous prefixes, as one
// comma-separated text, or `detected: true` (`update.log.undo_args`).

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import { renderSetApimap, type SetApimapData } from '../../render/project/setApimap.js';
import {
  callBackend,
  projectIdOf,
  refuseRule,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { getProject } from './getApimap.js';
import { PROJECT_SET_APIMAP } from './meta.generated.js';

/** PUT /projects/{project_id}/api-map/area-prefixes (REST API v1) */
export function setProjectAreaPrefixes(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'set_project_area_prefixes_api_v1_projects__project_id__api_map_area_prefixes_put'>,
): Promise<
  OpOutput<'set_project_area_prefixes_api_v1_projects__project_id__api_map_area_prefixes_put'>
> {
  return callBackend(
    ctx,
    'set_project_area_prefixes_api_v1_projects__project_id__api_map_area_prefixes_put',
    { path, body },
  );
}

const PREFIXES_SHOWN = 64;
const MAX_PREFIXES = 64;
const MAX_PREFIX_CHARS = 512;
const TEXT_LIMIT = 100;

/** The prefixes of the call: comma-separated, trimmed; refused when none can be sent. */
function prefixesOf(text: string): string[] {
  const prefixes = text.split(',').map((prefix) => prefix.trim());
  if (
    prefixes.length > MAX_PREFIXES ||
    prefixes.some((prefix) => prefix === '' || prefix.length > MAX_PREFIX_CHARS)
  ) {
    refuseRule('apimap_prefix_limits');
  }
  return prefixes;
}

const sameList = (a: readonly string[] | null, b: readonly string[] | null): boolean =>
  a === null || b === null ? a === b : a.length === b.length && a.every((item, i) => item === b[i]);

export const projectSetApimap = moduleTool(PROJECT_SET_APIMAP, {
  title: "Set the URL prefixes that define the project's API areas",
  input: {
    prefixes: z
      .string()
      .min(1)
      .max(8000)
      .optional()
      .describe('Path prefixes of the areas, comma-separated (at most 64); not with detected.'),
    detected: z
      .boolean()
      .default(false)
      .describe('true: go back to the areas LoadCraft detects (not with prefixes).'),
  },
  async run(ctx, args) {
    if ((args.prefixes === undefined) === !args.detected) {
      refuseRule('apimap_one_of');
    }
    const wanted = args.prefixes === undefined ? null : prefixesOf(args.prefixes);
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const before = (await getProject(ctx, path)).saved_area_prefixes ?? null;
    const after = await setProjectAreaPrefixes(ctx, path, { area_prefixes: wanted });
    const saved = after.saved_area_prefixes ?? null;
    const changed = !sameList(before, saved);
    const shown = (list: readonly string[] | null | undefined): string[] =>
      (list ?? []).slice(0, PREFIXES_SHOWN).map((prefix) => thirdParty(ctx, prefix, TEXT_LIMIT));
    // the way back is one text of the previous prefixes: not possible with a comma in one, and not
    // kept when the mask would change one (it would be restored masked, or put a secret in the state)
    // masking the prefixes registers what the mask finds in them, before the check below
    const shownBefore = shown(before);
    const shownSaved = shown(saved);
    const undoArgs = before === null ? { detected: true } : { prefixes: before.join(',') };
    const undoable =
      changed &&
      (before === null ||
        (!before.some((prefix) => prefix.includes(',')) &&
          ctx.secrets.scrub(undoArgs.prefixes ?? '') === undoArgs.prefixes));
    const data: SetApimapData = {
      project_id: projectId,
      mode: saved === null ? 'detected' : 'prefixes',
      prefixes: shownSaved,
      count: saved?.length ?? 0,
      areas: after.areas?.length ?? 0,
      empty_prefixes: shown(after.empty_area_prefixes),
      changed,
      previous: before === null ? null : shownBefore,
      undoable,
    };
    return {
      status: 'done',
      data,
      ...(changed ? {} : { inert: true as const }),
      update: {
        log: {
          ...(wanted === null ? { values: { prefixes: 'detected' } } : {}),
          ...(undoable ? { undo_args: undoArgs } : {}),
        },
      },
    };
  },
  render: renderSetApimap,
});
