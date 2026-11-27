# Tool recipe

How to write one module tool. Do the steps in order. Skip none.
A table decides every choice. If no row fits: STOP.
The brief and a table of this recipe disagree: the table wins. Say so in line 4 of the report.
Run every command from `mcp/`. `Q` stands for the test queue prefix of your brief: write the prefix inline in its place, never as a shell variable (zsh does not split `$Q`).
The brief says `Test queue: bash tools/queue.sh`: then `Q npx vitest run x` is `bash tools/queue.sh npx vitest run x`. No queue in the brief: leave `Q` out.
After every command run `echo "exit $?"`. It must print `exit 0`, unless the step says otherwise.
Write English everywhere. Polish goes only into `*.pl.ts`.

## Files of this recipe

Open a file only when a step tells you to. Tokens are an estimate: characters divided by 4.

| File                                           | Open it in                                                                     | Tokens |
| ---------------------------------------------- | ------------------------------------------------------------------------------ | ------ |
| `docs/tool-recipe.md`                          | always                                                                         | 3,660  |
| `docs/recipe/templates/read.md`                | steps 10 and 11, template LIST                                                 | 1,230  |
| `docs/recipe/templates/read-object.md`         | steps 10 and 11, template OBJECT                                               | 1,200  |
| `docs/recipe/templates/read-list-or-object.md` | steps 10 and 11, template LIST_OR_OBJECT (it sends you to the two files above) | 820    |
| `docs/recipe/templates/read-two-lists.md`      | steps 10 and 11, template LIST_OR_LIST (it sends you to `read.md`)             | 860    |
| `docs/recipe/templates/write.md`               | steps 10 and 11, template SET                                                  | 1,170  |
| `docs/recipe/templates/tests.md`               | steps 5 (the list of section 2), 7, 8, 9                                       | 2,360  |
| `docs/recipe/mask.md`                          | step 10                                                                        | 890    |
| `docs/recipe/texts.md`                         | steps 6 and 14                                                                 | 1,920  |
| `docs/recipe/mistakes.md`                      | step 17                                                                        | 1,560  |
| `docs/recipe/rebase.md`                        | step 19, only when the rebase stops                                            | 490    |
| `docs/recipe/mode-a.md`                        | step 1, only when it prints `MODE A`                                           | 820    |
| `docs/recipe/examples/list-notes.md`           | only when a line of a LIST template is unclear                                 | 1,250  |
| `docs/recipe/examples/update.md`               | only when a line of the SET template is unclear                                | 1,080  |
| `docs/recipe/templates/contract.md`            | never: step 5 copies it                                                        | 280    |
| `docs/recipe/brief.md`                         | never: the coordinator fills it in                                             | 450    |

## STOP

When a row applies: stop, send the message, wait. Do not work around it.

| Code | Situation                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| S-01 | The brief lacks an input of step 3.                                                                                                           |
| S-02 | The catalog lacks the tool, its arguments, or a block for an argument type.                                                                   |
| S-03 | The tool asks for consent.                                                                                                                    |
| S-04 | A reader does not compile, a field of the brief is not in the type of the answer, or the brief asks for a rule on an argument with a default. |
| S-05 | The data needs an operation that neither step 2 nor the brief lists.                                                                          |
| S-06 | The scaffold refuses, or `node_modules` is missing (step 1).                                                                                  |
| S-07 | A secret question (`docs/recipe/mask.md`), or the sentinel test of step 12 is red.                                                            |
| S-08 | No template or block fits: a file, a long operation, a question to the person, a UI, another undo.                                            |
| S-09 | A test outside your module is red.                                                                                                            |
| S-10 | You would have to change a file that "Files you may change" does not list. Or step 3 found changes.                                           |
| S-11 | The fake backend rejects an answer that the brief says is right.                                                                              |
| S-12 | A rebase conflict that `docs/recipe/rebase.md` does not cover.                                                                                |
| S-13 | Step 2 printed `S-13` and the brief gives no state update.                                                                                    |
| S-14 | The same test is red after three different attempts.                                                                                          |

Message, exactly four lines:

```
STOP <code> <tool_name>
found: <one sentence, with the line of output you saw>
need: <one sentence: what the coordinator must give or decide>
state: branch <name>; <"nothing committed" | "commit <sha>">; files changed: <list | "none">
```

