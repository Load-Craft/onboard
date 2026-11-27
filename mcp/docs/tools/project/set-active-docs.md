# project_set_active_docs — contract

Tool: `project_set_active_docs` (module `project`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card;
text view and `format: "data"`; description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool).

## Arguments

- `kind`: `openapi` (default) or `asyncapi`.
- `docs_id`: id of a stored version, required (`project_get_docs` with `versions: true` lists them). Lower-cased before use.
- The project is the bound one (`projectIdOf`, else `no_project`).

## Operations

1. `GET /projects/{id}/openapi-specs` (or `asyncapi-specs`), once, before the write: `current_spec_id` (the version active now,
   the way back) and, when the wanted version is on the page, its title and version.
2. `PUT /projects/{id}/openapi-specs/{spec_id}/activate` (or `asyncapi-specs`). A version the backend does not know is a 404
   (`not_found`), one of another project a 400; the tool does not decide either.
3. Only when the wanted version was not on the page of the list: `GET /openapi-specs/{spec_id}` (or `asyncapi-specs`) after the
   write, for its title and version (best effort: a failed read leaves them empty, the activation stands).

A version that is already the active one is not written: `changed: false`, inert (no invalidation, no undo entry).

## format=data

`project_id`, `kind`, `docs_id`, `title`, `version` (null when the version could not be read), `changed`, `previous_id` (the
version that was active before; null when none), `undoable`.
**Third party:** title and version come from the documentation and pass `content()`.

## Text view

```
OpenAPI documentation v2.13.0 "Sklep API" is now the active one.
```

Already active: `OpenAPI documentation v2.13.0 "Sklep API" is already the active one; nothing changed.`
No previous version, so no undo: a second line says that the change cannot be undone from the log.

## Undo

`undo: {tool: "project_set_active_docs", args: {kind, docs_id: <previous version>}}`. When no version was active before, the backend
has no way to deactivate one: no undo entry, and the view says so. A failed write leaves no entry with an undo.

## State

Reads `ids.project_id`. Writes `ids.docs_id` (the active OpenAPI documentation) for `kind: openapi` only; an AsyncAPI activation
does not touch it. The reducer invalidates, through the table of the catalog (trigger `project_set_active_docs`):
`project.env_checked`, `project.setup_analyzed`, `flows.journeys_suggested`, `scenario.drift`. An unchanged call does not.

## UI

Text only.

## Test cases

- Ordinary: activate an older OpenAPI version and an AsyncAPI one; the project in the fake points at it; requests: the list and
  the PUT; `ids.docs_id`; log entry (`openapi v2.13.0 active`).
- Undo: write, take the undo from the log, call it, the object is as before (OpenAPI and AsyncAPI).
- Invalidation: verdicts of the table's four checks go to null after a change; none after an unchanged call or a refused one.
- Edge: already active; unknown version (404, nothing changed, no undo entry); a version of another project (400); no previous
  active AsyncAPI version (no undo); missing or malformed `docs_id`; unknown `kind`; unknown argument; no bound project; Polish view.
- Adversary: sentinel in the title and the version; instruction in the title; control sequences.

## Out of scope

Uploading a version (`project_import_docs`), reading versions (`project_get_docs`), migrating flows to a version (`flows_migrate_docs`).
