# Recipe: mode A

Use it when step 1 prints `MODE A`. The steps stay. Replace the left side with the right side.

| Mode B                                                                                       | Mode A                                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `from '../kit/transitional.js'`                                                              | `from '../kit/index.js'`                                                                          |
| `from '../../tools/kit/transitional.js'` (in a view)                                         | `from '../kit/index.js'` (the folder `src/render/kit/`)                                           |
| `moduleTool(<META>, { title, input, run, render })`                                          | `moduleTool(<META>_DEF, { run, render })`                                                         |
| readers written in the tool file                                                             | `import { <reader> } from './ops.generated.js'`                                                   |
| `refuseRule('<key>')` and section 3 of `texts.md`                                            | nothing: the rules are in the definition                                                          |
| `projectIdOf(ctx, undefined)`                                                                | `refs.project()`, after `const refs = refsOf(ctx, <META>_DEF, args)`                              |
| `refId(ctx, '<argument>', args.<argument>, '<path>')`                                        | `refs.id('<argument>')`                                                                           |
| `await runOf(ctx, projectId, args.<argument>)`                                               | `await refs.run('<argument>')`                                                                    |
| section 4 of `texts.md` (hint keys)                                                          | skip it                                                                                           |
| `return { status: 'done', data, update: { log: { values } } }`                               | `return done(<META>_DEF, data, { log: { <every slot of the result> } })`                          |
| `applyChange(ctx, { ... })` and `undo_args` written by hand                                  | `applyChange(ctx, <META>_DEF, { ... })` and `done(..., { change })`                               |
| fields typed `string`                                                                        | the types the mask functions return: `Shown`, `Word`, `Uuid`, `RunHandle`, `IsoInstant`           |
| `partLines(t, '<module>', label, part, lines)`; keys `.more`, `.cut`, `.no_match`, `.part.*` | `partLines(t, label, part, lines)`, `listView(...)` from `src/render/kit/`; do not add those keys |
| verbs `export`, `save`, `duplicate`, `merge`, `apply`: S-08                                  | open the template file that `node scripts/recipe-entry.mjs` names                                 |
