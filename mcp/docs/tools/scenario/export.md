# scenario_export — contract

Tool: `scenario_export` (module `scenario`; level 1, class read; text view and `format: "data"`; the description and the log
templates are the catalog's, through `meta.generated.ts`). Matches the catalog: yes. Annotations: `readOnlyHint: false`,
`destructiveHint: false` (the tool writes a file to the workspace; nothing changes in the backend), so it is in variant B of the
install guide and not in variant A. `install_allow` is true.

## Arguments (exactly the catalog's)

- `scenario_id?`: UUID; default: the only scenario in `ids.scenario_ids` of the state. None or several: `missing_argument`
  naming `scenario_id`, no request. There is no argument for the path: the file always goes to the same folder.

An unknown argument (a path of its own included) is refused (strict schema).

## Operations

1. `GET /projects/{project_id}/gatling/scenarios/{scenario_id}/export` — the ZIP of the scenario's Gatling project. The ZIP holds no
   dataset file: they carry real values and are left out on purpose. A ZIP over the client's response limit is `response_too_large`,
   nothing saved.
2. `GET /projects/{project_id}/gatling/scenarios/{scenario_id}` — once, after the ZIP is saved, for the dataset slots (the file each reads, its columns,
   its role). An auxiliary read, best effort: when it fails the recipe lists no columns and the ZIP stays saved.

## The recipe (what the project needs that the ZIP does not hold)

A project unpacked from the ZIP does not start: its `application.conf` reads dataset files that are not in it and environment variables that are not set,
and the backend's `README.txt` inside the ZIP says only `./gradlew gatlingRun`. The tool says the rest. Decision: the ZIP is saved exactly as the backend
sent it (the README is the backend's); the recipe is a **separate file beside it**, `loadcraft/exports/scenario-<id8>[-N].run.md` (the ZIP's name with `.run.md`;
never replaces a file, a symlink included: when the name is taken nothing is written and the view has no steps line), and the same lines are in the view.

- **Where the names come from.** The dataset files and the variables come from the project's own `application.conf`, the one place that names them: the ZIP is opened
  narrowly (`exportRecipe.ts`): its central directory is read, the entry `application.conf` (the shortest path) is unpacked in memory (stored or deflated, at most 1 MiB), nothing is extracted to disk,
  no other file name of the ZIP is kept. Only names that match a plain pattern are taken (dataset files `name.csv|tsv|ssv|json`; variables `UPPER_CASE` from `${VAR}` / `${?VAR}`; the
  folder of the configuration as a relative path of plain segments): anything else is dropped. A ZIP that cannot be read this way (not a ZIP, truncated, ZIP64, no
  `application.conf`) gives no recipe and no error: the view then says the configuration could not be read, and lists the dataset slots of the scenario.
- **Columns** come from the scenario's dataset slots (names only), matched by the file the slot reads.
- **Never values.** No cell of a dataset, no value of a variable, ever: datasets are not read, the variable values do not exist in the ZIP. The result no longer says that dataset secrets are masked.

## The file

- Only under `loadcraft/exports/` of the workspace; `.gitignore` with `*` made there when missing, never overwritten (`wx`).
- Before the request: the workspace exists and `loadcraft/` and `loadcraft/exports/`, when they exist, resolve through their
  symlinks to a place inside it (`path_outside_workspace` otherwise, no request).
- Name `scenario-<first 8 digits of the id>.zip`; when the name is taken (a file, a folder, a symlink, even a dangling one) the next
  free `…-2.zip`, `…-3.zip`. An earlier export is never replaced, so no `overwrite` argument. The name carries nothing from the
  scenario's texts.
- The bytes are written to a temporary file in the folder and linked to the name (fails when taken), then the temporary file is
  removed; mode 0644, bytes as the backend sent them.
- The ZIP is third-party content: it is never opened, so no file name from inside it reaches the model, the log or the state.

## format=data

`project_id`, `scenario_id`, `path` (`loadcraft/exports/scenario-<id8>.zip`, relative to the workspace), `bytes` (exact size), `datasets_omitted` (always true),
`conf_read` (whether `application.conf` could be read), `folder` (where the dataset files go, inside the project; null when unknown), `datasets[]` (`file`, `columns`,
`role`: `auth` for the accounts that sign in), `env_vars[]` (names, at most 30), `recipe` (`loadcraft/exports/scenario-<id8>.run.md`, null when not written).

## Text view

```
Exported the Gatling project of scenario b7e2d495-… as a ZIP (14 KB).
The dataset files are not in it, on purpose: they hold real values and are never put into an export.
Add 2 dataset files in src/gatling/resources (names and columns only; the values are yours):
- accounts.csv (sign-in accounts): columns email, password
- search_phrases.csv: columns q
Set 1 environment variable (your own value):
- LC_HDR_X_PUBLISHABLE_KEY
steps to start it: loadcraft/exports/scenario-b7e2d495.run.md
The folder is ignored by git; an earlier export is never replaced.
open: loadcraft/exports/scenario-b7e2d495.zip
```

The `.run.md` file has the same recipe, then `./gradlew gatlingClasses` and `./gradlew gatlingRun`, and a line that the ZIP's own README is the backend's. The catalog description
of the tool (`dataset secrets masked`) is the backend's wording of what it does to the project's secrets, not a promise about the dataset files; the view is the place that says
what is left out.

## State

Reads `ids.project_id` and `ids.scenario_ids`; writes nothing. The log carries the id and the path.

## UI

Text only: the user opens the file from the path.

## Test cases

- Ordinary: file saved byte for byte, relative path, two requests (the ZIP and the scenario), `.gitignore` made or kept, a second export takes the next name,
  data, Polish view, log entry.
- Edge: a name taken by a symlink (not followed, not replaced), a symlinked `loadcraft/exports` out of the workspace (refused
  before the request), unknown scenario (404, nothing saved), no id in the state, a 500 (nothing saved).
- Recipe: files, columns, variables and folder from a stored and a deflated `application.conf`; the slots listed when the configuration cannot be read; nothing to add;
  odd names dropped; truncated, empty and garbage ZIPs (no recipe, no error); the recipe file's content and mode; a symlink or a file in its place left alone; Polish.
- Adversary: a canary in the rows of a dataset and a value in the ZIP in no output (view, recipe file, log, state), no other file name of the ZIP anywhere; a file name inside the ZIP never in the output or the state, 500 quoting a credential, an argument outside the
  catalog (a path) refused, level 1 so it is offered.

## Out of scope

Importing a scenario and the Scala source of a version.
