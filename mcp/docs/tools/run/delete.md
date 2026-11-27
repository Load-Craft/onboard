# run: delete — contract

Tool: `run_delete` (module `run`, `moduleTool` on a consent card; destructive, level 3, reason `delete`; text view and `format: "data"`;
the description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`; `anthropic/requiresUserInteraction`).
Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

- `kind`: `run`, `profile` or `saved_run`; required. It says what `item_id` is.
- `item_id`: UUID, required. No default from the state: a deletion names its target.
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only): `GET …/gatling/executions/{id}` (a run: its status, start day and request count; unknown is
`not_found`), `GET …/gatling/configurations/{id}` (a profile: name, users, seconds, default) or `GET …/gatling/saved-runs/{id}` (a saved run: name,
schedule). A run that is pending, building or running is `delete_busy` before any question (the backend refuses it too, with 409).
After the person's yes: `DELETE …/gatling/executions/{id}`, `DELETE …/gatling/configurations/{id}` or `DELETE …/gatling/saved-runs/{id}`.
The bulk route is not used: one card names one object.

## The card

Facts (hashed): `kind` (`run`, `profile`, `saved run`), `names` (masked; a run is its handle), `id`, and per kind `status`, `day`, `requests`
(run), `users`, `seconds`, `is_default` (profile), `cron`, `scheduled` (saved run). Lines: the object with its id and what goes with it, its
size or schedule, what stays. No cost line; the undo line says the deletion is for good; level 3 `delete`.

## format=data (the result)

`kind`, `id`, `names`, `count` (1).

## Log and undo

args `Delete {kind}: {names}`, result `{count} {kind} deleted`; the entry of call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. No undo (`reversible: no`; a profile is made again with `run_save_profile`).

## State

Reads `ids.project_id`. A deleted run that is `ids.run_id` is dropped from it.

## Test cases

- The cards of the three kinds (full text), default profile, a saved run without a schedule, Polish; nothing sent, entry `queued`.
- The yes for each kind: one DELETE, the fake compared, entry with the consent and no undo, the run of the state forgotten (and not another's).
- Unticked, declined, cancelled; another object or kind is a new card; no argument confirms; a client that cannot ask.
- Missing arguments, unknown objects (`not_found`), arguments outside the catalog; a running run (`delete_busy`); a run that started after the card (backend 409).
- Secret sentinel: a secret and a control sequence in a profile name masked (and `test/tools/run/canary.ts`).

## Out of scope

Several objects in one call, cancelling a run, restoring what was deleted.
