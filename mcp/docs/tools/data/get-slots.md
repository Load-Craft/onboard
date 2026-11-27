# data_get_slots — contract

Tool: `data_get_slots` (module `data`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments and the two auxiliary reads added to the catalog entry before this tool).

## Arguments (exactly the catalog's)

- `scenario_id?`: UUID of a scenario.
- `composition_id?`: UUID of a composition. Not with `scenario_id` (`invalid`, no request).

Neither given: the composition of the state (`ids.composition_id`), else the only scenario of `ids.scenario_ids`; none of them
or several scenarios: `missing_argument` naming `scenario_id`. An unknown argument is refused (strict schema). The project is
the one of the workspace.

## Operations

| target      | slots and compatible datasets                   | bindings (auxiliary)              |
| ----------- | ----------------------------------------------- | --------------------------------- |
| scenario    | `GET …/gatling/scenarios/{id}/slots/options`    | `GET …/gatling/scenarios/{id}`    |
| composition | `GET …/gatling/compositions/{id}/slots/options` | `GET …/gatling/compositions/{id}` |

Two requests, sent together. The options read is the answer: its failure ends the call (404: `not_found`). The detail read is
auxiliary: an error of the backend leaves the slots and marks the bindings unknown. Only the id of the dataset a slot is bound to
is read from the detail, with the state of the binding; no other field.

## format=data

`project_id`, `target` (`kind`: `scenario` or `composition`, `id`), `count` (slots), `bound` (slots with a binding; null when the
bindings are unknown), `bindings` (`read` or `unknown`), `slots[]`: `slot`, `label`, `role`, `identity_kind` (`existing`,
`fresh` or null), `columns[]` (at most 20) with `columns_total`, `never_fabricated_columns[]`, `generated` (rows ride in the
scenario), `generated_rows`, `binding` (`state`: `bound`, `stale`, `unbound` or `unknown`; `dataset_id`; `dataset_name`, taken from
the slot's compatible datasets, null when the dataset is not among them), `options[]` (`id`, `name`, `rows`; at most 10) with
`options_total`.

**Third party:** every slot key, label, column and dataset name passes `content()`. A slot of credentials is named and its
columns listed; no cell of a dataset is read anywhere.

## Text view

```
Data slots of scenario b7e2d495-…: 2 slots, 1 bound
1. search_phrases "Search phrases" (data): columns q; bound to "search phrases"
   compatible datasets (1): "search phrases" [8b4e2c70-…] 500 rows
2. accounts (auth, existing logins): columns email, password; not bound; never generated: email, password
   compatible datasets: none
```

## State

Reads `ids.project_id`, `ids.scenario_ids`, `ids.composition_id`; writes nothing. The log carries the id of the target and
`{slots} slots, {bound} bound` (`unknown` when the bindings could not be read).

## UI

Text only.

## Test cases

- Ordinary: a scenario with bound and unbound slots, a composition, the defaults from the state, data, Polish view, log entry,
  exact requests.
- Edge: no slots, a stale binding, the detail read failing with 500 (bindings unknown), the options read failing, unknown
  scenario (not_found), both ids, no id, more options and columns than shown.
- Adversary: sentinel in a label, a column and a dataset name; an instruction in a label stays one line; argument outside the
  catalog refused.

## Out of scope

Pinning a dataset to a slot (`data_set_bindings`), the readiness verdict of a run (`data_check_readiness`).
