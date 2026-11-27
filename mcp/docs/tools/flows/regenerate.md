# flows_regenerate — contract

Tool: `flows_regenerate` (module `flows`; level 2, class costly, `kind: process`, `readOnlyHint: false`, `destructiveHint: false`, a consent card with a
cost line; text view and `format: "data"`; description, annotations, card and log templates and undo are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes. Written on the blocks of `docs/consent-card.md` and `docs/long-operation.md`.

## Arguments

- `flow_id?`: string 1–200, id or name; default: the only flow of the workspace (`ids.flow_ids`), else `missing_argument`.
- `description?`: string 1–4000, what the flow should do. Default: the description the flow was generated from, else its description; with neither,
  `missing_argument` (the backend requires one).
- `skip_validators?`: boolean, default `false`: no validators for the new version.
- The model has no argument that confirms (`confirm`, `consent`, `token` are refused). No `max_wait_s` (the catalog entry lists none): one call waits at most 100 s.

## The operation

Reuses the kind `flow_generation` of `fromEndpoints.ts` with `saved.regenerate = {flowId, previousVersion}` (the kinds are fixed by the state schema).

1. Call 1 (the card, reads only): the flow (resolver, `GET …/flows/{id}`). A flow with `can_regenerate: false` is `flows_regenerate_unavailable` before any card.
2. After the yes: the flow again (a version other than the card's is `flows_regenerate_changed`: a second guard, the card itself is made again after the yes and a changed flow is a new card), then `POST …/flows/{id}/regenerate` with
   `{description, skip_validators}`; the answer carries the run. The same flow still being regenerated is joined (`matches`): one request.
3. Progress and the result are read over REST (`GET …/flows/flow-generation/{run_id}/status`): the backend keeps the state of the run, so the call and
   `process_wait` read the same thing. A call that outlasts its 100 s is `running` with the handle `flow_generation:<run_id>`.
4. When the run completes the flow is read back (outline, questions, version). A run that fails, or one whose flow cannot be read, is
   `flows_regenerate_failed` (the backend text is withheld, the flow is as it was); one cancelled in LoadCraft is `flow_generation_cancelled`.
5. The run cannot be stopped from here: the backend takes a stop only over a WebSocket channel this plugin has no support for (`process_cancel` leaves it running).

## The card

Title `Regenerate flow "<name>"`. Lines: a run of the model writes a new version over the current one (version, blocks); the description; no validators when
asked; that a run that fails leaves the flow as it is. Cost: `about one LLM generation` (the catalog's). Undo: `flows_restore_version` puts the version back.

## Progress and result

Progress line: `Regenerating "<name>": <step>…` with the fraction the backend gives. The result is the view of the flow generation with a first line
`flow "<name>" regenerated: v<before> → v<now>` and, after the outline and the questions, the way back. `format=data` is the data of the flow
generation (`built`, `questions`, `failed`, `lead: single`) with `regenerated: {previous_version, version}`. Names go through `content()`.

## Log and undo

Args `Regenerate flow {name}`, result `flow {name} v{version}`; the entry names `consent.via: client_dialog`. Undo: `flows_restore_version` with the flow and
the version it had (`undo_args`, written when the run ends, also through `process_wait`).

## State

The check `steps.flows.flows_built` = ok, the flow's label (`v<n>`), the open items of the flow as the other ways of building write them; the row of the
operation is the mechanism's. A failed run writes no problem of its own.

## Test cases

The card (text, no request, entry `queued`, one card kept); the description and `skip_validators` on the card; Polish; the yes (one request, the body,
the result, entry with the undo, check, no operation left); the description default; no description; the undo run for real; a run longer than the call
(handle, `process_wait` draws the same view); the same flow asked twice (one run); progress by name; a failed run; a cancelled run; `process_cancel`;
`unticked`, `declined`, `cancelled`; other arguments and a changed flow are a new card; `confirm`/`consent`/`token` refused; a client that cannot ask;
a flow with no recorded source; default and unknown flow; arguments outside the catalog; secrets in the name and the description (also two cases in `canary.ts`).
