# data_get_copilot_history — contract

Tool: `data_get_copilot_history` (module `data`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry before this tool).

## Arguments (exactly the catalog's)

- `limit?`: 1–100, default 20: how many of the latest messages the tool returns. The project is the one of the workspace.

An unknown argument is refused (strict schema).

## Operations

`GET /projects/{project_id}/data-hub/history` — one request. The backend returns the whole conversation, oldest first (an
unknown or fresh thread is an empty list); the tool keeps the latest `limit` messages and counts the rest.

## format=data

`project_id`, `count` (messages in the conversation), `shown` (the latest `limit`), `turns` (messages of the user in the whole
conversation), `messages[]` (chronological): `role`, `content` (one line, at most 600 characters), `actions` (the kinds of the
actions the reply proposed, at most 5; null-free), `chips` (how many quick replies).

**Third party:** every message and role passes `content()`. The bodies of the proposed actions (recipes, names, bindings) are
never read: only their kind.

## Text view

```
the latest 3 of 8 messages of the data hub conversation:
6. you: Make 200 accounts for the checkout
7. assistant: I can create a dataset for the account slot.
   proposed: create_dataset, bind
8. you: Do it
```

## State

Reads `ids.project_id`; writes nothing. The log carries `turns`.

## UI

Text only: the conversation is for the model that continues the work; the mod does not show it.

## Test cases

- Ordinary: a conversation with proposed actions, `limit` with numbering of the whole conversation, data, Polish view, log
  entry, one request.
- Edge: no saved conversation, unknown project (not_found), no bound workspace, limit out of range.
- Adversary: sentinel in messages, an instruction and control sequences in a message, argument outside the catalog refused.

## Out of scope

Sending a message and applying what the copilot proposed (writes, cost).
