# flows: apply copilot changes — contract

Tool: `flows_apply_copilot_changes` (module `flows`; write, level 1; text view and `format: "data"`; the description, the annotations and the log
templates are the catalog's, through `meta.generated.ts`). Matches the catalog: yes.

## Arguments

- `flow_id?`: string 1 to 200 (id or name); default: the only flow of the workspace (`ids.flow_ids`), else `missing_argument`.
- `message_id`: string 1 to 200, required: the copilot turn (`flows_ask_copilot` returns it; `flows_get_copilot_history` shows it).
- `accept?`, `reject?`: comma-separated ids of changes of that turn (up to 2000 characters, 50 ids each); split, trimmed, empty items dropped, repeats once.
  Neither (rule `copilot_apply_nothing`), more than 50 of either (`copilot_apply_too_many`) or an id in both (`copilot_apply_overlap`) is `invalid_arguments`
  before any request.
- The model gives no change bodies: the backend compares each copilot change with the turn it recorded, so the tool sends the items as the history holds them.

## Operations

`GET …/flows/{id}` (the name and `current_version`: `expected_version` and the way back), `GET …/flows/{id}/copilot/history` (the turn and its
changes). A turn the history does not hold is `flows_copilot_turn_unknown`, an id the turn does not hold is `flows_copilot_change_unknown` (both
before any write). With `accept`: `POST …/copilot/apply` with `{expected_version, message_id, changes}` (the items with `origin: "copilot"` and
without `status`): ONE new version; the backend can drop changes (counted, its warnings shown); a flow that changed since is the 409, answered as
`flows_apply_version_conflict`. The accepted outcomes are recorded by the apply itself. With `reject`: `POST …/copilot/resolutions` with the ids as
`rejected`; if that fails after an apply the flow stays saved and the view says the outcomes were not recorded; with nothing applied it is an error.

## format=data

`project_id`, `flow` (`id`), `name`, `message_id`, `requested`, `applied`, `version` (the one saved, or the current one when none was), `previous`,
`saved`, `rejected` (the ids), `recorded`, `warnings` (`change`, `message`; the first 10). **Third party:** names, ids and warnings pass `content()`.
The blocks of a change (stored request blocks: headers, bodies) pass from the history read to the apply write and are shown nowhere.

## Log and undo

args `{flow_id}`, result `{applied}/{requested} changes applied as v{version}`. Undo: `update.log.undo_args = {undo_tool: 'flows_restore_version',
flow_id, version: <the version read before>}` when a version was saved; it brings the flow back, not the outcomes recorded in the history (the view
says so). A call that only rejects saves no version and has no undo.

## State

Reads `ids.flow_ids`. Writes: after an apply, the check `flows_built` and the flow's part of the `flows_need_input` warning as the new version has it.

## Test cases

- Accept and reject (full text, the POSTs and their bodies without a status, the flow and the recorded outcomes in the fake); no block shown; only reject.
- Dropped changes with their warning; the log entry; the undo run for real (blocks as before, outcomes stay); recording failing after an apply, and alone.
- The three module codes; the local refusals; arguments outside the catalog; the default flow, an unknown flow; Polish; secret sentinel (and the canary cases).

## Out of scope

Changes made by hand (`origin: "manual"`), asking the copilot (`flows_ask_copilot`), editing a change before applying it.
