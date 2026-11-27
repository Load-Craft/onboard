# project_list — contract

Tool: `project_list` (module `project`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and `format: "data"`; the
description, the annotations and the log templates are the catalog's, through `meta.generated.ts`). Matches the catalog (ccb7d0b0). The
backend shows a token only its own projects (a token pinned to a project sees that one).

## Arguments (exactly the catalog's)

- `query?`: 1-200. With it the backend searches projects, flows, load scenarios, runs and pages by a substring; without it the projects
  are listed.
- `is_active?`: narrows the list. With `query` the call is refused locally (`invalid_arguments`, nothing sent).
- `limit?`: 1-100, default 50.

No project is needed. An unknown argument is refused.

## Operations

`GET /projects?limit[&is_active]` (the list; `total` counts the projects that match the filter) or `GET /search?q&limit` (one request).

## format=data

`mode` (`list` | `search`), `count` (the log slot `{count}`: the projects that match; for a search the hits returned, at most `limit`),
`shown`, `limit`, and `items[]`: for a list `id`, `name`, `description`, `type` (`api` | `frontend` | `both`), `baseUrl`, `active`,
`flows`, `testTypes`, `validators`, `hasOpenapi`, `hasAsyncapi`, `updatedAt`, `current` (the project of this workspace); for a search
`type` (`page` | `project` | `scenario` | `execution`, else `other`), `title`, `subtitle`, `id`, `run` (the handle of a run hit),
`createdAt`; `query` (masked). **Third party:** names, descriptions, addresses, titles and subtitles pass `content()`.

## View

```
2 projects:
  * sklep    API  active    3 flows, 3 test types, 5 validators  2026-11-22
    archive  API  inactive  0 flows, 0 test types, 0 validators  2026-01-01
* the project this workspace is bound to
```

## Tests

The list and its request, the bound project marked, `is_active` and `limit` sent, the search and its request, a run by its handle, the
empty search and the limit note, the local refusal, masked texts and an unknown hit type, a refusal of the backend, arguments outside the
catalog, the Polish view, the log entry, the sentinel cases, the coverage of both operations.
