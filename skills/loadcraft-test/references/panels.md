# Decision panels

Every question with fixed options is defined here, once, by id. Other files refer to a panel by its id and never repeat its options. The text below is English; ask the question and show the options in the user's language (product names stay in English).

## How to ask

- Ask with `AskUserQuestion`: `Header` is the panel label, `Question` the question, `Options` the choices (label, then a short description). Mark the recommended option by putting it first and adding "(recommended)" to its label. `Multi-select: yes` means `multiSelect: true`.
- The free-text choice ("type your own") is added automatically; never list it. Treat a custom answer as the user's decision: apply what it says, and ask again only when it is ambiguous.
- Options written as a template (`<name>`) are built from data you have: one option per item, filled from tool results and the repository. Take numbers (limits, versions, ages) from those sources; never compute them.
- A panel whose template leaves only one option (one environment, one proposed journey, one path, two options that name the same thing) is never sent to `AskUserQuestion`, which rejects fewer than two options; do not invent a filler option either. Write the one possibility as plain text with the data the panel would show, ask the user to confirm it or to name something else, and stop until the answer. The confirmation is still the user's decision, not a default of yours. A custom answer works as in any panel. Panels with this rule: `choose-environment`, `protect-environments`, `path-selection`, `describe-plan`.
- If `AskUserQuestion` is unavailable, ask the same question as plain text with numbered options and wait for the answer.
- Skip a panel when the user's request already answered it (for example, they named the environment). Say what you took from the request instead of asking again.
- Never put more than two panels into one `AskUserQuestion` call, and only when the second does not depend on the first answer.
- The LoadCraft panel of the plugin's mod has a Path tab where the user picks the method (`flow-method`) and marks journeys (`path-selection`) without waiting for your question. A pick arrives as a message of the plugin: `The user chose the flow method "<id>" in the LoadCraft Path tab` (`docs`, `describe`, `har` or `manual`) or `The user chose these journeys to build in the LoadCraft Path tab` with a JSON list of names. When such a message is in the conversation, treat it as the user's answer to that panel and do not ask the panel again; ask it only when the pick cannot be used (the method needs documentation the project does not have, or a journey name is not in the proposals) and say why. The pick is a choice only: it is never consent to a write or a cost, which stays the user's "yes" to the question the server asks.
- Open questions ("anything to add or remove?", "change the proportions?", "which one to run?") are plain text, not panels.

## generate-docs
- When: step 1, no `loadcraft/openapi.json` was found.
- Header: Docs
- Question: Generate the API documentation?
- Options: Yes, generate it — creates `loadcraft/openapi.json` | No, build from a description or a recording — endpoints cannot be picked by hand without documentation
- Recommended: Yes, generate it
- Multi-select: no
- After the answer: Yes: run the `loadcraft-openapi` skill. No: remember it; step 3 offers only the description and HAR methods. Custom: follow it (for example, a path to existing documentation) and validate that file.

## protect-environments
- When: step 2, before `project_save_env`, when two or more environments were found.
- Header: Protection
- Question: Which environments should get a load cap?
- Options: `<all shared environments>` — with the caps you propose | `<only the production one>` — with its proposed cap | None — no environment is capped
- Recommended: the first option when shared environments exist, otherwise none
- Multi-select: no
- After the answer: pass the chosen environments with their caps to `project_save_env`. The product has no default caps: propose values, say they are your proposal, and let the user confirm or type their own. A custom answer may change the set or the numbers.

## shared-environment
- When: step 2, no environment was found in the repository and the user gave an address, or the repository reveals exactly one environment and it is unclear whether others use it.
- Header: Shared
- Question: Is this a shared environment?
- Options: Yes — protected, ask for the cap | No — private to the user, no cap
- Recommended: none
- Multi-select: no
- After the answer: Yes: ask for the cap as plain text and pass it to `project_save_env`. No: register the environment without a cap. Unsure: treat it as shared.

## choose-environment
- When: step 2, after `project_apply_setup`, always; never pick the environment yourself. With one environment the project still asks: show it as plain text (name, address, limit, protection, documentation age) and ask to confirm it or to add another environment (see "How to ask").
- Header: Environment
- Question: Which environment should the test run on?
- Options: one option per environment: `<name>` — `<version> · <limit> · <docs age>`
- Recommended: an unprotected environment whose documentation is current, if exactly one exists; otherwise none
- Multi-select: no
- After the answer: store the choice for step 6. If the environment runs newer code than the documentation, continue with `refresh-docs`; if it is protected, read `protected-env.md`. A custom answer names another environment or address: check it against the project before using it.

