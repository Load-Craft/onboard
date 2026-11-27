# project_update — contract

Tool: `project_update` (module `project`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text view
and `format: "data"`; description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool).

## Arguments

- `name`: text, optional, trimmed, 1 to 255 characters. The new name; the backend refuses a name another project already has.
- `description`: text, optional, at most 8000 characters. The new description; an empty text clears it.
- At least one of the two is required: a call with neither is refused locally (`invalid_arguments`, rule `update_without_fields`), with no request.
- The project is the bound one (`projectIdOf`, else `no_project`).

## Operations

1. `GET /projects/{id}` once, before the write: the current name and description (the state "before" for the undo, and the
   comparison that finds what really changes).
2. `PUT /projects/{id}` with only the fields that differ from the current ones. When nothing differs the tool sends no write
   and answers `changed: []` (inert, no undo entry).

The backend leaves a field it is not sent, or is sent as null, as it is, so the tool never sends null.

## format=data

`project_id`, `name` (after the call), `description` (after the call; null when none), `changed` (`["name"]`, `["description"]`
or both, empty when nothing differed), `previous` (`name` and `description` before, only for the changed fields),
`undoable` (whether the log keeps the way back).
**Third party:** the name and the description are the project's own text and may carry text from an uploaded overview: they pass
`content()` (one line, secrets masked) in the data and the view.

## Text view

```
Project "sklep" updated: name, description.
name: "sklep-old" -> "sklep"
description: changed (120 characters)
```

Nothing differed: `Project "sklep": nothing to change, the name and the description are already as given.`

## Undo

The log entry carries `undo: {tool: "project_update", args}` with the previous values of the changed fields. A write that fails
(name taken, project not found, 5xx) leaves no entry with an undo. A previous value the secret mask would change is not kept (it would be restored masked, or put a secret in the state file): the
change is written, `undoable` is false and the view says so. Known limit: a project that had no description is restored
with an empty one (the backend has no way to set null).

## State

Reads `ids.project_id` (through the binding). Writes nothing. No invalidation row names this tool.

## UI

Text only: the change is a one-line edit the model makes on the user's word.

## Test cases

- Ordinary: rename; change the description; both; the fake backend holds the new values (the object, not only the answer).
- Undo: write, take the undo from the log, call it, the project is as before (name and description).
- Edge: nothing differs (no `PUT`, no undo); neither argument (refused, no request); name taken (400 from the backend, no undo
  entry); unknown project; name of 256 characters refused; unknown argument refused; `format: "data"`; Polish view; log entry.
- Adversary: secret in the description; instruction in the name; control sequences; the undo arguments carry no secret.

## Out of scope

The environment, the HTTP settings, the profile and the activation of the project (other tools).
