# Long operations in module tools

A tool of `kind: process` in the catalog starts work that outlives one call (a generation, a check, a run).
It uses the mechanism the older tools use; this page names its parts and the block that joins them to
`moduleTool` (`src/tools/kit/operation.ts`). Recipe for one tool: `docs/recipe/templates/long-operation.md`.

## What exists (reused, not copied)

| Need                                     | Where                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| one definition per kind of operation     | `defineOperationKind` (`src/ops/operation.ts`)                                                           |
| start, or join the same work still going | `startOrJoin`, `awaitOperation` (same file)                                                              |
| handle `<kind>:<id>`, the list of kinds  | `encodeHandle`, `OPERATION_KINDS`; `ALL_OPERATION_KINDS` (`operationKinds.ts`)                           |
| continue by handle, also after a restart | `process_wait` (`resumeOperation`); the entry is in `state.json`                                         |
| stop                                     | `process_cancel` calls `cancel` of the kind, only after the user says so                                 |
| progress while a call waits              | `describe` of the kind; the registry sends it as MCP progress and writes the bar (`ops/liveProgress.ts`) |
| the row of the operation                 | `operations[]` of the process, written by `awaitOperation` (not by the tool)                             |

## A kind

`defineOperationKind({ kind, saved, initial, channel?, recover, isTerminal, describe, finish, view, cancel? })`:

- `saved` (zod): what must survive a restart to follow the operation (ids, the start time). No secret, no text of a third party.
- `channel`: the WebSocket frames folded by `reduce`; `recover` rebuilds the state through REST when the channel is lost or
  the operation is resumed later, so a kind always has a REST way (`recoverIsRead: true` when it only reads).
- `describe(state, t)`: the progress line and the fraction; `finish` returns the `DoneOutcome` (data, `update` of the
  process, links); `view` draws the finished data and is also what `process_wait` draws.
- the cancel method (optional): called only by `process_cancel`; `true` stopped, `'stopping'` accepted, `false` not running. A kind with a channel
  can instead set `channel.cancelMessage`: it is sent on a fresh connection and counts as `'stopping'`.
- `channel.connectFirst(id)`: for a channel that sends nothing on connect and replays nothing. `startOrJoin` chooses the id first
  (`plan.newId`), connects, starts the work with that id (`plan.start(chosen)`), and the wait follows the same connection. Keep the
  session id of the backend derived from the id, not saved: a field called `session_id` is a secret to the plugin.
- A new kind goes into `OPERATION_KINDS` and `OPERATION_MODULE` (`src/workspace/migrate.ts`) and `ALL_OPERATION_KINDS`; a test
  reads the source and fails while one is missing. The state schema already lists the kinds; this page changes none.

## The block for a module tool

```ts
startOperation(ctx, kind, { matches, start }, { maxWaitS }); // → ToolOutcome<D>
operationId(ctx, ...parts); // id of one call: a hash of the parts and the clock
maxWaitInput(what); // zod for `max_wait_s`, only when the catalog entry lists the argument
```

- `matches(saved)`: the same work is still going (same project, same scenario, same reference): the call goes on with it
  and returns the same handle, so a model that calls the tool again instead of `process_wait` pays once.
- `start()`: sends the write that starts the work and returns `{ id, saved }`. It runs once, after the person's yes.
- One call waits at most 100 s (`MAX_CALL_WAIT_S`); at the limit the result is `running` with the handle, and the model calls
  `process_wait`. A client abort (Esc) ends the wait, never the operation.
- The view of the tool is the view of the kind: `render: kind.spec.view` (`renderOperation(kind)`), so the tool and
  `process_wait` print the same text.

## With the consent card

A tool of level 2 or 3 is written on `moduleTool(META, { card, cardView, run, render })` (`docs/consent-card.md`). Call 1 reads and
makes the card, nothing starts. After the person's yes `run(ctx, args, facts)` is
`startOperation(ctx, kind, plan, { maxWaitS })`, so the write that starts the work happens exactly once, after the yes. `facts`
hold what the card showed; `start()` re-reads what the write needs and refuses when it differs from `facts`.
`process_wait` and `process_cancel` need no card for waiting; stopping work that costs money or load is the user's word.

## Rules

1. No second mechanism: no polling loop, no timer, no file of its own in a tool.
2. The tool never writes the process: `update` of the outcome (checks, ids, problems) is the way; the row of the operation is the registry's.
3. Progress and `saved` carry no secret and no raw text of the backend: names pass `content` (`docs/recipe/mask.md`).
4. The error of a failed operation is thrown by `finish` as a `ToolError` (a code of the module with a hint); a cancelled or
   lost operation is the registry's (`operation_lost`, the cancelled outcome).
5. Tests: the kind through the fake backend (`test/fake-backend/ws.ts` for the channel), the card, a restart (a new server on the
   same workspace calls `process_wait`), `process_cancel`, a sentinel in every progress line (`test/tools/kit/operation.test.ts`).
