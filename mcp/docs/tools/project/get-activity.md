# project_get_activity — contract

Tool: `project_get_activity` (module `project`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and `format: "data"`;
the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`). It reads across the caller's
projects: the backend shows a token only the projects it may see (a token pinned to a project sees that one).

## Arguments (exactly the catalog's)

- `limit?`: 1-50, default 20: how many recent events. The runs in progress are read without a limit (at most 20 are listed).

No project is needed. An unknown argument is refused.

## Operations

`GET /activity?limit` and `GET /gatling/executions/active`, in parallel. A refusal of either (an expired token, a role) is the error of
the call.

## format=data

`events` (how many the feed returned: the log slot `{events}`), `running` (the log slot `{running}`), `limit`, `items[]` (id, `type`
(`project_created`, `scenario_created` (a flow), `execution_started`, `execution_completed`, `execution_failed`, else `other`), `at`,
`project`, `projectId`, `entity`, `entityId`, `run` (the handle of a load run), `status` (known run statuses only), `exitCode`, `sla`
(`passed` | `failed` | `refused`, from the verdict's `status` only), `hasErrors`) and `runs[]` (`run`, `run_id`, `project`, `scenario`,
`status`, `progress` 0-100, `startedAt`, `estimatedCompletionAt`, `rps`, `errorRate`, `supervised`). **Third party:** project, flow and
scenario names pass `content()`; the texts of a verdict and the metadata are not read.

## View

```
2 runs in progress:
  e-3f9a12c4  sklep  checkout  running 42%  120.5 req/s  KO 0.8%
  e-8c2d4f17  sklep  konto     running 0%
  e-8c2d4f17 is not driven by the server any more (abandoned).
3 recent events:
  2026-11-27 10:40  run completed    e-3f9a12c4 checkout  sklep  completed · SLA NOT met
  2026-11-27 09:00  flow created     Checkout flow        sklep
```

## Tests

Both lists and their two requests, `limit`, the empty case, masked names and an unknown event type, a refusal, arguments outside the
catalog, the Polish view, the log entry, the sentinel case, the coverage of both operations.
