# Claude Code mods: facts the LoadCraft mod is built on

What the mods documentation says and what a running Claude Code does, for the questions the
mod's design depends on. Each answer gives the source (a documentation page with a one-sentence
quote, the type declarations Claude Code ships, or an observation) and what follows for the mod.
Re-check after a Claude Code upgrade: mods are early access and the API moves between releases.

## Environment

| Item              | Value                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code       | `2.1.325 (Claude Code)` (`claude --version`), Linux                                                                                                                                                                  |
| Date              | 2026-11-23                                                                                                                                                                                                           |
| Documentation     | https://code.claude.com/docs/en/plugins/mods/overview, `/create`, `/reference`, `/events`, `/api`, `/interface`, `/test`, `/troubleshoot`                                                                            |
| Type declarations | The ones embedded in this Claude Code build (`claude-code/index.d.ts`, header `Version: 2.1.325`). The declarations say they win over any page when the two disagree. Read locally, not copied into this repository. |

## How the observations were made

- A throwaway plugin named `loadcraft` outside the repository, loaded with `--plugin-dir`, with
  `hooks/hooks.json` naming `"modules": ["../mod/register.js"]` and the probe server
  `mcp/scripts/probe-tool.ts` as its MCP server `probe` (it returns `structuredContent`, with and
  without `outputSchema`, and a text-only tool).
- The probe mod logged what it saw with `$.ui.log(text, { to: 'debug' })`: the `session.start`
  input and `$.session.surfaces()`, the `tool.call` input and what `await next(e)` resolved to,
  and `$.mcp.call` results under three spellings of the server name.
- Runs were non-interactive only, so no trust dialog and no user settings were touched:
  ```bash
  claude -p --plugin-dir "$PLUGIN" --model haiku --max-budget-usd 0.3 --no-session-persistence \
    --allowedTools "mcp__plugin_loadcraft_probe__probe_structured" \
    --output-format stream-json --verbose --debug-file dbg.log "<prompt>" < /dev/null
  grep MODPROBE dbg.log
  ```
- `claude plugin validate` and `claude plugin test` on the throwaway plugin and on a copy of this
  repository.
- Not done: interactive sessions (they ask to trust the folder), the Desktop app, VS Code.

## Answers

