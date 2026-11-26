**English** | [Polski](README.pl.md)

# Preparing LoadCraft input files — user guide

**Purpose:** LoadCraft generates load tests from two inputs — an API
specification and scenario descriptions. These skills make your AI assistant
(Claude Code, Codex, Cursor, GitHub Copilot…) produce both **from your
project's code**, accurately and without touching the code itself. You do not
need to write or read code yourself.

> **First use?** Install the skills first: **[INSTALL.md](INSTALL.md)** — a
> few copy-paste commands, per tool. You do it once.

| Skill | On which project | What it produces |
|---|---|---|
| `loadcraft-openapi` | your API (backend) | `loadcraft/openapi.json` + a report |
| `loadcraft-journeys` | your web app (frontend) | `loadcraft/journeys/*.txt` + a report |
| `loadcraft-asyncapi` | your event/messaging API (WebSockets, Kafka, MQTT…) | `loadcraft/asyncapi.json` + a report |
| `loadcraft-overview` | the whole project (what it is about) | `loadcraft/overview.md` + a report |

The table lists the four stand-alone preparation skills; each works on its
own, with nothing but your AI assistant. The plugin adds three more:
`loadcraft-test` is a guiding skill that takes you through a whole load test —
documentation, project, flows, scenario, data, run, report and diagnosis — and
the commands `/loadcraft:status` and `/loadcraft:doctor`. They talk to
LoadCraft through the plugin's MCP server, so they exist only in the plugin,
not as separate downloads. To use them, install the LoadCraft plugin in Claude
Code (the `/plugin` command); the full plugin guide is published separately.

## Your steps

### 1. Install the skills (once)

Run the commands for your tool from [INSTALL.md](INSTALL.md). Already
installed? Go straight to step 2.

### 2. Ask the AI

In Claude Code a plain request in your own words is enough:

> Prepare this API for LoadCraft.

or, for the frontend:

> Describe the user journeys in this app for LoadCraft.

or, for an event/messaging API:

> Describe this application's asynchronous API for LoadCraft.

or, for the project description:

> Write a LoadCraft project overview for this repository.

Claude Code finds the skill and executes it by itself. In tools that do not
detect skills automatically, point at the file explicitly — the exact phrasing
for each tool is in [INSTALL.md](INSTALL.md).

From here the skill runs on its own: it analyzes the code, writes the files
and validates them. On a larger project this takes a while — it deliberately
works endpoint by endpoint and screen by screen, for accuracy. You do nothing
until the report appears.

### 3. Read the report

At the end the AI presents a report: what was covered and the list of
**blockers**, if any. A blocker means the AI could not confirm something in
the code and refused to guess. Forward blockers to your developers or the
LoadCraft team — each one is a specific question, not a vague error. A file
with open blockers is usable, but treat it as incomplete until they are
cleared.

### 4. Hand the files over to LoadCraft

- **`loadcraft/openapi.json`** → import it in LoadCraft as your API
  specification.
- **each `loadcraft/journeys/*.txt`** → copy the file's whole content and
  paste it into a scenario description field in LoadCraft. One file = one
  scenario. Do not edit or merge the files — each is written to be used
  exactly as-is.
- **`loadcraft/asyncapi.json`** → import it in LoadCraft as your AsyncAPI
  specification.
- **`loadcraft/overview.md`** → copy the file's whole content and paste it
  into the **description** field when setting up the project in LoadCraft.
- Test account credentials go directly into LoadCraft's configuration — they
  are deliberately absent from the files.
- The report is not a LoadCraft input — keep it for your team.

## What happens during the run — and what does not

- The AI **only reads** your code. It changes nothing in your project,
  installs nothing, and does not start your application.
- The results are written to a new `loadcraft/` folder in your project.
- If the AI cannot confirm something in the code, it does not guess — it
  lists it in the report as a blocker.
- No passwords, tokens or customer data end up in the output files.

## Double-checking the result (optional)

The skill validates its own output before delivering it, so this is an extra
check, not a required step. It needs Node.js 22.17 or newer, nothing else to install. In the project's root directory:

```bash
node .claude/skills/loadcraft-openapi/scripts/validate_openapi.mjs loadcraft/openapi.json
node .claude/skills/loadcraft-journeys/scripts/validate_journeys.mjs loadcraft/journeys
node .claude/skills/loadcraft-asyncapi/scripts/validate_asyncapi.mjs loadcraft/asyncapi.json
node .claude/skills/loadcraft-overview/scripts/validate_overview.mjs loadcraft/overview.md
```

(If you installed the skills under `skills/` — Cursor, Codex, Copilot —
adjust the path accordingly.) `PASS` means the files are structurally ready
for LoadCraft. You can also simply ask the AI to run these commands for you.

## Keeping the files out of your main branch

The `loadcraft/` folder does not have to live on your main branch. To keep
the main branch of your code repository clean, run the skill on a dedicated
branch:

```bash
git checkout -b loadcraft-artifacts   # one time: create the branch
# ... run the skill here (step 2) ...
git add loadcraft/
git commit -m "LoadCraft input files"
```

On the next refresh, bring the branch up to date with your code first, then
ask the AI again:

```bash
git checkout loadcraft-artifacts
git merge main                        # the AI must see the current code
# ... ask the AI to update the files ...
git add loadcraft/
git commit -m "Refresh LoadCraft input files"
```

The OpenAPI file records which code commit it was generated from, so updating
on a side branch works exactly like on main. Alternatively, add `loadcraft/`
to `.gitignore` and keep the files outside version control entirely —
LoadCraft needs only the files, not your repository. If any of this sounds
unfamiliar, ask your AI assistant to do it for you — these are ordinary git
commands.

## Re-running after code changes

Just ask the AI again (step 2). Every skill records which code version its
files were made from and checks only what changed since then: the OpenAPI and
AsyncAPI skills update the affected operations, the journey skill re-verifies
the affected `.txt` files and reports drift.

## Notes

- The skills are written in English (understood best by all models), but you
  can talk to the AI in your own language — reports will follow the language
  of the conversation. The output files are produced in the format LoadCraft
  requires regardless of the conversation language.
- The parts about "subagents" apply to tools that support them (e.g. Claude
  Code); in tools without subagents the skill performs the same steps
  sequentially.
