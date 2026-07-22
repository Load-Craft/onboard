**English** | [Polski](README.pl.md)

# onboard — skills that prepare LoadCraft artifacts

Distribution repository for AI skills (working instructions for AI assistants)
that customers run on their own codebase to produce **ready-to-import LoadCraft
input files**. The skills work in Claude Code, Codex and any other tool
compatible with the Agent Skills format.

| Skill | Artifact | What it does |
|---|---|---|
| [`loadcraft-openapi`](skills/loadcraft-openapi/) | `loadcraft/openapi.json` | Analyzes API code (read-only) and builds one OpenAPI file in the LoadCraft compatibility profile (3.0.3, explicit per-operation `security`, no lossy `anyOf`), validated by the bundled script. |
| [`loadcraft-journeys`](skills/loadcraft-journeys/) | `loadcraft/journeys/*.txt` | Analyzes frontend code and writes user journeys as plain text — each file is exactly the value of the scenario description field in LoadCraft. |

Both skills share the same principles: the customer repository is read-only,
missing evidence in the code is reported as a blocker (never guessed, never
written into the artifact as a TODO), and secrets or customer data never end
up in the outputs.

## Repository layout

- **[`skills/`](skills/)** — skill sources + [usage instructions](skills/README.md)
  for each tool. Each skill: `SKILL.md` + `references/` + `scripts/`
  (a validator in pure Python, no dependencies).
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
