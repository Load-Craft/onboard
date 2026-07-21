# Maintenance mode — verify & refresh existing documentation

Runs whenever `docs-workspace/state.json` exists. Goal: confirm the documentation
still matches the code, fix everything that drifted, and report what changed.
Same core principle as always: never guess, only trace.

## Step 1 — Rebuild the ground truth

Re-run the Phase 1 inventory from scratch against the CURRENT code into
`docs-workspace/endpoints.current.json`. Do not trust the previous inventory —
routes move, get renamed, get mounted differently.

## Step 2 — Detect drift (three independent detectors; run all)

**D1 — Route diff.** Compare the fresh inventory with the paths in the spec:
- endpoints in code but not in spec → **NEW** (document via Phase 2 protocol)
- endpoints in spec but not in code → **REMOVED** (delete from spec; note in report)
- same path, different handler file/symbol or middleware → **MOVED** (re-analyze)

**D2 — Change-based detection (preferred, needs git).** Read `last_commit` from
`state.json` and run:
```bash
git diff --name-only <last_commit>..HEAD
```
Map changed files to endpoints: an endpoint is **SUSPECT** if its `handler_file`
changed, or any file it was traced through changed (serializers, DTOs, models,
validators, shared middleware, error handlers). When trace paths weren't recorded,
be conservative: a changed model/serializer file marks every endpoint of that
resource tag as suspect. Changes to global middleware/envelope/error handler mark
ALL endpoints suspect (but usually only the shared components need re-tracing —
verify once, apply everywhere).

**D3 — Sample audit (always, catches what D2 misses).** Randomly sample
max(5, 10%) of endpoints NOT flagged by D1/D2 and re-trace them fully against code
(schemas, status codes, `x-perf`). Any mismatch → fix it AND treat it as a signal:
report that undetected drift exists and recommend widening the re-check (e.g. all
endpoints sharing that resource/serializer).

If there is no git history, skip D2 and raise D3's sample to max(10, 25%).

## Step 3 — Apply corrections

For every NEW / MOVED / SUSPECT / failed-sample endpoint, run the full per-endpoint
protocol from `references/endpoint-analysis.md` — one endpoint at a time / one
subagent each, exactly like a first run. Overwrite that endpoint's fragment
(or annotations for Strategy A/B). Update, don't append: stale content is removed,
not commented out. REMOVED endpoints: delete the path from the spec and drop
now-orphaned schemas from `components` (check `$ref` usage before deleting).

Also re-check the previous run's `x-todo` list: code may have changed in a way that
makes previously unverifiable facts now traceable — resolve what you can.

## Step 4 — Re-validate the whole spec

Even if only two endpoints changed, Phase 4 runs on everything: lint, full
acceptance criteria (`references/acceptance-criteria.md`) including the AI
round-trip test on a fresh sample, `x-todo` report.

## Step 5 — Drift report & state update

Write `docs-workspace/drift-report.md` and show it to the user:

```markdown
# Drift report — <date> (vs <last_commit_short>, <n> commits behind)
## New endpoints documented (3): POST /api/v1/refunds, ...
## Removed from spec (1): GET /api/v1/legacy-export
## Corrected (5):
- getUserById: response gained field `mfa_enabled` (bool); example updated
- createOrder: now returns 409 on duplicate idempotency key — added
## Sample audit: 6 checked, 1 mismatch found (widened re-check to Orders tag)
## Resolved x-todos: 2 | Remaining: 1
## Acceptance: PASS (report: acceptance-report.md)
```

Finish by updating `state.json` with the new commit hash and counts.

## Cheap continuous protection (recommend once)

Suggest a CI step so drift is caught between skill runs, not only during them:
- Strategy A/B: regenerate the spec in CI and diff against the committed one —
  fail on difference.
- Strategy C: run the route-inventory script in CI and fail when a route exists
  that the spec doesn't mention (or vice versa), plus `redocly lint`.
