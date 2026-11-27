# Errors of the tools of module functional

The codes of the tools of module `functional` start with `functional_`; the codes every tool shares, and the general rules, are in [errors-and-resume.md](errors-and-resume.md). Error results start with `[code]` on the first line: look the code up below, then read the hint line under it.

| Code | Meaning and action |
| ---- | ------------------ |
| `functional_no_flows` | `functional_restore_flow` found no flow because the project has no functional tests at all. Tell the user there is nothing to go back to; `functional_get_flows` lists the flows (an empty list confirms it). Do not retry. |
| `functional_test_types_failed` | The run of the model on the test types failed (the cause is in the text); nothing was saved. Start it again once with the same arguments (a new card, the user's yes); if it fails again, tell the user. |
| `functional_payloads_failed` | The payload generation failed (the cause is in the text); nothing was saved. Start it again once with the same arguments (a new card, the user's yes); if it fails again, tell the user. |
| `functional_payloads_lost` | The payloads were generated but LoadCraft serves the ZIP once and it can no longer be fetched; nothing was saved. Generate them again (a new card, the user's yes). |
| `functional_payloads_file` | The `file` of `functional_generate_payloads` cannot be used: a relative path inside the project directory ending in `.zip`, without `..` or a hidden folder. Nothing was started. Pass another path, or none. |
