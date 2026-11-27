# functional: generate_payloads — contract

Tool: `functional_generate_payloads` (module `functional`; kind `process`, level 2, class costly, a consent card; text view and
`format: "data"`; the description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes. Written on the block of a long operation (`docs/long-operation.md`); like `scenario_export` it saves a ZIP
locally and returns only its path and size.

## Arguments (exactly the catalog's)

- `flow_ids`: an object, 1 to 50 entries; each key a flow id (UUID), each value `{}`.
- `test_types`: an object, 1 to 50 entries; each key a test type id (UUID) of the project, each value the number of cases per flow, an integer 1-20.
  (The two bodies fields `test_type_ids` and `test_counts` of the backend are one argument here.)
- `file?`: 1-260 characters: where to save the ZIP, a relative path inside the project directory that ends in `.zip`, without `..`, an absolute or
  drive path, or a hidden part (`functional_payloads_file`). Default: `loadcraft/payloads/payloads-<8 characters of the run>.zip`.
- Rules (`invalid_arguments`, before any read): `payloads_items_count`, `payloads_ids`. No `max_wait_s`, no `confirm`.

## The card

Call 1 reads each flow (`GET /test-flows/{id}`) and test type (`GET /projects/{id}/test-types/{id}`), at most 20 of each for their names (an unknown
one is `not_found` before any question), and sends nothing else: title `Generate payloads for {n} flows`, the flows, the test types with their cases,
the test cases to generate (flows x the sum of the cases), where the ZIP goes (a new file under `loadcraft/payloads/`, or the file given; a taken name
takes the next free one), the cost (one model run per flow and test type), that it only writes a local file. The repeat with the same arguments asks
the person; only the yes starts the run, once.

## The operation (kind `payload_generation`)

- **Start.** `POST /projects/{id}/generate-payloads-async` `{ flow_ids, test_type_ids, test_counts }` answers `run_id`: the id of the operation (handle
  `payload_generation:<run_id>`). Saved in the entry: the project, the file, the counts, the start time.
- **Channel.** `payloadGen` (`/ws/payload-gen/{run_id}`, enveloped `payload-gen:progress`, `:complete`, `:error`); joined once the run has started, nothing
  replayed. Progress: `Generating payloads: preparing | the model is generating | packing the ZIP (n%)`.
- **The ZIP.** `GET /projects/{id}/generate-payloads/{run_id}/download` serves it once (a second fetch, a run still going, a failed one: 404). `finish`
  fetches it after `complete` and saves it at once. The REST way (`recover`) is that same fetch: a 404 is waited for until the run is given up on
  (15 minutes); the bytes are kept in the state and saved by the next step. A ZIP that can no longer be fetched is `functional_payloads_lost`.
- **Saving** (`payloadFile.ts`): the folders are made when missing and each is resolved through its symlinks: inside the workspace only. The bytes go to a
  temporary file and are linked to the name: a taken name (a file, or a symlink, a dangling one too) is never overwritten, the next free name is used
  (`x.zip`, `x-2.zip`, …). `loadcraft/payloads/` gets a `.gitignore` with `*` when it has none. The content is never read.
- **Stop.** None: the channel takes no client frame; `process_cancel` says the run cannot be stopped.

## format=data

`path` (relative to the project directory), `bytes`, `flows`, `test_types`, `cases`. Nothing from inside the ZIP.

## Log, state and undo

args `Generate payloads for {n} flows` (`n` from the card, and from the result: the log value), result `ZIP saved to {path}`; call 1 is `queued`, the one
that ran carries `consent.via: client_dialog`. No undo (`reversible: nothing`: it writes a local file; the view of the card says to delete it by hand).
State: the row of the operation (the mechanism's); nothing else.

## Test cases

`test/tools/functional/generatePayloads.test.ts`: the card (names, cases, target, reads only), a file refused before any read, arguments, an unknown
flow, no/declined/cancelled, one run (the body, the ZIP saved and equal, `.gitignore`), the log, a file named with its folders and taken names and a symlink,
a folder that escapes through a symlink, progress and Polish, a long run and `process_wait`, the same work twice, frames lost, a ZIP no longer fetchable,
`process_cancel`, an error frame, secrets. Sentinel cases in `canary.ts`; both operations in `coverage.test.ts`.