## Decisions

**Which error.** Write only what the row says.

| Situation                                       | Write                                                   |
| ----------------------------------------------- | ------------------------------------------------------- |
| argument missing, wrong type, not in the schema | nothing                                                 |
| argument left out and the state has no default  | nothing (`refId` and `runOf` throw `missing_argument`)  |
| arguments that do not fit together              | `refuseRule('<key>')` as the first lines of `run`       |
| the backend answers 4xx or 5xx on the main read | nothing: no `try`, no `catch`                           |
| an auxiliary read fails                         | nothing (`optionalRead` and `want.part` make it a part) |
| a refusal the brief names                       | `throw new ToolError('<module>_<what>', { params })`    |

Never invent an error code. A code that neither this table nor the brief names does not exist.

**Which read.** The brief marks each operation main or auxiliary.

| Operation                                  | Write                                             |
| ------------------------------------------ | ------------------------------------------------- |
| main                                       | `await <reader>(ctx, path)`                       |
| auxiliary, the tool has an `include` value | `want.part('<value>', () => <reader>(ctx, path))` |
| auxiliary, no `include` value              | `optionalRead(() => <reader>(ctx, path))`         |
| two or more reads at once                  | `await settleAll([...])`, never `Promise.all`     |

**Which format in the view.**

| Value                                                     | Write                                                                       | Shows               |
| --------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------- |
| a date of joining, creating, adding                       | `day(at)`                                                                   | `2026-11-26`        |
| any other instant                                         | `minute(at)`                                                                | `2026-11-26 14:05Z` |
| a load run (its argument has the type `uuid\|run_handle`) | `run` of `runOf(...)`, or `runHandle(id)`                                   | `e-1a2b3c4d`        |
| any other object, a functional run too                    | `quoted(name)` and `idTag(id)`; no name: `idTag(id)`; no id: `quoted(name)` | `"name" [uuid]`     |

**Log values.** For each slot step 2 printed under `log slots`:
the data has a top-level field of that name: write nothing. Otherwise: add it to `update.log.values`.

**Files you may change.** Anything else is S-10.

- the four files step 2 printed under `files`
- `src/tools/<module>/index.ts` (the scaffold only)
- `src/render/i18n/<module>.en.ts`, `<module>.pl.ts`
- `src/render/i18n/en.ts`, `pl.ts`: only the keys of `docs/recipe/texts.md`
- `test/tools/<module>/canary.ts`, `test/fake-backend/routes/<module>.ts`
- the skill file of the brief; `skills/loadcraft-test/references/errors-<module>.md`
- by command only: `test/fixtures/surface/<module>.json`, `evals/mocks/lc/_tools.json`, `docs/plugin/INSTALL*.md`, `dist/`

## Steps

Do not end your turn before step 20 or a STOP.

