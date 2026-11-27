# functional: reads — contract

Tools of module `functional` (`moduleTool`; read, level 1, no card, no undo; text view and `format: "data"`; the description, the
annotations and the log templates are the catalog's, through `meta.generated.ts`). Every tool is `readOnlyHint: true`. The texts of
the backend that a person, a model or the target wrote (names, descriptions, outcomes, bodies, assertions) pass `content()` or
`body()`; the project is the bound one (`projectIdOf`, else `no_project`). One section per tool, written with the tool.

## functional_get_test_types

Arguments (the catalog's): `test_type?` 1-120 (an id or the name the project uses, case ignored), `view?` `list` (default) or
`expected_outcomes`, `is_enabled?`.

Operations: `GET …/test-types[?is_enabled]` (the list; the name is found in it, since each item holds the whole record: one
request); `GET …/test-types/{id}` when `test_type` is a UUID; `GET …/test-types/expected-outcome-candidates` for the view. A name
that matches nothing is `not_found` listing the names, two matches are `ambiguous`; the id of another project is the backend's
`invalid`.

Data: `view`, `count`, `shown` (at most 50), `items` (id, name, displayName, category, enabled, priority, defaultCount, base,
expectedOutcome) or `testType` (the same plus description, examples, pollTimeoutMs, pollCompletion), or `outcomes` (statusField,
candidates with value, source `observed` | `spec_enum` | `other`, field). Log: result `{count} test types`.

View (EN):

```
3 test types:
  1  invalid_input            negative  enabled  negative_testing
  2  boundary_values          edge      enabled  edge_cases
  3  missing_required_fields  negative  enabled  custom
```

Tests: the list and its single request, `is_enabled` sent, one by name and by id, `not_found` / `ambiguous` / foreign id, the outcomes
view and its empty case, masked texts, a project the backend does not know, arguments outside the catalog, the Polish view, the
sentinel cases.

## functional_get_validators

Arguments (the catalog's): `validator?` 1-120 (an id or the name the project uses), `view?` `list` (default), `applicable` or
`gatling_enforcement`, `is_enabled?`.

Operations: `GET …/validators[?is_enabled]` (the name is found in the list: one request); `GET …/validators/{id}` for a UUID;
`GET …/validators/applicable`; `GET …/validators/gatling-enforcement`. `not_found` lists the names, two matches are `ambiguous`.

Data: `view`, `count`, `shown` (at most 50), `items` (id, name, displayName, category, type, enabled, priority, base) or `validator`
(the same plus description, engine, scope, needsReview, autoConfigReason, evaluatedAfterRun, parameters (names, 20), `hasAiPrompt`:
the prompt text itself is never read into the data), or `applicable` (total, applicableTotal, groups of at most 30 items with name,
type, applicable, reason, activation, requiresProfileFlags), or `enforcement` (defaultLevel, levels of at most 40 kinds).
Log: result `{count} validators`.

Tests: the list, `is_enabled`, one by name and by id, `not_found` / `ambiguous` / foreign id, both views and the empty case, masked
texts and the unread AI prompt, a project the backend does not know, arguments outside the catalog, the Polish view, sentinels.

## functional_get_flows

Arguments (the catalog's): `flow?` 1-120 (an id or a name), `view?` `list` (default) or `versions`, `docs_id?` (a UUID; default
`ids.docs_id` of the state; none: every flow the token sees), `limit?` 1-200, default 50. `versions` without `flow` is refused
locally (`invalid_arguments`, nothing sent).

Operations: `GET /test-flows?spec_id&limit` (the name is found in it: `not_found` lists the names, `ambiguous` for two); `GET
/test-flows/{id}` for the record; with `versions`, then `GET /test-flows/{id}/versions`. Flows are not scoped by project: the
documentation version is the filter.

Data: `view`, `docsId`, `count`, `shown` (at most 50), `limit`, `items` (id, name, description, version, blocksCount, active, tags,
updatedAt), or `flow` (the same plus specId, entryBlockId, timeoutMs, retryCount, retryDelayMs, `blocks` (the first 40: id, type,
label), `edges` (a count), `variables` (names only, 20)), or `versionsOf` and `versions` (id, version, createdAt, changeReason). Block
labels are texts of a third party (`content`); the data holds no request body or value of a variable. Log: `{count} functional flows`.

Tests: the list and its request, the docs filter from the argument and from the state, one by name and by id, the versions, the local
refusal, `not_found`, the empty list and the limit note, masked texts, arguments outside the catalog, the Polish view, sentinels.

## functional_get_templates

Arguments (the catalog's): `template?` 1-120 (an id or a name), `docs_id?` (default `ids.docs_id`; none: no filter), `tags?` 1-500
(comma-separated, at most 10: more is refused locally with `invalid_arguments`), `limit?` 1-200, default 50.

Operations: `GET /test-templates?spec_id&tags&limit` (the name is found in it); `GET /test-templates/{id}` for the record (after a
name, and for a UUID). `not_found` lists the names, `ambiguous` for two.

Data: `docsId`, `tags`, `count`, `shown` (at most 50), `limit`, `items` (id, name, description, specId, tags, assertionsCount, active,
updatedAt), or `template` (the same plus apiDescription, `endpoints` (a count), `blocks` (a count of the flow definition's blocks),
`assertions` (type, enabled, plain parameters as `name=value`, five at most; a nested value is not read) and `runtimeParameters` (name,
type, assertion, description, default as text, values)). All texts pass `content`. Log: `{count} templates`.

Tests: the list, docs and tag filters, one by name and by id, the nested parameter left out, `not_found` / `ambiguous`, the tag limit,
masked texts, arguments outside the catalog, the Polish view, sentinels.

## functional_get_runs

Arguments (the catalog's): `run_id?` (a UUID; the state keeps no functional run, so it has no default: with it one run is read, without
it the tool lists), `view?` `list` (default), `one` or `by_template`, `template?` (a UUID, with `by_template`), `status?`, `type?` (`adhoc`
or `template`), `limit?` 1-100, default 20, `offset?` 0-100000. `one` without `run_id` and `by_template` without `template` are refused
locally (`invalid_arguments`, nothing sent). `type` applies to the plain list only.

Operations: `GET …/executions?limit&offset[&status][&execution_type]`; `GET …/executions/{id}` with `run_id`; `GET
…/executions/run-templates/{template}/executions?limit&offset[&status]`. An unknown run is `not_found`.

Data: `view`, `count` (what the backend counts for the filters), `shown`, `limit`, `offset`, `items` (id, status, type, templateId,
templateName, createdAt, startedAt, completedAt, durationMs, flows {total, passed, failed, completed}, validations {total, passed,
failed}, environmentId) or `run` (the same plus environmentName, errorMessage, triggeredBy, `runtimeParams` (names only: the values are
not read), flowVersions (a count)). Template names, messages and parameter names pass `content`. Log: `{count} functional runs`.
The view prints each run's full UUID: the later reads (results, comparison) take it.

Tests: the list and the page sent, both filters, paging and the next offset, one run and its hidden parameter values, `by_template`,
the two local refusals, the empty list and `not_found`, masked texts, arguments outside the catalog, the Polish view, sentinels.

## functional_get_results

Arguments (the catalog's): `run_id` (a UUID, required: the state keeps no functional run), `view?` `summary` (default), `flows`, `one` or
`http_log`, `result_id?` (a UUID, with `one`: without it the call is refused locally, `invalid_arguments`, nothing sent), `log_type?`
(`request`, `response` or `log`, with `http_log`), `limit?` 1-200, default 50 (flows or log lines the data lists).

Operations: summary `GET …/executions/{id}/with-results`; flows `GET …/executions/{id}/results`; one `GET
…/executions/{id}/results/{result_id}`; http_log `GET …/executions/{id}/api-logs[?log_type]`. An unknown run or result is `not_found`.

Data: `run_id`, `view`, `passed` and `failed` (what the log entry counts: flows of the run for the summary, flows with no failed
validation and with some for `flows`, the validations of one result for `one`, the requests of the log below and from status 400 for
`http_log`), `count`, `shown`, `run` (summary only: id, status, durationMs, flows, validations, errorMessage), `flows` (id, flowId,
flowVersion, testType, status, durationMs, validations, errorMessage), `result` (the same plus startedAt, `failedValidations` (at most
20: validator, type, message, expected and actual as masked text, reasoning), `blocks` (at most 40: name, type, status, method, url,
httpStatus, durationMs, errorMessage, assertionMessage)), `log` (seq, logType, level, method, url, statusCode, durationMs, block,
message, `headerNames` (names only; header values are never read), `requestBody` and `responseBody` as `{kind: "shown", text}` masked and
cut to 400 characters, or `{kind: "hidden", type, bytes}` when the mask cannot read the format). Final responses, generated input and
variables of a flow are not read. Everything the target or a person wrote passes `content()` or `body()`.

Tests: the four views and their requests, the local refusal, `log_type`, the cut of the log and the empty log, a body hidden whole, hidden
header values, `not_found`, masked texts, arguments outside the catalog, the Polish view, sentinels.

## functional_compare_runs

Arguments (the catalog's): `run_id` and `other`, both UUIDs and required (the state keeps no functional run). The same run twice is
refused locally (`invalid_arguments`, nothing sent). `run_id` is the backend's `a`, `other` its `b`.

Operation: `GET …/executions/compare?a=<run_id>&b=<other>` (one request). A run the project lacks is `not_found`.

Data: `run_id`, `other`, `changed` (blocks whose verdict is not `same`), `same`, `sameFlowVersions`, `environments` {run, other},
`warnings` (five at most), `count`, `shown`, `blocks` (the differing ones first, then the same ones, at most 100): id, name, `verdict`
(`same`, `status_changed`, `shape_changed`, `timing_only`, `only_in_a`, `only_in_b`, else `other`), `status`, `httpStatus` and `durationMs`
as {run, other}, and the shape differences `appeared`, `disappeared`, `typeChanged` (at most 10 each: path, type, `to`). Block names, field
paths and warnings pass `content`. Log: args `{run_id} vs {other}`, result `{changed} blocks differ`. The view prints the blocks that differ
only; a note says when the flow versions or the environments differ.

Tests: the view, the differing-first order, the identical case, the local refusal and `not_found`, masked texts, an unknown verdict,
arguments outside the catalog, the Polish view, the sentinel case.

## functional_get_analytics

Arguments (the catalog's): `view?` `dashboard` (default), `flaky`, `failure_patterns`, `accuracy`, `trend` or `threshold_suggestion`;
`days?` 1-365, default 30; `validator?` 1-120 (an id or a name, case ignored); `threshold_pct?` 0-100, default 20 (percent; sent to the
backend as a fraction, with `flaky` only). `accuracy`, `trend` and `threshold_suggestion` without `validator` are refused locally
(`invalid_arguments`, nothing sent).

Operations: `GET …/analytics/validators/{dashboard|flaky|failure-patterns}?days[&threshold]`; per validator `GET
…/analytics/validators/validators/{id}/{accuracy|trend|threshold-suggestion}?days`. A validator by name is found first in `GET
…/validators` (`not_found` lists the names, `ambiguous` for two); an id is used as it is. A validator with nothing measured is answered
with nothing: the view says so.

Data: `view`, `days`, `validatorId`, `count`, and by view `summary` (validators, executions, passRate (null: nothing measured),
flaky, ai, avgAiConfidence, coverage {measured, source, excludes}), `flaky` (validatorId, name, score, passRateVariance, sampleSize,
recommendation, evidence), `patterns` (type, value, failures, failureRate, correlation, samples), `accuracy` (counts, passRate,
retryRate, avgConfidence, avgDurationMs, failureReasons, suggestedActions), `trend` (name, direction, the last 60 points of `pointCount`)
and `threshold` (current, suggested, rationale, impact). Rates are the fractions of one the backend gives; only the view shows percent.
The dashboard carries at most five flaky validators and patterns, a list view at most 20 entries. Names, messages, evidence and
rationale pass `content`. Log: args `{view} {days} days`, result `{view}`.

Tests: every view and its request, the threshold sent as a fraction, the local refusal, a validator by name and by id, the empty
accuracy, the cut of the trend, masked texts, arguments outside the catalog, the Polish view, sentinels.

## functional_get_catalog

The global catalog of base test types, base validators and assertion types (no project). Written in a reduced scope: the routes of
categories, the seed status and the AI validators are in the catalog's operations but are not read.

Arguments (the catalog's): `kind` (`test_types`, `validators` or `assertion_types`, required), `entry_id?` (1-120: an id; for assertion
types also a name), `category?` (1-80), `is_active?` (test types and validators; with assertion types the call is refused locally,
`invalid_arguments`, nothing sent), `limit?` 1-200, default 50.

Operations: list `GET /base-test-types|/base-validators?category&is_active&limit`, `GET /assertion-types?category` (cut to `limit` by the
tool); one `GET /base-test-types/{id}`, `/base-validators/{id}`, `/assertion-types/{id}`, or `/assertion-types/by-name/{name}` for an
assertion type given by a name. An unknown entry is `not_found`. An empty catalog of assertion types (no category given) is said to be a state of the server: its builtin types are added by a separate seed, and the names a person expects there (`status_code`, `json_schema`) are validators.

Data: `kind`, `view` (`list` or `one`), `count`, `shown` (at most 100), `limit`, `categories` (the backend's, at most 30), `items` (id, name,
displayName, category, active, builtin, type (validators)) or `entry` (the same plus description, parameter names (20) and their count,
`hasPromptTemplate`: a prompt template is never read). Texts pass `content`. Log: args `{kind} {view}`, result `{count} entries`.

Tests: the three lists and their requests, the filters, one entry by id and by name, the unread prompt, the local refusal and
`not_found`, the empty list, masked texts, arguments outside the catalog, the Polish view, sentinels.
