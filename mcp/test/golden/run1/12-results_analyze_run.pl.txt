werdykt        fail · pewność wysoka
przyczyna      POST /checkout: transakcja bazy obejmuje wywołanie
               bramki płatności · blokada wiersza w tabeli orders
zmiana skokowa T+6:10 · POST /checkout średnio 240 → 1 310 ms
błędy          504 × 2 480 · tylko POST /checkout
dowody (via MCP · sklep-logs, cały test)
               „Lock wait timeout exceeded; try restarting transaction”
rekomendacja   zapis zamówienia poza transakcją płatności
↗ https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/gatling/executions/3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42?tab=AI%20analysis
