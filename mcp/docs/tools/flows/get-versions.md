# flows_get_versions — contract

Tool: `flows_get_versions` (module `flows`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry with `flows_list`).

## Arguments (exactly the catalog's)

- `flow_id?`: 1–200 characters, the flow by id or name; default the only flow of the workspace (`ids.flow_ids`); none or several:
  `missing_argument`, no request.
- `version?`: integer 1–100000. Without it the list of versions (newest first); with it that version as an outline.
- `limit?`: 1–100, default 20: how many versions of the list. Ignored with `version`.

The project is the bound one (`projectIdOf`, else `ids.project_id`, else `no_project`). An unknown argument is refused.

## Operations

| call      | requests, in order                                                                    |
| --------- | ------------------------------------------------------------------------------------- |
| list      | `GET /projects/{id}/flows` (only to find the flow by name), `…/flows/{flow}/versions` |
| `version` | the same lookup, then `…/flows/{flow}/versions/{version}`                             |

An unknown flow or version is `not_found`. The list has no paging; the tool cuts it at `limit`.

## format=data

List: `mode: "list"`, `project_id`, `flow` (`id`, `name`), `count` (versions the flow has), `shown`, `versions[]`: `version`,
`created_at`, `created_by` (a user id), `change_reason`.
One: `mode: "version"`, `flow`, `count: 1`, `version` (the number), `created_at`, `created_by`, `change_reason`, `outline` (as
`flows_get`, built from the snapshot of the version: its blocks, edges and entry block), `questions[]` (the open questions the
version kept).

**Not read:** the auth evidence of the snapshot (it can carry redirect addresses with codes), the derived data, the input
configuration and the variables of the snapshot. **Third party:** names of steps, paths, variables and the reason of a change
pass `content()`; the questions of the generator are read as documentation, as in `flows_get`.

## Text view

```
3 versions of "checkout":
v3 · 2026-11-22 · Pause added after the payment
v2 · 2026-11-21 · Imported from the recording
v1 · 2026-11-20
```

One version: `Version 2 of "checkout" (2026-11-21): Imported from the recording`, then the outline as `flows_get` draws it.

## State

None; the warning `flows_need_input` follows the flow as it is now, not a version. The log carries `flow_id` (as given) and the
data's `count`.

## UI

Text only.

## Test cases

- Ordinary: the list, `limit`, one version, the log entry, the only flow of the workspace, `format: "data"`, Polish view.
- Edge: a flow with no stored version, an unknown version, an unknown flow, 30 versions (20 shown), a change reason with control
  sequences, `version` outside 1–100000, an unknown argument.
- Adversary: sentinel in a step name of the snapshot, in a reason and in the auth evidence (never read); instruction in a reason.

## Out of scope

Restoring a version (a write of M-FLOWS-02).
