# scenario_ask_copilot — contract

Tool: `scenario_ask_copilot` (module `scenario`; level 2, class costly, `readOnlyHint: false`, `destructiveHint: false`, a consent card with a cost
line; text view and `format: "data"`; description, annotations, card and log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes. Written on the block of `docs/consent-card.md`.

## Arguments

- `scenario_id?`: string 1–200, id or name; default: the only scenario of the workspace (`ids.scenario_ids`), else `missing_argument`.
- `message?`: string 1–4000, the question for the copilot.
- `review?`: boolean; `true` is the standard readiness review (a fixed prompt) instead of a question.
- Exactly one of `message` and `review: true` (`invalid_arguments`, rule `copilot_ask_one_of`, before any request).
- `profile?`: object, the load profile to discuss (`type`, `vusers`, `ramp`, `hold`); default: the one the workspace chose (`choices.run.profile`);
  it goes to the backend as the `workload`. A type the copilot does not model is the backend's refusal.
- The model has no argument that confirms (`confirm`, `consent`, `token` are refused).

## Operations

1. Call 1 (the card, reads only): the scenario (resolver, then `GET …/scenarios/{id}`) for its name.
2. After the yes: `POST …/scenarios/{id}/copilot/messages` with `{message, workload?}`, or `POST …/copilot/messages/review` with `{workload?}`. The
   call may wait 180 s (`callBackendFor`): one or two model calls, the plan tried once more when it fails validation.

## The card

Title `Ask the scenario copilot about "<name>"`. Lines: the question (cut to 300 characters) or the review, the load profile (masked JSON, cut; `(none)`),
that it proposes actions and applies none and keeps the exchange in the scenario's copilot history. Cost: `one or two LLM calls`. Nothing to undo.

## format=data

`scenario_id`, `name`, `mode` (`message`, `review`), `reply` (masked, cut to 1500; `reply_cut`), `proposals` (at most 10: `kind` of `adjust_and_regenerate`,
`generate_slot_feeder`, `rewrite_validator`, `about` the slot or validator, `summary`), `actions` (how many the copilot proposed). Every text is model
text: masked, one line.

## Log and undo

Args `Ask the scenario copilot about {name}`, result `{actions} actions proposed`; the entry names `consent.via: client_dialog`. No undo: nothing of the
scenario changes. Nothing the copilot proposes is applied; each proposal is for the user to decide.

## State

None written.

## Test cases

The card (text, no model call, entry `queued`, one card kept); a review card with the profile of the workspace; no profile; the scenario by name; Polish;
the yes (one call, the body, proposals shown, scenario unchanged, entry); a review; no proposal, a cut reply and more than ten proposals; a workload the
copilot does not model; `unticked`, `declined`, `cancelled`; other arguments and a renamed scenario are a new card; `confirm`/`consent`/`token`
refused; a client that cannot ask; `message` and `review` together or neither; the default scenario; unknown scenario and arguments outside the
catalog; secrets and an instruction in names, question, profile, reply and proposals (also two cases in `canary.ts`).
