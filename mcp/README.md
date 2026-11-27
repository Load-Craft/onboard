# LoadCraft MCP server

TypeScript (ESM, Node >= 22.17) source of the stdio MCP server used by the LoadCraft plugin.
Run every command from this directory.

- `npm ci` installs the pinned dependencies.
- `npm run lint` runs ESLint and `prettier --check`.
- `npm run typecheck` runs `tsc --noEmit`.
- `npm test` runs the Vitest suite; `npm run format` rewrites files with Prettier.
- `npm run build` is a placeholder until the bundling task lands.
- `npm run gen:api` / `check:api` (REST client) and `npm run gen:ws` / `check:ws` (WebSocket client) generate and check the typed clients, each its own process, so a failure names the client and the document (`gen:ws: <document>: ...`) and never stops the other; `gen:clients` / `check:clients` run both and end with one line saying which passed.
- `npm run gen:tools` writes what the catalog says of the tools of the modules (`src/tools/<module>/meta.generated.ts`); `npm run gen:tools -- --scaffold <tool>` starts a new tool of a module, `check:catalog` fails on a stale file. How to add a tool: [docs/module-tools.md](docs/module-tools.md).
- `LOADCRAFT_DEMO=1` (or `true`, which is what the plugin's `demo` option passes; no trimming) starts the server on a sample backend of its own (world `sklep`, loopback only, no account or token needed); `LOADCRAFT_DEMO_SPEED` (default 30) sets how much faster than real time its clock runs. The backend is `dist/demo-backend.mjs`, built from `test/fake-backend/demo.ts` and imported only in this mode. The mode refuses to start when `LOADCRAFT_API_URL` or a `LOADCRAFT_URL` other than the default `https://app.loadcraft.io` is set, keeps the project binding and cache in a temporary folder, and ends every result with a notice that the data is sample data.

## Typed clients: `gen:api` and `gen:ws`

The two documents in `contracts/` generate the clients the plugin is typed by. Never edit them by hand.

| Contract                                            | Generated file                 | Tool                                               |
| --------------------------------------------------- | ------------------------------ | -------------------------------------------------- |
| `loadcraft-openapi.json` (REST)                     | `src/http/generated/api.d.ts`  | `openapi-typescript`                               |
| `loadcraft-asyncapi.json` (WebSocket, AsyncAPI 3.0) | `src/ws/generated/channels.ts` | `scripts/gen-clients/` (types only, no dependency) |

`channels.ts` holds a type for every frame, a union per channel and direction, and the `CHANNELS`
table (address, path parameters, wire types). `src/ws/typedChannel.ts` is the client on top of it:
`channelAddress`, `parseServerFrame`, `encodeClientFrame`.

The hand-written Zod readers (`src/api/*.ts`, `src/ws/frames.ts`) read only the keys the plugin needs and
mask secrets, so they stay. `reads<Wire>()` and `readsTable()` (`src/contract/reads.ts`) make `tsc` fail at a
reader whose key is missing from the generated type or has another type there. Where the OpenAPI
document leaves an answer open (`{[key: string]: unknown}`), nothing can be checked and the reader is not wrapped.

## Syncing the API: `npm run sync:api`

One command takes a backend's OpenAPI document, regenerates the typed client and lists what in the
plugin has to change. Use it whenever the backend API moves.

```sh
npm run sync:api -- --from-url http://127.0.0.1:8000            # a running backend
npm run sync:api -- --from-backend ../../backend-tree           # a backend working tree
npm run sync:api -- --from-file build/openapi.json              # a file
npm run sync:api -- --from-url http://127.0.0.1:8000 --dry-run  # write nothing
```

- **WebSocket document.** `--asyncapi-from-file <file>` or `--asyncapi-from-url <address>` (reads
  `<address>/asyncapi.json`) does the same for `contracts/loadcraft-asyncapi.json`: regenerates
  `src/ws/generated/channels.ts` and reports changed frames and keys (a removed or retyped key, a
  removed frame, null now allowed, a key no longer always present), the ones the plugin uses apart (the
  surface of `contracts/ws-frames.json`). It counts toward exit codes `1` and `2` like REST changes and
  can be given alone.
- **Sources.** `--from-url` reads `<address>/openapi.json` and sends the token from
  `LOADCRAFT_API_TOKEN` (or the variable named by `--token-env`) as a bearer; the token is never
  printed. `--from-backend` runs `scripts/export_openapi.py` with the `.venv` of that tree (no
  `uv sync`) and prints the tree's commit. Without a source the backend at `LOADCRAFT_API_URL`
  (or `LOADCRAFT_URL`) is used, the address the plugin itself talks to.
- **What it does.** Saves `contracts/loadcraft-openapi.json` (the commit and branch of the source,
  found by `--from-backend` or given by `--source-commit` / `--source-branch`, are printed in the
  report only: no file records them), regenerates `src/http/generated/api.d.ts`, prints the added, removed and changed operations (the
  routes the plugin calls, found in `src/`, apart from the rest; each marked breaking or additive),
  then runs `tsc` and groups the errors by file and tool. Another generator (for example Zod
  schemas) is one more entry in `GENERATORS` in `scripts/sync-api/main.ts`.
- **`--dry-run`** writes nothing in the repository: the new document and the types go to a copy,
  where the compiler runs.
- **Exit codes.** `0`: no changes, or only additive ones and the plugin compiles. `1`: the plugin
  does not compile (takes precedence over `2`). `2`: a route the plugin uses changed in a breaking
  way (a field removed, a new required field, a narrowed type), although the code still compiles.
  `3`: bad call or the source could not be read.
- **Compositions.**
  - `allOf` parts are merged first; `anyOf [X, null]` is `X` that may be `null`.
  - A plain schema against an `anyOf`/`oneOf` is compared with the matching variant (same `$ref`,
    then the closest shape); the other variants are `variant added` / `variant removed`.
  - Direction as elsewhere: in a response an added variant breaks, in a request it does not.
  - In an error response (4xx, 5xx, `default`) variant changes are `info` (`~`), never breaking.
- **After a run with changes.** Fix `src/api/*.ts` (calls and Zod schemas) and the tool the report
  names; run `npm test`; run `npm run build` (the bundle embeds the snapshot) and `npm run check:api`;
  update the contract guard on the backend side (`used_by` of the routes that changed); commit the
  snapshot, the types, `dist` and the fixes together.
