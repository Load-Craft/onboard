---
name: run3-describe
description: Run 3 of the session mock-up on the sklep repository - flows from a description walked by the LoadCraft browser. Grades flows_describe_journeys before flows_record_journeys, the account given as a file path and the plan handle taken from the result.
tags: [run3]
runs: 3
model: claude-sonnet-5-5
allowed_tools: [Skill, Read, Glob, Grep, ToolSearch, TaskCreate, TaskUpdate]
max_turns: 60
timeout_seconds: 1200
---

Zrób test wydajnościowy checkoutu w LoadCraft na 2 000 użytkowników. Flowy chcę z opisu: niech przeglądarka LoadCraftu przejdzie ścieżki na naszym środowisku testowym.

Nie będę odpowiadać na pytania w trakcie, więc decyzje podaję z góry:

- Dokumentacja API: loadcraft/openapi.json została sprawdzona przed sesją, jest aktualna dla kodu, który testujemy, i przechodzi walidator. W tej sesji nie masz powłoki (Bash), więc jej nie generuj ani nie aktualizuj, tylko idź dalej.
- Środowiska: adresy perf i qa są w plikach .env.perf i .env.qa. Dev: API https://api.dev.example.com, frontend https://dev.example.com. Prod: API https://api.example.com, frontend https://example.com.
- qa i prod są współdzielone, chroń je limitem obciążenia: qa 100 użytkowników / 20 zapytań/s, prod 20 użytkowników / 5 zapytań/s. perf i dev bez limitu.
- Testujemy na perf. Logów aplikacji nie podłączaj.
- Flowy buduj z opisu, nie z dokumentacji. Opis: klienci logują się, wyszukują produkt, dodają go do koszyka, wpisują kod rabatowy i płacą; część tylko przegląda kategorie i produkty; zalogowani oglądają swoje zamówienia.
- Konto testowe dla przeglądarki jest w pliku .env.perf. Nie czytaj jego wartości.
- Plan ścieżek zatwierdzam z góry, jeśli zawiera zakupy, przeglądanie i konto: nagraj wszystkie trzy. Zgoda na przejście przeglądarki po perf: tak.
- Pola profilu projektu, które LoadCraft każe sprawdzić, przyjmij tak, jak je odczytał.
- Gdyby padło pytanie, którego tu nie ma, przyjmij opcję zalecaną, powiedz, którą przyjmujesz, i idź dalej.

Na tym kończymy: po zapisaniu flowów napisz krótkie podsumowanie i nie składaj scenariusza.
