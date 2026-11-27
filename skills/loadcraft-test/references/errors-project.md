# Errors of the tools of module project

The codes of the tools of module `project` start with `project_`; the codes every tool shares, and the general rules, are in [errors-and-resume.md](errors-and-resume.md). Error results start with `[code]` on the first line: look the code up below, then read the hint line under it.

| Code | Meaning and action |
| ---- | ------------------ |
| `project_file_changed` | The env file changed after the card was made, so nothing was sent. Call `project_set_http_settings` again for a card of the file as it is now. |