| #   | Question                                                                                         | Answer                                                                                                                                                                                                                                                                                                                                  | Source / observation                                                                                                                                                                                                                                                                                                                                                               | What follows for the mod                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Does `tool.call`, after `await next(e)`, give the mod the MCP tool's `structuredContent`?        | **No.** `next(e)` resolves to `{ ref, result, text, isReadOnly? }`. When the tool returned `structuredContent`, `result` is a **string**, the JSON of `structuredContent` (what the model read), and there is no `structuredContent` field. For a text-only result, `result` is the array of content blocks and `text` the joined text. | Types: `ToolCallResult.result` is "from core the tool's record", typed `unknown` for MCP tools. Observed: `next={"ref":1,"result":"{\"status\":\"done\",\"data\":{\"codeWord\":\"harbor-pebble-123\"}}","text":"…same…","isReadOnly":true}`; text-only: `"result":[{"type":"text","text":"Probe finished after 2 s. …"}]`.                                                         | The mod gets exactly what the model got. A server that sends text only gives the mod text only. Structured data for the mod needs its own channel: see "Open decision" below.                                                                                                                                                                                                                       |
| 2   | May `modules` point outside `hooks/` (`"../mod/register.js"`)?                                   | **Yes.**                                                                                                                                                                                                                                                                                                                                | Reference, Files: "`modules`: an array with one path, relative to this file, to the hooks module". No rule against leaving `hooks/`. Observed: `validate` prints `../mod/register.js hooks: session.start`; `-p` logs `hooks module loadcraft@inline loaded (worker, environment 1, tier user); events: session.start`; `claude plugin test` loads it.                             | Keep the module at `mod/register.js`; `hooks/hooks.json` has `"modules": ["../mod/register.js"]` beside the `SessionStart` hook.                                                                                                                                                                                                                                                                    |
| 3   | Which server name does `$.mcp.call` take?                                                        | The name `/mcp` lists, **`plugin:loadcraft:lc`**. The tool-name spelling `plugin_loadcraft_lc` also works; the bare `loadcraft` does not.                                                                                                                                                                                               | Types: "`server` the server's name as /mcp lists it (`claude.ai Gmail`; the tool-name spelling `claude_ai_Gmail` is accepted too)". Observed: `plugin:loadcraft:probe` and `plugin_loadcraft_probe` answered; `probe` failed with `$.mcp.call: no connected MCP tool "probe_structured_plain" on a server named "probe"`.                                                          | Use the literal `'plugin:loadcraft:lc'`. See also the result shape and permissions under "Other facts".                                                                                                                                                                                                                                                                                             |
| 4   | Does time inside `$.ui.ask` count toward a hook's 10 s?                                          | **No**, nor does time inside `next` or any mods API call except `$.clock.sleep`. The hook's own work and its own awaited promises do count.                                                                                                                                                                                             | Reference, Limits: "A hook's own execution time for one event, not counting time inside `next` or a mods API call other than `$.clock.sleep`: 10 seconds". Events: "Keep the wait inside `$.ui.ask`, because that time doesn't count against the hook's time limit." Not measured (needs an interactive session).                                                                  | The consent hook may wait for the user inside `$.ui.ask` and for `$.mcp.call`; it must not wait on a promise of its own. A `ui.render` hook may wait at most 30 s on API calls (v2.1.326+).                                                                                                                                                                                                         |
| 5   | Does `claude plugin test` take a folder, or scan the whole plugin?                               | It takes **the plugin root** (the folder whose `hooks/hooks.json` names a module) and runs **every `*.test.ts` and `*.test.tsx` under it**, recursively, skipping only `node_modules` and names starting with `.`. A sub-folder is refused.                                                                                             | `claude plugin test --help`: "Runs every *.test.ts and *.test.tsx under dir". Observed: `claude plugin test mod` → `no hooks module to load; there is no hooks/hooks.json naming one in "modules"`; a file `mcp/test/x.test.ts` was collected and failed with `cannot import "vitest" (…): a hooks module imports its own files by relative path and "claude-code", nothing else`. | Run on this repository it would collect the server's `mcp/test/*.test.ts`. So: hook tests live in `mod/tests/*.test.ts` and run through `npm run test:mod` (from `mcp/`), which copies the manifest, `hooks/`, `mod/register.js` and `mod/tests` into a temporary plugin folder and runs `claude plugin test` there. Vitest files for pure functions live in `mod/test/` and are named `*.spec.ts`. |
| 6   | Without an `allow` rule, does `run_start` show two dialogs (the mod's and Claude Code's)?         | **Not verified** (needs an interactive session, whose folder trust prompt was not accepted). What was observed: the permission check runs **inside** `next(e)`, after every `tool.call` hook.                                                                                                                                           | Debug log order for one call: `tool.call` hooks first, then `cc-plugin-privacy@builtin tool.check` nested in that call. Types: `tool.check` is the permission step.                                                                                                                                                                                                                | Expect two dialogs without an `allow` rule: the mod's question, then Claude Code's own. Whether to recommend an `allow` rule for `run_start` together with the mod is the owner's decision.                                                                                                                                                                                                          |
| 7   | Does `ToolResult` get the structured result in `e.props`, or must it be cached from `tool.call`? | `e.props` is `{ tool_use_id, tool, output, isErrored, isExpanded?, onScreen? }`. `output` is the record `tool.call` resolved as `result` (see 1), not `structuredContent`. `tool_use_id` equals `e.requestId`.                                                                                                                          | Types, `ToolResult`: "The id `tool.call` carried for the call this result belongs to (`e.tool_use_id` there); the same value as `requestId`" and "the same one `ToolUse.output` carries … the record `tool.call` resolved as `result`". Not drawn here (needs an interactive session).                                                                                             | A result view can key cached data by `requestId` (= `tool_use_id`). It can only draw from data the mod can get at all (question 1).                                                                                                                                                                                                                                                                 |
| 8   | Does Desktop from 2.1.286 have `$.ui.status`, `AbovePrompt`, `Pane`? Versions of later features? | Mods load in Desktop from **2.1.286**. `AbovePrompt` and `Pane` are listed for Desktop. `$.ui.status` is documented for the terminal and VS Code; Desktop is not mentioned. The reference describes the CLI and Desktop "as of v2.1.290". Versions: see "Versions" below.                                                               | Overview: "mods work there from v2.1.286". Reference: "Entries cover the Claude Code CLI and the Desktop app as of v2.1.290, and the VS Code extension as of v2.1.299." Not run (no Desktop here).                                                                                                                                                                                 | Keep 2.1.286 as the Desktop load floor; treat behaviour below 2.1.290 as undocumented. Check `$.ui.status` on Desktop by hand.                                                                                                                                                                                                                                                                      |
| 9   | What does `$.ui.ask` do when the user declines in VS Code?                                       | **Not verified** (no VS Code here). Documented: it rejects when the user dismisses the question or picks **Chat about this**, and in a `-p` run. In VS Code the question card stays the extension's own and a mod's elements are drawn above it.                                                                                        | Types: "Rejects when dismissed, and in a `-p` run (no one to ask)." Interface: "the panel keeps its own question card and draws your elements above it." Observed in `-p`: `$.session.surfaces()` is `[]`, `session.start` has `surface: null, isInteractive: false`.                                                                                                              | Treat a rejection as a refusal, and an empty `$.session.surfaces()` as "nobody to ask" (pass the call on). Check VS Code by hand.                                                                                                                                                                                                                                                                   |
| 10  | Is `next` in `process_get_status` enough to pick the step (01–08) for the band?                  | Its content is: `next` is `{ step, hint, subject? }`, where `step` is the tool to call and `hint` takes 8 values (`unbound`, `setup_incomplete`, `no_flows`, `no_compositions`, `needs_data`, `no_runs`, `no_analysis`, `all_done`). Whether the mod can read it as data depends on question 1.                                         | `mcp/src/render/views/getStatus.ts` (`NextStep`, `NextHint`).                                                                                                                                                                                                                                                                                                                      | Map `hint` to the step in one table. The mod needs `next` as data, not as a rendered line.                                                                                                                                                                                                                                                                                                          |

