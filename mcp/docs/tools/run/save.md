# run: save_profile — contract

Tool: `run_save_profile` (module `run`, `moduleTool`; write, level 1, no card; text view and `format: "data"`; the description, the
annotations and the log templates are the catalog's, through `meta.generated.ts`). `run_save` has its own contract, `save-run.md`.
`run_delete` is level 3 and is not written here.

## Arguments (exactly the catalog's)

`profile?` 1-120 (an id or a name, case ignored; without it a profile is created); `name?` 1-120; `type?` one of `at_once`, `ramp`,
`constant`, `stress`, `spike`, `soak`, `ramp_concurrency`, `constant_concurrency`, `custom`; `users?` 1-1000000;
`duration_seconds?` 1-86400; `ramp_duration_seconds?` 0-86400; `description?` 1-500; `is_default?` boolean. The project is the bound one.

Local refusals, `invalid_arguments`, nothing sent: a creation without `name` or `type`; a change with no field.

## Operations

- create: `POST …/gatling/configurations` with only the fields given (the backend fills users 10, duration 60, default false).
- change: `GET …/gatling/configurations` (the name is found in the list; `not_found` listing the names, `ambiguous` for two), `GET
…/configurations/{id}` (the values before), then, only if a value differs, `PUT …/configurations/{id}` with the changed fields. The
  backend leaves a field that is not sent, or sent as null, as it is, so the tool never sends null.

## Data, log, undo

Data: `project_id`, `id`, `name` (masked text), `created`, `changed` (field names), `type`, `users`, `durationS`, `rampS`, `isDefault`
(the profile after the call), `previous` (values before, for the changed fields), `undoable`, `notUndoable` (`secret`, `was_empty`,
`default_moved` or null). Log: args `{name}`, result `profile {name} saved`.

Undo of a change: `run_save_profile` with `profile` (the id) and the previous values of the changed fields (`update.log.undo_args`). Not
offered when a previous text held a secret (it would be kept in the state file), when the ramp was never set (it cannot be cleared), or
when the default flag was taken over from another profile (the undo would not give it back). The undo of a creation is the deletion of the new profile: `run_delete` with `kind: "profile"` and `item_id` (its id),
named in `undo_args` (`undo_tool`), consent level 3, so it runs only after its own card; the view of the creation says so.
A change that finds every value already as given writes
nothing and has no undo.

## Text view

```
Load profile "Spike" updated: users (spike, 800 users, 900 s).
users was: 400
```

## Tests

Creation (the POST body, the object, no undo declared), the two refusals, a change by name restored from the log (`expectUndoRestores`
compares the stored object), only changed fields sent, nothing to change, the three not-undoable cases, `not_found`, arguments outside the
catalog, a backend refusal that changes nothing, the Polish view, the sentinel cases (`canary.ts`).
