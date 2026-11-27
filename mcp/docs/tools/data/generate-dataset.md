# data_generate_dataset — contract

Tool: `data_generate_dataset` (module `data`; kind `process`, level 2, class costly, `readOnlyHint: false`, a consent card, `install_allow` false;
text view and `format: "data"`; the description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool). Written on the consent card (`docs/consent-card.md`) and,
for a flow, on the block of a long operation (`docs/long-operation.md`).

## Arguments (exactly the catalog's)

- `flow_id?`, `scenario_id?`: 1–200 characters, an id or a name; the target. Exactly one of them; neither: the only flow of the workspace
  (`ids.flow_ids`), else the only scenario (`ids.scenario_ids`), else `missing_argument`.
- `slot?`: 1–100 characters, one data slot of the scenario; only with `scenario_id` (a flow cannot have one).
- `rows`: 1–100000, default 100. `name?`: 1–200, the new dataset's name (default `AI data for <target>`); not for a slot. `feeder_type`: `csv`
  (default), `tsv` or `json`. `enrich_with_llm`: default true, used for a slot only.

Refused as `invalid_arguments` before any request: `flow_id` with `scenario_id`; `slot` with `flow_id`; `slot` with `name`. No `max_wait_s`, no `confirm`.

## The card

Call 1 resolves the target (a flow or a scenario of the project by id or name; `not_found` before any question) and makes the card: the title names the
target (`Generate a dataset with AI for the flow {target}` / `…scenario…` / `…slot {slot} of the scenario…`), the rows and the file type, the name of the
new dataset (a slot's is named by LoadCraft after the slot), the cost `about one LLM generation per dataset`, and the undo (`data_delete`). Nothing is
sent. The repeat with the same arguments asks the person; only the yes sends the request, once.

## Operations

| target   | request                                                                                                                        | result                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| flow     | `POST …/gatling/feeders/generate-async` `{name, feeder_type, record_count, override_record_count: true, flow_id}` → `{run_id}` | a run, followed on a channel |
| scenario | `POST …/gatling/feeders/generate-from-scenario` `{scenario_id, name, output_type, row_count}`                                  | the dataset, at once         |
| slot     | `POST …/gatling/scenarios/{id}/slots/{slot}/generate-feeder` `{row_count, enrich_with_llm}`                                    | the dataset, at once         |

The synchronous `POST …/gatling/feeders/generate` is not used: a run lost together with its channel would leave a second dataset behind it. The list of
datasets (`GET …/gatling/feeders`) is read only to find the result of a run.

## The run (kind `dataset_generation`)

- **Id.** The id of the operation is the `run_id` the backend returns; the handle is `dataset_generation:<run_id>`. Saved: the project, the flow, its masked
  name, the requested dataset name and rows, the start time.
- **Channel.** `gatlingFeeder` (`/ws/gatling-feeder/{run_id}`): `progress` (step `prepare`, `generate`, `format`, `save` with the percent), `complete`
  (`feeder_id`), `error` (the cause). The backend names the run only in its answer, so the channel is joined after the start; frames sent before are lost.
- **The way back.** When the `complete` frame is lost, or the channel cannot be reached, a read of the list finds the dataset: a new one of the requested name
  created after the start. A run seen to neither end nor appear within 10 minutes counts as lost (`data_generate_failed`).
- **No stop.** The backend cannot stop a run: the kind has no cancel, `process_cancel` answers `not_cancellable`.
- **Result.** The dataset is read once (`GET …/feeders/{id}`): name, rows, columns; the cells are never read.

## format=data

`kind`, `target_id`, `dataset_id`, `name`, `rows` (as the backend counts them), `rows_requested`, `columns` (at most 20), `column_count`, `created` (a slot's
dataset the backend refreshed instead of creating: `false`; null when it does not say). **Third party:** the names of the target, the dataset and the columns
and the cause of a failure pass `content()`.

## Text view

```
Generated the dataset Shop customers: 40 rows, 3 columns.
Columns: name, email, city
To remove it: data_delete with this dataset (it asks the user).
```

A slot's refreshed dataset says `Refreshed the dataset … of the slot`; fewer rows than asked add `You asked for N rows; LoadCraft made M.`

## State

Reads `ids.project_id`, `ids.flow_ids`, `ids.scenario_ids`. Writes: the dataset is added to `ids.dataset_ids`; the row of the operation (the mechanism's). The
log carries the target, the name and the rows; the undo is `data_delete` of the new dataset (`undo_args`).

## Errors

`data_generate_failed` (the cause of the `error` frame, masked, or a lost run; nothing saved), row in `skills/loadcraft-test/references/errors-data.md`.

## Test cases

`test/tools/data/generateDataset.test.ts`: the card (flow, scenario, slot, by name and by state, arguments that do not fit, unknown target, declined); a run
(one request, progress, result, state, log and undo, a frame lost before the connect, a lost channel, the handle and `process_wait`, the same work twice,
an error frame, `process_cancel`); a scenario and a slot (one request, a refresh); Polish; credentials in names, columns and the cause never reach the model
or the state (`test/tools/data/canary.ts`).

## Out of scope

Regenerating one column (`data_regenerate_column`), the rules-based generation (`data_create_dataset`) and the synchronous generate request.
