# run_save — contract

Tool: `run_save` (module `run`, `moduleTool` on the conditional consent card; write, level 1, level 3 `scheduled_run` for some calls;
text view and `format: "data"`; the description, the annotations, the card and log templates are the catalog's, through
`meta.generated.ts`; `anthropic/requiresUserInteraction`). Design of the card: `docs/consent-card.md` (a level-1 tool that asks for some
calls). Matches the catalog: yes.

## Arguments (the catalog's)

- `saved_run_id?`: UUID. Without it a new saved run is made, with it that one is changed.
- `name?`: 1-120; required for a new saved run.
- `scenario_id?`, `composition_id?`: UUID; exactly one for a new saved run, none for a change (the target never changes; rules
  `run_save_target_one_of`, `run_save_target_fixed`).
- `source_execution_id?`: UUID; new only.
- `environment_id?`: UUID; set or change, never clear. Never taken from the state: it is chosen, not guessed.
- `target_base_url?`: 1-500; set or change, never clear.
- `workload?`: a strict object `{type 1-20, vusers >= 1, ramp 0-86400 (default 0), hold 0-86400 (default 0), thresholds? (list of objects, up
to 20), production?}`; replaced as a whole. `production` goes with `type: production` only, and then ramp and hold are 0 (rule
  `run_save_production_only`). `steps_digest` and `think_time_digest` are written by the server and are refused.
- `feeder_bindings?`: `{slot: dataset id}`, replaced as a whole.
- A change names at least one of `name`, `environment_id`, `target_base_url`, `workload`, `feeder_bindings` (rule `run_save_at_least_one`).
- No argument carries consent or skips the card: `confirm`, `consent`, `token`, `proceed`, `skip_card` and any field of the schedule are
  refused as unknown arguments.

## Operations

A new saved run: `POST …/gatling/saved-runs` (201). It is unscheduled, so nothing it sets starts anything by itself: no card. A change: `GET
…/saved-runs/{id}` (the saved run as it is), then `PUT …/saved-runs/{id}` with only the parts that differ. A part equal to the stored one is
not sent; when nothing differs the answer says so and nothing is sent.

## When it asks

The card (level 3, reason `scheduled_run`) is made exactly when the saved run read from the backend has a schedule that is on and not
paused (`schedule_enabled` and not `paused`) and the call changes the load, the environment or the target address (a value that differs from the
stored one). Everything else runs at once as a level-1 write: a new saved run, a name, the data bindings, any change of a saved run without
a schedule or with a paused one. This is decided from the backend's saved run, never from an argument. `run` reads the saved run again and,
for a call that went on without a card, refuses with `run_save_schedule_started` when a schedule started in between.

## The card

Facts (hashed): `name` (stored, masked), `saved_run_id`, `cron` (masked), and for each touched part `workload` / `environment` / `target`
(from, to). The next start (`next_run_at`) is shown in the title and is not part of the hash (`volatile`): a start that moves between the
card and the yes does not make a new card. Lines: the schedule and that every following start sends the new values, then each change from ->
to. No cost line (the catalog names none: the reason line says the next start uses the change without another question).

## format=data (the result)

`saved_run_id`, `name` (masked), `created`, `changed` (`name`, `workload`, `environment`, `target`, `feeder_bindings`), `undo` (`values`,
`removal`, `withheld`, `none`). The card answers `ConsentCardData` with `volatile: { next_start }`.

## Log and undo

args `{name}`, result `saved run {name}`; the entry of a card is `queued`, one that was confirmed carries `consent.via: client_dialog`, one that
ran at once carries no consent. Undo: a new saved run is `run_delete` (`kind: saved_run`, `item_id`, level 3, its own card); a change is
`run_save` with the previous values of what changed (a change of a scheduled run asks again). Not kept (`withheld`, the view says so): an
environment or an address that had no value (the backend cannot clear them), a load that was not stored or is a production plan (the spec it
was fitted from is gone), a previous value that would carry a secret.

## State

Reads `ids.project_id`. Writes nothing.

## Test cases

`test/tools/run/save.test.ts`: a new saved run at once with its undo; every rule and every argument outside the catalog; changes that need no
card (no schedule, paused, off, name, data bindings), values already as given, unknown saved run; the card of a scheduled run (load,
environment, address, with a rename), the yes (one PUT, the fake compared, the entry and the undo, the undo asked again), the next start that
moves, no/declined/cancelled, Polish; what the model cannot do (no argument skips the card, every touching call gets one, no client that can
ask, a schedule started in between); the undo that cannot be kept; secrets. Sentinel cases in `test/tools/run/canary.ts`. The block itself:
`test/tools/kit/consentConditional.test.ts`.
