# Tools of a module

The tools of the catalog (`catalog/katalog.json`) are written module by module: `project`, `flows`,
`scenario`, `data`, `run`, `results`, `process`, `traffic`, `functional`, `github`. Each module
owns its files, so the tasks of two modules never edit the same file. What the catalog says of a
tool (its name, description, class, consent level, MCP annotations, the marker of a person's
approval, the card and log templates, the undo, the operations, the arguments) is generated; the
module writes the input, the reads and the view.

This page walks through adding one tool, with `project_list_notes` as the worked example: a read of
level 1, one REST operation, the project from the state, texts of a third party in the result.

## The files

| File                                                         | Owner     | What it holds                                                                      |
| ------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------- |
| `src/tools/<module>/meta.generated.ts`                       | generated | the catalog entry of every tool of the module (`PROJECT_LIST_NOTES`)               |
| `src/tools/_generated/modules.ts`                            | generated | the lists of every module; what the server offers (`EXPOSED_MODULE_TOOLS`)         |
| `src/render/i18n/_generated/modules.ts`                      | generated | the dictionaries of every module, joined for the translator                        |
| `src/tools/<module>/index.ts`                                | module    | the list of the module's tools (`--scaffold` adds to it)                           |
| `src/tools/<module>/<object>.ts`                             | module    | one tool: input, a reader per operation, `run`, `render`                           |
| `src/render/<module>/<object>.ts`                            | module    | the view of the tool and the type of its data                                      |
| `src/render/i18n/<module>.en.ts`, `<module>.pl.ts`           | module    | the texts of the module's tools, keys `<tool>.…`, `<module>.…`, `error.<module>_…` |
| `skills/loadcraft-test/references/errors-<module>.md`        | module    | the error codes of the module's tools (`<module>_…`), one row each                 |
| `test/tools/<module>/<object>.test.ts`                       | module    | the tests of the tool, against the fake backend over HTTP                          |
| `test/tools/<module>/canary.ts`                              | module    | `CANARY_CASES`: the sentinel cases of the module's tools (found automatically)     |
| `test/fake-backend/routes/<module>.ts`                       | module    | the routes of the fake backend the module's tools need and no other file answers   |
| `test/fixtures/surface/<module>.json`                        | module    | the pinned `tools/list` entries of the module (`npm run update:surface`)           |
| `src/tools/moduleTool.ts`, `moduleCall.ts`, `moduleState.ts` | shared    | `moduleTool`, `callBackend` and the masks, the defaults from the state             |

`<object>` is the name of the tool without its module, in camel case: `project_list_notes` is
`src/tools/project/listNotes.ts`. Never edit a generated file: `npm run gen:tools` writes them
(`npm run gen:catalog` runs it too) and `npm run check:catalog` fails when one is stale.

Inside `mcp/`, the one shared file a module may touch is `test/fake-backend/routes/index.ts`: one
line that calls the registrar of a new `routes/<module>.ts` (and its import). Every other file of
the list above is the module's own. Outside `mcp/`, a tool the server offers is also named in the
files of step 8, which every module shares.

## How a tool is offered

`moduleTool(meta, spec)` builds the tool from its catalog entry and the module's spec:

- the description and the annotations come from the entry: the catalog's `annotations`
  (`readOnlyHint`, `destructiveHint`, and `override_reason` where they differ from the class) when it
  gives them; otherwise from the class and the level: `readOnlyHint: true` only for a read
  of level 1 with no cost and no traffic to the target; otherwise `readOnlyHint: false`,
  `destructiveHint` for a deletion, `openWorldHint` for traffic to the target or an effect outside
  LoadCraft. A tool only a person may approve carries `_meta['anthropic/requiresUserInteraction']`:
  when the catalog says so (`requires_user_interaction`), and whatever it says for a deletion and for
  traffic to the target or an effect outside LoadCraft (today's tools of that kind carry it, and a
  tool that takes over one must not drop it); with no word of the catalog, a tool with a cost too;
- the input is the module's shape as a strict object (an unknown argument is refused) with
  `format` added: `"text"` is the view, `"data"` the data as one JSON block (the mod reads it);
- a spec with only `title` and `input` is a scaffold: registered, a call answers
  `not_implemented`, and **the server does not offer it** in `tools/list` (`exposedTools`). A spec
  with `run` and `render` is written, and offered;
