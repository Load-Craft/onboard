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

## Evidence quality

Use evidence strong enough for each emitted statement:

- Route source proves method, path, dependencies, and often response status.
- Typed request and response models prove shapes and constraints.
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

Each worker returns a finding containing the operation's intended OpenAPI content, component candidates, evidence paths and symbols, and blockers. It does not update an endpoint registry or the final spec.

The coordinating agent:

- reconciles shared middleware once;
- rejects conflicting component definitions;
- assigns stable component names;
- writes the only canonical `openapi.json`;
- performs the final source-route parity check;
- assembles the delivery report's evidence trail and blocker list itself, from the findings the workers returned — workers supply raw evidence, they never author the report.

When subagents are unavailable, follow the same ownership model sequentially: trace one operation at a time and record its complete finding before opening the next.

If several operations are being written from a single read of a route file, stop and return to the per-endpoint protocol. Batching is how schemas get pattern-matched instead of traced.
