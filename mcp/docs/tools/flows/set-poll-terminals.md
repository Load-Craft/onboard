# flows: set poll terminals — contract

Tool: `flows_set_poll_terminals` (module `flows`; write, level 1; text view and `format: "data"`; the description, the annotations and the log
templates are the catalog's, through `meta.generated.ts`). Matches the catalog: yes.

## Arguments

- `flow_id?`: string 1 to 200 (id or name); default: the only flow of the workspace (`ids.flow_ids`), else `missing_argument`.
- `field`: string 1 to 200, required: the status field of an open `poll_status` question (the `field` of the item in `flows_get`).
- `success_terminals`: comma-separated text, required (1 to 1000 characters): 1 to 20 statuses.
- `failure_terminals?`: comma-separated text (up to 1000 characters): up to 20 statuses; without it, none.
- The texts are split on commas, trimmed, empty items dropped and repeats kept once. No success status left, or more than 20 of either list, is
  rule `poll_terminals_success_needed` / `poll_terminals_too_many` (`invalid_arguments`, before any request). One field per call.

## Operations

`GET …/flows/{id}` (the name and `current_version`: the way back), then `POST …/flows/{id}/poll-terminals` with
`{answers: [{field, success_terminals, failure_terminals}]}`. The backend saves a new flow version also when the statuses are the ones already set,
so no call is inert. A field with no poll loop is the backend's 422 (nothing saved). The answer lists the questions still open.

## format=data

`project_id`, `flow` (`id`), `name`, `field`, `success`, `failure`, `version` (the one saved), `previous`, `open` (questions left open).
**Third party:** the name, the field and the statuses pass `content()`.

## Text view

Which loop of which flow was answered and as which version, the statuses, how many questions are still open, and the undo.

## Log and undo

args `{flow_id}`, result `{field} answered as v{version}; {open} open`. Undo: `update.log.undo_args = {undo_tool: 'flows_restore_version', flow_id,
version: <the version read before>}`. A version keeps the open questions, so the restore brings back the blocks, the edges and the question; answering
again would only overwrite the statuses.

## State

Reads `ids.flow_ids`. Writes: the open questions of the answer replace the flow's part of the `flows_need_input` warning; the check
`questions_answered` is met when no question is left open.

## Test cases

- The answer (full text, one POST with the lists, the version, the question gone), no failure statuses and the check, the default flow, by name.
- List splitting; the local refusals; arguments outside the catalog; a field with no loop (422, nothing saved); an unknown flow.
- The log entry, the undo run for real (blocks, edges and the question as before), Polish; secret sentinel (and `test/tools/flows/canary.ts`).

## Out of scope

Several fields in one call, answering questions of other kinds.
