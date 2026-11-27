# scenario_get — contract

Tool: `scenario_get` (module `scenario`; level 1, class read+secret, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments and the description added to the catalog entry together with this tool).
`install_allow` is false: the tool is not on the install allow list.

## Arguments (exactly the catalog's)

- `scenario_id?`: UUID; default: the only scenario in `ids.scenario_ids` of the state. None or several: `missing_argument`
  naming `scenario_id` (the model lists with `scenario_list`), no request.
- `include?`: any of `contract`, `drift`, `artifact` (at most 3). Without it the tool reads the scenario alone.

An unknown argument or include value is refused (strict schema).

## Operations

| call       | requests                                                                  |
| ---------- | ------------------------------------------------------------------------- |
| scenario   | `GET /projects/{project_id}/gatling/scenarios/{scenario_id}`              |
| `contract` | `GET …/scenarios/{scenario_id}/contract`, sent together with the scenario |
| `drift`    | `GET /scenarios/{scenario_id}/staleness`, sent together with the scenario |
| `artifact` | none: the stored artifact is in the scenario's answer and is only shown   |

The contract and the drift score are auxiliary reads (`settleAll`): an API error there leaves the scenario and marks the part
`unavailable`; a 404 of the drift read means no check cached a score yet (`none`). A failure of the scenario read ends the call.

## format=data

`project_id`, `scenario`: `id`, `name`, `description`, `version`, `is_active`, `class_name`, `source_flow_id`,
`source_flow_version`, `generator_state`, `tags`, the self-check (`status`, `version`, `notes`, `missing_slots`, `repairs` as a
count, `failure` `{request_name, http_status, message}`) or null, `slots[]` (`slot`, `label`, `role`, `identity_kind`,
`strategy`, `binding`: `bound` | `stale` | `unbound`). With `contract`: `contract` (`required_inputs`, `exports`,
`session_vars`, `control_vars`, `locals`) and `contract_state` (`none` | `read` | `unavailable`). With `drift`: `drift`
(`state: read` with `score` 0-1 and `checked_at`, or `none`, or `unavailable`). With `artifact`: `artifact`
(`shown` with the masked JSON text, cut at 6000 characters and flagged `truncated`; `hidden` with the type and size when the
mask cannot read it; `none`). Not requested: `null`.

**Secrets and third party:** the scenario's name, description, notes, failure message, labels and variable names pass
`content()`; the artifact is a recorded body and passes `body()`. Header values, thresholds, slot bindings' dataset ids and
the rest of the answer are never read.

Text details: a description the generator wrote (`Generated from flow …`) is not repeated, the source-flow line says it; a failure
with no request name or status of its own takes them from the failed step of the latest run of the check; moments are shown as
`2026-11-25 08:00` (UTC; the data keeps the ISO instant); the artifact header says `secrets masked`.

## Text view

```
browse v1 [b7e2d495-…]
Customer browses categories and products.
from flow d3a6f0b8-… v2
self-check: passed
no data slots
variable contract:
  needs: none
  exports: product_id
drift: 0.35 (0 fresh, 1 stale), checked 2026-11-25 08:00
```

## State

Reads `ids.project_id` (workspace binding) and `ids.scenario_ids`. Writes the self-check verdict of the scenario step (`steps.scenario`): ok for `passed` and
`passed_after_repair`, not ok for `failed` and `goal_step_missing`, nothing for a check that is running, waiting or never ran.
The log carries the id as resolved, the name, the version and the status of the check (`none` without one).

## UI

Text only: the mod reads the verdict from the state; the model reads the scenario here.

## Test cases

- Ordinary: default scenario from the state, the argument over the state, slots bound and not, each include and the number of
  requests, `format: "data"`, Polish view, log entry, state verdict.
- Edge: no id and none or several scenarios in the state, unknown scenario (404), contract or drift failing with 500, a failing
  scenario read with `include`, drift never cached, a waiting check writes nothing.
- Adversary: sentinel in name, description and artifact (header, password, bearer), 500 quoting a credential, an instruction and
  control sequences in a name, strict schema (argument outside the catalog, unknown include, malformed id).

## Out of scope

The versions of a scenario (`scenario_get_versions`), the Scala source (not in the scenario's answer) and any write.
