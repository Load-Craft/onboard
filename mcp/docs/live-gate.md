# Live gate

`npm run gate` walks run 1 of the plugin (from the API documentation to the diagnosis of a test)
on a real LoadCraft backend, through the built server `dist/server.mjs` started as a stdio process,
the way an MCP client starts it. After every step it reads the backend over REST and checks the
effect of the step. The texts of the tool results are read only to drive the run the way a model
does: the names of the proposed journeys, the handles of unfinished operations, the run of a test.

The gate is the acceptance check of a milestone: run 1 must pass twice in a row without manual
intervention.

## The scenarios

`--scenario docs|har|protected|describe` picks what the gate walks: one name, a comma-separated
list or the flag repeated; without it only `docs` is walked. `har`, `protected` and `describe` are
named explicitly (`--scenario docs,har,protected,describe` walks all four, in this order): they have
side effects on the target (`protected` creates one account on the protected environment, the
browser of `describe` signs in and clicks through the application) and `har` and `describe` spend
more model tokens. A configuration without `har` and `describe` works as before.

| Scenario    | What it walks                                                                                                                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs`      | run 1: the documentation to the journeys, the flows, the scenario, the data, the self-check, a test on the main environment, its report and its diagnosis                                                                              |
| `har`       | the recording of the target (`har.file`): `flows_import_har`, then `flows_generate_from_har` with `split: true` through the HAR channel; the flows exist, there is one for each journey, and they hold pauses taken from the recording |
| `protected` | the protected environment: a test and an account without the consent of the user create nothing; with it the account is created, the test is clamped to the limit and its report says so                                               |
| `describe`  | flows from a description: `flows_describe_journeys` reads the plan from the channel of the run, `flows_record_journeys` approves the safe paths and the LoadCraft browser walks them; a flow is saved, with pauses of a person         |

Every run starts with the project and its two environments (steps 1 and 2) and ends with the final
status. `protected` needs a scenario to run, so it walks the steps that build one (the journeys,
the flows, the composition, the data and the self-check) even when `docs` is not named; `har`
stands on its own and costs one generation of flows from the recording; `describe` stands on its
own as well (see "Flows from a description").

## Who runs it

The gate sends real traffic to the target application, compiles Gatling scenarios, reads test
results from the metrics stack and spends model tokens. It is started by the coordinator of the
work, **after the owner of the backend agreed to that run**, never as a side step of another task.
It needs, exclusively for its duration:

- a LoadCraft backend started for the gate, from the integration branch, with its own database
  and its own Redis databases — never a backend somebody works with;
- the Gatling build cache of that backend (every generated scenario is compiled);
- the observability stack the backend reads test results from (Prometheus);
- the target: a demonstration application that may be loaded, reachable from the backend;
- a Langfuse project the backend reports its model calls to, readable with an API key pair, and
  a tracing environment of the gate backend alone: `LANGFUSE_TRACING_ENVIRONMENT` in the
  environment of that backend (for example `mcp-live-gate`), the same name in
  `langfuse.environment` of the gate configuration.

## What the backend must have

- An API token of a user who may create projects (`LIVE_GATE_API_TOKEN`).
- Model access for the analysis, the journeys, the scenario generation and the diagnosis.
- The probes of the gate's project enabled. This is a setting of the project, not of the backend:
  `probes_enabled` of the project's Gatling settings is off when a project is created, and a user
  switches it on in the frontend. The setup of the project does not need it, but `data_create_accounts` and the
  self-check refuse without it, as the plugin should. The gate
  sets it itself right after step 1, for the project it created in this run only and on the backend
  the approval names: `PUT /api/v1/projects/{id}/gatling/project` with `{"probes_enabled": true}`,
  then a `GET` that must show `true`. The report says "probes enabled by the gate (the equivalent of
  the user's setting)". The plugin has no tool that does this, on purpose. The target must also
  accept requests from the backend for the self-check, which runs every scenario once against the
  default environment.
- Account creation through the target's API (`data_create_accounts` creates the accounts a scenario
  needs on the unprotected environment; the scenario `protected` creates one more on the protected
  one, with the consent the gate gives itself).
- For the scenario `har`: the HAR channel (WebSocket) open to an API token, which is how the
  plugin splits a recording into journeys. The recording itself: see "The recording".
- For the scenario `describe`: a free agent browser, the channel of a run from a description
  (WebSocket) open to an API token, and the frontend of the main environment reachable from the
  backend's browser. See "Flows from a description".

## What it refuses (exit code 2, nothing is started)

Addresses are compared in one spelling: parsed as a URL, the host in lower case without a final
dot, the default port (80 or 443) written out, only `http://` and `https://`, and nothing after
the host and port (no path, user name or password).

- `LIVE_GATE_I_HAVE_APPROVAL` is not the origin of `backend.url`. The approval names the backend
  the owner agreed to, e.g. `LIVE_GATE_I_HAVE_APPROVAL=http://127.0.0.1:8137`; `1` or any other
  origin is refused, with the origin that was expected. Set it only after the agreement above.
