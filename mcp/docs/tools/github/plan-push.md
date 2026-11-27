# github_plan_push — contract

Tool: `github_plan_push` (module `github`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (catalog 1457de88). It writes nothing: the backend only previews the push.

## Arguments (exactly the catalog's)

- `composition_id?`: string 1–200, the id or the name of a composition (any letter case), like the other composition tools; default `ids.composition_id`, else `missing_argument` pointing to `scenario_list_compositions` (no request).
- `diffs?`: boolean, default false. true adds a short diff per file: up to 10 files, 40 lines each.

The project is the bound one. An unknown argument is refused.

## Operations

First `GET /projects/{id}/github/status`: a project with no link is refused with `github_not_linked` before a composition is asked for
(a status the backend cannot give does not stop the plan). Then `GET /projects/{id}/gatling/compositions` (the shared resolver: an id or a name to the one composition, `not_found` with the names, `ambiguous` with the candidates and their ids, all masked). Then `GET /projects/{id}/github/diff-preview?composite_id=<composition_id>`,
once. A composition the backend does not know is `not_found`. Without a composition (none given, none in the state) the call is
`missing_argument` with a hint that names `scenario_generate`.

## format=data

`composition_id`, `files` (how many files would change: the log slot `{files}`), `additions`, `deletions`, `shown`,
`file_list[]` (at most 50: `path`, `status` (`new` | `modified`), `additions`, `deletions`, and with `diffs` for the first 10
`diff[]`: at most 40 lines, each at most 200 characters).

**Secrets / third party:** the files are the generated test code of the project, which can carry a header value or a credential
the user put into an environment: every path and every diff line passes `content()` (mask by shape, secrets registered, one
line). Without `diffs` no line of a file is read into the data.

## Text view

```
Push plan of composition 0d0c7034-0008-4000-8000-000000000001: 2 files would change (+52 −1)
  new src/test/scala/Checkout.scala (+50)
  modified pom.xml (+2 −1)
```

With `diffs`, each file line ends with `:` and its lines follow, indented by four. Nothing to change: `Push plan of composition …:
nothing would change.`

## State

Reads `ids.project_id` and `ids.composition_id`; writes nothing but the log entry.

## UI

Text only.

## Test cases

- Ordinary: the file list, `format: "data"`, with diffs, the Polish view, the log entry, the two requests, the default from the state.
- Edge: nothing to change, no link (`github_not_linked`, only the status read), a status that fails, no composition id (`missing_argument`), 404, 60 files (50 shown), a diff longer than 40
  lines.
- Adversary: sentinel in a diff line and a path; an instruction with a line break in a path; an empty `composition_id` or one over 200 characters; a composition name holding a secret in `not_found`/`ambiguous`
  and an unknown argument refused with no request.
