---
name: api-docs
description: Generate complete, accurate OpenAPI documentation for an undocumented or partially documented API codebase, and keep it current on re-runs. First run - stack reconnaissance (language, framework, existing swagger/OpenAPI tooling), strategy choice (native code-first vs. sidecar spec files), then EVERY endpoint analyzed as a separate deep-dive task tracing exact request/response schemas, followed by merge, validation, and acceptance review. Re-runs switch to maintenance mode - verify the entire documentation against current code, detect drift (new/removed/changed endpoints or schemas), and apply corrections. Use whenever the user asks to document an API, generate OpenAPI/Swagger specs or endpoint docs, mentions swagger, OpenAPI, API reference, endpoint schemas, asks what an API accepts/returns, or asks whether existing API docs are stale or need refreshing. Trigger even for a single endpoint or a docs drift audit.
---

# API Docs Generator

Produce a trustworthy OpenAPI 3.1 specification (3.0 only if the toolchain requires it)
for a codebase, endpoint by endpoint, with zero guessed schemas.

**Core principle: NEVER GUESS.** Every field, type, and status code in the output must be
traceable to code you actually read. Anything you could not verify gets an explicit
`x-todo` marker with a file/line reference — never a plausible-looking invention.
An incomplete-but-honest spec is the deliverable; a complete-but-invented one is a failure.

**Who consumes this spec:** primarily machines. The spec will be fed to AI agents that
generate performance-test scenarios (Gatling, k6, JMeter) and integration clients.
This means: (1) every endpoint description is written in simple language stating what
a user can accomplish with it, and (2) each endpoint carries the machine-usable
metadata (`x-perf`) defined in `references/endpoint-analysis.md` — auth prerequisites,
data dependencies, idempotency, load-test safety. The acceptance test for the whole
spec is: *could an AI construct a valid, runnable request from the spec alone,
without reading the code?*

The workflow has five phases. Do them in order. Do not skip Phase 0.

**Before anything else, detect the mode.** Check whether this skill has run here before:
does `docs-workspace/state.json` exist (or the spec/annotations this skill produces)?
- **No → First run:** execute Phases 0–4 below in full.
- **Yes → Maintenance run:** the documentation already exists; your job is to verify it
  hasn't gone stale and to fix what has. Follow `references/maintenance-mode.md`.
  Do NOT regenerate everything from scratch — re-analyze only what changed, then
  re-run validation and acceptance on the whole spec.

At the end of EVERY run (first or maintenance), write `docs-workspace/state.json`:

```json
{
  "strategy": "C",
  "last_run": "2026-07-20T14:00:00Z",
  "last_commit": "<git rev-parse HEAD, or null if no git>",
  "endpoints_documented": 47,
  "open_todos": 3
}
```

---

## Phase 0 — Stack reconnaissance & strategy decision

Before generating anything, figure out what you are dealing with and how the
documentation should live in this project. Read `references/stack-detection.md`
for the detection checklist and `references/strategy-matrix.md` for the decision rules.

Summary of what to do:

1. **Detect language & framework.** Look at manifests first (`package.json`,
   `requirements.txt`/`pyproject.toml`, `pom.xml`/`build.gradle`, `*.csproj`,
   `go.mod`, `composer.json`, `Gemfile`), then at how routes are declared.
2. **Detect existing OpenAPI tooling — and report it as a deliverable.** Search
   dependencies and code for swagger/openapi packages, existing spec files
   (`openapi.*`, `swagger.*`, `api-docs`), annotations/decorators, and doc routes
   (`/docs`, `/swagger`, `/api-docs`). Partial docs are common. Write the findings to
   `docs-workspace/tooling-audit.md`: what exists, where, how stale it is (diff old
   spec against actual routes), and whether it can be finished vs. must be replaced.
   Answer explicitly: "is there already something in this code that generates OpenAPI
   docs?" — yes/no/partially, with file references.
3. **Choose a strategy** (see the matrix for full rules):
   - **Strategy A — Native code-first**: the framework can generate the spec itself
     (FastAPI, NestJS + @nestjs/swagger, Spring + springdoc, .NET Minimal APIs,
     DRF + drf-spectacular, etc.). Prefer this when available: init/configure the
     tooling, then your per-endpoint work becomes *enriching* the code (annotations,
     typed responses, docstrings) so the generated spec is complete.
   - **Strategy B — Annotation retrofit**: framework has no generator but a mature
     annotation ecosystem exists (e.g. Express + swagger-jsdoc, Flask + flasgger,
     Laravel + l5-swagger). Per-endpoint work produces annotations next to the code.
   - **Strategy C — Sidecar spec**: hand-maintained `openapi.yaml` kept beside the
     code (in `docs/` or `spec/`), split into per-path fragment files and bundled.
     Choose when the code cannot or should not be modified, when the framework is
     exotic/legacy, or when the team wants spec-as-artifact under separate review.
4. **Report the decision to the user before proceeding.** Present: detected stack,
   what OpenAPI support already exists, the recommended strategy with a one-paragraph
   justification, and the trade-off of the runner-up. Wait for confirmation if the
   choice is not obvious. If the user already stated a preference, follow it.

