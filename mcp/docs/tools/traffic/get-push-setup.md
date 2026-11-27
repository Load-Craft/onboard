# traffic_get_push_setup — contract

Tool: `traffic_get_push_setup` (module `traffic`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes.

## Arguments (exactly the catalog's)

None but `format`. The project is the bound one (`projectIdOf`, else `no_project`). An unknown argument is refused.

## Operations

| read          | request                                        |
| ------------- | ---------------------------------------------- |
| recipe        | `GET /projects/{id}/production-traffic/recipe` |
| tokens (aux.) | `GET /projects/{id}/production-traffic/tokens` |

Both at once (`settleAll`). The recipe is the answer: its error ends the call (404 `not_found`). The token list is auxiliary: an
API error there leaves the recipe and marks `tokens_state: "unavailable"`.

## format=data

`project_id`, `address` (the public address the sender pushes to, without userinfo, query and fragment; null when unset),
`warning` (null or one line), `command` (the push command, one line, at most 400 characters; empty when the address is unset),
`scripts[]` (at most 10: `name`, `purpose`, `command`, `lines` — the number of lines of the script, never its text),
`excluded_windows` (`count`, `items[]` at most 10: `start`, `end`, `reason`), `runs_without_window` (`count`, `items[]` at most
10: `run` — the handle `e-xxxxxxxx` —, `start`, `target`), `runs_without_window_note`, `tokens` (how many push tokens the project
has, revoked included; 0 when the list is unavailable), `active_tokens`, `token_list[]` (at most 20: `id`, `label`, `prefix`,
`created_at`, `last_used_at`, `revoked_at` (null while in use), `last_outcome`, `last_refusal_codes` at most 5), `tokens_state` (`read` |
`unavailable`), `limits` (`packets_per_token_per_hour`, `max_window_days`, `max_rows`, `max_routes`, `max_packet_bytes`).

`tokens` is a number because the log template's slot `{tokens}` is filled from the data (a field of the data wins over the log
values); the list is `token_list`.

**Secrets / third party:** the token list never holds a secret (only the prefix that tells a token apart); the recipe's texts (the
command, the scripts' purposes and commands, reasons, notes, labels, targets) are the backend's and the project's own words but
may quote an address with credentials or a token a person pasted: every one passes `content()` (mask by shape, secrets
registered, one line). The shell variable the backend writes after `Bearer` (`$LOADCRAFT_INGEST_TOKEN`) is a reference and stays; a real token
there, and a token prefix that looks like a piece of a token, are masked by shape. The text of a script is not read into the data at all (only its number of lines); the sender saves the
script from the LoadCraft page.

## Text view

```
Push setup of production traffic
address: https://lc.example.test
command: curl -X POST https://lc.example.test/api/v1/production-traffic/push -H "Authorization: Bearer $LOADCRAFT_INGEST_TOKEN" …
scripts (2):
  push-from-logs.sh — Counts requests per route from access logs and writes a packet.
  push-from-prometheus.sh — Reads request rates from Prometheus and pushes a packet. Run: sh push-from-prometheus.sh …
excluded run windows (1): 2026-11-20 10:00–10:30 UTC LoadCraft run e-1a2b3c4d
push tokens (2, 1 active):
  nightly-sender (lcp_ab12…), created 2026-11-21, last used 2026-11-26 03:00 UTC: accepted
  old ([redacted]…), created 2026-11-01, revoked 2026-11-10
limits: 60 packets per token per hour, a window up to 31 days, up to 250,000 rows and 500 routes, a packet up to 20 MB
```

No token: `push tokens: none (a token is created in the LoadCraft application, not by this plugin)`. The address unset: one sentence
of the plugin's own, in the user's language, instead of the server's English warning (which stays in the data): the address is
set by `LOADCRAFT_PUBLIC_BASE_URL` in the `.env` of the LoadCraft server, not of the application under test; the scripts carry a
placeholder address until then. No address and command lines. The token list unavailable: `push tokens: unavailable`.

## State

Reads `ids.project_id`; writes nothing but the log entry (`{tokens} push tokens`).

## UI

Text only: a setup a person reads once while wiring the sender; the LoadCraft page holds the scripts to save.

## Test cases

- Ordinary: full recipe with two tokens (one revoked), `format: "data"`, the Polish view, the log entry, two requests.
- Edge: no token, the address unset (warning, empty command), runs without a window with their note, the token list failing with
  500 (recipe still shown), 404 of the project, 15 excluded windows (10 shown).
- Adversary: sentinel in the command, a script's purpose and command, a reason, a label and a target; a script text with a secret
  never read; an instruction with line breaks in a purpose; an unknown argument refused; level 1, so it is offered.