## refresh-docs
- When: step 2, the chosen environment runs newer code than the documentation describes.
- Header: Docs age
- Question: Update the documentation to the code on this environment?
- Options: Yes, update to `<commit>` — only the changes since the documented commit are checked | No, test with the current documentation — results may not match that code
- Recommended: Yes, update
- Multi-select: no
- After the answer: Yes: update the documentation for that commit with `loadcraft-openapi` (a separate `git worktree`, never the user's branch), then `project_import_docs`. No: continue and name the mismatch in the final summary.

## flow-method
- When: step 3, always.
- Header: Method
- Question: How should the flows be built?
- Options: From the API documentation — journeys are arranged from endpoints (REST or events) | From a description — the LoadCraft browser walks the application | From a HAR recording — a session saved from a browser | By hand — the user picks endpoints
- Recommended: none
- Multi-select: no
- After the answer: read the step file for the chosen method. Without documentation offer only the description and HAR methods; leave out methods whose step file does not exist yet.

## path-selection
- When: step 3, after `flows_suggest_journeys` and the table of all proposals, only as the fallback when the user cannot use the Path tab of the LoadCraft panel.
- Header: Paths
- Question: Which paths should be built?
- Options: one option per proposed journey: `<journey name>` — its main steps (at most four options per call; offer the rest in a second call)
- Recommended: the journeys the tool ranks as most important; list them first and mark each "(recommended)"
- Multi-select: yes
- After the answer: pass the chosen journeys to `flows_generate_from_suggestions`. A custom answer may add a journey in words or reorder: restate the final list before building.

## describe-accept
- When: step 3, method "from a description", after you wrote the description of the journeys.
- Header: Description
- Question: Is this description right?
- Options: Yes, use it | I want to correct it — the user says what to change
- Recommended: none
- Multi-select: no
- After the answer: Yes: continue. Correct: apply the changes and ask again, as many times as needed. A custom answer is a correction.

## describe-browser
- When: step 3, method "from a description".
- Header: Browser
- Question: Where should the application be walked?
- Options: In LoadCraft — live view in the app, the user can take control | I will click through it myself and give you a HAR recording — for environments behind a VPN or running locally
- Recommended: In LoadCraft, unless the environment is not reachable from the internet
- Multi-select: no
- After the answer: LoadCraft: continue with `describe-account` if the journeys need a login. Own recording: switch to the HAR method.

## describe-account
- When: step 3, method "from a description", the journeys need a login.
- Header: Account
- Question: Which account should the browser log in with?
- Options: From `<env file>` — credentials stay out of the conversation | Another account — the user puts it into a git-ignored env file
- Recommended: the first option when a git-ignored env file with credential keys exists
- Multi-select: no
- After the answer: pass the file path (`from_env`), never the values. Another account: the user writes it into a git-ignored env file and names the file and the keys; never take the values in the chat.

## describe-plan
- When: step 3, method "from a description", after `flows_describe_journeys`.
- Header: Plan
- Question: Build these `<N>` paths?
- Options: Yes, all `<N>` | Only `<the first path>` — a cheaper first pass
- Recommended: none
- Multi-select: no
- After the answer: call `flows_record_journeys` for the chosen paths. A custom answer names a subset: restate it before recording.

## har-split
- When: step 3, method "from a HAR recording", after `flows_import_har` found two or more action groups.
- Header: Recording
- Question: Split the recording into `<N>` flows?
- Options: Yes, `<names of the action groups>` | No, one flow from the whole recording
- Recommended: Yes, split
- Multi-select: no
- After the answer: build with the chosen split through `flows_generate_from_har`, which accepts LoadCraft's split in that call. A custom answer may drop action groups (passed in `paths`) but cannot merge them: restate the list first. Flows are created by that call, not by the analysis.

## flows-review
- When: step 3, at the end of every method, after you listed every flow of the project with `process_get_status` (`detail: "flows"`).
- Header: Flows
- Question: These are the flows of the project. What next?
- Options: Show details of a flow — `flows_get` for the one the user names | Add a flow another way — back to the choice of method | I have the flows I want — go on to the scenario
- Recommended: none
- Multi-select: no
- After the answer: details: call `flows_get` for the flow, retell it and ask this panel again. Add: go to the panel `flow-method`, build, then list the flows and ask this panel again. Go on: step 4, only with this answer or a yes in the conversation. A custom answer that says to go on is the same as the third option.

## data-mix
- When: step 4, after `scenario_suggest_split` proposed the traffic split.
- Header: Input data
- Question: What data should the virtual users send?
- Options: Normal — only typical values | Realistic — mostly typical, some invalid and edge-case values | Custom — the user sets the proportions
- Recommended: none
- Multi-select: no
- After the answer: pass the mix to `scenario_generate`. Custom: ask for the proportions as plain text. Explain that rows meant to be invalid are not counted as errors in the report.

## accounts-source
- When: step 5, the plan of `data_check_readiness` has an accounts slot with state "missing".
- Header: Accounts
- Question: Where should the accounts come from?
- Options: Create accounts before the test — LoadCraft registers them through the application's API | I have test accounts — the user names a file, passwords stay out of the chat
- Recommended: Create accounts, when the environment allows registration
- Multi-select: no
- After the answer: creating writes to the user's system: say where, then call `data_create_accounts` with the chosen environment. Own accounts: take a file path, never values, and call `data_create_dataset` with `file`, `scenario` and `slot` (its card first, then the `data_set_bindings` call it names). Run `scenario_check_self` afterwards.

## capped-run
- When: step 6, the chosen environment is protected or the profile will be capped.
- Header: Cap
- Question: Run the test capped to `<N>` users?
- Options: Yes, run on `<environment>` — the capped load shape from `run_start` | No, I will pick another environment — the full load only where there is no cap
- Recommended: none
- Multi-select: no
- After the answer: Yes: call `run_start` with `confirm_capped: true` and later say the result does not describe the full load. No: return to `choose-environment`. Never set `confirm_capped` before this answer.
