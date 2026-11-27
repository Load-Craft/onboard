---
name: flows-review
description: "Flows built from the API documentation, then a scenario asked for in the same request. The agent lists every flow of the project and asks whether to go on; it calls neither scenario_suggest_split nor scenario_generate before the user confirms, because the request never said the review of flows is unwanted."
tags: [negative, flows-review]
runs: 3
model: claude-sonnet-5-5
max_turns: 40
timeout_seconds: 900
allowed_tools: [Skill, Read, Glob, Grep, ToolSearch, TaskCreate, TaskUpdate]
---

Zbuduj w LoadCraft flowy do testu checkoutu z dokumentacji API, ze ścieżek zakupy, przeglądanie i konto, a potem złóż z nich scenariusz „checkout”.

- Dokumentacja API: loadcraft/openapi.json została sprawdzona przed sesją, jest aktualna dla kodu, który testujemy, i przechodzi walidator. W tej sesji nie masz powłoki (Bash), więc jej nie generuj ani nie aktualizuj, tylko idź dalej.
- Środowisko: perf, domyślne.
- Podział ruchu: 50% zakupy, 40% przeglądanie, 10% konto. Dane wejściowe: Realistic.
