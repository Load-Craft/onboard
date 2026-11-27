# scenario_check_composition — contract

Tool: `scenario_check_composition` (module `scenario`; level 1, class read, `readOnlyHint: true` as the catalog has it, no card, no
undo; text view and `format: "data"`; the description, the annotations and the log templates are the catalog's, through
`meta.generated.ts`). Matches the catalog: yes (argument added to the catalog entry together with this tool). The operation is a
`POST` that stores the verdict of the check in the backend and changes no data of the user. `install_allow` is true.

## Arguments (exactly the catalog's)

- `composition_id?`: 1–200 characters, the composition's id or its name; default `ids.composition_id` of the state. A UUID goes as it
  is; a name is looked up in the project's compositions first (one more request; no match `not_found`, several `ambiguous`). Neither
  given nor in the state: `missing_argument`, no request.

An unknown argument is refused (strict schema).

## Operations

`POST /projects/{project_id}/gatling/compositions/{composition_id}/validate` — one request, no body. The backend answers 200 also
when the composition is not valid.

## format=data

`project_id`, `composition_id`, `valid` (`is_valid`: the composition can run), `authoring_valid` (valid as written, before drift),
`effective_status`, `has_drift`, `scenario_count`, `total_proportion` (0–1 summed), `last_validated_at`, `errors` and `warnings`
(counts of each level), `issues` (the count in all) and `issue_list[]` (the first 20: `level`, `message`, `scenario_id`,
`step_index`, `suggestion`, `variable`), `drifted[]` (at most 20: `scenario_id`, `scenario_name`, `variant_label`,
`pinned_version`, `current_version`, `drift_fields`), `missing_bound_feeders` (at most 10 names).

**Third party:** the messages, suggestions, variable and scenario names, and dataset names pass `content()`. The check's raw
`errors` and `warnings` lists and the error and warning details of the answer are not read: `issue_details` carries the same.

The messages of the issues are the backend's: shown quoted and marked `(LoadCraft)`. A drifted member says the scenario changed since it was pinned.

## Text view

```
Composition 73c1e5a9-… does not pass its check (checked 2026-11-25 08:00).
3 members, 100.0% of the traffic in all.
issues: 1 errors, 1 warnings
  error: cart_id is needed and no member exports it (b7e2d495-…, step 3, variable cart_id)
    try: put the browsing member before shopping
  warning: total share is 90%
1 member drifted from its scenario:
  shopping [28a9c1f6-…] pinned v1, the scenario is v3 now; scenario_contract_v2
```

## State

Reads `ids.project_id` and `ids.composition_id`. Writes:

- `steps.scenario.composition_valid`: ok when the composition is valid, not ok otherwise.
- `problems`: an invalid composition opens `composition_invalid` (severity blocker, module scenario, ref the composition) and a
  valid one closes it; drifted members open `composition_members_drifted` (warning) and a check without drift closes it. The
  message of each is a fixed English sentence: no text of the backend ever reaches the state.

The log carries the id as resolved, `valid` and `issues`. The data's `issues` is the count so that it equals the log value.

## Slot collisions (the members' slots)

After the verdict the view adds one sentence per slot that members declare differently (columns, role, identity kind), naming the slot and the
members, never a value; `format=data`: `slot_collisions` (`slot`, `members`, `member_count`, `differs`). The members come from `GET …/compositions/{id}`
and their scenarios from `GET …/scenarios/{id}` (`feeder_slots`); a member that cannot be read is left out. The warning changes no verdict and no problem.

## UI

Text only here: the mod already shows the check and the problems of the process from the state.

## Test cases

- Ordinary: a valid composition (one POST), errors and warnings with member, step, variable and suggestion, drifted members and
  missing datasets, state verdict, data, Polish view, log entry.
- Edge: more than 20 issues (cut with a count), a later clean check closes both problems, no id (missing_argument, no request),
  unknown composition (404, state unchanged).
- Adversary: sentinel in messages and suggestions never in the text, the log or the state; the state's problems carry no backend
  text; a 500 quoting a credential; an instruction and control sequences in a message; argument outside the catalog refused.

## Out of scope

Fixing a composition (changing members, order or pins).
