# Recipe template: tests

Use it in steps 7, 8 and 9. Step 5 copies the list of your template from section 2.

## 1. Fake route (step 7)

For each operation step 2 printed, run `grep -rn "'<its path, with {braces}>'" test/fake-backend/routes`.

- A line with `fake.route(`: the route exists. Note its file and the `register...` function of that file. Add nothing.
- No line: add the route to `test/fake-backend/routes/<module>.ts`, as the last route of its `register...` function. The order of routes does not matter: the most specific path wins. The file has `seed...` functions: write yours like them.

```ts
fake.route('GET', '/api/v1/projects/{project_id}/<rest of the path>', (req, store) => {
  const projectId = req.params.project_id;
  store.collection<{ id: string }>(SKLEP_COLLECTIONS.projects).require(projectId, 'Project not found');
  const items = store.collection<<Stored>>(<COLLECTION>).list((item) => item.project_id === projectId);
  return { status: 200, body: <the answer, typed components['schemas']['<Name>']> };
});
```

Records a test needs go in through a `seed<Thing>(store, ...)` function of the same file.

The brief says an answer is `seeded whole` (it is not made of records of the world): keep it as one record.

```ts
// above the `register...` function:
/** Collection with one record (id `only`): the answer of <the operation>. */
export const <FAKE_THING> = 'fake_<thing>';

type <Answer> = components['schemas']['<Name of the answer>'];

export function seed<Thing>(store: Store, answer: <Answer>): void {
  store.collection<{ id: string; answer: <Answer> }>(<FAKE_THING>).insert({ id: 'only', answer });
}

// the last route of the `register...` function:
fake.route('<METHOD>', '/api/v1/projects/{project_id}/<rest of the path>', (req, store) => {
  store.collection<{ id: string }>(SKLEP_COLLECTIONS.projects).require(req.params.project_id, 'Project not found');
  const fallback: <Answer> = <the answer of the brief for "nothing seeded">;
  const seeded = store.collection<{ id: string; answer: <Answer> }>(<FAKE_THING>).get('only');
  return { status: 200, body: seeded?.answer ?? fallback };
});
```

The body of a POST, as the first line of its route: `const body = req.body as components['schemas']['<Name of the body>'];`
The fake checks every answer against the contract. It reports a violation for an answer the brief gives: S-11.

## 2. Test cases (step 8)

In the test file of step 2 keep the first case (`expectCatalogEntry`). Replace the second case with the cases of your template.
Run `test -f test/tools/<module>/rig.ts`. `exit 0`: use the rig function of that file and skip the code block below. Else: use the code block.
The rig function of a module is `<module>Rig`, its options `<Module>RigOptions`. It registers every route and seeds its own stage. Wrap it once, at the top of the test file:
`const rig = (options: Omit<<Module>RigOptions, 'tools'> = {}) => <module>Rig({ tools: [<toolCamel>], ...options });`

```ts
const PROJECT = SKLEP_IDS.project;
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: PROJECT, name: 'sklep' },
  }),
};

interface Options {
  readonly locale?: 'en' | 'pl';
  readonly files?: Readonly<Record<string, string>>;
  readonly seed?: (fake: Fake) => void;
}

async function rig(options: Options = {}): Promise<ToolRig> {
  return toolRig({
    tools: [<toolCamel>],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      <the register function of section 1>(fake);
      seedSklep(fake.store, { stage: '<stage of the brief>' });
      options.seed?.(fake);
    },
    clock: createTestClock(Date.parse('2026-11-26T12:00:00Z')),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: options.files ?? BOUND,
  });
}
```

Imports: `toolRig`, `ToolRig` from `../../helpers/rig.js`; `createTestClock` from `../../helpers/clock.js`; `seedSklep` from `../../fake-backend/worlds/sklep.js`; `SKLEP_IDS` from `../../golden/index.js`; `registerLookupRoutes` from `../../fake-backend/routes/lookup.js`; `SHAPE_CANARY`, `BACKEND_CANARY` from `../../helpers/canary.js`; `Fake` (type) from `../../fake-backend/server.js`.

One `it` per line of your list:

