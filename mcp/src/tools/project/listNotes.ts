// `project_list_notes` (module project): List the notes the agent learned about the project.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The notes are what the agent of LoadCraft learned while it walked the application, so their
// texts pass the mask of a third party's text (`content`) before the view.
// Log: args "", result "{count} notes": the data of the result carries the fields. The catalog
// names no arguments, so the tool takes none but `format`.

import type { OpOutput } from '../../http/operation.js';
import { renderListNotes, type NoteItem, type NotesData } from '../../render/project/listNotes.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { PROJECT_LIST_NOTES } from './meta.generated.js';

/** The notes the data carries; the count says how many the project has. */
const NOTES_SHOWN = 50;
/** The longest note text kept, and the longest page path or step words. */
const TEXT_LIMIT = 300;
const AT_LIMIT = 120;

/** GET /projects/{project_id}/agent-guidance (REST API v1) */
export function listAgentGuidance(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'list_agent_guidance_api_v1_projects__project_id__agent_guidance_get'>> {
  return callBackend(ctx, 'list_agent_guidance_api_v1_projects__project_id__agent_guidance_get', {
    path,
  });
}

type Entry =
  OpOutput<'list_agent_guidance_api_v1_projects__project_id__agent_guidance_get'>[number];

function noteOf(ctx: CallContext, entry: Entry): NoteItem {
  const scope = entry.scope?.kind ?? 'url_path';
  const at = scope === 'plan_step' ? entry.scope?.plan_step : entry.scope?.url_path;
  return {
    id: entry.id ?? null,
    text: content(ctx, entry.text, TEXT_LIMIT),
    scope,
    at: at === null || at === undefined || at.trim() === '' ? null : content(ctx, at, AT_LIMIT),
    learned_from_run: entry.learned_from_run ?? null,
  };
}

export const projectListNotes = moduleTool(PROJECT_LIST_NOTES, {
  title: 'List the notes the agent learned about the project',
  // the catalog names no arguments: the project is the one this workspace works on
  input: {},
  async run(ctx) {
    const projectId = projectIdOf(ctx, undefined);
    const entries = await listAgentGuidance(ctx, { project_id: projectId });
    const notes = entries.slice(0, NOTES_SHOWN).map((entry) => noteOf(ctx, entry));
    const data: NotesData = {
      project_id: projectId,
      count: entries.length,
      shown: notes.length,
      notes,
    };
    return { status: 'done', data };
  },
  render: renderListNotes,
});
