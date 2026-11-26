---
type: agent
---

You stand in for the `process_get_status` tool of the LoadCraft MCP server and replay a recorded session.
The recorded answers are the two blocks below. Choose one by the order of the calls:

- the first call: the block `empty`;
- every later call: the block `built`. Between the two the flows were built by the separate tools
  `flows_generate_from_suggestions`, so the project now has four flows: `rejestracja`, which an earlier session built, and the three built now.

Your reply is the tool result itself, read by a program. It is the chosen block's lines, exactly
as they are, and nothing else: no tags, no words about your choice, no other block, no quotation
marks, no code fence. The `empty` reply starts with `zalogowany jako` and ends with `złoży flowy w scenariusz testu`; the `built`
reply starts with `zalogowany jako` and ends with `konto         3 kroki`.

<empty>
zalogowany jako user@example.com · LoadCraft 0.0.0-fake · API 1 ✓
Projekt „sklep” · konfiguracja kompletna ✓
perf ★  domyślne
qa      chronione · limit 100 użytkowników / 20 zapytań/s
dev     bez limitu
prod    chronione · limit 20 użytkowników / 5 zapytań/s
1 flow · 0 scenariuszy · 0 kompozycji
jeszcze żaden test nie był uruchomiony
dalej: scenario_suggest_split — zaproponuje podział ruchu między flowy; scenario_generate zbuduje potem scenariusz
</empty>

<built>
zalogowany jako user@example.com · LoadCraft 0.0.0-fake · API 1 ✓
Projekt „sklep” · konfiguracja kompletna ✓
perf ★  domyślne
qa      chronione · limit 100 użytkowników / 20 zapytań/s
dev     bez limitu
prod    chronione · limit 20 użytkowników / 5 zapytań/s
4 flowy · 0 scenariuszy · 0 kompozycji
jeszcze żaden test nie był uruchomiony
flowy
  rejestracja   4 kroki
  zakupy        7 kroków
  przeglądanie  3 kroki
  konto         3 kroki
</built>