- `backend.url` is missing: there is no default backend.
- `backend.url` is `loadcraft.io` or a host under it (the plugin's default
  `https://app.loadcraft.io` included).
- `backend.url` reaches this machine on port 8000, the default port of the LoadCraft development
  backend: `localhost` or a name under `.localhost`, or a host that resolves (DNS, all addresses)
  to any address of this machine — 127.0.0.0/8, `0.0.0.0`, `::1`, `::`, also IPv4-mapped
  (`::ffff:127.0.0.1`). A backend started for the gate listens on another port.
- `backend.url` reaches the same address and port as an entry of `LIVE_GATE_FORBIDDEN_BACKENDS`
  (comma-separated origins) or of `forbiddenBackends` in the configuration. Both sides are
  resolved and compared by address and port, not by text (any address of this machine stands for
  all of them; the scheme does not matter). List there every backend that must never be touched,
  for example the ones people work with on this machine. An entry that is not an origin (e.g.
  `127.0.0.1:8001` without `http://`) is refused, never skipped.
- This machine is also recognised by the addresses of its own network interfaces (the LAN address
  among them, `os.networkInterfaces()`): a backend or a target under such an address on port 8000
  is refused, and it is the same address as a forbidden `http://127.0.0.1:…` entry on the same port.
- A host of the backend, of a target or of a forbidden entry that does not resolve: it cannot be
  checked.
- **The target of the load.** `backend.url` is not the only address the load goes to: the
  environments of `project_save_env` (`environments.main` and `environments.capped`) are where the
  connection probe, the self-check, the accounts of `data_create_accounts` and both tests go. Their `api`
  (and `frontend`, when given) must be explicit origins (`https://api.example.com`; a bare host or
  a path is refused), and every one of them must be listed in `LIVE_GATE_TARGET_APPROVAL`:
  comma-separated origins, in any spelling that normalises to the same origin, e.g.
  `LIVE_GATE_TARGET_APPROVAL=https://api.perf.example.com,https://api.qa.example.com`. Set it only
  once the owner of each target agreed to the run, separately from the approval of the backend
  (an unlisted target, a port or scheme that differs, an entry that is not an origin: refused).
  Checked like the backend, after resolving DNS: no `loadcraft.io` or host under it, no port 8000
  of this machine, no address and port of a forbidden backend. `telemetry.url` is only read from,
  so it needs no approval; it must be an http(s) address, not `loadcraft.io`, not port 8000 of this
  machine. `--fake` needs no approval of the targets (nothing real is touched) and resolves no
  names, but the refusals about where they lead apply there too.
- The configuration lacks a part (`environments`, `langfuse`, `workspace`, `profile`, …) or has a
  value of the wrong type: the refusal lists every such part.
- The scenario `har` is walked and `har.file` is missing, or `har.minFlows` is not a whole number
  from 2 to 10 (one flow is what a call without a split gives, so it proves nothing about the
  split). The other scenarios do not need the recording.
- The scenario `describe` is walked and `describe.description` (at least 20 characters) or
  `describe.envFile` is missing; `describe.minPaths` is not a whole number from 1 to 10,
  `describe.maxSteps` not from 1 to 60, `describe.timeoutMin` not above 0 and at most 20, or a key
  name is not one an env file can hold; `environments.main.frontend` is missing (it is checked like
  every target: approval, port 8000, forbidden backends). The env file cannot
  be read, has no login or no password under the keys, a value holds a single quote or a line
  break, or the password is shorter than 8 characters or a part of the description or of the login
  (see "Flows from a description"). The other scenarios do not need the section.
- `accounts` is not a whole number from `profile.vusers` to 200. A slot that needs more than 200
  accounts fails the step instead of creating them.
- `accounts` is `{"file": ...}` and the file cannot be read, is empty, has no row, has no column
  with a password in its header, or has a password shorter than 8 characters (the search for the
  passwords would prove nothing on it). The refusal never quotes a cell.
- The token or the Langfuse keys are missing, the backend does not accept the token
  (`GET /api/v1/auth/me`), or the first read of the cost counter fails: the gate never runs
  without a cost limit.
- `langfuse.environment` is not set: the counter would count the cost of other backends of the
  same Langfuse project, or nothing at all.
- A project of an earlier gate run is still on the backend (named
  `<projectPrefix>-YYYYMMDD-HHMMSS`):
  a failed or stopped run keeps its project for inspection. The refusal lists each such project
  with the command that deletes it; delete them, or start with `--reuse` to run next to them
  (they stay untouched).
- The load is more than the small ramp: `ramp_concurrency` with at most 20 users and only the keys
  `type`, `vusers` and `ramp`; every phase a profile could name (`ramp`, `hold`, `duration`, …)
  counts into its length, at most 60 s. Only these three checked fields are sent to `run_start`.
