# process_set_choices — contract

Tool: `process_set_choices` (module `process`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text view
and `format: "data"`; description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (argument added to the catalog entry together with this tool).

## What it is

The user's decisions that module tools use as defaults (flow method, journeys, traffic split, environment, load profile, run target) live in
the `choices` of the process state of the workspace. This tool writes them. It sends nothing to LoadCraft and nothing to the target.
The decisions of a consent card (`process_set_decision`) are out of scope.

## Arguments

- `choices`: object, required, not empty. Groups `flows`, `scenario`, `run`, `data`, `functional`, each an object of fields. The groups, the
  fields and their validation (enums, ids, ranges, the load profile) are the state schema's own (`ProcessUpdate.shape.choices`), read at
  start-up, not a list kept here; an unknown group or field, or a value the schema refuses, is refused locally (no state touched).
  A field set to `null` is cleared. A field is replaced whole (the load profile is one value).
- Empty `choices` (or only empty groups): refused (`invalid_arguments`, rule `choices_empty`).

## Operations

None (no HTTP request).

## format=data

`changed` (paths `group.field` the call changed), `unchanged` (paths already as given), `set` (`path` -> the new value, for the changed
ones that were set), `cleared` (changed paths that were cleared). Values pass `content()` as one-line JSON text.

## Text view

```
Choices updated: flows.method, run.profile.
flows.method = "har"
run.profile = {"type":"production","vusers":200}
run.env_id cleared
```

Nothing changed: `Choices: nothing to change, they are already as given.`

## Undo

`undo: {tool: "process_set_choices", args: {choices}}` with the previous value of every changed path, `null` for one that had none. A call
that changed nothing leaves no undo entry. Previous values that the secret mask would change are not offered for undo (the view says so).

## State

Reads and writes `choices` through the `update` of the outcome; the reducer merges, validates and invalidates (the table of the catalog
reacts to `choices.run.env_id`, `choices.scenario.split` and the others, by value change, not in the tool).

## UI

Text only.

## Test cases

- Ordinary: set a flow method, a profile, a target; the state file holds them; clear a field with null; several groups at once.
- Undo: write, take the undo from the log, call it, `choices` is as before (also for a field that was not set).
- Invalidation: a changed `choices.run.env_id` resets the checks the table names; the same value again does not.
- Edge: nothing changes (inert, no undo); empty choices; unknown group, unknown field, a value the schema refuses (profile with 0 vusers,
  method outside the enum, an id that is not a UUID); no bound project; Polish view; log entry; the keys follow the schema (a test reads
  them from it).
- Adversary: a secret-shaped text in a field (`account_ref`) is masked in view, log and state refusal rules of the state file; an instruction
  in a journey name is shown as one line of data.

## Out of scope

`process_set_decision` (decisions on consent cards).
