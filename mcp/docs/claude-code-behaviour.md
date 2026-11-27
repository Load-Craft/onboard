# Claude Code behaviour that shapes the MCP server

Observed facts, not documentation quotes. The Claude Code documentation leaves four things open
that decide how tool results, progress and evaluations should be built. Each was checked against a
running Claude Code with a probe server. Each answer below gives the procedure, the observed output
and what follows for this project. Re-run the checks after a Claude Code upgrade: this is
behaviour, not a contract.

## Environment

| Item                 | Value                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code          | `2.1.325 (Claude Code)` (`claude --version`), Linux                                                                                            |
| Date                 | 2026-11-23                                                                                                                                     |
| Node                 | v25.6.1 (the probe runs as TypeScript through Node's type stripping)                                                                           |
| MCP SDK              | `@modelcontextprotocol/server` 2.4.0 (as pinned in `package-lock.json`)                                                                        |
| Negotiated protocol  | `2026-07-28`. `getClientVersion()` returns `undefined` in this era, so the server cannot tell which client it talks to                         |
| Model for the probes | `claude-haiku-5-5` (`--model haiku`). What reaches the model is decided by Claude Code, not by the model, and the transcript shows it (see Q1) |

## Setup

- **Probe server**: `mcp/scripts/probe-tool.ts`, a stdio server with four tools. Every code word
  it hands out is unguessable (`word-word-number`) and is written to the file named by
  `PROBE_LOG`, so the model's answer can be checked against what the server really sent.
  - `probe_structured`: text says `The probe code word is <A>.`, `structuredContent` carries
    `{status:'done', data:{codeWord:<B>}}`, with an `outputSchema`, the same shape that
    `registry.ts` uses.
  - `probe_structured_plain`: the same without `outputSchema`.
  - `probe_progress`: runs `seconds`, sends `notifications/progress` every `interval_seconds`,
    each with a fresh code word in `message`, with `total` unless `with_total: false`.
  - `probe_described`: a code word only in its description.
  - Server `instructions`: a code word that appears nowhere else.
- **Throwaway plugin**: a directory outside the repository named `loadcraft`, so the tool names
  match the real plugin. `.claude-plugin/plugin.json` is `{"name":"loadcraft", "mcpServers":"./.mcp.json", ...}`.
  `.mcp.json` declares two servers. `loadcraft` runs the real `mcp/dist/server.mjs`, with the
  `env` filled directly (fake backend URL, the fake's token), because session-only plugins cannot
  take `userConfig` without writing user settings. `probe` runs `node mcp/scripts/probe-tool.ts` with `PROBE_LOG`.
- **Fake backend**: `npm run fake -- --stage executed --port <port>`.
- Commands ran from an empty scratch directory. Non-interactive runs used
  `--no-session-persistence`. The interactive runs used `tmux` with screen captures
  (`tmux capture-pane -p`), with no change to the user's Claude Code settings.

Reproduce (paths are placeholders):

```bash
cd mcp && npm ci && npm run fake -- --stage executed --port 8797   # terminal 1
# terminal 2, from an empty directory:
claude -p --plugin-dir "$PLUGIN" --model haiku --max-budget-usd 0.3 --no-session-persistence \
  --allowedTools "mcp__plugin_loadcraft_probe__probe_structured mcp__plugin_loadcraft_probe__probe_structured_plain" \
  --output-format stream-json --verbose "<prompt>" < /dev/null > run.jsonl
cat "$PROBE_LOG"            # what the server really returned
# interactive:
tmux new-session -d -s probe -x 160 -y 50 "claude --plugin-dir $PLUGIN --model haiku --allowedTools '...'"
tmux send-keys -t probe -l "<prompt>"; tmux send-keys -t probe Enter; tmux capture-pane -t probe -p
```

## Q1. Text or `structuredContent`: which one does the model see?

**Procedure.** One `-p` turn: call `probe_structured`, then `probe_structured_plain`, quote each
result in full and list every code word. The same check was repeated with the real `process_get_status`
(plugin server against the fake backend), inside `claude plugin eval` with the real probe server
(`--allow-real-servers`), and in the interactive terminal (expanded view, `ctrl+o`).

**Observation.** The server log shows two different words per call:

```
{"event":"structured_result","tool":"probe_structured","textWord":"raven-birch-127","structuredWord":"prairie-amber-453"}
{"event":"structured_result","tool":"probe_structured_plain","textWord":"kestrel-iris-223","structuredWord":"velvet-willow-392"}
```

The `tool_result` that Claude Code records and sends contains only the serialized
`structuredContent`. The text block is gone:

```
TOOL_RESULT "{\"status\":\"done\",\"data\":{\"codeWord\":\"prairie-amber-453\"}}"
  tool_use_result: {"content": "{\"status\":\"done\",\"data\":{\"codeWord\":\"prairie-amber-453\"}}",
                    "structuredContent": {"status": "done", "data": {"codeWord": "prairie-amber-453"}}, ...}
TOOL_RESULT "{\"status\":\"done\",\"data\":{\"codeWord\":\"velvet-willow-392\"}}"
```

The model's answer: `probe_structured: prairie-amber-453`, `probe_structured_plain: velvet-willow-392`.
Neither text word appears anywhere. The real `process_get_status` behaves the same way. The model
receives the raw view data, not the rendered view, its `→` next-step line or its links:

```
TOOL_RESULT "{\"status\":\"done\",\"data\":{\"asOf\":\"...\",\"identity\":{\"userId\":\"user@example.com\"},
  \"compat\":{...},\"operations\":[],\"environments\":[],\"counts\":{...},\"recentRuns\":[],\"moreRuns\":0,
  \"next\":{\"step\":\"project_create\",\"hint\":\"unbound\"}}}"
```

The user sees the same JSON in the terminal. Expanded view:

```
● plugin:loadcraft:lc - process_get_status (MCP)
  ⎿  {
       "status": "done",
       "data": {
         "asOf": "2026-11-22T23:50:08.048Z",
         ...
```

Inside `claude plugin eval` with the real server, the result is identical
(`TOOL_RESULT "{\"status\":\"done\",\"data\":{\"codeWord\":\"maple-saffron-173\"}}"`, while the
text word was `zinnia-kelp-516`). A result without `structuredContent` (`probe_progress`, mock
files) reaches the model as text, verbatim:
`TOOL_RESULT [{"type": "text", "text": "Probe finished after 30 s. Final word zinnia-harbor-563."}]`.

**Conclusion.** Whenever a result carries `structuredContent`, Claude Code 2.1.325 replaces the
text content with the JSON of `structuredContent`, for both the model and the terminal. This
happens with or without `outputSchema`. The opposite of the working assumption ("text is complete,
`structuredContent` is an extra") holds: as the registry stands, no rendered view, i18n string or
link line ever reaches the model or the user. Error results (`isError`, no `structuredContent`)
are unaffected.

## Q2. Progress notifications: how are they shown, and does the model see them?

**Procedure.** `probe_progress` with `interval_seconds: 5`, for 30 s and 170 s, in `-p` (stream-json)
and in the interactive terminal (screen captured every 2–10 s). Another 200 s run opened the
background task panel. A 20 s run used `with_total: false`. Each time the model was asked to list
the progress words it had seen.

**Observation, server side.** Claude Code always sends a progress token, and every notification is
accepted:

```
{"event":"progress_start","seconds":30,"progressToken":2,"client":null,"protocol":"2026-07-28"}
{"event":"progress_sent","step":1,"word":"fjord-onyx-766","afterMs":5003}
...
{"event":"progress_done","steps":6,"finalWord":"iris-raven-943","afterMs":30000}
```

**Observation, interactive terminal, under 2 minutes.** The latest message replaces the previous
one under the collapsed call. A percentage is appended only when `total` is sent:

```
● Calling plugin:loadcraft:probe… (ctrl+o to expand)
  ⎿  probe step 2: progress word cobalt-juniper-942 (33%)
✢ Honking… (15s · ↓ 341 tokens)
```

Without `total`: `⎿  probe step 3: progress word dahlia-quill-838` (no percentage). After the result
arrives, the line becomes `Called plugin:loadcraft:probe (ctrl+o to expand)`, and the progress
lines are not kept in the transcript.

**Observation, interactive terminal, over 2 minutes.** At 120 s the call is moved to the
background. The model receives this text as the tool result and ends its turn:

```
MCP tool "plugin:loadcraft:probe/probe_progress" is still running after 120s. It was moved to the
background as task kz6mmyt1i and keeps running; you'll receive a notification with the result when it
completes. You can keep working in the meantime. To stop it, use TaskStop with task_id "kz6mmyt1i".
Note: it does not survive exiting this session.
```

The footer reads `1 MCP task still running` and `· 1 MCP task`. The task panel (`↓`, `Enter`)
keeps showing live progress:

```
  MCP task
  plugin:loadcraft:probe/probe_progress · kkpgv2xth
  status working · 78% · probe step 31: progress word prairie-yucca-959
  running for 37s
  Esc to go back · x to stop
```

When the call ends, a notification starts a new model turn:
`● MCP task kz6mmyt1i (plugin:loadcraft:probe/probe_progress) completed.` The final text then
reaches the model (`"Probe finished after 170 s. Final word magnet-ridge-584."`). The server was
not cancelled at the 120 s handover (no `progress_aborted` entry, all 34 notifications sent).

**Observation, `-p`.** No handover to the background: the 170 s call stays in the foreground and
its result arrives in the same turn (`It was not moved to the background, and no notice about that
appeared.`). The stream contains only heartbeats, without the progress message:
`{"type":"tool_progress","tool_name":"mcp__plugin_loadcraft_probe__probe_progress","elapsed_time_seconds":30,"heartbeat":true,...}`,
then again at 60, 90, 120 and 150 s.

**Model.** In every run, interactive or `-p`, short or backgrounded, the model answered
`Progress messages: NONE`. It only ever receives the final result.

**Conclusion.** Progress is for the user only. The terminal shows one line, the newest message, with
`(NN%)` when `total` is known. After 120 s the line moves to the background task panel. The model
never sees progress, so anything the model needs must be in the final result. The 2-minute
background handover happens only interactively; `-p` and eval runs block until the result.

## Q3. `AskUserQuestion` in `-p` and in `claude plugin eval`

**Procedure.** Prompt: "Use the AskUserQuestion tool to ask me one multiple-choice question: which
environment should the load test use, staging or production? If the tool is not available, say
what happened." Run (a) in `-p` with default tools, (b) in `-p` with `--tools "AskUserQuestion,Read" --allowedTools AskUserQuestion`,
(c) as a `claude plugin eval` case with `allowed_tools: [AskUserQuestion]` and a `tool_used` grader,
(d) interactively.

**Observation.**

- (a) `AskUserQuestion` is not in the session's tool list (`init.tools` has `Task, Bash, ..., Skill, ToolSearch, ...`
  but no `AskUserQuestion`). The model searched for it:
  `ToolSearch {"query": "select:AskUserQuestion"}` → `"No matching deferred tools found"`. It then
  asked in plain text and did not choose.
- (b) Even when named in `--tools`, the tool is dropped: `init.tools` = `['Read']`. The model said
  `It isn't among the tools available in this session` and asked in plain text.
- (c) In the eval run, `init.tools` = `['Task', 'Glob', 'Grep', 'Read', 'Skill', 'TaskStop', 'ToolSearch', 'mcp__plugin_loadcraft_lc__process_get_status']`.
  The documentation lists `AskUserQuestion` as an allowed case tool, yet the run did not include it.
  `ToolSearch` → `"No matching deferred tools found"`. The grader reported
  `AskUserQuestion called 0x (expected 1..∞)`.
- (d) Interactively, the tool works: the multiple-choice dialog appears (`☐ Environment … 1. Staging (Recommended) 2. Production 3. Type something.`).

**Conclusion.** In `-p` and in `claude plugin eval`, `AskUserQuestion` is neither offered nor
rejected: it is left out of the tool set. The model notices and falls back to a plain-text question.
Only the interactive main conversation has it.

## Q4. How the tool is named in the interface, and whether `instructions` reach the model without loading tools

**Observation, naming.**

| Where                                         | Shown as                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collapsed call, running                       | `Calling plugin:loadcraft:lc… (ctrl+o to expand)`                                                                                                       |
| Collapsed call, done                          | `Called plugin:loadcraft:lc` (several calls: `Called plugin:loadcraft:lc, plugin:loadcraft:probe 2 times`)                                              |
| Expanded (`ctrl+o`)                           | `plugin:loadcraft:lc - process_get_status (MCP)` and, with arguments, `plugin:loadcraft:probe - probe_progress (MCP)(seconds: 30, interval_seconds: 5)` |
| Background task                               | `MCP task <id> (plugin:loadcraft:probe/probe_progress) completed`, panel `plugin:loadcraft:probe/probe_progress · <id>`                                 |
| Model, permissions, `-p` stream, eval graders | `mcp__plugin_loadcraft_lc__process_get_status` (also for eval mocks)                                                                                    |
| `init.mcp_servers`                            | `plugin:loadcraft:lc` (`source: plugin`; `dynamic` for an eval mock)                                                                                    |

The tool `title` was not shown anywhere.

**Observation, instructions.** In `-p`, without calling or searching for any tool, the model
answered `The instruction code word of the probe MCP server is **maple-dahlia-597**.`. The server
log had `"instructionWord":"maple-dahlia-597"`. The description code word was not visible:
`The context lists mcp__plugin_loadcraft_probe__probe_described by name only, with no description
text.` MCP tools are deferred: the model sees names only until `ToolSearch` loads a schema. In the
eval run, the model also mentioned the probe's instructions without being asked, so they are
present there as well.

**Conclusion.** For user documentation, the tool appears as `plugin:loadcraft:lc - <tool> (MCP)`.
Collapsed, only `plugin:loadcraft:lc` shows, without the tool name. Server `instructions`
are in the model's context from the first turn, without loading any tool. Descriptions and input
schemas are not, until `ToolSearch` loads them.

## Recommendations

Items 1, 2, 4 and 5 are applied in the server: `success()` returns text only, no tool declares an
`outputSchema`, and one call waits at most 100 s (`MAX_CALL_WAIT_S` in `src/ops/operation.ts`),
then returns `running` with the handle, which the shared pending view prints.

### `registry.ts`

1. Stop sending `structuredContent` from `success()`, and drop `outputSchema: OUTCOME_SCHEMA` from
   `registerTools()` with it, because a declared output schema obliges the server to send
   structured content. The rendered text then becomes what the model and the user receive, which
   is the intent of "the text result is complete". Wrapping the text inside `structuredContent`
   (for example `{text}`) is worse: the model gets escaped JSON, and the user sees JSON.
   Per-host behaviour is not possible, because the host is unknown in the `2026-07-28` era.
2. Keep error results as they are (text, `isError`, no `structuredContent`): they already reach the model verbatim.
3. Progress is for the user only. Keep `total` whenever a fraction is known (it buys the `(NN%)`),
   and keep sending a notification at least every 5 s. Never rely on a progress message to tell
   the model anything.
4. Decide whether `process_wait` should return `running` plus the handle before 120 s. Interactively, a call
   past 120 s is backgrounded, and the model then gets a notification turn later. In `-p` and in
   evals, the same call blocks. A cap of about 100 s gives the same behaviour on both paths.

### Views (`render/views/*`)

5. If (1) is applied, the views stay the only content. Every identifier and the next step must be
   in the text: `structuredContent` no longer carries them.
6. If (1) is not applied, the views and the i18n dictionaries are dead weight for the model and the
   user. The view data itself would then need to be self-explanatory, which is not recommended.
7. Write progress messages as one self-contained line: only the newest is shown, with `(NN%)`
   appended when `total` is sent.

### Evaluations

8. Never grade `tool_used: AskUserQuestion`: the tool does not exist in eval runs. For questions
   asked of the user (environment choice, consent for a protected environment), grade the
   plain-text question (`llm` or `regex`), plus `tool_used` with `min: 0, max: 0` on the action that
   must not happen.
9. Mocks reach the model as text. Mocks recorded from the rendered views therefore match live
   behaviour only after (1). Before it, the live model sees JSON and an eval would test something
   else.
10. Ship `evals/mocks/lc/_tools.json` (the server's `tools/list`). Otherwise mocked tools
    have no description and a permissive schema.
11. Progress cannot be graded (the model never sees it), and in evals nothing goes to the
    background.

### Skill and user documentation

12. The skill must not depend on `AskUserQuestion` alone. When it is missing, ask in plain text and
    stop until the user answers.
13. User documentation names the tools as the terminal does:
    `plugin:loadcraft:lc - <tool> (MCP)`. Permission rules use
    `mcp__plugin_loadcraft_lc__<tool>`.
14. Server `instructions` reach the model without any tool loaded. Tool descriptions do not. The
    skill must keep naming the tools it needs.
15. The doctor command and the troubleshooting docs should mention that `--safe-mode` and
    `--strict-mcp-config` start no plugin MCP servers.

## Other observations

- `--safe-mode` and `--strict-mcp-config` both start **no** plugin MCP servers (`"mcp_servers": []`,
  no probe process started), even with `--plugin-dir`.
- `--tools <list>` without `ToolSearch` turns deferral off: every MCP tool of the user's servers is
  loaded into the first request. One such run cost 0.30 USD against 0.006 USD for the same prompt
  with default tools.
- In `claude plugin eval`, a plugin server with no mock is not started (`has no mock and is NOT started`) unless `--allow-real-servers` is passed. A mock file's body
  reaches the model as plain text (`TOOL_RESULT [{"type": "text", "text": "Mock status: ..."}]`).
  Without `mocks/<server>/_tools.json`, a mocked tool has no description and a permissive schema
  (`no _tools.json entry for process_get_status — served with a permissive schema and no description`).
- Session-only plugins (`--plugin-dir`) cannot receive `userConfig` values without
  `claude plugin configure`, which writes user settings. The probe therefore filled `env` directly.

## Not verified here

- Other hosts (Codex, Claude Desktop). Their handling of `structuredContent` may differ, and the
  server cannot detect the host in the `2026-07-28` era (`getClientVersion()` is `undefined`).
- The 30-minute stdio limit without a response or progress.
- Whether the 120 s handover threshold can be configured.
- What `--mocks record` writes for a server that returns `structuredContent`. The run with
  `--allow-real-servers` recorded no mock file for the real probe server.
