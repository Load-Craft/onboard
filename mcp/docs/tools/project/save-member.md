# project_save_member — contract

Tool: `project_save_member` (module `project`, `moduleTool` on a consent card; write, level 2; text view and `format: "data"`; the
description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`). Design of the card:
`docs/consent-card.md`. Matches the catalog: yes (card and log by `user_id`: the backend takes a user id, not an e-mail address).

## Arguments

- `user_id`: UUID, required. The person to add or whose role changes (as `project_list_team` shows).
- `role`: `owner`, `editor` or `viewer`, required.
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only): `GET …/team` (is the person a member, and their role). After the person's yes: the team is
read again, then `POST …/team` (body `user_id`, `role`) for a person who is not a member, or `PUT …/team/{user_id}` (body `role`) for one
who is. The state of the project is the bound one.

## The card

Nothing to change (the person has the role): no card, no question; the answer says so. Else facts (hashed): `user_id`, `role`,
`previous` (the role now, masked, or null). Lines: what happens (adds, or changes from → to) and what the role allows. No cost line (the
catalog names none); the undo line names the way back.

## format=data (the result)

`user_id`, `role`, `previous_role` (null when added), `action` (`added`, `changed`, `unchanged`), `undo` (`role`, `removal`, `withheld`, `none`).

## Log and undo

args `Give {user_id} the role {role}`, result `{user_id}: {role}`; the entry of call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. Undo: a changed role is `project_save_member` with the previous role; an added member is `project_delete`
with `kind: member` (level 3, its own card). A previous role that is none of the three is not kept as an undo (`withheld`).

## State

Reads `ids.project_id`. Writes nothing.

## Test cases

`test/tools/project/saveMember.test.ts`: the card of a change and of an addition, nothing to change, Polish, the yes (one PUT or POST, the
fake team compared, the entry with the dialog and the undo, the undo run for real), no/declined/cancelled, other arguments and a changed
team (a new card), no confirming argument, a client without elicitation, arguments outside the catalog, a refusal of the backend,
secrets. Sentinel cases in `test/tools/project/canary.ts`.