- `costLimitUsd` is not above 0 and at most 20, or `timeoutMin` is not above 0 and at most 120.
- The main environment has a limit (the full test runs on an unprotected environment), or the
  capped environment has no user limit below the profile's users (the clamp check would prove
  nothing).

## Limits during the run (exit code 1)

- **Cost.** The cost counter is the sum of `totalCost` of the observations of the tracing
  environment `langfuse.environment` in the Langfuse project since the start of the gate
  (`GET /api/public/v2/metrics`, view `observations`, filtered by `environment`; `langfuse.api:
"v1"` uses `GET /api/public/metrics` of a self-hosted Langfuse v3). It is read before every
  step, every 15 s during a step and at the end. Above `costLimitUsd` (default 3 USD) the call in
  progress is abandoned and the gate stops. If the counter cannot be read during the run, the gate
  stops as well.
- **Time.** `timeoutMin` (default 45 minutes) from the start, checked the same way. It is the
  second safeguard against spending: see the known limitation below.
- **The walk.** `describe.timeoutMin` (default and at most 20 minutes) from the call of
  `flows_record_journeys`, checked the same way: the LoadCraft browser spends model tokens at every step.

**Known limitation: the counter lags.** Langfuse shows a model call only after it was ingested.
For data sent by older SDKs (the Python SDK before 4.7, which includes the 3.x line) the metrics
endpoint may show it up to about 15 minutes late. The gate therefore sees the spending of the last
minutes late and may pass the limit by what was spent in that window before it stops; the final
read after the last step counts what came in meanwhile and fails the gate if the total is over the
limit. The time limit bounds how long spending can go on unseen.

When the gate does not pass — a limit, a failed step, or SIGINT / SIGTERM (Ctrl-C, `kill`) — it leaves nothing loading the target: it
calls `process_cancel` with the handle of the operation it was waiting for, if it had one, and then reads
the runs of its project on the backend and cancels every run still under way by its id
(`POST …/gatling/executions/{id}/cancel`), twice, three seconds apart, so a run whose start was in
flight when the call was cut — before any handle came back — is stopped as well. A run from a
description is stopped the same way: `process_cancel` with its handle (`record_run:…`, or the handle of the
plan `r-…` while it waits for its approval or before a handle came back), then every run of a
description of the user still queued or running is cancelled on the backend
(`POST …/scenario-from-description/runs/{id}/cancel`), in the same two rounds. The report lists
all of it under “Stopping” and, for a signal, names it (`interrupted by SIGINT`); the project is
kept like after any other failure. A second signal leaves at once, without the cleanup. Other operations without a handle (a generation cut in its first
call) have no list on the backend the gate could find them by; the report then says that no
handle was known.

**Redirects.** Nobody follows a redirect. The gate's own requests to the backend and to Langfuse
use `redirect: 'error'`: a redirect would lead to an address the checks above never saw. The MCP
client of the gate talks to the server over stdio, without HTTP. The server's own HTTP client does
not follow a redirect of the backend either: it answers the tool call with `[unexpected_redirect]`
and does not send the request on. A backend that redirects only a single route therefore fails
the step that uses it; the check of the token (`GET /api/v1/auth/me`) refuses a backend that
redirects there before anything starts.

## The steps

