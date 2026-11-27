# Step 1 · API documentation

Goal: a validated `loadcraft/openapi.json` that describes the code the user is about to test. It is the only description of the code LoadCraft ever receives: flows, data and the diagnosis are built from it, so a stale file makes every later step test an API that no longer exists.

No LoadCraft tool is called in this step. Generating and checking the documentation belongs to this plugin's `loadcraft-openapi` skill. Do not repeat its rules here or improvise them yourself: decide which of its modes to run, hand over, then validate and report what it found.

## 1. Find the documentation

- Search for `loadcraft/openapi.json` at the repository root; in a monorepo, at the root of the API service under test. Use a file search, not a read.
- Other OpenAPI or Swagger files (framework exports, hand-written specs, gateway exports) are not the artifact. Note their paths and give them to `loadcraft-openapi` as evidence; never send them to LoadCraft.
- Found: continue with section 2. Not found: continue with section 3.

## 2. Check what code it describes

The file can be large; do not read it whole. Read only the provenance stamp `info.x-loadcraft-source`, for example:

```bash
node -e "const fs = require('node:fs'); const info = JSON.parse(fs.readFileSync('loadcraft/openapi.json', 'utf8')).info; console.log(JSON.stringify(info['x-loadcraft-source'] ?? null))"
```

The stamp holds `commit` (the analyzed `HEAD`), `dirty` (uncommitted changes at analysis time) and `method`. Compare it with git:

1. Check that the commit resolves: `git cat-file -e <commit>^{commit}`. It does not after a rebase, a squash or in a shallow clone. Do not fetch, rebase or otherwise change the user's repository to make it resolve.
2. List what changed since: `git diff --name-only <commit>..HEAD`, then drop files that cannot change the API — documentation, CI configuration, `loadcraft/` itself, assets. Keep everything that defines routes, validation, serialization, authentication or error handling, including shared layers and dependency manifests.
3. Add uncommitted changes: `git status --porcelain`. The documentation describes them no better than unseen commits.
4. Count the distance for the user: `git rev-list --count <commit>..HEAD`.

Choose the mode from the result:

| What you found | Mode of `loadcraft-openapi` |
|---|---|
| Stamp commit is `HEAD`, `dirty` is false, no code changes | None. The documentation is current; go straight to section 5. |
| Commit resolves, `dirty` is false, code files changed | Targeted update. The skill scopes the work from the stamp itself; give it the range and the changed files. |
| No stamp, `dirty` is true, or the commit does not resolve | Drift audit against the current source, then apply its corrections. Age unknown means every operation is suspect. |
| The file is not an OpenAPI 3 document, or the validator rejects most of it | Full generation, with the old file as evidence. |

Tell the user in one or two sentences which commit the documentation describes, how far the code has moved since, and what you are going to do. The mode is your call: do not ask the user to pick one, but follow them if they already asked for a specific one.

## 3. No documentation

Explain briefly why it matters (it is the only thing LoadCraft learns about their code, and the code itself stays in the repository), then ask with the panel `generate-docs` from [panels.md](panels.md).

- Yes: full generation with `loadcraft-openapi`.
- No: remember the decision for the whole session. Step 3 then offers only building flows from a description or from a HAR recording; picking endpoints needs documentation. Continue with step 2 and do not ask again.
- A custom answer pointing to an existing document: treat that file as found and continue with section 2. If it is not at `loadcraft/openapi.json`, hand it to `loadcraft-openapi` as evidence rather than sending it as is.

## 4. Hand over to `loadcraft-openapi`

Invoke this plugin's `loadcraft-openapi` skill (listed as `loadcraft:loadcraft-openapi`) and tell it:

- the mode chosen above and the API root;
- the output path `loadcraft/openapi.json`;
- for a targeted update: the commit range and the changed code files;
- for an audit: that it should apply the corrections it finds, because the user needs a current file, not only a list of differences;
- the other OpenAPI files from section 1, as evidence.

Then follow that skill's instructions until it delivers its report. It may split the analysis across subagents; that is its own work and needs no question from the user. Its scope is read-only except for the artifact: never let this step edit application code. A large API takes a while, so say so before starting.

