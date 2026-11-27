# project_get_endpoints — contract

Tool: `project_get_endpoints` (module `project`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool).

## Arguments (exactly the catalog's)

- `docs_id?`: UUID of the documentation version; default `ids.docs_id` of the state. Neither: `missing_argument` (run
  `project_get_docs` first), no request.
- `endpoint?`: 1–300 characters: an endpoint id (UUID), an operationId, or `METHOD /path` (`POST /checkout`, method in any case,
  path as in the documentation). Without it the tool lists.
- `include?`: `["bindings"]` (at most one), only with `endpoint`.
- `method?`, `query?`, `limit?` (1–200, default 50): filters of the list; `method` and `query` with `endpoint` are refused, `limit` is ignored there. `method` is one of
  `get post put patch delete head options`; `query` is a case-insensitive substring of the path, the summary or the operationId.

`include` without `endpoint`, and `method` or `query` with `endpoint`, are refused locally as `invalid_arguments` (dictionary text, EN/PL) with no request. An unknown argument is
refused (strict schema).

## Operations

| call                          | requests, in order                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| list                          | `GET /openapi-specs/{id}/endpoints` (all endpoints, no paging; the tool filters and cuts)         |
| `endpoint` = UUID             | `GET …/endpoints/{endpoint}`                                                                      |
| `endpoint` = operationId/path | the list, to find the id (no match `not_found`, several `ambiguous`), then `GET …/endpoints/{id}` |
| + `include: ["bindings"]`     | `GET …/endpoints/{id}/binding-metadata`, sent with the detail once the id is known                |

The binding metadata is an auxiliary read: an API error there leaves the detail and marks `bindings_state: "unavailable"`.
A failure of the detail or the list ends the call. Reads go through `callBackend` and `settleAll`.

## format=data

List: `mode: "list"`, `project_id`, `docs_id`, `count` (endpoints that match the filters), `total` (endpoints of the version),
`shown`, `endpoints[]` (at most `limit`): `id`, `method` (upper case), `path`, `operation_id`, `summary`, `tags` (at most 5),
`parameters_count`, `has_request_body`, `crud_operation`, `async_pattern`.

One: `mode: "one"`, `count: 1`, `detail`: the list fields plus `description`, `deprecated`, `security` (scheme names, at most 10),
`parameters[]` (`name`, `in`, `type`, `required`; at most 40), `request_body` (`content_type`, `required`, `schema`) or null,
`responses[]` (`status`, `content_type`, `schema`; at most 20); `schema` is short: `type`, the names of the top-level properties
(at most 15), the type of the items. With the metadata: `bindings` (`expected_statuses`, `response_schemas` short per status,
`assertions` `{type, description}` at most 15) and `bindings_state` (`none` | `read` | `unavailable`). The view splits the
statuses: `success statuses` (below 400) and `declared error statuses` (400 and up, only when there are some).

**Third party:** the whole document, the examples, the defaults and the enumerated values are never read into the data. Every
name, summary, description, path and operationId passes `content()`.

## Text view

```
POST /checkout — Create an order
id: 3f2a…, operationId: create_order, tags: orders
parameters (1):
  header x-request-id (string, required)
body: application/json (required) object {items, coupon}
responses:
  201 application/json object {id, total}
  422 application/json object {detail}
security: bearerAuth
```

The list is `42 endpoints:` (or `3 of 42 endpoints match:`) and `n. METHOD /path — summary [operationId]` per line; the cut
adds `showing the first 50 of 120 endpoints`.

## State

None: it reads `ids.docs_id` and writes nothing. The log carries `endpoint` (the argument as given, empty for the list) and the
data carries `count`.

## UI

Text only: the endpoints serve the model that builds flows; the mod shows flows, not documentation.

## Test cases

- Ordinary: list, filters (method, query, limit), one by UUID, by operationId, by `METHOD /path`, with bindings, `format: "data"`,
  Polish view, log entry, `docs_id` from the state.
- Edge: no `docs_id` (missing_argument), unknown documentation or endpoint (not_found), operationId shared by two endpoints
  (ambiguous), a filter that matches nothing, 120 endpoints (50 shown), `include` without `endpoint` and `method` or `query`
  with `endpoint` (invalid_arguments, no request), bindings read failing with 500 (detail still shown), a summary with control sequences.
- Adversary: sentinel in summaries, descriptions and schema property names, an instruction in a summary, argument outside the
  catalog refused, 401/500 answer quoting a secret; level 1, so it is offered.

## Out of scope

Importing documentation (`project_import_docs`) and the versions of the documentation (`project_get_docs`).
