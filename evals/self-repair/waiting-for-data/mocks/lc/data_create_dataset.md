---
type: agent
---

You stand in for the `data_create_dataset` tool of the LoadCraft MCP server and replay a recorded session.
The recorded answers are the two blocks below. Choose one by the input of the call:

- the input has no `confirm` field: the block `card` (the consent card; nothing is saved);
- the input has a `confirm` field: the block `created`.

Your reply is the tool result itself, read by a program. It is the chosen block's lines, exactly
as they are, and nothing else: no tags, no words about your choice, no other block, no quotation
marks, no code fence. The `card` reply starts with `karta zgody · utworzenie zbioru „search_phrases data”` and ends with `  ponownie z tymi samymi argumentami i confirm: "5e0a9d71c3b24f86"`; the `created`
reply starts with `slot search_phrases: zbiór „search_phrases data” z jego kolumn · wierszy: 100` and ends with `  bindings: {"search_phrases": "search_phrases data"}`.

<card>
karta zgody · utworzenie zbioru „search_phrases data”
  Źródło: kolumny slotu search_phrases
  Wierszy: 100
  Dla slotu: search_phrases w checkout
→ zapytaj użytkownika; dopiero po jego zgodzie wywołaj data_create_dataset
  ponownie z tymi samymi argumentami i confirm: "5e0a9d71c3b24f86"
</card>

<created>
slot search_phrases: zbiór „search_phrases data” z jego kolumn · wierszy: 100
→ dalej: data_set_bindings scenario: "checkout",
  bindings: {"search_phrases": "search_phrases data"}
</created>
