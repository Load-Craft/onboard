# Errors of the tools of module run

The codes of the tools of module `run` start with `run_`; the codes every tool shares, and the general rules, are in [errors-and-resume.md](errors-and-resume.md). Error results start with `[code]` on the first line: look the code up below, then read the hint line under it.

| Code | Meaning and action |
| ---- | ------------------ |
| `run_save_schedule_started` | A schedule was switched on for the saved run while the call was made, so nothing was changed. Call `run_save` again: a change of the load, the environment or the address of a scheduled run gets a card, and the user confirms in a dialog. |
