# flows_export_walk_image — contract

Tool: `flows_export_walk_image` (module `flows`; level 1, class read, `readOnlyHint: false`, `destructiveHint: false`: the
image is saved in the workspace and nothing changes in LoadCraft; no card, no undo; text view and `format: "data"`; the
description, the annotations and the log templates are the catalog's, through `meta.generated.ts`). Matches the catalog: yes
(arguments added with `flows_list`).

## Arguments (exactly the catalog's)

- `walk_id?`: 1–100 characters: the walk as its UUID, `record_run:<uuid>` or the short handle `r-xxxxxxxx`; default the walk of the
  workspace (`ids.walk_id`); none: `missing_argument`.
- `path_index?`: integer 0–10000, with `attempt?` (1–100, default 1): a live snapshot of that path attempt.
- `still_id?`: 1–100 characters of `A-Z a-z 0-9 _ -`: a still of the review timeline (the `still_id` of a step of
  `flows_get_walks` with `include: ["timeline"]`).
- `overwrite?`: boolean, default false.

Exactly one of `path_index` and `still_id`: none or both, `attempt` other than 1 with a still, or a `still_id` outside the
pattern is refused as `invalid` with no request.

## Operations

| call         | request                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------ |
| `path_index` | `GET …/scenario-from-description/runs/{id}/paths/{path_index}/attempts/{attempt}/snapshot` |
| `still_id`   | `GET …/scenario-from-description/runs/{id}/stills/{still_id}`                              |

One request. The backend takes a snapshot anew at every request and only the process that drives the attempt has its page (an
attempt it does not drive is the backend's refusal); a still exists while the review session is open.

## Saving

Only under `loadcraft/walks/<handle>/` of the workspace (`r-xxxxxxxx`, the first 8 characters of the walk), which git ignores. The
name is built from numbers and the checked id: `path-<n>-attempt-<k>.<ext>` and `still-<id>.<ext>`; the extension comes from the
type of the answer (`png`, `jpg`, `webp`; any other type is `flows_walk_image_not_an_image`, nothing saved). An image saved under the
same name earlier is replaced only with `overwrite: true` (`flows_walk_image_exists` otherwise), and that is checked before the request.
Folders are resolved through their symlinks and must stay inside the workspace. The bytes are the user's screenshot, saved as sent:
nothing of the image reaches the model, only its path (relative) and its size.

## format=data

`project_id`, `walk` (`id`, `handle`), `kind` (`snapshot` | `still`), `path` (relative to the workspace; the log's `{path}`),
`bytes` (exact), `type`, and `path_index` and `attempt` or `still_id`.

## Text view

```
Saved the live image of step 3, attempt 1 of walk r-1a2b3c4d: 12.3 KB.
The folder is ignored by git: the image shows what the application displayed.
open: loadcraft/walks/r-1a2b3c4d/path-3-attempt-1.png
```

`open:` is always the last line.

## State

None. The log carries `walk_id` (the handle) and `path_index` (the step, or `still:<id>`), and the data's `path`.

## UI

Text only.

## Test cases

- Ordinary: a snapshot, a still, the file saved byte for byte, the default walk from the state, the three handles, the log entry,
  `format: "data"`, Polish view.
- Edge: both or neither of `path_index` and `still_id`, an image saved earlier (refused, replaced with `overwrite`, even with
  another extension), a type that is no image, an image not found, a still id outside the pattern, a workspace folder that is a
  symlink out of the workspace.
- Adversary: no secret in the answer reaches the model (the image bytes are never read); a still id with a path in it is refused.

## Out of scope

Reading what an image shows, and saving other files of a walk.
