# LoadCraft OpenAPI compatibility profile

Use this profile for artifacts meant to be imported into the current LoadCraft OpenAPI path. General OpenAPI validity is necessary but not sufficient.

## Required document shape

- `openapi` is exactly `3.0.3`.
- `info.title` and `info.version` are explicit, non-empty strings.
- `servers[0].url` is explicit.
- `paths` is non-empty.
- The import artifact is one UTF-8 JSON file.
- Every `$ref` is an internal JSON Pointer that resolves within the file.

The current importer can parse a broader set superficially, but OpenAPI 3.1-only constructs can be lost or rejected by its typed internal model. Use the narrower profile and fail instead of silently changing semantics.

## Operations

Supported methods are `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`. Do not emit `TRACE`; it is not consumed.

Every operation must have:

- a stable, unique `operationId`;
- a non-empty `summary` or `description`;
- an explicit operation-level `security` array;
- explicit three-digit response codes;
- at least one explicit success response in the `200`–`299` range.

Root-level security is not inherited by the current parsed endpoint model. Copy the verified effective requirement onto each protected operation. Set `security: []` only when the operation is actually public.

Do not use `default`, `2XX`, or other response ranges. The current parser projects non-numeric response keys incorrectly.

## Parameters

- Path parameters must exist for every `{variable}` and set `required: true`.
- Use `schema.type` as one string, never a 3.1 type array.
- Parameter enum values must be strings in this compatibility profile.
- Keep parameter schema details explicit: type, format, constraints, default, and a synthetic example when source evidence supports them.
- **Every parameter must be callable**: give it an `example`, an `enum`, or a `default`, and put it on the parameter's `schema` — that is the level this profile standardises on, though a parameter-level `example` is accepted too, since OpenAPI 3.0 permits both and both are retained. A parameter with none of the three tells a generated caller nothing about what to send, and the bundled validator warns about it.
- Three kinds of parameter are exempt from that rule, and the validator does not warn about them: an **OPTIONS preflight**, because the edge answers it without reading any value; a parameter whose **name trips the secret heuristic**, where a literal is forbidden anyway; and a **header carrying a declared security scheme**, which the harness supplies rather than the artifact. Any other value that must be unique or externally provisioned still needs a decision: either describe the requirement in the parameter `description` and give a shape-only synthetic example, or leave it out and name the feeder requirement in the delivery report.
- Inline a parameter's enum on the parameter's own `schema`. A `$ref` to a leaf enum schema is not retained here either (see *Enums and referenced schemas*).
- A parameter's plural `examples` map is dropped on import exactly like a response's, and the validator warns about it.
- Do not rely on parameter `content`, plural `examples`, `style`, or `explode` for behavior that LoadCraft must understand; these fields are not retained in the canonical internal parameter model.
- When a parameter value selects a behavior branch (a path id that 404s, a query flag that changes the work done), state the trigger→behavior mapping in the parameter `description` and put the triggering value in the single `example`. Both are retained per parameter; the plural `examples` map is not, so a parameter with several material branches spends its one `example` on the most load-relevant branch and names the rest in the description.

## Enums and referenced schemas

`$ref` is safe for **object** schemas and lossy for **leaf** schemas. The current canonical property model does not follow a reference when it projects a property, an array item, or a parameter schema, so an enum parked in `components.schemas` and referenced from one of those positions disappears on import: the consumer sees an untyped string, and neither flow generation nor feeder synthesis ever learns the allowed values.

- **Inline every enum at every use site.** Repeat the values and the description rather than referencing a shared enum component. The bundled validator rejects a `$ref` in a property, array-item, `additionalProperties`, `allOf`-member or parameter position when the reference resolves — through any chain of hops — to a schema that carries an `enum` and is not an object schema. It also rejects a reference to an array schema whose `items` carry the enum, because the wrapper hides it one level down.
- The schema of a whole request or response **body** may still be a `$ref`, including to an enum: that position is projected as the body schema and its reference is followed.
- Put any other leaf constraint that matters — `pattern`, `minLength`, numeric bounds — on the property rather than behind a reference, for the same reason. This one is guidance, not a gate: the validator checks enums only, because a shared value object cannot be told apart from a leaf constraint automatically.
- Keep `$ref` for reusable **objects** (a response envelope, a list item, an error body). Those project correctly and keep the file readable.
- A shared enum that is genuinely identical in several places is still inlined in each. Duplication is the cost of the profile; a silently empty enum is worse.