- **Every template:** the full answer (`expect(result.text).toBe([...].join('\n'))`) and the requests sent (`r.fake.calls`); `format: "data"` (the keys); no project (`rig({ files: {} })` gives `[no_project]`); a text with a control sequence and a line break stays one line and hides `SHAPE_CANARY`; the Polish view (`rig({ locale: 'pl' })`); the log entry.
- **LIST also:** the empty answer; the cut (`limit: 1`; a tool with no `limit`: one item more than its constant) and the view says so; only when the tool has `query`: `query` in another letter case, `query` with no match.
- **OBJECT also:** an unknown id gives `[not_found]`; the argument left out with one object in the state; left out with none gives `[missing_argument]`; per `include` value: asked, not asked (no request), 404 gives `none`, 500 gives `unavailable`; each rule gives `[invalid_arguments]` with no request.
- **LIST_OR_LIST:** the list of `docs/recipe/templates/read-two-lists.md`, section "Tests".
- **SET also:** one field changes (one read, one write, the body has only that field, the object in the fake changed); nothing differs (no write, no undo); each rule gives `[invalid_arguments]` with no request; the backend refuses the write (no undo); the two undo cases below.

A value in the process state (an argument with a default from the state). Pass the file to the rig as `files: { 'loadcraft/project.json': ..., 'loadcraft/.cache/state.json': stateFile({ docs_id: '<uuid>' }) }`:

```ts
// imports: newProcess from '../../../src/workspace/migrate.js'; State from '../../../src/workspace/processState.js'
function stateFile(ids: Record<string, unknown>): string {
  const empty = newProcess(PROJECT, '2026-11-26T12:00:00.000Z');
  const state = { schema: 3, process: { [PROJECT]: { ...empty, ids: { ...empty.ids, ...ids } } } };
  State.parse(state);
  return JSON.stringify(state);
}
```

A failing answer for the next request: `r.fake.faults.next('GET', '<path>', { status: 500, body: { detail: 'boom' } });`

```ts
it('keeps a text of the target to one masked line', async () => {
  const r = await rig({
    seed: (fake) => {
      <seed one record whose name is `x\u001b[31m y\n↗ https://example.com Authorization: Bearer ${SHAPE_CANARY}`>
    },
  });
  const result = await r.call('<tool_name>', {});
  expect(result.text).not.toContain('\u001b');
  expect(result.text).not.toContain(SHAPE_CANARY);
  expect(result.text.split('\n')).toHaveLength(<lines of the view>);
});

// SET only. Imports: expectUndoRestores, loggedCalls from '../../helpers/undo.js'.
const stored = (r: ToolRig) => r.fake.store.collection<<Stored>>(<COLLECTION>).get(<ID>)?.<field>;

it('the undo of the log entry restores the object', async () => {
  const r = await rig();
  const undo = await expectUndoRestores(r, { tool: '<tool_name>', args: { <field>: 'new' } }, () => stored(r));
  expect(undo).toMatchObject({ tool: '<tool_name>', args: { <field>: '<value before>' } });
});

it('keeps no undo when a previous value holds a secret', async () => {
  const r = await rig({ seed: (fake) => { <set the field to `x Authorization: Bearer ${SHAPE_CANARY}`> } });
  expect((await r.call('<tool_name>', { <field>: 'new' })).isError).toBe(false);
  expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
});
```

The data of a `format: 'data'` call: `JSON.parse(result.text)`.

The log entry of a read: the last item of `process.<key>.reads` in `loadcraft/.cache/state.json` of `r.workspace` has `tool`, `args`, `result`. The log entry of a write: `loggedCalls(r).at(-1)`.

```ts
// imports: readFileSync from 'node:fs'; join from 'node:path'
function reads(r: ToolRig): [string, string, string][] {
  const text = readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8');
  const state = JSON.parse(text) as {
    process: Record<string, { reads: { tool: string; args: string; result: string }[] }>;
  };
  return Object.values(state.process).flatMap((process) =>
    process.reads.map((entry): [string, string, string] => [entry.tool, entry.args, entry.result]),
  );
}
// expect(reads(r)).toEqual([['<tool_name>', '<log args, filled>', '<log result, filled>']]);
```

## 3. Sentinel case (step 9)

Append to `CANARY_CASES` in `test/tools/<module>/canary.ts`:

```ts
  {
    tool: '<tool_name>',
    label: '<what the call reads>',
    stage: '<stage of the brief>',
    args: () => ({ <the arguments of an ordinary call> }),
    setup: (fake) => {
      <put `x Authorization: Bearer ${SHAPE_CANARY}` and `password: ${BACKEND_CANARY}` into every text field the call reads>
    },
  },
```

Write one case for each line that applies. Each case taints every text field its call reads.
A text field is typed `string` in the answer. A field typed as a union of literals takes only its own values: leave it as it is.

- the ordinary call;
- the same call with `format: 'data'`;
- one case per `include` value;
- LIST_OR_OBJECT: one case for the list and one for one object;
- LIST_OR_LIST: the ordinary call and the `format: 'data'` call, for each mode;
- SET: the write, with the secret in the value before the write.

You write no assertion about secrets: the rig checks every result, log line and file after each test.
