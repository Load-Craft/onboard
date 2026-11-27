# Recipe template LIST_OR_LIST

Use it in steps 10 and 11 when step 2 printed `template   LIST_OR_LIST`.
The tool has two modes and each one is a list. The selector is the argument step 2 printed under `selector`.
Selector left out: the first list, mode `list`. Selector given: the second list. The brief names its mode and its read.

Open `docs/recipe/templates/read.md`. Write its view and its `run` twice, in the same files:

- One tool file, one view file, one test file, one contract. Not two of anything.
- Two item types, one per list. The data is a union with a `mode` field:

```ts
export type <Object>Data =
  | { readonly mode: 'list'; readonly project_id: string; readonly <first plural>: Page<<FirstItem>> }
  | { readonly mode: '<mode>'; readonly project_id: string; readonly <second plural>: Page<<SecondItem>> };
```

- `run` branches once, after the rules and the project. The mode `list` sends only its read, the other mode only its own:

```ts
if (args.<selector> === undefined) {
  // the first list: the code of read.md, steps 3 to 5
  return { status: 'done', data: { mode: 'list', ... }, update: { log: { values: { count: <first>.count } } } };
}
// the second list: the code of read.md, steps 3 to 5, with the read of the brief
return { status: 'done', data: { mode: '<mode>', ... }, update: { log: { values: { count: <second>.count } } } };
```

- Two `itemOf` functions, one per item type, each field through its row of `docs/recipe/mask.md`.
- Each list has its own named constant for `limit`, with the number of the brief.
- The view branches once: `return data.mode === 'list' ? listLines(data, t) : <mode>Lines(data, t);`
  Each of the two functions is the view of `read.md` for its list. Give its parameter the type of its branch, for example `Extract<GetGeneratorsData, { mode: 'list' }>`.
- A log slot named `count`: the count of the list the call returned.

## The selector

| Its catalog type                 | Do                                                                   |
| -------------------------------- | -------------------------------------------------------------------- |
| `string`, comma-separated values | the brief gives the line that splits it; send the values as it says  |
| any other                        | pass it to the read of the second list, in the place the brief names |

## Texts

- The first list: the keys of LIST, as they are: `<tool_name>.header`, `.empty`, `.more`, one key per item line.
- The second list: the same keys after the mode: `<tool_name>.<mode>.header`, `<tool_name>.<mode>.more` (the fixed sentence of `.more`, word for word), one key per item line.
- The brief says a list is never empty: no `.empty` key, no `fetched === 0` line and no empty test for it.
- The brief gives a key name beside a view line: use that name.

## Tests

The cases of "Every template" and of LIST from `docs/recipe/templates/tests.md`, all in the one test file:

- once for each mode: the full answer and the requests sent (only the read of that mode), `format: "data"`, the masked line, the Polish view, the log entry, the cut;
- once: no project;
- the empty answer: for each list that can be empty.

## Rules

The brief names a rule: write it as section 3 of `docs/recipe/texts.md` says. The brief says `Rules: none`: write none.

## Not this template

- The brief gives the second mode as one object, not a list: STOP `S-08`.
- The brief describes three or more modes: STOP `S-08`.