## Open decision: where the mod gets structured data

Questions 1, 3 and 7 together: with Claude Code 2.1.325, structured data never reaches a mod.

- `tool.call` (and `ToolResult.output`) carries what the model read.
- `$.mcp.call` returns `{ content, isError }` only. The type declarations say it carries
  `structuredContent` "when its tool declares an output schema", but with an output schema the
  observed result was still `{"content":[{"type":"text","text":"{\"status\":\"done\",…}"}],"isError":false}`:
  the `structuredContent` JSON as the only text block, and no `structuredContent` field.

MCP resources are no way around this. The mods API has no resource call: `$.mcp` offers only `call`
and `connect` (types; reference: "`$.mcp` | `call`, `connect`"). The one indirect route,
`$.tool.call({ tool: 'ReadMcpResourceTool', server, uri })`, goes through the permission check and,
per the types, "opens no dialog …: `{ deny }` answers … any ask beyond no rule allowing the call", so
it works only for users who added an `allow` rule; and that tool is one the model can call too.

So when the server sends only rendered text, the mod sees only rendered text, in the user's language.
A mod that parses rendered views breaks with every wording change. A channel the model never reads is
the robust option: `$.mcp.call` results go to the mod alone, so a read-only call meant for the mod (for
example a parameter that makes `process_get_status` answer with its view data as one JSON text block) would
give the mod data without changing what the model reads. This needs a decision before the band, the
live status and the result views are built.

## Session state

The mod keeps one value, `loadcraft.session`, in `$.state` (declared in `mod/types/index.d.ts`, the
manifest's `types` field; that file must be self-contained, `validate` refuses an `import` in it).
Its shape is `ModState` in `mod/src/state/types.ts`; `mod/src/state/reduce.ts` is the only code that
changes it, a pure function of the state, a signal and the time.

- **Signals.** The `tool.call` hook on `mcp__plugin_loadcraft_lc__*` reads only language-free
  marks of the text the model got: the tool's name, an operation handle (`<kind>:<id>`) and the
  `[code]` an error starts with. A tool name moves the step; a handle sets the running operation; an
  error code changes nothing. The hook returns what `next` returned, whatever happens in it.
- **Facts.** After a LoadCraft tool call the hook reads `process_get_status` with `format: "data"` through
  `$.mcp.call("plugin:loadcraft:lc", …)` and reduces the data block: project, active
  environment, step (from `next.hint`), operations in progress, newest run. The status wins over what
  the tool name implied. A failed read leaves the tool-derived state.
- **After `/clear`, `/resume`, `/branch`** the state is back at its default (`isStale: true`) and the
  next LoadCraft tool call refills it from the status.
- **Tests.** `mod/test/reduce.spec.ts` (vitest; includes data the real `process_get_status` tool returns on
  the fake backend), `mod/tests/state.test.ts` (`claude plugin test`: the hook changes the state and
  returns the result unchanged; a `state.set` stub on the test kit records the writes).
- **Lint.** `mod/eslint.config.js` (run by `npm run lint` from `mcp/`) forbids `any`, `@ts-ignore`
  and friends in `mod/src`, `mod/test`, `mod/tests` and the `.mjs` scripts.

## Step band

`mod/src/view/band.ts` (pure) draws one row above the prompt from the session state:
`LoadCraft · <project> · <environment>` and the eight steps, a done step with `✓` in the accent green,
the current one bold and inverse, the ones ahead dim. The names of the steps are `band.step.1` …
`band.step.8` in the server's dictionaries (`mcp/src/render/i18n/{en,pl}.ts`), imported directly (the
translator in `index.ts` reads `process.env`, which a hooks module does not have); the language is the
plugin option `locale`, the only option the mod reads.

- **Width.** The row takes the first form that fits `e.props.bodyColumns`: all eight names; numbers with
  the name of the current step; the same without the title; without project and environment; the
  current step alone. The Text cuts what is left over (`truncate-end`), so the row is one line.
