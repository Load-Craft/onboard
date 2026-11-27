# Recipe template LIST_OR_OBJECT

Use it in steps 10 and 11 when step 2 printed `template   LIST_OR_OBJECT`.
The tool has two modes. The selector is the argument step 2 printed under `selector`.
Selector left out: the list. Selector given: one object.

Open `docs/recipe/templates/read.md` and `docs/recipe/templates/read-object.md`. Write both, in the same files:

- One tool file, one view file, one test file, one contract. Not two of anything.
- The data is a union with a `mode` field:

```ts
export type <Object>Data =
  | { readonly mode: 'list'; readonly project_id: string; readonly <plural>: Page<<Item>> }
  | { readonly mode: 'one'; readonly project_id: string; readonly <singular>: <One> };
```

- `run` branches once, after the rules and the project:

```ts
if (args.<selector> === undefined) {
  // the list: the code of read.md, steps 3 to 5
  return { status: 'done', data: { mode: 'list', ... }, update: { log: { values: { count: list.count } } } };
}
// one object: the code of read-object.md, steps 3 to 5
return { status: 'done', data: { mode: 'one', ... }, update: { log: { values: { count: 1 } } } };
```

- The view branches once: `return data.mode === 'list' ? listLines(data, t) : oneLines(data, t);`
- A log slot named `count`: the count of the list, or `1` for one object.

## The selector

| Its catalog type           | Do                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uuid`, `integer`          | pass it to the reader of one object                                                                                                                                         |
| `uuid\|default`            | the word `default`: the reader the brief names for it; a UUID: the reader of one object                                                                                     |
| `string` (an id or a name) | `isUuid(value)`: the reader of one object. Else: read the list, `pickNamed(ctx, t('<tool_name>.kind'), value, items)`, then the reader of one object with the id it returns |

`pickNamed` throws `not_found` and `ambiguous` itself. Add the key `<tool_name>.kind` to both dictionaries: the word for one object (`template`, `szablon`).

## Rules

- An argument that works only for the list, given together with the selector: `refuseRule('<object>_not_with')`.
- An argument that has a default in the catalog (step 2 does not show defaults: read the scaffolded `input`) is never in a rule. The tool cannot see whether it was given. In the one-object mode ignore it.
- The brief asks for a rule on an argument with a default: STOP `S-04`.

## Tests

The cases of LIST and the cases of OBJECT from `docs/recipe/templates/tests.md`, all in the one test file. Add: the selector as a name in another letter case; a name that matches nothing (`[not_found]`); a name that matches two (`[ambiguous]`).

## Not this template

The brief describes three or more modes (a `view` argument with several values): STOP `S-08`.
