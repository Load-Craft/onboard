# traffic: delete — contract

Tool: `traffic_delete` (module `traffic`, `moduleTool` on a consent card; destructive, level 3, reason `delete`; text view and `format: "data"`;
the description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`; `anthropic/requiresUserInteraction`).
Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

- `kind`: `snapshot` or `token`; required. It says what `item_id` is.
- `item_id`: UUID, required. No default from the state: a deletion names its target.
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only): a snapshot: `GET …/production-traffic/snapshots/{id}` (its window, rows, routes, the label of the token that
pushed it; unknown is `not_found`). A token: `GET …/production-traffic/tokens` (the list; the token has no read of its own; an id that is not
in the list is `not_found`). A token that is revoked already changes nothing: no card, an answer saying so (`count: 0`).
After the person's yes: `DELETE …/production-traffic/snapshots/{id}` (200) or `DELETE …/production-traffic/tokens/{id}` (204, a revoke).
The catalog says runs that use a snapshot are not checked; the card says so.

## The card

Facts (hashed): `kind`, `names` (a snapshot: its window as text; a token: its label, masked), `id`, and per kind `window_start`, `window_end`, `rows`,
`routes`, `sender` (the masked label of the token that pushed it), `chosen` (it is the snapshot chosen for the runs here); `created`, `last_used`
(a token). The prefix of a token is never shown. Lines: the object with its id, what it holds or its use, what stays. No cost line; the undo
line says the deletion is for good; level 3 `delete`.

## format=data (the result)

`kind`, `id`, `names`, `count` (1; 0 for a token revoked already).

## Log and undo

args `Delete {kind}: {names}`, result `{count} {kind} deleted`; the entry of call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. No undo (`reversible: no`).

## State

Reads `ids.project_id` and `choices.run.traffic_snapshot_id`. A deleted snapshot that is that choice is dropped from it.

## Test cases

- The cards (full text) of a snapshot and a token, the chosen snapshot, Polish; nothing sent, entry `queued`.
- The yes: one DELETE, the fake compared, entry with the consent and no undo, the choice dropped (and kept for another snapshot); a token revoked, then found revoked.
- A token revoked already: no card, no question, no write. Unticked, declined, cancelled; another kind or object is a new card; no argument confirms; a client that cannot ask.
- Missing arguments, unknown objects (`not_found`), arguments outside the catalog; secret sentinel in the label of the sender (and `test/tools/traffic/canary.ts`).

## Out of scope

Several objects in one call, creating a token, checking which runs used a snapshot.
