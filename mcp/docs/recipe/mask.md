# Recipe: which mask for a field

Use it in step 10, once for every field of the data.

1. The field table of the brief gives the origin class: use that row.
2. The brief gives none: use the first row that fits. The last row always fits.

| Origin class  | The field is                                                              | Write                                   |
| ------------- | ------------------------------------------------------------------------- | --------------------------------------- |
| `number`      | typed `number` or `boolean` in the answer                                 | the value as it is                      |
| `enum`        | typed as a union of literals (`'passed' \| 'failed'`)                     | the value as it is                      |
| `bound id`    | the id of the bound project (`projectIdOf`), not a field of the answer    | the value as it is                      |
| `id`          | `id`, `<x>_id`                                                            | the value as it is                      |
| `instant`     | `<x>_at`, a timestamp                                                     | the value as it is; the view formats it |
| `secret`      | a secret name: see below                                                  | leave the field out of the data         |
| `word`        | typed `string`; holds a status, a type, a kind, a strategy                | `kind(ctx, value)`                      |
| `address`     | a URL of the project's configuration                                      | `address(ctx, value)`                   |
| `own-doc`     | only when the brief says `own-doc`                                        | `ownDoc(ctx, value, LIMITS.sentence)`   |
| `third-party` | anything else: name, title, label, description, message, note, path, text | `thirdParty(ctx, value, LIMITS.<size>)` |

A field that can be `null`: `thirdPartyOrNull(ctx, value, LIMITS.<size>)` for a text, `kindOrNull(ctx, value)` for a word, `value ?? null` for a number, an enum or an id.
A list of values: the row of its class for each value (`values.map((value) => kind(ctx, value))`).

| Size              | Use for                          |
| ----------------- | -------------------------------- |
| `LIMITS.word`     | one word                         |
| `LIMITS.label`    | a label, a variable name         |
| `LIMITS.name`     | a name, a path                   |
| `LIMITS.sentence` | a description, a message, a note |

The size is always one of these four. A count of the brief ("the first 10") is not a size: it is a named constant in the tool file.

## Secret names

A secret name contains one of: `password`, `token`, `secret`, `key`, `credential`, `cookie`, `session`, `auth`.
The name of the field counts, never its value: a field `semantics` that holds the word `credential` has no secret name.

| You see                                                                            | Do               |
| ---------------------------------------------------------------------------------- | ---------------- |
| a field with a secret name, classed in the brief                                   | follow the brief |
| a field with a secret name, or a field inside an object with one, not in the brief | STOP `S-07`      |
| `[redacted]` in a view where a name, a date or an id belongs                       | STOP `S-07`      |
| the sentinel test is red                                                           | STOP `S-07`      |

## Never

- `inline()` on a text of the backend.
- A text field assigned without a row of the table.
- A change in `src/security/`.
- A new exception "this name is not a secret".
