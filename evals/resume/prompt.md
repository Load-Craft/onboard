---
name: resume
description: "A new session in a repository bound to its LoadCraft project, with the flows built. The first LoadCraft tool is process_get_status; no second project, no flows built again."
tags: [negative, resume]
runs: 3
model: claude-sonnet-5-5
max_turns: 40
timeout_seconds: 900
allowed_tools: [Skill, Read, Glob, Grep, ToolSearch, TaskCreate, TaskUpdate]
---

Zrób test wydajnościowy checkoutu w LoadCraft na 2 000 użytkowników.

- Dokumentacja API: loadcraft/openapi.json została sprawdzona przed sesją, jest aktualna dla kodu, który testujemy, i przechodzi walidator. W tej sesji nie masz powłoki (Bash), więc jej nie generuj ani nie aktualizuj, tylko idź dalej.
