# scenario_compile_composition — contract

Tool: `scenario_compile_composition` (module `scenario`; level 2, class costly, `readOnlyHint: false`, `destructiveHint: false`, a consent card with
a cost line; text view and `format: "data"`; description, annotations, card and log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes. Written on the block of `docs/consent-card.md`.

## Arguments

- `composition_id?`: string 1–200, id or name; default: the composition of the workspace (`ids.composition_id`), else `missing_argument`.
- The model has no argument that confirms (`confirm`, `consent`, `token` are refused).

## Operations

1. Call 1 (the card, reads only): the composition (`GET …/compositions/{id}`).
2. After the yes: `POST …/compositions/{id}/dry-run`: a synchronous Gradle build on the backend of what a run would ship (up to 120 s, nothing stored,
   nothing sent to the target). The call may wait 150 s (`callBackendFor`). A 409 (an enabled member has no modular build, or carries a plan field the
   build refuses) is `scenario_compile_refused`: nothing was built, nothing is recorded.

## The card

Title `Compile composition "<name>"`. Lines: how many members the build takes (enabled, of all); that nothing runs on the target and nothing is stored.
Cost: `a backend build, up to 2 min; no LLM` (the catalog's). Nothing to undo: it only builds.

## format=data

`composition_id`, `name`, `ok`, `kind` (`compiled`, `code_failed`, `environment_failed`, `no_enabled_member`), `duration_s`, `errors` and `warnings`
(at most 5 each, masked; with `error_count` and `warning_count`), `output_lines`. The Gradle output is never read into the data or the view, only its
line count. An error that starts `Build environment failure` is the environment, not the code.

## Log and undo

Args `Compile composition {name}`, result `compiled: {ok}`; the entry names `consent.via: client_dialog`. No undo (builds only).

## State

The check `steps.scenario.compiled` = `ok`. A failed build opens one problem `composition_compile_failed` for the composition (a blocker when the code
failed, a warning when the environment failed or no member was enabled); a build that passes closes it.

## Test cases

The card (text, no build, entry `queued`, one card kept); the composition by name and by state; Polish; the yes (one build, entry, check, no problem);
a failing build (errors masked and cut, output hidden, blocker); a later pass closes the problem; the environment failure; no enabled member; a 409;
`unticked`, `declined`, `cancelled`; other arguments and a changed composition are a new card; `confirm`/`consent`/`token` refused; a client that
cannot ask; unknown composition and arguments outside the catalog; secrets in names and build messages (also two cases in `canary.ts`).
