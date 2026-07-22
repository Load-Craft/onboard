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

Both skills follow the same rules: they only read your code (nothing is
modified, installed or started), they never guess — anything they cannot
confirm is listed in the report as a question to resolve — and no passwords,
tokens or customer data end up in the files.

## Repository layout

- **[`skills/`](skills/)** — skill sources + the [user guide](skills/README.md)
  and [installation](skills/INSTALL.md). Each skill: `SKILL.md` +
  `references/` + `scripts/` (a validator in pure Python, no dependencies).
- **`dist/`** — ready-to-download ZIPs (one per skill). Refresh after changes:
  `./scripts/package.sh`.
- **`.claude-plugin/`, `.codex-plugin/`** — plugin manifests; once the repo is
  published, the skills can also be installed with
  `npx skills add <owner>/<repo> --skill loadcraft-openapi`.
- **`tests/`** — validator tests on neutral fixtures. Run with:
  `python3 -m unittest discover -s tests -v`.
- **[`AGENTS.md`](AGENTS.md)** — package maintenance rules (test-first contract
  changes, versioning, pre-release checklist).
- **[`EVALUATION.md`](EVALUATION.md)** — evaluation report of the skills on the
  Shopcraft project, including a comparison with the previous generation of
  skills (`api-docs`, `user-flows` — available in git history).

The `.claude/skills/` directory contains only symlinks to `skills/` — the
skills work locally in Claude Code while there is a single source of truth.
