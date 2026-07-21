# Stack detection checklist

Goal: identify (1) language, (2) web framework, (3) existing OpenAPI/Swagger tooling,
(4) how routes are declared, (5) how responses are shaped (serializers? plain dicts?).

## 1. Manifests → language & framework

| File | Language | Look for (framework deps) |
|---|---|---|
| `package.json` | JS/TS | `express`, `fastify`, `koa`, `hapi`, `@nestjs/core`, `next`, `hono` |
| `pyproject.toml` / `requirements.txt` / `Pipfile` | Python | `fastapi`, `flask`, `django`, `djangorestframework`, `aiohttp`, `sanic`, `tornado` |
| `pom.xml` / `build.gradle(.kts)` | Java/Kotlin | `spring-boot-starter-web`, `quarkus`, `micronaut`, `dropwizard`, `ktor` |
| `*.csproj` | C#/.NET | `Microsoft.AspNetCore.*`; note target framework (net6/8/10) |
| `go.mod` | Go | `gin-gonic/gin`, `labstack/echo`, `gofiber/fiber`, `chi`, `gorilla/mux`, stdlib `net/http` |
| `composer.json` | PHP | `laravel/framework`, `symfony/*`, `slim/slim` |
| `Gemfile` | Ruby | `rails`, `sinatra`, `grape` |

Multiple manifests → monorepo; ask the user which service(s) to document, or document
each service as a separate spec.

## 2. Existing OpenAPI tooling → search for

- Dependencies: `swagger-jsdoc`, `swagger-ui-express`, `@nestjs/swagger`, `tsoa`,
  `zod-to-openapi`, `@fastify/swagger`, `drf-spectacular`, `drf-yasg`, `flasgger`,
  `flask-smorest`, `apispec`, `springdoc-openapi`, `springfox`, `Swashbuckle`,
  `Microsoft.AspNetCore.OpenApi`, `NSwag`, `swaggo/swag`, `l5-swagger`,
  `zircote/swagger-php`, `nelmio/api-doc-bundle`, `rswag`, `grape-swagger`.
- Spec files: `openapi.{yaml,yml,json}`, `swagger.{yaml,json}`, `api-docs/`,
  `docs/api*`, `postman_collection.json` (useful as input, not a source of truth).
- Doc routes in code: `/docs`, `/redoc`, `/swagger`, `/swagger-ui`, `/api-docs`,
  `MapOpenApi`, `SwaggerModule.setup`, `app.docs_url`.
- Annotations already present: `@Operation`, `@ApiResponse`, `@openapi` JSDoc blocks,
  `# @swag`, `@OA\`, `swagger:` comments in Go.

If an old spec exists: treat it as a *claim to verify*, never as ground truth.
Diff it against the Phase 1 inventory and report drift (missing endpoints, removed
endpoints still documented, changed schemas).

## 3. Native generation capability per framework

- **Generates spec out of the box (Strategy A candidates):** FastAPI, flask-smorest,
  Litestar, DRF + drf-spectacular, NestJS + @nestjs/swagger, tsoa, Fastify +
  @fastify/swagger (with schemas), Spring + springdoc, Quarkus, Micronaut,
  .NET (Swashbuckle on ≤net8, built-in `Microsoft.AspNetCore.OpenApi` on net9/10 —
  do NOT add Swashbuckle to net9+ projects), Laravel + Scramble.
- **Annotation-driven (Strategy B candidates):** Express/Koa + swagger-jsdoc,
  Flask + flasgger, Go + swaggo, PHP + swagger-php/l5-swagger, Rails + rswag.
- **No sane tooling / legacy / can't touch the code → Strategy C.**

## 4. Response-shaping audit (do once, applies to all endpoints)

Find and note globally:
- Envelope wrappers (`{ "data": ..., "meta": ... }`, `{ "success": true, ... }`).
- Global error handler and its error body shape.
- Pagination convention (page/limit? cursor? Link headers?).
- Content types beyond JSON (file uploads, CSV exports, SSE, websockets — the latter
  two are out of OpenAPI scope; note them in `info.description`).
- Auth middleware and token format(s); multi-tenant headers.

Record these in `docs-workspace/conventions.md` so per-endpoint tasks reuse instead of
rediscovering them.
