Profile obciążenia dla 2 000 użytkowników na perf
Środowisko perf nie ma limitów obciążenia.
  1. Smoke                   1 użytkownik, jedno przejście (domyślny)
  2. Ramp                    2 000 rozłożonych na 10 min
  3. Constant rate           4 nowych/s przez 15 min
  4. Ramp + hold             4 w 1 min, potem 4 nowych/s przez 15 min
  5. Stress stairs           5 stopni po 3 min, do 10 nowych/s
  6. Constant load (closed)  2 000 jednocześnie przez 15 min
  7. Ramp load (closed)      0 → 2 000 jednocześnie w 10 min
  8. Spike                   1 000 naraz, 1 min przerwy, potem 2 000
  9. Soak                    1 000 jednocześnie przez 2 h
  Argument „profile” dla run_start, pod numerem z listy:
    1. {"type":"smoke","vusers":1}
    2. {"type":"ramp","vusers":2000,"ramp":600}
    3. {"type":"constant","vusers":4,"hold":900}
    4. {"type":"ramp_hold","vusers":4,"ramp":60,"hold":900}
    5. {"type":"stress","vusers":10,"ramp":180}
    6. {"type":"constant_concurrency","vusers":2000,"hold":900}
    7. {"type":"ramp_concurrency","vusers":2000,"ramp":600}
    8. {"type":"spike","vusers":1000,"ramp":60,"hold":60}
    9. {"type":"soak","vusers":1000,"ramp":60,"hold":7200}
dalej: run_start z wybranym profilem, jego linia powyżej jako „profile”.
