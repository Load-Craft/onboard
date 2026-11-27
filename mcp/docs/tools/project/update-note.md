# project_update_note — contract

Tool: `project_update_note` (module `project`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text view
and `format: "data"`; description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool), with one exception of the undo, below.

## Arguments

- `note_id`: the note's id as `project_list_notes` prints it, 32 hexadecimal characters (lower-cased before use). Required.
- `text`: the new text, trimmed, 1 to 500 characters. Optional.
- `scope`: `url_path` or `plan_step`. Optional. The backend lets a note move only from a step of the plan to a page.
- `at`: the page path (`url_path`) or the words of the step (`plan_step`), 1 to 500 characters; only with `scope`. A step that becomes a
  page may leave it out: the backend then uses the page the note was written on.
- At least one of `text` and `scope`, and `at` only with `scope`: otherwise refused locally (`invalid_arguments`, rules
  `note_nothing_to_change` and `note_at_without_scope`), with no request.
- The project is the bound one (`projectIdOf`, else `no_project`).

## Operations

1. `GET /projects/{id}/agent-guidance` once, before the write: the note as it is now (the text for the undo, the scope for the comparison).
2. `PATCH /projects/{id}/agent-guidance/{note_id}` with only the fields that differ from the note. A note the list does not hold is still
   sent (the backend answers 404, `not_found`, and decides); nothing then is kept for an undo. An empty or too long text, an account
   placeholder, and a scope change the backend does not allow (a page never becomes a step, another page is not a change of scope) are 400
   answers the tool does not second-guess: nothing is written, no undo entry.
3. When every given field already equals the note: no write, `changed: []`, inert.

## format=data

`project_id`, `id`, `text` (after the call; one line, masked, at most 300 characters), `scope` (`url_path` | `plan_step`), `at` (the page or
the step; null when none), `changed` (`text`, `scope`), `previous` (`text` and `scope`/`at` before, for the changed fields), `undo`:
`kept` (the text comes back), `text_only` (the scope moved too and does not come back), `scope` (only the scope changed: nothing to undo),
`withheld` (the previous text held a secret and is not kept), `none` (nothing changed).
**Third party:** the text and the page or step are what the agent learned while walking the application: they pass `content()`.

## Text view

```
Note 3f2a9c0b7d4e4a51b8c6d2e1f09a7b34 updated: text.
text: "Accept the cookie banner before the first form."
```

Undo notes follow as one line (`text_only`, `scope`, `withheld`).

## Undo

`undo: {tool: "project_update_note", args: {note_id, text: <previous text>}}`. The catalog says "the previous text and scope": the scope is
restored by nothing, because the backend refuses to turn a page note back into a step note, and a call that did not change the scope has
nothing of it to restore. So the undo carries the text only; a call that moved the scope says so in its view. A previous text the secret mask
would change is not kept. A failed write leaves no entry with an undo.

## State

Reads `ids.project_id`. Writes nothing. No invalidation row names this tool.

## UI

Text only.

## Test cases

- Ordinary: change the text; move a step note to its page (with and without `at`); both at once; the note in the fake holds the change.
- Undo: write, take the undo from the log, call it, the note is as before (text); both fields changed: the undo restores the text and the scope
  stays on the page.
- Edge: nothing differs (no `PATCH`, no undo); unknown note (404, nothing kept); an empty text (the schema), a text over 500 characters, `at`
  without `scope`, neither text nor scope; a scope change the backend refuses (page to step, another page); no bound project; Polish view; log entry.
- Adversary: sentinel in the text and the page; instruction in the text; control sequences; a previous text with a secret gets no undo.

## Out of scope

Creating and deleting notes (they come from the agent's walks), reading them (`project_list_notes`).
