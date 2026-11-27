# scenario_save_composition — contract

Tool: `scenario_save_composition` (module `scenario`; level 2, class write, `readOnlyHint: false`, `destructiveHint: false`, a consent card,
no cost line; text view and `format: "data"`; description, annotations, card and log templates and undo are the catalog's, through
`meta.generated.ts`). Matches the catalog: yes. Written on the block of `docs/consent-card.md`.

## Arguments

- `composition_id?`: string 1–200, id or name, no default from the state; without it a new composition is created.
- `name?`: string 1–200; required for a new composition.
- `members?`: object, scenario (id or name) -> share in percent (0–100). Replaces the member list. A member that stays keeps what the composition
  holds of it (variant, enabled flag, think time, datasets, overrides); a new one gets the defaults; one left out is removed. Required for a new
  composition. The backend gets `proportion = percent / 100`.
- `profile?`: object, the composition's load profile (`injection_config`); the backend checks it. The kind of test stays `scenario_set_composition_type`.
- Refused before any request (`invalid_arguments`): nothing to change for an existing composition (`composition_save_at_least_one`), a new one with
  no members (`composition_save_create_needs_members`), a scenario named twice (`composition_save_duplicate_member`), `members` on a composition that
  has several members of one scenario (`composition_save_variants`). A new one without `name` is `missing_argument`. Shares outside 0–100 are refused by the schema.
- The model has no argument that confirms (`confirm`, `consent`, `token` are refused).

## Operations

1. Call 1 (the card, reads only): the composition (`GET …/compositions/{id}`) and the named scenarios (resolver).
2. After the yes: the composition again, then `PUT …/compositions/{id}` with only the changed parts (`name`, `scenarios` as the whole list,
   `injection_config`), or `POST …/compositions` (`composition_mode: parallel`, the defaults of the pauses, the members, the profile).
3. `POST …/compositions/{id}/validate` (best effort: a refusal leaves the verdict `unknown`).
4. Values the composition already has: no card and no write (`composition "x": nothing to change`).

## The card

Title `Save composition "<name>"`. Lines: a rename (`was -> now`), one line per member that changes (`name: 40% -> 60%`, `add name: 30%`,
`remove name (was 10%)`, at most 20 and the count), the load profile (`was -> now`, masked JSON, cut). No cost. Undo: the previous name, members and
profile (a removed member comes back with default settings); for a new one, deleting it (the user decides). Names and the profile are masked texts.

## format=data

`composition_id`, `name`, `created`, `changed` (`name`, `members`, `profile`), `members`, `total_percent`, `valid` (`true`, `false`, `unknown`),
`authoring_valid`, `errors`, `warnings` (at most 5 each, masked), `undo` (`previous`, `delete`, `withheld`, `none`).

## Log and undo

Args `Save composition {name}`, result `composition {name} saved; valid: {valid}`; the entry names `consent.via: client_dialog`. Undo of a change:
this tool with the previous values of the parts that changed (`undo_args`); of a new one: `scenario_delete` with the composition (level 3, named
only in the log). A previous value the secret mask would change is not kept: no undo, the answer says so.

## State

`ids.composition_id` = the saved composition; `steps.scenario.composition_valid` = the verdict (`is_valid`) when the backend gave one.

## Slot collisions (the members' slots)

The card and the result add one sentence per slot that members of the composition (after the call) declare differently: another set of columns,
another role, or another kind of identity (new accounts against existing ones), because one dataset is fed to a slot key and cannot fit both. It
is read from `GET …/scenarios/{id}` of each member (`feeder_slots`; a member that cannot be read is left out, fewer than two readable members have
no collision). The sentence names the slot, the members (at most 5) and what differs, never a value. `format=data`: `slot_collisions` (`slot`, `members`,
`member_count`, `differs`). The card's facts carry them too (the same for the same backend state).

## Test cases

The card (text, no write, entry `queued`, one card kept); a rename and a profile on the card; Polish; the yes (writes, validates, entry, state);
the undo run for real; a new composition and its `scenario_delete` undo; `unticked`, `declined`, `cancelled`; other arguments and a changed
composition are a new card; `confirm`/`consent`/`token` refused; a client that cannot ask; nothing to change; shares that do not add up (verdict
false); each rule; unknown composition and scenario; arguments outside the catalog; secrets in names and the profile (also two cases in `canary.ts`).
