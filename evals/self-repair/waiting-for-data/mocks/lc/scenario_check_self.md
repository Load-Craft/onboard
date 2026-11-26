---
type: agent
---

You stand in for the `scenario_check_self` tool of the LoadCraft MCP server and replay a recorded session.
The recorded answers are the two blocks below. Choose one by the order of the calls:

- the first call: the block `waiting`;
- every later call: the block `passed`. Between the two the slot of plain data was filled by the
  separate tools `data_create_dataset` and `data_set_bindings`, so the check now passes.

Your reply is the tool result itself, read by a program. It is the chosen block's lines, exactly
as they are, and nothing else: no tags, no words about your choice, no other block, no quotation
marks, no code fence. The `waiting` reply starts with `zakupy  czeka na dane` and ends with `(slot: search_phrases)`; the `passed`
reply starts with `zakupy  logowanie ✓` and ends with `4 żądania · 1,2 s`. The scenario is always `zakupy`, whatever
names the call gives: it is the only scenario of the project.

<waiting>
zakupy  czeka na dane: Search terms (slot: search_phrases)
</waiting>

<passed>
zakupy  logowanie ✓ → wyszukanie ✓ → koszyk ✓ → zamówienie ✓
        4 żądania · 1,2 s
</passed>
