# functional_save_flow — contract

Tool: `functional_save_flow` (module `functional`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text view and `format: "data"`;
description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`). Matches the catalog: yes.

## Arguments (the catalog's)

- `flow_id`: uuid; without it a new flow is created.
- `name`: 1 to 255 characters; required for a new flow.
- `docs_id`: uuid, default `ids.docs_id` of the state (else `missing_argument`): the API docs of a new flow.
- `fields`: object, strict keys: `blocks`, `edges` (lists of objects), `entry_block_id`, `description`, `tags`, `variables`, `timeout_ms`, `retry_count`, `retry_delay_ms` (whole numbers), `is_active`.
  An unknown key is refused locally; the values, the blocks included, are the backend's to check (its lint of a graph is a 422 → `invalid`).
- `version` (1 to 60 characters) and `reason` (1 to 200): a named snapshot of the flow's current blocks and edges instead of a write: with `flow_id`, not with `name`, `docs_id` or `fields`.
- Refused locally (`invalid_arguments`, no request): a new flow without `name` (`functional_flow_new_needs`); `is_active` on a new flow, `docs_id` on a change
  (`functional_flow_new_only`/`functional_flow_change_only` rules); `version` without `flow_id` or with a write (`functional_flow_snapshot_alone`); `reason` without `version`
  (`functional_flow_reason_needs_version`); a change with nothing in it (`functional_flow_nothing`).

## Operations

- New: `POST /test-flows` (the backend's defaults for timeout, retries and delay are sent when `fields` has none).
- Change: `GET /test-flows/{id}` (the values now: comparison and way back), then, when blocks or edges change, `GET /test-flows/{id}/versions` (to take a free label) and
  `POST /test-flows/{id}/versions` with the label `pre-save-<UTC time>` (the safety snapshot: the way back of the blocks), then `PUT /test-flows/{id}` with only the fields that differ.
  The values equal to the flow's: nothing is sent (inert, no undo).
- Snapshot: `POST /test-flows/{id}/versions` with the label and the reason (a label the flow already has is the backend's 500).
  The backend's update is partial: omitted or null fields stay, so a description or an entry block cannot be cleared.

## format=data

`flow` (`id`), `name` (masked), `created`, `changed` (the fields written), `snapshot` (the label of the safety snapshot, or of the one asked for; null otherwise), `blocks` (how many), `not_undoable`
(changed fields the backend cannot put back), `undo` (`restore`, `values`, `partial`, `none`, `withheld`, `too_large`).
**Third party:** the name and the labels pass `content()`; blocks, edges, variables and descriptions are only counted or named.

## Text view

```
Functional flow "Checkout" created [3f2a…] (3 blocks).
Functional flow "Checkout" updated: name, blocks. The state before was kept as version pre-save-20261127T120000Z (an extra version in its history); the undo restores that.
```

A line says what the undo does not cover (restoring puts back blocks and edges only). Snapshot: `Version "v2" saved for flow "Checkout".` Unchanged: `Functional flow "Checkout": nothing to change.`

## Undo

- New flow: `undo: {tool: "functional_delete", args: {kind: "flow", item_id: <id>}}` (level 3, a card and the person's yes; only named, with `undo_tool`).
- Change of blocks or edges: `undo: {tool: "functional_restore_flow", args: {flow_id, version: <the safety snapshot>}}`. Restoring puts back blocks and edges only: when other fields changed too the undo is `partial` and
  the view lists them.
- Change of other fields only: `undo: {tool: "functional_save_flow", args: {flow_id, name?, fields: <the previous values>}}`; an empty value stays out (`not_undoable`), with nothing else there is no undo; a value
  the secret mask would change is not kept (`withheld`), nor a way back over 20000 characters (`too_large`).
- Snapshot only, nothing changed, a failed write: no undo entry (a snapshot changes nothing in the flow; the version stays in its history).

## State

Reads `ids.docs_id`. Writes nothing.

## UI

Text only.

## Test cases

- Ordinary: create (with the state's docs version, with `docs_id`); change a name; change blocks (the snapshot, the label, one PUT); both; a snapshot by label; the fake holds what was written.
- Undo: create (names the deletion, applying it leaves the flows as before); blocks changed (restore → blocks and edges as before); only fields changed (this tool, previous values); both (partial, said).
- Edge: nothing differs; the local refusals; an unknown key in `fields`; a label already used (500, nothing written); two saves in the same second take different labels; unknown flow; no docs version for a new flow; a null description (not restorable); Polish view; log entry.
- Adversary: sentinel in the name and a previous value; instruction in the name; control sequences.

## Out of scope

Deleting a flow (`functional_delete`), restoring a version (`functional_restore_flow`), reading flows (`functional_get_flows`).