---

## Phase 1 — Endpoint inventory

One pass over the routing layer to build the work queue. Do NOT analyze behavior yet.

1. Find every route registration: routers, controllers, decorators, route files,
   URL confs, attribute routes — including routes mounted dynamically or via plugins.
2. Write `docs-workspace/endpoints.json`, one entry per (method, path):

```json
{
  "id": "get__api_v1_users__id",
  "method": "GET",
  "path": "/api/v1/users/{id}",
  "handler_file": "src/controllers/users.ts",
  "handler_symbol": "getUserById",
  "auth_middleware": ["requireAuth"],
  "status": "pending"
}
```

3. Report the count to the user ("Found 47 endpoints across 9 route files") and list
   anything suspicious: duplicate paths, catch-all routes, routes behind feature flags,
   admin/internal prefixes. Ask whether internal/debug endpoints should be documented.

---

## Phase 2 — Per-endpoint deep dive (one endpoint = one task)

This is the heart of the skill. **Each endpoint is analyzed as its own isolated task
with a fresh focus.** Never batch endpoints into one analysis pass — batching is how
schemas get pattern-matched instead of traced.

- **In Claude Code / environments with subagents:** spawn one subagent per endpoint
  (parallelize in groups of 3–5). Give each subagent ONLY its endpoint entry plus the
  instructions in `references/endpoint-analysis.md`.
- **Without subagents:** process endpoints strictly one at a time, completing and
  writing each endpoint's output file before opening the next. Re-read
  `references/endpoint-analysis.md` if drifting toward shortcuts.

For every endpoint the analysis must trace, in code, all of:

1. **Purpose** — what the endpoint actually does (follow the handler into services;
   the description should say what it's *for*, not paraphrase its name).
2. **Request** — path params, query params (names, types, defaults, required-ness),
   headers, and the full request body schema traced to its validator/DTO/model.
3. **Response** — the EXACT shape of every response: follow the return value through
   serializers/DTOs/ORM models to concrete field names and types. Include nullability
   and optionality. One traced example per success response.
4. **Status codes & errors** — every code the handler (and its middleware) can emit:
   validation errors, auth failures, not-found, conflicts, rate limits, and the error
   body schema.
5. **Auth & side effects** — auth scheme, required roles/scopes, and notable side
   effects (sends email, mutates other resources, is idempotent or not).

Output per endpoint (Strategy C: a YAML fragment in `docs-workspace/paths/<id>.yaml`;
Strategy A/B: the code annotations/typing changes, plus the same YAML fragment as a
review artifact). Unverifiable facts get `x-todo: "<what's unknown> — see file:line"`.

Update `endpoints.json` status (`done` / `blocked`) after each endpoint. This makes the
run resumable and gives the user a progress view.

---

## Phase 3 — Merge & deduplicate

1. Assemble fragments into a single spec (`docs-workspace/openapi.yaml` for Strategy C;
   for A/B, regenerate the spec from the now-annotated code and diff it against the
   fragments to catch anything the generator dropped).
2. Extract repeated object shapes into `components/schemas` and replace inline copies
   with `$ref`. Name schemas after the domain objects, not the endpoints.
3. Define `components/securitySchemes` once and apply per-endpoint `security` from the
   Phase 2 findings. Add shared error responses to `components/responses`.
4. Fill `info` (title, version, description), `servers`, and `tags` (group by resource).

## Phase 4 — Validate, accept & render

1. Lint: `npx @redocly/cli lint docs-workspace/openapi.yaml` (fallback:
   `npx @stoplight/spectral-cli lint`). Fix every error; review warnings.
2. **Run the acceptance review** against `references/acceptance-criteria.md` — the
   per-endpoint and spec-wide definition of done, including the AI round-trip test
   (generate a runnable request / Gatling scenario sketch from the spec alone and
   check it against the code). Produce `docs-workspace/acceptance-report.md` with
   pass/fail per criterion. Endpoints that fail go back to Phase 2.
3. Grep the final spec for `x-todo` and present the list to the user as an explicit
   "could not verify" report — do not silently drop them.
4. Offer a renderer: Scalar or Redoc (modern, static-friendly) or Swagger UI
   (if the team already uses it / wants try-it-out). For Strategy A the framework
   usually ships its own docs route — prefer that.
5. Recommend drift protection: commit the spec, and add a CI step that regenerates
   (A/B) or lints (C) the spec and fails on undocumented new routes.

---

## Failure modes to actively avoid

- **Guessed schemas.** If the response is built dynamically (dict spreading, `**kwargs`,
  reflection, raw SQL), say so in `x-todo` instead of inventing fields.
- **Name-based descriptions.** "Gets a user by id" for `getUserById` is not analysis.
- **Ignoring middleware.** Auth, pagination wrappers, envelope formats (`{data, meta}`)
  and global error handlers change the real contract — trace them once in Phase 0/1
  and apply to every endpoint.
- **Documenting the intent instead of the code.** If the code contradicts a comment,
  document the code and flag the discrepancy.
- **One giant pass.** If you notice yourself writing multiple endpoints from one read
  of a controller file, stop and return to the per-endpoint protocol.
