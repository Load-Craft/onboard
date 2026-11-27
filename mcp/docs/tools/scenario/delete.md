# scenario: delete — contract

Tool: `scenario_delete` (module `scenario`, `moduleTool` on a consent card; destructive, level 3, reason `delete`; text view and
`format: "data"`; the description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`;
`anthropic/requiresUserInteraction`). Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

- `scenario_id?`, `composition_id?`: UUIDs. Exactly one. Neither is rule `delete_at_least_one`, both is rule `delete_one_of`
  (`invalid_arguments`, before any request). No default from the state: a deletion names its target.
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only): a scenario: `GET …/gatling/scenarios/{id}` (the name; unknown is `not_found`),
`GET …/scenarios/{id}/versions` (the number of versions) and `GET …/gatling/compositions` (the compositions that contain it; a page of 200, a
longer list makes them unknown). A composition: `GET …/gatling/compositions/{id}` (the name and the member scenarios). Then the checks of
the deletion cards (`src/tools/delete/checks.ts`): an operation of this workspace still running on the project, or a test of the project
that runs on the object (a scenario also on a composition that holds it, or on any when the compositions are unknown), is `delete_busy`; a
list of runs that cannot be read is `delete_unchecked`. Both are raised before any question.
After the person's yes: `DELETE …/gatling/scenarios/{id}` or `DELETE …/gatling/compositions/{id}` (204). The backend cascades a scenario's
versions, baselines and composition links; runs, datasets and saved runs stay.

## The card

Facts (hashed): `kind`, `names` (masked), `id`, and for a scenario `versions` (or null), `compositions` (names, at most 20, or null) and
`compositions_count`; for a composition `members` (names, at most 20) and `members_count`. Lines: the object with its id, what goes with it,
what leaves or stays, what stays always (runs, datasets, the flow). No cost line (the catalog names none); the undo line says the deletion is
for good; level 3 `delete`.

## format=data (the result)

`kind`, `id`, `names`, `count` (1).

## Log and undo

args `Delete {kind}: {names}`, result `{count} {kind} deleted`; the entry of call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. No undo (`reversible: no`). A composition that is the one of the state is dropped from `ids.composition_id`.

## State

Reads `ids.project_id`. Writes: unsets `ids.composition_id` when the composition deleted is the one of the state (`ids.scenario_ids` has
no per-scenario removal in the update format, so its entry for the scenario stays until the next read of the scenarios).

## Test cases

`test/tools/scenario/delete.test.ts`: the card of a scenario and of a composition, Polish, the yes (one DELETE, the fake backend compared:
scenario, versions, links), a composition deleted alone, no/declined/cancelled, another target, no confirming argument, a client without
elicitation, the rules and no state default, unknown, arguments outside the catalog, busy (scenario, composition), unchecked, secrets.
Sentinel cases in `test/tools/scenario/canary.ts`.
