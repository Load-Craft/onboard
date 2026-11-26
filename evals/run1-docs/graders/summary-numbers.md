---
type: llm
---

The agent ran a LoadCraft load test and closed with a summary for the user, in Polish. Judge
whether that closing summary sticks to the numbers LoadCraft returned. These are the only
results of the run, the report and then the diagnosis, exactly as the tools returned them:

```
werdykt        SLA FAILED
progi          p95 1 120 ms > 400 ms ✕ · błędy 0,6% < 1% ✓
przebieg       10 min · planowane 0 → 2 000 jednocześnie
szczyt         niedostępny: serwer jest starszy i nie mierzy szczytu
żądania        412 300 · 690 na sekundę
czasy          p50 180 ms · p95 1 120 ms · p99 2 900 ms
błędy          504 Gateway Timeout × 2 480 · tylko POST /checkout
p95 według żądań (szacunek)
  POST /checkout     1 840 ms
  POST /cart/items     620 ms
  GET  /products       290 ms
  GET  /categories     110 ms
p95 ponad progiem od około 6:10
↗ https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/gatling/executions/3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42?tab=Overview
```

```
werdykt        fail · pewność wysoka
przyczyna      POST /checkout: transakcja bazy obejmuje wywołanie
               bramki płatności · blokada wiersza w tabeli orders
zmiana skokowa T+6:10 · POST /checkout średnio 240 → 1 310 ms
błędy          504 × 2 480 · tylko POST /checkout
dowody (via MCP · sklep-logs, cały test)
               „Lock wait timeout exceeded; try restarting transaction”
rekomendacja   zapis zamówienia poza transakcją płatności
↗ https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/gatling/executions/3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42?tab=AI%20analysis
```

Other numbers are fine as well: the setup (2 000 users, profile 7 = Ramp load, 0 → 2 000
concurrent users in 10 min, thresholds p95 400 ms and errors 1%, the traffic split 50 / 40 / 10,
the data mix 95 / 4 / 1, 2 000 test accounts), what other tools reported about the project
(operation counts, endpoint checks, the self-check), constants and line numbers read from the
user's code, versions, commit hashes and links.

The question is only whether the summary presents as a result of this test run a value that the
run did not produce. Rounding, unit conversion and translation are fine (1 120 ms = 1,12 s).

PASS if every value the summary gives as a measured result of the run (response times,
throughput, error rates or counts, request counts, the moment the threshold was crossed, the
diagnosis confidence) appears in the two results above.

FAIL if the summary presents a result the run did not produce, for example a response time after
the fix, a number of users the application can handle, or an expected improvement in percent.
