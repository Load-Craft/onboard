// `flows_save_walk_note` (module flows): Save a note at a step of a walk (new or changed); notes
// steer the next retry.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// A new note is one POST; a changed note reads the notes of the walk first (an auxiliary read: the
// text it has now is the way back, and a note that already says the same sends nothing), then one
// PATCH. The backend decides everything else (an empty or too long note, a step not finished, a
// closed review session). `skip` is not this tool's. The walk is its uuid, `record_run:<uuid>` or the
// short handle of this workspace's walk. The text and the step are the user's words and pass `content`.
// Log: args "{walk_id} step {step}" (`update.log.values`), result "note at step {step}": the data
// carries `step`. A new note has no undo (`flows_delete` deletes flows only); a changed note's is this
// tool with the previous text (`update.log.undo_args`).
// Arguments: walk_id, step, text, note_id, remember.

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderSaveWalkNote,
  type SaveWalkNoteData,
  type WalkNoteUndo,
} from '../../render/flows/saveWalkNote.js';
import { callBackend, content, type BodyOf, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { FLOWS_SAVE_WALK_NOTE } from './meta.generated.js';

/** POST /projects/{project_id}/scenario-from-description/runs/{run_id}/notes (REST API v1) */
export function addStepNote(
  ctx: CallContext,
  path: { readonly project_id: string; readonly run_id: string },
  body: BodyOf<'add_step_note_api_v1_projects__project_id__scenario_from_description_runs__run_id__notes_post'>,
): Promise<
  OpOutput<'add_step_note_api_v1_projects__project_id__scenario_from_description_runs__run_id__notes_post'>
> {
  return callBackend(
    ctx,
    'add_step_note_api_v1_projects__project_id__scenario_from_description_runs__run_id__notes_post',
    { path, body },
  );
}

/** PATCH /projects/{project_id}/scenario-from-description/runs/{run_id}/notes/{note_id} (REST API v1) */
export function updateStepNote(
  ctx: CallContext,
  path: { readonly project_id: string; readonly run_id: string; readonly note_id: string },
  body: BodyOf<'update_step_note_api_v1_projects__project_id__scenario_from_description_runs__run_id__notes__note_id__patch'>,
): Promise<
  OpOutput<'update_step_note_api_v1_projects__project_id__scenario_from_description_runs__run_id__notes__note_id__patch'>
> {
  return callBackend(
    ctx,
    'update_step_note_api_v1_projects__project_id__scenario_from_description_runs__run_id__notes__note_id__patch',
    { path, body },
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

const TEXT_LIMIT = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHORT_HANDLE = /^r-([0-9a-f]{8})$/iu;
const OPERATION_HANDLE = /^record_run:(.+)$/iu;

/** The walk the call means: the argument (uuid, `record_run:<uuid>` or `r-xxxxxxxx`), else the state's. */
function walkIdOf(ctx: ToolContext, given: string | undefined): string {
  const wanted = given ?? ctx.state.process()?.ids.walk_id;
  if (wanted === undefined)
    throw new ToolError('missing_argument', { params: { name: 'walk_id' } });
  const named = OPERATION_HANDLE.exec(wanted)?.[1] ?? wanted;
  if (UUID.test(named)) return named.toLowerCase();
  const short = SHORT_HANDLE.exec(named)?.[1]?.toLowerCase();
  const found =
    short === undefined
      ? undefined
      : (ctx.state.process()?.operations ?? [])
          .map((row) => OPERATION_HANDLE.exec(row.handle)?.[1] ?? '')
          .find((id) => id.toLowerCase().startsWith(short));
  if (found === undefined) {
    throw new ToolError('operation_unknown', { params: { value: content(ctx, wanted, 120) } });
  }
  return found.toLowerCase();
}

export const flowsSaveWalkNote = moduleTool(FLOWS_SAVE_WALK_NOTE, {
  title: 'Save a note at a step of a walk',
  input: {
    walk_id: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('The walk: its handle or id; default: the walk of this workspace.'),
    step: z
      .string()
      .min(1)
      .max(100)
      .describe('The step of the walk (from flows_get_walks include timeline).'),
    text: z.string().min(1).max(500).describe('The note.'),
    note_id: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('An existing note to change; without it, a new note.'),
    remember: z
      .boolean()
      .default(false)
      .describe('true: also keep it as a note of the project for later walks.'),
  },
  async run(ctx, args) {
    if (args.note_id !== undefined && args.remember) {
      throw new ToolError('invalid_arguments', {
        message: 'remember applies to a new note: do not pass it with note_id',
        params: { rule: 'walk_note_remember_new' },
      });
    }
    const walkId = walkIdOf(ctx, args.walk_id);
    const projectId = projectIdOf(ctx, undefined);
    const text = args.text.trim();
    const logValues = { walk_id: walkId, step: args.step };
    const base = { project_id: projectId, walk_id: walkId, step: args.step };
    if (args.note_id === undefined) {
      const note = await addStepNote(
        ctx,
        { project_id: projectId, run_id: walkId },
        { step_id: args.step, text, kind: 'text', remember: args.remember },
      );
      const data: SaveWalkNoteData = {
        ...base,
        id: note.id ?? null,
        text: content(ctx, note.text, TEXT_LIMIT),
        created: true,
        remember: args.remember,
        changed: true,
        undo: 'none',
      };
      return {
        status: 'done',
        data,
        update: {
          // `flows_delete` deletes flows only, so a new note has no way back from here
          log: { values: logValues },
        },
      };
    }
    // the text the note has now is the way back; a read that fails or does not hold the note
    // leaves the write to go on without one
    let before: { text: string; step_id: string } | undefined;
    try {
      const timeline = await getRunTimeline(ctx, { project_id: projectId, run_id: walkId });
      const found = (timeline.notes ?? []).find((item) => item.id === args.note_id);
      if (found !== undefined) before = { text: found.text, step_id: found.step_id };
    } catch (error) {
      if (!(error instanceof LoadcraftApiError)) throw error;
    }
    if (before !== undefined && before.text === text) {
      const data: SaveWalkNoteData = {
        ...base,
        id: args.note_id,
        text: content(ctx, before.text, TEXT_LIMIT),
        created: false,
        remember: false,
        changed: false,
        undo: 'none',
      };
      return { status: 'done', data, inert: true, update: { log: { values: logValues } } };
    }
    const note = await updateStepNote(
      ctx,
      { project_id: projectId, run_id: walkId, note_id: args.note_id },
      { text },
    );
    const shown = content(ctx, note.text, TEXT_LIMIT);
    // masking the text registers what the mask finds in it, before the check below
    if (before !== undefined) content(ctx, before.text, TEXT_LIMIT);
    const withheld = before !== undefined && ctx.secrets.scrub(before.text) !== before.text;
    const undo: WalkNoteUndo = before === undefined ? 'none' : withheld ? 'withheld' : 'kept';
    const data: SaveWalkNoteData = {
      ...base,
      id: note.id ?? args.note_id,
      text: shown,
      created: false,
      remember: false,
      changed: true,
      undo,
    };
    return {
      status: 'done',
      data,
      update: {
        log: {
          values: logValues,
          ...(undo === 'kept' && before !== undefined
            ? {
                undo_args: {
                  walk_id: walkId,
                  step: before.step_id,
                  note_id: args.note_id,
                  text: before.text,
                },
              }
            : {}),
        },
      },
    };
  },
  render: renderSaveWalkNote,
});