- **Beneath.** The hook puts what `next(e)` returned into its Box (a Box without width, height or
  overflow): before 2.1.323 the mods share one drawing of the band, from 2.1.323 the child draws nothing.
  It passes the event on while a survey holds the band, on a surface without `AbovePrompt`, and while
  the state holds no project or step (after `/clear` the state is stale until the next LoadCraft call).
- **VS Code.** No band there: the step goes to `$.ui.status` (`LoadCraft · sklep · qa ⚠ · 06 Run (5/8)`),
  only when the line changed. A write of `$.state` made inside a hook of the same plugin does **not** raise
  that plugin's own `state.set` hook (observed with the test kit: the kit's hook beneath the plugin saw both
  writes, the plugin's own only the first), so the code that writes the state hands the new value to
  `showStatus` in `register.ts`. The surface is the one `session.start` reported; `$.session.surfaces()` is
  not a function of the test kit's `$`.
- **Analysis.** `claude plugin validate` lets `$` go only to a function declared at the top level of
  `register.ts`; so `showStatus` is not a closure of `register`.
- **Size.** Importing both dictionaries brings the whole of them into `mod/register.js` (about 160 KB).

## Result drawing

Only what the user sees changes; the result the model reads is never touched (no `tool.call` hook
rewrites it; `ui.render` for `ToolUse` and `ToolResult` changes the row and the block alone, the
stored result stays).

- **Tool row (`ToolUse`).** A LoadCraft tool call is drawn as `LoadCraft · <tool>` (the tool's own
  name, language-free), with `…` while it runs and `✕` when it failed. The full view (ctrl+o,
  `--verbose`: `isExpanded`), another tool and any surface but terminal, Desktop and VS Code keep
  Claude Code's row. The input of the call is not drawn (it may hold values the user would not want
  on screen); ctrl+o shows it.
- **Result block (`ToolResult`).** For `results_get_report`, `results_analyze_run` and `flows_get` the block is
  drawn from the data of `process_get_status` with `format: "data"` and `result: { kind, id }` (the data the
  tool's own view is made from, read-only, masked, never a paid call: a diagnosis that was not
  stored is an error, not a new analysis). The id is the run or the flow in the one link line
  (`↗ https://…/gatling/executions/<uuid>`, `…/flows/<uuid>`) the server puts under the result; a
  result with no such line, or with two, is left alone. The first drawing is always Claude Code's
  own: the read starts after it, in the background (`$.clock.after`), one at a time, and the block
  is drawn again (`$.ui.invalidate('ui.render')`) when the data come. Error, no data, unknown shape,
  the full view and any exception hand the event on with `next(e)`. The drawing replaces the text
  block, so the link line is not in it: ctrl+o shows the text.
- **Not drawn.** The `flows_generate_*` tools and the two scenario tools: their text names no id for every flow or
  composition, and a split proposal is stored nowhere the server could read it back. The pure
  drawings for them (`mod/src/view/outline.ts`, `split.ts`) exist and are tested, but nothing feeds
  them yet.
- **Language.** The drawings take the locale as an argument; until the mod has the user's language
  (`register(on, options)`) the block uses `en`.

## Running the mod's tests locally

```bash
cd mcp
npm ci
npm test            # vitest, including mod/test/*.spec.ts (pure functions, build checks)
npm run build:mod   # rebuild mod/register.js after a change in mod/src
npm run check:mod   # fails when mod/register.js is not what mod/src builds to
npm run test:mod    # hook tests (mod/tests/*.test.ts) through `claude plugin test`
```

`npm run test:mod` needs Claude Code 2.1.287 or later on `PATH` (`claude --version`) and is not part
of CI. It copies `.claude-plugin/plugin.json`, `.mcp.json`, `hooks/`, `mod/register.js` and
`mod/tests` into a temporary folder named `loadcraft` and runs `claude plugin test` there; it needs
no sign-in and writes no settings. Run `npm run build:mod` first: the hook tests load the built file.
Each test that loads the mod passes `{ options: { api_token: … } }` (see "Other facts").

## Other facts

- **The mod does not load without the configured token.** The manifest's `userConfig` has a required
  `api_token` without a default. Without a stored value, Claude Code refuses the hooks module:
  `loadcraft: hooks module did not load: options do not fit plugin.json userConfig: LoadCraft API token is required but not provided`.
  A `claude -p` run prints that line to stderr. The rest of the plugin still loads. `claude plugin test`
  applies the same check, so hook tests pass `{ options: { api_token: … } }` (a test sentinel).
- **Options for a session-only plugin.** A file passed with `--settings` holding
  `{"pluginConfigs": {"loadcraft@inline": {"options": {...}}}}` satisfies that check for a
  `--plugin-dir` run (`hooks module loadcraft@inline loaded`), without writing user settings.
  Checked for the mod's load only.
