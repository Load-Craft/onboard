---
name: run2-manual
description: Run 2 of the session mock-up on the sklep repository - the checkout flow built by hand from endpoints the user chose and a one-sentence description, the other flows from proposals. Grades flows_generate_from_endpoints, then flows_generate_from_suggestions.
tags: [run2]
runs: 3
model: claude-sonnet-5-5
allowed_tools: [Skill, Read, Glob, Grep, ToolSearch, TaskCreate, TaskUpdate]
max_turns: 60
timeout_seconds: 1200
---

Zrób test wydajnościowy checkoutu w LoadCraft na 2 000 użytkowników. Flow zakupów chcę ułożyć ręcznie, z endpointów, które wskażę.

Nie będę odpowiadać na pytania w trakcie, więc decyzje podaję z góry:

- Dokumentacja API: loadcraft/openapi.json została sprawdzona przed sesją, jest aktualna dla kodu, który testujemy, i przechodzi walidator. W tej sesji nie masz powłoki (Bash), więc jej nie generuj ani nie aktualizuj, tylko idź dalej.
- Środowiska: adresy perf i qa są w plikach .env.perf i .env.qa. Dev: API https://api.dev.example.com, frontend https://dev.example.com. Prod: API https://api.example.com, frontend https://example.com.
- qa i prod są współdzielone, chroń je limitem obciążenia: qa 100 użytkowników / 20 zapytań/s, prod 20 użytkowników / 5 zapytań/s. perf i dev bez limitu.
- Testujemy na perf. Logów aplikacji nie podłączaj.
- Flowy: zakupy układam ręcznie, przeglądanie i konto weź z propozycji LoadCraftu.
- Endpointy flow zakupy, w tej kolejności: POST /api/auth/login, GET /api/products, POST /api/cart/items, GET /api/cart, POST /api/checkout. Lista jest dobra, nic nie dodawaj ani nie usuwaj. Nazwa flow: zakupy. Opis jednym zdaniem napisz sam, pokaż mi go i idź dalej bez pytania.
- Pola profilu projektu, które LoadCraft każe sprawdzić, przyjmij tak, jak je odczytał.
- Gdyby padło pytanie, którego tu nie ma, przyjmij opcję zalecaną, powiedz, którą przyjmujesz, i idź dalej.

Na tym kończymy: po zbudowaniu flowów napisz krótkie podsumowanie i nie składaj scenariusza.
