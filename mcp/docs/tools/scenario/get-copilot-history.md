# scenario_get_copilot_history — contract

Tool: `scenario_get_copilot_history` (module `scenario`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view
and `format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with the first tool of the module). `install_allow`
is true.

## Arguments (exactly the catalog's)

- `scenario_id?`: UUID of a scenario: its copilot conversation. Not with `draft_id` (`invalid`, no request).
- `draft_id?`: UUID of a traffic-split planner draft; default: `ids.split_draft_id` of the state. Neither given and none in the
  state: `missing_argument` naming `scenario_id`, the hint points at `scenario_list` (and at `draft_id` for the planner), no request.
- `limit?`: 1–100, default 20: how many of the latest messages the tool returns.

An unknown argument is refused (strict schema).

## Operations

| target        | request                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `scenario_id` | `GET /projects/{project_id}/gatling/scenarios/{scenario_id}/copilot/history` |
| draft         | `GET /projects/{project_id}/scenario-builder/{draft_id}/history`             |

One request. The backend returns the whole conversation; the tool keeps the latest `limit` messages and counts the rest. A
draft without a saved conversation is an empty one, an unknown scenario is a 404 (`not_found`).

## format=data

`source` (`scenario` | `planner`), `project_id`, `target_id`, `count` (messages in the conversation), `shown` (the latest
`limit`), `turns` (messages of the user in the whole conversation), `messages[]` (chronological): `role`, `content` (one line, at
most 600 characters), `kind` (planner), `actions` (scenario copilot: the kinds of the proposed actions, at most 5),
`proposal_entries` (planner: how many flows a proposed split names, null without a proposal), `chips` (planner: how many quick
replies).

**Third party:** every message and role passes `content()`. The bodies of the proposed actions and of the proposed split (flow
changes, class mix, shares) are never read: only their kind and size.

## Text view

```
the latest 3 of 8 messages of the copilot of scenario b7e2d495-…:
6. you: Raise the think time to 5 s
7. assistant: I can rebuild the scenario with longer pauses.
   proposed: adjust_and_regenerate
8. you: Do it
```

## State

Reads `ids.project_id` and `ids.split_draft_id`; writes nothing. The log carries the id of the target and `turns`.

## UI

Text only: the conversation is for the model that continues the work; the mod does not show it.

## Test cases

- Ordinary: a scenario's conversation, a planner draft, the draft of the state, `limit` with numbering of the whole conversation,
  data, Polish view, log entry, one request.
- Edge: both ids, neither id, no saved conversation, unknown scenario (404), limit out of range, malformed id.
- Adversary: sentinel in messages, 500 quoting a credential, an instruction and control sequences in a message, argument outside
  the catalog refused.

## Out of scope

Sending a message and applying what the copilot proposed (writes).
