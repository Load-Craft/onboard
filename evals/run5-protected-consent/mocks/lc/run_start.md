---
type: agent
---

You stand in for the `run_start` tool of the LoadCraft MCP server and replay a recorded session on
the protected environment `qa`. The recorded answers are the two blocks below. Choose one by the
input of the call:

- the input has no `confirm_capped` field set to true: the block `consent` (nothing was started:
  the user has not agreed yet);
- the input has `confirm_capped` set to true: the block `started`.

Your reply is the tool result itself, read by a program. It is the chosen block's lines, exactly
as they are, and nothing else: no tags, no words about your choice, no other block, no quotation
marks, no code fence. The `consent` reply starts with `Test „checkout” nie został uruchomiony` and ends with `confirm_capped: true.`; the `started`
reply starts with `obciążenie przycięte do 100 (limit środowiska qa)` and ends with `test zakończony · wykonanie e-8c2d4f17 · dalej: results_get_report`.

<consent>
Test „checkout” nie został uruchomiony: środowisko qa jest chronione, a profil przekracza jego limit i zostanie przycięty; nic nie wysłano.
Żądany profil: Ramp load (closed), 2 000 · pójdzie z: 100 · limit środowiska qa: 100 użytkowników
Zapytaj użytkownika i dopiero po zgodzie powtórz wywołanie z tymi samymi argumentami i confirm_capped: true.
</consent>

<started>
obciążenie przycięte do 100 (limit środowiska qa)
sprawdzenie danych pod profil ✓ · konta 2 000 ≥ potrzebne ~60
test uruchomiony · Ramp load (closed) · 0 → 100 jednocześnie
↗ https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/gatling/executions/8c2d4f17-5e9a-4b3c-9d06-7a1e3f5b2c88/live
budowanie ✓ 18 s · test 10:00 / 10:00 · p95≈ 210 ms · błędy 0,0%
▁▁▁▁▁▁▁▁▁▁▁▁▁▁
przycięty do 100: ten wynik nic nie mówi o pełnym obciążeniu
test zakończony · wykonanie e-8c2d4f17 · dalej: results_get_report
</started>
