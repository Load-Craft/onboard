# LoadCraft AsyncAPI compatibility profile

Use this profile for artifacts meant to be imported into the current LoadCraft AsyncAPI path. General AsyncAPI validity is necessary but not sufficient: the current importer drops several malformed or off-profile constructs **silently**, so the profile below forbids exactly what would be lost.

## Required document shape

- `asyncapi` is `3.0.0`. The importer claims 2.x support, but 2.x `publish`/`subscribe` channels carry no `address` field and are silently dropped — a 2.x document imports as zero channels and zero operations. Always emit the 3.0 shape.
- `info.title` and `info.version` are explicit, non-empty strings.
- `defaultContentType` is set (normally `application/json`) or every message carries its own `contentType`.
- The import artifact is one UTF-8 JSON file.
- Every `$ref` is internal, acyclic, and at most 20 levels deep — the importer raises on external refs, cycles, and deeper chains.

## Servers

- At least one entry under `servers`.
- Every server has a non-empty `url` — the current importer reads the 2.x-style `url` field, not 3.0's `host`/`pathname`; a server without `url` is silently dropped. Provide `url`; `host`/`pathname` may be added as extras.
- Every server has an explicit `protocol` (`ws`, `wss`, `http`, `https`, `kafka`, `mqtt`, `amqp`, …). Protocol detection falls back to a channel-address heuristic only when no server declares one — never rely on it.
- Use placeholder-free synthetic hosts (e.g. `ws://app.example.com/ws`) grounded in deployment evidence; never embed credentials in URLs.

## Channels

- Every channel has an explicit, non-empty `address`. Channels without an address are silently dropped by the importer.
- Channel `messages` entries reference `#/components/messages/<name>`.
- Keep addresses stable and path-like where the transport allows; downstream module naming and version detection derive from them.

## Operations

- Operations live in the root `operations` object (3.0 shape).
- `action` is exactly `send` or `receive`, written lowercase. The importer lowercases the value before matching, but any other action is silently dropped — the profile pins the lowercase spelling for determinism.
- Describe actions from the **application under test's perspective** (standard AsyncAPI semantics). LoadCraft plays the other side: an operation the application `receive`s becomes a message the generated load client sends, and vice versa.
- `channel` is `{"$ref": "#/channels/<id>"}` and must resolve — operations with an unresolvable channel are silently dropped.
- List `messages` explicitly as `#/components/messages/` refs; an operation with no resolvable message falls back to the channel's messages. At least one resolvable message per operation.

## Messages

- Define **every** message under `components.messages` and reference it from channels and operations. Messages defined only inline in a channel do not exist for the importer's operation binding.
- `payload` is a JSON Schema object (non-object payload degrades to `{}`).
- Give every message at least one `examples` entry with a realistic synthetic payload — the **first example's payload is used verbatim as the generated message body**. Schema-synthesized fallbacks drop optional properties when a message has more than four, so mark `required` accurately.
- For messages the application sends (which the load client must validate), expose a discriminator: a `messageType` property with `const` (preferred), a single-value `enum`, or `default` — the flow generator builds its response matcher from it.
- `contentType` set truthfully per message when it differs from `defaultContentType`; binary content types switch the generated frames to binary.

## Schemas

- Single JSON Schema types only. No `oneOf`/`anyOf`, no type arrays, no boolean schemas — the payload synthesizer handles none of them and degrades to empty objects.
- Explicit `properties` and accurate `required` on object payloads.
- Synthetic examples only. Never copy credentials, tokens, customer data, or production captures. No examples, defaults, or enums on secret-bearing fields; unique or externally provisioned values are described as feeder/credential requirements in the report, not frozen into the document.

## Provenance extension

`info.x-loadcraft-source` is the one supported extension, identical to the OpenAPI skill's stamp:

- `commit`: the analyzed repository's `git rev-parse HEAD` hash;
- `dirty`: whether the working tree had uncommitted changes at analysis time;
- `method`: `native-export` or `static-trace`.

The bundled validator enforces this shape. Omit the stamp when the repository is not under git and say so in the delivery report. The importer keeps unknown extensions in its raw copy and ignores them.

## Unsupported readiness signals

Do not use `x-todo` or `x-loadcraft-blocker` to carry unresolved facts into a deliverable. Neither blocks import, and the bundled validator rejects both.

## Fail-ready conditions

Do not declare the artifact ready when any of these remain:

- a channel, operation direction, message shape, or server protocol is unknown;
- any construct on the silent-drop list above would be discarded by the importer;
- an exact union or dynamic payload shape cannot be represented without semantic loss;
- source-discovered channels or messages are missing from the document inventory comparison;
- the bundled validator reports an error.