- **fail-closed on consent:** `run` is accepted, by the type of the catalog entry and again at run
  time, only for a tool that never asks (level 1, no other level by argument, no escalation to
  level 3). This layer draws no consent card, so a tool that asks would otherwise write without
  one; it stays a scaffold, not offered, until the card mechanism exists.

`test/genTools/contract.test.ts` checks every tool of every module against the catalog on disk:
the module, the description, the annotations, the marker, the level, the card and log templates,
the undo, the operations, the arguments (exactly the catalog's names and `format`; optional exactly
when the state gives a default), the strict input, and the live `tools/list` of the server. It also
checks that no offered tool of a module asks for consent, that a module never shadows a tool of
today's registry nor takes over one still registered (the migration map: the new tool waits until
the one it replaces leaves the registry), and that a module's dictionary keeps to its keys.

## Adding a tool, step by step

All commands run from `mcp/`.

### 1. Scaffold it

```bash
npm run gen:tools -- --scaffold project_list_notes
```

It writes `src/tools/project/listNotes.ts`, `test/tools/project/listNotes.test.ts` and adds the tool
to `src/tools/project/index.ts`. It refuses a name the catalog lacks, a file that exists, a tool
today's registry already has (`flows_get`: that one is adapted where it is) and a tool that takes
over one of today's still registered (by the migration map of the catalog).

The scaffold holds a fixed header (the description, the log template and, for a level 2 or 3 tool,
the card template it must fill), a reader per operation of the entry, typed by the client
generated from the contract, and the input:

```ts
/** GET /projects/{project_id}/agent-guidance (REST API v1) */
export function listAgentGuidance(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'list_agent_guidance_api_v1_projects__project_id__agent_guidance_get'>> {
  return callBackend(ctx, 'list_agent_guidance_api_v1_projects__project_id__agent_guidance_get', {
    path,
  });
}

export const projectListNotes = moduleTool(PROJECT_LIST_NOTES, {
  title: 'List the notes the agent learned about the project',
  input: {},
});
```

The path parameters are written out with the types the contract has now: when the client changes
them, the reader no longer compiles. A query or a body is typed by the client (`QueryOf<…>`,
`BodyOf<…>`). The arguments are exactly the catalog's `arguments`: their names, types, bounds
(`enum`, `min`, `max`, `max_length`, `max_items`), `default` and `doc` (the description); required
when the catalog marks them `required: true` (a catalog that marks none: when the state gives no
default, `from_state`). An entry with
none (`project_list_notes`) takes none but `format`, and its header says so: an argument the tool
needs is added to the catalog first and the tool scaffolded again, never chosen in the module. The
project comes from the workspace (`projectIdOf`).

Run its test: `npx vitest run test/tools/project/listNotes.test.ts` passes, with the case
"registered and not implemented yet".

### 2. Write the test first

Replace the "not implemented" case with the cases of the tool, against the fake backend (a real
HTTP server, `test/helpers/rig.ts`). Keep the first case (`expectCatalogEntry`). A read covers at
least: the full answer, the empty one, a 404, a text of the backend with control sequences and line
breaks, a secret in a text, `format: "data"`, the Polish view, the log entry (its result template
filled) and the number of requests. Run it: it fails, the tool still answers `not_implemented`.

```ts
it('lists the notes of the bound project, each with what it applies to, in one request', async () => {
  const r = await rig();
  const result = await r.call('project_list_notes', {});
  expect(result.text).toBe(
    [
      '2 notes about the project:',
      '1. [page /checkout] Accept the cookie banner before the first form.',
      '2. [step "Log in"] The login form asks for the e-mail first, the password on the next screen.',
    ].join('\n'),
  );
  expect(notesCalls(r).map((call) => call.path)).toEqual([
    `/api/v1/projects/${SKLEP_IDS.project}/agent-guidance`,
  ]);
});
```

The whole file is `test/tools/project/listNotes.test.ts`.

### 3. Give the fake backend the route

