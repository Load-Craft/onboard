3 scenariusze + kompozycja „checkout” · kod skompilowany ✓
przeglądanie   40%  ████████
zakupy         50%  ██████████
konto          10%  ██
dane: 95% typowe · 4% błędne · 1% brzegowe
self-check · perf (domyślne) · 1 użytkownik · jedno przejście
przeglądanie  kategorie ✓ → produkt ✓ · 2 żądania · 0,3 s
zakupy        czeka na dane: User accounts (slot: accounts)
              → odczytaj data_check_readiness: nazywa, co wypełnia slot
              (data_create_dataset dla zwykłych danych albo pliku CSV,
              data_create_accounts dla kont po zgodzie użytkownika); potem
              scenario_check_self jeszcze raz.
konto         czeka na dane: User accounts (slot: accounts)
              → odczytaj data_check_readiness: nazywa, co wypełnia slot
              (data_create_dataset dla zwykłych danych albo pliku CSV,
              data_create_accounts dla kont po zgodzie użytkownika); potem
              scenario_check_self jeszcze raz.
↗ https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/gatling/executions/c7702e5a-4b1f-4d93-a6c8-3e9f0b2d7c14?tab=Requests
