# Protected environments and documentation that lags the code

Read this file when the chosen environment is protected (it has load limits), when a profile will be capped, or when the environment runs newer code than the documentation describes. Panels are in [panels.md](panels.md); tool errors are in [errors-and-resume.md](errors-and-resume.md).

## Who decides what

- The user chooses the environment (panel `choose-environment`). Never pick it, and never switch to another one to avoid a limit.
- You may propose limits (panel `protect-environments`, step 2); the user approves them. Say they are your proposal, not a measured capacity.
- Consent is the user's: a clear yes to the question you asked, naming the environment and the numbers. Silence, "ok" to something else, or an earlier yes for another call is not consent.
- A request of the user, even one that names the protected environment and the numbers or agrees in advance ("I agree", "cap it to the limit"), also one written for this very request ("if LoadCraft asks for consent on qa, I agree"), is not consent: consent is a yes to the question you ask after the server's consent request, naming the environment and the numbers.

## 1. Documentation older than the code

The environment may run a newer commit than `loadcraft/openapi.json` describes. A test then measures the deployed code, not the documentation, so ask with the panel `refresh-docs`.

On a yes, update the documentation without touching the user's branch (details in [step-01-api-docs.md](step-01-api-docs.md)):

1. `git worktree add <temporary directory> <commit>` for the commit deployed on the environment.
2. Run the `loadcraft-openapi` skill in that worktree as a targeted update from the documented commit, then run its validator there.
3. Call `project_import_docs` with `openapi` set to the file in the worktree. Pass `environment` only to name the environment to check the documentation against. On a protected environment the tool skips the conformance check; say so instead of reporting a clean check.
4. Ask whether to remove the worktree; on a yes use `git worktree remove`. Never stash, switch branches or check out another commit in the user's tree.

`project_import_docs` sends only the OpenAPI file and refreshes nothing else: the profile and the test types stay as they were (say so), and flows stay pinned to the version they were built on. Its result names the flows on an older docs version; a scenario built from such a flow reads that older version, so before `scenario_generate` move them: call `flows_migrate_docs` with `preview: true` and show the user, per flow, the steps that lost their endpoint, the value differences with their ids and the scenarios that go stale.
The migration changes values only when adopted: ask which value differences to take, then call `flows_migrate_docs` without `preview`, with the same `flow_ids` and `adopt_value_ids` (or `adopt_values: "all"`). It returns a consent card with a token; only after a yes repeat that call with `confirm` set to that token, and never change its arguments in between; a confirm that gets a new card back moved nothing, so show that card and ask again. A flow whose steps lost their endpoint moves only with `allow_unmatched: true`, and only after the user agreed to it. Scenarios of the migrated flows go stale: build them again with `scenario_generate` before a test. The result names the version that undoes each migration.

On a no, test with the current documentation and name the mismatch in every summary.

The documentation in LoadCraft is one per project, not one per environment. When the user tests two environments in turn that run different code, tell them that updating it for one environment replaces it for the other, and that the version in the summary must be the one deployed where the test ran.

## 2. Profiles on a limited environment

`run_plan` marks profiles that the environment would clamp or cannot run. Show those notes next to each profile, with the numbers as returned. A profile that cannot run is not offered.

## 3. Consent requests

A consent request is a result, not an error: nothing was started or written.

The first call of `run_start` and of `data_create_accounts` never carries `confirm_capped` or `confirm_protected`, whatever the user wrote before; a flag goes only into the repeat of that call after the yes. When the user said they will not answer questions, do not send the confirmation: end with a clear state, "waiting for your consent on <environment>: <what and how much>".

- **Test run.** `run_start` returns the request when the environment is protected or the load would be capped. Ask with the panel `capped-run`, naming the environment and the capped numbers from the text. Only after a yes repeat the same call with `confirm_capped: true`; never set it before the answer. A protected environment with no limits set is refused with `[environment_needs_caps]`, not offered: ask the user for limits within the environment caps, or another environment.
- **Accounts.** `data_create_accounts` returns the request too. Name the environment and the number of accounts, and only after a yes repeat the call with `confirm_protected: true`. After that call, never repeat it on a refusal `protected_environment_requires_confirmation`: tell the user and stop.
- A no ends the matter: go back to `choose-environment` or to the path "I have accounts" in [step-05-data.md](step-05-data.md).

## 4. Reporting a capped test

Follow [step-07-report.md](step-07-report.md) section 4, and add:

- One sentence: the result describes the capped load only and does not say how the system behaves under the planned one.
- Name where the full test can run: an environment without that cap, with the user's agreement. Do not start it yourself.
- `scenario_check_self` always runs on the default environment with one user, even when the test targets another one. Say so when its result is quoted for a protected environment.
- A capped test that crossed no threshold and had no errors gets no diagnosis: do not call `results_analyze_run`, it is a paid analysis (see [step-08-diagnosis.md](step-08-diagnosis.md)). A capped test that failed may be diagnosed, as a diagnosis of the capped load.
