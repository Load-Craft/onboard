# Recipe template LIST

Use it in steps 10 and 11 when step 2 printed `template   LIST`.
The example is `project_list_notes`. Copy its shape. Replace its names with the names step 2 printed.

## The view (step 10)

```ts
// The view of `project_list_notes`: one numbered line per note, what it applies to in brackets.
// Every text arrives masked and made one line by the tool; the view adds no text of the backend.

import type { Translator } from '../../context.js';
import type { Page } from '../../tools/kit/transitional.js';

/** What a note applies to: a page of the application or a step of a plan. */
export type NoteScope = 'url_path' | 'plan_step';

export interface NoteItem {
  readonly id: string | null;
  readonly text: string;
  readonly scope: NoteScope;
  /** The page path or the words of the step; null when the note names neither. */
  readonly at: string | null;
}

export interface ListNotesData {
  readonly project_id: string;
  readonly notes: Page<NoteItem>;
}

function scopeOf(note: NoteItem, t: Translator): string {
  if (note.at === null) return t('project_list_notes.scope.project');
  return t(`project_list_notes.scope.${note.scope}`, { at: note.at });
}

export function renderListNotes(data: ListNotesData, t: Translator): string {
  const list = data.notes;
  if (list.fetched === 0) return t('project_list_notes.empty');
  const lines = [t.plural('project_list_notes.header', list.count)];
  list.items.forEach((note, index) => {
    lines.push(`${String(index + 1)}. [${scopeOf(note, t)}] ${note.text}`);
  });
  if (list.shown < list.count) {
    lines.push(t('project_list_notes.more', { shown: list.shown, count: list.count }));
  }
  return lines.join('\n');
}
```

Change in your view:

- `NoteItem`: one field per row of the field table of the brief.
- The item line: the lines of the brief. A name goes through `quoted()`, an id through `idTag()`.
- The tool has `query`: add before the header line
  `if (list.count === 0) return t('<tool_name>.no_match', { query: list.query ?? '', fetched: list.fetched });`
- The backend gives a total: add after the `more` lines
  `if (list.total !== null && list.total > list.fetched) lines.push(t('<tool_name>.cut', { total: list.total, fetched: list.fetched }));`

## `run` (step 11)

```ts
// `project_list_notes` (module project): List the notes the agent learned about the project.
// Log: args "", result "{count} notes".

import type { OpOutput } from '../../http/operation.js';
import {
  renderListNotes,
  type ListNotesData,
  type NoteItem,
} from '../../render/project/listNotes.js';
import { callBackend, type CallContext } from '../moduleCall.js';
import { moduleTool } from '../moduleTool.js';
import { LIMITS, page, projectIdOf, thirdParty } from '../kit/transitional.js';
import { PROJECT_LIST_NOTES } from './meta.generated.js';

// The readers the scaffold wrote stay here, unchanged: listAgentGuidance.

type Wire = OpOutput<'list_agent_guidance_api_v1_projects__project_id__agent_guidance_get'>[number];

/** The notes one answer carries (the entry has no `limit`: the brief gives the number). */
const NOTES_SHOWN = 50;

function itemOf(ctx: CallContext, wire: Wire): NoteItem {
  const scope = wire.scope?.kind ?? 'url_path';
  const at = scope === 'plan_step' ? wire.scope?.plan_step : wire.scope?.url_path;
  return {
    id: wire.id ?? null,
    text: thirdParty(ctx, wire.text, LIMITS.sentence),
    scope,
    at:
      at === null || at === undefined || at.trim() === '' ? null : thirdParty(ctx, at, LIMITS.name),
  };
}

export const projectListNotes = moduleTool(PROJECT_LIST_NOTES, {
  title: 'List the notes the agent learned about the project',
  input: {},
  async run(ctx) {
    // 1. rules: none. 2. the project
    const projectId = projectIdOf(ctx, undefined);
    // 3. the read
    const answer = await listAgentGuidance(ctx, { project_id: projectId });
    // 4. the data: a Page under the plural name of the object
    const notes = page(answer, { limit: NOTES_SHOWN, map: (wire) => itemOf(ctx, wire) });
    const data: ListNotesData = { project_id: projectId, notes };
    // 5. the outcome: every log slot the data does not carry at its top level
    return { status: 'done', data, update: { log: { values: { count: notes.count } } } };
  },
  render: renderListNotes,
});
```

Change in your `run`:

- Keep the `title` and the `input` the scaffold wrote.
- `itemOf`: one line per field, each through its row of `docs/recipe/mask.md`.
- The tool has `limit`: write `limit: args.limit` in place of the constant.
- The tool has `query`: add `query: args.query, nameOf: (wire) => wire.name` to `page(...)`.
  Ask the backend for `backendLimit(args.limit, args.query, <backend maximum of the brief>)` items.
- The answer is an object with a list and a total: pass `answer.<list field>` and add `total: answer.<total field>`.
- Import from `'../kit/transitional.js'` only the names you use.