| #   | Scenario            | Tool                              | What the gate checks on the backend                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | all                 | `project_create`                  | the setup in five calls (`project_create`, `project_save_env`, `project_check_env`, `project_analyze_setup`, `project_apply_setup` with the analysis handle read from the text); the workspace is bound to the new project; the main environment exists unprotected; the capped one is protected with the configured limits; every configured fixed header exists on its environment (see "A fixed header of the target")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2   | all                 | `project_connect_telemetry`       | only with `telemetry` in the configuration; the call succeeds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3   | `docs`, `protected` | `flows_suggest_journeys`          | at least `journeys` proposals are listed; with `journeys.prefer` the first safe proposal of each pattern, the rest filled by the safe default; with `journeys.names` exactly those proposals (each name must be in the text); otherwise the first `journeys` that are safe (see "Choosing the journeys")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4   | `docs`, `protected` | `flows_generate_from_suggestions` | a flow of each taken name is saved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | `docs`, `protected` | `scenario_suggest_split`          | the proposal of the traffic split (no check beyond success)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 6   | `docs`, `protected` | `scenario_generate`               | the composition is saved; every flow has a generated scenario with a saved version (≥ 1); an error of the generation or of the compilation fails the step through the tool's answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | `docs`, `protected` | `data_check_readiness`            | the data plan (read-only, no check beyond success)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 8   | `docs`, `protected` | `data_create_accounts`            | the preflight of the profile (`process_get_status` with `preflight` and `format: "data"`) names the slots short of data; the slots of plain data (coupon, quantity, notes …) are filled first, without a secret: `data_check_readiness` lists the `data_create_dataset` calls that make the rows of a slot from its columns (the fake's shopping scenario has such a slot, `scenario_auto_data`); the gate makes each call, gets the consent card (nothing saved), repeats the call with the card's `confirm` token (the owner approved the run beforehand), makes the `data_set_bindings` call the result names after "→ next:" and checks the plan again with `data_check_readiness`; accounts are created (`data_create_accounts`, at least `accounts`) only for the slots still short, and the report line "accounts created: N" is written after the call, from the rows of the slot before and after; the preflight then finds the data ready |
| 9   | `docs`, `protected` | `scenario_check_self`             | checks again the scenarios that have not passed; every scenario's self-check is `passed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 10  | `docs`, `protected` | `run_plan`                        | the profiles for the target users (no check beyond success)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 11  | `docs`              | `run_start`                       | on the main environment, with the thresholds: the run is `completed`, it has an SLA verdict, its manifest holds the requested load on the main environment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 12  | `docs`              | `results_get_report`              | the run has a stored result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 13  | `docs`              | `results_analyze_run`             | an analysis is stored with at least one cause, or with a verdict that states nothing was found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 14  | `har`               | `flows_import_har`                | the recording is accepted; no credential of the recording is in the answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 15  | `har`               | `flows_generate_from_har`         | the flows that are new on the backend: at least `har.minFlows` of them (a split gives one for each journey, a call without a split one), at least one holds a pause whose source is the recording; no credential in the answers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 16  | `protected`         | `run_start`                       | on the capped environment without consent: the answer says the test was not started and nothing was sent, and no run is created (the list of runs is read before and after)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 17  | `protected`         | `data_create_accounts`            | accounts on the capped environment: without `confirm_protected` the answer says nothing was sent and the number of accounts of the slot `accounts` is the same; with it one account is created and the number is exactly one more                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 18  | `protected`         | `run_start`                       | the same as 16 with `confirm_capped: true`: the run is `completed`, its manifest names the capped environment and does not exceed its user limit; warnings the backend put on the run are listed as differences                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 19  | `protected`         | `results_get_report`              | the report of that run carries the note that the load was limited by the environment, with the numbers (the users the manifest records of the users the profile asked for)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 20  | `describe`          | `flows_describe_journeys`         | the plan has at least `describe.minPaths` paths (read from the text); the run channel accepted the handshake (the plan comes only through it); the run waits on the backend for the approval of its paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 21  | `describe`          | `flows_record_journeys`           | the safe paths are approved by this call alone; within the walk limit the run is `completed` with exactly those paths, at least one `saved`; saved flows have pauses of a person with an action class; no password in the answers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 22  | all                 | `process_get_status`              | the final status (no check beyond success)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

The numbers are those of a run of all four scenarios (`--scenario docs,har,protected,describe`); the report numbers the steps that were
walked. The tool that creates accounts is named in one place of the script (`PROVISION_TOOL`), so
a rename of it is one line.

The smoke check of every scenario is the self-check of step 9 (one user, one pass); the load of
the gate is the small ramp of steps 11 and 15. The gate checks the chain, not the capacity of the
target.

The gate passes `confirm_capped: true` in step 18 and `confirm_protected: true` in step 17 itself:
the approval of the whole run, given before the start, covers one clamped test and one account on
an environment that points at the same target. The step that has to see nothing created without
consent (16 and the first half of 17) is the one that finds a plugin which skips the question.

## Configuration

Secrets never go in the file: the token and the Langfuse keys come from the environment.
`scripts/live-gate.config.example.json` is a starting point. Relative paths are resolved against
the configuration file.