## Per-operation observable subsets

A domain vocabulary and an operation's *observable* vocabulary are not the same thing, and the artifact must publish the observable one. A status value that some component writes but this operation cannot return — because a query filters it, a projection omits the field, or a serializer drops it — must not appear in that operation's schema. Publishing the union teaches a load test to wait for a value the endpoint structurally cannot emit, which shows up as a hung journey rather than as a clear failure.

So when two operations expose the same domain field with different reachable value sets, give each operation its own inlined enum and say in the property description which values that endpoint can emit and why the others are missing. Name the field's full domain vocabulary in the operation `description` or in `info.description`, where nothing is filtered, so a reader can still see the whole picture.

## Request bodies

- Do not emit request bodies for `GET`, `DELETE`, or `HEAD`.
- For an operation with a body, declare exactly one truthful media type. The current importer consumes the first media type.
- Set `requestBody.required` explicitly from handler evidence.
- Always declare the request schema.
- Prefer an object schema with explicit `properties` and `required` for mutable JSON operations.
- Put safe synthetic examples on properties only when a required value cannot be derived from its type or constraints alone. Never put an example/default/enum on a password, token, secret, authorization, or API-key field. Do not freeze unique or externally provisioned values such as registration identities; describe the data requirement and report the required feeder or credential source instead.

Never add a body merely because the method is mutating. Absence of a body can be the correct contract.

When a body field selects a behavior branch, both the single `example` and the named `examples` map on the request media type are retained, and so are per-property `description` and `example` inside the schema. Use them to make each branch callable: state the trigger→behavior mapping on the property `description` (and the operation `description`), and give the `examples` map one named entry per material branch whose `value` carries the branch-selecting inputs (for example `withinStock` and `exceedsStock`). Keep the single `example` for the ordinary success branch. This is the profile's richest place to exemplify request-value branching, so prefer it over prose alone.

