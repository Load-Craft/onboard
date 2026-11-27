# data: set_slot_label — contract

Tool: `data_set_slot_label` (module `data`, `moduleTool`; write, level 1, no card; text view and `format: "data"`; the description, the
annotations and the log templates are the catalog's, through `meta.generated.ts`).

Arguments (the catalog's): `scenario_id?` (a UUID; default: the only scenario the state of the workspace knows, else `missing_argument`),
`slot` (1-100, required), `label` (1-200, required; it is trimmed). The project is the bound one.

Operations: `GET …/gatling/scenarios/{id}/slots/options` (the slots and their labels), then, only if the label differs, `PATCH
…/data-hub/scenarios/{id}/slots/{slot}/label` with `{label}`. A slot the scenario lacks is `not_found` naming its slots (nothing written);
an unknown scenario is the backend's `not_found`. The label is written to the scenario artifact with no version bump and no snapshot, so
the undo is the only way back.

Data: `scenario_id`, `slot`, `label` (after), `previous` (before, or null), `changed`, `undoable`, `notUndoable` (`no_previous`, `secret` or
null). Texts pass `content()`. Log: args `{slot}`, result `slot {slot}: {label}`.

Undo: `data_set_slot_label` with the scenario, the slot and the previous label (`update.log.undo_args`). Not offered when the slot had no
label (the backend cannot clear one) or when the previous label held a secret (it would be kept in the state file). A label already as given
writes nothing and has no undo.

Tests: the write and its two requests, the undo from the log (the stored labels compared, `expectUndoRestores`), a slot with no label, the
unchanged label, a secret label, the default scenario from the state and `missing_argument`, `not_found` for a slot and a scenario, arguments
outside the catalog, the Polish view, the sentinel case.