1. **Mode.** Run `test -d node_modules`. Not `exit 0`: S-06. Run `test -f src/tools/kit/index.ts && echo "MODE A" || echo "MODE B"`. `MODE A`: open `docs/recipe/mode-a.md`. `MODE B`: run `test -f src/tools/kit/transitional.ts`. Not `exit 0`: S-08.
2. **Entry.** Run `node scripts/recipe-entry.mjs <tool_name>`. `exit 2`: STOP with the printed `STOP` line. Keep the output: it names the class, the template, the files, the names, the code for each argument and the log slots.
3. **Brief.** Check that the brief has every input: field table, read plan (when step 2 lists two or more operations), English view, skill file and heading, test stage, for a SET the fields and the undo arguments, for a LIST_OR_OBJECT the selector when step 2 could not name it, for a LIST_OR_LIST the mode and the read of the second list. One missing: S-01. Run `git status --short -- . ../skills ../tests`. Any output: S-10.
4. **Scaffold.** Run `npm run gen:tools -- --scaffold <tool_name>`. A refusal: S-06. Do not edit the `title` and the `input` it wrote.
5. **Contract.** Run `cp docs/recipe/templates/contract.md <the docs file of step 2>`. Fill every `<...>` now, from the output of step 2 and from the brief; the test cases are the list of your template in section 2 of `docs/recipe/templates/tests.md`. For LIST_OR_LIST that list is the "Tests" section of `docs/recipe/templates/read-two-lists.md` (the template the entry script names). Add nothing else. Run `grep -n "<[a-zA-Z]" <the docs file of step 2>`. It must print nothing. It prints a line: fill that line.
6. **Texts.** Open `docs/recipe/texts.md`. Do sections 1 to 4: write every sentence of the view of the brief as a dictionary key, English and Polish. An enum value (a union of literals) is shown as it is, with no key.
7. **Fake route.** Open `docs/recipe/templates/tests.md`. Do section 1.
8. **Test cases.** Do section 2 of the same file. The expected lines are the sentences of step 6.
9. **Sentinel case.** Do section 3. Then run `Q npx vitest run <the test file of step 2> 2>&1 | grep -c not_implemented`. It must print a number above 0. It prints `0`: your cases do not call the tool; go back to step 8.
10. **View.** Open the template file of your template. Create the render file of step 2 from its view. For every field of the data open `docs/recipe/mask.md` and use its row.
11. **`run`.** Fill the tool file of step 2 from the template file. Keep the order of the five numbered comments. A number of the brief (a limit, "the first 10") is a named constant at the top of the file.
12. **Green.** Run `Q npx vitest run <the test file of step 2>`. Run `Q npx vitest run test/security -t <tool_name>`. The second one red: S-07.
13. **Lint.** Run `npm run lint`. Run `npm run typecheck`. Formatting errors: `npx prettier --write <your files>`. Never add `eslint-disable`, `@ts-ignore`, `as any`.
14. **Skill.** Do section 5 of `docs/recipe/texts.md`.
15. **Lists.** Run `Q npm run update:surface`. Run `Q npm run update:shared`.
16. **Build.** Run `npm run build`. Run `npm run check:dist`.
17. **Check.** Open `docs/recipe/mistakes.md`. Compare every row with `git diff`. Then run the delivery block below.
18. **Commit.** `git add` your files by name, never `-A`. One commit: `feat(mcp): <task id> <tool_name> - <one sentence>`.
19. **Rebase.** Before it, `git status --short` must print nothing: step 16 changed `dist/`, so restore it with `git checkout -- dist` (step 19 builds it again) or commit it. Then run `git rebase <integration branch of the brief>`. It stops: open `docs/recipe/rebase.md`. Then always: `npm run build`, `npm run check:dist`, `git status --short dist`. It prints a line: `git add dist` and commit `chore(mcp): <task id> <tool_name> - dist after the rebase`. It prints nothing: no commit.
20. **Report.** Send the report below.

## Delivery block (step 17)

```bash
npm run lint; echo "exit $?"
npm run typecheck; echo "exit $?"
npm run check:catalog; echo "exit $?"
Q npx vitest run test/tools/<module>; echo "exit $?"
Q npx vitest run test/security -t <tool_name>; echo "exit $?"
Q npx vitest run test/genTools/contract.test.ts test/surface.baseline.test.ts test/sharedLists.test.ts; echo "exit $?"
Q npx vitest run test/architecture; echo "exit $?"
Q npx vitest run test/liveGate.scenarios.test.ts; echo "exit $?"
git add <your files, by name>
Q npm run test:skills -- no-target-names playbook-skill; echo "exit $?"
npm run check:dist; echo "exit $?"
```

A line that is not `exit 0` and names a file of another module: S-09. Never run `npm test`.

## Report (step 20)

```
1. commit <sha> on <branch>, rebased on <sha>; catalog <version>
2. tests: every line of the delivery block with its exit code and its count of test files
3. delivered: <tool_name> (<LIST | OBJECT | SET>); UI: text only
4. deviations from the contract: <"none" | one sentence each>
manual test:
1. <tool_name> {<arguments>} -> <what the view shows>; an error would be: <what>
2. the same call with the Polish locale -> <first line of the Polish view>
3. <one refusal> -> [<code>]
```

## Size

What one tool makes a model read: this file, its template, `tests.md`, `mask.md`, `texts.md`, `mistakes.md` and the contract it fills.

- LIST: about 11,900 tokens.
- OBJECT: about 11,870 tokens.
- SET: about 11,840 tokens.
- LIST_OR_OBJECT: about 13,920 tokens.
- LIST_OR_LIST: about 12,760 tokens.
- Every file of the recipe: about 20,040 tokens.