## 5. Validate with the plugin's validator

Always run the validator shipped with this plugin, also after the skill says it validated and also when section 2 found the documentation current:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/loadcraft-openapi/scripts/validate_openapi.mjs loadcraft/openapi.json
```

It is the gate matching the LoadCraft this plugin talks to; a copy in the repository or in another installation may be older. If the variable is not expanded, the script is in the `scripts/` directory of the `loadcraft-openapi` skill.

- Errors: return to `loadcraft-openapi` to fix them, then run the validator again. Do not edit the file around the skill.
- `WARN` lines: each one is either fixed or named in the report as accepted with a reason. An unexplained warning means the file is not ready.

## 6. Report and decide whether it is ready

Pass the skill's delivery report on to the user in their language, keeping endpoint paths and commit hashes exactly as reported. Never drop or soften these parts:

- the mode, the operation count and the commit written to the stamp;
- every blocker, and which operations it affects;
- warnings accepted and why;
- operations whose success status does not prove the work happened;
- destructive or environment-control operations. Keep this list: step 3 must not put them into a flow unless the user explicitly picks them.

The documentation is ready only with zero validator errors, every warning explained and no blocker. Otherwise it is not ready, whatever else the report says. Then ask in plain text whether to continue with incomplete documentation or to resolve the blockers first, and say what continuing means: flows over the affected operations may not match how the code really behaves, so step 3 should leave them out or the user should know the numbers may mislead. If the user can supply the missing facts, run `loadcraft-openapi` again with them.

Before moving on, tell the user once that this file is the only thing from the repository sent to LoadCraft (in step 2); the source code does not leave the repository. Keep the documented commit for step 2, which compares it with the code deployed on each environment.

## Documentation for another commit

When an environment runs other code than the working tree (found in step 2, panel `refresh-docs`), document that code in a separate worktree: `git worktree add <temporary path> <commit>`, run `loadcraft-openapi` there as a targeted update from the documented commit, validate the result in that worktree, and let step 2 send it with `project_import_docs`. Remove the worktree afterwards with `git worktree remove`. Never switch the user's branch, stash their changes or check out another commit in their working tree to do this: they may have unsaved work, and the test must not change the code they are working on. Details are in [protected-env.md](protected-env.md).

When a call of this step fails or comes back partial, do not stop at the error: follow the loop of [troubleshooting.md](troubleshooting.md) (read the cause, repair it, repeat once, otherwise report).

To see what LoadCraft holds before documenting again, `project_get_docs` shows the active documentation (`kind`: `openapi` or `asyncapi`), `versions: true` lists the stored versions, and `docs_id` reads one of them. It returns the title, version, counts and source, never the document: use it to compare the stored version with the working tree, and ask the user before replacing a version that differs.

To go back to an older stored version, or to make another one the active one, `project_set_active_docs` takes `docs_id` (and `kind`) and switches the project to it; the checks that depend on the documentation are reset, so run them again. Do it only when the user asks for that version. To take it back, call it again with the version that was active before (the data of the result holds its id).

To look at the operations LoadCraft parsed from a stored version, `project_get_endpoints` lists them (`method`, `query` and `limit` narrow the list, the documentation comes from `project_get_docs`) and reads one by its id, its operation name or `METHOD /path`; `include: ["bindings"]` adds the expected statuses and the suggested assertions. Use it to check that an operation you are about to build a flow on is documented the way you think it is.

To see how LoadCraft groups the documented operations, `project_get_apimap` lists the areas of the API with how many operations each holds, which of them have a sign-in, and how many operations are under no area. Use it before choosing areas for a generation.

To change the areas, `project_set_apimap` takes `prefixes` (paths separated by commas, at most 64, each starting with `/`) or `detected: true` for the areas LoadCraft finds itself; the result names the prefixes no operation is under. Do it when the user asks for other areas or the detected ones do not fit the application; the checks that depend on the map are reset, so run them again. To take it back, call it again with the previous prefixes, or with `detected: true` when the areas were the detected ones.
