---
name: trigger-positive-pl-load
description: "A request for a load, performance or capacity test that does not name the product: the loadcraft-test skill loads."
tags: [trigger]
runs: 3
model: claude-sonnet-5-5
max_turns: 3
timeout_seconds: 300
allowed_tools: [Skill, Read, Glob, Grep, ToolSearch, TaskCreate, TaskUpdate]
---

Przygotuj test obciążeniowy API zamówień na 500 jednoczesnych użytkowników.
