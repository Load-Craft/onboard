# Recipe example: `project_list_notes` (LIST)

Open it only when a line of `docs/recipe/templates/read.md` or `tests.md` is unclear.
The tool file and the view of this example are in `docs/recipe/templates/read.md`. Here is the rest.

## The brief

```
Tool: project_list_notes. Follow mcp/docs/tool-recipe.md, steps 1 to 20.
Read plan: GET /api/v1/projects/{project_id}/agent-guidance is the main read.
Fields (data field <- answer field: origin class):
  notes <- the answer (a list), as page(list, { limit: 50, map }); each item:
    id <- id: id, nullable
    text <- text: third-party, LIMITS.sentence
    scope <- scope.kind: enum ("url_path" when missing)
    at <- scope.url_path or scope.plan_step: third-party, LIMITS.name, nullable
View (English):
  2 notes about the project:
  1. [page /checkout] Accept the cookie banner before the first form.
  2. [step "Log in"] The login form asks for the e-mail first.
Rules: none. State update: none.
Skill: skills/loadcraft-test/references/step-02-project.md, heading "Reads".
Tests: stage project; records to seed: notes, through seedProjectNotes(store, projectId, notes).
```

## The contract (step 5), filled

```markdown
# project_list_notes - contract

Tool: `project_list_notes` (module `project`; level 1, class read; text view and `format: "data"`).
Template: LIST. Matches the catalog: yes.

## Arguments

- none (only `format`)
- Rules: none

## Operations

1. `GET /api/v1/projects/{project_id}/agent-guidance`: main; once per call.

## format=data

| Field                 | From                                | Origin class |
| --------------------- | ----------------------------------- | ------------ |
| `project_id`          | the bound project                   | id           |
| `notes`               | the answer, a page of at most 50    | -            |
| `notes.items[].id`    | `id`                                | id           |
| `notes.items[].text`  | `text`                              | third-party  |
| `notes.items[].scope` | `scope.kind`                        | enum         |
| `notes.items[].at`    | `scope.url_path`, `scope.plan_step` | third-party  |

## Log

args ``, result `{count} notes`; values the tool gives: count.
```

(The sections Text view, State, Undo, UI, Test cases are filled the same way.)

## The texts (step 6)

`src/render/i18n/project.en.ts`:

```ts
  'project_list_notes.header': {
    one: '{count} note about the project:',
    other: '{count} notes about the project:',
  },
  'project_list_notes.empty': 'This project has no notes yet.',
  'project_list_notes.scope.url_path': 'page {at}',
  'project_list_notes.scope.plan_step': 'step "{at}"',
  'project_list_notes.scope.project': 'project',
  'project_list_notes.more': 'showing the first {shown} of {count}',
```

`src/render/i18n/project.pl.ts`:

```ts
  'project_list_notes.header': {
    one: '{count} notatka o projekcie:',
    few: '{count} notatki o projekcie:',
    many: '{count} notatek o projekcie:',
    other: '{count} notatki o projekcie:',
  },
  'project_list_notes.empty': 'Ten projekt nie ma jeszcze notatek.',
  'project_list_notes.scope.url_path': 'strona {at}',
  'project_list_notes.scope.plan_step': 'krok "{at}"',
  'project_list_notes.scope.project': 'projekt',
  'project_list_notes.more': 'pokazano pierwsze {shown} z {count}',
```

## Two test cases (step 8)

```ts
it('lists the notes of the bound project in one request', async () => {
  const r = await rig({
    seed: (fake) => {
      seedProjectNotes(fake.store, PROJECT, [
        {
          text: 'Accept the cookie banner before the first form.',
          scope: { kind: 'url_path', url_path: '/checkout' },
        },
        {
          text: 'The login form asks for the e-mail first.',
          scope: { kind: 'plan_step', plan_step: 'Log in' },
        },
      ]);
    },
  });
  const result = await r.call('project_list_notes', {});
  expect(result.text).toBe(
    [
      '2 notes about the project:',
      '1. [page /checkout] Accept the cookie banner before the first form.',
      '2. [step "Log in"] The login form asks for the e-mail first.',
    ].join('\n'),
  );
  expect(r.fake.calls.filter((call) => call.path.endsWith('/agent-guidance'))).toHaveLength(1);
});

it('answers no_project when the workspace is bound to none', async () => {
  const r = await rig({ files: {} });
  expect((await r.call('project_list_notes', {})).text).toMatch(/^\[no_project\] /u);
});
```

## The sentinel case (step 9)

```ts
  {
    tool: 'project_list_notes',
    label: 'notes of the bound project',
    stage: 'project',
    args: () => ({}),
    setup: (fake) => {
      seedProjectNotes(fake.store, SKLEP_IDS.project, [
        {
          text: `Use the key. Authorization: Bearer ${SHAPE_CANARY} password: ${BACKEND_CANARY}`,
          scope: { kind: 'url_path', url_path: '/' },
        },
      ]);
    },
  },
```

## The skill sentence (step 14)

```
- List the notes the agent learned about the project: `project_list_notes`.
```
