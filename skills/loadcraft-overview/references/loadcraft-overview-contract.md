# LoadCraft project overview contract

`loadcraft/overview.md` is one Markdown file whose **entire content is the value of the project `description` field** entered at project setup in LoadCraft. Nothing in the file is hidden metadata — everything you write reaches LoadCraft's consumers.

## Who consumes the description — and what that implies

The description is not decoration. In the current LoadCraft codebase it feeds three paths, and each dictates part of the content:

1. **Setup readiness gate** (`setup_gate.py`): a non-empty description is one of the setup-completeness criteria. → The file must exist and be substantive.
2. **Flow generation context** (`project_flow_generation_service.py` → `api_description` in the test-flow generator's LLM graph): the description tells the generator what the application does when it composes flows. → Cover what the application does, for whom, and its main business flows.
3. **Semantic feeder-data synthesis** (`gatling/feeders/semantic_text_synthesis.py`): the description is injected verbatim into the prompt that generates realistic test data values. → Cover the domain's entities and the **shape of its data** (locales/languages, identifier formats, realistic value examples) — this directly controls how realistic generated feeder data will be.

## Required content

Start with an H1 title naming the application, then cover — in prose, in this or a similar order:

1. **What the application does and for whom** — one or two paragraphs.
2. **Domain and key entities** — the main objects, their relationships and states.
3. **User roles and their key actions** — who uses the system and what each role mainly does.
4. **Main business flows** — short prose descriptions; no UI steps and no numbered scenario instructions (those belong to the journeys skill).
5. **Data characteristics** — languages/locales of the data, shapes of typical values (identifiers, codes, names, amounts), with synthetic illustrative examples.
6. **External integrations and noise** — identity providers, payments, analytics, CDNs; which traffic is noise from a load-testing perspective.

Every statement must be grounded in repository evidence (README, manifests, domain models, routing, i18n resources, configuration). A section you cannot ground is reported as a blocker in the delivery report — never padded with plausible-sounding prose.

## Dialect rules

- Markdown is allowed and welcome: headings, short lists, emphasis. The consumers treat the content as text and humans read it in the project UI.
- No code fences and no tables — they add prompt noise without adding meaning a description needs.
- 200–8000 characters after trimming surrounding whitespace. The description travels inside LLM prompts; keep it dense, not exhaustive.
- No secrets, credentials, tokens, or production data. No examples or values on secret-bearing fields. Synthetic illustrative values only.
- No unresolved markers (`TODO`, `x-todo`, `TBD`).
- No source-file references (`path/file.py:123`) — they are noise in every consumer.
- No references to other LoadCraft artifacts by filename; the description must stand alone.

## Provenance stamp

The Markdown content cannot carry metadata (all of it reaches prompts), so the stamp lives in a sidecar file next to the artifact:

`loadcraft/overview.provenance.json` — `{"commit": "<git rev-parse HEAD>", "dirty": <bool>}`

The bundled validator checks the sidecar's shape when present. Omit it when the repository is not under git and say so in the delivery report. The sidecar is never pasted into LoadCraft.

## Maintenance

On a refresh, read the sidecar stamp. When `dirty` is false and the commit resolves, run `git diff --name-only <commit>..HEAD` and **judge impact before rewriting**: a change to domain models, routing surface, i18n resources, integrations, or product documentation can affect the overview; a purely technical change (refactor, tests, CI, dependency bumps) usually does not. When nothing impacts the description, keep the content untouched and only re-stamp; when something does, update the affected sections and report which diff entries drove the update. When the stamp is missing, `dirty` is true, or the commit does not resolve, re-verify the whole document against the repository.
