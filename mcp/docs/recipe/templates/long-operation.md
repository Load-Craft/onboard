# Recipe template LONG-OPERATION

Use it for a tool of `kind: process` (the catalog says so): the work outlives one call. Design: `docs/long-operation.md`. Model: the first
tool written on the block, `scenario_check_drift` (a card, a channel with a REST way, a cancel). A tool of level 1 has no card: skip the card parts.
Out of scope, STOP: a change of the state schema, a change of the mod, a tool that holds a connection of its own.

## Steps

1. Catalog first: the arguments (`max_wait_s` only when the entry lists it), `consent.card`, `state_writes`, `channels`, `operations`. A missing one is
   a message to the catalog owner, never a guess.
2. Contract `docs/tools/<module>/<tool>.md` (template CONTRACT) with the sections: The operation (kind, saved data, channel frames, REST way, cancel),
   The card, Progress, format=data, State, Test cases.
3. The kind, in `src/tools/<module>/<object>.ts` beside the tool: `defineOperationKind` with `saved`, `initial`, `channel` (when the backend has one),
   `recover` (always), `isTerminal`, `describe`, `finish`, `view`, a cancel method (when the backend can stop it). Register the kind in `OPERATION_KINDS`,
   `OPERATION_MODULE` and `ALL_OPERATION_KINDS`.
4. The tool: `moduleTool(META, { title, input, card, cardView, run, render })` with
   `run: (ctx, args, facts) => startOperation(ctx, KIND, { matches, start }, { maxWaitS: args.max_wait_s })` and `render: renderOperation(KIND)`.
   `matches`: same project, same target, same reference. `start`: re-read what the write needs, compare with `facts`, send the write, return
   `{ id: operationId(ctx, 'xx', ...parts), saved }`.
5. Texts: the progress line in `describe` (no secret, names through `thirdParty`), the finished view, the card, both languages.
6. Fake backend: the route that starts the work and the channel frames (`test/fake-backend/ws.ts`), with the answers checked against the contract.

## Tests (`test/tools/<module>/<tool>.test.ts`)

One `it` per line:

1. the catalog entry and `implemented`; call 1 is the card, nothing started; the repeat after the yes starts one operation;
2. progress: the lines of `describe` in order, each with its fraction; the handle in the state (`operations[]`, status running);
3. a result inside the time limit: the view of the kind, the `update` of the process (checks, problems), the row `done`;
4. a result after the limit: `running` with the handle; `process_wait` finishes it and draws the same view as the tool;
5. the same work asked twice while it runs: one operation, the same handle (`matches`), one request that starts the work;
6. an error frame: the code of the module with its hint, the row `failed`; a lost channel: the REST way finishes it;
7. `process_cancel`: `true`, `'stopping'` and not running each have their text; the row `cancelled`;
8. a restart: a new server on the same workspace calls `process_wait` with the handle and gets the result;
9. a sentinel in every progress line, in `saved` and in the state file: never there;
10. arguments outside the catalog refused; the Polish view; the log entry with the slots of the catalog.
