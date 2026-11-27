# Errors of the tools of module scenario

The codes of the tools of module `scenario` start with `scenario_`; the codes every tool shares, and the general rules, are in [errors-and-resume.md](errors-and-resume.md). Error results start with `[code]` on the first line: look the code up below, then read the hint line under it.

| Code | Meaning and action |
| ---- | ------------------ |
| `scenario_composition_spec_refused` | `scenario_set_composition_type`: LoadCraft refused the parameters of the test type (the message lists the fields it names). Nothing was changed; fix the parameters (the hint lists what each kind takes) and call again. |
| `scenario_save_refused` | `scenario_save`: the arguments do not fit together (nothing to change, `slo_thresholds` with `slo_from_project`, more than 20 tags, or a flag that only an existing scenario has). Nothing was sent; fix the arguments and call again. |
| `scenario_compile_refused` | `scenario_compile_composition`: the backend would not build the composition (an enabled member has no build, or carries a plan field the build refuses). Nothing was built. Regenerate that member scenario and ask again. |
| `scenario_drift_failed` | `scenario_check_drift`: LoadCraft could not finish the drift check (the message quotes its cause, masked), or lost it. Nothing is stored. Check that `reference_id` is a HAR session or a documentation version of this project, then run the check again with the user's yes. |
| `scenario_drift_cancelled` | `scenario_check_drift`: the check was cancelled before it finished. Nothing is stored; run it again only when the user wants the check. |
