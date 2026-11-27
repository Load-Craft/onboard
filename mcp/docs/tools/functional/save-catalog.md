# functional: save_catalog — contract

Tool: `functional_save_catalog` (module `functional`, `moduleTool` on a consent card; write, level 2; text view and `format: "data"`; the
description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`). The catalog is shared by all projects.
Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

- `kind`: `catalog_test_type`, `catalog_validator` or `catalog_assertion_type`, required.
- `entry_id?`: UUID; without it a new entry is created. `name?`: 1-255, for a new entry only. `fields?`: the fields of the kind's create or
  update body (a strict object: the union of the three kinds; a field of another kind is refused).
- Rules (`invalid_arguments`, before any request): `catalog_field_not_of_kind`; `catalog_new_needs` (name and the required fields: test type
  category, display_name, input_generation_prompt; validator activation, category, display_name, group, scope, validator_type; assertion type
  category, display_name); `catalog_name_new_only` (the backend has no rename); `catalog_nothing` (a change with no field).
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only): a change reads the entry, `GET /base-test-types/{id}`, `GET /base-validators/{id}` or
`GET /assertion-types/{id}` (unknown is `not_found`). A new entry reads nothing. Nothing differs: `unchanged`, no card.
After the person's yes: a new entry is `POST /base-test-types`, `/base-validators` or `/assertion-types`; a change reads the entry again and
sends `PUT` of only the fields that differ.

## The card

Facts (hashed): `kind`, `name` (masked), `entry_id`, `created`, `builtin`, `fields` (the fields written: a short plain value as masked text,
anything longer or not text by its size). Lines: new or change, one line per field, "it is a built-in entry". The undo line names the way back.

## format=data (the result)

`kind`, `entry_id`, `name`, `created`, `changed`, `not_undoable`, `undo` (`kept`, `partial`, `none`, `withheld`).

## Log and undo

args `Save catalog entry {name} (shared by all projects)`, result `{kind} {name} saved`; the entry of call 1 is `queued`, the one that ran
carries `consent.via: client_dialog`. Undo: a new entry -> `functional_delete` (`kind`, `item_id`); a change -> this tool with the previous
values of the fields written (a null cannot be put back: `partial`; a value the secret mask would change, or over 20000 characters, is not kept).

## State

Reads `ids.project_id` (through the binding); writes nothing.

## Test cases

`test/tools/functional/saveCatalog.test.ts`: the card (new, change with built-in and long values, unchanged, Polish), the yes (one POST,
the three kinds, a change sending only the differing fields, the undo run through its own card), no/declined/cancelled, other arguments, no
confirming argument, a client without elicitation, every rule, unknown, arguments outside the catalog, secrets. Sentinel cases in
`test/tools/functional/canary.ts`; every operation in `coverage.test.ts`.