| Key                        | Default                            | Meaning                                                                                                                           |
| -------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `backend.url`              | — (required)                       | origin of the backend; the API is under `/api/v1`                                                                                 |
| `backend.appUrl`           | `backend.url`                      | address of the LoadCraft web application, used in the links of the results                                                        |
| `workspace.openapi`        | — (required)                       | the OpenAPI document of the target; copied into a temporary workspace                                                             |
| `workspace.overview`       | —                                  | a Markdown overview of the target, copied the same way                                                                            |
| `projectPrefix`            | `live-gate`                        | the project is `<prefix>-<UTC time>`                                                                                              |
| `composition`              | `gate-mix`                         | name of the composition built from the journeys                                                                                   |
| `environments.main`        | — (required)                       | `{name, api, frontend?}` without `limit`: the full test runs here; `api` and `frontend` are origins                               |
| `environments.capped`      | — (required)                       | `{name, api, frontend?, limit: [users, requests/s]}`, users below `profile.vusers`; usually the same target                       |
| `environments.<x>.headers` | —                                  | `[{name, from_env}]`: fixed headers LoadCraft sends to the target (an API key); never a value, see "A fixed header of the target" |
| `environments.<x>.envFile` | — (required by `headers`)          | the env file, outside the repository, with the variables `from_env` names                                                         |
| `journeys`                 | 2                                  | how many proposals become flows (1–5); or `{count?, prefer?, names?}`, see "Choosing the journeys"                                |
| `har.file`                 | — (required by `har`)              | the recording of the target, see "The recording"; copied into the temporary workspace                                             |
| `har.minFlows`             | 2                                  | flows the split must give, 2 to 10: the number of journeys of the recording                                                       |
| `describe.description`     | — (required by `describe`)         | what users do in the application, in plain words (at least 20 characters)                                                         |
| `describe.envFile`         | — (required by `describe`)         | the env file of the target with the account of the LoadCraft browser, see "Flows from a description"                              |
| `describe.emailKey`        | `TEST_USER_EMAIL`                  | the key of the login in that file                                                                                                 |
| `describe.passwordKey`     | `TEST_USER_PASSWORD`               | the key of the password in that file                                                                                              |
| `describe.minPaths`        | 2                                  | paths the plan must have, 1 to 10 (a plan of one path passes with a note)                                                         |
| `describe.maxSteps`        | LoadCraft decides                  | most browser actions per path, 1 to 60                                                                                            |
| `describe.timeoutMin`      | 20                                 | the time limit of the walk of the paths in minutes, at most 20                                                                    |
| `accounts`                 | 30                                 | accounts created for a slot that lacks them (from `profile.vusers` to 200), or `{"file": "<path>"}`: see "Accounts from a file"   |
| `profile`                  | `ramp_concurrency`, 20 users, 60 s | the load of steps 11 and 15: `type`, `vusers` ≤ 20, `ramp` ≤ 60 s, nothing else                                                   |
| `thresholds`               | p95 2000 ms, errors 5 %            | the SLA thresholds of step 11                                                                                                     |
| `telemetry`                | —                                  | `{label, url}` of an MCP telemetry server for step 2                                                                              |
| `costLimitUsd`             | 3                                  | the cost limit in US dollars, at most 20                                                                                          |
| `langfuse.url`             | — (required)                       | the Langfuse the backend reports to                                                                                               |
| `langfuse.api`             | `v2`                               | `v1` for a self-hosted Langfuse v3                                                                                                |
| `langfuse.environment`     | — (required)                       | the tracing environment of the gate backend (`LANGFUSE_TRACING_ENVIRONMENT` there); only it is counted                            |
| `timeoutMin`               | 45                                 | the time limit in minutes, at most 120                                                                                            |
| `maxWaitS`                 | the tools' default                 | `max_wait_s` for the tools that wait; a short one makes the gate continue with `process_wait` more often                          |
| `forbiddenBackends`        | `[]`                               | backend origins the gate refuses                                                                                                  |

## Running it

```bash
cd mcp
npm ci && npm run build
LIVE_GATE_I_HAVE_APPROVAL=<origin of backend.url, e.g. http://127.0.0.1:8137> \
LIVE_GATE_TARGET_APPROVAL=<origins of every environment api/frontend, comma-separated> \
LIVE_GATE_API_TOKEN=<API token of the gate backend> \
LANGFUSE_PUBLIC_KEY=<pk-lf-…> LANGFUSE_SECRET_KEY=<sk-lf-…> \
LIVE_GATE_FORBIDDEN_BACKENDS=<backends that must not be touched> \
npm run gate -- --config <file> [--scenario docs,har,protected,describe] [--keep] [--reuse] [--report-dir <dir>]
```

Exit code 0: passed; 1: a step failed or a limit stopped the gate; 2: refused to start, or an
operation waits for a person (`NEEDS HUMAN`, see "Flows from a description"). The progress goes to
stderr, the path of the report to stdout.

The project of the run is deleted when the gate passes. When the gate fails or is stopped it is
kept for inspection, and the report gives its name, its id and the command that deletes it
(`curl -X DELETE` with the token in `$LIVE_GATE_API_TOKEN`, never written out). `--keep` keeps it
after a pass as well. Two passes in a row need no cleaning by hand: a passed run leaves nothing,
and a kept project makes the next run refuse to start until it is deleted or `--reuse` is given.
The target repository is never written: the documents are copied
into a temporary workspace, which is removed at the end.

## The recording

The scenario `har` needs a recording of the target application, in a file the operator keeps
outside the repository (it holds the session of whoever made it) and names in `har.file`.

How to record it:

1. Use a demonstration instance of the target (a demonstration shop with sample data), never
   a shop with real customers. Make the accounts of the recording yourself with invented data
   (`user@example.com`, an invented name and address): the recording must hold no real personal
   data, and the gate does not look for it.
2. In Chrome DevTools open the Network tab, tick "Preserve log", and in the settings of the panel
   tick "Allow to generate HAR with sensitive data". Without it the response bodies and the
   cookies are stripped, the recording is refused and no flow can be built from it.
3. Walk several separate journeys one after another with a few seconds of thought between the
   actions, for example: browse the catalogue and a product; log in, add to the cart and check
   out; open the account and the orders. The split proposes a flow for each journey, and
   `har.minFlows` is their number (2 to 10).
