# data: delete — contract

Tool: `data_delete` (module `data`, `moduleTool` on a consent card; destructive, level 3, reason `delete`; text view and `format: "data"`;
the description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`; `anthropic/requiresUserInteraction`).
Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

- `dataset_id`: UUID, required. No default from the state: a deletion names its target.
- `force`: boolean, default `false`: also delete a dataset that scenarios or compositions still read.
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only): `GET …/gatling/feeders/{id}` (the name and the row count; unknown is `not_found`) and
`GET …/gatling/feeders/{id}/used-in` (the scenarios and compositions that read it; a failed read makes them unknown, said on the card).
A dataset that is read and not forced is `data_dataset_in_use` (names who reads it and says how to go on), before any card.
After the person's yes: `DELETE …/gatling/feeders/{id}` with `force=true` only when forced (200). The rows are never read.

## The card

Facts (hashed): `names` (masked), `id`, `rows`, `force`, `users` (names, at most 20, or null) and `users_count`. Lines: the dataset with its id and
rows, who reads it (none, unknown, or the names), a line when forced, what stays (scenarios, compositions, past runs). No cost line; the undo
line says the deletion is for good; level 3 `delete`.

## format=data (the result)

`id`, `names`, `count` (1), `forced`.

## Log and undo

args `Delete dataset: {names}`, result `{count} datasets deleted`; the entry of call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. No undo (`reversible: no`).

## State

Reads `ids.project_id`. Writes: the dataset leaves `ids.dataset_ids`; the reducer invalidates the data checks.

## Test cases

- The card (full text, nothing sent, entry `queued`, one card kept); forced card naming who reads it; Polish.
- The yes: one DELETE, the fake compared, entry with the consent and no undo, the state forgets the dataset, the card is used.
- Unticked, declined, cancelled; another dataset or force is a new card; no argument confirms; a client that cannot ask.
- Missing id, unknown dataset (`not_found`), arguments outside the catalog; a read dataset refused (`data_dataset_in_use`); unknown users.
- Secret sentinel: a secret in the name masked on the card, the answer and the log (and `test/tools/data/canary.ts`).
- Not covered: refusing while a test runs on a scenario that reads the dataset (the backend's 409 on a read dataset stands).

## Out of scope

Several datasets in one call (one card names one object), restoring a deleted dataset (it is permanent).
