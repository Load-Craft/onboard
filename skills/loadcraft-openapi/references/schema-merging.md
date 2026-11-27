# Merging schemas shared by several operations

Operations traced in isolation describe the same domain object many times, each slightly different: one worker lists three fields, another seven, a third spells a nested object another way. Left alone, the artifact carries a dozen variants under one name and a generated journey cannot tell which is true. The coordinating agent merges them with the steps below. Workers never merge; they return findings only.

## What a worker returns

For every object schema it uses, a worker returns the schema fully expanded (no `$ref`) and a canonical `title`, the name of the domain object (`Order`, `ErrorBody`), chosen the same way for the same object everywhere. A worker traces only what its own operation emits, so a worker's schema is the observable subset for that operation.

## Steps for the coordinator

1. **Collect.** Gather every returned object schema by `title`.
2. **Normalize.** For each schema, build a comparison form: sort object keys, sort `required`, drop `description`, `title` and `example`, keep `type`, `format`, `enum`, bounds and nested structure. Hash the compact JSON of that form.
3. **Group by title and hash.** Schemas with the same title and the same hash are identical: they become one component.
4. **Decide each title with several hashes.** Never merge silently, and decide on evidence:
   - the variants are the same object seen through different projections (one operation omits fields the other emits): keep one component per projection and name each for what it is (`OrderSummary`, `Order`), or keep a single component only if the fields a variant lacks are genuinely optional in its operation;
   - the variants disagree about the same field (type, nullability, enum values): the source disagrees with itself or a worker mis-traced. Re-read the source for that field, fix the wrong variant, and report an unresolved conflict as a blocker rather than picking one;
   - the variants are different objects that were given one name: rename them.
5. **Substitute.** Replace each worker's inline copy by a `$ref` to the chosen component, but only for objects. Enums and other leaf constraints stay inlined at every use site (see the contract reference), so a merge never extracts an enum.
6. **Check names.** Component names stay stable between runs: reuse the existing name when updating an artifact. Error bodies that differ only in their example share one component, and the per-status `description` and `example` carry the difference.
7. **Re-measure.** A `$ref` is expanded at every use, so merging makes the file shorter and the expanded operation no smaller. Run `validate_openapi.mjs --measure` and trim large shared objects to the fields a journey needs (see *Size budget* in the contract reference).

## Checks after merging

- every `$ref` resolves, and no component is unused;
- every field a worker reported appears in at least one component, or is listed in the report as excluded;
- the validator passes.
