---
name: status
description: Show where the LoadCraft work stands - project, flows, scenarios, data, recent runs, operations in progress - and the next step. Run it yourself with /loadcraft:status.
disable-model-invocation: true
argument-hint: "[summary|flows|scenarios|data|runs]"
---

# LoadCraft status

Read-only. Do not change, create, upload or start anything.

1. Call the `mcp__plugin_loadcraft_lc__process_get_status` tool.
   - Arguments given to the command: `$ARGUMENTS`
   - If that is one of `summary`, `flows`, `scenarios`, `data`, `runs`, pass it as `detail`.
   - If it is empty, call the tool without `detail` (compact summary).
   - If it is anything else, do not guess: list the five accepted values and stop.
2. Summarize the result in the language the user writes in, in a few lines:
   identity and instance, the project this repository is bound to, what exists
   (flows, scenarios, test data, runs) and what is running now.
   Keep links, names and numbers exactly as the tool returned them.
3. Close with the single next step the tool proposes, as one sentence the user can act on.
   Name the tool or command that performs it. Do not run that step.

If the tool is not available or answers with an error (missing connection, 401,
`backend_too_old`), do not retry in a loop: tell the user to run `/loadcraft:doctor`.
