---
name: trigger-positive-pl-capacity
description: "A request for a load, performance or capacity test that does not name the product: the loadcraft-test skill loads."
tags: [trigger]
runs: 3
model: claude-sonnet-5-5
max_turns: 3
timeout_seconds: 300
allowed_tools: [Skill, Read, Glob, Grep, ToolSearch, TaskCreate, TaskUpdate]
---

Czy nasze API sklepu wytrzyma 2 000 użytkowników naraz? Sprawdź to przed piątkową promocją.
