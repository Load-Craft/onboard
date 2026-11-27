# project_set_http_settings — contract

Tool: `project_set_http_settings` (module `project`, `moduleTool` on a consent card; write, level 2, escalates to level 3 for an env file
(`secret_ref`); text view and `format: "data"`; the description, the annotations, the card and log templates are the catalog's, through
`meta.generated.ts`). Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments (at least one)

- `base_url?`: string 1-2000. An http or https address without a user name or password (rule `http_settings_base_url`).
- `protocol?`: a strict object, all keys optional: the booleans `async_name_resolution`, `disable_auto_referer`, `disable_caching`,
  `disable_warm_up`, `http2_enabled`, `http2_prior_knowledge`, `infer_html_resources`, `per_user_name_resolution`, `share_connections`,
  `silent_resources`; `connection_timeout_ms`, `request_timeout_ms` (1 to 3 600 000), `max_connections_per_host` (1 to 100 000) and
  `user_agent_header` (up to 300), each also `null` (unset). Any other key is refused. Not taken: the proxy options. A proxy change needs its
  credentials (the backend refuses a masked password after one), and those do not pass through a model; the user sets a proxy in the app.
- `headers_env_file?`: string 1-260, an env file (`.env`, `.env.*`, `*.env`) of the project directory. Every `NAME=value` line is a default
  header: the names are letters, digits and hyphens, not `host`, `content-length`, `transfer-encoding`, `connection`, `authorization`; a value
  has no control character and is at most 8192 characters; one to 20 headers. They replace the headers now set. A file with no header, with
  more than 20, or a bad name or value is `invalid_arguments` (the rule says which; it never names the header).
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only): `GET …/gatling/project` (the settings now; 404 means the project has none yet), and the env file
(read by the tool, every value registered as a secret). After the person's yes: the file is read again and its sha256 compared with the card
(`project_file_changed`), then `PUT …/gatling/project` with only what changed (the protocol is sent whole: the current options with the
changed ones; the backend masks the values of the default headers and accepts the mask back as "keep"), or `POST …/gatling/setup` when the
project has no settings yet (the defaults of its schema plus the given values).

## The card

Nothing to change (all values as given, no file): no card, no question. Else facts (hashed): `created`, `base_url` (from, to; masked, query
and credentials left out), `protocol` (key, from, to), `headers` (path, size, sha256, up to 20 names, count, how many are set now). Lines:
the creation, each change from -> to, the file by names and hash (never a value), what it replaces, what stays. No cost line (the catalog
names none); the undo line names the way back. A file raises the card to level 3, asked on its own.

## format=data (the result)

`created`, `changed` (`base_url`, `protocol`, `headers`), `base_url` (now), `protocol` (the options changed, with the value now),
`headers` (`names`, `count`, or null), `undo` (`values`, `withheld`, `none`).

## Log and undo

args `Set the HTTP settings of generated tests`, result `HTTP settings saved`; the entry of call 1 is `queued`, the one that ran carries
`consent.via: client_dialog`. Undo: this tool with the previous base URL (when there was one) and the previous options. Not kept: the
default headers (their values are masked by the backend), a project that had no settings, and a previous value that would carry a secret
(`withheld`).

## State

Reads `ids.project_id`. Writes nothing.

## Test cases

`test/tools/project/setHttpSettings.test.ts`: the card (changes, file at level 3, nothing to change, a project with no settings, Polish), the
yes (one PUT, the settings in the fake compared, the entry with the dialog and the undo, the undo run for real; headers reach the backend and
no text; the setup), a file changed after the card, no/declined/cancelled, other arguments, no confirming argument, a client without
elicitation, every rule, arguments outside the catalog, a file that is not an env file, secrets. Sentinel cases in
`test/tools/project/canary.ts`.
