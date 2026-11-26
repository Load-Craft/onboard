---
name: run1-docs
description: Run 1 of the session mock-up on the sklep repository - flows from the API documentation, test on perf, report, diagnosis. Grades the order of the LoadCraft tools, the skill, the secret and the closing summary.
tags: [run1]
runs: 3
model: claude-sonnet-5-5
max_turns: 90
timeout_seconds: 1500
allowed_tools: [Skill, Read, Glob, Grep, ToolSearch, TaskCreate, TaskUpdate]
---

Zrób test wydajnościowy checkoutu w LoadCraft na 2 000 użytkowników.

Nie będę odpowiadać na pytania w trakcie, więc decyzje podaję z góry:

- Dokumentacja API: loadcraft/openapi.json została sprawdzona przed sesją, jest aktualna dla kodu, który testujemy, i przechodzi walidator. W tej sesji nie masz powłoki (Bash), więc jej nie generuj ani nie aktualizuj, tylko idź dalej.
- Środowiska: adresy perf i qa są w plikach .env.perf i .env.qa. Dev: API https://api.dev.example.com, frontend https://dev.example.com. Prod: API https://api.example.com, frontend https://example.com.
- qa i prod są współdzielone, chroń je limitem obciążenia: qa 100 użytkowników / 20 zapytań/s, prod 20 użytkowników / 5 zapytań/s. perf i dev bez limitu.
- Testujemy na perf.
- Logi aplikacji: podłącz serwer logów sklep-logs z .mcp.json.
- Flowy zbuduj z dokumentacji API, ze ścieżek zakupy, przeglądanie i konto.
- Przeglądu flowów nie potrzebuję: po zbudowaniu flowów przejdź od razu do scenariusza, bez pytania, czy flowy są takie, jak chcę.
- Podział ruchu: 50% zakupy, 40% przeglądanie, 10% konto. Dane wejściowe: Realistic.
- Konta testowe: załóż je przed testem.
- Profil obciążenia: profil 7 z listy.
- Progi: p95 400 ms, błędy 1%.
- Pola profilu projektu, które LoadCraft każe sprawdzić, przyjmij tak, jak je odczytał.
- Po diagnozie znajdź przyczynę w kodzie i pokaż poprawkę, ale nie zmieniaj plików: wdrożenie biorę na siebie.
- Gdyby padło pytanie, którego tu nie ma, przyjmij opcję zalecaną, powiedz, którą przyjmujesz, i idź dalej.

Na koniec napisz krótkie podsumowanie.
