# Evaluation report

Date: 2026-07-20

This report evaluates the two alternative skills with synthetic repositories and the Shopcraft target, then compares their Shopcraft artifacts with the existing baseline files produced by the previous-generation skills.

## Method and safety boundary

- All repository analysis was static.
- No Shopcraft service was started, restarted, or called.
- No dependency was installed.
- Shopcraft source and the baseline files remained read-only.
- Generated artifacts were written under a temporary evaluation workspace outside both repositories.
- Secret/configuration and seed-value files were excluded.
- Both artifact validators and the real LoadCraft `OpenAPIParser` were exercised locally.

This was a Codex behavioral cold run. Package structure was also checked with both OpenAI's and Anthropic's skill validators; an independent Claude behavioral run remains a release gate.

## Synthetic forward tests

The OpenAPI skill analyzed a two-route FastAPI fixture and produced exact `2/2` route parity. The journey skill analyzed a small React fixture and produced one coherent create-and-process journey. Both outputs passed their bundled validators without running either application.

The cold runs exposed two issues that were fixed test-first:

1. The OpenAPI validator originally printed `LoadCraft-ready` even though it can prove only structural compatibility. It now reports `passes LoadCraft structural preflight`.
2. The journey validator accepted a finish phrase anywhere in the file. It now requires the observable finish condition to be the final instruction.

## Shopcraft: OpenAPI skill

Final artifact:

`<eval-workspace>/openapi/openapi.json`

### Structural result

- Source operations: `15`
- Artifact operations: `15`
- Missing operations: `0`
- Extra operations: `0`
- Explicitly protected operations: `4`
- Public operations with explicit `security: []`: `11`
- OpenAPI version: `3.0.3`
- Server: `http://localhost:8081`, supplied as authoritative environment context

The protected operations are `POST /api/cart/items`, `GET /api/cart`, `POST /api/checkout`, and `GET /api/orders`. Their guard is grounded in `shopcraft/backend/app/auth.py:31-42`; the route dependencies are in `shopcraft/backend/app/main.py:194-298`.

The structural validator passes all 15 operations. The real LoadCraft parser projects:

- `15` endpoints;
- `20` schemas;
- `1` security scheme;
- the expected four protected operations.

Route evidence is in `shopcraft/backend/app/main.py:87-297`, request and response models in `shopcraft/backend/app/schemas.py:8-90`, and the global chaos `503` behavior in `shopcraft/backend/app/main.py:67-81`.

### Semantic blockers retained in the delivery report

The artifact is not labeled fully ready solely from structural PASS:

- FastAPI's automatic `422` statuses are not represented. Static source proves validation exists, but the exact framework envelope was not derived through a safe native-generator run.
- `Decimal` response properties use `type: string`, `format: decimal`, consistent with the pinned Pydantic v2 serialization path but not runtime-tested here.
- `/metrics` uses `text/plain`; the exact Prometheus media-type parameters were not expanded.
- `/admin/reset` is destructive and `/chaos/*` changes the environment. Full route parity includes them, but LoadCraft does not consume an `x-perf` safety policy, so endpoint selection remains an explicit operator decision.

The initial cold-run artifact also contained fixed examples on login/register email and password fields. Evaluation tightened the skill and validator: secret-bearing properties can no longer embed examples/defaults/enums, and unique or externally provisioned values must be described as feeder/credential requirements. The final temporary artifact has those examples removed and passes again.

## Existing baseline `openapi.json` versus the new artifact

Both files cover the same 15 source operations, use the same server, materialize the same four protected operations, and parse without an exception. They are not equally safe for the current LoadCraft model.

| Concern | baseline `openapi.json` | New skill artifact |
|---|---|---|
| Route parity | `15/15` | `15/15` |
| OpenAPI profile | `3.1.0` | `3.0.3` compatibility profile |
| Bundled preflight | Fails with 6 errors | Passes |
| Real parser projection | 15 endpoints, 16 schemas, 1 scheme | 15 endpoints, 20 schemas, 1 scheme |
| Optional `category` query | `anyOf`; parser silently projects it as `object` | Explicit optional `string`; parser preserves `string` |
| Validation errors | Seven `422` statuses and validation schemas | `422` omitted and reported as semantic blocker |
| Examples | 31, including literal token response fields and seed-shaped responses | 6 non-secret synthetic examples after correction |
| Constant response values | Mostly generic native schemas | Grounded enums for fixed statuses such as `ok`, `reset`, and `confirmed` |
| Dangerous routes | Present without a machine-enforced safety boundary | Present for parity and explicitly reported for operator selection |