- **`$.mcp.call` and permissions.** No permission prompt: in a `-p` run whose `--allowedTools` named
  another tool, `$.mcp.call` to a tool outside that list succeeded. Types: "No permission prompt: the
  plugin's call, seen by the hooks above it, is the grant." The call raises `tool.call` and `tool.check`
  for other mods and the built-in guards. The calling mod's own `tool.call` hook is skipped
  (`tool.call skipped: re-entry`), so polling `process_get_status` does not re-enter the mod's hook.
- **Who raised a `tool.call`.** `next.origin` is `{ plugin, tier }` (types: "`next.origin` names the caller"). The state hook skips a call only when the origin names this mod (`isFromThisMod`: `loadcraft`, `loadcraft@inline`, `loadcraft#n`); a missing or unknown origin counts as the model's call. The origin of a model's call in a live session: see the probe note below.
- **`tool.call` input for an MCP tool**: `{ tool: "mcp__plugin_loadcraft_<server>__<tool>", tool_use_id, ...arguments }`.
- **`session.start`** fires once per load, not after `/clear`, `/resume` or `/branch`; those reset
  every `$.state` value (reference and interface pages).
- **Surfaces.** `e.surface` is one of `terminal`, `desktop`, `vscode`, `mobile` (types:
  `RenderSurface`). The mod draws on the first three only; `supports()` answers `false` for anything else.
- **Built file.** esbuild (the bundler of `mcp/dist/server.mjs`) writes `function register(on) {…}`
  with `export { register };` at the end and double-quoted event names (since the file is minified for
  whitespace, `function register(on,options){…}` and `export{register}` without spaces; names and statements are kept). `claude plugin validate` reads
  that form: `../mod/register.js hooks: session.start`, `../mod/register.js calls: nothing on $`.
- **Type declarations.** Claude Code writes them beside a mod, as `.claude-plugin/types/claude-code/index.d.ts`
  (plus `claude-code-tools/`, `claude-code-mcp/`, `tsconfig.json`), only when it loads the mod from a
  local folder in an interactive session; no `-p` run, `validate` or `test` wrote them here. The create
  page adds that it puts a `tsconfig.json` at the mod root (here: the repository root) when there is
  none, `{"extends": "./.claude-plugin/types/tsconfig.json"}` (the build carries that text; the write
  itself was not observed). `.claude-plugin/types/` is in `.gitignore`. `mod/src/register.ts`
  declares the few types it uses itself.
- **Early-access flag.** Overview: "Claude Code v2.1.287 and later ignores it, so setting it to `0`
  doesn't keep mods off." Nothing in this repository sets `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`.
- **Module rules** (create page, enforced by `validate`): each mods API call written in full
  (`$.ui.toast(…)`), `$` never stored, destructured or passed to a function from another file; event
  names as string literals; imports only by relative path or from `claude-code`; no dynamic `import()`;
  no Node API, no `setTimeout` (use `$.clock`).

## Versions

| Feature used by the mod                                                                          | Lowest Claude Code version                                                               | Source             |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------ |
| Mods in the terminal                                                                             | 2.1.287                                                                                  | Overview, create   |
| Mods in the Desktop app                                                                          | 2.1.286                                                                                  | Overview           |
| Mods in VS Code                                                                                  | 2.1.299 (2.1.304 in a session that does not fetch feature flags, such as Amazon Bedrock) | Overview           |
| `$.ui.view`                                                                                      | 2.1.300                                                                                  | API / reference    |
| `$.ui.place` (`Placed`, terminal only)                                                           | 2.1.314                                                                                  | API / reference    |
| `AbovePromptList`                                                                                | 2.1.323                                                                                  | Reference          |
| A band row per mod (`{ plugin }` matcher); before it all mods share one drawing                  | 2.1.323                                                                                  | Test, troubleshoot |
| 30 s limit on a `ui.render` hook waiting on API calls; `plugin.register` not counting `$.ui.ask` | 2.1.326                                                                                  | Reference, Limits  |
| Test kit: `keepsBeneath()`                                                                       | 2.1.321                                                                                  | Test               |
| Test kit: `mock.session(on)`                                                                     | 2.1.293                                                                                  | Test               |

The same table is in `mod/src/capabilities.ts` (`minVersion`), with the surfaces each site draws on
(`supports`).

## Differences from earlier assumptions

- Structured results are not available to a mod (questions 1, 3, 7), including through `$.mcp.call`,
  contrary to its type declaration.
- `claude plugin test` scans the whole plugin, so the hook tests run on a staged copy.
- The mod needs the configured token to load at all.
- The declarations live in `.claude-plugin/types/claude-code/index.d.ts`, written only on an
  interactive load.
- `$.ui.status` on Desktop is not documented; `Placed` is terminal only; a fourth surface, `mobile`, exists.

## Side panel

`/loadcraft-panel` opens one pane (`id: 'loadcraft'`) with three tabs: **Run** (the numbers of the test
in progress, a chart of requests per second, "Stop test", the live preview), **Project**
(environments with protection and limits, counts, latest runs) and **Results** (the summary of the
newest report). The tree is `mod/src/view/pane.ts` (pure), the facts it draws from are
`mod/src/pane/tabs.ts`, the question behind "Stop test" is `mod/src/pane/cancel.ts`.

