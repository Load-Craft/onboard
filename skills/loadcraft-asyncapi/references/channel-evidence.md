# Channel evidence protocol

Trace asynchronous behavior across layers before writing an AsyncAPI operation.

## Required trace

For each operation follow:

1. the registration site: consumer subscription, producer call, or WebSocket route (e.g. `@app.websocket`, `consumer.subscribe`, `producer.send`, `channel.basic_consume`, socket.io handlers);
2. the concrete channel address: topic, queue, routing key, or WebSocket path — resolved from constants and configuration, not guessed from variable names;
3. the direction **from the application's perspective**: the application consuming a message is `receive`; the application emitting one is `send`. LoadCraft plays the other side automatically;
4. the payload shape, traced to the serializer, DTO, schema class, or validation model actually used at that site;
5. headers, correlation identifiers, and content type (serializer defaults count as evidence);
6. the observable acknowledgement, reply message, or state change that proves the interaction completed;
7. connection and authentication setup shared by the channel (recorded as evidence for the report, never as literal credentials in the document).

## Evidence quality

- The subscription or publish call proves direction and channel address.
- Typed message models and serializers prove payload shapes and content types.
- Configuration files and constants prove addresses and server URLs; environment-variable indirection without a checked-in default is a blocker, not a guess.
- Tests confirm examples and branching behavior, but may be stale.
- Existing AsyncAPI documents and README examples are secondary evidence until reconciled with executable source.

Never infer a payload schema solely from a domain object when a serializer transforms it. Never guess a topic name from a variable name when the value is provisioned externally.

## Unknowns

Unknown contract facts are blockers. Keep the known operation and channel, omit only the unverified nested fragment, and withhold the ready verdict. Do not invent values and do not encode placeholders such as `x-todo`, `[TODO]`, `TBD`, or fictional message bodies in the import artifact.

Use synthetic examples that demonstrate shape without revealing repository or customer data. Suitable neutral values include `app.example.com`, `orders-events`, `order-example`, and `user@example.com`. An illustrative value is not automatically safe load data: for a field that must be unique, valid in an external system, or secret, omit the fixed example and record the provisioning/feeder requirement in the delivery report.

## Per-operation task isolation

One operation is one analysis task with a fresh focus. Above roughly five operations, delegate the tasks to subagents when the environment supports them and run them in parallel batches of 3-5. Give each worker only:

- the resolved repository root;
- its exact operation (registration site, direction, channel);
- the relevant shared contract locations (broker config, serializer base, envelope definitions);
- this evidence protocol;
- a strict instruction not to write shared files.

A worker's prompt must not contain other operations' findings; isolation is what keeps each traced schema grounded in its own evidence instead of pattern-matched from a neighbor.

Each worker returns a finding containing the operation's intended AsyncAPI content, message component candidates, evidence paths and symbols, and blockers. It does not update a registry or the final spec.

The coordinating agent:

- reconciles shared connection and envelope layers once;
- rejects conflicting message definitions;
- assigns stable channel and message names;
- writes the only canonical `asyncapi.json`;
- performs the final source-to-spec parity check;
- assembles the delivery report's evidence trail and blocker list itself, from the findings the workers returned — workers supply raw evidence, they never author the report.

When subagents are unavailable, follow the same ownership model sequentially: trace one operation at a time and record its complete finding before opening the next.

If several operations are being written from a single read of a consumer module, stop and return to the per-operation protocol. Batching is how schemas get pattern-matched instead of traced.
