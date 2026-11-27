# Recipe: texts

Use it in step 6 (sections 1 to 4) and step 14 (section 5).

## 1. Rules

- Every sentence a view prints is a dictionary key. No English literal in a view.
- A text of the backend is data. Show it inside a sentence of the dictionary, never as the sentence.
- Add each key to `src/render/i18n/<module>.en.ts` and the same key to `<module>.pl.ts`.
- A Polish plural entry has `one`, `few`, `many`, `other`.
- A key that exists is not added again.

## 2. Fixed sentences of the module dictionary

Copy word for word. Add only the keys your view uses.

| Key                         | English                                                                       | Polish                                                                         |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `<tool_name>.no_match`      | `No name contains "{query}"; {fetched} were read.`                            | `Żadna nazwa nie zawiera "{query}"; przeczytano {fetched}.`                    |
| `<tool_name>.more`          | `showing the first {shown} of {count}`                                        | `pokazano pierwsze {shown} z {count}`                                          |
| `<tool_name>.cut`           | `the project has {total}; the {fetched} most recently updated were read`      | `w projekcie jest {total}; przeczytano {fetched} ostatnio zmienionych`         |
| `<module>.part.none`        | `none`                                                                        | `brak`                                                                         |
| `<module>.part.unavailable` | `unavailable (LoadCraft answered {status})`                                   | `niedostępne (LoadCraft odpowiedział {status})`                                |
| `<tool_name>.unchanged`     | `{name}: nothing to change, the values are already as given.`                 | `{name}: nic do zmiany, wartości są już takie, jak podano.`                    |
| `<tool_name>.undo_withheld` | `This change cannot be undone from the log: a previous value holds a secret.` | `Tej zmiany nie da się cofnąć z dziennika: poprzednia wartość zawiera sekret.` |

The other keys: write the English from the view of the brief, then translate.
The brief gives a key and its sentence beside a view line (`key .line: {label} {hint}`): use that key (`<tool_name>.line`) and that sentence.

| Template       | Keys the view needs                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIST           | `.header` (a plural entry with `{count}`), `.empty`, `.more`; `.no_match` when the tool has `query`; `.cut` when the backend gives a total; one key per item line |
| OBJECT         | `.header`, one key per fact line, one key per part label, one key per part line; `<module>.part.none`, `<module>.part.unavailable` when it has parts              |
| SET            | `.header`, `.unchanged`, `.undo_withheld`, `.field.<field>` for every field                                                                                       |
| LIST_OR_OBJECT | the keys of LIST and of OBJECT, and `.kind` when the selector can be a name                                                                                       |
| LIST_OR_LIST   | the keys of LIST for the first list; for the second list the same keys after its mode: `<tool_name>.<mode>.header`                                                |

## 3. Rule keys: only when `run` calls `refuseRule`

The key is `error.invalid_arguments.rule.<object in snake_case>_<kind>`, for example `update_at_least_one`.
Add it to `src/render/i18n/en.ts` and to `pl.ts`, after the last entry that starts with `'error.invalid_arguments.rule.`.
Write the real argument names in place of `a` and `b`. The key names the kind, never the arguments: `get_templates_not_with`.
Two rules of the same kind in one tool: add the first argument of each: `get_templates_not_with_tags`, `get_templates_not_with_status`.

| Kind           | Refuse when                    | English                       | Polish                            |
| -------------- | ------------------------------ | ----------------------------- | --------------------------------- |
| `at_least_one` | none of `a`, `b` is given      | `pass at least one of: a, b`  | `podaj co najmniej jeden z: a, b` |
| `one_of`       | `a` and `b` are both given     | `pass a or b, not both`       | `podaj a albo b, nie oba`         |
| `only_with`    | `a` is given without `b`       | `a works only with b`         | `a działa tylko razem z b`        |
| `not_with`     | `a` is given together with `b` | `a cannot be combined with b` | `a nie łączy się z b`             |

A boolean with a default counts as given only when it is `true`.
Any other argument with a default is never in a rule: the tool cannot see whether it was given. The brief asks for one: STOP `S-04`.
Never add another error code or rule kind.

## 4. Hint keys: only when `run` calls `refId` or `runOf`

Run `grep -n "error.missing_argument.hint.<argument>'" src/render/i18n/en.ts`.
A line: do nothing. No line: add the key to `en.ts` and `pl.ts`, after the last entry that starts with `'error.missing_argument.hint`.

| Argument               | English                                                                             | Polish                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `flow_id`              | `Pass flow_id: flows_list lists the flows, then call the tool again.`               | `Podaj flow_id: flows_list pokazuje flowy, potem wywołaj narzędzie ponownie.`              |
| `scenario_id`          | `Pass scenario_id: scenario_list lists the scenarios, then call the tool again.`    | `Podaj scenario_id: scenario_list pokazuje scenariusze, potem wywołaj narzędzie ponownie.` |
| `run_id`, `compare_to` | `Pass <argument>: run_list lists the runs, then call the tool again.`               | `Podaj <argument>: run_list pokazuje przebiegi, potem wywołaj narzędzie ponownie.`         |
| `dataset_id`           | `Pass dataset_id: data_list_datasets lists the datasets, then call the tool again.` | `Podaj dataset_id: data_list_datasets pokazuje zbiory, potem wywołaj narzędzie ponownie.`  |
| any other              | STOP `S-08`                                                                         |                                                                                            |

A code of the module (only when the brief names one): add `error.<module>_<what>.message` and `.hint` to both module dictionaries.
Add one row to `skills/loadcraft-test/references/errors-<module>.md`: ``| `<module>_<what>` | <what happened>. <What to do next>. |``

## 5. The skill sentence (step 14)

Open the skill file of the brief. Go to the heading of the brief. Its section ends before the next line that starts with `#`.
Add one line as the last line of that section, with one empty line before it and one after it:

```
- <First sentence of the catalog description, without its final period>: `<tool_name>`.
```

Change nothing else in that file.
