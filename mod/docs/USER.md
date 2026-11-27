# The LoadCraft mod

The LoadCraft plugin works fully without its mod: the skills, the MCP server and the
`/loadcraft:…` commands do the work. The mod is an optional layer that runs inside Claude Code and
adds what a plugin alone cannot draw or ask. It is part of the plugin and is on by default.

Polish version: [USER.pl.md](USER.pl.md).

## What the mod adds

| Without the mod | With the mod |
| --- | --- |
| The model keeps the plan of the eight steps in the conversation | A row above the prompt: project, environment, the eight steps (done, current, ahead). VS Code has no such row: the step goes to the status line |
| Progress of a test as text in the result | A status line with the test time and live numbers, a live line with a small chart under a running `run_start` (terminal), a notice when an operation ends or needs you |
| Waiting for a long operation (project analysis, path proposals, flows, scenarios, data checks, accounts, a test) with only text to look at | A progress bar for every operation in progress: the stage (`scenario 2/2 · …`), the percent when LoadCraft reports it or a slowly moving block when it does not, the time since the start. One bar per operation, in the row above the prompt, under the waiting call and in the panel; when an operation ends its bar says *finished* for a few seconds and goes |
| Consent asked by the skill in the conversation | A dialog with the numbers before a test, before accounts are created, before the browser agent signs in, and before a test is stopped |
| Results as plain text | A report, a diagnosis and a flow outline drawn in colour from the same data the tool's text is made from |
| — | A side panel, `/loadcraft-panel`: the run in progress with a **Stop test** button, the project, the latest results, and a **Path** tab where you pick how the flows are built and which proposed journeys to build (the pick goes to the agent as a message; it is not consent to anything that writes or costs) |

What the model reads never changes: the mod draws for you and asks you, it does not rewrite tool
results or arguments.

## Requirements

- Claude Code **2.1.287** or later in a terminal; the Desktop app **2.1.286** or later; the VS Code
  extension **2.1.299** or later (**2.1.304** in a session that does not fetch feature flags, such as
  one on Amazon Bedrock). Check with `claude --version`, or `/status` in the Desktop app.
  On an older version the mod does not load and the plugin works as without it.
- The plugin's **API token** is configured (`/plugin` → LoadCraft → configure). Without it Claude Code
  does not load the mod, and the plugin's start-up check tells you to run `/loadcraft:doctor`.
- Nothing to switch on: mods are on by default. The old variable `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`
  is ignored by these versions; setting it to `0` does not turn mods off.

## Check that it works

- In a terminal session run `/plugin`. A dim line under the tabs lists the mods the session loaded,
  for example `1 mod active · loadcraft` (the count includes your other mods).
- After the first LoadCraft tool call the row above the prompt shows the project and the step.
- `/loadcraft-panel` opens the side panel.
- If it does not appear: start `claude --debug` and look for `hooks module loadcraft@… loaded` or
  `not loaded:` with a reason. Running `claude plugin test` in a folder that holds no mod tells you
  whether your setup lets mods load at all (`no hooks module to load` means it does).

## What the mod does and does not do

A mod is code that runs with your permissions inside Claude Code; it is not sandboxed. This one
keeps to the following, and its tests check each point on the built file:

- It **does not** open the network, read or write files, start programs, read environment variables
  or settings, call a model, approve a tool call, rewrite a prompt, a tool call or a result.
  The one text it puts into the conversation is the pick you make in the **Path** tab of the panel
  (the way to build flows, the journeys to build), sent as one message of the plugin when you press
  the button. It never sends anything on its own, and a pick is a choice, not consent: the server's
  own questions stay yours to answer.
- It reads the plugin options only for the language; the API token is never read by the mod and is
  never stored in its session state.
- It calls back into the LoadCraft MCP server of this plugin with a closed list of tools:
  - `process_get_status`, read-only, with `format: "data"`: the facts for the row, the status line, the
    panel, the result drawings and the consent dialog; with `progress: true` it reads the bars from
    the plugin's own state file and asks LoadCraft nothing;
  - `process_cancel`, only after you answered **Stop test** in its dialog.

  It never calls `run_start` or any tool that changes something.
- It keeps five values in the session state (`session`, `progress`, `bars`, `panel`, `consent`): the project
  and environment names, the step, the operation in progress, the last reading of a test, your
  consents of the last ten minutes and the bars on screen.
  The moving block of a bar without a percent advances one cell a second and never blinks; this
  version of Claude Code gives a mod no "reduce motion" signal to follow, and the clock behind it
  runs only while a bar is on screen. It keeps one preference in the plugin store: whether the panel
  opens by itself when a test starts. No token, password or address of your system.

## The consent dialog

Before a call with an effect outside the editor, the mod reads the facts from the server and asks:

- `run_start` on a **protected** environment, or with a load **clamped** to the environment's
  limits: the environment, the requested and the effective load, the planned time, the test data.
  A test within the limits of an unprotected environment is not asked about.
- `data_create_accounts`, which **creates accounts** in the tested system: how many, for which slot, on
  which environment. Claude Code also shows its own permission prompt before every call of it.
- `flows_describe_journeys` when the browser agent **signs in** with an account from a file.
- `process_cancel` of an operation that still runs: which one and how far it got.

Only the first option is a yes. A no, a closed dialog or text of your own refuses the call: the tool
does not run, and the model reads that you declined and is told not to retry. A yes lets the call go
on unchanged. When the server then asks for an explicit confirmation (`confirm_capped`,
`confirm_protected`) and the model repeats the call with it, the mod does not ask again: one yes
covers one repeat with the same numbers, for ten minutes.

