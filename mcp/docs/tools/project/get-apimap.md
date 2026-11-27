# project_get_apimap — contract

Tool: `project_get_apimap` (module `project`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes. The catalog names no arguments, so the tool takes none but `format`; the project is the bound one
(`projectIdOf`, else `no_project`).

## Operations

`GET /projects/{id}/api-map`, once, with no `area_prefixes` (the saved areas, else the detected ones). A project with no
documentation is `not_found`. No auxiliary reads.

## format=data

`project_id`, `title`, `area_rule` (`detected` | `manual`), `total_operations`, `areas` (how many areas the map has), `shown`
(at most 50), `items[]`, `outside_area` (how many operations are under no area), `saved_prefixes` (null when none are saved),
`empty_prefixes` (saved prefixes no operation is under; at most 30 each), `whole_api_chars` (the size of the whole API in the
prompt of a generation, as the backend gave it).
Per area (the view writes an empty prefix as `(no prefix)` and leaves out an empty name): `name`, `prefix`, `operations_count`, `operations` (the first 5 as `METHOD /path`), `sign_in` (the area has a sign-in
endpoint of its own: an area that only borrows the general one is not marked once some area issues a token), `token_operations` (how many operations of it issue a token).

**Third party:** area names, prefixes and operations come from the documentation and pass `content()`. The parts and the cost of
each operation in a prompt are not read.

## Text view

```
API map "Sklep API" (areas detected): 6 areas, operations: 42
1. auth /auth — 6 operations: POST /auth/login, POST /auth/register, POST /auth/logout, POST /auth/refresh, POST /auth/password/reset (+1 more)
2. catalog /catalog — 11 operations: …
12 operations are under no area.
```

**Known limitation:** the secret mask of the plugin cuts a documented path with the word `password` followed by a segment
(`/auth/password/reset` shows as `/auth/password[redacted]`) and redacts the operations an area lists under `token_operations`;
both are pinned by tests marked `it.fails` and go away with the fix of the mask.

## State

None; the log carries the data's `areas` for the result template and nothing else.

## UI

Text only: the map is a read for the model that chooses areas for a generation; the mod shows no areas.

## Test cases

- Ordinary: the map of the sample project, `format: "data"`, Polish view, log entry, one request without a query.
- Edge: no documentation (`not_found`), no bound project, a map with manual areas, operations outside every area, saved prefixes
  with no operation and a sign-in, 60 areas (50 shown), an area name with control sequences, an unknown argument (`area_prefixes`)
  refused.
- Adversary: sentinel in area names and operations, instruction in an area name; level 1, so it is offered.

## Out of scope

Saving or previewing areas (`area_prefixes`), the area-prefix suggestions route.
