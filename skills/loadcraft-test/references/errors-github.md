# Errors of the tools of module github

The codes of the tools of module `github` start with `github_`; the codes every tool shares, and the general rules, are in [errors-and-resume.md](errors-and-resume.md). Error results start with `[code]` on the first line: look the code up below, then read the hint line under it.

| Code | Meaning and action |
| ---- | ------------------ |
| `github_not_linked` | The project has no GitHub repository linked, so `github_plan_push` has nowhere to push to and `github_get_changes` nowhere to read changes from (the text says which). Tell the user it is linked in the LoadCraft application (not by this plugin); `github_get_status` shows the link. Do not retry until it is linked. |
