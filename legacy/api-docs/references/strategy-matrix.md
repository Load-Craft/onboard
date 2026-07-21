# Documentation strategy decision matrix

Three strategies. Pick ONE primary strategy in Phase 0 and tell the user why.

## Strategy A — Native code-first (framework generates the spec)

**Choose when:** the framework (or a first-class library) can emit the spec itself,
the team is allowed to modify code, and the API will keep evolving.

**Why it's the default when available:** the spec can never silently drift — it is
regenerated from the code on every build. The per-endpoint work in Phase 2 turns into
making the code self-describing: typed responses/DTOs, decorators, docstrings,
`summary`/`description` metadata, declared error responses.

**Init steps (examples):**
- FastAPI / Litestar: already generating; work = add `response_model`, docstrings,
  `responses={...}` for errors, tags.
- NestJS: `npm i @nestjs/swagger`, `SwaggerModule.setup`, then `@ApiOkResponse` etc.
- Spring: add `springdoc-openapi-starter-webmvc-ui`, then `@Operation`/`@ApiResponse`.
- .NET 9/10: `AddOpenApi()` + `MapOpenApi()`, use `TypedResults` union returns,
  `.WithSummary()/.WithTags()`; add transformers for security schemes.
- DRF: add `drf-spectacular`, set schema class, then `@extend_schema` per view.

**Trade-off:** touches production code (needs review/tests); spec quality is capped by
how expressive the framework's typing is (dynamic responses still need manual overrides).

## Strategy B — Annotation retrofit (comments/attributes next to code)

**Choose when:** no native generator, but a mature annotation tool exists and the team
accepts doc-comments in the codebase (Express + swagger-jsdoc, Flask + flasgger,
Go + swaggo, PHP + swagger-php, Rails + rswag).

**Trade-off:** annotations are not checked against actual behavior by the compiler —
drift is possible; that's why Phase 2 traces the real code and the annotation is the
*output* of that trace, not a guess. Recommend a CI lint + route-coverage check.

## Strategy C — Sidecar spec (separate files beside the code)

**Choose when:** code must not / cannot be modified (vendor, legacy, frozen release),
framework is exotic, the "code" is partly config/SQL/gateway rules, or the team
explicitly wants spec-as-artifact with its own review process.

**Layout:**
```
docs/
├── openapi.yaml          # bundled output (generated, committed)
└── src/
    ├── root.yaml         # info, servers, tags, security
    ├── paths/*.yaml      # one file per endpoint (Phase 2 outputs land here)
    └── components/*.yaml # schemas, responses, parameters
```
Bundle with `npx @redocly/cli bundle docs/src/root.yaml -o docs/openapi.yaml`.

**Trade-off:** highest drift risk. Mitigate with a CI job that re-runs the Phase 1
inventory and fails when a route exists that the spec doesn't mention (and vice versa).

## Tie-breakers

- Existing partial tooling wins: if springdoc/@nestjs/swagger/etc. is already half-set-up,
  finish it (A) rather than starting a sidecar.
- Existing hand-written `openapi.yaml` that the team edits → stay with C, but restructure
  into split files and add linting.
- Mixed system (some services A-capable, some not) → per-service strategy is fine;
  keep the output format and conventions identical across services.
- User preference always overrides the matrix.
