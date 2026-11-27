# functional: save_test_types — contract

Tool: `functional_save_test_types` (module `functional`, `moduleTool` on a consent card; write, level 2; text view and `format: "data"`; the
description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`).
Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

- Two modes, never both: `source` (`custom`, `catalog`, `suggestions`) with `items`, an addition; or `test_type_id` with `fields`, a change of
  one test type of the project. The project is the bound one.
- `items`: an object, 1 to 50 entries (counted by the tool). Key: the name of a new test type (`custom`, `suggestions`) or the id of a catalog
  test type (`catalog`, value `{}`). Value: the fields: `category`, `display_name`, `description`, `input_prompt`, `example_inputs`,
  `expected_outcome`, `default_count`, `priority`, `poll_completion_values`, `poll_timeout_ms`; suggestions take the same without the two poll
  fields and need `category`, `display_name`, `description`, `input_prompt`. A change also takes `name` and `is_enabled`.
- The tool writes the fields under the backend's names (`custom_name`, `custom_category`, ..., `input_prompt` is `custom_input_prompt` or, for a
  suggestion, `input_generation_prompt`). Default `default_count` 3, `priority` the highest of the project plus the position.
- Rules (`invalid_arguments`, before any request): `test_types_one_mode`, `test_types_field_unknown`, `test_types_items_count`,
  `test_types_catalog_ids`, `test_types_suggestion_needs`, `test_types_nothing`.
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only): an addition of catalog entries reads `GET /base-test-types` (their names); a change reads
`GET /projects/{id}/test-types/{id}` (unknown is `not_found`). Nothing differs: `unchanged`, no card.
After the person's yes: `custom` is `POST /projects/{id}/test-types` per item; `catalog` is one `POST .../test-types/bulk` (those the project
has are skipped and counted); `suggestions` is `POST .../test-types/suggest/accept` per item; a change reads the test type again and sends `PUT`
with only the fields that differ. An addition also reads `GET /projects/{id}/test-types` for the priority.

## The card

Facts (hashed): `mode`, `n` (the count, the slot of the log), for an addition `source` and the items (at most 20: name, fields as masked short
values or sizes), for a change the test type now (`name`, `test_type_id`) and the fields that differ. Long values are only counted.

## format=data (the result)

`mode`, `saved` (id and name, at most 20), `count`, `skipped`, `changed`, `not_undoable`, `undo` (`kept`, `partial`, `none`, `withheld`,
`one_by_one`). Names pass `content()`.

## Log and undo

args `Save {n} test types in the project`, result `{count} test types saved`; call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. Undo: exactly one test type added -> `functional_delete` (`kind: test_type`, `item_id`); several -> none (the
delete takes one target; the view says to delete them one at a time); a change -> this tool with the previous values (a null cannot be put
back: `partial`; a value the secret mask would change, or over 20000 characters, is not kept).

## State

Reads `ids.project_id`; writes nothing.

## Test cases

`test/tools/functional/saveTestTypes.test.ts`: the card (addition, catalog names, change, unchanged, Polish), the yes for each source (the
POSTs, priorities, the bulk skip, the backend names), the undo (one added, a change run through its own card), no/declined/cancelled, other
arguments, no confirming argument, a client without elicitation, every rule, unknown, secrets. Sentinel cases in `canary.ts`; every
operation in `coverage.test.ts`.