Look first: `grep -rn "'/api/v1/projects/{project_id}/agent-guidance'" test/fake-backend`. A route
another file registers is used as it is (register that file's routes in the test); registering it
twice fails (`routes/index.test.ts`). A new route goes to `test/fake-backend/routes/<module>.ts`,
with an idempotent registrar; a new file adds one call to `routes/index.ts`. For `flows`, `results`
and `data` that file exists already, with the routes of today's tools: add to it. The fake checks every
answer against the contract, so the shapes are the contract's (`components['schemas'][…]`).

```ts
const registered = new WeakSet<Fake>();

export function registerProjectModuleRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  fake.route('GET', '/api/v1/projects/{project_id}/agent-guidance', (req, store) => {
    const projectId = req.params.project_id;
    store
      .collection<{ id: string }>(SKLEP_COLLECTIONS.projects)
      .require(projectId, `Project not found: ${projectId}`);
    const notes = store
      .collection<StoredNote>(PROJECT_NOTES)
      .list((note) => note.project_id === projectId)
      .map((note) => note.entry);
    return { status: 200, body: notes };
  });
}
```

Data the test needs goes in through a seeding function of the same file (`seedProjectNotes`), not
into the shared world of `test/fake-backend/worlds/`.

### 4. Write the view and its texts

The view (`src/render/project/listNotes.ts`) exports the type of the data and `render(data, t)`.
It draws only what the data holds; every text of the backend arrives there already made one line.

```ts
export function renderListNotes(data: NotesData, t: Translator): string {
  if (data.count === 0) return t('project_list_notes.empty');
  const lines = [t.plural('project_list_notes.header', data.count)];
  data.notes.forEach((note, index) => {
    lines.push(`${String(index + 1)}. [${scopeOf(note, t)}] ${note.text}`);
  });
  if (data.shown < data.count) {
    lines.push(t('project_list_notes.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
```

The texts go to `src/render/i18n/project.en.ts` and `project.pl.ts`, keys starting with the name of
the tool. The Polish file is typed by the English one: a missing or an extra key does not compile.

```ts
export const projectEn = {
  'project_list_notes.header': {
    one: '{count} note about the project:',
    other: '{count} notes about the project:',
  },
  'project_list_notes.empty':
    'No notes about this project yet: the agent saves them while it walks the application.',
  // …
} as const satisfies Readonly<Record<string, Entry>>;
```

### 5. Write `run` and `render`

```ts
export const projectListNotes = moduleTool(PROJECT_LIST_NOTES, {
  title: 'List the notes the agent learned about the project',
  // the catalog names no arguments: the project is the one this workspace works on
  input: {},
  async run(ctx) {
    const projectId = projectIdOf(ctx, undefined);
    const entries = await listAgentGuidance(ctx, { project_id: projectId });
    const notes = entries.slice(0, NOTES_SHOWN).map((entry) => noteOf(ctx, entry));
    const data: NotesData = {
      project_id: projectId,
      count: entries.length,
      shown: notes.length,
      notes,
    };
    return { status: 'done', data };
  },
  render: renderListNotes,
});
```

The rules a written tool keeps:

- **Arguments from the state.** `projectIdOf(ctx, args.project_id)` (or `undefined` when the catalog
  names no `project_id`): the argument, else the bound project, else `ids.project_id`, else
  `no_project`. `idOf(ctx, 'walk_id', args.walk_id,
'ids.walk_id')`: the argument, else the state, else `missing_argument`. `fromState(ctx, path)`
  reads any other default (`choices.run.compare_to`).
- **Only the generated client.** Every request goes through the readers of the file
  (`callBackend`). No `fetch`, no `src/api/*` (`test/architecture.clients.test.ts`).
- **Secrets.** `callBackend` registers with the scope of the call the fields the contract and
  `contracts/secret-fields.json` mark and every field whose name says it is a secret, before the
  answer is returned; the registry masks them in every output. A text the target or a third party
  wrote (a note, a log line, a page, an error of the application) goes through `content(ctx,
text, max)`: the known secrets out, then the shapes of secrets masked, then one line. A recorded
  body goes through `body(ctx, text, type)`: shown masked, or hidden whole when the mask cannot
  read its format. Any other text of the backend goes through `inline()` before a view prints it.
  The sentinel cases of a module carry, in every free text, a credential only the mask finds by
  its shape: a text printed without `content` fails them.
- **Errors.** Prefer a code that exists (`not_found`, `invalid`, `missing_argument`). A new code
  of a module starts with the module (`project_notes_unreadable`): its texts
  (`error.project_notes_unreadable.message`, `.hint`) go to the module's dictionary
  (`project.en.ts`, `project.pl.ts`) and its row to the module's table,
  `skills/loadcraft-test/references/errors-project.md` (`npm run gen:tools` created it). No shared
  file is touched: `en.ts`, `pl.ts` and `errors-and-resume.md` (held to 150 lines, full) keep the
  codes every tool shares. `tests/playbook-skill.spec.ts` checks both tables in both directions.
- **Handles.** A tool of a module may turn a handle of a run (`e-1a2b3c4d`) into its id with
  `createResolver` (`src/resolve/handles.ts`); it reads through the hand-written lookups, so the
  project still comes from `projectIdOf` and every other request from the readers of the file:

  ```ts
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const runId = idOf(ctx, 'run_id', args.run_id, 'ids.run_id');
    const { id: executionId } = await createResolver(ctx).execution(projectId, runId);
    const groups = await getExecutionErrors(ctx, { project_id: projectId, execution_id: executionId });
    // …
  },
  ```

- **The log.** The registry writes the entry from the catalog's templates: the data (or
  `update.log.values`) must carry the fields the templates name (`{count}` here). `update.log.values`
  win over a field of the same name in the arguments and the data (a handle for the UUID the data
  carries, a rounded number), so the data never has to bend to the log. A value that fills a slot of
  the result other than the data of the same name fails the call under the tests; a number shown with
  fewer digits (`410` for `410.3`) is the same value. A read has no `undo`.