The six baseline preflight errors are:

- OpenAPI `3.1.0` instead of the current `3.0.3` profile;
- a lossy `anyOf` in `ValidationError.loc.items`;
- a lossy optional-category `anyOf` and missing single parameter type;
- two response examples containing literal `access_token` fields.

The baseline's principal advantage is richer framework-native error coverage, especially `422`. Its principal defect is silent semantic degradation in the current parser: `GET /api/products?category=...` becomes an `object` parameter rather than a string. The best production artifact is therefore the new compatibility shape plus safely normalized `422` status coverage once the exact envelope policy is approved.

## Shopcraft: journey skill

Final artifacts:

- `<eval-workspace>/journeys/register-account.txt`
- `<eval-workspace>/journeys/view-product-details.txt`
- `<eval-workspace>/journeys/purchase-product.txt`

All three pass the directory validator. Every one of their 17 quoted UI strings was matched verbatim in `shopcraft/frontend/app.js`.

Grounding highlights:

- registration form and transition: `frontend/app.js:51-108`;
- catalogue loading and details navigation: `frontend/app.js:111-190`;
- cart refresh, checkout, and confirmation: `frontend/app.js:192-252`;
- auth gate and logged-in UI: `frontend/app.js:255-305`.

The purchase journey avoids unstable assumptions: it chooses a random product with positive stock, waits for cart count or quantity to increase, then waits for the explicit order-confirmation state.

Withheld candidates were reported rather than guessed:

- login is shared LoadCraft auth setup, not a journey;
- pagination needs runtime evidence that a second page exists;
- exact stock decrement is a backend invariant outside the frontend-only scope;
- a standalone add-to-cart journey lacks an unambiguous product-correlated success signal;
- logout was not selected as a primary load journey.

## Existing baseline `journeys-workspace` versus the new journeys

LoadCraft's scenario endpoint accepts one raw `description: str` (`backend/api/routes/scenario_from_description.py:52-63`). The frontend trims and sends that text unchanged (`frontend/src/features/scenario-description/api/scenarioDescriptionApi.ts:113-132`). Therefore the whole contents of a selected journey file become model input.

| Concern | Existing workspace | New skill output |
|---|---|---|
| Coverage | 8 documented goals | 3 high-confidence primary goals |
| Direct LoadCraft input | No; Markdown documentation bundle | Yes; each `.txt` is the exact description value |
| Auth | Login inlined into authenticated journeys | Credentials supplied separately; registration remains a goal |
| Selectors/runner syntax | Playwright/CSS tables in every JRN | None |
| Variants and TODOs | Mixed into the same file; JRN-001 has a TODO | Withheld from payload and reported separately |
| Runtime assumptions | Includes fixed cart/page/stock assumptions | Avoids unproved counts and backend invariants |
| Credentials | Workspace metadata contains account-like test information | No literal account credentials |
| Maintenance state | Duplicated across catalog, screens, state, report, and JRN files | One direct format; grounding stays in the delivery report |
| Shared-write risk | Several shared state/summary files | Coordinator alone writes independent final `.txt` files |

Running the new validator on the baseline directory rejects every artifact because the directory contains Markdown/JSON instead of the one direct `.txt` format. Treating each JRN body as text still exposes headings, numbered lists, selector syntax, source references, variants, and non-final completion conditions. JRN-001 additionally contains an unresolved TODO.

The old workspace also contains valuable audit material that must not be put into `description`: its five-screen navigation map, accessibility findings, selector research, native-alert warning, cart-persistence note, commit provenance, and broader candidate catalog. Keep that information as an audit report or use it to request additional direct journeys.

### Specific baseline assumptions corrected by the new output

