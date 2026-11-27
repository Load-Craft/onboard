# flows_get_copilot_history — contract

Tool: `flows_get_copilot_history` (module `flows`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added with `flows_list`).

## Arguments (exactly the catalog's)

- `flow_id?`: 1–200 characters, the flow by id or name; default the only flow of the workspace (`ids.flow_ids`); none or
  several: `missing_argument`, no request.
- `suggestions?`: boolean, default false: true shows the open suggestions of the copilot instead of the conversation.
- `limit?`: 1–50, default 20: how many of the latest turns of the conversation. Ignored with `suggestions`.

The project is the bound one (`projectIdOf`, else `ids.project_id`, else `no_project`). An unknown argument is refused.

## Operations

| call          | requests, in order                                                                           |
| ------------- | -------------------------------------------------------------------------------------------- |
| conversation  | `GET /projects/{id}/flows` (only to find the flow by name), `…/flows/{flow}/copilot/history` |
| `suggestions` | the same lookup, then `…/flows/{flow}/copilot/suggestions`                                   |

An unknown flow is `not_found`. A flow nobody talked about has an empty conversation (the backend does not fail). The backend
returns the whole conversation; the tool keeps the latest `limit` turns.

## format=data

Conversation: `mode: "history"`, `project_id`, `flow` (`id`, `name`), `count` (turns the conversation has), `shown`, `turns`
(the same as `shown`), `messages[]`: `role`, `kind`, `content`, `changes[]` (`type`, `description`, `status`,
`target_block_id`; at most 10 each).
Suggestions: `mode: "suggestions"`, `count`, `shown`, `suggestions[]` (`target_block_id`, `text`; the backend gives at most 3).

**Not read:** the bodies of the proposed blocks, the values before and after a change and the computed values: only what the
change is and whether it was applied. **Third party:** the texts of the conversation (the user's and the model's) and the
descriptions of the changes pass `content()`; roles and statuses too.

## Text view

```
Copilot conversation about "checkout" (4 turns):
user: Add a pause after the login
assistant: I would add a pause of 3-8 seconds after the login.
  proposed: add — Pause after the login [applied]
```

Suggestions: `Copilot suggestions for "checkout" (2):` and `1. Add a validator to the payment (block b7)` per line. A flow the
copilot did not talk about: one line saying so.

## State

None. The log carries `flow_id` (as given) and `turns` (the turns shown; 0 for suggestions).

## UI

Text only.

## Test cases

- Ordinary: the conversation, `limit`, the suggestions, the only flow of the workspace, `format: "data"`, Polish view, log entry.
- Edge: an empty conversation, no suggestions, 30 turns (20 shown), a flow found by name, an unknown flow, `limit` out of 1–50,
  an unknown argument, a turn with control sequences.
- Adversary: sentinel in a message, a change description and a suggestion; instruction in a message; a block body with a
  secret in a proposed change (never read).

## Out of scope

Talking to the copilot and applying its changes (`flows_apply_copilot_changes`).
