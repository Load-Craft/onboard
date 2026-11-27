# flows_save — contract

Tool: `flows_save` (module `flows`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`). A
direct edit, on the user's request; the copilot is the normal way to change a flow. Matches the catalog: yes (version 60292a59).

## Arguments (exactly the catalog's)

- `flow_id?`: 1–200 characters, the flow by id or name. **No default from the state**: without it a new flow is created.
- `name?`: 1–255; required for a new flow. `description?`: 1–2000.
- `graph?`: object `{blocks, edges, entry_block_id}`: a new flow's graph, or the whole graph of an existing flow (a full
  replacement). `variables` and any other key are refused: the variables of a flow are secrets by name and are never written
  by this tool.
- `drop_steps?`: a string of step numbers as `flows_get` numbers them, comma-separated (`"14,15"`), at most 50 numbers, 1–300
  characters; only with `flow_id`, not with `graph`.
- `reason?`: 1–300; why the graph changes; kept on the new version; only with `graph` or `drop_steps` and `flow_id`.

Refused as `invalid` with no request: `graph` with `drop_steps`; `drop_steps` or `reason` without `flow_id`; `reason` without a graph
change; no `flow_id` and no `name`; a `flow_id` with nothing to change; a `graph` without `blocks` and `edges` or with a key outside
the three; a `drop_steps` that is not step numbers or names more than 50.

## Operations

| call          | requests, in order                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| new flow      | `POST /projects/{id}/flows`                                                                                                                       |
| existing flow | `GET …/flows` (only to find the flow by name), `GET …/flows/{id}` (the flow as it is: version, name, description, graph), then `PUT …/flows/{id}` |

The read before an update is how the way back is known (the version and the values before) and what `drop_steps` works on. A
call that would change nothing sends no PUT. The backend lints the graph and refuses a bad one (422): its text is shown.

## drop_steps

The tool reads the flow, takes the named top-level steps out of the graph (`flow/dropSteps.ts`), stitches the edges across
what went, moves the entry if it was dropped, drops the validators bound to a dropped request, and sends the blocks that stay
exactly as they were stored. The model never sees a block, so no value of a header or a body goes through it. Refused as
`flows_save_step_not_droppable` (with the number): a number the flow's outline does not have, a step inside a group or a
branch, a group or a condition itself, a step with two ways on, and a call that would leave the flow with no step.

## Secrets

`graph` is checked before anything is sent: a literal that is a value of a secret field (a header, a body field or a variable
named like a token, a password, a key) or that has the shape of a credential refuses the call as `flows_save_secret_in_graph`
(no request). References (`#{token}`, `{{token}}`) are fine. `variables` of a flow are never read: not into the data, the
view, the log or the state; the flow comes back through `callBackend`, which registers them.

## format=data

`project_id`, `flow` (`id`), `name` (the flow's, as the log entry's `{name}`), `version` (the flow's version after the call),
`previous_version` (null for a new flow), `created`, `changed` (`name`, `description`, `graph`), `renamed_from`, `steps` (the
outline's step count after), `dropped[]` (`num`, `name`). Names and the reason pass `content()`.

## Text view

```
Flow "signup" saved as v4 (was v3): dropped step 6 (Pause), 7 (GET /done). Reason: the last two steps are not part of the signup.
```

A new flow: `Flow "signup" created: v1, 5 steps.` A rename: `Flow "signup" renamed (was "register").` Nothing to change: `Flow
"signup" already says that; nothing changed.`

## State

A new flow is added to `ids.flow_ids`; the flow is built (`steps.flows.flows_built`); the warning `flows_need_input` follows
the open questions of the flow as the backend returns them. The log carries `flow_id`.

## Undo

One way is recorded per call, the first that fits: a new flow: `flows_delete` (kind flow, the id); a change of the graph:
`flows_restore_version` with the version before (a rename or description made in the same call stays: it makes no version);
only a name or a description: `flows_save` with the previous values (a description that was empty is not sent back).

## UI

Text only.

## Test cases

- Ordinary: create a flow, rename, describe, replace the graph, drop the last two steps, drop a step in the middle, the log
  entry with its undo, the state, `format: "data"`, Polish view.
- Edge: every refusal above, a name that does not change, an unknown flow, a 422 of the backend, a flow found by name.
- Adversary: a secret in a block header, in a body field and by shape (refused, nothing sent), `variables` in `graph`, a name with
  control sequences, a secret in the reason, variables of the flow in the answer (never shown).

## Out of scope

Variables of a flow, tags, timeouts and `is_active`; the copilot (`flows_ask_copilot`); restoring a version (`flows_restore_version`).
