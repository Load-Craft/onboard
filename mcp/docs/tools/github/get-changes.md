# github_get_changes — contract

Tool: `github_get_changes` (module `github`; level 1, class read, no card, no undo; text view and `format: "data"`; the description,
the annotations and the log templates are the catalog's, through `meta.generated.ts`). Matches the catalog (375c8818). A read with one
effect: the backend advances the project's last synced commit to the head of the branch, so a second call lists nothing.

## Arguments (exactly the catalog's)

- `limit?`: 1-200, default 50: how many files the data lists; the count is always the whole number. Not exposed: the backend's `force`.

The project is the bound one. An unknown argument is refused.

## Operations

First `GET /projects/{id}/github/status`: a project with no link is refused with `github_not_linked` (its text says there is no repository to read changes from, where `github_plan_push` says there is nothing to push to) and the marker is not touched (a
status the backend cannot give does not stop the call). Then `POST /projects/{id}/github/pull`, once, with no body. A failed clone, a
bad token or an empty repository is the backend's refusal as the registry reports it; a project with no integration is `not_found`.

## format=data

`files` (how many changed: the log slot `{files}`), `shown`, `limit`, `processed`, `lastCommit` (7 hex characters, else null),
`changes[]` (`path`, `change` (`added` | `modified` | `deleted`, else `other`), `hasContent`). **Third party:** paths come from the
repository and pass `content()`. No content of a file is read.

## View

```
3 files changed since the last sync:
  modified  src/test/scala/Checkout.scala
  added     data/users.csv
  deleted   old/Legacy.scala
The sync marker now stands at commit 1a2b3c4: a second call returns nothing until the repository changes again.
```

## Tests

The list and its two requests, the second call empty, `limit` and the data, the log entry, `github_not_linked` with no pull, a backend
refusal, masked paths and a commit that is not hex, a change type outside the contract, arguments outside the catalog, the Polish view,
the sentinel case.
