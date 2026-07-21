# Acceptance criteria — definition of done for the documentation

Run this review in Phase 4 (and any time the user asks "was the documentation done
right?"). Output: `docs-workspace/acceptance-report.md` with PASS/FAIL per criterion,
listing offending endpoints by `operationId`. Anything failing goes back to Phase 2.

## A. Spec-wide criteria

- [ ] **A1 — Valid & lint-clean.** `redocly lint` (or spectral) reports zero errors.
- [ ] **A2 — Complete coverage.** Every route found in the Phase 1 inventory appears
      in the spec; the spec contains no route that doesn't exist in code. Verify by
      re-running the inventory and diffing against the spec's paths.
- [ ] **A3 — No silent gaps.** All unverifiable facts are explicit `x-todo` entries;
      the `x-todo` report was shown to the user. Zero invented fields (spot-check 10%
      of endpoints by re-tracing their schemas against code).
- [ ] **A4 — Shared components.** Repeated object shapes live in `components/schemas`
      with `$ref`; security schemes defined once; common error responses shared.
- [ ] **A5 — Tooling audit exists.** `tooling-audit.md` answers whether OpenAPI
      generation already existed in the code and how it was used or replaced.

## B. Per-endpoint criteria

- [ ] **B1 — Capability description.** `description` states in plain language what a
      user can accomplish with the endpoint. Test: cover the path and method — can a
      non-developer still tell what this endpoint lets them do? It must not merely
      restate the handler name, the HTTP method, or the schema.
- [ ] **B2 — Exact schemas.** Request and every response schema traced to code, with
      nullability/optionality explicit and at least one traced example per success
      response.
- [ ] **B3 — Full error surface.** Every status code the handler + middleware can emit
      is present, with error body schema — not just 200.
- [ ] **B4 — Deliberate security.** Every endpoint has a `security` block; public
      endpoints have explicit `security: []` (confirmed intentional, not forgotten).
- [ ] **B5 — `x-perf` present and traced.** Auth prerequisite, data dependencies,
      idempotency, `read_only`, `load_test_safe` (false for anything touching
      payments/email/SMS/third parties), typical payload size.

## C. AI round-trip test (the decisive check)

The spec's stated purpose is to let an AI generate performance-test scenarios
(Gatling / k6 / JMeter) **without reading the source code**. Verify it can:

- [ ] **C1 — Cold construction.** Using ONLY the spec (fresh context, no code access),
      construct a complete, concrete HTTP request for 5 randomly sampled endpoints:
      full URL, headers, auth, valid body. Then check each against the code: would it
      be accepted? Any mismatch = the spec is wrong or incomplete → FAIL that endpoint.
- [ ] **C2 — Scenario sketch.** Using only the spec, draft a Gatling-style user
      journey (e.g. login → browse → create → verify) for one core resource. The
      draft must be derivable from `x-perf.auth_prerequisite` and
      `x-perf.data_dependencies` alone — if the AI has to guess call ordering or
      setup data, the dependency metadata is insufficient → FAIL.
- [ ] **C3 — Safety derivable.** From the spec alone, list which endpoints must be
      excluded or mocked in a load test. The list must match the known
      side-effecting endpoints (payments, notifications, third-party calls).

## Reporting format

```markdown
# Acceptance report — <project> — <date>
## Spec-wide: A1 PASS | A2 FAIL (2 undocumented routes: ...) | ...
## Endpoints failing criteria
- getUserOrders: B1 (description restates schema), B3 (missing 409)
## AI round-trip
- C1: 5/5 requests valid
- C2: FAIL — checkout scenario required guessing cart-creation order
## Verdict: NOT ACCEPTED — 4 endpoints returned to Phase 2
```