4. Save with "Save all as HAR with content" as a `.har` file. Check it before use: search for
   anything that is not invented (e-mail domains, names, addresses, phone numbers).

The recording holds credentials (cookies, tokens, passwords typed in forms). The gate reads
them from the file, masks them in everything it writes (`[secret]`) and fails a step whose answer
shows one. The file is copied into the temporary workspace of the run, as `loadcraft/recording.har`,
and removed with it; the original is never changed. The host of the recording needs no approval:
no request goes to it, the flows run against the environments of the configuration, which do.

## Flows from a description

The scenario `describe` builds flows the way a user does who describes the application in words:
`flows_describe_journeys` sends the description, the frontend of the main environment and the account to
LoadCraft, whose browser opens the application and splits the description into paths; the plan of
the paths comes back through the channel of the run (WebSocket, the API token in a header).
`flows_record_journeys` approves the paths and the browser walks them; each walked path becomes a flow.
Only `flows_record_journeys` approves: the gate continues a long walk with `process_wait`, which never approves.

**The frontend.** The browser opens `environments.main.frontend`, so the main environment needs
one, and like every target it is listed in `LIVE_GATE_TARGET_APPROVAL` and checked by the rules of
"What it refuses" (port 8000 of this machine, the forbidden backends). A demonstration shop on this
machine is given as it is reached here, e.g. `"api": "http://localhost:8088"` and
`"frontend": "http://localhost:8088"`, both in `LIVE_GATE_TARGET_APPROVAL`
(`LIVE_GATE_TARGET_APPROVAL=http://localhost:8088`). Two things decide whether the LoadCraft
browser may open a local address, and the gate changes neither:

- the backend of the gate: its agent browser opens a loopback or private address only when that
  backend is started with `BROWSER_AGENT_ALLOW_PRIVATE_TARGETS=1`. Set it on the backend started
  for the gate alone, never on a backend people use; the connection test of the environment then
  reports the frontend as reachable instead of `blocked`;
- the plugin: `flows_describe_journeys` refuses a frontend on `localhost`, under `.localhost` or at a
  private address (`target_unreachable`) unless LoadCraft itself is reached at an address of this
  machine; a plugin version without that exception refuses the local shop, and the step fails
  there. A frontend of a target on another machine needs neither.

**The account.** `describe.envFile` names the env file of the target application (for example the
`.env` of the shop) and the keys of the login and the password in it (`describe.emailKey`,
`describe.passwordKey`). Use a test account of the demonstration instance, made for the gate, with
invented data. The gate copies only those two values into the `.env` of its temporary workspace
(in single quotes, which the plugin reads literally); nothing else of the file reaches the
workspace, and the file is never changed. The password is masked as `[secret]` in everything the
gate writes and looked for in every answer of a tool and every line of the server log: found once,
the gate fails, whatever else happened. The search only proves something for a password that is
not a word of the answers anyway, so the gate refuses one shorter than 8 characters or one that is
a part of the description or of the login: give the account such a password (the demo password of
a shop is too short and too common).

**The paths.** The gate reads the plan from the text of `flows_describe_journeys`, as a model does, and
approves every path that is safe by the rule of "Choosing the journeys" (no step that deletes or
deactivates, changes passwords, roles or permissions, or administers). The paths left out are
listed with the reason in the differences of the step; `flows_record_journeys` gets `"all"` when none is
left out, else the names of the safe paths. A plan of several paths with fewer than
`describe.minPaths` fails the step. A plan of one path (the header says `1 path`; the backend did
not split the description and walks it at once) is a result of the product: the gate counts it as
one path, approves nothing, calls `flows_record_journeys` with the plan alone as its "next" says, and judges
the walk like any other (completed, saved, pauses, password). When `describe.minPaths` is above 1,
the report notes as a difference that the description was not split; the step does not fail.

**Needs a human.** When the LoadCraft browser asks for help (a CAPTCHA, a one-time code, a second
factor), the result says that the operation waits for a person. The gate cannot help: it stops the
walk, keeps the project, and ends with `NEEDS HUMAN` and exit code 2, which is not a failure of the
plugin. Remove the obstacle on the demonstration instance and run the gate again. A password found
in the request for help still fails the gate.

**The run channel.** The plan and its approval go only through the channel of the run. The server
sends the Origin of `LOADCRAFT_API_URL`, and the backend compares it with the Host it is reached at;
behind a proxy that is the Host the proxy passes on. The report has a section "Run channel of the
description": how the handshake went (accepted when the plan came; refused with the reason the
plugin gives, e.g. `HTTP 403: origin_not_allowed, …` for a handshake refused before it was
accepted; unavailable), the lines of the server log about the channel (opened, closed with its close
code and reason; the gate starts the server with `LOADCRAFT_LOG_LEVEL=debug` for this scenario, and
the tail of a failure leaves the debug lines out), and a line for the operator's note on the proxy
in front of the backend, the Host it passes on and what the handshake answered.

