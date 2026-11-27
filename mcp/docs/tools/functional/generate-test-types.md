# functional: generate_test_types — contract

Tool: `functional_generate_test_types` (module `functional`; kind `process`, level 2, class costly, a consent card; text view and
`format: "data"`; the description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes. Written on the block of a long operation (`docs/long-operation.md`) over the kind `test_types_generation` of
`functional_suggest_test_types` (its contract describes the channel, the REST way and the progress).

## Arguments (exactly the catalog's)

- `include_categories?`: text, at most 300 characters, comma-separated; sent as the list `include_categories` (trimmed, lower case for the match
  on the card, without empties and repeats, at most 20). Default: all categories.

No `max_wait_s`, no `confirm`. The project is the bound one.

## The card

Call 1 reads `GET /base-test-types` and `GET /projects/{id}/test-types` and counts the active base test types (inside the categories asked)
the project lacks: the count and their names (at most 20), the categories, the cost (one LLM run that fills the expected outcome of each type),
the undo (`functional_delete`, one at a time). Nothing is sent. Nothing missing is answered at once (`Test types generated: 0 created, N the
project already had`), no card, no question. The repeat with the same arguments asks the person; only the yes starts the run, once.

## The operation (kind `test_types_generation`, mode `generate`)

`POST /projects/{id}/test-types/generate-async` answers `run_id`. The channel `testTypes` sends the progress (`Generating test types: …`) and the
`complete` frame with `created`, `skipped`, `rationale`, `test_types`; a frame lost with the window of the start is read through
`GET /projects/{id}/test-types/suggest/{run_id}` (`result`). The test types exist in the project when the run ends. The run cannot be stopped.

## format=data

`mode` (`generate`), `count` (= `created`), `created`, `skipped`, `created_types` (`id`, `name`, at most 20), `rationale` (masked), `omitted`;
`suggestions` is empty and `total` 0. **Third party:** names and the rationale pass `content()`.

## Log, state and undo

args `Generate the missing base test types`, result `{count} test types added`; call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. State: the check `steps.functional.test_types` (ok when something was created or the project had them). Undo: exactly
one test type created -> `functional_delete` (`kind: test_type`, `item_id`); several -> none in the log, the view says to delete them one at a time.

## Test cases

`test/tools/functional/generateTestTypes.test.ts`: the card (the missing ones, categories, nothing missing), no/declined/cancelled and
arguments, one run after the yes (the body, the test types created), the check and the undo, progress and Polish, a long run and
`process_wait`, the same work twice, frames lost and a lost channel, `process_cancel`, an error frame, secrets. Sentinel cases in `canary.ts`.
