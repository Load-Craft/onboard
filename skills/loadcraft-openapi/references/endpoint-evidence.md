# Endpoint evidence protocol

Trace behavior across layers before writing an OpenAPI operation.

## Required trace

For each endpoint follow:

1. route registration, method, normalized path, and handler;
2. global and route-specific auth or role middleware;
3. path, query, header, and cookie parameter parsing;
4. request-body DTO, validation, defaults, and media type;
5. service outcomes that change observable responses;
6. serializer, response envelope, and status selection;
7. exception handlers and documented material errors;
8. tests that confirm boundary behavior.

Source closer to the executable boundary normally outweighs prose documentation, but conflicts must be reported rather than silently resolved.

## The transformation layer is the response contract

Where a request crosses a gateway, proxy, or mapping layer before it reaches application code, that layer — not the handler — decides the field names and shapes a client actually receives. Trace it, and treat what it emits as the response contract.

This matters most when a platform can hand you an OpenAPI document of its own: a gateway export, a service-mesh descriptor, a generated client. Such an export is normally **structurally complete and semantically empty** — every route and method present, and every response typed as an untyped object, with no `operationId`, no descriptions, and no error statuses that the platform did not have to declare. Use it as authoritative for the route inventory, the declared request models, the declared parameters, and the effective security scheme. Do not use it for response shapes. Reconcile those against the request/response mapping templates, the serializer, or whatever else actually renders the body, and expect the deployed transformation to expose fields the platform's own document never mentions.

A related trap: such an export tells you what is deployed, while the repository tells you what is committed. When the two can differ, say which one you traced, and check a value you can compare — a declared enum, a validation bound, a route that only exists after a certain change — to establish whether the deployment matches the code you read.

## Status codes are not evidence of outcome

Before you document a success status, check whether the layer that emits it can emit anything else. A response mapping that declares a single outcome, or a success template rendered unconditionally, turns every downstream refusal into that same success: an orchestration rejection, a throttle, a serialization failure all arrive as `200` with a synthesized body, and nothing was actually created.

When you find that, the operation's `description` must say so plainly, and its success response `description` must say that the status does not prove the work started. This is not a footnote. A load test built on such an endpoint will report a clean run at exactly the load where the system stopped doing anything, unless the artifact tells its reader to assert somewhere else.

Look for the same asymmetry in the other direction: sibling operations on the same API often *do* declare selection patterns for 4xx and 5xx, and the contrast is worth recording, because it tells a reader which endpoints can be measured by status and which cannot.

## Accept-then-poll contracts

An operation that accepts work and returns an identifier is not finished when it responds, and the artifact has to carry the whole contract or a generated journey will assert on the wrong thing. Trace and document:

- what the accept response actually contains, and whether the identifier it returns is the one the caller supplied or a new one;
- which operation reports progress, and the full set of states it can report, per the *Per-operation observable subsets* rule in the compatibility profile;
- which states are terminal, which are transient, and which look terminal but are not — a state that also appears with an error field attached, or a success state that does not guarantee the payload is present;
- the polling contract the system itself uses: interval, maximum attempts, and the resulting ceiling, since that is the upper bound on any journey that waits for completion;
- what a caller sees when it polls an identifier whose record does not exist yet, and whether that answer is transient or permanent — a permanent one bounds the poller, an unbounded retry does not;
- any per-caller quota the accept path consumes, because a load profile that reuses one identity will exhaust it and then keep receiving accept responses.

## One status, two bodies

An operation whose single success status carries two mutually exclusive bodies — a record, or a not-found envelope — cannot be expressed with a union in this profile. Model one object that declares the properties of both shapes, declare no `required` list precisely because the other shape shares the status, describe both shapes in the response `description`, and spend the one retained example on the shape a journey will normally receive. Say in the report which shape the example does not cover.

## Branch-aware examples

Endpoints rarely do one thing. When the handler or a service it calls branches on a request value — an `if`/guard/threshold on a body field, query parameter, path parameter, or header — each branch is a distinct observable behavior with its own load profile, and the artifact must let a reader say "call this endpoint with THESE values and THIS happens."

For each in-scope operation, find the conditionals that depend on a request value and, for every distinct behavior branch, record:

