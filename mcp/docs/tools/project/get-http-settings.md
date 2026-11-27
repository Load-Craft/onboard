# project_get_http_settings — contract

Tool: `project_get_http_settings` (module `project`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes. The catalog names no arguments, so the tool takes none but `format`; the project is the bound one
(`projectIdOf`, else `no_project`).

## Operations

`GET /projects/{id}/gatling/project`, once. A project the backend does not know is `not_found`. The response holds secrets (the
values of the default headers, the password of a proxy): it is read through `callBackend`, which registers them.

## format=data

`project_id`, `base_url` (origin and path; null when unset), `headers` (names only, at most 30) and `header_count`, `protocol`
(`connection_timeout_ms`, `request_timeout_ms`, `max_connections_per_host`, `user_agent`, `warm_up_url` (origin and path),
`proxy` (`type`, `port`) or null, `no_proxy_count`, `silent_patterns_count`, `options_on`: the names of the options that are
switched on), `pause_distribution`, `pause_std_dev_percent`, `think_time_ms`, `poll_max_iterations`, `probes_enabled`,
`capture_request_bodies`, `capture_sample_percent`, `throttle_steps`, `global_assertions` (counts), `slo_tier`,
`scenarios_count`, `configurations_count`, `feeders_count`, `updated_at`.

**Secrets / third party:** no value of a header, no proxy host, user name or password is read into the data, the view, the log or
the state; the base URL loses credentials, query and fragment. Names, the user agent and addresses pass `content()`.

## Text view

```
HTTP settings of the project
base URL: https://api.perf.example.com
default headers (2): x-api-key, x-tenant (values are never shown)
protocol: request timeout 60000 ms, max connections per host 20, user agent "acme-load"
options on: share_connections
pauses: uniform, think time 0 ms, deviation 20%; polls up to 30 times
probes: on; request bodies captured: off (sample 100%)
throttle steps: 0, global assertions: 0, SLO tier: default
scenarios: 0, configurations: 0, feeders: 0
```

With no default headers the line reads `default headers of the project: none (headers of the environments: project_get_envs)`.

## State

None. The log carries the data's `base_url` for the result template.

## UI

Text only: the settings are a read for the model that explains a run; the mod shows no settings.

## Test cases

- Ordinary: the settings of the sample project, `format: "data"`, Polish view, log entry, one request.
- Edge: no base URL, a project the backend does not know, no bound project, a base URL with credentials and a query, an unknown
  argument refused.
- Adversary: sentinel in header values, the password and the host of a proxy and the user agent; instruction in a header name;
  a 500 quoting a header value; level 1, so it is offered.

## Out of scope

Changing the settings (`PUT`).
