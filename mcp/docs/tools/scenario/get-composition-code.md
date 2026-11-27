# scenario_get_composition_code — contract

Tool: `scenario_get_composition_code` (module `scenario`; level 1, class read+secret, `readOnlyHint: true`, no card, no undo; text
view and `format: "data"`; the description, the annotations and the log templates are the catalog's, through
`meta.generated.ts`). Matches the catalog: yes (arguments added to the catalog entry together with this tool).
`install_allow` is false.

## Arguments (exactly the catalog's)

- `composition_id?`: 1–200 characters, the composition's id or its name; default `ids.composition_id` of the state. A UUID goes as it
  is; a name is looked up in the project's compositions first (one more request; no match `not_found`, several `ambiguous`). Neither
  given nor in the state: `missing_argument`, no request.
- `path?`: 1–300 characters: one file of the project by its path in the tree, as listed. Without it the tool lists the tree.

A path with a leading `/`, a backslash, a NUL, an empty segment, `.` or `..` is `invalid` before any request. An unknown argument is
refused (strict schema).

## Operations

| call   | requests                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| tree   | `GET …/compositions/{id}/project-structure`                                                                |
| `path` | the tree, then `GET …/compositions/{id}/file-content?path=<path>` only when the path is a file of the tree |

No path of the model's own goes to the backend as a file name: a path that is not in the tree is `not_found` and the file is not
asked for. A file beyond the first 200 of a large tree can still be read: the check uses the whole tree.

## format=data

`mode` (`tree` | `file`), `project_id`, `composition_id`, `files` (how many files the project has), `tree[]` (`path`,
`size_bytes`; at most 200; empty for a file), `tree_truncated`, `file`: `shown` (`path`, `language`, the masked `text` cut at
8000 characters, `truncated`) or `hidden` (`path`, `language`, `bytes`, when the mask cannot read it), null for the tree.

**Secrets and third party:** the paths pass `content()`; a file's text is a recorded body and passes `body()` (as `text/plain`,
or JSON/XML by its language): masked by the shapes of secrets, or hidden whole.

## Text view

```
The generated Gatling project has 3 files:
  build.gradle (35 B)
  src/gatling/scala/Simulation.scala (38 B)
  src/gatling/resources/gatling.conf (22 B)
Pass path to read one of these files; secrets in it are masked.
```

A file: `<path> (<language>):` then its text; a cut file ends with `… file cut`.

## State

Reads `ids.project_id` and `ids.composition_id`; writes nothing. The log carries the id, the path (`tree` for the tree) and the
number of files.

## UI

Text only: the model reads generated code here; nothing for the mod.

## Test cases

- Ordinary: the tree (one request), one file (tree, then file), data in both modes, Polish view, log entry.
- Edge: a path not in the tree (not_found, no file request), paths that escape (invalid, no request), a tree of 250 files and a
  file past the 200th, a file over 8000 characters, an empty project, no id, unknown composition.
- Adversary: sentinel secrets in a file (bearer, password, header value) masked and the rest kept; a credential in a path; a 500
  quoting a credential; an instruction in a path; argument outside the catalog or an empty or long path refused.

## Out of scope

Compiling or running the project, and the project of one scenario (`scenario_export`).
