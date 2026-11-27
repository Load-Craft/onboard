# scenario_get_versions — contract

Tool: `scenario_get_versions` (module `scenario`; level 1, class read+secret, `readOnlyHint: true`, no card, no undo; text view
and `format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with the first tool of the module). `install_allow`
is false.

## Arguments (exactly the catalog's)

- `scenario_id?`: UUID; default: the only scenario in `ids.scenario_ids` of the state. None or several: `missing_argument`
  naming `scenario_id`, no request.
- `version?`: integer 1–100000. With it the tool shows that version and its stored artifact; without it, the list.

An unknown argument is refused (strict schema).

## Operations

| call      | request                                                               |
| --------- | --------------------------------------------------------------------- |
| list      | `GET /projects/{project_id}/gatling/scenarios/{scenario_id}/versions` |
| `version` | `GET …/versions/{version}` (one request; the list is not read)        |

An unknown scenario or version is a 404 (`not_found`).

## format=data

List: `mode: "list"`, `project_id`, `scenario_id`, `count` (all versions), `shown` (at most the newest 50), `versions[]`
newest first: `version`, `id`, `created_at`, `change_reason`, `has_artifact_snapshot` (false: the backend refuses to restore
it), `cut` (a variant cut after a block), `artifact: null`.
One: `mode: "one"`, `count: 1`, one entry in `versions` (its `has_artifact_snapshot` is true when an artifact was stored) and
`artifact`: `shown` (the masked JSON text, cut at 6000 characters, `truncated`), `hidden` (type and size, when the mask cannot
read the format) or `none` (a version saved before artifacts were kept).

**Secrets and third party:** the reasons of the changes pass `content()`; the stored artifact is a recorded body and passes
`body()` (the same masking as `scenario_get`). The backend keeps it unmasked: it is never shown raw.

Moments are shown as `2026-11-22 10:00` (UTC); the data keeps the ISO instant.

## Text view

```
3 versions of scenario b7e2d495-…, newest first:
v3 (2026-11-22 10:00, variant cut after a block, no artifact snapshot, cannot be restored)
v2 (2026-11-21 10:00) — Think time raised
v1 (2026-11-20 10:00) — Generated from the flow
```

## State

Reads `ids.project_id` and `ids.scenario_ids`; writes nothing. The log carries `{count} versions` (the data's `count`).

## UI

Text only: the model compares versions here; the mod does not show them.

## Test cases

- Ordinary: list newest first with flags, one version with its artifact (one request), data, Polish view, log entry.
- Edge: no versions, 60 versions cut to 50, a version saved before artifacts (none), unknown version and scenario (404), no or
  several scenarios in the state, a version out of range or fractional (refused, no request).
- Adversary: sentinel in a reason and in the artifact (header, password, bearer), 500 quoting a credential, an instruction and
  control sequences in a reason, argument outside the catalog refused.

## Out of scope

Restoring a version (a write) and the scenario's current state (`scenario_get`).