Recognized request media types are `application/json`, `application/xml`, `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, `text/html`, `text/event-stream`, `application/octet-stream`, `application/pdf`, and the supported PNG/JPEG/GIF/WebP image types. Do not let an unknown vendor media type be silently coerced to JSON.

## Responses and schemas

- Give every response a description.
- Give body-bearing responses a schema.
- **Give every body-bearing response one `example`.** The importer retains one example per status, and it is the only place a flow generator learns what a real body looks like; an absent example is a silently weaker artifact rather than an import failure, so the bundled validator warns about it — per media type, since it cannot know which one the importer will keep. A response that declares two media types is therefore asked for two examples while only one survives: prefer one media type per response, exactly as request bodies are capped at one.
- Exempt from that rule, and not warned about: a `204`/`205` with no content, and a body whose bytes are not text — `application/octet-stream`, `application/pdf`, any `image/*`, `text/event-stream`, or any schema with `format: binary`. Describe such a body in the response `description` instead.
- Response media types are **not** restricted to the recognized list, which applies to request bodies only. That is a known gap rather than a licence: an unusual response media type may or may not survive the importer's own handling, so name it in the delivery report when you emit one.
- A `204` or `205` may omit content; other successful responses should describe their content.
- Required property names must exist in the same schema's `properties`.
- Use single JSON Schema types. Avoid boolean schemas and OpenAPI 3.1 unions.
- Do not use `oneOf` or `anyOf` where exact request or response structure matters. The current importer flattens them lossily.
- Use `allOf` only when its flattened result is unambiguous and preserves the intended required fields.

Circular references are reduced by the importer. Prefer bounded response projections when a recursive domain model is not necessary for load generation.

The importer retains a response `description` and a single `example` per status, but not a named `examples` map on a response. So express an output branch through its own response status: give each branch-caused status its own response object whose `description` names the triggering condition ("returned when `quantity` exceeds available stock") and whose single `example` shows that branch's body. Do not try to pack several output branches into one status via a named `examples` map — it is dropped on import. Two success branches that share a status and differ only in body content collapse to one retained `example`; note the second branch in the `description` and, if the distinction matters for load, report it.

## Security schemes

Define every referenced scheme in `components.securitySchemes` with a complete `apiKey`, `http`, `oauth2`, or `openIdConnect` shape. API keys must use a header in the current compatibility profile. Describe only authentication behavior verified from source and global middleware. Never place a real token, cookie, key, credential, tenant identifier, or captured header value in the document.

## Naming that trips the secret heuristic

The bundled validator refuses to let a literal value sit on a secret-bearing name. The rule it applies: split the name on camel-case and non-alphanumeric boundaries, lowercase it, and reject when the result **equals or ends in** one of `api_key`, `authorization`, `password`, `passwd`, `secret`, `token`. So `nextToken`, `refreshToken` and `clientSecret` all match, while `tokenBudget` and `authorizationFlow` do not, because the sensitive word is not last.

Three positions where that bites, and what to do:

- **A security scheme name.** A requirement object is `{"schemeName": []}`, and its value is an array, so a scheme whose name ends in a sensitive word — `apiToken`, `bearerToken` — reads as a secret carrying a literal and is rejected. Name the scheme after the mechanism, the header or the issuer, so that the sensitive word is not the last segment: `identityHeader`, `tenantApiKeyHeader` and `serviceIdentity` all pass.
- **A property key.** A field genuinely called `nextToken` keeps its schema, because there the value is a schema object. It must not appear as a key inside an `example`, where the value is a string. Describe the value in the property `description`, and put the illustrative value on the *parameter* that accepts it, where the key is `name` rather than the field name.
- **An OAuth2 scope name** is chosen by the identity provider and cannot be renamed or moved into prose, and the `scopes` map requires a string description. The validator therefore skips the heuristic inside a `scopes` map; a scope called `read:secret` is accepted as it stands.

None of this is cosmetic: the heuristic exists so a captured credential cannot reach an artifact, and renaming a real field to satisfy it would be worse than describing the value in prose.

## Provenance extension

`info.x-loadcraft-source` is the one supported extension. It records which repository state the artifact was derived from, so a later run can update incrementally instead of re-deriving everything:

- `commit`: the analyzed repository's `git rev-parse HEAD` hash;
- `dirty`: whether the working tree had uncommitted changes at analysis time;
- `method`: `native-export` when a framework's own generator produced the shapes, `platform-export` when the routes came from a platform's exported document and the bodies were traced by hand, `static-trace` otherwise.

The stamp accepts exactly those three keys. Anything else — which repository, which environment, which of several commits — is a hard validation error here and belongs in the delivery report instead.

When the artifact describes a **deployed environment** rather than a checkout — a gateway stage, a running service — the stamp still records the repository state you traced, because that is what an incremental update can diff. Say so in the delivery report, name the environment, and note that the deployment may not correspond to that commit. Establishing whether it does requires reading the deployment, which is outside the default read-only scope: without expanded scope, record the divergence as unverified rather than asserting either way. A single stamp cannot express two sources; the report is where the divergence belongs. When the traced repository is dirty, or the artifact spans several repositories and only one commit can be recorded, say which repository the stamp refers to and expect the next run to re-verify everything.

The bundled validator enforces this shape. Omit the stamp when the repository is not under git and say so in the delivery report. The stamp is maintenance metadata, not an unresolved marker; LoadCraft ignores it on import.

## Unsupported readiness signals

Do not use `x-todo` or `x-loadcraft-blocker` to carry unresolved facts into a deliverable. Neither blocks import, and the bundled validator rejects both.

Because `info.x-loadcraft-source` is the only supported extension, operational numbers a journey needs — a polling interval, a maximum attempt count, the resulting ceiling, a per-caller quota — have no structured home. Put them in the prose of the operation `description`, where the importer keeps them, and repeat them in the delivery report.

Do not spend analysis time generating `x-perf` as a LoadCraft control contract. The current OpenAPI-to-flow path does not consume it for load safety or flow semantics. Keep operational advice in the delivery report unless a future product contract explicitly introduces a validated extension.

Keep explicit admin, reset, chaos, observability, and other environment-control routes for full source parity, but identify them in the report. Their presence in OpenAPI is not permission to include them in a load journey.

## Fail-ready conditions

Do not declare the artifact ready when any of these remain:

- a route, method, security requirement, request shape, or success response is unknown;
- a required external reference cannot be bundled;
- an exact union or recursive shape cannot be represented without semantic loss;
- operations are missing from the source-to-spec inventory comparison;
- the bundled validator reports an error;
- the bundled validator reports a warning you have neither resolved nor named in the delivery report. Warnings do not block an import, which is exactly why they are easy to ship by accident; each one describes an artifact the importer accepts while producing measurably worse flows or feeder data. Run the validator with `--strict` to see them as failures.
