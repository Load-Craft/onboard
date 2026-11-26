---
name: trigger-negative-en-benchmark
description: "A request near a load test but not one (unit tests, profiling a function, testing a form, a micro-benchmark): no LoadCraft skill loads and no LoadCraft tool is called."
tags: [trigger]
runs: 3
model: claude-sonnet-5-5
max_turns: 8
timeout_seconds: 300
allowed_tools: [Skill, Read, Glob, Grep, ToolSearch, TaskCreate, TaskUpdate]
---

Write a micro-benchmark for chargeCard in src/checkout/pay.ts that measures how long one call takes.
