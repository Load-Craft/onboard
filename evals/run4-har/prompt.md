---
name: run4-har
description: Run 4 of the session mock-up on a sklep repository without API documentation - flows from a HAR recording. Grades the project setup without documentation (project_analyze_setup without openapi), flows_import_har before flows_generate_from_har with har and split, and that the recording is never read.
tags: [run4]
runs: 3
model: claude-sonnet-5-5
allowed_tools: [Skill, Read, Glob, Grep, ToolSearch, TaskCreate, TaskUpdate]
max_turns: 60
timeout_seconds: 1200
---

Zrób test wydajnościowy checkoutu w LoadCraft na 2 000 użytkowników. Flowy zbuduj z nagrania HAR.

Nie będę odpowiadać na pytania w trakcie, więc decyzje podaję z góry:

- Dokumentacja API: w tym repozytorium nie ma dokumentacji API i nie chcę jej generować, pracujemy bez niej. W tej sesji nie masz powłoki (Bash).
- Środowiska: adresy perf i qa są w plikach .env.perf i .env.qa. Dev: API https://api.dev.example.com, frontend https://dev.example.com. Prod: API https://api.example.com, frontend https://example.com.
- qa i prod są współdzielone, chroń je limitem obciążenia: qa 100 użytkowników / 20 zapytań/s, prod 20 użytkowników / 5 zapytań/s. perf i dev bez limitu.
- Testujemy na perf. Logów aplikacji nie podłączaj.
- Nagranie: nagrania/sesja.har, nagrane na koncie testowym. Wyślij je do LoadCraftu w całości, zgadzam się.
- Podział: podziel nagranie na ścieżki, które zaproponuje LoadCraft, i zbuduj wszystkie.
- Korelacje, które LoadCraft uzna za niepewne, przyjmij tak, jak je rozstrzygnął, ale nazwij je w podsumowaniu.
- Pola profilu projektu, które LoadCraft każe sprawdzić, przyjmij tak, jak je odczytał.
- Gdyby padło pytanie, którego tu nie ma, przyjmij opcję zalecaną, powiedz, którą przyjmujesz, i idź dalej.

Na tym kończymy: po zbudowaniu flowów napisz krótkie podsumowanie i nie składaj scenariusza.
