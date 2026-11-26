# Contracts

## `loadcraft-asyncapi.json` — the WebSocket API of the backend

AsyncAPI 3.0 description of all 17 channels, written from the backend code (provenance in
`info.x-loadcraft-source`; the official `@asyncapi/parser` accepts it, `mcp/test/asyncapi.parser.test.ts`). Operations
are from the backend's side: `send` is server to client; an operation points at the messages of its channel (`#/channels/<id>/messages/<name>`).

- **Channel.** `address` (with `/ws`, path parameters in braces), `operations` with `security`
  (`bearerToken`, `sessionCookie`; none when the connection presents nothing), `x-close-codes`.
- **Channel metadata.** Every channel has five extensions, read by the generator into `CHANNELS` and
  checked by `mcp/test/ws.meta.test.ts`: `x-terminal-frames` (wire types of the server frames that end a
  run; a twin pair lists the prefixed frame first), `x-replay` (`mode` `none`, `state` or `events`: what the
  socket sends right after the handshake; `once: true` when one connect gets it), `x-close-codes`,
  `x-requires-origin` (the handshake needs an `Origin` header of the `Host` header's host) and
  `x-started-by` (the REST operations that start the run: `operationId`, the channel path `parameter`
  they fill, the `field` that returns it and whether it is in the `response` or the `request`).
- **Message.** One per wire type under `components.messages`. The payload is the whole frame, envelope
  included: `{type, payload: {...}}`, or keys beside `type` (flat). `type` is a `const`. `summary` says
  when the frame is sent. A key that may be `null` has `type: [T, "null"]`. A key under `required` is always present. Ping and pong are `text/plain`, the live image
  frame is `application/octet-stream`.
- **Profile.** The document follows the plugin's contract profile: standard JSON Schema, a nullable key
  typed `[T, "null"]` (with `null` among its `enum` values), checked with the official AsyncAPI parser.
  It is not the profile of the `loadcraft-asyncapi` skill: that one governs documents of applications
  under test for the LoadCraft importer, which take one type per schema and no type lists.
- **Refresh.** Describe changed channels from the backend code, then
  `npm run sync:api -- --asyncapi-from-file <file>` from `mcp/` regenerates `src/ws/generated/channels.ts`
  and reports the changes. It writes the snapshot in the contract profile: an `x-nullable: true` in the
  source becomes `type: [T, "null"]`. Commit both files, `ws-frames.json` and `dist` with it.
- **Check.** `mcp/test/ws.asyncapi.test.ts` fails when `ws-frames.json` lists a channel, frame or key the
  document lacks, with another type, or demands more than the document promises.

## `ws-frames.json` — what the plugin reads and sends on six channels

This file is the plugin's surface of the document above: for each of the six channels it uses it lists
the path, the envelope, what a connection must present, the server frames the plugin reads and the
messages it sends, with the keys it depends on. It stays a separate file because the plugin reads
a subset and keeps notes the backend document has no place for (`source`, `requires`); it does not
repeat what the document says, a test compares them. Client frames are flat on the wire.

| Channel    | Path                                                         | Envelope | Connection presents   |
| ---------- | ------------------------------------------------------------ | -------- | --------------------- |
| `refine`   | `/ws/flow-suggestions-refine/{job_id}`                       | payload  | nothing               |
| `batch`    | `/ws/batch-generation/{run_id}`                              | payload  | nothing               |
| `scenario` | `/ws/gatling-scenario/{run_id}`                              | payload  | nothing               |
| `analysis` | `/ws/gatling-analysis/{run_id}`                              | payload  | nothing               |
| `har`      | `/ws/projects/{pid}/har/{sid}`                               | payload  | identity              |
| `describe` | `/ws/projects/{pid}/scenario-from-description/runs/{run_id}` | flat     | identity and `Origin` |

- **Envelope.** `payload`: `{"type": "<channel>:<event>", "payload": {...}}`. `flat`:
  `{"type": "<event>", ...keys}` with no wrapper. A frame may override its channel's
  envelope with `"envelope"` (the `split_proposal` frame of `har` is flat).
- **Identity** is sent in the `Authorization: Bearer` header, never in the address.
  **Origin** is an `Origin` header whose host and port equal those of the `Host` header.
- **Keys.** Only keys the plugin reads are listed. Other keys may be present and are
  ignored. `required: false` means the key may be absent; `nullable: true` means `null`
  is accepted. `items` describes the elements of an array or the keys of a nested object.
- **Unknown frames.** A frame type that is not listed is not an error: the backend may add
  frames, and the plugin skips them.
- **Source.** Every frame has a `source`: backend `file:line` at the commit in `backend_ref`.
  Line numbers are a pointer, confirm them in the current code.

`mcp/src/ws/frames.ts` holds the matching Zod schemas, written by hand from this file, and
`parseFrame(channel, raw)`. `mcp/test/ws.frames.test.ts` fails when the two lists drift apart, and
`readsTable()` makes `tsc` fail when a schema reads a key the generated types lack.
A new frame or key needs an entry in the AsyncAPI document first, then here, then a schema.

## `loadcraft-openapi.json` — snapshot of the backend OpenAPI document

The request and response types of the LoadCraft API come from this file, not from memory.

- **Source.** An export of the OpenAPI document of the LoadCraft backend, taken in with
  `npm run sync:api`, written as JSON with `indent=2`, `sort_keys=True` and
  `ensure_ascii=False` and a final newline.
- **Refresh.** From `mcp/` run `npm run sync:api -- --from-file <export>` (or another source of
  `sync:api`): it writes the snapshot, regenerates the clients and the secret paths and reports
  what to fix. Commit the snapshot and the generated files together.
- **Rule.** A task that starts using an endpoint missing from the snapshot refreshes the
  snapshot, and its commit includes the regenerated types.

`mcp/src/http/generated/api.d.ts` is generated from the snapshot by `mcp/scripts/gen-api.mjs`
(`openapi-typescript`), `mcp/src/ws/generated/channels.ts` from the AsyncAPI document by
`mcp/scripts/gen-clients/`. Do not edit them. `npm run gen:api` and `npm run gen:ws` write one client each
(`gen:clients` both, independently: a failure of one is reported by name and does not stop the other); `check:api` and `check:ws` (`check:clients` both) generate in memory and exit with code 1
naming the stale client; CI runs `check:api` and `check:ws` as separate steps.

## `secret-fields.json` — secret fields the snapshot does not mark yet

`mcp/src/http/generated/secrets.ts` (`SECRET_PATHS`) lists, per operation, the paths of the fields that
hold a secret; `callOperation` registers what they hold with the secret scope of the tool call, so no
result, log entry, detail or state file shows it. `mcp/scripts/gen-operations.mjs` (`npm run gen:api`)
writes it from two sources:

- **The snapshot.** A schema (or a parameter) with `writeOnly: true`, `format: password` or
  `x-secret: true` is a secret field; nothing under it is read. `x-secret: "by-name"` marks a map, or
  a list of `{name, value}`, whose values are secret only under a name that names a secret: it becomes
  `<field>.*secret` for a map and `<field>[secret].value` for a list (the name is not a secret). The
  mark may sit beside `anyOf`/`oneOf` or a `$ref`; a `null` beside the map or the list is allowed.
  Which names name a secret is the plugin's rule, `isSecretField` in
  `mcp/src/security/secretFields.ts`, not the backend's; the backend says only that the rule applies.
  `"by-name"` on any other shape, and any value of `x-secret` other than `true` and `"by-name"`, stop
  the generator.
- **This file.** `fields` adds the paths of an operation the snapshot does not mark yet, with the
  reason; `without_fields` names the operations of tools that handle secrets with no field to mark
  (the secret sits inside a text, under a name chosen at run time, or not at all), with the reason.
  An entry may also name `shape` and `public` (below). No other key is accepted.
- **Paths.** `.` a property, `[]` every item of a list, `*` every value of a map; `[secret]` an item
  whose `name` names a secret and `*secret` a value under a key that names one
  (`items[].default_headers.*secret`: `Authorization` is masked, `Accept` is not). Request paths start
  at `body`, `query`, `header` or `path`, answer paths at the body of the 2xx answer.
- **Shape.** A path may end at any value of a list or map the snapshot leaves without a shape
  (`auth_config.*secret`). A path that goes on through such a part names the schema of the snapshot
  that describes it, `"shape": {"protocol_config": "ProtocolConfig"}`, so a misspelt field is refused;
  where the snapshot has no such schema, `{"undescribed": "<reason>"}` says so.
- **Public.** `"public": {"prefix": "<reason>"}` names a field of the answer that looks like part of a
  secret by design (the public prefix of a token) and is shown.
- **Check.** The generator refuses an unknown key, an entry for an unknown operation, a path the
  snapshot does not have, a shape no path goes through, a field a mark of the snapshot already covers
  and an entry without a reason. A mark covers its own field and every field under it; `*` covers
  `*secret` and `[]` covers `[secret]`, so a map marked `x-secret: true` refuses an exception
  `<map>.*secret`. Remove the entry once the backend marks the field; `sync:api` fails until then. An
  exception wider than the mark (`<map>.*` beside a `"by-name"` map) is kept. `mcp/test/secret.contract.test.ts`
  requires every operation of a catalog tool with `secret: true` to have fields or a reason, and puts
  a sentinel in every field of the table.
