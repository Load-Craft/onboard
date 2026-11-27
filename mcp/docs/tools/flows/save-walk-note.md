# flows_save_walk_note — contract

Tool: `flows_save_walk_note` (module `flows`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text view and
`format: "data"`; description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes.

## Arguments

- `walk_id`: the walk (a run from a description): its uuid, `record_run:<uuid>` or the short handle `r-xxxxxxxx` of this workspace's walk;
  default: the walk of the workspace (`ids.walk_id`), else `missing_argument`.
- `step`: the step of the walk, 1 to 100 characters, required (the id `flows_get_walks` with `include: ["timeline"]` shows).
- `text`: the note, 1 to 500 characters, required.
- `note_id`: an existing note to change (its text); without it a new note. With `note_id` the step is the note's own.
- `remember`: boolean, default false: a new note is also kept as a note of the project for later walks. Not with `note_id` (refused
  locally, `invalid_arguments`, rule `walk_note_remember_new`, no request).
- The project is the bound one (`projectIdOf`, else `no_project`).

## Operations

1. New note: `POST /projects/{id}/scenario-from-description/runs/{run_id}/notes` with `{step_id, text, kind: "text", remember}`.
2. Changed note: `GET .../runs/{run_id}/timeline` once, before the write, for the note's text now (the way back; an auxiliary read: when it
   fails or does not hold the note, the write is still sent and nothing is kept for an undo), then `PATCH .../runs/{run_id}/notes/{note_id}`
   with `{text}`. (The catalog entry of the tool does not yet list this read among its operations.) The same text as the note has: nothing is sent (inert). The backend's refusals (an empty or too long note, an account
   placeholder, a step that is not finished, a walk whose review session is closed) are answered as they are: nothing written, no undo entry.
   `kind: "skip"` (leaving a step out of the plan) is not this tool's.

## format=data

`project_id`, `walk_id`, `id` (the note), `step`, `text` (after the call, one line, masked), `created` (a new note), `remember`, `changed`,
`undo` (`kept`, `none`, `withheld`: the previous text held a secret and is not kept).
**Third party:** the text and the step are what the user wrote: they pass `content()`.

## Text view

```
Note added at step s-3: "Wait for the spinner to disappear."
```

Changed: `Note 3f2a… changed at step s-3: "…"`. Unchanged: `Note 3f2a… already says that; nothing changed.` With `remember`: a second line says the note is also kept for the project.

## Undo

A new note has no undo: `flows_delete` deletes flows only, so there is no way back from here, and the view says so in one line. A changed
note: `undo: {tool: "flows_save_walk_note", args: {walk_id, step, note_id, text: <the previous text>}}`. A previous text the secret mask would change is not kept.

## State

Reads `ids.project_id`, `ids.walk_id`. Writes nothing. No invalidation row names this tool.

## UI

Text only.

## Test cases

- Ordinary: a new note, with `remember`; a changed note; the note in the fake holds it; the walk by uuid, `record_run:` and the short handle; the default walk.
- Undo: change a note, take the undo from the log, call it, the note is as before; a new note: no undo entry, and the view says so.
- Edge: the same text again (no PATCH, no undo); `remember` with `note_id` (refused); an empty text; 501 characters; unknown note (404); unknown walk (404); a malformed `walk_id`; no `walk_id` and none in the state; no bound
  project; the timeline read failing (the write goes on, no undo); Polish view; log entry.
- Adversary: sentinel in the text and the previous text; instruction in the text; control sequences.

## Out of scope

Skipping steps (`kind: "skip"`), deleting a note (`flows_delete`), reading notes (`flows_get_walks`).
