# github_get_status — contract

Tool: `github_get_status` (module `github`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (catalog 1457de88).

## Arguments (exactly the catalog's)

- `include?`: `["history"]` (at most one): adds the latest syncs.
- `history_limit?`: integer 1–50, default 10; read only with `include: ["history"]` (it has a default, so it is never refused).

The project is the bound one. An unknown argument is refused.

## Operations

| read        | request                                                               |
| ----------- | --------------------------------------------------------------------- |
| status      | `GET /projects/{id}/github/status`                                    |
| + `history` | `GET /projects/{id}/github/history?limit=<history_limit>` (auxiliary) |

Both at once. The history is auxiliary: an API error leaves the status and marks `history_state: "unavailable"`.

## format=data

`project_id`, `linked` (the log slot `{linked}`: a record exists, a repository is chosen and the sync is configured),
`connected` (a record exists, also while the sign-in is pending), `repository` (the address without userinfo, query and
fragment; null when none is chosen), `branch`, `hostname`, `sync_status` (`not_configured` | `idle` | `syncing` | `error`),
`auto_sync`, `webhook_secret` (whether one is set; never its value), `last_synced_at`, `last_commit` (the first 7 characters of
the commit, null when none), `history_state` (`none` | `read` | `unavailable`), `history` (`total`, `entries[]`: `at`,
`operation` (`push` | `pull`), `ok`, `files`, `commit` (7 characters or null), `message` (one line, at most 200)).

**Secrets / third party:** the address of a repository can hold a token as userinfo (`https://x-access-token:…@github.com/…`):
userinfo, query and fragment are dropped before `content()`. Branch, hostname and the messages of the history (a commit message,
an error text that may quote a remote) pass `content()`. A commit is shown only when it is hex, as its first 7 characters.

## State

Reads `ids.project_id`. Writes the check `steps.github.connected` (`ok` = `linked`).

## Text view

```
GitHub link of the project: linked
repository: https://github.com/acme/shop-load (branch main on github.com)
sync: idle, last 2026-11-26 10:00 UTC at commit 1a2b3c4; auto-sync on; webhook secret set
```

With history: `recent syncs (2 of 5):` and one line per entry (`2026-11-26 10:00 UTC push ok: 3 files, commit 1a2b3c4 — Update
scenarios`). Not linked: `GitHub link of the project: not linked; github_connect links a repository.` A record without a
repository: `GitHub link of the project: signed in, no repository chosen yet`.

## UI

Text only.

## Test cases

- Ordinary: linked, `format: "data"`, with history, the Polish view, the log entry, the check in the state, one request (two with
  history).
- Edge: not linked, a record without a repository, sync error, the history failing with 500, an empty history, a commit that is not
  hex.
- Adversary: a token as userinfo of the address; sentinel in the branch and a history message; an instruction with a line break in
  a message; `history_limit` 0 and 51 and an unknown argument refused with no request.
