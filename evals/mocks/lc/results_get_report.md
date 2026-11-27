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
