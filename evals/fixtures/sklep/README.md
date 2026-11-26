# sklep - synthetic customer repository

A small online-shop API (Node, eight routes under `/api`) used to exercise the LoadCraft plugin
without a real customer. It holds what an agent looks for in a customer repository:

| Path | What it is |
|---|---|
| `src/` | the API; `src/checkout/pay.ts` charges the card inside a database transaction (the planted performance defect) |
| `loadcraft/openapi.json` | the API description in the LoadCraft profile, stamped with a commit |
| `deploy/versions.yaml` | which git ref runs in perf, qa, dev and prod |
| `.env.perf`, `.env.qa` | API and web addresses (`*.example.com`) and the test account; the password is the sentinel secret used by the tests and must never appear in any output |
| `.env.dev`, `.env.prod` | API and web addresses only (no test account) |
| `.gitignore` | keeps the `.env.*` files out of the history `init-fixture.sh` builds |
| `.mcp.json` | the `sklep-logs` MCP server (example address) |
| `nagrania/sesja.har` | a short recorded session with response bodies |

Everything uses neutral data (`example.com`, `user@example.com`).

## Using it

The fixture is not a git repository inside this tree. Copy it to a temporary directory and build
its history there:

```bash
./init-fixture.sh /tmp/sklep
cd /tmp/sklep
git tag          # v2.13.2, v2.14.0
git log --oneline v2.14.0..dev | wc -l   # 31
```

Point the plugin at the stand-alone fake backend (`npm run fake` in `mcp/`, see
[../README.md](../README.md)) and open the copy in Claude Code.
