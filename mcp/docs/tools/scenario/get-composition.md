# scenario_get_composition — contract

Tool: `scenario_get_composition` (module `scenario`; level 1, class read+secret, `readOnlyHint: true`, no card, no undo; text
view and `format: "data"`; the description, the annotations and the log templates are the catalog's, through
`meta.generated.ts`). Matches the catalog: yes (argument added to the catalog entry together with this tool). `install_allow`
is false.

## Arguments (exactly the catalog's)

- `composition_id?`: 1–200 characters, the composition's id or its name; default `ids.composition_id` of the state. A UUID goes as it
  is; a name is looked up in the project's compositions first (one more request; no match `not_found`, several `ambiguous`). Neither
  given nor in the state: `missing_argument`, no request.

An unknown argument is refused (strict schema).

## Operations

`GET /projects/{project_id}/gatling/compositions/{composition_id}` — one request.

## format=data

`project_id`, `composition`: `id`, `name`, `description`, `status`, `mode`, `updated_at`, `members[]` (at most 50: `link_id`,
`scenario_id`, `scenario_name`, `variant_label`, `proportion` 0–1, `enabled`, `pinned_version`, `current_version`, `has_drift`,
`drift_fields`, `think_time_ms`, `own_injection`, `datasets` as a count), `test_type` (`type` and the plain `params` the test type was set with, at most 20; nested values are not read; null when none is set), `load_profile` (`shown` with the masked JSON text cut at
600 characters, `hidden` with the size, or `none`), `header_names` (at most 40) and `header_count`, `think_time_ms`,
`pause_distribution`, `throttle_steps` and `bound_slots` as counts, `validation` (the stored verdict: `is_valid`,
`authoring_valid`, `effective_status`, `last_validated_at`, `total_proportion`, `errors` and `warnings` at most 10 each,
`missing_bound_feeders`) or null.

**Secrets and third party:** the values of the default headers are never read (only their names); `callBackend` registers them.
The name, description, members' names and labels, header names and the messages of the check pass `content()`; the load profile
is a recorded body and passes `body()`. A member's artifact, contract, digests and dataset details are never read.

Text details: a member pinned to an older version says whether the scenario changed since (`the scenario changed since (v3 now)`) or only carries a newer number over the same content; a check without a date says so and a valid check with warnings counts them; the messages of the check are the backend's and are shown quoted and marked `(LoadCraft)`; a composition without a think time of its own says the members set it.

## Text view

```
mix [73c1e5a9-…] — ready
3 members:
  1. browse [b7e2d495-…]: 40.0% of the traffic, pinned v1
  2. shop [28a9c1f6-…]: 50.0% of the traffic, pinned v1, the scenario is v3 now, 2 datasets
  3. account [f4d0b73a-…]: 10.0% of the traffic, pinned v1, off
test type: load_test (ramp_up_seconds 30)
load profile: {"type":"ramp","users":10}
default headers: x-api-key (values never shown)
pauses: normal, think time 500 ms
last check (2026-11-25 08:00): not valid
  error: …
```

## State

Reads `ids.project_id` and `ids.composition_id`; writes nothing. The log carries the id as resolved, the name, the number of
members and the status.

## UI

Text only: the model reads the composition here; the mod shows the process.

## Test cases

- Ordinary: the composition of the state, the argument over the state, drifted / off / own-injection members, errors and
  warnings of the check, load profile (shown and cut), data, Polish view, log entry, one request.
- Edge: no id (missing_argument, no request), unknown composition (404), no default headers, no stored check.
- Adversary: header values (sentinel) never in the text, the data or the log; sentinel in name, description and a check message;
  500 quoting a credential; an instruction and control sequences in texts; argument outside the catalog refused.

## Out of scope

The list (`scenario_list_compositions`), the check itself (`scenario_check_composition`), the generated code and any write.
