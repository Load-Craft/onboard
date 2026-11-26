# The mod in every configuration

What happens to the mod, and to the rest of the plugin (the skills, the MCP server,
`/loadcraft:status`), in each configuration a user or an organization can have. The plugin must work
in full wherever the mod does not.

Checked on 2026-11-23 with Claude Code 2.1.325 on Linux. "Run" means a non-interactive session on a
copy of the plugin and the fake backend (`npm run fake`, from `mcp/`), no user settings changed:

```bash
claude -p "/loadcraft:status" --plugin-dir <copy> --settings <session settings> --model sonnet \
  --no-session-persistence --allowedTools mcp__plugin_loadcraft_lc__process_get_status \
  --output-format stream-json --verbose --debug-file <log> < /dev/null
```

`<session settings>` holds `pluginConfigs` → `loadcraft@inline` → `options` (token, address of the fake
backend); for one row also `"disableAllHooks": true`. "Kit" means the hook tests under
`mod/tests/*.test.ts` (`npm run test:mod`), which run the built mod in Claude Code's test kit.

| Situation | Expected | How checked | Result |
| --- | --- | --- | --- |
| Claude Code too old for mods (terminal < 2.1.287, Desktop < 2.1.286, VS Code < 2.1.299, or < 2.1.304 without feature flags) | The mod does not load; the plugin (which needs 2.1.271) works without it | **Not checked**: only 2.1.325 is installed here. Owner's manual check below (1) | Documented by Claude Code: mods load from those versions on |
| `--safe-mode` | Claude Code turns off every installed plugin for the session: the mod **and** the skills, the MCP server and the commands | Run (`--safe-mode` added) | Debug log: `Safe mode: installed plugins are disabled, none of their hooks or hooks modules load`. No LoadCraft hooks module, no server; `/loadcraft:status` is unknown to the session. As Claude Code documents it: safe mode is for finding out whether a customization causes a problem, not a way to keep the plugin without the mod |
| `disableAllHooks` | The mod does not load; skills, MCP server and commands work; the plugin's start-up check (a settings hook) does not run | Run (`"disableAllHooks": true` in the session settings file) | `hooks module loadcraft@inline not loaded: only managed plugins and built-in plugins run (allowManagedHooksOnly / disableAllHooks)`. 7 skills loaded, `plugin:loadcraft:lc` connected, `/loadcraft:status` called `process_get_status` and answered. No `SessionStart` hook ran |
| Plugin disabled in `/plugin` | The mod has no switch of its own: disabling the plugin stops the mod, the skills, the server and the commands | **Not checked**: needs an interactive session. Owner's manual check below (2) | Per Claude Code: "One mod: disable or uninstall its plugin" |
| `allowManagedModsOnly` (managed settings) | The built-in guard refuses the mod; skills, server and commands load | **Not checked**: needs managed settings on the machine. Owner's manual check below (3) | Per Claude Code: the option "stop[s] a mod and leave[s] the rest of its plugin in place" |
| `claude -p` | Hooks run, nothing is drawn. The consent hook has nobody to ask and passes the call to the server's own safeguards | Run, twice; kit | Run 1: `hooks module loadcraft@inline loaded`, `/loadcraft:status` answered, the mod read `process_get_status` with `format` after the model's call. Run 2 (the data tool of that time with `provision`): the mod read the facts (`process_get_status (project, format)`), `$.ui.ask` found no dialog, `$.session.surfaces` was `[]`, the call went on and the server answered itself. Kit: "with nobody to ask (claude -p) the call goes on to the server guard" |
| API token not configured | Claude Code refuses the mod (`options do not fit plugin.json userConfig`); the rest loads, the start-up check points to `/loadcraft:doctor` | Kit ("without the API token Claude Code does not load the mod"); a `-p` run when the mod was first built | Refused as expected; the plugin loads |
| Desktop app | Everything but the live line under `run_start` (terminal only) | Kit mounts every drawing with `surface: 'desktop'`. **Not checked by hand**: no Desktop here. Owner's manual check below (4) | Kit: pass |
| VS Code extension | No band (the step goes to `$.ui.status`), no live line, no hotkeys; panel and result drawings work | Kit mounts with `surface: 'vscode'`. **Not checked by hand**: no VS Code here. Owner's manual check below (4) | Kit: pass |
| Desktop in a WSL session | Plugins are not available there at all (Claude Code) | **Not checked** | Per Claude Code |
| Desktop in an SSH session | Hooks of a plugin installed only locally are not copied to the remote machine: no mod | **Not checked** | Per Claude Code |
| `/clear`, `/resume`, `/branch` | Every `$.state` value is back at its default: no band until the next LoadCraft tool call refills it; the poll keeps running and reads nothing while no operation is known | Kit (each test starts from the state `/clear` leaves: "an empty state draws nothing and passes the band on"; "a process_get_status call of the model starts no read while the state is fresh" checks that a state nothing filled yet is refilled by the read). **Not checked by hand** | Kit: pass |
| `/resume` of a long session with many results | Result blocks drawn outside the viewport are not read; at most 8 reads wait; the rest keep Claude Code's drawing | Kit ("a flood of result blocks reads only a few, and none for a block off screen") | Kit: pass |
| Every mods API call fails | Each tool result goes back as it came; every drawing is Claude Code's own; the consent hook steps aside (server guard) | Kit ("every mods API call failing leaves the result of the tool and each drawing as they come") | Kit: pass |
| `session.start` raised twice in one load | One poll, one command registration | Kit ("a second session.start starts no second poll and registers the command once") | Kit: pass |

## Owner's manual checks

None of these needs a change to the plugin; each takes a few minutes. Use a throwaway copy of the
plugin and the fake backend (`cd mcp && npm run fake -- --stage executed`).

1. **Old Claude Code.** In a container, install a version below 2.1.287 (for example
   `npm i -g @anthropic-ai/claude-code@2.1.280`), run the `claude -p "/loadcraft:status"` line above
   with `--debug-file`. Expect: no `hooks module loadcraft` line, and `/loadcraft:status` answers.
2. **Disable in `/plugin`.** Start `claude --plugin-dir <copy>` in a trusted folder, open `/plugin`,
   check the line `1 mod active · loadcraft` (or more mods), disable LoadCraft, restart. Expect: no
   mod line for LoadCraft, `/loadcraft:status` unknown. Enable it again.
3. **`allowManagedModsOnly`.** On a test machine, put
   `{"pluginConfigs": {"cc-plugin-sec-default@builtin": {"options": {"allowManagedModsOnly": true}}}}`
   in the managed settings file, run `claude --debug --plugin-dir <copy>`. Expect in the debug log:
   `refused by cc-plugin-sec-default: mods are limited to your organization's by policy
   (allowManagedModsOnly)`, and `/loadcraft:status` answers. Remove the file afterwards.
4. **Desktop and VS Code.** Open a project with the plugin installed, call `/loadcraft:status`, then a
   LoadCraft tool. Expect: Desktop shows the band, the panel (`/loadcraft-panel`) and the coloured
   report; VS Code shows the step in the status line instead of the band. Before a `run_start` on a
   protected environment: the mod's question with the numbers, then Claude Code's own prompt. In
   VS Code, answer **No**: the model reads `[user_declined] …` and the test does not start.
5. **Interactive terminal.** In a narrow terminal (below 110 columns) start a test: the panel does not
   open by itself, one toast names `/loadcraft-panel`. Collapse the band (Ctrl+X, Ctrl+A): nothing that
   needs an answer is lost (the consent is a dialog, not the band).
