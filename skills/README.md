**English** | [Polski](README.pl.md)

# AI skills — instructions for download

This directory contains ready-made "skills" — working instructions for AI
assistants that prepare LoadCraft input files from your project's code.
Each skill is **one folder**: a `SKILL.md` file (the main instruction), a
`references/` directory with supporting material, and `scripts/` with a result
validator (pure Python 3, no dependencies to install).

The skills are **tool-independent** — plain Markdown plus a script. They work
in Claude Code, Codex, GitHub Copilot, Cursor, Windsurf, Gemini CLI and any
other assistant that can be given a file or pasted text.

## Available skills

| Skill | Output | What it does |
|---|---|---|
| [`loadcraft-openapi`](loadcraft-openapi/) | `loadcraft/openapi.json` | Analyzes API code (without modifying it) and builds one OpenAPI file compatible with the LoadCraft importer. It never guesses missing facts — it reports them as blockers. It can also update or audit an existing file. |
| [`loadcraft-journeys`](loadcraft-journeys/) | `loadcraft/journeys/*.txt` | Analyzes frontend code and describes user journeys in plain text — you paste each `.txt` file into LoadCraft as a scenario description, with no post-processing. |

By default the skills **only read** the repository — they write nothing except
the output files in the `loadcraft/` directory. They do not start the
application or install dependencies.

## How to use — general rule

1. **Download the whole skill folder** (SKILL.md + references/ + scripts/ must
   stay together — the instruction refers to those files and the validator is
   part of the workflow).
2. Share it with your AI (methods below).
3. Ask the AI: *"Read the SKILL.md file and execute the workflow described
   there for this project."*

The skill guides the AI through code analysis, writing the result and
validation. At the end you get the file(s) in `loadcraft/` plus a report: what
was covered, what was omitted and why. You can also check the result manually:

```bash
python3 skills/loadcraft-openapi/scripts/validate_openapi.py loadcraft/openapi.json
python3 skills/loadcraft-journeys/scripts/validate_journeys.py loadcraft/journeys
```

## Tool-specific instructions

### Claude Code
Copy the skill folder into the project, under `.claude/skills/`:

```bash
mkdir -p .claude/skills
cp -r loadcraft-openapi .claude/skills/
```

Claude Code detects the skill automatically — just ask e.g. *"prepare this API
for LoadCraft"* or invoke it by name. You can also copy it to
`~/.claude/skills/` to make it available in all projects.

### Codex (OpenAI)
Add the folder to the repository and append to `AGENTS.md` (in the root
directory):

```
When preparing OpenAPI for LoadCraft, execute the workflow
from skills/loadcraft-openapi/SKILL.md.
When describing user journeys — skills/loadcraft-journeys/SKILL.md.
```

Once this repo is published on GitHub, the skills can also be installed
directly:

```bash
npx skills add <owner>/<repo> --skill loadcraft-openapi
```

### Cursor
Add the skill folder to the repository (e.g. under `skills/`) and write in the
chat:

```
@skills/loadcraft-openapi/SKILL.md
Read this instruction and execute the described workflow for this project.
```

Optionally add a rule in `.cursor/rules/` pointing at the skill file so Cursor
picks it up automatically.

### GitHub Copilot (VS Code / JetBrains)
In the Copilot chat window add the file as context (**Add Context → Files** or
`#file`), point at `SKILL.md` and ask for the workflow to be executed. For
longer work it is worth adding an entry in `.github/copilot-instructions.md`:

```
When preparing LoadCraft artifacts, follow
skills/loadcraft-openapi/SKILL.md and skills/loadcraft-journeys/SKILL.md.
```

### Any other AI (ChatGPT, Gemini, etc.)
Paste or attach the contents of `SKILL.md` and the files from `references/`
and write: *"This is a working instruction. Apply it to my project, phase by
phase."* Run the validator from `scripts/` manually on the result.

## Notes

- The skills are written in English (understood best by all models), but you
  can talk to the AI in your own language — reports will follow the language
  of the conversation. The output files (`openapi.json`, `journeys/*.txt`)
  are produced in the format LoadCraft requires regardless of the
  conversation language.
- The parts about "subagents" apply to tools that support them (e.g. Claude
  Code); in tools without subagents the skill performs the same steps
  sequentially.
- Test credentials are supplied to LoadCraft separately — the skills
  deliberately write no credentials or secrets into the output files.
- If the skill cannot confirm something in the code, it does not guess — it
  omits that fragment and lists it in the report as a blocker to resolve.
