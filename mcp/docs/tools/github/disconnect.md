# github_disconnect — contract

Tool: `github_disconnect` (module `github`, `moduleTool` on a consent card; destructive, level 3, reason `delete`; text view and
`format: "data"`; the description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`;
`anthropic/requiresUserInteraction`). Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

None (the project is the bound one). No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only): `GET …/github/status` (is the project linked, to which repository). A project that is not linked
(`connected` false, `sync_status` `not_configured`, or no address): no card, no question, nothing sent. An operation of this workspace that
still runs on the project is `delete_busy` (`src/tools/delete/checks.ts`), raised before any question.
After the person's yes: `POST …/github/disconnect`.

## The card

Facts (hashed): `repo` (the address without userinfo, query and fragment, masked), `branch` (masked, or null), `auto_sync`. Lines: the link
that goes (with the branch), that the automatic sync stops (when it was on), what stays (the repository and its files, the flows and the
scenarios). No cost line (the catalog names none); the undo line says the user links again in the application, with a token, none is kept; level 3 `delete`.

## format=data (the result)

`disconnected` (false when the project was not linked), `repo` (null then).

## Log and undo

args `Disconnect the project from {repo}`, result `disconnected`; the entry of call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. No undo is kept: linking again needs a token, which never reaches the log, and `github_connect` is not offered to the model.

## State

Reads `ids.project_id`. Writes nothing.

## Test cases

`test/tools/github/disconnect.test.ts`: the card (full text, a shorter one, not linked, Polish), the yes (one POST, the fake link compared, the
entry with the dialog and no undo, the same call again), no/declined/cancelled, a link that changed after the card, no confirming argument, a
client without elicitation, `delete_busy`, secrets in the address and the branch. Sentinel cases in `test/tools/github/canary.ts`.