## A fixed header of the target

Some targets want one header in every request, such as an `x-api-key` application key. LoadCraft keeps it as `default_headers` of the environment, and the plugin's
`project_save_env` sets it from `headers: [{ name, from_env }]`: the name of the header and the name
of a variable in an env file. The value is never written in the configuration, in a call or in
the report. The gate reads it from `envFile`, copies only the variables the headers name into
`.env.target` of its temporary workspace (the way it copies the account of `describe`), and
passes `headers` and `env_file: ".env.target"` to `project_save_env`.

```json
{
  "backend": { "url": "http://127.0.0.1:8100" },
  "workspace": { "openapi": "../specs/shop-store/openapi.json" },
  "environments": {
    "main": {
      "name": "shop",
      "api": "http://localhost:9000",
      "headers": [{ "name": "x-api-key", "from_env": "SHOP_API_KEY" }],
      "envFile": "../../../secrets/shop.env"
    },
    "capped": {
      "name": "shop-capped",
      "api": "http://localhost:9000",
      "limit": [5, 5],
      "headers": [{ "name": "x-api-key", "from_env": "SHOP_API_KEY" }],
      "envFile": "../../../secrets/shop.env"
    }
  }
}
```

The specification lies in a directory of its own (`../specs/shop-store/`), the env file outside
every repository: `SHOP_API_KEY=pk_…` is the only line the gate needs. Step 1 reads the
environment back from the backend and checks that the header exists and that its value is the one
of the file or the mask the backend shows in its place; the value is compared in memory and is
never written. The gate refuses to start (exit code 2) when a header has no `envFile`, its name is
one the plugin refuses (not letters, digits and hyphens, or Host, Content-Length,
Transfer-Encoding, Connection, Authorization), a header is listed twice, the variable is missing
or empty in the file, its value holds a quote or a control character, is shorter than 8
characters (the search for it in the answers would prove nothing), or two environments name one
variable with different values. A `value` field in the configuration is refused as well. The
value is masked in everything the gate writes, looked for in every answer of a tool, and its
absence from the report, stdout and stderr is a test (`test/liveGate.headers.test.ts`).

## Choosing the journeys

The gate reads the proposals of `flows_suggest_journeys` from the text of its view, as a model does: a
name in the column with its steps on the same line, steps wrapped under the column, and a name too
long for the column alone on its line with the steps indented below. It takes the layout numbers
from `src/render/suggestJourneysLayout.ts`, and `test/liveGate.proposals.test.ts` reads the
texts of the real view, so a change of the layout that the parser does not follow fails that test.
The rungs of a ladder are one entry in the view with no steps of their own; the gate does not choose them (it skips that entry, so a rung is not among the proposals and `journeys.names` with a rung fails).

- `journeys.prefer: ["pattern", …]` (1–5 patterns; recommended): the names of the proposals are made
  by a model, so they differ from project to project and from run to run, and an exact name from one
  run is not in the next. Each pattern is a regular expression, case does not matter, matched to the
  name of a proposal. For each pattern, in order, the gate takes the first proposal (in the order
  of the list) whose name matches, is not taken yet and passes the safety filter below; only when
  no name matches, the first one whose steps match. A name decides first because a model writes the
  steps of a "guest checkout" journey with the words "browse" and "catalog" in them. The places the patterns leave empty, up to `count` (default: the number of
  patterns), are filled with the first safe proposals, as without `prefer`. A pattern that finds
  nothing, or only proposals that delete or administer, does not fail the gate. The differences of
  step 3 say which patterns matched what, and what was taken instead. For a shop:
  `"journeys": {"prefer": ["browse|catalog|product", "cart|checkout|order"]}`. Not together with
  `names`; a pattern that is not a regular expression is refused before the run.
- `journeys.names: ["…", "…"]` (1–5 names; strict): the gate takes exactly those proposals, in that order.
  Each name is compared exactly with the names in the text; when one is missing the step fails and
  lists every available name. The names are your decision, so nothing is filtered.
- Without `names` and `prefer` (`journeys: 2` or `journeys: {"count": 2}`): the gate takes the first `count`
  proposals that are safe. It leaves out a proposal when, in the text of the view, a step has
  a word that deletes or deactivates (delete, remove, deactivate, disable, revoke, purge, destroy,
  wipe, suspend, ban) or the method `DELETE`; a step that changes a password, a role, a permission
  or a credential (a verb such as change, reset, update, set, grant, assign next to one of
  those words); or the name or a step says `admin` (administrator, admin panel). The report lists
  the proposals left out, with the reason, in the differences of step 3. When fewer than `count`
  proposals are safe, the step fails and says so: name the journeys in `journeys.names` or
  point at them with `journeys.prefer`.

The heuristic reads only what the view shows (the summary of each operation, or `METHOD /path`),
so a step whose summary hides what it does is not caught. On a target where every journey starts
with an administrator login, all of them are left out; give `names` then.

