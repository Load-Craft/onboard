# Per-endpoint analysis protocol

You are analyzing EXACTLY ONE endpoint. Your only inputs: the endpoint entry from
`endpoints.json`, the project's `docs-workspace/conventions.md`, and the codebase.
Your output: one verified YAML fragment (and, for Strategy A/B, the corresponding
code annotations). Do not touch or describe any other endpoint.

## Rules

1. **Trace, don't infer.** Open the handler file. Follow every call that shapes the
   request or response: validators, DTOs, serializers, ORM models, service functions,
   mappers. Stop only at concrete field definitions.
2. **No guessing — ever.** If a field's type or presence can't be established from code
   (dynamic dicts, reflection, raw SQL `SELECT *`, untyped JSON), write
   `x-todo: "<what is unknown> — <file>:<line>"` at the exact spot. Never fill gaps
   with plausible field names.
3. **Middleware counts.** Apply the global envelope, error format, pagination and auth
   from `conventions.md`. If this endpoint deviates from a convention, that deviation
   is important — document it and add a note.
4. **Errors are part of the contract.** List every status the code can emit: explicit
   returns/throws in the handler, validator failures, auth middleware rejections,
   framework defaults (404 on missing route param match, 405, 415). Include the error
   body schema, not just the code.
5. **Description = capability, in plain language.** The spec is consumed by AI
   (generating performance-test scenarios and clients) and by non-expert readers.
   Write 1–3 short sentences that state **what a user can accomplish with this
   endpoint**, then any side effects (emails, events, cascading writes, cache
   invalidation). Plain verbs, no internal jargon, no restating the schema.
   - Good: "Lets a customer place a new order from their current cart. Reserves
     stock and sends an order-confirmation email."
   - Bad: "Handles POST order requests via OrderController and returns OrderDTO."
   If you can't tell what it's for after reading the service layer, say so in `x-todo`.
6. **Examples must be traced.** Build the example response from actual field
   definitions and realistic values consistent with types/enums found in code — not
   from imagination.
7. **Add the `x-perf` block.** Machine-readable metadata that a test-generating AI
   needs to build a realistic, runnable scenario for this endpoint:

```yaml
x-perf:
  auth_prerequisite: "Bearer token from POST /auth/login"   # or "none"
  data_dependencies:                                        # what must exist first
    - "an existing user id (create via POST /api/v1/users)"
  idempotent: true            # safe to repeat with same input?
  read_only: true             # false if it mutates state
  load_test_safe: true        # false + reason if it triggers emails/payments/3rd parties
  typical_payload: "single object, ~1 KB"                   # or "paginated list, default 20 items"
  notes: "Response size grows with the user's role count"   # optional, only if traced
```

   Every field must be traced from code like everything else — `x-todo` if unknown.
   `load_test_safe: false` is mandatory for endpoints with external side effects
   (payments, SMS/email, third-party APIs) so generated scenarios can exclude or
   mock them.

## Checklist (all items required before marking `done`)

- [ ] `summary` (≤ 10 words) and `description` (plain-language capability + side effects)
- [ ] `x-perf` block, fully traced (auth prerequisite, data deps, idempotency, load-test safety)
- [ ] `operationId` (stable, camelCase, matches handler intent)
- [ ] `tags` (resource-based)
- [ ] All path params with types and constraints
- [ ] All query params: name, type, default, required, enum values if constrained
- [ ] Relevant headers (auth handled via `security`, not a header param)
- [ ] `requestBody` schema traced to validator/DTO, with `required` fields list
- [ ] Every success response with exact schema (nullability + optionality explicit)
- [ ] Every error response with schema
- [ ] `security` block (or explicit `security: []` for public endpoints — deliberate!)
- [ ] One example per success response
- [ ] `x-todo` entries for everything unverifiable
- [ ] `deprecated: true` if code/comments indicate it

## Output

Write `docs-workspace/paths/<id>.yaml` containing a single path item:

```yaml
/api/v1/users/{id}:
  get:
    operationId: getUserById
    summary: Fetch a single user profile
    description: >
      Returns the full profile of the user identified by `id`, including role
      assignments resolved from the permissions service. Read-only, no side effects.
    tags: [Users]
    security:
      - bearerAuth: []
    parameters:
      - name: id
        in: path
        required: true
        schema: { type: string, format: uuid }
    responses:
      "200":
        description: User found
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/User"   # define inline if not yet shared
            example:
              id: "9f1c…"
              email: "user@example.com"
      "401": { $ref: "#/components/responses/Unauthorized" }
      "404":
        description: No user with this id
        content:
          application/json:
            schema: { $ref: "#/components/schemas/Error" }
```

Inline any schema you traced (the merge phase will lift shared ones into components).
Then update this endpoint's entry in `endpoints.json`: `status: done` (or `blocked`
with a `blocked_reason`). For Strategy A/B also apply the code annotations and note
the edited files in the endpoint entry.
