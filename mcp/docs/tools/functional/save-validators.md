# functional: save_validators — contract

Tool: `functional_save_validators` (module `functional`, `moduleTool` on a consent card; write, level 2; text view and `format: "data"`; the
description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`).
Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

- Two modes, never both: `source` (`custom`, `catalog`, `proposals`) with `items`, an addition; or `validator_id` with `fields`, a change of one
  validator of the project. The project is the bound one.
- `items`: an object, 1 to 50 entries (counted by the tool). Key: the name of a new validator (`custom`, `proposals`) or the id of a catalog
  validator (`catalog`, value `{}`). Value: the fields. `custom`: `display_name`, `description`, `ai_prompt`, `parameters`, `validator_type`,
  `default_params`, `scope`, `template`, `priority`. `proposals` (the fields of an accepted proposal of `functional_suggest_validators`):
  `display_name`, `description`, `template`, `default_params`, `rationale`, `scope`, `priority`, the first three required. A change takes `name`,
  `display_name`, `description`, `ai_prompt`, `parameters`, `validator_type`, `default_params`, `priority`, `is_enabled`, `needs_review`.
- The tool writes the fields under the backend's names (`custom_name`, `custom_display_name`, `custom_description`, `custom_ai_prompt`,
  `custom_parameters`, `custom_validator_type`; `rationale` is `auto_config_reason`). `priority` is the highest of the project plus the position.
- Rules (`invalid_arguments`, before any request): `validators_one_mode`, `validators_field_unknown`, `validators_items_count`,
  `validators_catalog_ids`, `validators_proposal_needs`, `validators_nothing`.
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only): an addition of catalog entries reads `GET /base-validators` (their names); a change reads
`GET /projects/{id}/validators/{id}` (unknown is `not_found`). Nothing differs: `unchanged`, no card.
After the person's yes: `custom` and `proposals` are `POST /projects/{id}/validators` per item (the backend has no accept route for validators);
`catalog` is one `POST .../validators/bulk` (those the project has are skipped and counted); a change reads the validator again and sends `PUT`
with only the fields that differ. An addition also reads `GET /projects/{id}/validators` for the priority.

## The card

Facts (hashed): `mode`, `n` (the count, the slot of the log), for an addition `source` and the items (at most 20: name, fields as masked short
values or sizes), for a change the validator now (`name`, `validator_id`) and the fields that differ. Long values are only counted.

## format=data (the result)

`mode`, `saved` (id and name, at most 20), `count`, `skipped`, `changed`, `not_undoable`, `undo` (`kept`, `partial`, `none`, `withheld`,
`one_by_one`). Names pass `content()`.

## Log and undo

args `Save {n} validators in the project`, result `{count} validators saved`; call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. Undo: exactly one validator added -> `functional_delete` (`kind: test_type`, `item_id`); several -> none (the
delete takes one target; the view says to delete them one at a time); a change -> this tool with the previous values (a null cannot be put
back: `partial`; a value the secret mask would change, or over 20000 characters, is not kept).

## State

Reads `ids.project_id`; writes nothing.

## Test cases

`test/tools/functional/saveValidators.test.ts`: the card (addition, catalog names, change, unchanged, Polish), the yes for each source (the
POSTs, priorities, the bulk skip, the backend names), the undo (one added, a change run through its own card), no/declined/cancelled, other
arguments, no confirming argument, a client without elicitation, every rule, unknown, secrets. Sentinel cases in `canary.ts`; every
operation in `coverage.test.ts`.
