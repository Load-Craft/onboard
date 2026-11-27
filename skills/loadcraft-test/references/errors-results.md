# Errors of the tools of module results

The codes of the tools of module `results` start with `results_`; the codes every tool shares, and the general rules, are in [errors-and-resume.md](errors-and-resume.md). Error results start with `[code]` on the first line: look the code up below, then read the hint line under it.

| Code | Meaning and action |
| ---- | ------------------ |
| `results_baseline_refused` | The backend would not pin the run as a baseline: a run of a self-check, or one with no scenario and load, or no result. Nothing was written. Pick another run (a measured run of a scenario) and call `results_set_baseline` again. |
