# project_set_apimap — contract

Tool: `project_set_apimap` (module `project`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text
view and `format: "data"`; description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool).

## Arguments

- `prefixes`: text, 1 to 8000 characters: the path prefixes of the areas, comma-separated, at most 64, each at most 512 characters.
- `detected`: boolean, default false; true goes back to the areas LoadCraft detects.
- Exactly one of the two: neither, both, an empty list (`","`), more than 64 prefixes or a prefix over 512 characters are refused locally
  (`invalid_arguments`), with no request. What a prefix may look like (starts with `/`, no whitespace, not the root, no duplicate)
  is the backend's rule: it answers 422 (`invalid`) and nothing is saved.
- The project is the bound one (`projectIdOf`, else `no_project`).

## Operations

1. `GET /projects/{id}/api-map` once, before the write: `saved_area_prefixes` (null: the detected areas) is the way back.
2. `PUT /projects/{id}/api-map/area-prefixes` with `{area_prefixes: [...]}` or `{area_prefixes: null}` (detected). A project with no
   documentation is `not_found`. The answer is the map of the saved areas; the tool compares its `saved_area_prefixes` with the
   ones before: the same list (or detected again while detected) is `changed: false`, inert (no invalidation, no undo entry).

## format=data

`project_id`, `mode` (`prefixes` | `detected`), `prefixes` (the saved prefixes after the call, at most 64; empty for detected), `count`
(how many), `areas` (how many areas the map has now), `empty_prefixes` (saved prefixes no operation is under), `changed`, `previous`
(the saved prefixes before; null when the areas were the detected ones), `undoable`.
**Third party:** prefixes come from the model's words and the documentation; they pass `content()`.

## Text view

```
API areas set by hand: 3 prefixes, 3 areas: /auth, /catalog, /orders.
Prefixes with no operation: /legacy
```

Detected: `API areas are the detected ones again: 6 areas.` Unchanged: `API areas already as given; nothing changed.`

## Undo

`undo: {tool: "project_set_apimap", args}`: `{prefixes: "<previous, comma-separated>"}`, or `{detected: true}` when the areas were the
detected ones. The previous list is kept as the backend returned it (trimmed, sorted, no trailing `/`). Not kept (`undoable: false`,
the view says so): a previous prefix with a comma in it (it cannot be written back as a comma-separated text), or one the secret mask
would change. A failed write leaves no entry with an undo.

## State

Reads `ids.project_id`. Writes nothing. The reducer invalidates, through the table of the catalog (trigger `project_set_apimap`):
`scenario.self_check`, `scenario.compiled`, `run.planned`. An unchanged call does not.

## UI

Text only.

## Test cases

- Ordinary: set prefixes; the map in the fake holds them (areas, empty prefixes); go back to detected; requests: the read of the map
  and the PUT.
- Undo: from prefixes to prefixes, from detected to prefixes (undo is `detected: true`), from prefixes to detected; the object in the
  fake is as before.
- Invalidation: verdicts of the three checks go to null after a change; none after an unchanged or a refused call.
- Edge: same list again (no undo, inert); neither or both arguments; 65 prefixes; a prefix of 513 characters; `","`; a prefix the backend
  refuses (no leading `/`, whitespace, root, duplicate: 422, nothing saved, no undo entry); no documentation (404); no bound project;
  a previous prefix with a comma (no undo); Polish view; log entry.
- Adversary: sentinel in a prefix; instruction in a prefix; control sequences.

## Out of scope

Previewing prefixes without saving (`area_prefixes` query of the read), the area-prefix suggestions route.
