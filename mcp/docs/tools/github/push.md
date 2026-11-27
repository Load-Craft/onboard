# github_push — contract

Tool: `github_push` (module `github`, `moduleTool` on a consent card; write, level 3, reason `external`; text view and `format: "data"`; the
description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`; `anthropic/requiresUserInteraction`).
Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments (the catalog's)

- `composition_id?`: 1-200, an id or a name (one list read, `not_found` and `ambiguous` masked); default the composition of the workspace
  (`ids.composition_id`).
- `message`: 1-200, required: the commit message. The model writes it, so it is shown on the card (masked) and sent as given.
- `create_pr?`: boolean, default false: a pull request instead of a commit on the branch.
- No argument carries consent: `confirm`, `consent`, `token` and any other name (a branch, a repository) are refused.

## Operations

Card (call 1 and the repeat; reads only): `GET …/github/status` (the link: repository, branch; not linked is `github_not_linked`), the
composition by name or id, `GET …/github/diff-preview?composite_id=` (the files the push would change). Nothing to push (no file): no card, no
question, nothing sent. After the person's yes: `POST …/github/push` with `{composite_id, message, create_pr}`; the backend clones, commits
and pushes with the token it holds (never read here). A failure of git is a 400: it is an error, the check is not set, and the backend writes
it to the history of the link.

## The card

Facts (hashed): `name` (the composition, masked), `repo` (the address without userinfo, query and fragment, masked), `composition_id`,
`branch` (masked or null), `create_pr`, `message` (masked), the number of files and lines, and up to 20 paths with the lines each adds and
removes. A change of the message, the flag, the branch or the diff is a new card. Lines: a commit on the branch (or a pull request) with the
message, the files, that the generated code is sent to the repository outside LoadCraft. The code itself is never shown. No cost line (the
catalog names none); the undo line says it is not undone from here; level 3 `external`.

## format=data (the result)

`pushed` (false when there was nothing to push), `composition_id`, `repo`, `branch`, `commit` (the short hash when it is hex, `unknown`
otherwise, `none` when nothing was pushed), `url` (built from the masked repository address and the hash; the backend's own url is not echoed),
`files`, `summary`, `create_pr`.

## Log and undo

args `Push composition {name} to {repo}`, result `pushed: {commit}`; the entry of call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. No undo (`reversible: no`): the commit stays in the repository and the user reverts it there; the result says so.

## State

Reads `ids.project_id`, `ids.composition_id`. A push sets the check `github.pushed` to true; a failed one does not.

## Test cases

`test/tools/github/push.test.ts`: the card (full text, a pull request, more than 20 files, nothing to push, not linked, Polish), the yes (one
POST with the message and the flag, the fake compared, the entry and the check, a pull request, a composition by name and from the state), no/declined/
cancelled, a new card for another message, flag or diff, a push the backend refuses, no confirming argument and a required message, a
client without elicitation, secrets in the address, the branch, the paths, the name and the message. Sentinel cases in
`test/tools/github/canary.ts`.