- `Cart (0 items)` is not stable because the cart persists server-side and is fetched after initial render (`frontend/app.js:192-203`).
- A fixed `Page 1 / 10` depends on runtime API data (`frontend/app.js:127-151`).
- Selecting the first product without checking stock can trigger a native alert on failure (`frontend/app.js:135-143,267-276`).
- Waiting merely for `Checkout` does not prove that an asynchronous add completed when the cart was already non-empty.
- Checking `Product #` or subtotal does not prove that the selected product was added when old cart content exists.
- A stock decrease of exactly one cannot be established from frontend rendering alone and can be invalidated by a persisted quantity.

For current LoadCraft, the new `.txt` files are the correct import product. The existing workspace is the better human audit artifact, but it must not be passed directly as `GenerateRequest.description`.

## Improvements applied during evaluation

The package now additionally enforces:

- structural-preflight wording rather than a false readiness claim;
- finish condition as the final journey instruction;
- no non-`.txt` artifacts or duplicate descriptions in a journey output directory;
- no runner dialect, source references, cross-file dependencies, TODOs, secret-like values, literal test-account emails, or password assignments in journeys;
- complete security-scheme shapes;
- explicit `requestBody.required`;
- recognized request media types only;
- no literal examples/defaults/enums on secret-bearing OpenAPI properties;
- preservation of known operations/statuses while unresolved nested facts block readiness;
- explicit reporting of dangerous environment-control endpoints;
- a candidate-goal inventory in working memory so withheld coverage cannot disappear silently.

## Release assessment

The architecture is suitable for Codex and Claude: one canonical skill source, thin vendor manifests, progressive references, and standard-library validators. The Shopcraft run confirms that both skills produce structurally valid direct LoadCraft inputs without touching the target repository.

Before a customer release, complete these gates:

1. Run the same behavioral fixtures with Claude, not only Anthropic's package validator.
2. Add an automated golden test that parses a generated OpenAPI artifact through the real LoadCraft parser and asserts parameter/security/status projection.
3. Decide the canonical FastAPI `422` representation that avoids unsupported unions, then test it.
4. Add an integration evaluation proving each `.txt` produces exactly one split journey and does not duplicate the auth setup; run NL tests serially.
5. Decide how LoadCraft will machine-enforce exclusion of admin/reset/chaos routes; a report warning alone is not sufficient for unattended generation.
6. Add public repository, homepage, license, and release tags to both manifests before distribution.

## Post-evaluation updates (2026-07-22)

This report describes the package as evaluated on 2026-07-20. Applied since,
outside the scope of the evaluation run:

- the journey skill was renamed `loadcraft-journey-description` → `loadcraft-journeys`;
- per-endpoint/per-journey task isolation is now mandatory (one operation per
  worker, parallel batches, anti-batching guardrail) instead of optional;
- the OpenAPI artifact carries a provenance stamp `info.x-loadcraft-source`
  (commit, dirty, method), shape-validated, and maintenance runs scope work
  via `git diff` from the stamped commit;
- validator fixes: camelCase secret-bearing property names are now caught,
  `[ TODO ]` markers with inner spacing are rejected, and the journey finish
  condition tolerates a trailing parenthetical after the final instruction;
- README/INSTALL documentation was rewritten for non-technical users
  (English primary, Polish variants);
- a third skill `loadcraft-asyncapi` was added (AsyncAPI 3.0 compatibility
  profile derived from LoadCraft's `asyncapi_parser.py` and flow generator),
  with a bundled validator, rule tests, and a forward-test on a synthetic
  WebSocket+Kafka fixture whose artifact was golden-tested through the real
  LoadCraft `AsyncAPIParser` with full channel/operation/message parity;
- both API skills now require branch-aware examples: value-driven code
  branches (thresholds, guards, discriminants) must be visible in the
  artifact's examples and descriptions, one grounded example per behavior
  branch, verified to survive projection through both real LoadCraft parsers;
- a fourth skill `loadcraft-overview` was added: one Markdown project
  overview whose whole content fills the project description field at setup
  (grounded in the description's real consumers: the setup gate, flow
  generation and feeder-data synthesis prompts), with a sidecar provenance
  stamp, diff-scoped impact judgment on refresh, a bundled validator, and a
  golden check through LoadCraft's `sanitize_prompt_input`.
