# Evaluation fixtures

Synthetic repositories for exercising the plugin by hand and in evaluations. They contain only
neutral data (`example.com`, `/api/orders`, `sklep`, `user@example.com`); secrets appear only as the
sentinel the sentinel `CANARY-SECRET-7f3a`.

| Fixture | What it is |
|---|---|
| [`sklep/`](sklep/README.md) | a small shop API with a planted checkout defect, API description, environments, logs server and a HAR recording |

A fixture is plain files, not a git repository: `sklep/init-fixture.sh <dir>` copies it and builds
the history.

## Stand-alone fake backend

`mcp/` has a fake LoadCraft backend that runs as a process, so the plugin can be exercised without
the real product:

```bash
cd mcp
npm run fake -- --stage empty --port 8787
```

It prints the address and the test token on stderr. The world is the `sklep` session at the given
stage (`empty`, `project`, `flows`, `scenario`, `data`, `executed`); the clock runs x60 (`--speed`
changes it). Point the plugin at it with `LOADCRAFT_API_URL=http://127.0.0.1:8787` and the printed
token. Development only; it is not part of `mcp/dist`.

From `--stage empty` it carries a whole session (steps 1 to 8) on any API documentation, not only
the `sklep` world's:

- the journeys `flows_suggest_journeys` proposes come from the uploaded `loadcraft/openapi.json` when it
  is not the `sklep` world's document (browsing, a cart or order change, the account; named after
  the tags, else the paths), deterministically and without a model; the fixture's own document is
  handled this way;
- a scenario that logs in reads accounts and its self-check waits for data until
  `data_create_accounts` creates them (through the document's own register or sign-up operation,
  in a dataset named after the slot); the check then runs the requests of the scenario's own flow;
- a started test runs for the ramp and hold of its profile on the fake clock, and its report and
  diagnosis name the operations of the document.

### The verdict of a test: `--run`

```bash
npm run fake -- --stage empty --run pass   # or fail; none is the default
```

A test started with `run_start` goes the same way in every mode (building, then load as long as the
profile, then a stored, completed run); `--run` decides what its numbers say about the thresholds
sent with `run_start`:

- `none` (default): the world's own numbers. The slowest request is slow and ends with 503, so a
  tight threshold fails and a loose one passes with errors noted.
- `pass`: no request errors and every p95 below the threshold. `results_get_report` reads SLA PASSED, and
  `process_get_status` leaves the diagnosis out.
- `fail`: the slowest request goes over the p95 threshold and the errors over the error threshold.
  `results_get_report` reads SLA FAILED and `results_analyze_run` names the cause (the slowest request).

Without thresholds in `run_start`, `pass` and `fail` judge against p95 500 ms and 1 % failed. It
works on the `sklep` world and on any uploaded documentation. Any other value is refused at start.