- **The state.** What the tool writes to the state (`state_writes` of the entry) goes in the
  `update` of its outcome; a tool never writes the state file.
- **Long lists.** The catalog's `views` (`meta.views`: a page of items, a `ref` to the full list)
  apply once the state schema in the repository defines their item types; until then cap the data
  and say how many there are (`shown` of `count`), as here.
- **Writes and costs.** `moduleTool` draws no consent card, so it takes `run` only for a tool that
  never asks; a tool of level 2 or 3, or of level 1 that asks by argument or escalates, stays a
  scaffold (the type refuses its `run`) until the card mechanism exists.

Run the test again: it passes. `expect(projectListNotes.implemented).toBe(true)` and the contract
test now find the tool in `tools/list`.

### 6. Add its sentinel case

`test/tools/<module>/canary.ts` exports `CANARY_CASES`; the sentinel suite
(`test/security/canary.*.test.ts`) finds the file and taints every answer of the fake backend with
secrets that must not reach the model.

```ts
export const CANARY_CASES: readonly Case[] = [
  {
    tool: 'project_list_notes',
    label: 'notes of the bound project',
    stage: 'project',
    args: () => ({}),
    setup: (fake) => {
      seedProjectNotes(fake.store, SKLEP_IDS.project, [
        { text: 'Accept the cookie banner first.', scope: { kind: 'url_path', url_path: '/' } },
      ]);
    },
  },
];
```

### 7. Pin the surface and check

```bash
npm run update:surface                       # writes test/fixtures/surface/<module>.json
npm run update:shared                        # writes the lists of step 8
npx vitest run test/tools/project test/genTools/contract.test.ts test/surface.baseline.test.ts
npx vitest run test/security -t project_list_notes
npm run lint && npm run typecheck && npm run check:catalog
npm run build && npm run check:dist          # dist/ goes into the commit
```

### 8. Name it where every offered tool is named

A tool the server offers is listed outside `mcp/` as well; the tests of the package and of the
skills fail until it is. Two lists are written by `npm run update:shared`, never by hand
(`test/sharedLists.test.ts` fails while one differs; after a merge, run it again):

- `evals/mocks/lc/_tools.json`: the `tools/list` of the server, sorted by name;
- the permission blocks of `docs/plugin/INSTALL.md` and `INSTALL.pl.md`, between their markers: a
  tool of a module is in both variants when the catalog allows it at install (`install_allow`) and
  it is a read only (`readOnlyHint`), in variant B only when it is allowed at install but writes
  (files of the workspace included) or when it is a write that stays inside LoadCraft, and named in
  the generated sentence of the tools left out otherwise; today's tools keep their entries as
  written.

One is written by hand: a skill file of `skills/loadcraft-test` (or `loadcraft-status`,
`loadcraft-doctor`) names the tool in backticks where its use is described
(`tests/playbook-skill.spec.ts`). Add one sentence, never reorder the file.

## Moving a tool of today onto modules

Today's tools (`LEGACY_TOOLS` of `src/tools/index.ts`) keep their registration. Moving one into
its module is one change: delete it from `LEGACY_TOOLS`, write it as `moduleTool(<ENTRY>, …)` in
`src/tools/<module>/<object>.ts`, add it to the module's `index.ts`, move its pinned entry from
`test/fixtures/surface-baseline.json` to `test/fixtures/surface/<module>.json` and its sentinel
cases to `test/tools/<module>/canary.ts`. Its description and annotations become the catalog's and
its input becomes strict, with `format`; its argument names stay as they are unless the catalog
names them. The contract test then holds it to the catalog like any other tool of the module.
