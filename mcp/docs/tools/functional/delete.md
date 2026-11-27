# functional: delete — contract

Tool: `functional_delete` (module `functional`, `moduleTool` on a consent card; destructive, level 3, reason `delete`; text view and
`format: "data"`; the description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`;
`anthropic/requiresUserInteraction`). Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

- `kind`: `flow`, `template`, `test_type`, `validator`, `run`, `catalog_test_type`, `catalog_validator`, `catalog_assertion_type`, required.
- `item_id`: UUID, required: one item per call (a level-3 card takes one target, never a list). The project of `test_type`, `validator` and `run`
  is the bound one (else `no_project`); flows, templates and the three catalogs are global.
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only): `GET /test-flows/{id}`, `GET /test-templates/{id}`, `GET /projects/{id}/test-types/{id}`,
`GET /projects/{id}/validators/{id}`, `GET /projects/{id}/executions/{id}` (a run), `GET /base-test-types/{id}`, `GET /base-validators/{id}`,
`GET /assertion-types/{id}` (unknown is `not_found`). A run that is not `completed`, `failed` or `cancelled` is `delete_busy`, before any
question. After the person's yes: the `DELETE` of that kind (`/test-flows/{id}`, `/test-templates/{id}`, `/projects/{id}/test-types/{id}`,
`/projects/{id}/validators/{id}`, `/projects/{id}/executions/{id}`, `/base-test-types/{id}`, `/base-validators/{id}`, `/assertion-types/{id}`).

## The card

Facts (hashed): `kind`, `names` (masked), `item_id`, and by kind `version` and `blocks` (a flow), `status` (a run), `builtin` (a catalog entry).
Lines: the item with its id, the facts, what goes (a flow with its saved versions; a run with its results; a project's test type or validator
leaves that project; a catalog entry leaves the shared catalog, so every project). No cost line; level 3 `delete`.

## format=data (the result)

`kind`, `item_id`, `names`, `count` (1).

## Log and undo

args `Delete {kind}: {names}`, result `{count} {kind} deleted`; call 1 is `queued`, the one that ran carries `consent.via: client_dialog`. No undo
(`reversible: no`). The tools that create items (`functional_save_flow`, `functional_save_template`, `functional_save_catalog`,
`functional_save_test_types`, `functional_save_validators`) name this tool as the undo of a new item, with `kind` and `item_id`.

## State

Reads `ids.project_id` (for the project's kinds). Writes: unsets `ids.functional_run_id` when the run deleted is the one of the state.

## Test cases

`test/tools/functional/delete.test.ts`: the card of a flow and of every other kind, Polish, the yes (one DELETE, the backend compared, the
entry with no undo, a second call `not_found`), every kind sends its own DELETE, the run of the state dropped, no/declined/cancelled, another
item or kind, no confirming argument, a client without elicitation, unknown for every kind, a run still going (`delete_busy`), arguments
outside the catalog, secrets. Sentinel cases in `canary.ts`; every operation in `coverage.test.ts`.
