# flows: ask copilot — contract

Tool: `flows_ask_copilot` (module `flows`, `moduleTool` on a consent card; costly, level 2; text view and `format: "data"`; the description,
the annotations, the cost, the card and log templates are the catalog's, through `meta.generated.ts`; `anthropic/requiresUserInteraction`).
Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

- `flow_id?`: string 1 to 200 (id or name); default: the only flow of the workspace (`ids.flow_ids`), else `missing_argument`.
- `message?`: string 1 to 4000; without it the copilot runs its standard review.
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments. There is no `review` argument.

## Operations

Card (reads only): `GET …/flows/{id}` (the name; unknown is `not_found`; a name is resolved through the flow list).
After the person's yes: `POST …/flows/{id}/copilot/messages` with `{message}`, or without a message
`POST …/flows/{id}/copilot/messages/review`. The backend answers with a reply, the changes it proposes and the id of the stored proposal;
it applies nothing and changes nothing in the flow.

## The card

Facts (hashed): `name` (masked), `id`, `message` (masked, cut to 300; null for the review). Lines: the flow, the question or the review,
that changes are proposed and none applied. Cost line (the catalog's: 1 to 2 LLM calls per turn). The undo line says the flow stays as it is; level 2.

## format=data (the result)

`flow` (`id`), `name`, `review`, `message_id`, `reply` (masked, 1500), `count` (the changes proposed), `proposed` (the first 20: `id`, `type`
add/modify/remove, `block` the target block id, `description` masked, `warnings` count). The blocks of a proposal are never copied.

## Log and undo

args `Ask the flow copilot about {name}`, result `{changes} changes proposed`; the entry of call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. No undo (`reversible: nothing`: it proposes only).

## State

Reads `ids.flow_ids`. Writes nothing.

## Test cases

- The card (full text with the cost line, nothing sent), review card, Polish.
- The yes: one POST (message or review route), the flow untouched in the fake, the turn counted, entry with the consent and no undo.
- No changes, many changes (the first 20 and the count), the only flow by default, the flow by name.
- Unticked, declined, cancelled; another message is a new card; no argument confirms; a client that cannot ask.
- No flow (`missing_argument`), unknown flow (`not_found`), arguments outside the catalog, a failing copilot.
- Secret sentinel: a secret and an instruction in the name, the message, the reply and the descriptions (and `test/tools/flows/canary.ts`).

## Out of scope

Applying a proposal, several flows in one call, the conversation history (`flows_get_copilot_history`).