**Why Claude Code may still ask.** The mod never approves anything for Claude Code. After your yes,
Claude Code runs its own permission check: `run_start` always shows Claude Code's permission prompt
(the server marks it as needing you), and other tools prompt unless you allowed them. So before a
test you may see two dialogs: the mod's, with the numbers, and Claude Code's.

**When the mod steps aside.** With nobody to ask (`claude -p`, the Agent SDK), when the server cannot
give the facts (for example an older server) or when the mod itself fails before it asks, the call
goes on as without the mod, and the server's own safeguards hold: the load is clamped to the
environment's limits, and a protected environment needs the explicit confirmation the skill asks you
for.

## Turn the mod off

| What                          | How                                                    | What else stops                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The whole plugin              | `/plugin` → **Installed** → LoadCraft → disable        | The mod has no switch of its own: the skills, the MCP server and the commands stop too                                                                                                                             |
| Everything, for one session   | Start with `claude --safe-mode`                        | Every installed plugin (LoadCraft included, with its skills and server), your hooks, MCP servers, `CLAUDE.md` and other customizations. Use it to find out whether a problem comes from a mod                      |
| Every mod, keeping the plugin | `"disableAllHooks": true` in `~/.claude/settings.json` | All your other mods, your settings hooks, your custom status line and `/goal`; also the plugin's start-up check (`/loadcraft:doctor` still works). The skills, the MCP server and `/loadcraft:status` keep working |

Undo the same change to turn it back on. In an organization, an administrator can also refuse users'
mods (below).

## For administrators

**Review before you allow it.** Run `claude plugin validate` on the plugin folder (Claude Code 2.1.323
or later prints long lists in full). For this mod you will see:

```text
❯ ../mod/register.js hooks: session.start, tool.call{tool=…run_start|…data_create_accounts|…flows_describe_journeys|…process_cancel}, tool.call{tool=…process_get_status}, tool.call{tool=/"^mcp__plugin_loadcraft_lc__"/}, ui.render{component=AbovePrompt} (default matcher key: plugin), ui.render{component=ToolUse}, ui.render{component=ToolResult}, ui.render{component=ToolProgress}, command.run{command=loadcraft-panel}, ui.render{component=Pane} (default matcher key: plugin)
❯ ../mod/register.js gating hook with .catch: tool.call{…}
❯ ../mod/register.js calls: $.clock.after, $.clock.every, $.clock.now, $.command.register, $.mcp.call, $.prompt.submit, $.session.surfaces, $.state.get, $.state.set, $.store.get, $.store.set, $.ui.ask, $.ui.invalidate, $.ui.notify, $.ui.open, $.ui.resolve, $.ui.status, $.ui.toast
❯ ../mod/register.js state writes: loadcraft.consent, loadcraft.panel, loadcraft.progress, loadcraft.session
```

- `tool.call` means the mod sees every tool call. It reacts only to the plugin's own tools (the three
  matchers above) and never answers in place of a tool.
- There is no `$.fs`, `$.process`, `$.http`, `$.env`, `$.settings`, `$.model`, `$.tool` or
  `tool.check`. Of `$.prompt` the mod uses only `submit`, from one function, for the Path tab.
- `$.mcp.call` calls a tool of a connected MCP server **without a permission prompt**. The line does
  not name the tools; for this mod they are `process_get_status` (read-only) and `process_cancel` (only after the
  user's yes in the mod's dialog), both on this plugin's own server `plugin:loadcraft:lc`.
- A hook with `.catch` passes the call on when the hook fails, so the mod never blocks a tool by
  failing; the server's own safeguards stay.

**Built-in guard.** None of the mod's hooks is on an event the built-in guard
(`cc-plugin-sec-default`) passes over, so the mod works the same where the guard loads.

**Refuse users' mods.** With the guard option `allowManagedModsOnly` set in managed settings
(`pluginConfigs` → `cc-plugin-sec-default@builtin` → `options`), Claude Code refuses this mod when a
user installed the plugin themselves; the rest of the plugin (skills, MCP server, commands) still
loads. The debug log then has `refused by cc-plugin-sec-default: mods are limited to your
organization's by policy (allowManagedModsOnly)`. `disableAllHooks` in managed settings stops every
mod and every hook, yours included.

**Run it as your organization's mod.** To keep the mod where users' mods are refused, install the
plugin so that it counts as yours, in managed settings:

- `enabledPlugins`: the plugin set to `true`;
- `extraKnownMarketplaces`: the marketplace that lists it (from a remote marketplace this needs
  Claude Code 2.1.324 or later; pin the marketplace to control when the code changes);
- `prependPlugins` or `appendPlugins`: the plugin's id. With `prependPlugins`, also list
  `sec-default@builtin`, or the built-in guard is removed.

Check on a test machine with `claude --debug`: the line `hooks module loadcraft@<marketplace> loaded`
has `tier prepend` (or `append`). `tier user` means it still counts as a user's mod; a line
`… is enabled by managed settings, but` says why. See the Claude Code page "Manage mods for your
organization".

## Where it runs

| Where                                                         | The mod                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `claude` in a terminal (also an editor's terminal, JetBrains) | Everything                                                                                                        |
| Desktop app, Code tab                                         | Everything except the live line under `run_start` (terminal only)                                                  |
| VS Code extension                                             | No row above the prompt (the step is in the status line), no live line, no hotkeys                                |
| `claude -p`, Agent SDK                                        | Hooks run, nothing is drawn; the consent dialog has nobody to ask, so the call goes on to the server's safeguards |
| Desktop app in a WSL session                                  | Not available: plugins are not available in WSL sessions                                                          |
| Desktop app in an SSH session                                 | Not available for a plugin installed only on your computer: Desktop does not copy its hooks to the remote machine |

After `/clear`, `/resume` or `/branch` the row above the prompt is empty until the next LoadCraft
tool call refills it.
