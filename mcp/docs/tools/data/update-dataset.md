# data: update_dataset — contract

Tool: `data_update_dataset` (module `data`, `moduleTool` on a consent card; write, level 2, level 3 when `file` is given; text view and
`format: "data"`; the description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`).
Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

- `dataset_id?`: a UUID, default the only dataset the state of the workspace knows, else `missing_argument`.
- `name?`: 1-255. `description?`: at most 500; an empty text clears it. `file?`: 1-260, a CSV of the project directory (up to 2 MB).
- Rule `update_dataset_at_least_one`: none of `name`, `description`, `file` is `invalid_arguments`, before any request.
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only, the client refuses a write): `GET …/gatling/feeders/{id}`, the file read through `openAllowed`
(kind `accounts`, a `.csv`). A type that is not csv/tsv/ssv/json is `data_update_kind`. Nothing differs and no file: `unchanged`, no card.
After the person's yes: `GET` again, `PUT …/gatling/feeders/{id}` (the whole document, only when name or description differ; the cells
read are re-sent and never shown), then `PUT …/feeders/{id}/content` (only with `file`; the backend keeps the old rows as a revision, a
shared dataset is cloned and the answer names the clone). The file is read again; a different sha256 than the card showed is
`data_file_changed`.

## The card

Facts (hashed, no cell): `dataset_id`, `name`, `to_name?`, `to_description?`, `file?` = `path`, `size`, `sha256`, `rows`, `columns` (at most
20), `columnCount`. Lines: the rename, the description (or its clearing), the file with rows, size, the first 12 characters of the hash and the
columns. Cost line: the upload with the size (with `file`) or "nothing is uploaded". Level 3 with `file`: escalation `secret_ref`. Secret
cells of columns named like secrets are registered before anything is shown.

## format=data (the result)

`dataset_id`, `name`, `description` (after), `rows`, `columns` (20), `columnCount`, `changed` (`name`, `description`, `rows`), `previous`
(`name`, `description`: the values before), `undo` (`definition`, `rows`, `withheld`, `none`). Texts pass `content()`.

## Log and undo

args `Update dataset {name}`, result `dataset {name} updated`; the entry of call 1 is `queued`, the one that ran carries `consent.via:
client_dialog`. Undo: rows replaced → `data_restore_dataset` with the dataset (a name changed in the same call is not undone); only the
definition → `data_update_dataset` with the previous name and description (a card again). Not kept when a previous text holds a secret.

## State

Reads `ids.project_id`, `ids.dataset_ids`. Writes nothing (the catalog's `state_writes` are not used by this layer).

## Test cases

`test/tools/data/updateDataset.test.ts`: the card (level 2, level 3 with a file, unchanged, Polish), the yes (one PUT, the entry, the undo
run through its own card, rows, both), no/declined/cancelled, other arguments, a changed file, no confirming argument, a client without
elicitation, the rule, the default dataset, unknown, the type, file errors, secrets. Sentinel cases in `test/tools/data/canary.ts`.
