// `project_update_note` (module project): Update the text or scope of a project note.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "{id}", result "note {id} updated": the data of the result carries the fields.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import type { NoteScope } from '../../render/project/listNotes.js';
import {
  renderUpdateNote,
  type NoteField,
  type NoteUndo,
  type UpdateNoteData,
} from '../../render/project/updateNote.js';
import {
  LIMITS,
  callBackend,
  projectIdOf,
  refuseRule,
  thirdPartyOrNull,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { listAgentGuidance } from './listNotes.js';
import { PROJECT_UPDATE_NOTE } from './meta.generated.js';

/** PATCH /projects/{project_id}/agent-guidance/{entry_id} (REST API v1) */
export function updateAgentGuidanceEntry(
  ctx: CallContext,
  path: { readonly project_id: string; readonly entry_id: string },
  body: BodyOf<'update_agent_guidance_entry_api_v1_projects__project_id__agent_guidance__entry_id__patch'>,
): Promise<
  OpOutput<'update_agent_guidance_entry_api_v1_projects__project_id__agent_guidance__entry_id__patch'>
> {
  return callBackend(
    ctx,
    'update_agent_guidance_entry_api_v1_projects__project_id__agent_guidance__entry_id__patch',
    { path, body },
  );
}

type Entry =
  OpOutput<'list_agent_guidance_api_v1_projects__project_id__agent_guidance_get'>[number];

/** Where a note applies: its kind (a note stored with no scope applies to a page) and the page or step. */
function scopeOf(entry: Entry | undefined): { kind: NoteScope; at: string | null } | undefined {
  if (entry === undefined) return undefined;
  const kind = entry.scope?.kind ?? 'url_path';
  const at = kind === 'plan_step' ? entry.scope?.plan_step : entry.scope?.url_path;
  return { kind, at: at === undefined || at === null || at === '' ? null : at };
}

export const projectUpdateNote = moduleTool(PROJECT_UPDATE_NOTE, {
  title: 'Update the text or scope of a project note',
  input: {
    note_id: z
      .string()
      .length(32)
      .regex(/^[0-9a-fA-F]{32}$/u)
      .describe('The note id (32 hex characters) from project_list_notes.'),
    text: z.string().trim().min(1).max(500).optional().describe("The note's new text."),
    scope: z
      .enum(['url_path', 'plan_step'])
      .optional()
      .describe(
        'Where the note applies: a page path or a plan step (a step can only become a page).',
      ),
    at: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe('The page path (url_path) or words of the step (plan_step); with scope.'),
  },
  async run(ctx, args) {
    if (args.text === undefined && args.scope === undefined) {
      refuseRule('note_nothing_to_change');
    }
    if (args.at !== undefined && args.scope === undefined) {
      refuseRule('note_at_without_scope');
    }
    const noteId = args.note_id.toLowerCase();
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const entries = await listAgentGuidance(ctx, path);
    const before = entries.find((entry) => entry.id?.toLowerCase() === noteId);
    const now = scopeOf(before);
    const textChanged = args.text !== undefined && args.text !== before?.text;
    const scopeChanged =
      args.scope !== undefined &&
      (now === undefined ||
        args.scope !== now.kind ||
        (args.at !== undefined && args.at !== now.at));
    const changed: NoteField[] = [
      ...(textChanged ? (['text'] as const) : []),
      ...(scopeChanged ? (['scope'] as const) : []),
    ];
    const logValues = { id: noteId };
    if (changed.length === 0) {
      const data: UpdateNoteData = {
        project_id: projectId,
        id: noteId,
        text: thirdPartyOrNull(ctx, before?.text, LIMITS.sentence) ?? '',
        scope: now?.kind ?? 'url_path',
        at: thirdPartyOrNull(ctx, now?.at, LIMITS.name),
        changed,
        previous: {},
        undo: 'none',
      };
      return { status: 'done', data, inert: true, update: { log: { values: logValues } } };
    }
    const updated = await updateAgentGuidanceEntry(
      ctx,
      { project_id: projectId, entry_id: noteId },
      {
        ...(textChanged && args.text !== undefined ? { text: args.text } : {}),
        ...(scopeChanged && args.scope !== undefined
          ? {
              scope:
                args.scope === 'plan_step'
                  ? { kind: 'plan_step', ...(args.at === undefined ? {} : { plan_step: args.at }) }
                  : { kind: 'url_path', ...(args.at === undefined ? {} : { url_path: args.at }) },
            }
          : {}),
      },
    );
    const after = scopeOf(updated);
    // masking the texts registers what the mask finds in them, before the check below
    const shownText = thirdPartyOrNull(ctx, updated.text, LIMITS.sentence) ?? '';
    const shownBefore = thirdPartyOrNull(ctx, before?.text, LIMITS.sentence);
    const shownAt = thirdPartyOrNull(ctx, after?.at, LIMITS.name);
    const shownAtBefore = thirdPartyOrNull(ctx, now?.at, LIMITS.name);
    // a previous text the mask would change would be restored masked, and kept as it is would put a
    // secret into the state file; the scope never comes back (a page does not become a step)
    const withheld = before !== undefined && ctx.secrets.scrub(before.text) !== before.text;
    const undo: NoteUndo =
      before === undefined
        ? 'none'
        : !textChanged
          ? 'scope'
          : withheld
            ? 'withheld'
            : scopeChanged
              ? 'text_only'
              : 'kept';
    const data: UpdateNoteData = {
      project_id: projectId,
      id: noteId,
      text: shownText,
      scope: after?.kind ?? 'url_path',
      at: shownAt,
      changed,
      previous: {
        ...(textChanged ? { text: shownBefore ?? '' } : {}),
        ...(scopeChanged && now !== undefined ? { scope: now.kind, at: shownAtBefore } : {}),
      },
      undo,
    };
    return {
      status: 'done',
      data,
      update: {
        log: {
          values: logValues,
          ...(textChanged && !withheld && before !== undefined
            ? { undo_args: { note_id: noteId, text: before.text } }
            : {}),
        },
      },
    };
  },
  render: renderUpdateNote,
});
