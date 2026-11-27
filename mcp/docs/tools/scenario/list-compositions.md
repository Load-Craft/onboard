# scenario_list_compositions — contract

Tool: `scenario_list_compositions` (module `scenario`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool).

## Arguments (exactly the catalog's)

- `status?`: 1–40 characters, passed to the backend as the filter of the list (`draft`, `ready`, `archived`).
- `limit?`: 1–200, default 50.

The project is the one of the workspace (`projectIdOf`). An unknown argument is refused (strict schema).

## Operations

`GET /projects/{project_id}/gatling/compositions?limit=<limit>[&status=<status>]` — one request. The backend counts `total`.

## format=data

`project_id`, `status` (the filter, null for all), `count` (the project's compositions, of that status), `shown`,
`compositions[]`: `id`, `name`, `status`, `members`, `enabled_members`, `has_drift` (a member's scenario changed since the
composition pinned it), `valid` (the stored verdict of the last check, null when the answer has none), `updated_at`.

**Third party:** every name goes through `content()`. The members' artifacts, contracts, headers and load profiles of the answer
are never read.

## Text view

```
2 compositions:
1. mix [73c1e5a9-…] — ready, 3 members
2. soak [5d3a…] — draft, 2 members, 1 enabled, last check failed, members drifted
```

Zero: one sentence (naming the status when it was asked for). A cut list ends with `showing the first N of M compositions`.

## State

Reads `ids.project_id`; writes nothing. The log carries `{count} compositions`.

## UI

Text only: the model picks a composition from this list; the mod shows the process.

## Test cases

- Ordinary: list, member and check flags, `status`, `limit`, data, Polish view, log entry, one request.
- Edge: none, a project the backend does not know, no bound workspace, a name with control sequences.
- Adversary: sentinel in a name and in a 500 answer, an instruction in a name, argument outside the catalog or out of range refused.

## Out of scope

One composition in detail (`scenario_get_composition`), its checks (`scenario_check_composition`) and its code.
