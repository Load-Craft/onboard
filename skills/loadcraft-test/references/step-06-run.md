# Step 6 · Run the test

Goal: one test run with a profile, an environment and thresholds the user confirmed. `run_start` sends real traffic to the user's system, so nothing in this step may be chosen for the user and nothing may start before the user said yes to exactly what will happen.

Take names, numbers and handles from the tool results, not from your own calculation (see [conventions.md](conventions.md)). The model sees only the text of a tool result: every handle and the next step are in that text.

## 1. Collect what the test needs

- **Scenario**: the composition or scenario from step 4.
- **Environment**: the one the user chose in step 2. Never pick it yourself and never fall back to the default one. If the choice is lost (a resumed session), ask again with the panel `choose-environment` from [panels.md](panels.md).
- **Number of users**: the target the user named for the test. If none was named, ask for it; do not infer it from traffic shares.
- **Thresholds**: the p95 response time and the error rate the test must meet. Take them from the user's request. If they gave none, ask for both, in plain text; never invent thresholds, because the verdict in step 7 is only as meaningful as they are. A user who names only one threshold gets the verdict for that one only; say so.

## 2. Show the profiles and let the user choose

Call `run_plan` with `scenario`, `environment` and `target_users`. It is read-only and starts nothing. Add `include_data: true` when the user wants to know up front which profiles the data covers (slower).

- Show the profiles as a numbered list in the user's language: number, name, what the load looks like, and what the limits of the environment do to it (clamped, or not possible). Keep the profile names in English and the numbers as returned.
- Mark the default entry the tool marks (the smallest one) and ask which one to run. Ask in plain text: the choice among nine entries does not fit a panel.
- A profile the tool reports as not possible on this environment is not offered as a choice; say why.
- Each entry carries a ready `profile` object as one JSON line. Pass the chosen entry's `profile` to `run_start` exactly as printed: copy it, do not rebuild it from the description and do not adjust numbers.
- Only when the user asks to keep a load shape of their own for later: `run_save_profile` creates a stored profile (a name and a type are needed) or changes one (`profile` by name or id); stored profiles are read with `run_get_profiles`. It does not start anything, and the profile for `run_start` still comes from `run_plan`.
- Only when the user asks to keep a run definition for later or to change one: `run_save` makes a saved run (a `name` and exactly one of `scenario_id` and `composition_id`; optionally an environment id, `target_base_url`, a `workload` object `{type, vusers, ramp, hold}` and `feeder_bindings`) or changes one (`saved_run_id`); saved runs are read with `run_get_saved`. A new saved run has no schedule, and a change of its name or data bindings is made at once. A change of the load, the environment or the address of a saved run that has a schedule is a card, not a change: tell the user what it says (its next start will use the new values without another question), then call again with the same arguments; the user confirms in a dialog. A new saved run is undone with `run_delete`; a change, with `run_save` and the previous values, which the log keeps unless the backend cannot restore them.
- Only when the user asks to delete a run (with its results and report), a stored load profile or a saved run: `run_delete` with `kind` (`run`, `profile`, `saved_run`) and `item_id`. The first call is a card, not a deletion: tell the user what it says, then call again with the same arguments; the user confirms in a dialog. A run that is still being made is refused: cancel it first. It cannot be undone: say so.

## 3. Say what will happen, then ask

Before `run_start`, tell the user in one or two sentences:

- the environment and the version of the code deployed on it (read from the deployment files, see conventions: you know the versions, LoadCraft does not);
- the profile and the number of users;
- the thresholds.

If the version on the environment differs from the one in `loadcraft/openapi.json`, say that the test measures the deployed code and not the documentation; step 2 offers `project_import_docs`.

