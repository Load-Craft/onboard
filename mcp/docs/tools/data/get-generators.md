# data_get_generators — contract

Tool: `data_get_generators` (module `data`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (arguments added to the catalog entry before this tool).

## Arguments (exactly the catalog's)

- `columns?`: 1–2000 characters: column names separated by commas, at most 50 names (blank parts dropped). Without it, the tool
  lists the generators. More than 50 names, or only blanks: `invalid`, no request.

An unknown argument is refused (strict schema). The project is the one of the workspace.

## Operations

| call              | request                                                        |
| ----------------- | -------------------------------------------------------------- |
| without `columns` | `GET /projects/{project_id}/gatling/feeders/generators`        |
| with `columns`    | `POST /projects/{project_id}/gatling/feeders/generators/guess` |

One request each; nothing is created and no model is called.

## format=data

Without `columns`: `mode: "list"`, `project_id`, `count`, `generators[]`: `label`, `hint`, `params` (`none`, `networks`,
`pattern`, `range`, `list`, `ref`, `samples`), `choices[]` (`label`, `value`, `default`; at most 20) with `choices_total` (how many the generator lists; the view says `+N more`).

With `columns`: `mode: "guess"`, `project_id`, `count`, `columns[]` in the order asked: `name`, `semantics` (`identity`,
`secret`, `entity-ref`, `synthetic`, `derived`; the backend's `credential` is reported as `secret`, as in `data_list_datasets`),
`declarable_as_data`, `refusal` (why the hub will not make the column, or null), `generator` (`hint`, `pattern`, `min`,
`max`, `values` as a count, `networks`, `ref_column`) or null.

**Third party:** every label, hint, refusal, name, pattern and column goes through `content()`; the values of a list of choices
the backend guessed are only counted. No cell of any dataset is read.

## Text view

```
3 columns:
1. email: identity; not generated: existing logins are never invented; can be declared as data you supply
2. password: secret; not generated: credentials are never generated; can be declared as data you supply
3. age: plain; generator range 18-90
```

The list: `12 generators:` then `1. <label> [<params>] <hint>` and, when it has choices, `   choices: a (default), b`.

## State

Reads `ids.project_id`; writes nothing. The log carries `{count} generators` (the columns of a guess count as well).

## UI

Text only.

## Test cases

- Ordinary: the list, a guess for three columns, data of both, Polish view, log entry, one request each.
- Edge: more than 50 names, only blanks, blank parts dropped, unknown project (not_found), no bound workspace.
- Adversary: sentinel in a label and in a column name, an instruction in a hint stays one line, an argument outside the
  catalog refused, the first request not sent for refused arguments.

## Out of scope

Making a dataset from the rules (writes, `data_generate_dataset`).

## What the backend's flag means

`declarable_as_data` is true only together with a `refusal` (a column the hub will not make can still be declared as data of the
user's own); a plain column has no refusal and the flag false. The view therefore chooses by `refusal`: none, the rule;
otherwise the reason, with "can be declared as data you supply" when the flag is true.
