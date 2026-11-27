# scenario_get_templates - contract

Tool: `scenario_get_templates` (module `scenario`; level 1, class read; text view and `format: "data"`).
Template: LIST_OR_OBJECT. Matches the catalog: yes (catalog 1ac8b8d2).

## Arguments

- `template`: string, optional, default none. One template with its scenarios and data files (id or name); without it, the list.
- `include`: string[], optional, default none. `"draft"`: its composition config for this project, nothing saved (with `template` only).
- Rules: `include` without `template` gives `[invalid_arguments]` (`get_templates_only_with`).

## Operations

1. `GET /api/v1/templates`: main for the list; for a name in one-object mode, the resolver.
2. `GET /api/v1/templates/{template_id}`: main read in one-object mode.
3. `POST /api/v1/projects/{project_id}/gatling/templates/{template_id}/instantiate`: auxiliary, `include: "draft"`, no body; saves nothing.

## format=data

| Field        | From                                        | Origin class |
| ------------ | ------------------------------------------- | ------------ |
| `mode`       | `list` or `one`                             | word         |
| `project_id` | bound project                               | bound id     |
| `templates`  | `templates` (page, limit 50)                | list         |
| `template`   | `detail` (one)                              | object       |
| `draft`      | `composition` of the POST (include `draft`) | part         |

`draft.value.load.sudden` is true when all the users start without a ramp (`type` other than `ramp`) and there are 100 or more of them; the view then adds one warning sentence under the load line. It does not look at the environment the composition will run against.

A list field is its `Page`: under `format: "data"` it shows `count`, `shown`, `fetched`, `total`, `query` and `items`.

## Text view

```
2 scenario templates:
1. "API Stress Test" [api-stress-test] stress, beginner, scenarios: 1
   about: Ramp a single endpoint to failure.
2. "Soak Test" [soak-test] endurance, intermediate, scenarios: 2
   about: Low-rate long-duration endurance test.
```

Mode one (`template: 'soak-test', include: ['draft']`):

```
Template "Soak Test" [soak-test]: endurance, intermediate
about: Low-rate long-duration endurance test.
tags: soak, endurance
Scenarios (2):
1. "SteadyStateReadScenario" needs: none; gives: none
   about: Steady-state read workload.
2. "SteadyStateWriteScenario" needs: authToken; gives: resourceId
Data files (1):
1. "users.csv" columns: username, password
Draft composition:
  name: "Soak Test (4h)"
  load: constant, 20 users, 14400 s
  mix: "SteadyStateReadScenario" 1, "SteadyStateWriteScenario" 0.15
  The mix weights split the traffic between the scenarios (each virtual user runs one of them, in proportion); they are not an order and pass no value from one scenario to the next: a scenario that needs a value another one produces gets it from its own data.
  thresholds: max_error_rate_pct 0.1, max_p95_ms 1000
```

## Log

args `{template}`, result `{count} templates`; values the tool gives: `count`.

## State

Reads: ids.project_id (for information only). Writes: nothing.

## Undo

Not a write.

## UI

Text only.

## Test cases

LIST_OR_OBJECT, from `docs/recipe/templates/tests.md`, section 2:

- Every template: full answer and requests; `format: "data"`; no project (`[no_project]`); masked one-line text; Polish view; log entry.
- LIST: the empty answer; the cut (51 seeded, shows 50).
- OBJECT: unknown id gives `[not_found]`; `include` not asked (no POST); 404 on the POST gives `none`; 500 gives `unavailable`; `include` without `template` gives `[invalid_arguments]` with no request.
- LIST_OR_OBJECT selector: name in another letter case reads `soak-test`; name matching nothing gives `[not_found]`; name matching two gives `[ambiguous]`.
- Sentinel cases: `{}`, `{ format: 'data' }`, `{ template: 'soak-test' }`, `{ template: 'soak-test', include: ['draft'] }`.
