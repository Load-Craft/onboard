**English** | [Polski](README.pl.md)

# onboard — skills that prepare LoadCraft artifacts

Distribution repository for AI skills (working instructions for AI assistants)
that customers run on their own codebase to produce **ready-to-import LoadCraft
input files**. The skills work in Claude Code, Codex and any other tool
compatible with the Agent Skills format.

| Skill | You get | You do with it |
|---|---|---|
| [`loadcraft-openapi`](skills/loadcraft-openapi/) | `loadcraft/openapi.json` — a description of your API | import it in LoadCraft as the API specification |
| [`loadcraft-journeys`](skills/loadcraft-journeys/) | `loadcraft/journeys/*.txt` — user scenarios, one per file | paste each file's content into LoadCraft's scenario description field |
| [`loadcraft-asyncapi`](skills/loadcraft-asyncapi/) | `loadcraft/asyncapi.json` — a description of your event/messaging API (WebSockets, Kafka, MQTT…) | import it in LoadCraft as the AsyncAPI specification |
| [`loadcraft-overview`](skills/loadcraft-overview/) | `loadcraft/overview.md` — a plain-language overview of what your project is | paste its content into the description field at LoadCraft project setup |

All skills follow the same rules: they only read your code (nothing is
modified, installed or started), they never guess — anything they cannot
confirm is listed in the report as a question to resolve — and no passwords,
tokens or customer data end up in the files.

## Plugin for Claude Code

In Claude Code the same repository is also a **plugin**: on top of the skills above it adds a server that
talks to LoadCraft, so one sentence (*"run a load test of this application"*) takes you from your code to a
finished test and its diagnosis. It needs a LoadCraft instance with API tokens.

```text
/plugin marketplace add Load-Craft/onboard
/plugin install loadcraft@loadcraft
```

- [Install the plugin](docs/plugin/INSTALL.md) — requirements, token, configuration, permission rules.
- [Use the plugin](docs/plugin/USAGE.md) — what happens in the eight steps and what Claude asks you.
- [Security](docs/plugin/SECURITY.md) — what leaves your computer and what the assistant never sees.

## Repository layout

- **[`skills/`](skills/)** — skill sources + the [user guide](skills/README.md)
  and [installation](skills/INSTALL.md). Each skill: `SKILL.md` +
  `references/` + `scripts/` (a stand-alone validator run with plain `node`, no install
  step; its TypeScript source is in [`validators/`](validators/)).
- **[`validators/`](validators/)** — TypeScript source of the four validators; `npm run build:skills`
  (in `mcp/`) builds them into `skills/*/scripts/validate_*.mjs`.
- **`dist/`** — ready-to-download ZIPs (one per skill). Refresh after changes:
  `./scripts/package.sh`.
- **`.claude-plugin/`, `.codex-plugin/`** — plugin manifests; once the repo is
  published, the skills can also be installed with
  `npx skills add <owner>/<repo> --skill loadcraft-openapi`.
- **`tests/`** — validator and skill tests on neutral fixtures (vitest). Run with:
  `cd mcp && npm run test:skills`.
- **[`AGENTS.md`](AGENTS.md)** — package maintenance rules (test-first contract
  changes, versioning, pre-release checklist).
- **[`EVALUATION.md`](EVALUATION.md)** — evaluation report of the skills on the
  Shopcraft project, including a comparison with the previous generation of
  skills (`api-docs`, `user-flows` — available in git history).

The `.claude/skills/` directory contains only symlinks to `skills/` — the
skills work locally in Claude Code while there is a single source of truth.

## License

[Apache-2.0](LICENSE). You may run these skills on your own code,
modify them and redistribute them, including commercially. The license carries
an explicit patent grant — the question your legal review will ask first about a
tool that reads your source.
