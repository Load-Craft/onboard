# Skill validators

TypeScript source of the four stand-alone validators that ship inside the skills:

| Source                     | Built file                                                |
| -------------------------- | --------------------------------------------------------- |
| `src/validate_openapi.ts`  | `skills/loadcraft-openapi/scripts/validate_openapi.mjs`   |
| `src/validate_asyncapi.ts` | `skills/loadcraft-asyncapi/scripts/validate_asyncapi.mjs` |
| `src/validate_journeys.ts` | `skills/loadcraft-journeys/scripts/validate_journeys.mjs` |
| `src/validate_overview.ts` | `skills/loadcraft-overview/scripts/validate_overview.mjs` |

A user runs a built file with a bare `node` (`node <skill-root>/scripts/validate_openapi.mjs loadcraft/openapi.json`):
no install step, no dependencies, Node.js 22.17 or newer (the same floor as the MCP server). Every built file is
one bundle, so the source may use `src/py/` freely.

## Working on them

All commands run from `mcp/`, which owns the toolchain (esbuild, vitest, ESLint, Prettier, TypeScript):

```bash
npm run build:skills   # validators/src -> skills/*/scripts/validate_*.mjs
npm run check:skills   # fails when a built file differs from its source (part of check:dist)
npm run test:skills    # the tests of the validators and of the skills (../tests/*.spec.ts)
```

Edit the TypeScript and rebuild; never edit a built file. A change of a rule starts with a failing test in
`tests/`, then the validator, the skill instructions and the reference change together (see `AGENTS.md`).

## `src/py/`

The validators began as Python scripts, and their output (messages, order, exit status) is a contract that
skills, evaluations and users rely on. `src/py/` keeps the pieces of Python behaviour JavaScript does not have,
so the rewrite stays byte for byte compatible:

- `json.ts`: `json.loads` / `json.dumps`. Objects stay `Map`s in document order (JavaScript would move
  integer-like keys such as response codes), integers stay `bigint`, errors carry Python's wording and position.
- `regex.ts`: Python `re` patterns as JavaScript regular expressions (Unicode `\w \d \s \b`, `$` before a final
  newline, `.` and `^`/`$` breaking only on `\n`, `IGNORECASE` with the Turkish `i`).
- `str.ts`, `path.ts`, `io.ts`: `str.strip` / `casefold` / `repr` / `splitlines`, `pathlib` ordering,
  `read_text` (universal newlines, strict UTF-8 with CPython's error text), `rglob`.
- `argparse.ts`, `run.ts`: usage, help and error text of `argparse`, exit status 2 for a bad command line.

`tests/py-compat.spec.ts` pins these helpers to recorded CPython output.

Known difference: a document nested within a few levels of Python's recursion limit (about 990 levels) may be
classified differently, because CPython's limit depends on interpreter state. An uncaught Python exception
(for example an unreadable file in the AsyncAPI validator) prints its last traceback line only.

## Validity against the official tooling

Besides the LoadCraft rules, the validators reject a document the official tooling refuses.

- `validate_openapi`: `src/oas3-struct.ts` runs the `struct` rule of `@redocly/openapi-core` on its OpenAPI 3.0 type
  tree (a dev dependency, bundled into the `.mjs`; `src/ref-utils-stub.ts` replaces the one helper of the library
  that would pull in the rest). Unknown fields, wrong types and missing required fields are errors.
- `validate_asyncapi`: the AsyncAPI 3.0 shape is written by hand (servers with `host` and `protocol`, no `url`;
  operation messages from the operation's own channel; fields and types of servers, channels, operations,
  messages, examples and parameters). The official parser is about 5 MB bundled and is not embedded. Not checked:
  the JSON Schema format of payloads, bindings, security objects, traits, and `$ref` targets of the wrong kind.
