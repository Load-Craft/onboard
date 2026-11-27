---
name: doctor
description: Diagnose the LoadCraft plugin installation - Node version, MCP server, token, backend compatibility, project binding - and say how to fix each problem. Run it yourself with /loadcraft:doctor.
disable-model-invocation: true
---

# LoadCraft doctor

Work through the checklist in order. Report each item as `✓` or `✕` with one line of
evidence; for every `✕` add the fix. Keep going after a failure unless a later check
depends on it (then mark it `skipped`). Answer in the language the user writes in.
Never print, show or echo the API token or any environment variable value, not even
partly. Do not change files or settings: diagnose only. Never call `project_delete` or
`flows_delete` as a fix; delete only when the user asks for it in words.

1. **Node.** Run `node --version` with `Bash`. Needs 22.17 or newer.
   - Command not found, or an older version: install Node 22.17+ (https://nodejs.org or
     your version manager), then restart Claude Code. This is the most common reason
     for "LoadCraft tools do not work": the MCP server is a Node program.
2. **MCP server.** Ask the user to run `/mcp` and look for `loadcraft` as connected
   (check the list yourself if you can see it).
   - Missing or failed: after fixing step 1, run `/reload-plugins` or restart; check
     that the plugin is enabled in `/plugin`.
   - Claude Code older than 2.1.271 cannot read the plugin settings: `claude update`.
3. **Status.** Call `mcp__plugin_loadcraft_lc__process_get_status`. On success report the
   identity (who the token belongs to), the instance address, and that the plugin and
   backend are compatible.
4. **Token (401).** The token is invalid, revoked or missing: create a new one in
   LoadCraft at `/account/api-tokens` (Account → API tokens), then run
   `/plugin` (Installed tab, loadcraft settings) and paste it into the `api_token` field.
5. **Backend too old (`backend_too_old`).** Show the reason the error gives (API
   revision or missing capability). Fix: update the LoadCraft backend to a release
   that has it, or install an older plugin version that matches the backend.
   Cannot reach the server at all: check the `loadcraft_url` (and `api_url`, if set)
   in the loadcraft settings in `/plugin`.
   Web app address check: fetch the instance address from step 3 with
   `curl -sS -i --max-time 10 <address>` (no token, no headers) and read only the status
   line, the `Content-Type` header and the first characters of the body. If the answer
   is JSON (`Content-Type: application/json`, or a body starting with `{`) instead of an
   HTML page, the `loadcraft_url` field holds the backend address. Warn the user: links
   in tool results (the ↗ links) lead to raw JSON. The web app address is the one opened
   in the browser to use LoadCraft, not the backend API address. Fix in
   the loadcraft settings in `/plugin`: field "LoadCraft web app (browser address)"
   (`loadcraft_url`) gets the browser address; field "Backend API address (leave empty
   if same as web app)" (`api_url`) gets the backend address with `/api/v1`, only when
   the backend runs at a different address.
   Both fields are optional for the hosted LoadCraft: clear them for the default.
6. **Project folder.** Check whether `loadcraft/project.json` exists in the current
   repository (`Read` or `ls`). If it exists, compare its instance address with the one
   from step 3 without printing anything else from the file.
   - Missing: fine before the first setup; the setup creates it.
   - Different instance: either point the plugin at that instance
     (the loadcraft settings in `/plugin`) or remove the file to bind again.
   - The instance is identified by the web app address (`loadcraft_url`), so changing
     the web app address, even to another spelling of the same instance, makes the
     repository look bound to another instance. Tell the user to repeat the project
     setup once (`project_create`, with the same project name): it finds the existing
     project and writes the binding again.

End with one line: all good, or the number of problems and the first fix to try.
