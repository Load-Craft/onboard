# scenario_list — contract

Tool: `scenario_list` (module `scenario`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool).

## Arguments (exactly the catalog's)

- `limit?`: 1–200, default 50; how many scenarios the tool returns. The project is the one of the workspace
  (`projectIdOf`), never an argument.

An unknown argument is refused (strict schema).

## Operations

`GET /projects/{project_id}/gatling/scenarios?limit=<limit>` — one request. The backend counts `total`; the tool shows what
came back and says how many the project has.

## format=data

`project_id`, `count` (the project's scenarios, as the backend counts them), `shown`, `scenarios[]`: `id`, `name`,
`source_flow_id`, `source_flow_version`, `version` (the scenario's current version), the self-check (`status`, `version`) or
null when it never ran, `generator_state`, `slots` (number of data slots), `updated_at`.

**Third party:** every name goes through `content()`. Nothing else of the answer is read: no artifact, no slot detail.

## Text view

```
2 scenarios:
1. browsing v3 [b7e2d495-0c38-4a61-9d7f-4e1a8c5b3f20]
   from flow 5d3a… v2; self-check: passed
2. shopping v1 [c1d4e5f6-…]
   from flow 9a8b… v1; self-check: passed on v1, the scenario is v2 now
```

A scenario built with an older generator gets a third line (`built with an older generator, rebuild it`). Zero scenarios: one sentence. A cut list ends with `showing the first N of M scenarios`.

## State

Reads `ids.project_id` (through the workspace binding); writes nothing. The log carries the result `{count} scenarios`.

## UI

Text only: the scenarios are shown to the model that picks one; the mod shows the process, not this list.

## Test cases

- Ordinary: list of three, `limit`, `format: "data"`, Polish view, log entry, one request.
- Edge: no scenarios, a project the backend does not know (not_found), no bound workspace (no_project), a stale self-check,
  a name with control sequences and line breaks, more scenarios than `limit`.
- Adversary: sentinel in a name and in the 500 answer, an instruction in a name stays one line of text, an argument outside
  the catalog refused, level 1 so it is offered.

## Out of scope

One scenario in detail (`scenario_get`) and the versions (`scenario_get_versions`).