## The report

`mcp/gate-reports/<UTC time>.md` (ignored by git). It holds the result (`PASSED`, `FAILED` or `NEEDS HUMAN`) and, for a failure, the
step and the reason; the backend, the server version, the project, the environments, the profile,
the cost against the limit and the cleanup; a table of the steps with the number of calls, the
time, the cost so far and the result; then for every step the checks of the effect (✓ or ✗ with
what the backend shows), the differences and notes (the journeys taken, the slots filled, warnings
of the backend), and every call with its arguments, time and the beginning of its text. A failed
gate ends with the last lines of the server log. The token and the Langfuse keys are replaced by
`[secret]` everywhere the gate writes. With the scenario `describe` the report also has the section
"Run channel of the description", the walk limit, and a note of how many answers and log lines were
searched for the password of the account.

Read a failure from the top: the failed step and its first ✗ check name what is missing on the
backend; the calls of that step show what the plugin answered; the server log shows what it did.

## Without a backend

`npm run gate -- --fake` runs the same steps against the fake backend of the tests (the `sklep`
world, a clock 60 times faster) and a stand-in for the Langfuse metrics endpoint, with no approval
and nothing real touched. `--fake-fault` plants a fault to see the gate fail (or refuse) at the
right place: `self-check-failed`, `run-over-limit`, `leftover-project`, `cost-over-limit`,
`langfuse-down`, and three that stop a test under way (the fake's tests then last for hours):
`time-over-limit` (the clock passes the time limit once a test started), `cost-during-run` (the
cost passes the limit once the test has a handle) and `cost-before-handle` (the cost passes the
limit in the first call of `run_start`). `probes-ignored` (the backend answers the `PUT` of the probes but keeps them off) `provision-fails` (every account fails) and `data-no-source` (a slot of plain data no scenario has every column of: nothing can make its rows, so the data step fails on it and every text names a file, no generation of its rows) plant faults in the data steps. `har-one-flow` (the split gives one flow) and `har-no-pauses` (the pauses of the flows are not taken from the recording) plant a fault in the recording.
For `describe` the fake proposes the three paths of the shop and one that deletes the account (left
out), and its env file holds a sentinel password; `describe-one-path` (a plan of one path, walked at once: the gate passes it with a note),
`describe-none-saved` (every path fails), `describe-no-pauses` (the saved flows have no pause of a
person), `describe-help` (the browser asks for a one-time code and repeats the password),
`describe-echo-password` (the reason of a failed path repeats the password),
`describe-channel-blocked` (no WebSocket opens once the run started) and
`describe-time-over-limit` (a long walk, and the clock passes the walk limit once it was approved)
plant a fault there.
`--scenario` works with `--fake` as it does on a real run. `--fake-server <server.mjs>` (`--fake` only) starts another build of
the server, which is how the tests switch off one rule of the plugin (the clamp, the question
before a test or before accounts on a protected environment, the note in the report) and watch the
gate fail at the right step. The report of a fake run ends with the number of cancel
requests the fake backend received. `test/liveGate.test.ts` runs these.

## Accounts from a file

When the target cannot take registration through `data_create_accounts` (no registration request in
its API, or a registration in several requests), give the accounts the customer already has:

```json
"accounts": { "file": "../../path/to/secrets/accounts.csv" }
```

The path is against the configuration file and the file lies outside the repository: it holds
passwords. The header names the columns the slot reads (`email,password` for most targets; the
plan of `data_check_readiness` names them). In the data step the gate does the following:

1. It copies the file into its temporary workspace as `loadcraft/accounts.csv` with the mode 0600;
   the workspace is removed at the end of the run.
2. It fills the slots of plain data with the `data_create_dataset` calls `data_check_readiness`
   names, as with a number.
3. For a slot of accounts that is still short it calls `data_create_dataset` with
   `{scenario, slot, file: "loadcraft/accounts.csv"}` (the copy, never the original path), repeats
   it with the `confirm` token of the consent card, makes the `data_set_bindings` call the result
   names and checks the plan again with `data_check_readiness`; it does not call
   `data_create_accounts`. The report line reads "accounts loaded from the file: N".
4. The preflight then must find the data ready for the profile, as with a number.

The data tools answer with text only, so the gate reads the token of a card (`confirm: "…"`), the
numbered calls of a plan and the call after "→ next:" where a model reads them;
`test/liveGate.dataSlots.test.ts` holds these readers to the views of the plugin.

Every password of the file is a watched value, like the password of the `describe` account: it is
masked in the report, stdout and stderr, looked for in every answer of a tool and every line of the
server log, and a found copy fails the run (the report says how many values were looked for, never
what they are). The file needs at least as many rows as the profile has virtual users. The scenario
`protected` still creates its one account on the capped environment with `data_create_accounts`.
`npm run gate -- --fake --fake-accounts-file <csv>` runs the same against the fake backend.
