---
name: repair-flow-too-large
description: "flows_generate_from_suggestions from three proposals returns two flows and refuses the third as too large for the model. The agent does not repeat the same call: it builds a smaller proposal, a description or a recording instead, and says so."
tags: [repair, self-repair]
runs: 3
model: claude-sonnet-5-5
max_turns: 40
timeout_seconds: 900
allowed_tools: [Skill, Read, Glob, Grep, ToolSearch, TaskCreate, TaskUpdate]
---

Zbuduj w LoadCraft flowy do testu checkoutu z propozycji z dokumentacji API: zakupy, przeglądanie i konto. Na tym kończymy: po zbudowaniu flowów napisz krótkie podsumowanie i nie składaj scenariusza.

Nie będę odpowiadać na pytania w trakcie, więc decyzje podaję z góry:

- Dokumentacja API: loadcraft/openapi.json została sprawdzona przed sesją, jest aktualna dla kodu, który testujemy, i przechodzi walidator. W tej sesji nie masz powłoki (Bash), więc jej nie generuj ani nie aktualizuj, tylko idź dalej.
- Środowisko: perf, domyślne.
- Gdyby jedna ścieżka się nie zbudowała, szukaj innej drogi do niej sam i powiedz mi na końcu, co zrobiłeś. Bez pytania możesz wybrać mniejszą propozycję z listy LoadCraftu.
- Gdyby padło pytanie, którego tu nie ma, przyjmij opcję zalecaną, powiedz, którą przyjmujesz, i idź dalej.
