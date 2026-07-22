**English** | [Polski](INSTALL.pl.md)

# Installation — one-time setup

Do this once, before first use. Pick your tool below and run the commands in
**your project's root directory**. The commands install all three skills; each
skill folder stays complete (`SKILL.md` + `references/` + `scripts/`), which
is required for it to work. (Prefer ZIPs? Ready ones are in
[`dist/`](../dist/) — unzip them into the same target folder.)

## Claude Code

```bash
rm -rf /tmp/onboard
git clone --depth 1 https://github.com/Load-Craft/onboard /tmp/onboard
mkdir -p .claude/skills
cp -r /tmp/onboard/skills/loadcraft-openapi /tmp/onboard/skills/loadcraft-journeys /tmp/onboard/skills/loadcraft-asyncapi .claude/skills/
```

To make the skills available in **all** your projects instead of one, copy
them to your home directory instead:

```bash
mkdir -p ~/.claude/skills
cp -r /tmp/onboard/skills/loadcraft-openapi /tmp/onboard/skills/loadcraft-journeys /tmp/onboard/skills/loadcraft-asyncapi ~/.claude/skills/
```

Claude Code detects the skills automatically — after installing, just ask
*"prepare this API for LoadCraft"*.

## Cursor

```bash
rm -rf /tmp/onboard
git clone --depth 1 https://github.com/Load-Craft/onboard /tmp/onboard
mkdir -p skills
cp -r /tmp/onboard/skills/loadcraft-openapi /tmp/onboard/skills/loadcraft-journeys /tmp/onboard/skills/loadcraft-asyncapi skills/
```

Then write in the chat:

```
@skills/loadcraft-openapi/SKILL.md
Read this instruction and execute the described workflow for this project.
```

## Codex (OpenAI)

```bash
rm -rf /tmp/onboard
git clone --depth 1 https://github.com/Load-Craft/onboard /tmp/onboard
mkdir -p skills
cp -r /tmp/onboard/skills/loadcraft-openapi /tmp/onboard/skills/loadcraft-journeys /tmp/onboard/skills/loadcraft-asyncapi skills/
cat >> AGENTS.md <<'EOF'
When preparing OpenAPI for LoadCraft, execute the workflow
from skills/loadcraft-openapi/SKILL.md.
When describing user journeys — skills/loadcraft-journeys/SKILL.md.
When preparing an asynchronous/messaging API — skills/loadcraft-asyncapi/SKILL.md.
EOF
```

Then ask Codex e.g. *"prepare this API for LoadCraft"*.

## GitHub Copilot (VS Code / JetBrains)

```bash
rm -rf /tmp/onboard
git clone --depth 1 https://github.com/Load-Craft/onboard /tmp/onboard
mkdir -p skills .github
cp -r /tmp/onboard/skills/loadcraft-openapi /tmp/onboard/skills/loadcraft-journeys /tmp/onboard/skills/loadcraft-asyncapi skills/
cat >> .github/copilot-instructions.md <<'EOF'
When preparing LoadCraft artifacts, follow skills/loadcraft-openapi/SKILL.md,
skills/loadcraft-journeys/SKILL.md and skills/loadcraft-asyncapi/SKILL.md.
EOF
```

Then, in the Copilot chat window, add `skills/loadcraft-openapi/SKILL.md` as
context (**Add Context → Files** or `#file`) and ask for the workflow to be
executed.

## Any other AI (ChatGPT, Gemini, etc.)

Paste or attach the contents of `SKILL.md` and the files from `references/`
and write: *"This is a working instruction. Apply it to my project, phase by
phase."* Run the validator from `scripts/` manually on the result.

---

Installed? Continue with the [user guide](README.md).
