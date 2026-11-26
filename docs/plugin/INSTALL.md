**English** | [Polski](INSTALL.pl.md)

# Install the LoadCraft plugin for Claude Code

The plugin lets Claude Code take you from your repository to a finished load
test in LoadCraft: it prepares the API description, creates the project,
builds the flows, runs the test and explains the result. This page takes you
from nothing to the first check in a few minutes. After that, read
[USAGE.md](USAGE.md).

## What you need

- **Claude Code 2.1.271 or newer.** Check with `claude --version`, update with `claude update`.
- **Node 22.17 or newer.** The plugin's server is a Node program. Check with `node --version`.
- **A LoadCraft account** on an instance that supports API tokens, and permission to create a token there.
  The plugin checks this itself when it connects and tells you if the instance is too old.
- A project (a git repository) you want to test. Start Claude Code in its root directory.

## 1. Add the plugin

In Claude Code:

```text
/plugin marketplace add Load-Craft/onboard
/plugin install loadcraft@loadcraft
```

The same from a terminal, outside Claude Code:

```bash
claude plugin marketplace add Load-Craft/onboard
claude plugin install loadcraft@loadcraft
```

Restart Claude Code, or run `/reload-plugins`, so the plugin loads.

## 2. Create an API token

1. Open your LoadCraft application and go to **Account → API tokens**.
2. Create a token. Give it a name you will recognize (for example the name of your laptop).
   You can limit it to one project and give it an expiry date. Both are good ideas.
3. Copy the token now. LoadCraft shows it only once.

The token acts as you, with your role in the project. Treat it like a password: do not paste it into a chat
or commit it to git.

## 3. Configure the plugin

Claude Code asks for the plugin's options when you install or enable it. You can change them at any time with
`/plugin` (Installed tab, the settings of loadcraft), or in a terminal with `claude plugin configure loadcraft`, which also lists the options
that are still unset.

