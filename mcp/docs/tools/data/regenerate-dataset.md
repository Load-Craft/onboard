# data: regenerate_dataset — contract

Tool: `data_regenerate_dataset` (module `data`, `moduleTool` on a consent card; costly, level 2; text view and `format: "data"`; the
description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`).
Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

- `dataset_id?`: a UUID, default the only dataset the state of the workspace knows, else `missing_argument`.
- `mode`: `expand` or `reroll`, required. `rows?`: integer 1-100000.
- Rule `regenerate_expand_needs_rows`: `mode=expand` without `rows` is `invalid_arguments`, before any request. Rule
  `regenerate_expand_above_current`: `rows` not above the dataset's current count is refused at the card (the backend would answer 400).
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only): `GET …/gatling/feeders/{id}`. No saved recipe (`has_recipe` false) is
`data_regenerate_no_recipe`. After the person's yes: `POST …/feeders/{id}/expand` with `{target_rows}` (expand) or `POST …/regenerate`
with `{rows}` or `{}` (reroll: the count stays). The backend keeps the rows that were as an earlier revision.

## The card

Facts (hashed, no cell): `dataset_id`, `name`, `mode`, `rows_now`, `rows_after`, `recipe` (`column: generator`, at most 20), `recipe_count`.
Lines: what the mode does with the counts, the recipe. Cost line (the catalog names a cost): the generators run for the rows, a column made
by a model calls the LLM. Undo line: `data_restore_dataset`. A change of the dataset (its count) after the card is a new card.

## format=data (the result)

`dataset_id`, `name`, `mode`, `rows_before`, `rows` (after, as the backend counts), `columns` (20), `columnCount`. Texts pass `content()`.

## Log and undo

args `Regenerate rows of dataset {name}`, result `dataset {name}: {rows} rows`; the entry of call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. Undo: `data_restore_dataset` with the dataset (`update.log.undo_args`); a second call of the restore switches back.

## State

Reads `ids.project_id`, `ids.dataset_ids`. Writes nothing (the catalog's `state_writes` are not used by this layer).

## Test cases

`test/tools/data/regenerateDataset.test.ts`: the card with the cost line (expand, reroll, Polish), the yes (one POST, the body, the entry),
the undo run for real, no/declined/cancelled, other arguments, a changed dataset, no confirming argument, a client without elicitation,
the two rules, no recipe, the default dataset, unknown, arguments outside the catalog, secrets. Sentinel cases in `test/tools/data/canary.ts`.
