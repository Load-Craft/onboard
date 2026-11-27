# functional: suggest_test_types — contract

Tool: `functional_suggest_test_types` (module `functional`; kind `process`, level 2, class costly, a consent card; text view and
`format: "data"`; the description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes. Written on the block of a long operation (`docs/long-operation.md`); the kind `test_types_generation` is
shared with `functional_generate_test_types`.

## Arguments (exactly the catalog's)

- `docs_id`: UUID, required (no default from the state). The start takes no docs id: the backend reads the active docs of the project, so a
  `docs_id` that is not the active docs the state knows is refused before any question (rule `suggest_docs_not_active`, `invalid_arguments`).
- `focus_areas?`: text, at most 300 characters, comma-separated; sent as the list `focus_areas` (trimmed, without empties and repeats, at most 20).

No `max_wait_s` (one call waits at most 100 s; `process_wait` goes on). No `confirm`: the model cannot carry consent.

## The card

Call 1 reads nothing and sends nothing: title `Suggest test types from the API docs`, the docs, the focus, the cost line (one LLM run) and
that nothing is saved. The repeat with the same arguments asks the person in the client's dialog; only the yes starts the run, once.

## The operation (kind `test_types_generation`)

- **Start.** `POST /projects/{id}/test-types/suggest-async` answers `run_id`: it is the id of the operation (handle `test_types_generation:<run_id>`).
- **Channel.** `testTypes` (`/ws/test-types/{run_id}`, enveloped frames `test-types:progress`, `test-types:complete`, `test-types:error`). The backend
  sends nothing on connect and replays nothing, and the run id is known only after the start, so the channel is joined once the run has started and a
  frame sent before that is lost.
- **REST way.** `GET /projects/{id}/test-types/suggest/{run_id}` holds the outcome of both modes: `pending` goes on waiting; `completed` is the result;
  `failed` is the code `functional_test_types_failed`. A run not seen to end within 15 minutes counts as lost.
- **Progress.** `Suggesting test types: reading the API docs (15%)`, `…the model is working (55%)`; only the two steps of the backend are drawn.
- **Stop.** None: the channel takes no client frame and the backend has no stop route, so `process_cancel` says the run cannot be stopped.
- **Saved** in the operation entry: the project, the mode, the start time. No text of the result.

## format=data

`mode` (`suggest`), `suggestions` (at most 20: `name`, `display_name`, `category`, `description`, `expected_outcome`, `input_prompt`, `examples`,
`rationale`), `total`, `omitted` (operations of a large API the model was not shown); `created`, `skipped`, `created_types` are 0 or empty.
**Third party:** every name and text passes `content()`. The view ends with how to accept one: `functional_save_test_types` with `source: suggestions`.

## Log and undo

args `Suggest test types from the API docs`, result `{count} test types proposed`; call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. No undo (`reversible: nothing`).

## State

Reads `ids.project_id` and `ids.docs_id`; the row of the operation is the mechanism's; writes nothing else.

## Test cases

`test/tools/functional/suggestTestTypes.test.ts`: the card (cost, focus, no request), the docs rule and arguments, no/declined/cancelled, one run
after the yes, the full view, progress and the log, no suggestions, more than 20, a long run and `process_wait`, the same work asked twice, a
lost channel, frames lost, `process_cancel`, an error frame, secrets. Sentinel cases in `canary.ts`; both operations in `coverage.test.ts`.
