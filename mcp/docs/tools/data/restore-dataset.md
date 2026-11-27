# data: restore_dataset — contract

Tool: `data_restore_dataset` (module `data`, `moduleTool`; write, level 1, no card; text view and `format: "data"`; the description, the
annotations and the log templates are the catalog's, through `meta.generated.ts`).

Arguments (the catalog's): `dataset_id?` (a UUID; default: the only dataset the state of the workspace knows, else `missing_argument`).
The project is the bound one.

Operation: `POST …/gatling/feeders/{id}/restore-previous` (one request): the backend swaps the dataset's content with its previous
revision and answers the dataset. A dataset with no revision of different content is the backend's conflict (nothing changes); an unknown
dataset is `not_found`.

Data: `dataset_id`, `name`, `rows` (after, as the backend counts), `columns` (at most 20 names) and `columnCount`, `manuallyEdited`. The cells
of the dataset (the answer's `content`) are never read. Names and columns pass `content()`. Log: args `{dataset_id}`, result `{name}:
previous content restored`.

Undo: the same tool with the same dataset (`update.log.undo_args`): a second call switches back to the content that was replaced.

Tests: the restore and its single request, the second call as the undo from the log (the stored content compared, `expectUndoRestores`), the
cells never in the output, the conflict with nothing changed, `not_found`, the default dataset from the state and `missing_argument` for none
or several, masked names, arguments outside the catalog, the Polish view, the sentinel case.
