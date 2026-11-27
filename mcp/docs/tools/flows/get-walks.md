# flows_get_walks — contract

Tool: `flows_get_walks` (module `flows`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
A walk is a run of the LoadCraft browser that builds flows from a description. Matches the catalog: yes (arguments added with
`flows_list`).

## Arguments (exactly the catalog's)

- `walk_id?`: 1–100 characters: the walk as its UUID, `record_run:<uuid>` (the handle of the operation) or the short handle
  `r-xxxxxxxx` of a walk of this workspace. Without it the list of your walks. The `ids.walk_id` of the state is not a default
  (the list would be unreachable): it only marks the walk of the workspace.
- `limit?`: 1–50, default 20: how many walks of the list.
- `include?`: `["timeline"]` (at most one), only with `walk_id`: adds the review timeline.

`include` without `walk_id` is refused as `invalid`, no request. An unknown argument is refused (strict schema).

## Operations

| call                  | requests, in order                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| list                  | `GET …/scenario-from-description/runs?status=all&limit=<limit>`                                                                                                                                            |
| `walk_id`             | `GET …/scenario-from-description/runs/{id}`                                                                                                                                                                |
| + `include: timeline` | `GET …/runs/{id}/timeline`, sent with the walk. An auxiliary read: an error of the API (the review session is closed, or the walk is not yours) leaves the walk and marks `timeline_state: "unavailable"`. |

An unknown walk is `not_found`. A short handle is resolved from the walks the workspace knows (`operation_unknown` otherwise).

## format=data

List: `mode: "list"`, `project_id`, `count`, `shown`, `walks[]`: `id`, `handle` (`r-` and the first 8 characters of the id),
`status`, `created_at`, `current_step`, `awaiting_split_approval`, `description` (an excerpt), `selected`.
One: `mode: "walk"`, `count: 1`, `walk`: the list fields plus `title`, `target_host`, `error` (the message of a failure),
`all_paths_failed`, `paths[]` (`path_index`, `name`, `status`, `steps`, `attempts`, `partial`, `failure_reason`, `stop_cause`,
`flow_id`), `flows_saved[]` (`name`, `flow_id`, `version`, `note`); `timeline_state` (`none` | `read` | `unavailable`) and
`timeline`: `review_expires_at`, `plans[]` (`path_index`, `attempt`, `steps`, at most 12 each), `steps[]` (`path_index`,
`attempt`, `step`, `label`, `outcome`, `source`, `failure_code`, `reason`, `still_id`; at most 150), `notes[]` (`id`, `step`,
`text`, `kind`, `path_index`, `attempt`; at most 50), `other_events` (counts by type).

**Third party:** descriptions, names of paths, labels and reasons of steps, failure texts and notes come from the user, the
application and the agent: they pass `content()`. Addresses of pages and the technical error are not read.

## Text view

```
2 walks:
1. r-1a2b3c4d · running · step browser_agent · "Browse the shop and buy a product"
2. r-9f8e7d6c · done · "Log in and open the account"
```

One walk: the title and status, the paths (`1. browse — saved, 6 steps, flow <id>`), the flows saved, and with the timeline the
plan of each attempt, the steps (`path 1 attempt 1 step 3: open the cart — ok`) and the notes.

## State

None. The log carries `walk_id` (as given) and the data's `count`.

## UI

Text only.

## Test cases

- Ordinary: the list, `limit`, one walk with its paths, with the timeline, handles of three kinds, `format: "data"`, Polish view,
  log entry, `selected` from the state.
- Edge: no walks, an unknown walk, a closed review session (timeline unavailable, walk shown), `include` without `walk_id`, 60
  walks (cut), a description with control sequences, a label with a credential.
- Adversary: sentinel in descriptions, labels, reasons and notes; instruction in a note.

## Out of scope

Starting or stopping a walk (`flows_describe_journeys`, `process_cancel`), saving a note (`flows_save_walk_note`), images
(`flows_export_walk_image`).
