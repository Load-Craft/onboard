# Recipe: when the rebase stops

Use it in step 19, only when `git rebase` reports a conflict. Resolve file by file, `git add` each resolved file, then `GIT_EDITOR=true git rebase --continue`.

| Conflict in                                                                                         | Do                                                          |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `dist/*`                                                                                            | `npm run build`, then `git add dist`. Never merge the text. |
| `test/fixtures/surface/*`, `evals/mocks/lc/_tools.json`, `docs/plugin/INSTALL*.md`                  | take either side, run step 15, `git add` them               |
| `*.generated.ts`, `src/tools/_generated/*`, `src/render/i18n/_generated/*`                          | take either side, run `npm run gen:tools`, `git add` them   |
| `src/tools/<module>/index.ts`, `<module>.en.ts`, `<module>.pl.ts`, `canary.ts`, `en.ts`, `pl.ts`    | keep the lines of both sides                                |
| `test/fake-backend/routes/<module>.ts`, the skill file of the brief, `errors-<module>.md`           | keep the lines of both sides                                |
| a file step 2 printed under `files` (both sides added it: the tool was written elsewhere meanwhile) | STOP `S-12`. Do not merge the two versions.                 |
| any other file                                                                                      | STOP `S-12`                                                 |

After the rebase, always:

1. Run `npm run build`. Run `npm run check:dist`. Commit `dist/` when it changed.
2. Run again the tests of every file that had a conflict.
3. A commit the coordinator reported as merged is never amended. A fix is a new commit on a new branch.