- **Command.** `$.command.register({ name, description, immediate: true })` at the end of the
  `session.start` hook, in `try/catch` (reference: it throws for a taken name, and a hook that throws
  is skipped, so a registration that fails must not take the rest of the hook with it). `immediate`
  lets the command run while a turn is streaming, which is when a test is watched. The `command.run`
  hook is matched on `{ command: 'loadcraft-panel' }`, opens the pane with `focus` and `closeOnEscape`
  and returns `{}` (prints nothing). Source: api, "Add a command".
- **Opening.** An open the user asked for (the command) is placed at any width. An open the mod makes
  by itself (a test starts) is placed from 144 columns (110 after the user opened that pane once);
  below, `$.ui.open` resolves `{ isPlaced: false, reason }` and the mod toasts the command name, once
  per session. The automatic open has no `focus`, so it never takes the keys while the user types.
  The preference "do not open automatically" is `$.store` key `paneAutoOpen` (`false` or absent),
  written by the toggle on the Run tab and read in `try/catch`. Source: interface, "Open a pane at
  the right time".
- **Drawing.** One `ui.render` hook on `{ component: 'Pane' }` that answers only for `e.requestId ===
'loadcraft'` (another mod's pane is passed on with `next(e)`). The tabs are three `plain` Buttons in a
  row (as in the `hello-tabs` example); the tab shown is a variable of the module, changed by the press
  and followed by `$.ui.invalidate('ui.render')`. Digit hotkeys on the tabs except in VS Code, where
  buttons have no hotkeys. A `Link` is an inline element: it is drawn inside a `Text`. In Desktop and
  VS Code a `Link` is plain text unless `href` is `https`, lower-case host, no `:443`, no space, no `@`
  (`safeHref` keeps to that, at most 2 048 characters). Every Button has a unique `key`.
- **Data.** The pane asks the server for nothing. A second `$.state` value, `panel` (declared in
  `mod/types/index.d.ts`, shape `PanelData`), keeps what reads that run anyway bring: the last reading
  of the operation in progress (the poll of MOD-04; the series of requests per second is not kept here: the chart reads `loadcraft.progress`, the one writer of that series, and draws it only while a `run_start` call holds), the project as the last
  `process_get_status` listed it (the status read after a tool call), the summary of the newest report (the data
  read for the result block of `results_get_report`, with the one `↗` link line of its text) and the live
  preview link (the one `↗` line of the result that started the test). Writing the value redraws the
  pane, so no timer of its own.
- **"Stop test".** The question is the consent of the `process_cancel` call (`consentPlan`, `readFacts`,
  `decide`, `settle` of `mod/src/consent/decide.ts`): the same wording and the same exact yes label,
  with the time and numbers of the last reading, so no read is needed to ask. Only a yes makes the one
  `$.mcp.call('plugin:loadcraft:lc', 'process_cancel', { operation })` of the mod; a no, a closed
  dialog and an error do nothing. The button is absent without a test in progress, for an operation that
  is not a test, and while no reading of the operation has come yet.
- **The mod's own call does not meet the mod's own consent hook.** The call raises `tool.call` for other
  mods and the built-in guards, not for the mod that made it (see "`$.mcp.call` and permissions"
  above), so the question of the pane is the only one the user gets. The test kit behaves the same: a
  `tool.call` stub for `process_cancel` is not run for a `$.mcp.call` of the mod.
- **Not checked by hand.** The pane in an interactive terminal, in Desktop and in VS Code was not
  looked at (no interactive session here); the tests mount it on all three surfaces and check the tree.

## A list with a filter, a preview and marks (MODV-14)

Checked 26.11 against the API types written by Claude Code 2.1.325 (`plugin-authoring` skill,
`types/claude-code.d.ts`). The types name no version for `Input`, `ui.input`, `ui.focus` and
`$.ui.focus`; the lowest version that has them was not found in the documentation, so the mod
keeps its floor and these were seen on 2.1.325 only.

- **Text field: yes.** `Input` is in the element table of every surface (terminal, desktop, vscode,
  mobile). `onInput(value)` runs on every change (event `ui.input`, kind `change`), `onSubmit(value)` on
  Enter (kind `submit`); `placeholder`, `label`, `value`, `autoFocus`. While it has the focus every
  printable key goes to it; Esc gives the keys back. A filter is therefore an `Input` whose `onInput`
  writes the query into the `panel` atom, and the list redraws from it.
- **Arrows and Enter: yes, through the focus ring.** Tab and the arrows move the ring of a `Pane`
  between its Buttons, Inputs and Selects (event `ui.focus`, which a hook may redirect or refuse;
  `$.ui.focus({ requestId, key })` moves it by code). Enter presses the Button under the ring
  (`ui.press`). Up and Down leave an `Input` for the element before or after it.
- **Space: no.** A Pane cannot bind a key of its own. A Button may have a `hotkey`: one digit or one
  lowercase letter, pressed while the pane holds the focus (none in VS Code). Raw keys arrive only in
  a `Client` element (`surface.onKey`), which runs its own module; Escape never reaches it either.
- **Esc: not catchable.** Esc returns the focus from the pane; with `closeOnEscape` it closes the pane.
  A "back" step from a preview is a Button (with a hotkey), not Esc.
- **Opening by code: yes.** `$.ui.open({ id, title, focus, closeOnEscape })` from any hook, e.g. after
  `await next(e)` in a `tool.call` hook of `flows_suggest_journeys`. Unasked it is placed from 144
  columns (110 once the user opened it); below it waits undrawn and the mod toasts the command. An
  unasked open must not take `focus` (it would take the keys while the user types).
- **`Select`**: a single pick from options (`onSelect`), not a multi-select; marks are Buttons.

How the Path tab uses it (`mod/src/view/list.ts`, the one list component of the panel; after the
review of MODV-14): a filter `Input` without `autoFocus` (with it, the digits of the tabs went into
the field whenever the pane took the keys), reached by the button "Filter" with hotkey `f`
(`$.ui.focus` onto the field); the counter ("marked N of 50, shown M") and "Build the marked" (`g`)
under the filter, above the rows; each row a mark Button (`[ ]`, `journey-N`) and a name Button
(Enter opens the preview, `journey-open-N`); at most 50 rows drawn, then "+N more — narrow the
filter"; the rungs of a ladder as one group row; the preview has "Back to the list" (`b`) and a mark
(`x`). `x` on the list marks the row under the cursor: a `ui.focus` hook on the pane notes
`e.element` (it only notes, and passes every move on). The limit of marks is `MAX_SUGGESTIONS` of
`flows_generate_from_suggestions` (`mcp/src/tools/flows/limits.ts`), the one source. The filter, the entry open and
the open groups live in the `panel` atom (`lists`); new proposals (after `flows_suggest_journeys` or
`process_wait`, seen as changed names in the next status read, never after a refusal) clear them and
open the pane without `focus`; the tab changes only when the pane is drawn.

The test kit (`claude plugin test`, 2.1.325) cannot raise a move of the focus ring by the person:
`$.ui.focus` of a test reaches only the engine's implementation, not the plugin's `ui.focus` hooks,
and the mod's own `$.ui.focus` did not reach a `ui.focus` handler of the test world. So `x` on the
row under the cursor and the cursor going back to the row after the preview are tested only in their
pure parts (`entryOfElement`, `rowKeyOf`) and must be checked by hand. Not looked at by hand in an
interactive terminal, Desktop or VS Code.

## Cards above the prompt (MODV-15)

Checked 26.11 against the API types written by Claude Code 2.1.325 and the mods documentation. Not
looked at by hand in an interactive terminal, Desktop or VS Code; the hook tests mount the band on
all three surfaces and check the tree.

- **Surface.** A card is one row of the `AbovePrompt` band (a `Box` with `borderStyle: 'round'`, a
  title, up to two lines and `Button plain hotkey` for each action, drawn as `1: label`). A toast and a
  native notification have no actions. The band is raised on the terminal, desktop and mobile; the
  types say so, while the documentation pages also name VS Code (where buttons have no hotkeys), so the
  mod keeps `AbovePrompt: terminal, desktop` and tells a card in VS Code with a toast.
- **Digits.** A digit hotkey presses a band `Button` when it is typed alone into an empty prompt (a
  letter needs the band to hold the focus). With text in the prompt it is text. Nothing is said about
  whether the digit is also typed into the field; check by hand. A digit typed as an answer to a
  question of the model in the chat would press a button of the card: so a digit only shows
  something, closes the card or asks Claude (a prompt that is a question, never a consent); a consent is
  given in its own dialog.
- **Appearing and going.** A write of an atom redraws the hook, so a card appears after the status read
  or the poll, with no turn of the model. It goes when the hook answers `next(e)`: the card was closed or
  acted on, expired, or the fact it stood for is gone. The person collapses the band (ctrl+x ctrl+a);
  the mod cannot expand it, so a collapsed band gets a toast, once, and the panel lists every card.
- **Limits.** One row per plugin: the queue is the mod's (one card drawn, `+N more`), at most 8
  waiting. A card is at most a frame, a title, two lines and one row of actions; the row takes the width
  `e.props.bodyColumns` less the frame and drops actions that do not fit (the first and the one that
  closes stay).
- **Kept.** The queue and the closed keys are `loadcraft.cards` in `$.state`; the closed keys also go to
  `$.store` (`cardsClosed`), so a closed card does not come back in the next session. A key is one
  event: an operation handle, or a fingerprint of the list of flows or fields.
- **Sources.** The end of a test (the poll's snapshot, with its `reason` when it failed), a bar that ended
  as failed (the other operations), `oldDocs` and `uncertainFields` of the status data block. All three are
  read anyway; the cards add no read.

## Lists fed by the status channel

The Project tab lists the flows of the project, with the steps of a flow in the preview; the Results tab
lists the test runs. All three use the common list (`mod/src/view/list.ts`: filter, preview, marks) and
read through the same gate as every other background read, with read-only sections of
`process_get_status` (`format: "data"`, `from_panel`):

| List  | Read                                 | Key of an entry | Marks                                          | Action (a fixed message to the agent)                                                           |
| ----- | ------------------------------------ | --------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Flows | `detail: flows` (the first 20)       | the flow's name | up to 20 (what `scenario_suggest_split` takes) | "build a scenario from the marked" (a proposal), "preview the docs migration" (`preview: true`) |
| Steps | `result: { kind: flow, id: <name> }` | outline number  | none                                           | Enter on a step shows its request: method, path, variables, statuses                            |
| Runs  | `detail: runs` (the first 20)        | the run handle  | exactly 2                                      | "compare the marked runs" (`results_get_report` with `compare_to`)                              |

- **When.** A list is read when its tab is drawn and the stored copy was made for another state of the
  project (`flowsStamp`, `runsStamp` in `mod/src/pane/lists.ts`); the old copy is drawn meanwhile. A read
  that failed is not repeated for the same state: the list says so and offers "Try again". The steps are
  read when a flow is opened, and again when it is opened again.
- **Marks** hold the key of the entry, never its place. A new reading drops the marks of entries that are
  gone. A flow whose name had to be cut or flattened to be drawn, or has characters a message cannot carry
  as they are (a quote, a backtick, a control character), is shown and has no mark; the chat remains the
  way to name it.
- **What the actions say.** Only a fixed text with the marked names (JSON, after the same check) or run
  handles (a strict pattern). Neither asks for consent: the migration itself stays behind the server's
  consent card, a scenario proposal generates nothing, a comparison only reads.
- **Not in the data** (so not drawn): a state per flow of "waiting for test data" (the status has it per
  scenario), flows beyond the first 20, the body and headers of a request (the outline carries the
  method, the path with its query, the variables, the expected statuses and the validators).

## Self-check in the Run tab

While `scenario_check_self` (or the checks a scenario generation waits for) reads the state of a check,
the server writes a view of it to its state file (`selfCheckViews`) at every change it reads: the steps
of the run under way or last, the result of each step in each run, the repair rounds, the failure. The
answer of `process_get_status` with `progress` (the read of the bars: the state file only, no backend)
carries the newest view written in the last 15 minutes as `selfCheck`. The mod keeps it in the `panel`
atom and the Run tab draws it when no test runs:

- **Head.** For each scenario where it stands: waiting, a run in progress, a step that failed with its
  status and the AI repair round of the limit, the next attempt from step 1 (the backend runs every
  attempt from the first step; the panel never says it goes on from the step that failed), passed,
  passed after a repair, a refused repair with its sentence, interrupted, another end by its name.
- **Steps.** The steps of the run on the common list (`check-<n>`, one list per scenario, no marks):
  `✓` ok, `✕` failed with its status and reason, `·` not run after the failure, `○` not reached yet; a
  step in a group is named `Group / name`. Each earlier attempt is one group row ("attempt 1 · version 1
  ✕ · step 3 …"), opened like any group of the list. A passed preflight is not listed (as in the
  server's view); the steps the backend left out are counted.
- **Ask Claude about this step.** The preview of a step has one button: a fixed message with the run
  handle (`e-` and 8 hex digits) and the number of the step, nothing of the step's name, path or
  reason, ending with the sentence that it is not consent. It starts nothing.
- **Card.** A step that failed while the AI repairs (one card per round) and a check that did not pass
  are a card whose action shows the Run tab (`1`) or closes it (`0`). The panel never opens by itself
  for a self-check.
- **When it moves.** While a call reads the check (`scenario_check_self`, `process_wait`, a scenario
  generation), that call writes the view when a read finds a new state (every 3 s) and the mod sees it at
  its next read of the bars (every 2 s while a bar is on screen). When no call follows the check (its
  handle went back to the model), the poll of the operation in progress (`process_get_status` with
  `operation`, every 5 s) gets the view in the snapshot: one read of each scenario of the check, nothing
  written; it says `completed` once every scenario ended, and the poll stops. An older view of the same
  check never replaces a newer one. The steps of one run are not ticked off as the run goes: their
  results come with the state after the run.
- **Two sessions** generating scenarios in one project share the key of the view of the generation
  (`build-scenario:<project_id>`): the last write wins.
