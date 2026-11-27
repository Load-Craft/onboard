# data: ask copilot — contract

Tool: `data_ask_copilot` (module `data`, `moduleTool` on a consent card; costly, level 2; text view and `format: "data"`; the description,
the annotations, the cost, the card and log templates are the catalog's, through `meta.generated.ts`; `anthropic/requiresUserInteraction`).
Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

- `message`: string 1 to 4000; required.
- `scenario_id?`, `composition_id?`: strings 1 to 200 (id or name). Both is rule `data_copilot_one_of` (`invalid_arguments`, before any request).
  With neither: the composition of the workspace (`ids.composition_id`), else its only scenario (`ids.scenario_ids`), else `missing_argument`.
- `profile?`: object (the state's profile: `type`, `vusers`, `ramp`, `hold`); default: the one chosen in the state (`choices.run.profile`); none chosen: none sent.
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (reads only): `GET …/gatling/scenarios/{id}` or `GET …/gatling/compositions/{id}` (the name; unknown is `not_found`; a name is resolved first).
After the person's yes: `POST …/data-hub/messages` with `{message, scenario_id | composition_id, workload?}` (the profile is sent as `workload`).
The backend answers with a reply, the actions it proposes, issues and chips; it applies nothing.

## The card

Facts (hashed): `kind` (scenario or composition), `name` (masked), `id`, `message` (masked, cut to 300), `profile` (as text, masked; null: none).
Lines: the target, the question, the load profile, that actions are proposed and none applied. Cost line (the catalog's: 1 to 3 LLM calls per
turn). The undo line says the data stays as it is; level 2.

## format=data (the result)

`target` (`kind`, `id`), `name`, `reply` (masked, 1500), `count` (the actions proposed), `proposed` (their kinds with counts; never their bodies),
`issues`, `chips` (the first 10, masked).

## Log and undo

args `Ask the data hub copilot`, result `{actions} actions proposed`; the entry of call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. No undo (`reversible: nothing`: it proposes only).

## State

Reads `ids.composition_id`, `ids.scenario_ids`, `choices.run.profile`. Writes nothing.

## Test cases

- The card (full text with the cost line and the profile), composition card without a profile, Polish.
- The yes: one POST with the scenario and the profile, datasets untouched in the fake, the turn counted, entry with the consent and no undo.
- Composition and an explicit profile, no profile; the defaults from the state; no actions, many actions with kinds, issues and chips.
- Unticked, declined, cancelled; another message or profile is a new card; no argument confirms; a client that cannot ask.
- Both targets, unknown target, a scenario by name, arguments outside the catalog, a failing copilot.
- Secret sentinel: a secret and an instruction in the names, the message, the reply, the issues and the chips (and `test/tools/data/canary.ts`).

## Out of scope

Applying a proposed action, several scenarios in one call, the conversation history (`data_get_copilot_history`).
