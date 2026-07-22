# LoadCraft preparation skills maintenance

This package has one canonical source for each skill. Keep the same `SKILL.md`, references, and scripts for every supported agent. Do not fork instructions into Codex-specific and Claude-specific copies.

## Package invariants

- `loadcraft-openapi` emits one `openapi.json` in the documented compatibility profile.
- `loadcraft-journeys` emits only direct-input `.txt` journey descriptions.
- `loadcraft-asyncapi` emits one `asyncapi.json` (AsyncAPI 3.0) in its documented compatibility profile.
- Repository analysis is read-only by default; only explicit output artifacts may be written.
- Unknown behavior blocks readiness. Do not add fallbacks, guessed fields, TODO markers, or best-effort normalizers.
- Workers never update shared state. One coordinating agent owns final writes.
- The only maintenance state is the provenance stamp: `info.x-loadcraft-source` inside the OpenAPI and AsyncAPI artifacts, and `.provenance.json` beside the journey files (journey payloads cannot carry metadata). No other state files.
- References stay one level below their skill and are linked directly from `SKILL.md`.
- Keep platform metadata outside core instructions. `agents/openai.yaml` may improve Codex presentation but cannot change behavior.
- Keep `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` on the same semantic version.

## Change protocol

Before changing a LoadCraft compatibility rule, verify the current importer and downstream consumer in the LoadCraft codebase. Add or update a failing validator test first, then change the validator, skill instructions, and relevant reference together.

Use only neutral fixtures such as `app.example.com`, `/api/orders`, `order-example`, `user@example.com`, and `users.csv`. Never copy customer repository content into tests or documentation.

Run before delivery:

```bash
python3 -m unittest discover -s tests -v
python3 <skill-creator-root>/scripts/quick_validate.py skills/loadcraft-openapi
python3 <skill-creator-root>/scripts/quick_validate.py skills/loadcraft-journeys
python3 <skill-creator-root>/scripts/quick_validate.py skills/loadcraft-asyncapi
python3 <plugin-creator-root>/scripts/validate_plugin.py .
```

Forward-test every skill against small synthetic repositories after changing workflow instructions. Review produced artifacts, not only the model's explanation.

Use one bundle version. A corrective instruction or validator fix is a patch; a compatible capability or new skill is a minor release; removing, renaming, or breaking a skill is a major release. Formatting and CI-only changes do not require a version bump before the first published release.
