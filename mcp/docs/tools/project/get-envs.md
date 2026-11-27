# project_get_envs — contract

Tool: `project_get_envs` (module `project`; level 1, class read+secret, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry together with this tool).

## Arguments (exactly the catalog's)

- `env?`: an environment id (UUID) or the word `default`; no default source. Without it the tool lists the environments. The
  environment of the state (`ids.env_id`) is used only to mark the current environment in the list.
- `effective?`: boolean, default false. Only with `env`: without it the call is refused locally as `invalid_arguments` (dictionary text, EN/PL), no request is sent.
  With it the values inherited from the parent environment are resolved.

The project is the bound one (`projectIdOf`, else `no_project`). An unknown argument is refused (strict schema).

## Operations

| call                | requests, in order                                                                   |
| ------------------- | ------------------------------------------------------------------------------------ |
| no `env`            | `GET /projects/{id}/environments`                                                    |
| `env`               | `GET /projects/{id}/environments/{env}`, or `…/environments/default` for `default`   |
| `env` + `effective` | `…/environments/{env}/effective`; for `default` the default is read first for its id |

No auxiliary reads. A 404 is `not_found`. Every read goes through `callBackend`, which registers the secret fields of the contract.

## format=data

`mode` (`list` | `one` | `effective`), `project_id`, `count` (environments the project has, or 1), `shown`, `environments[]` (at most 50).
Per environment: `id`, `name`, `base_url` (userinfo, query and fragment removed), `frontend_url`, `proxy` (whether one is set),
`is_default`, `is_active`, `protected`, `caps` (`max_vu`, `max_rps`) — `null` where the answer does not say (the effective view
carries no flags; `is_default` is true there when the environment was read as `default`) —, `current` (it is `ids.env_id`), `parent_environment_id`, `auth` (`type`, key names only), `headers` and
`variables` (names only, at most 30 each, with `header_count`, `variable_count`), and for `effective` the names `inherited` (fields
taken from the parent) and `inherited` on each header or variable.

**Secrets / third party:** the values of headers, variables and authentication are never read into the data, the view, the log or
the state: only names and presence. Every name, URL and type comes from the project's configuration and passes `content()`.

## Text view

```
2 environments:
1. perf (default, current) https://api.perf.example.com
   frontend: https://perf.example.com
   headers: x-api-key, x-tenant
   variables: api_secret
   auth: bearer (token)
2. qa (protected: 100 users, 20 req/s) https://api.qa.example.com
Values of headers, variables and authentication are never shown, only their names.
```

An empty project says so in one line. A single environment is the same lines under `Environment qa:`; with `effective` the
header says inherited values are resolved and a line `inherited: auth, base_url` follows. A single environment without
authentication says `auth: none` (the list leaves the line out).

## State

Writes `ids.env_id` only when the read shows the default environment (the list, `default`, or an id whose `is_default` is true);
never from the effective view. The log carries `env` (the argument as given, empty for the list) and `count`. Nothing else.

Every view shows the authentication type (`auth: bearer (token)`), the effective one too: the effective answer holds it under a
field named `auth`, whose credentials the secret registration of a call masks, but a field naming a kind (`auth_type`) is not a
secret, so its word stays readable. Only a type the mask hides anyway reads `auth: configured (keys)`.

## UI

Text only: the environments are listed in the project card the mod already draws and the answer is a read the model uses to pick
`env` for later tools; a new panel would show the same names.

## Test cases

- Ordinary: list (view, one request), `default`, one by id, effective by id, effective of `default` (two requests), `format: "data"`,
  Polish view, log entry (`env`, `{count} environments`), `ids.env_id` written for the default and left alone otherwise.
- Edge: no environments; 404 for an id and for a project; `effective` without `env` refused with no request; `env` that is neither
  a UUID nor `default` refused; 60 environments (shown 50 of 60); a name with control sequences and line breaks; a base URL with
  credentials and a query.
- Adversary: sentinel in every secret field (header values, variables, authentication) of all four answers, and in the text of a 401/500
  answer; an instruction in an environment name; argument outside the catalog refused; level 1, so it is offered.

## Out of scope

Writes (`project_save_env`), the connection test and the conformance check.
