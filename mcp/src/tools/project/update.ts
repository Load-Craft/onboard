// `project_update` (module project): Update a project's name or description.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The tool reads the project first (the values before, which the undo restores), sends only
// the fields that differ, and says nothing was changed when none does (no write, no undo). The
// backend leaves a field that is not sent, or is sent as null, as it is, so the tool never sends
// null: a project that had no description is restored with an empty one.
// Log: args "{name}", result "{changed}": the data carries `name` and `changed`; the arguments of
// the undo are the previous values of the changed fields (`update.log.undo_args`).
// Arguments: name (1 to 255 characters), description (at most 8000), at least one.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import { renderUpdate, type UpdateData, type UpdatedField } from '../../render/project/update.js';
import {
  LIMITS,
  callBackend,
  projectIdOf,
  refuseRule,
  thirdParty,
  thirdPartyOrNull,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { PROJECT_UPDATE } from './meta.generated.js';

/** GET /projects/{project_id} (REST API v1) */
export function getProject(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'get_project_api_v1_projects__project_id__get'>> {
  return callBackend(ctx, 'get_project_api_v1_projects__project_id__get', { path });
}

/** PUT /projects/{project_id} (REST API v1) */
export function updateProject(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'update_project_api_v1_projects__project_id__put'>,
): Promise<OpOutput<'update_project_api_v1_projects__project_id__put'>> {
  return callBackend(ctx, 'update_project_api_v1_projects__project_id__put', { path, body });
}

const NAME_LIMIT = 100;

export const projectUpdate = moduleTool(PROJECT_UPDATE, {
  title: "Update a project's name or description",
  input: {
    name: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .optional()
      .describe('The new name; another project with the same name makes the backend refuse it.'),
    description: z
      .string()
      .max(8000)
      .optional()
      .describe('The new description; an empty text clears it.'),
  },
  async run(ctx, args) {
    if (args.name === undefined && args.description === undefined) {
      refuseRule('update_without_fields');
    }
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const before = await getProject(ctx, path);
    const nameChanged = args.name !== undefined && args.name !== before.name;
    const descriptionChanged =
      args.description !== undefined && args.description !== (before.description ?? '');
    const changed: UpdatedField[] = [
      ...(nameChanged ? (['name'] as const) : []),
      ...(descriptionChanged ? (['description'] as const) : []),
    ];
    const shownName = (text: string): string => thirdParty(ctx, text, NAME_LIMIT);
    const shownDescription = (text: string | null | undefined): string | null =>
      thirdPartyOrNull(ctx, text, LIMITS.sentence);
    if (changed.length === 0) {
      const data: UpdateData = {
        project_id: projectId,
        name: shownName(before.name),
        description: shownDescription(before.description),
        changed,
        previous: {},
        undoable: false,
      };
      return { status: 'done', data, inert: true };
    }
    const after = await updateProject(ctx, path, {
      ...(nameChanged && args.name !== undefined ? { name: args.name } : {}),
      ...(descriptionChanged && args.description !== undefined
        ? { description: args.description }
        : {}),
    });
    const previous = {
      ...(nameChanged ? { name: shownName(before.name) } : {}),
      ...(descriptionChanged ? { description: shownDescription(before.description) } : {}),
    };
    // a previous value the mask changed would be restored in its masked form, and kept as it is it
    // would put a secret into the state file: such a change is not offered for undo
    const undoArgs = {
      ...(nameChanged ? { name: before.name } : {}),
      ...(descriptionChanged ? { description: before.description ?? '' } : {}),
    };
    const undoable = Object.values(undoArgs).every((value) => ctx.secrets.scrub(value) === value);
    const data: UpdateData = {
      project_id: projectId,
      name: shownName(after.name),
      description: shownDescription(after.description),
      changed,
      previous,
      undoable,
    };
    return {
      status: 'done',
      data,
      ...(undoable ? { update: { log: { undo_args: undoArgs } } } : {}),
    };
  },
  render: renderUpdate,
});
