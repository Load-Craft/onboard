# scenario_update_pins — contract

Tool: `scenario_update_pins` (module `scenario`; kind composite, level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text
view and `format: "data"`; description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (argument added to the catalog entry together with this tool).

## Arguments

- `composition_id`: the composition, its id or name, 1 to 200 characters; default: the one of the workspace (`ids.composition_id`), else `missing_argument`.
- The project is the bound one (`projectIdOf`, else `no_project`).

## Operations

1. The composition is looked up by id or name, then `GET /projects/{id}/gatling/compositions/{composition_id}` once: the members and which of them have drifted
   (their pinned version is not the scenario's current one).
2. `PUT /projects/{id}/gatling/compositions/{composition_id}/links/{link_id}/pin` for every drifted member, one after another. The backend moves the member
   to its scenario's current version. A sequential composition (retired) is a 410, an unknown member a 404: the tool does not decide either.
   When a write fails the members moved before it stay moved (each pin is its own write); the call is an error without an undo entry, and a repeat
   continues with the members still drifted.
3. No drifted member: nothing is written (`count: 0`, inert, no undo entry).

## format=data

`project_id`, `composition` (`id`), `name` (masked), `count` (members moved), `members[]` (`link_id`, `scenario_id`, `scenario` name masked, `from`, `to`;
at most 50), `still_drifted` (members that drift after the last write), `unpinned`, `same_content` (counts of the members that drift not, as above).
**Third party:** the composition's and the scenarios' names pass `content()`.

## Text view

```
2 members of "mix" moved to the current versions of their scenarios:
- browse: v1 -> v3
- checkout: v2 -> v3
```

None drifted: `No member of "mix" has drifted; nothing changed.` followed, when it applies, by why: members pinned to no version follow their scenario by themselves (`unpinned`), and members pinned to an older version number whose content is the current one are no drift either, because the backend decides drift by the content (a digest), not by the number (`same_content`).

## Undo

`undo: {tool: "scenario_save_composition", args: {composition_id, members: [{link_id, scenario_id, version: <the version pinned before>}]}}` (the tool names the way
with `undo_tool` in `undo_args`). `scenario_save_composition` is a level 2 tool (a consent card) the entry only names: the way a pin goes back to an older
version is saving the composition, not this tool. The shape of `members` is provisional: the exact arguments of that tool are fixed with it, and this entry follows then; the entry carries the facts it needs (the previous
pinned versions). A call that moved nothing or failed leaves no entry with an undo.

## State

Reads `ids.project_id`, `ids.composition_id`. The checks `scenario.compiled`, `data.datasets_ready` and `run.planned` are reset by the reducer through the table
of the catalog (trigger `scenario_update_pins`); an unchanged call resets nothing.

## UI

Text only.

## Test cases

- Ordinary: a composition with two drifted members and one current; the two are moved, the third is not touched; one read and two writes; by id and by name.
- Undo: move, take the undo from the log (names `scenario_save_composition` with the previous versions), apply the previous versions on the fake: the pins are as before.
- Invalidation: the three checks go to null after a change; none after a call that moved nothing or failed.
- Edge: nothing drifted (no write, no undo); a write that fails in the middle (error, earlier members stay moved, no undo entry); unknown composition; no
  `composition_id` with none in the state; unknown argument; no bound project; Polish view; log entry.
- Adversary: sentinel in the names; instruction in a name; control sequences.

## Out of scope

Saving a composition (`scenario_save_composition`), reading compositions (`scenario_get_composition`).
