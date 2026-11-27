# functional: restore_flow — contract

Tool: `functional_restore_flow` (module `functional`, `moduleTool`; write, level 1, no card; text view and `format: "data"`; the
description, the annotations and the log templates are the catalog's, through `meta.generated.ts`). `functional_save_flow`,
`functional_save_template` and `functional_get_catalog` are not written here.

Arguments (the catalog's): `flow_id` (a UUID) and `version` (1-60, the label of a saved version, required).

Operations: `GET /test-flows/{id}/versions` (before), `POST /test-flows/{id}/versions/{version}/restore`, `GET
/test-flows/{id}/versions` (after). The backend keeps the state before the restore as a new saved version; the tool takes the one that
appeared (the newest) as the snapshot. An unknown flow or label is the backend's `not_found` and changes nothing; but when no functional flow exists at all (for the documentation
version of the workspace, when it has one; checked with `GET /test-flows?limit=1` after the 404 of the first read), the call is
`functional_no_flows`: the project has no functional tests, so there is nothing to restore.

Data: `flow_id`, `name` (masked text), `version` (restored), `snapshot` (the label of the version that kept the earlier state, or null),
`blocks`, `undoable`. Log: args `{flow_id} {version}`, result `{name}: version {version} restored`.

Undo: `functional_restore_flow` with the flow and the snapshot label (`update.log.undo_args`): restoring the snapshot puts the earlier state
back (and, as every restore, snapshots the state it leaves, so a restore can be undone again). No undo is declared when the backend lists no
new version, or when the snapshot label held a secret (the mask would change it).

Tests: the restore and its three requests, the undo from the log with the stored object compared (`expectUndoRestores`), the data, no new
version, `not_found` with nothing changed, a masked label, arguments outside the catalog, the Polish view, the sentinel case.
