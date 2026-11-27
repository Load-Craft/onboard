# Errors of the tools of module data

The codes of the tools of module `data` start with `data_`; the codes every tool shares, and the general rules, are in [errors-and-resume.md](errors-and-resume.md). Error results start with `[code]` on the first line: look the code up below, then read the hint line under it.

| Code | Meaning and action |
| ---- | ------------------ |
| `data_update_kind` | `data_update_dataset` was asked for a dataset that is not made of rows (jdbc, redis, custom). Nothing changed. Tell the user; they edit it in the app. |
| `data_file_changed` | The file changed after the card was made, so nothing was uploaded. Call `data_update_dataset` again for a card of the file as it is now. |
| `data_regenerate_no_recipe` | `data_regenerate_dataset` was asked for a dataset with no saved recipe. Nothing changed. Load rows from a CSV with `data_update_dataset` (card, the user's yes), or ask the user. |
| `data_dataset_in_use` | `data_delete` was asked for a dataset that scenarios or compositions still read. Nothing changed. Tell the user who uses it; only if they want it gone anyway, call again with `force: true` (a new card). |
| `data_generate_failed` | `data_generate_dataset`: LoadCraft could not generate the dataset (the message quotes its cause, masked), or lost the run. Nothing was saved. Run it again with the user's yes, or generate for a scenario or a slot instead. |
