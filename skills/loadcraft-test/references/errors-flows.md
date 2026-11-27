# Errors of the tools of module flows

The codes of the tools of module `flows` start with `flows_`; the codes every tool shares, and the general rules, are in [errors-and-resume.md](errors-and-resume.md). Error results start with `[code]` on the first line: look the code up below, then read the hint line under it.

| Code | Meaning and action |
| ---- | ------------------ |
| `flows_copilot_turn_unknown` | `flows_apply_copilot_changes` got a `message_id` the flow's copilot history does not hold. Nothing changed. Use the id `flows_ask_copilot` returned, or the one `flows_get_copilot_history` shows. |
| `flows_copilot_change_unknown` | An id in `accept` or `reject` is not a change of that copilot turn. Nothing changed. The error lists the ids the turn has. |
| `flows_apply_version_conflict` | The flow changed after the proposal was read, so the apply was refused (409). Nothing changed. Read the flow again and ask the copilot for a new proposal. |
| `flows_save_step_not_droppable` | `flows_save` was asked to drop a step it cannot take out without guessing: a number the outline of `flows_get` does not have, a step inside a group or a condition, a group or a condition itself, a step with two ways on, or every step of the flow. Nothing was written. Read the outline again with `flows_get`, name only top-level steps (a request or a pause), and for the rest ask the user what they want to keep. |
| `flows_save_secret_in_graph` | The graph given to `flows_save` carries a literal secret (the value of a header, a body field or a variable named like a token, a password or a key, or a value shaped like a credential) at the path the message names. Nothing was sent. Never put the value in a graph and never ask the user for it: refer to it with a variable reference (the name of a variable written between `#{` and `}`), keep its value in the environment or the test data, then call again. |
| `flows_walk_image_exists` | An image of the walk is already saved under that name (the path is in the message). Open it, or call `flows_export_walk_image` again with `overwrite: true` when the user wants a fresh one. |
| `flows_walk_image_not_an_image` | The backend answered with something that is not a PNG, a JPEG or a WebP image; nothing was saved. Do not repeat the call: the walk may have ended or the page is gone. Tell the user. |
| `flows_regenerate_unavailable` | `flows_regenerate`: the flow has no recorded source endpoints or operations, so there is nothing to regenerate from. Nothing was asked. Build a new flow with a `flows_generate_*` tool. |
| `flows_regenerate_changed` | `flows_regenerate`: the flow changed after the card was made. Nothing was started. Call the tool again; the card shows the flow as it is now. |
| `flows_regenerate_failed` | `flows_regenerate`: the run ended without a new version (a source LoadCraft cannot map, a missing specification, a failed check). The flow is as it was. Fix the cause and call again. |
