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
- Do not rely on parameter `content`, plural `examples`, `style`, or `explode` for behavior that LoadCraft must understand; these fields are not retained in the canonical internal parameter model.

## Request bodies

- Do not emit request bodies for `GET`, `DELETE`, or `HEAD`.
- For an operation with a body, declare exactly one truthful media type. The current importer consumes the first media type.
- Set `requestBody.required` explicitly from handler evidence.
- Always declare the request schema.
- Prefer an object schema with explicit `properties` and `required` for mutable JSON operations.
- Put safe synthetic examples on properties only when a required value cannot be derived from its type or constraints alone. Never put an example/default/enum on a password, token, secret, authorization, or API-key field. Do not freeze unique or externally provisioned values such as registration identities; describe the data requirement and report the required feeder or credential source instead.

Never add a body merely because the method is mutating. Absence of a body can be the correct contract.

Recognized request media types are `application/json`, `application/xml`, `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, `text/html`, `text/event-stream`, `application/octet-stream`, `application/pdf`, and the supported PNG/JPEG/GIF/WebP image types. Do not let an unknown vendor media type be silently coerced to JSON.

## Responses and schemas

- Give every response a description.
- Give body-bearing responses a schema.
- A `204` or `205` may omit content; other successful responses should describe their content.
- Required property names must exist in the same schema's `properties`.
- Use single JSON Schema types. Avoid boolean schemas and OpenAPI 3.1 unions.
- Do not use `oneOf` or `anyOf` where exact request or response structure matters. The current importer flattens them lossily.
- Use `allOf` only when its flattened result is unambiguous and preserves the intended required fields.

Circular references are reduced by the importer. Prefer bounded response projections when a recursive domain model is not necessary for load generation.

## Security schemes

Define every referenced scheme in `components.securitySchemes` with a complete `apiKey`, `http`, `oauth2`, or `openIdConnect` shape. API keys must use a header in the current compatibility profile. Describe only authentication behavior verified from source and global middleware. Never place a real token, cookie, key, credential, tenant identifier, or captured header value in the document.

## Unsupported readiness signals

Do not use `x-todo` to carry unresolved facts into a deliverable. It does not block import.

Do not spend analysis time generating `x-perf` as a LoadCraft control contract. The current OpenAPI-to-flow path does not consume it for load safety or flow semantics. Keep operational advice in the delivery report unless a future product contract explicitly introduces a validated extension.

Keep explicit admin, reset, chaos, observability, and other environment-control routes for full source parity, but identify them in the report. Their presence in OpenAPI is not permission to include them in a load journey.

## Fail-ready conditions

Do not declare the artifact ready when any of these remain:

- a route, method, security requirement, request shape, or success response is unknown;
- a required external reference cannot be bundled;
- an exact union or recursive shape cannot be represented without semantic loss;
- operations are missing from the source-to-spec inventory comparison;
- the bundled validator reports an error.
