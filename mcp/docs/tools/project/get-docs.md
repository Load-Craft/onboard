# project_get_docs — contract

Tool: `project_get_docs` (module `project`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool).

## Arguments (exactly the catalog's)

- `kind?`: `openapi` | `asyncapi`, default `openapi`.
- `docs_id?`: UUID of one stored version. Without it, the active documentation. The `ids.docs_id` of the state is not a default
  (the active documentation would be unreachable); it only marks the selected version.
- `versions?`: boolean, default false. true lists the stored versions instead. With `docs_id` the call is refused locally as `invalid_arguments` (dictionary text, EN/PL),
  no request is sent.

The project is the bound one (`projectIdOf`, else `no_project`). An unknown argument is refused (strict schema).

## Operations

| call       | request                                                           |
| ---------- | ----------------------------------------------------------------- |
| active     | `GET /projects/{id}/openapi` or `…/asyncapi`                      |
| `versions` | `GET /projects/{id}/openapi-specs` or `…/asyncapi-specs`          |
| `docs_id`  | `GET /openapi-specs/{docs_id}` or `GET /asyncapi-specs/{docs_id}` |

One request per call, no auxiliary reads. A project with no OpenAPI documentation is `not_found`; with no AsyncAPI documentation
the answer is empty and the view says so. An id of the other kind is `not_found`.

## format=data

`kind`, `mode` (`active` | `version` | `versions`), `project_id`, `version` (of the shown or, for the list, the current
documentation; null when there is none), `docs` (the shown documentation, or null), `versions[]` (at most 50), `count`, `shown`,
`current_id`.
Per documentation: `id`, `title`, `version`, `description`, `source_url` (origin and path only), `at` (ISO date-time as the backend
gave it), `spec_version` (the OpenAPI or AsyncAPI number), `endpoints_count` (OpenAPI), `channels_count` and `operations_count`
(AsyncAPI), `protocols` (AsyncAPI, at most 10), `is_active`, `is_current` (the list only, else null), `selected` (it is `ids.docs_id`).

**Third party:** the whole specification document is never read into the data or the view, only the metadata above. Title,
version, description, source address and protocol names are the project's own text and pass `content()`.

## Text view

```
OpenAPI documentation "Sklep API" v2.14.0 (active)
id: 0e6b4a91-3d27-4c58-9f10-7a2e5d8b3c64
OpenAPI 3.0.3, 24 endpoints, uploaded 2026-11-20
Documentation of the shop API
```

The list is `3 OpenAPI versions:` and one line per version (`1. "Sklep API" v2.14.0 (active, current) 24 endpoints,
2026-11-20, <id>`). No documentation is one line.

## State

Writes `ids.docs_id` with the id of the shown documentation (the active one, or the one asked for); not for the list, not when
there is no documentation. The log carries `kind` and `docs_id` (the argument as given, empty for none), and the data carries
`kind` and `version` for the result template. Nothing else.

## UI

Text only: the documentation is a read the model uses to pick `docs_id` or to see which version is active; the project card of the
mod already shows the active version.

## Test cases

- Ordinary: active OpenAPI, active AsyncAPI, versions of each, one by id of each, `format: "data"`, Polish view, log entry, `ids.docs_id`.
- Edge: no AsyncAPI documentation (empty), no OpenAPI (`not_found`), unknown id, id of the other kind, `docs_id` with `versions`
  refused with no request, `kind` outside the enum refused, 60 versions (50 shown), a title with control sequences and line breaks,
  a source address with credentials and a query.
- Adversary: sentinel in the descriptions and titles of every answer (mask by shape), instruction in a title, argument outside the
  catalog refused, 401/500 answers quoting a secret; level 1, so it is offered.

## Out of scope

Importing or activating documentation, and the endpoints (`project_get_endpoints`).
