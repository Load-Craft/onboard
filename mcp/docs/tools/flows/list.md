# flows_list — contract

Tool: `flows_list` (module `flows`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and `format: "data"`;
the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool).

## Arguments (exactly the catalog's)

- `query?`: 1–100 characters; only flows whose name contains the text, any case. The filter is the tool's: the backend has none.
- `limit?`: 1–200, default 50; how many flows to return.

The project is the bound one (`projectIdOf`, else `no_project`). An unknown argument is refused (strict schema).

## Operations

`GET /projects/{id}/flows`, once. The backend lists the most recently updated first and returns at most 100: without `query` the
tool asks for `min(limit, 100)`, with `query` for 100 and filters what came back. `total` is the number of flows of the project.

## format=data

`project_id`, `total` (flows of the project), `fetched` (flows read), `count` (flows that match `query`; all fetched ones without
it), `shown` (at most `limit`), `flows[]`: `id`, `name`, `flow_type`, `version`, `steps`, `needs_input`, `needs_input_definite`,
`is_active`, `spec_status` (`current` | `outdated` | `unpinned` | null), `updated_at`. Names pass `content()`; descriptions are
not read.

## Text view

```
3 flows:
1. browse (api) v1, 5 steps
2. checkout (api) v2, 9 steps, open questions: 2 (1 definite)
3. account (frontend) v1, 4 steps, inactive
```

A project with more flows than were read adds `the project has 140 flows; the 100 most recently updated were read`.

## State

Writes the warning `flows_need_input` of `problems` (one warning with the flows that carry open questions and how many are
definite), as `flows_get` does for one flow: a read of the whole list replaces the warning, a read of part of it (the list was cut
by the backend's maximum) changes only the flows it read. It reads the flows it fetched, whatever `query` shows.

## UI

Text only: the project card of the mod already lists flows; this is the model's read.

## Test cases

- Ordinary: the sample project's flows, `query`, `limit`, `format: "data"`, Polish view, log entry, one request.
- Edge: no flows, no match, 120 flows (the backend gives 100), `query` with other letter case, a name with control sequences,
  unknown project, no bound project, `limit` outside 1–200, unknown argument.
- Adversary: sentinel in names and descriptions; instruction in a name; level 1, so it is offered.

## Out of scope

One flow in detail (`flows_get`), versions (`flows_get_versions`).
