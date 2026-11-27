# Recipe example: `project_update` (SET)

Open it only when a line of `docs/recipe/templates/write.md` or `tests.md` is unclear.
The tool file and the view of this example are in `docs/recipe/templates/write.md`. Here is the rest.

## The brief

```
Tool: project_update. Follow mcp/docs/tool-recipe.md, steps 1 to 20.
Read plan: GET /api/v1/projects/{project_id} read before the write; PUT /api/v1/projects/{project_id} the write.
Fields (data field <- answer field: origin class):
  project_id <- the bound project: id
  name <- name (after the call): third-party, LIMITS.name
  description <- description (after the call): third-party, LIMITS.sentence, nullable
SET only: fields compared and sent: name, description. Undo arguments: the previous values of name, description.
View (English):
  Project "shop-2" updated: name, description.
  nothing differs: "shop": nothing to change, the values are already as given.
Rules: at_least_one name, description.
State update: none.
Skill: skills/loadcraft-test/references/step-02-project.md, heading "Writes".
Tests: stage project; records to seed: none (the project of the world).
```

## The texts (step 6)

`src/render/i18n/project.en.ts`, then `project.pl.ts`:

```ts
  'project_update.header': 'Project {name} updated: {fields}.',
  'project_update.unchanged': '{name}: nothing to change, the values are already as given.',
  'project_update.field.name': 'name',
  'project_update.field.description': 'description',
  'project_update.undo_withheld':
    'This change cannot be undone from the log: a previous value holds a secret.',
```

```ts
  'project_update.header': 'Projekt {name} zmieniony: {fields}.',
  'project_update.unchanged': '{name}: nic do zmiany, wartości są już takie, jak podano.',
  'project_update.field.name': 'nazwa',
  'project_update.field.description': 'opis',
  'project_update.undo_withheld':
    'Tej zmiany nie da się cofnąć z dziennika: poprzednia wartość zawiera sekret.',
```

The rule key, in `src/render/i18n/en.ts`, then `pl.ts`:

```ts
  'error.invalid_arguments.rule.update_at_least_one': 'pass at least one of: name, description',
```

```ts
  'error.invalid_arguments.rule.update_at_least_one': 'podaj co najmniej jeden z: name, description',
```

## Test cases (step 8)

```ts
const projects = (fake: Fake) =>
  fake.store.collection<{ id: string; name: string }>(SKLEP_COLLECTIONS.projects);
const stored = (r: ToolRig) => projects(r.fake).get(PROJECT)?.name;
const writes = (r: ToolRig) => r.fake.calls.filter((call) => call.method === 'PUT');

it('renames the project: one read, one write with the name only, the object holds it', async () => {
  const r = await rig();
  const result = await r.call('project_update', { name: 'shop-2' });
  expect(result.text).toBe('Project "shop-2" updated: name.');
  expect(writes(r)).toHaveLength(1);
  expect(writes(r)[0]?.body).toEqual({ name: 'shop-2' });
  expect(stored(r)).toBe('shop-2');
});

it('writes nothing when the values are already as given: no PUT, no undo', async () => {
  const r = await rig();
  const result = await r.call('project_update', { name: stored(r) });
  expect(result.text).toContain('nothing to change');
  expect(writes(r)).toEqual([]);
  expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
});

it('refuses a call with neither name nor description before any request', async () => {
  const r = await rig();
  const result = await r.call('project_update', {});
  expect(result.text).toMatch(/^\[invalid_arguments\] /u);
  expect(r.fake.calls.filter((call) => call.path.startsWith('/api/v1/projects'))).toEqual([]);
});

it('the undo of the log entry restores the object', async () => {
  const r = await rig();
  const before = stored(r);
  const undo = await expectUndoRestores(
    r,
    { tool: 'project_update', args: { name: 'shop-2' } },
    () => stored(r),
  );
  expect(undo).toMatchObject({ tool: 'project_update', args: { name: before } });
});

it('writes the log entry from the catalog templates', async () => {
  const r = await rig();
  await r.call('project_update', { name: 'shop-2' });
  expect(loggedCalls(r).at(-1)).toMatchObject({
    tool: 'project_update',
    status: 'ok',
    args: 'shop-2',
    result: 'name',
  });
});
```

## The skill sentence (step 14)

```
- Update a project's name or description: `project_update`.
```