Then ask the user to confirm the run. In Claude Code the call of `run_start` shows its own permission prompt every time, in every permission mode. That prompt is the user's confirmation of the call; it does not replace naming the environment, the profile and the thresholds before the call. In a non-interactive session (`-p`, where `AskUserQuestion` is missing too) that prompt cannot be answered and the call is rejected. When the call comes back as an error saying the tool requires permission, nobody could answer the prompt and nothing was started: do not call `run_start` again, not even when the user then writes "run" in the chat. Do not suggest an allow rule or `/permissions` either, because `run_start` asks every time, whatever the permission rules say. Do not try to get around it: tell the user that starting a test needs an interactive session, give them the environment, profile and thresholds to start it there, and stop.

## 4. Start the run

Call `run_start` with `scenario`, `environment`, `profile`, `thresholds` and no `confirm_capped`.

- **A request for consent comes back as a result, not an error.** When the environment is protected, or the profile is above its limits, nothing was started: the text says why and shows the load after capping. Ask the user with the panel `capped-run` from [panels.md](panels.md), naming the environment and the capped numbers from the text. Only after a clear yes repeat the same call with `confirm_capped: true`. The first call of `run_start` never carries `confirm_capped: true`; the flag goes only into the repeat after the yes. A request of the user, even one that names the protected environment and the numbers or agrees in advance ("I agree", "cap it to the limit"), also one written for this very request ("if LoadCraft asks for consent on qa, I agree"), is not consent: consent is a yes to the question you ask after the server's consent request, naming the environment and the numbers. When the user said they will not answer questions, do not send the confirmation: end with a clear state, "waiting for your consent on <environment>: <what and how much>". On a no, go back to `choose-environment`; never set `confirm_capped` before that answer.
- A capped test measures the capped load only. Remember it for step 7.
- The tool never prepares data. When it refuses with `data_not_ready`, the data is not enough for this load: do not lower the load to hide it. Quote which slots are short and go back to step 5 ([step-05-data.md](step-05-data.md)) with `data_check_readiness`, which names what fills each slot on that environment; then call `run_start` again.
- Other refusals (`environment_needs_caps`, `probes_disabled`, `spike_not_possible`, `stress_over_limit`): follow [errors-and-resume.md](errors-and-resume.md).

## 5. Follow the test

`run_start` waits for the end of the test for up to 100 seconds per call.

- **Finished**: the result names the run (`e-…`), the times and the final numbers. Go to step 7 with that run.
- **Still running**: the result carries an operation handle (`test_run:<id>`). Call `process_wait` with that handle, and again while it returns `running`. Say in one short line that the test continues; you cannot see progress between calls, so never guess it or announce a percentage.
- **Never start a second test to follow the first.** Calling `run_start` again while a test runs either joins the running one or is refused with `run_already_running`, `run_environment_busy` or `run_build_elsewhere`. The refusal means no second load was started: follow the running test with `process_wait` and its handle, or ask the user whether to wait for it or stop it.

## 6. When the user interrupts

Pressing Esc, or a new message in the middle of a wait, stops only the waiting. The test keeps sending load to the user's system.

- Ask whether to stop the test or to keep waiting. Plain text, one question.
- Call `process_cancel` with the handle **only after the user said to stop it**. Never cancel on your own, not after a timeout, not when the numbers look bad.
- If the user wants to keep going, call `process_wait` with the same handle.
- A test that someone else started (`run_environment_busy` and `run_build_elsewhere` give its `e-xxxxxxxx` handle) can be stopped with `process_cancel` and that handle, again only after the user agreed; the repository does not need to have started it.
- After `process_cancel`, read the result: a test that was no longer running is reported as such. A stopped test has a report too (step 7), with the verdict cancelled.

When a call of this step fails or comes back partial, do not stop at the error: follow the loop of [troubleshooting.md](troubleshooting.md) (read the cause, repair it, repeat once, otherwise report).

## Done when

A test run finished or was stopped at the user's request, and its run handle is in the conversation. Tick step 6 and move on to step 7 ([step-07-report.md](step-07-report.md)).