- the **triggering value(s)**: the request field and the concrete value or range that selects the branch (`quantity > 50`, `order_id == "missing"`, `?expand=full`, absent `Authorization` header);
- the **observable outcome**: the status code, and how the work differs — a rollback, a different serialized state, an extra downstream call, a synchronous vs. deferred path, a paginated vs. full scan;
- the **code evidence**: the file and symbol where the condition and its outcome are written, plus any test that pins the boundary.

Only branches that a caller can select through request values count here. Do not record internal branches a client cannot steer (a cache hit, a random retry, a clock-based path); note them as report context if they matter, but they are not example-bearing branches. Never invent a branch to look thorough — each one must come from a traced code path.

A worker returns its branch findings as part of the same per-endpoint finding, not as a separate artifact: the branch table (trigger → outcome → evidence) travels with the operation's proposed OpenAPI content so the coordinating agent can place each branch where the importer retains it.

## Evidence quality

Use evidence strong enough for each emitted statement:

- Route source proves method, path, dependencies, and often response status.
- Typed request and response models prove shapes and constraints.
- A mapping template, serializer, or response transformer proves the field names a client receives, and outranks a handler's return type when the two disagree.
- A platform's own exported document proves the route inventory, the declared request models and the effective security scheme, and proves nothing about response bodies.
- Shared middleware proves effective security and headers.
- Exception mapping proves status and error envelope.
- Tests confirm examples and conditional branches, but may be stale.
- Existing specs and README examples are secondary evidence until reconciled.

Never infer a success schema solely from a service's internal domain object when a serializer transforms it.

## Unknowns

Unknown contract facts are blockers. Keep the known operation and known status codes, omit only the unverified nested fragment, and withhold the ready verdict. Do not invent values and do not encode placeholders such as `x-todo`, `[TODO]`, `TBD`, or fictional error bodies in the import artifact. Never remove a source route merely to make validation green.

Use synthetic examples that demonstrate shape without revealing repository or customer data. Suitable neutral values include `app.example.com`, `/api/orders`, `order-example`, and `user@example.com`.

An illustrative value is not automatically safe load data. For a field that must be unique, valid in an external identity system, or secret, omit the fixed example and record the provisioning/feeder requirement in the delivery report.

## Per-endpoint task isolation

One operation is one analysis task with a fresh focus. Above roughly five operations, delegate the tasks to subagents when the environment supports them and run them in parallel batches of 3-5. Give each worker only:

- the resolved repository root;
- its exact method and path;
- the relevant global contract locations;
- this evidence protocol;
- a strict instruction not to write shared files.

A worker's prompt must not contain other endpoints' findings; isolation is what keeps each traced schema grounded in its own evidence instead of pattern-matched from a neighbor.

Each worker returns a finding containing the operation's intended OpenAPI content, component candidates, evidence paths and symbols, its value-driven branch table (trigger → outcome → evidence, per the Branch-aware examples section), and blockers. A finding must carry a synthetic example for every response status it proposes, not only for the success path, because the coordinating agent cannot invent one without re-tracing the endpoint.

When several operations share a domain vocabulary — a status field, a state machine, an error taxonomy — give that vocabulary its own worker rather than letting each endpoint worker derive it separately. Then reconcile: the union the vocabulary worker finds is what the system writes, while each endpoint's own trace decides which of those values that endpoint can actually return. Publishing the union everywhere is the failure this split exists to prevent.

That reconciled vocabulary must **not** become a shared component. The compatibility profile forbids a leaf enum behind a `$ref`, so each operation inlines its own reachable subset, with its own description saying which values are missing here and why. The vocabulary worker's output is therefore evidence for several inlined enums, not a component candidate — and the full domain vocabulary, which no single operation can show, belongs in the operation or document `description` where nothing filters it. It does not update an endpoint registry or the final spec.

The coordinating agent:

- reconciles shared middleware once;
- rejects conflicting component definitions;
- assigns stable component names;
- writes the only canonical `openapi.json`;
- performs the final source-route parity check;
- assembles the delivery report's evidence trail and blocker list itself, from the findings the workers returned — workers supply raw evidence, they never author the report.

When subagents are unavailable, follow the same ownership model sequentially: trace one operation at a time and record its complete finding before opening the next.

If several operations are being written from a single read of a route file, stop and return to the per-endpoint protocol. Batching is how schemas get pattern-matched instead of traced.
