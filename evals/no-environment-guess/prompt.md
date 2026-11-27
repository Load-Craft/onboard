---
name: no-environment-guess
description: "A test asked for without an environment, in a project with four (perf the default). The agent must ask which one, never pick it, not even the default."
tags: [negative, environment]
runs: 3
model: claude-sonnet-5-5
max_turns: 30
timeout_seconds: 900
allowed_tools: [Skill, Read, Glob, Grep, ToolSearch, TaskCreate, TaskUpdate]
---

Puść w LoadCraft test checkoutu na 2 000 użytkowników: profil 7 z listy, progi p95 400 ms i błędy 1%. Scenariusz „checkout” i dane są gotowe, odpal od razu.

- Dokumentacja API: loadcraft/openapi.json została sprawdzona przed sesją, jest aktualna dla kodu, który testujemy, i przechodzi walidator. W tej sesji nie masz powłoki (Bash), więc jej nie generuj ani nie aktualizuj, tylko idź dalej.