| Option | What to enter |
|---|---|
| `loadcraft_url` ("LoadCraft web app (browser address)") | Optional; only for a local or self-hosted LoadCraft. The address you open in the browser to use LoadCraft; links in tool results point here. It is not the backend API address. The default is `https://app.loadcraft.io`. Changing it makes an already bound repository look bound to another instance: repeat the project setup once with the same project name. |
| `api_token` | The token from step 2. Claude Code keeps it in your system's credential store (it is marked sensitive), not in a settings file. |
| `locale` | The language of the plugin's messages: `en` or `pl`. Claude answers you in the language you write in either way. |
| `demo` | Off by default. Turn it on to try the plugin on sample data without a LoadCraft account (see [Try it without an account](#try-it-without-an-account)). |
| `api_url` ("Backend API address (leave empty if same as web app)") | Leave empty. Only needed when the backend runs at a different address than the web app, for example local development with separate ports. Enter the full address including `/api/v1`, for example `http://localhost:8000/api/v1`; it is used as entered. Empty means the web app address plus `/api/v1`. |

## 4. Check the installation

Run:

```text
/loadcraft:doctor
```

The command checks, one by one, the Node version, whether the server is connected, whether the token is accepted,
whether the backend is compatible and whether the repository is already bound to a project. For every problem it
says how to fix it. When all is well, try:

```text
/loadcraft:status
```

It shows who the token belongs to, the project this repository is bound to (none yet on the first run) and the next
step. When the plugin cannot work (no token, Node too old), Claude Code also prints a one-line hint pointing to
`/loadcraft:doctor` at the start of a session.

## 5. Permission rules (optional)

By default Claude Code asks before each LoadCraft tool call. You can allow the harmless ones once, in
`~/.claude/settings.json` (for all projects) or in `.claude/settings.json` of a project (for that project). The
plugin cannot ship these rules for you.

Starting a test is never covered: `run_start` asks for your approval every time, whatever the rules say. The same
holds for creating accounts in your system (`data_create_accounts`). In a non-interactive session
(`claude -p`) these calls are refused, because nobody can answer. Start tests in a normal session.

### Variant A: reads only

Lets the assistant read the state of your work and results, and nothing else:

<!-- allow:reads begin: npm run update:shared writes this block from the catalog; do not edit -->
```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_loadcraft_lc__process_get_status",
      "mcp__plugin_loadcraft_lc__flows_get",
      "mcp__plugin_loadcraft_lc__run_plan",
      "mcp__plugin_loadcraft_lc__results_get_report",
      "mcp__plugin_loadcraft_lc__results_get_errors",
      "mcp__plugin_loadcraft_lc__process_wait",
      "mcp__plugin_loadcraft_lc__project_get",
      "mcp__plugin_loadcraft_lc__data_check_readiness",
      "mcp__plugin_loadcraft_lc__project_list_notes"
    ]
  }
}
```
<!-- allow:reads end -->

`results_get_traces` shows the requests a test sent and what came back, so it is in neither variant: header
values are never shown, the secrets it recognizes in bodies and addresses are masked, and a body in a format it
cannot read is hidden whole.

### Variant B: everything that stays inside LoadCraft

Adds the tools that create and change things in LoadCraft only (project, documentation, flows, scenario, AI
analysis):

<!-- allow:inside begin: npm run update:shared writes this block from the catalog; do not edit -->
```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_loadcraft_lc__process_get_status",
      "mcp__plugin_loadcraft_lc__flows_get",
      "mcp__plugin_loadcraft_lc__run_plan",
      "mcp__plugin_loadcraft_lc__results_get_report",
      "mcp__plugin_loadcraft_lc__results_get_errors",
      "mcp__plugin_loadcraft_lc__process_wait",
      "mcp__plugin_loadcraft_lc__project_get",
      "mcp__plugin_loadcraft_lc__data_check_readiness",
      "mcp__plugin_loadcraft_lc__project_create",
      "mcp__plugin_loadcraft_lc__project_save_env",
      "mcp__plugin_loadcraft_lc__project_check_env",
      "mcp__plugin_loadcraft_lc__project_analyze_setup",
      "mcp__plugin_loadcraft_lc__project_apply_setup",
      "mcp__plugin_loadcraft_lc__project_set_profile",
      "mcp__plugin_loadcraft_lc__project_connect_telemetry",
      "mcp__plugin_loadcraft_lc__project_import_docs",
      "mcp__plugin_loadcraft_lc__flows_suggest_journeys",
      "mcp__plugin_loadcraft_lc__flows_migrate_docs",
      "mcp__plugin_loadcraft_lc__flows_generate_from_suggestions",
      "mcp__plugin_loadcraft_lc__flows_generate_from_endpoints",
      "mcp__plugin_loadcraft_lc__scenario_suggest_split",
      "mcp__plugin_loadcraft_lc__results_analyze_run",
      "mcp__plugin_loadcraft_lc__project_list_notes"
    ]
  }
}
```
<!-- allow:inside end -->
<!-- left-out begin: npm run update:shared --><!-- left-out end -->

Left out on purpose, so Claude Code keeps asking: `run_start` and `data_create_accounts` (they touch your system;
Claude Code asks for them every time anyway), `data_create_dataset` (it can send a file of accounts to LoadCraft),
`data_suggest_actions` (it shows a consent card and asks the model of LoadCraft's data hub; until the server asks for consent itself, the question of Claude Code is the only one), `data_set_bindings` (it changes which datasets a test reads),
`scenario_check_self` and `scenario_generate` (they send one test user through your application; generating a scenario ends with that check), `flows_describe_journeys` and `flows_record_journeys` (a browser walks your application
and may sign in), `flows_import_har` and `flows_generate_from_har` (they send a recording that holds a real session), `results_get_traces` (it shows the requests a test sent and the answers of your application), `process_cancel` (it stops a test)
and `project_delete` and `flows_delete` (they delete for good). Whatever this list says, Claude Code asks you
before every call of the two deletions (also in bypass and auto mode), and the deletion itself asks once more in
a dialog of Claude Code, where only your yes deletes; where nobody can answer (`claude -p`) they are refused and
you delete in the app.
`project_check_env`, `project_apply_setup` and `project_import_docs` may send a few check requests to an environment that is not protected; if you
do not want that, leave them out as well. Allowed or not, `project_set_profile` and `flows_migrate_docs` first show the change
and write it only after your yes.

A deletion (`project_delete`, `flows_delete`) goes ahead only after a yes in the Claude Code dialog: the
assistant cannot give it in your place. Claude Code lets hooks answer that dialog, though: an `Elicitation` or
`ElicitationResult` hook, yours or one that another plugin brings, can answer or change the answer for you. Do
not set up hooks that answer the questions of the LoadCraft server by themselves. In `bypassPermissions` mode
the assistant can also change settings and hooks without asking, so there the dialog guards tool calls, not a
session without limits; for deletions, use a mode that asks.

## Update

```bash
claude plugin marketplace update loadcraft
claude plugin update loadcraft@loadcraft
```

Restart Claude Code afterwards: the new version takes effect after a restart.

## Uninstall

```text
/plugin uninstall loadcraft@loadcraft
```

Uninstalling does not delete anything in LoadCraft or in your repository. The `loadcraft/` folder of your project
stays (it holds your API description and the link to the project). To make sure the token can no longer be used,
revoke it in LoadCraft under **Account → API tokens**.

## Optional: the mod

The plugin comes with a mod: a status row above the prompt, a live line while a test runs, a dialog with the
numbers before a test and a side panel. It is on by default and the plugin works the same without it. How to
check it, what it does and how to turn it off: [mod/docs/USER.md](../../mod/docs/USER.md). Note that
`claude --safe-mode` and disabling the plugin in `/plugin` switch off the whole plugin, not only the mod.

## Try it without an account

The demonstration mode runs the plugin against a small sample backend that starts on your own computer, on
the `sklep` shop example. It needs no LoadCraft account, no token and no network. Every result ends with the
line "demo mode — sample data", and nothing is written to your repository (the link to the sample project is kept in a
temporary folder).

From the plugin: set the `demo` option to on (the loadcraft settings in `/plugin`) and restart Claude Code. The
plugin still asks for `api_token` because it is a required option; enter any text, the demonstration mode never
sends it anywhere. Leave `loadcraft_url` and `api_url` as they are (the default address counts as unset). The mode refuses to start
when you have set another address, so that sample data can never be mixed with a real LoadCraft. Turn `demo` off to
go back to your account.

By hand, without the plugin (for example to record a session), from a copy of this repository with Node 22 or newer:

```bash
LOADCRAFT_DEMO=1 node mcp/dist/server.mjs
```

The sample backend's clock runs 30 times faster than real time, so a ten-minute test takes about twenty
seconds; `LOADCRAFT_DEMO_SPEED` changes the factor. The mode needs the file `mcp/dist/demo-backend.mjs` next to
`server.mjs`. The sample data in the repository `evals/fixtures/sklep` (API description and account files) fits the shop
example; start Claude Code in that folder to follow the whole session.

## Other tools

Cursor, GitHub Copilot and other assistants cannot use the plugin. They can still use the four preparation
skills (API description, journeys, event API, project overview); see [the skills installation](../../skills/INSTALL.md).
Codex: see the [Codex section](#codex) (skills plus a manually configured MCP server).

## Codex

The Codex plugin brings the skills. It does not start the MCP server for you: the Codex plugin documentation
describes no way for a plugin to hand a secret (the API token) to a bundled stdio server, so the manifest
declares no server and you add the LoadCraft server to Codex yourself. The server is the same
`mcp/dist/server.mjs` the Claude Code plugin uses.

1. Get a copy of this repository and note the absolute path of `mcp/dist/server.mjs` (Node 22 or newer is required).
2. Create an API token in LoadCraft under **Account → API tokens** and export it in the shell that starts Codex:

   ```bash
   export LOADCRAFT_API_TOKEN="<your token>"
   ```

3. Add the server to `~/.codex/config.toml` (or to `.codex/config.toml` of a trusted project):

   ```toml
   [mcp_servers.loadcraft]
   command = "node"
   args = ["/path/to/onboard/mcp/dist/server.mjs"]
   env_vars = ["LOADCRAFT_API_TOKEN"]

   [mcp_servers.loadcraft.env]
   LOADCRAFT_URL = "https://app.loadcraft.io"
   LOADCRAFT_LOCALE = "en"
   ```

   `env_vars` forwards the variable by name from your environment, so the token never appears in the file. Do not
   put the token under `[mcp_servers.loadcraft.env]`: that table stores values in plain text. This is Codex's
   environment forwarding, not a credential store. Optional: `LOADCRAFT_API_URL` overrides the API address (for
   example `http://localhost:8000`), and `LOADCRAFT_WORKSPACE` sets the project folder (by default the folder Codex
   starts the server in).

4. Restart Codex and check that the `loadcraft` server is listed (`/mcp` in the terminal interface).

The guiding skill asks its questions with `AskUserQuestion` when the tool exists and otherwise as plain text with
numbered options, so it works in Codex the same way.
