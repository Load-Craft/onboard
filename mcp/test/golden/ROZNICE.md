# Wzorce widoków — różnice względem makiety

Pliki `run1/` … `run5/` to dokładny tekst wyników narzędzi LoadCraft z pięciu przebiegów makiety
sesji (sekcja „Jak to działa”, scenariusz w wersji 2 z 2026-11-22), w języku `pl`. Tekst jest wycięty
bez prefiksu `⎿` i bez pięciu kolumn wcięcia wyniku. Wzorzec opisuje prawdziwy produkt, nie animację:
tam, gdzie produkt musi się różnić, wzorzec jest poprawiony, a każda poprawka jest opisana niżej
z powodem i odwołaniem do karty narzędzia w `02-narzedzia-mcp.md`. Wszystko, czego tu nie ma,
jest przepisane z makiety bez zmian (liczby, kolejność, słowa, wyrównanie kolumn).

Kolejność plików w przebiegu i pliki wspólne dla kilku przebiegów: `index.ts` (`GOLDEN_FILES`).
Identyfikatory świata „sklep” użyte w linkach i uchwytach: `index.ts` (`SKLEP_IDS`).

Zmiana wzorca wymaga wpisu w tym pliku i zgody koordynatora. Widok niezgodny ze wzorcem naprawia
się w widoku.

## Różnice

### R1. Identyfikatory to skróty prawdziwych UUID

| Makieta  | Wzorzec      | Pliki                                                                     |
| -------- | ------------ | ------------------------------------------------------------------------- |
| `e-7731` | `e-3f9a12c4` | `run1/10-run_start`, linki w `run1/10-run_start` i `12-…`                 |
| `e-7735` | `e-8c2d4f17` | `run5/11-run_start-qa`                                                    |
| `r-2481` | `r-2481a3f0` | `run3/03-flows_describe_journeys`, link w `run3/04-flows_record_journeys` |
| `e-7702` | pełny UUID   | link w `run1/06-scenario_generate-generowanie`                            |

Powód: uchwyt to `e-`/`r-` i 8 pierwszych znaków UUID z backendu; w linku stoi pełny UUID.
Odwołanie: karta 15 (`wykonanie e-3f9a12c4`), karta 8 (`plan r-2481a3f0`).

### R2. Linki to pełne adresy z prawdziwych tras frontendu

`↗ app.loadcraft.io/…/x` → `↗ app.loadcraft.io/projects/<uuid projektu>/…`:

| Plik                                                                                                   | Trasa                                                        |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `01e-project_apply_setup` (run1, run4)                                                                 | `/projects/<id>/settings#application-profile`                |
| `04-flows_generate_from_suggestions`, `03-flows_generate_from_endpoints`, `04-flows_generate_from_har` | `/projects/<id>/flows/<uuid flow>` (zamiast nazwy `zakupy`)  |
| `run3/04-flows_record_journeys`                                                                        | `/projects/<id>/scenario-from-description/runs/<uuid>`       |
| `run1/06-scenario_generate-generowanie`                                                                | `/projects/<id>/gatling/executions/<uuid>?tab=Requests`      |
| `10-run_start`, `11-run_start-qa`                                                                      | `/projects/<id>/gatling/executions/<uuid>/live`              |
| `run1/12-results_analyze_run`                                                                          | `/projects/<id>/gatling/executions/<uuid>?tab=AI%20analysis` |

Powód: link ma prowadzić do strony; trasa flow przyjmuje identyfikator, nie nazwę. Trasy sprawdzone
w routerze frontendu LoadCraft. Odwołanie: karty 2, 6, 9, 11, 15, 19.

**Skutek dla szerokości linii:** pełny adres z dwoma UUID ma do 138 znaków. Linii z linkiem nie
łamiemy (złamany adres przestaje działać), więc test szerokości (77 znaków) pomija linie, które są
wyłącznie strzałką `↗`, opcjonalną etykietą i jednym adresem `app.loadcraft.io`.

### R3. `run_start`: stan końcowy zamiast animowanej linii, postęp w osobnym pliku

Makieta pokazuje migawkę w trakcie testu (`6:40 · 1 520 jednocześnie · p95 910 ms · błędy 0,6%`
i mini-wykres), a potem zdanie agenta „Test zakończony po 10 min.”. Wynik narzędzia jest statyczny,
więc:

- `10-run_start` / `11-run_start-qa` — stan końcowy: pierwsze linie bez zmian, link (R2), linia
  `budowanie ✓ 18 s · test 10:00 / 10:00 · p95≈ … · błędy …`, mini-wykres z makiety, linia
  `test zakończony · wykonanie e-… · dalej: results_get_report`;
- `10-run_start-postep` / `11-run_start-qa-postep` — komunikat postępu w chwili 6:40:
  `6:40 / 10:00 · <żądania/s> · p95≈ … · błędy …`.

Szczegóły:

- `p95≈` zamiast `p95` — w trakcie testu p95 to szacunek z histogramu;
- „żądania/s” zamiast „jednocześnie” — liczby użytkowników w locie nie ma w odczycie wyniku przez
  REST (jest tylko w gnieździe wykonania, którego serwer MCP nie używa); mini-wykres rysowany jest
  z żądań/s;
- perf: końcowe `p95≈ 1 120 ms` i `690 żądań/s` w postępie — liczby z karty 15 (zgodne z raportem);
- qa (przebieg 5, analogicznie do perf): końcowe `p95≈ 210 ms` i `18 żądań/s` w postępie — liczby
  z raportu qa; `budowanie ✓ 18 s` jak na perf; błędy `0,0%` jak w migawce makiety; mini-wykres
  qa przepisany z makiety (płaski).

- `11-run_start-qa`: dodatkowa linia `przycięty do 100: ten wynik nic nie mówi o pełnym obciążeniu` przed linią końcową — test przycięty limitem środowiska nie mówi nic o pełnym obciążeniu, a widok końcowy ma to powiedzieć sam (makieta tego nie miała).
- mini-wykres: do 14 kolumn ze średnich bloków serii żądań/s z wyniku biegu, skala od najniższej do najwyższej kolumny, a seria różniąca się o mniej niż 10% szczytu jest płaska (najniższy blok) — stąd płaski wykres qa.

Odwołanie: karta 15, „Różnice względem makiety”.

### R4. `scenario_generate`: czas bez słowa „odpowiedzi”

`· 2 żądania · odpowiedzi 0,3 s` → `· 2 żądania · 0,3 s` (`run1/06-scenario_generate-generowanie`).
Odwołanie: karta 11, wynik.

### R5. `scenario_check_self`: czas bez słowa „odpowiedzi”, naprawa bez kodu HTTP

- `4 żądania · odpowiedzi 1,2 s` → `4 żądania · 1,2 s`, tak samo `0,4 s`, `1,3 s`, `1,4 s`
  (`run1/09-scenario_check_self`, `run2/10-scenario_check_self-naprawa`, `run3/09-scenario_check_self-rabat`);
- przebieg 2: `→ zamówienie ✕ POST /checkout 403` → `→ zamówienie ✕ POST /checkout` — kod statusu
  nieudanego żądania nie był zapisywany w wyniku self-checku, więc widok go nie znał. HISTORYCZNE: backend
  podaje już status kroku, a przebieg 2 wygląda tak, jak opisuje wpis o próbach po naprawie niżej.

Odwołanie: karta 13 (wynik i uwaga o kodzie statusu).

### R6. `flows_describe_journeys`: uchwyt planu w wyniku

`plan · 3 ścieżki · …` → `plan r-2481a3f0 · 3 ścieżki · …` (`run3/03-flows_describe_journeys`).
Powód: następne wywołanie (`flows_record_journeys(plan: …)`) potrzebuje uchwytu — tak jak `results_get_report`
dostaje `e-3f9a12c4` z wyniku `run_start`. Odwołanie: karta 8, wynik.

### R7. `flows_record_journeys`: stan końcowy, postęp w osobnym pliku

Makieta animuje linie ścieżek (`zakupy 3/5 · klika: koszyk…`, `czeka…`) i podaje osobno „stan końcowy”.
Wynik narzędzia jest statyczny, więc:

- `run3/04-flows_record_journeys` — nagłówek (przeglądarka, link do podglądu, zdanie o przejęciu sterowania)
  i stan końcowy z makiety;
- `run3/04-flows_record_journeys-postep` — trzy linie animowanego stanu jako komunikat postępu, bez dopisku
  „(animowane)”.

Odwołanie: karta 9 (wynik w trakcie = postęp; końcowy: status ścieżek, konspekt, link do podglądu).

### R8. Zakładanie kont: partie po 50 kont

`(2 × 1 000)` → `(40 × 50)` (dziś `run1/08-data_create_accounts`). Powód: serwer MCP zakłada konta
partiami po 50 i raportuje postęp po każdej partii (jedno wywołanie zakładania jest synchroniczne
i trwa do kilku sekund na konto). Odwołanie: karta 12, łańcuch `provision` i wynik.

### R9. Przebieg 2: `flows_suggest_journeys` ma ten sam wynik co w przebiegu 1

Makieta skraca wynik w przebiegu 2 do `4 propozycje: zakupy, przeglądanie, konto, status zamówienia`.
Wywołanie jest to samo (`flows_suggest_journeys(project: "sklep")`), a widok nie ma trybu skróconego,
więc przebieg 2 wskazuje na `run1/03-flows_suggest_journeys`. Odwołanie: karta 5 (jeden format wyniku).

### R10. Separator tysięcy to wąska spacja nierozdzielająca (U+202F)

Makieta grupuje tysiące zwykłą spacją (`2 000`, `412 300`, `1 120 ms`). We wzorcach separatorem jest
U+202F NARROW NO-BREAK SPACE: liczba nie łamie się na końcu linii w terminalu i nie da się jej
pomylić ze spacją wyrównującą kolumny. Widoki biorą ten znak z jednej stałej renderera.
Dotyczy każdej liczby od 1000 wzwyż we wszystkich plikach (14 linii w `run1/08`, `run1/10`,
`run1/11`, `run1/12`, `run5/11`, `run5/12`). Nie dotyczy etykiety i wartości obok siebie
(`p50 180 ms`, `p95 210 ms` — tam zostaje zwykła spacja). Test `thousands grouped with U+202F`
pilnuje obu stron. Podstawa: decyzja koordynatora z 2026-11-22 (makieta i karty w
`02-narzedzia-mcp.md` tego nie rozstrzygają).

### R11. Etykiety slotów danych pochodzą z backendu, nie z makiety

Makieta nazywa sloty po polsku (`frazy wyszukiwania`, `zamówienia`, `konta`). Etykietę slotu
wystawia backend (`derive_slot_label`, `backend/domain/services/gatling/feeders/semantics.py:368`)
i jest ona angielska: slot z rolą `auth` to `User accounts`, kolumna `q` daje `Search terms`,
kolumny `quantity` i `cardNumber` dają `Quantity & cardnumber`. Widok pokazuje etykietę z backendu
(użytkownik może ją zmienić w Test Data Hub), więc wzorce ją trzymają:

| Makieta              | Wzorzec                 | Pliki                                                                             |
| -------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `frazy wyszukiwania` | `Search terms`          | `run1/07-data_check_readiness-plan`, `run5/08-data_check_readiness-plan-qa`       |
| `zamówienia` (slot)  | `Quantity & cardnumber` | jw.                                                                               |
| `konta` (slot)       | `User accounts`         | jw. oraz `czeka na dane: User accounts` w `run1/06-scenario_generate-generowanie` |

Nazwy zbiorów danych (`feeder.name`: `konta` itd.) zostają polskie: `konta  2 000 założonych …`
w `run1/08-data_create_accounts` i `konta muszą istnieć na perf` w propozycji danych to nazwa zbioru, nie
etykieta slotu. Zgoda koordynatora, 2026-11-22.

## Uzupełnienie makiety (makieta podaje tylko różnicę)

### U1. Przebieg 4: konfiguracja projektu bez dokumentacji

Makieta mówi: pierwsza linia `Projekt „sklep” · bez dokumentacji API`, linia analizy
`analiza projektu: brak materiałów · profil uzupełni nagranie HAR`, bez linii zgodności. Pozostałe
linie wzięte z przebiegu 1, z dwiema decyzjami:

- bez linii `profil: 9 pól, …` i `profil zastosowany ✓ · walidatory 5 · typy testów 3` — bez
  materiałów nie ma propozycji profilu (profil, w tym logowanie, uzupełnia nagranie HAR; logowanie
  pokazuje dopiero `flows_import_har`);
- `perf ★  domyślne` — linia środowiska bez części o zgodności.

Odwołanie: karta 2 („Bez dokumentacji”).

## Świadomie bez zmian

Karty w `02-narzedzia-mcp.md` różnią się od makiety jeszcze w tych miejscach. Żadna z tych różnic nie
wynika z ograniczenia produktu, więc wzorzec trzyma tekst makiety:

- `flows_suggest_journeys` (karta 5): bez linii pokrycia (`38 z 42 operacji · 4 poza ścieżkami`);
- `flows_generate_*` (karta 6): przykład karty ma pauzy `1–3 s założona`; wzorzec trzyma długości pauz
  dobrane do czynności z makiety (czynność zastąpiła klasa akcji — R13);
- plan danych (karta 12): karta tłumaczy `Samples a model wrote` na „próbki od modelu”; wzorzec
  trzyma nazwę z frontendu (makieta: nazwy z produktu po angielsku);
- `project_import_docs` (karta 4): karta mówi, że widok wspomina o nieodświeżonym profilu i typach testów;
  makieta tej linii nie ma;
- przebieg 2, `flows_generate_from_suggestions`: makieta ma jedną linię
  `2 flowy gotowe · przeglądanie 3 kroki · konto 3 kroki`, karta 6 — pierwszy flow w całości i link;
  wzorzec trzyma makietę, bo konspektu „przeglądanie” makieta nie podaje;
- przebieg 5, plan danych: `konta muszą istnieć na qa`, choć dawne narzędzie danych (karta 12) nie
  miało parametru środowiska.

### R12. Linki ze schematem `https://`

Makieta ma `↗ app.loadcraft.io/…`; wzorce mają `↗ https://app.loadcraft.io/…` (z etykietą tylko
tam, gdzie widok ją pokazuje: `↗ podgląd na żywo: https://…`). Powód: adres ze schematem jest klikalny
w terminalu i w markdownie. Zgoda koordynatora (FIX-02); `LINK_LINE` w `golden.test.ts` wymaga schematu.

### R13. Pauza w konspekcie: klasa akcji następnego żądania zamiast czynności; pauzy z HAR do 10 s

Dotyczy wzorców `run1/04`, `run2/03`, `run3/04`, `run4/04` (konspekt „zakupy”).

Makieta opisuje pauzę czynnością osoby: `założona · wpisuje frazę`. Backend tej czynności nie zapisuje:
opis pauzy to stałe zdanie po angielsku (`flow_generation/service.py:592`, `:1768`), a pauzy z nagrania
w ogóle nie mają opisu (`think_time.py:99`). Zna za to klasę akcji następnego żądania
(`config.action_start.class`). Wzorzec pokazuje ją słowem: `strona`, `akcja w stronie`, `formularz`
(`założona · formularz`). Klasa `api_call` nie jest akcją osoby i nie ma słowa. Fixtury `zakupy-*` i
świat „sklep” dostały opisy pauz takie jak w backendzie — atrapa nie może dawać tego, czego backend nie daje.

Pauzy z nagrania HAR backend przycina do 10 s (`THINK_TIME_MAX_MS`, `think_time.py:32`), więc
`run4/04` ma `10 s` tam, gdzie makieta miała `16,8 s` i `31,5 s`. Pauzy z założenia (`3–8 s`,
`20–45 s`) tego limitu nie dotyczą — są w modelu pauzy do 60 s.

Zgoda koordynatora: decyzja „OUT-01 znaleziska → decyzje dla TOOL-07”.

### R14. `flows_import_har`: grupy akcji zamiast „ścieżek”

Makieta: `3 ścieżki w nagraniu: zakupy, przeglądanie, konto`; wzorzec: `3 grupy akcji w nagraniu: …`
(`run4/03-flows_import_har`). Powód: `analyze` zwraca grupy akcji (`action_groups`), a podróże użytkownika
powstają dopiero przy generowaniu flow, więc „ścieżka” obiecywałaby coś, czego to narzędzie jeszcze
nie wie. Nazwy grup mogą być inne niż nazwy późniejszych flowów. Odwołanie: karta 10, decyzja koordynatora.

### R15. `run_plan`: wzorce nie istnieją w makiecie, powstały z jej tekstu asystenta

Makieta pokazuje listę profili tylko jako tekst asystenta (krok 06), nie jako wynik narzędzia.
Wzorce `run1/09a-run_plan` (perf, 2 000 użytkowników, bez limitów) i
`run5/09a-run_plan-qa` (qa, limit 100 / 20 nowych/s) mają dziewięć linii z makiety
(nazwy i opisy z przebiegu perf), a obok nich plik `*.view.json` z danymi, z których widok się rysuje.
Różnice względem tekstu makiety:

- nagłówek (`Profile obciążenia dla 2 000 użytkowników na perf`) i linia limitu środowiska
  (`Limit środowiska qa: 100 użytkowników / 20 nowych/s.`, albo `… nie ma limitów obciążenia.`);
- numer i nazwa w jednej kolumnie (`1. Smoke`), `(domyślny)` na końcu opisu Smoke;
- qa: opisy zostają z przebiegu perf (makieta skraca je do szerokości kolumny), dopisek
  `→ przycięty do 100` stoi w tej samej linii, gdy się mieści, a pod opisem, gdy nie;
- qa, Spike: `→ przycięty do 50 (limit 100 ÷ 2: druga seria jest 2× większa od pierwszej)` zamiast
  makietowego „przycięty do 100”. Powód: backend przycina spike do `max_vu // 2`, żeby szczyt
  drugiej serii (2×) mieścił się w limicie;
- pod listą blok `Argument „profile” dla run_start, pod numerem z listy:` z jednym wierszem JSON na profil
  (`2. {"type":"ramp","vusers":2000,"ramp":600}`): model dostaje wyłącznie tekst, a obiektu profilu nie da się
  odtworzyć z opisów słownych;
- ostatnia linia `dalej: run_start z wybranym profilem, jego linia powyżej jako „profile”` (jak `dalej: results_get_report` w innych wynikach).

Liczby profili dla `target_users` to reguła produktu pluginu (`mcp/src/profiles/presets.ts`),
nie kod kreatora: kreator ma tylko stałe wartości domyślne.

### R16. Dane testowe: konta z pliku i zastosowanie planu — wzorce spoza makiety

Makieta nie pokazuje akcji `accounts_file` ani `apply`. Wzorce `run1/08a-…-konta-z-pliku` i
`run1/08b-…-apply` (każdy z plikiem `*.view.json`; dziś wyniki `data_create_dataset` i `data_suggest_actions`, wpis „Krok danych to cztery narzędzia”) powstały ze specyfikacji karty 12:

- `08a`: `konta  2 wiersze z data/konta.csv · hasła zamaskowane` — linia ze specyfikacji
  (`konta  N wierszy z <plik> · hasła zamaskowane`), potem zamknięcie planu jak w `08-data_create_accounts`;
  przy nowej rewizji istniejącego zbioru dochodzi `· nowa rewizja zbioru`;
- `08b`: nagłówek `zastosowano N akcji planu`, po jednej linii na akcję (`bind`, `create_dataset` z reguł),
  potem `pominięto N:` z powodem każdej pominiętej akcji (zakładanie kont zawsze osobnym wywołaniem)
  i zamknięcie planu. Liczba wierszy zbioru z reguł stoi jako `wierszy: 300`, żeby nie odmieniać.

Ponieważ plik z kontami opisuje `run1/08a`, a plan z `apply` — `run1/08b`, oba są wpisane do przebiegu 1
tuż za `08-data_create_accounts`, choć makieta tych kroków nie ma. Wymaga zgody koordynatora.

### R17. Konfiguracja projektu: pola profilu do sprawdzenia wypisane pod widokiem

Makieta ma w linii profilu tylko liczbę (`9 pól, 2 do sprawdzenia`); wzorzec dawnego kroku 01 (jedno narzędzie konfiguracji; dziś `run1/01e-project_apply_setup`)
dopisuje pod liniami środowisk blok `do sprawdzenia, zapytaj użytkownika:` z jedną linią na pole
(`nazwa: wartość (źródło)`; źródło `model`, gdy pole napisał model, inaczej nazwa materiału, np.
`openapi`). Powód: model widzi wyłącznie tekst widoku, a zlecenie wymaga, by agent miał o te pola
zapytać — bez nazwy pola, wartości i źródła nie ma o co. Odwołanie: karta 2 (krok 8), zlecenie TOOL-04.

### R18. Zakładanie kont na wybranym środowisku: wzorzec przebiegu 5

Makieta przebiegu 5 pokazuje tylko plan danych na `qa` (`run5/08-data_check_readiness-plan-qa`), a przebieg
korzystał z wzorca `run1/08-data_create_accounts`, który środowiska nie nazywa. Wzorzec
`run5/08a-data_create_accounts-qa` (z plikiem `*.view.json`) powstał ze specyfikacji karty 12:

- pierwsza linia nazywa środowisko po operacji rejestracji: `konta  2 000 założonych przez POST /auth/register na qa (40 × 50)`;
  partie `(40 × 50)` zostają jak w R8;
- zamknięcie planu jak w `run1/08-data_create_accounts` (plan `qa` po zapisaniu kont);
- środowisko jest nazwane tylko wtedy, gdy wywołanie je wybrało (`environment`); bez niego widok jak
  w `run1/08-data_create_accounts`. Dotąd osobna linia `środowisko qa` pod pierwszą linią zastąpiona
  przez `na qa` w pierwszej linii.

Wymaga zgody koordynatora.

### R19. `project_import_docs`: linia „profil i typy testów nie są odświeżane” tylko przy nieodświeżonych typach

Karta 4 każe widokowi wspomnieć, że nowa specyfikacja nie odświeża profilu ani typów testów; makieta tej
linii nie ma (patrz lista różnic kart wyżej), a decyzja koordynatora z 22.11 mówi, że linia warunkowa
pojawia się tylko, gdy warunek zachodzi. Widok dopisuje ją (i link do profilu aplikacji) wtedy, gdy projekt
ma typy testów wygenerowane z innej wersji dokumentacji niż nowo wysłana
(`test_types_generated_from_spec_id` ≠ `openapi_spec_id` po wysyłce). Wzorzec `run5/03-project_import_docs` jest
szczęśliwą ścieżką bez tej linii; wariant z linią ma migawka `test/__snapshots__/updateOpenapi.stale.en.txt`
i test w `tools.updateOpenapi.test.ts`. Wzorzec ma też `flowów do migracji: 0` — świat testowy ma flowy
niepowiązane z wersją dokumentacji; przy powiązanych widok liczy je (`co najmniej N`, gdy lista flowów
projektu jest ucięta do 100).

### R20. `process_get_status` z `preflight` i z `operation`: wzorce spoza makiety w `mod/`

Makieta nie ma tych dwóch odpowiedzi: służą warstwie interfejsu (modowi), nie sesji z modelem.
Wzorce leżą w `test/golden/mod/` (`en` i `pl`, jedna linia, części połączone `·`) i nie wchodzą do
`GOLDEN_RUNS`; porównują je `tools.getStatus.preflight.test.ts` i `tools.getStatus.operation.test.ts`:

- `preflight-qa-clamped` — sprawdzenie przed `run_start` (`process_get_status` z `preflight`) na chronionym `qa` z limitem 100 użytkowników: cel i
  środowisko, limit, profil z przycięciem (`2 000 → 100`), czy potrzebna zgoda, czy dane wystarczają,
  planowany czas, czy środowisko jest wolne;
- `status-operation-test_run` — migawka trwającego testu: uchwyt, faza, czas od startu, czas testu z
  planem i liczby w tej samej postaci co linia postępu `run_start`.

Dane tych odpowiedzi (JSON przy `format: "data"`) nie mają wzorca tekstowego: ich kształt pilnują testy.

### R21. Tekst błędu narzędzia zaczyna się od `[kod] `

Wzorce widoków nie obejmują błędów narzędzi, więc żaden wzorzec się nie zmienił. Każdy błąd
(`ToolError`, błąd z katalogu HTTP, błąd wewnętrzny) ma w pierwszym wierszu `[kod] ` przed komunikatem,
w obu językach — model widzi tylko tekst, a skill opisuje „co dalej” po kodach. Kod spoza kształtu
`[a-z][a-z0-9_]*` (z ciała odpowiedzi backendu) jest podawany jako `unknown`.

### R22. Przebieg 1 na prawdziwych danych świata „sklep”: linie, których makieta nie pokazuje

Test `test/e2e/run1.test.ts` woła narzędzia przebiegu 1 na jednym stanie atrapy i porównuje tekst każdego
wyniku ze wzorcem w całości. Trzy wzorce mają więc linie, których makieta nie ma, a narzędzie je daje:

- `run1/03-flows_suggest_journeys`: pod propozycjami linia `8 z 42 operacji · 34 poza ścieżkami` i lista nazw
  operacji poza ścieżkami (pięć nazw, reszta jako `i jeszcze 29`). Makieta zakładała pokrycie 42 z 42;
  cztery propozycje o dwóch–czterech krokach obejmują osiem operacji. Nazwy poza ścieżkami są angielskimi
  podsumowaniami operacji świata (`Register an account`…), bo to tekst z dokumentacji API.
- `run1/09-scenario_check_self`: ostatnia linia to link do żądań ostatniego przejścia
  (`↗ …/gatling/executions/<uuid>?tab=Requests`).
- `run1/11-results_get_report`: ostatnia linia to link do przeglądu wykonania (`↗ …/gatling/executions/<uuid>?tab=Overview`).

Dwie rzeczy w wywołaniach różnią się od makiety, bo tak wymaga kontrakt narzędzi, nie widok:
`scenario_suggest_split` dostaje `flows` w kolejności wzorca (`przeglądanie`, `zakupy`, `konto`), bo narzędzie
pokazuje propozycję w kolejności przekazanych przepływów; `results_analyze_run` dostaje `force: true`, bo atrapa
uruchamia analizę, kopiując zapisaną analizę świata.

Wymaga zgody koordynatora.

### R23. Moment przekroczenia progu p95 podany jako przybliżony

Linia o progu p95 w `results_get_report` dostaje słowo „około” przed czasem: `p95 ponad progiem od około 6:10`,
`p95 chwilowo ponad progiem (około 2:00)`. Oś czasu serii jest liczona od pierwszej próbki Prometheusa,
a nie od startu testu, więc to przybliżenie; bez słowa model powtarzał je jako dokładny czas.
Dotyczy `run1/11-results_get_report.pl.txt`.

Podpowiedź „dalej” w `process_get_status`, gdy wszystko gotowe do testu albo ostatni test ma analizę, brzmi
„dalej: wybierz środowisko i profil, potem run_start — …”: serwer nie pamięta wybranego środowiska, więc nie może
kierować prosto do `run_start`. Wzorce QA-01 nie obejmują `process_get_status` w tych stanach; zmiana dotyczy
migawek `getStatus.executed.*.txt`.

Wymaga zgody koordynatora (zlecenie FIX-09).

### R24. Slot nazwany etykietą i kluczem: `Etykieta (slot: klucz)`

Model widzi tylko tekst wyniku, a narzędzia danych przyjmują w parametrze `slot`
KLUCZ slotu (`accounts`), nie etykietę (`User accounts`). Widoki, które wymieniają sloty danych, podają więc
oba: `User accounts (slot: accounts)`; gdy etykieta jest równa kluczowi, jest on podany raz. Zmiana dotyczy
dwóch wzorców:

- `run1/07-data_check_readiness-plan` i `run5/08-data_check_readiness-plan-qa`: pierwsza kolumna wiersza slotu ma klucz, więc jest
  szersza, a szczegóły (kolumny, źródła, scenariusze) zawijają się pod kolumną stanu. Lista scenariuszy
  nie jest już gubiona, gdy wiersz się nie mieści: wiersz „Quantity & cardnumber” dostaje na końcu `zakupy`,
  którego wcześniej nie miał.
- `run1/06-scenario_generate-generowanie`: linie `czeka na dane: User accounts (slot: accounts)`.

W `.view.json` tego ostatniego `missingSlots` to lista `{ "slot", "label" }`, nie lista etykiet. Ten sam zapis
mają teraz fakty `process_get_status` (sekcja danych, podpowiedź „dalej”, sprawdzenie przed testem), `run_plan`
i odmowa `run_start` z powodu danych; wzorców QA-01 nie obejmują, więc zmieniły się tylko migawki w `test/__snapshots__`.

Wymaga zgody koordynatora (zlecenie FIX-10).

### R25. Każdy flow zbudowany z nagrania ma swój link

Model widzi tylko tekst wyniku, więc identyfikator każdego zbudowanego flow musi w nim być.
`flows_generate_from_har` dodaje linię `↗ https://…/flows/<id>` dla każdego flow, nie tylko dla pierwszego:
wzorzec `run4/04-flows_generate_from_har` ma trzy linie linków (zakupy, przeglądanie, konto) w kolejności flowów.
Pozostałe drogi (`flows_generate_from_suggestions`, `flows_generate_from_endpoints`) zmienia osobne zadanie.

Wymaga zgody koordynatora (zlecenie TOOL-23).

### R26. `flows_describe_journeys`: wspólne logowanie obejmuje każdą ścieżkę, która nie zakłada własnego konta

`plan r-2481a3f0 · 3 ścieżki · logowanie wspólne dla: zakupy, konto` →
`plan r-2481a3f0 · 3 ścieżki · logowanie wspólne dla wszystkich` (`run3/03-flows_describe_journeys`).

Powód: LoadCraft loguje się kontem testowym RAZ, przed wszystkimi ścieżkami, a pomija to logowanie tylko
dla ścieżki, która sama zakłada konto (`creates_own_identity` propozycji; reguła `shared_login_is_wanted`,
`backend/domain/services/browser/per_path_drive_coordinator.py:2134-2159` w loadcraft 7d383e0ec). Ramka
`split_proposal` niesie tylko `shared_sign_in: bool`, więc lista ścieżek ze wspólnym logowaniem to ścieżki
bez `creates_own_identity`. „przeglądanie” nie zakłada konta, więc w produkcie też jedzie po wspólnym
logowaniu; makieta, która je pomija, opisuje coś, czego produkt nie robi. Gdy wspólne logowanie obejmuje
wszystkie ścieżki, widok mówi „dla wszystkich” (pełna lista trzech nazw ma 80 znaków); gdy tylko część —
wymienia je po nazwie, a nazwy, które nie mieszczą się w 77 znakach, liczy jako `+N`; bez konta linia nie ma
tej części. Ścieżki z `creates_own_identity` są wymienione w osobnej linii („własne konto, bez wspólnego
logowania: …”, też z `+N`), bo zaczynają w wylogowanej przeglądarce — wzorzec run 3 takich nie ma.

Zgoda koordynatora: wariant C (zlecenie TOOL-30).

### R28. Konfiguracja bez dokumentacji zakłada walidatory i typy testów

`run4/01e-project_apply_setup-without-docs.view.json` (dawniej widok całego kroku 01): `validators` 0 → 5, `testTypes` 0 → 3, `testTypesToReview` 0 → 3,
a `missing` traci `validators` i `test_types`. Tekst wzorca się nie zmienia (przy braku materiałów widok rysuje
tylko linię „analiza projektu: brak materiałów”, bez liczników).

Powód: domyślne walidatory i typy testów LoadCraft bierze z katalogu, nie z dokumentu, więc konfiguracja (dziś `project_apply_setup`) zakłada je
także wtedy, gdy nic nie analizował. Bez nich flowy z nagrania HAR (przebieg 4) nie miałyby typów opartych na
`negative_testing` i `edge_cases`, a wzorzec run4 każe dalej wybrać `data_mix: realistic`, który bez nich kończy się
`data_mix_realistic_unavailable`.

Wymaga zgody koordynatora (zlecenie FIX-22).

### R27. `project_import_docs` na chronionym `qa`: zgodność pominięta

Makieta przebiegu 5 pokazuje `qa  zgodność: 19 GET ✓ · 24 niesprawdzone (nie-GET)`, a ten sam przebieg
zakłada `qa` jako środowisko chronione (`run1/01b-project_save_env`: `qa chronione · limit 100 użytkowników / 20
zapytań/s`). Narzędzie nie wysyła sondy zgodności na środowisko chronione (sonda wysyła prawdziwe żądania,
`src/tools/projectImportDocs.ts`, tak samo jak `project_apply_setup`), więc na chronionym `qa` widok mówi
`qa  zgodność: pominięta — środowisko chronione`. Wzorzec `run5/03-project_import_docs` (tekst i `view.json`:
`conformance.result.state = "skipped"`) opisuje ten przebieg; test jednostkowy `tools.updateOpenapi.test.ts`
rysuje go na świecie z chronionym `qa`. Wariant z sondą (środowisko niechronione) pilnują pozostałe testy tego
narzędzia.

Wymaga zgody koordynatora (zlecenie QA-10).

### R29. `flows_suggest_journeys` po `project_import_docs`: 43 operacje

W przebiegu 5 `flows_suggest_journeys` biegnie po `project_import_docs`, więc dokumentacja ma 43 operacje, nie 42.
Wzorzec `run5/03-flows_suggest_journeys-po-aktualizacji` (z `view.json`) różni się od `run1/03-flows_suggest_journeys`
dwiema liczbami: `8 z 43 operacji · 35 poza ścieżkami` i `i jeszcze 30`. Cztery propozycje i pięć pierwszych
nazw operacji poza ścieżkami są te same (nowa operacja, `GET /status`, jest na końcu listy).

Wymaga zgody koordynatora (zlecenie QA-10).

### R30. `results_get_report`: linia o zmierzonym szczycie użytkowników

Makieta raportu nie zna zmierzonego szczytu jednoczesnych użytkowników. Widok dopisuje go na dwa sposoby.
Gdy serwer ma możliwość `peak_active_users` i podał wartość, szczyt jest w linii `przebieg` obok obciążenia
planowanego: `· szczyt sesji użytkowników w locie naraz: N` (przy modelu otwartym z dopiskiem, że liczba zależy
też od długości ścieżki). W każdym innym przypadku raport nie podaje liczby i mówi wprost dlaczego, w osobnej
linii `szczyt  niedostępny: <powód>` (serwer starszy, test kompozycji, test bez zapisanego szczytu).

Wzorce `run1/11-results_get_report` i `run5/12-results_get_report-qa` (tekst i `view.json`) powstały na atrapie bez tej możliwości,
więc mają linię `szczyt  niedostępny: serwer jest starszy i nie mierzy szczytu`; reszta raportu bez zmian.

Wymaga zgody koordynatora (zlecenie TOOL-40).

### R31. Każdy flow zapisany przez `flows_record_journeys` ma swój link

Model widzi tylko tekst wyniku, więc identyfikator każdego zapisanego flow musi w nim być (jak R25 dla
nagrania). Wzorzec `run3/04-flows_record_journeys` kończy się trzema liniami `↗ https://…/flows/<id>` w kolejności
ścieżek (zakupy, przeglądanie, konto), pod konspektem pierwszego flow. Link do podglądu na żywo zostaje w
nagłówku, z etykietą, jak w makiecie. Identyfikatory flowów to identyfikatory świata „sklep” (te same co w
`run4/04-flows_generate_from_har`).

Wymaga zgody koordynatora (zlecenie TOOL-31).

### R32. Zakładanie kont osobnym narzędziem `data_create_accounts`

Konta zakłada teraz wyłącznie `data_create_accounts`, które Claude Code potwierdza monitem przy każdym wywołaniu
(`_meta anthropic/requiresUserInteraction`, jak `run_start`); dawne narzędzie danych z polem `provision`
odpowiadało `[provision_moved]` i niczego nie wysyłało (tego narzędzia już nie ma, wpis „Krok danych to cztery narzędzia”). Wzorce zmieniły nazwy, treść widoku zakładania kont została ta sama:

- dawny `run1/08-…-provision` → `run1/08-data_create_accounts` (z `view.json`);
- dawny `run5/08a-…-provision-qa` → `run5/08a-data_create_accounts-qa` (z `view.json`).

Wpisy R8, R16, R18 i R24 opisują te wzorce pod dawnymi nazwami.

Dawny `run1/08b-…-apply`: dwie linie pominiętych akcji nazywają nowe narzędzie —
`konta z pliku albo data_create_accounts` i `zakładanie kont wymaga osobnego narzędzia (data_create_accounts)` zamiast
`… albo provision` i `… osobnego wywołania (provision)`. Model widzi tylko tekst, a pola `provision` w dawnym narzędziu
danych już nie było.

Poza makietą, bez wzorca (migawki w `test/__snapshots__/provisionAccounts.*`): wynik z uchwytem
`account_provision:<id>`, gdy założenie wszystkich kont trwa dłużej niż jedno wywołanie, i widok `process_wait` po
restarcie serwera wtyczki (`450 z 2 000 kont istnieje` i następny krok: to samo wywołanie z tym samym `count`).

Wymaga zgody koordynatora (zlecenie ARCH-14).

### R33. Zastosowanie planu danych dla kompozycji: ile scenariuszy członkowskich dostało pin

Przy kompozycji zbiór jest przypinany w kompozycji i w każdym scenariuszu członkowskim, który czyta slot i którego
kolumny zbiór pokrywa (self-check i przycisk scenariusza czytają piny członka, nie kompozycji). Raport mówi, w ilu
scenariuszach pin trafił, więc każda linia zastosowanej akcji w kompozycji dostaje końcówkę
` · przypięte w scenariuszach: N` (w widoku `applied[].scenarios`, `generated[].scenarios`). Dla pojedynczego
scenariusza linie i pola zostają bez zmian.

Dawny `run1/08b-…-apply`: dwie linie zastosowanych akcji mają tę końcówkę (`1` dla `search_phrases`, `0` dla
`order_details`, bo kolumna `size` zbioru `rozmiary` nie pokrywa kolumn slotu członka); `view.json` ma pola `scenarios`.

Wymaga zgody koordynatora (zlecenie FIX-35).

### R34. `scenario_check_self` i `scenario_generate`: scenariusz czeka na dane — linia „→” z następnym krokiem

Linia `czeka na dane: <slot>` niosła przyczynę, ale nie następny krok (niesie go dopiero `process_get_status` i skill). Po każdym
scenariuszu, który czeka na dane, wynik ma teraz linię z wcięciem kolumny wyniku:
`→ odczytaj data_check_readiness: nazywa, co wypełnia slot (data_create_dataset dla zwykłych danych albo
pliku CSV, data_create_accounts dla kont po zgodzie użytkownika); potem scenario_check_self jeszcze raz.` (od wpisu „Krok danych to cztery narzędzia”; wcześniej
linia odsyłała do planu dawnego narzędzia danych) (zawinięta do szerokości widoku).

`run1/06-scenario_generate-generowanie`: po liniach `zakupy` i `konto` stoją trzy linie podpowiedzi.

Zgoda koordynatora: wiadomość do SK-33 z 23.11 (zlecenie SK-33).

### R35. Nowe nazwy narzędzi we wzorcach i w nazwach ich plików

Czternaście narzędzi zmieniło nazwę 1:1 według mapy przejścia katalogu (`CURRENT_TO_TOOLS` w
`src/catalog.generated.ts`, zmiana `rename` i `rename_and_role`). Wzorce, które nazywają narzędzie w następnym kroku
(np. `potem scenario_check_self jeszcze raz`), mają nową nazwę; pliki wzorców z nazwą narzędzia w nazwie pliku też
(np. `run1/09-scenario_check_self`). Rodzaje operacji w uchwytach `<rodzaj>:<id>` (np. `self_check:<id>`) się nie zmieniają. Nazwy
w opisach wyżej zamieniono tym samym przebiegiem, żeby odwołania do plików były aktualne; opisy dotyczą tych samych
zmian co wcześniej. Pięć narzędzi do podziału i narzędzie profili obciążenia zostały wtedy ze starymi nazwami (zmienione w zleceniu CORE-07).

Zgoda koordynatora: zlecenie CORE-02.

### R36. Krok 01 to pięć wyników: `project_create`, `project_save_env`, `project_check_env`, `project_analyze_setup`, `project_apply_setup`

Dawny krok 01 (jedno narzędzie konfiguracji) dzieli się według mapy przejścia katalogu; wzorzec
`run1/01-…` i `run4/01-…-bez-dokumentacji` zastępuje pięć plików `01a`–`01e` (run4 ma własne `01d` i `01e`,
`01a`–`01c` bierze z run1). Co gdzie przeszło:

- `01a-project_create`: pierwsza linia bez dokumentacji (`Projekt „sklep”`; `· istniejący` dla projektu,
  który już był). Tytuł, liczba operacji i obszarów API przeszły do `01e`.
- `01b-project_save_env`: linie środowisk (rola, limity, nagłówki), ustawiona ochrona i ostrzeżenia o
  różnicach, bez sond i bez zgodności. Środowisko, z którym `project_create` założył projekt, `01b` liczy jako
  istniejące (`created: false`); jego założenie pokazuje wynik `project_create`.
- `01c-project_check_env`: linie połączenia (`połączenie ok: …`, problem ze środowiskiem i co dalej).
- `01d-project_analyze_setup`: pasek analizy, `proponowany profil: 9 pól, 2 do sprawdzenia` (nic jeszcze nie
  zastosowano) i linia `→ dalej: project_apply_setup z analysis "<uchwyt>"`; bez materiałów linia „brak
  materiałów” i `→ dalej: project_apply_setup bez analysis`. Uchwyt analizy we wzorcu to stały identyfikator
  świata (`SKLEP_IDS.setupAnalysis`), bo model przepisuje go z tekstu do następnego wywołania.
- `01e-project_apply_setup`: nagłówek z dokumentacją, linie analizy, profilu (z logowaniem) i zaopatrzenia,
  zgodność domyślnego środowiska w osobnej linii `perf ★ zgodność: …` (bez noty `domyślne`, którą ma już
  `01b`), pola do sprawdzenia i link do profilu. Link ma tylko ten wynik.

Zniknęło: linie środowisk powtarzane w jednym widoku obok połączenia i zgodności (każda rzecz stoi w wyniku
narzędzia, które ją zrobiło). Zapisy do backendu się nie zmieniły: ten sam ciąg żądań innych niż GET, w tej
samej kolejności i z tymi samymi treściami, co dawny krok 01 (test `tools.projectSetup.requests.test.ts`).

Wymaga zgody koordynatora (zlecenie CORE-03).

### R37. `flows_suggest_journeys`: rodzaj propozycji, kroki bez kolejności, drabina jako jedna pozycja

Wzorzec `run1/03-flows_suggest_journeys` i `run5/03-flows_suggest_journeys-po-aktualizacji` pokazuje teraz
rodzaj każdej propozycji w nawiasie kwadratowym (`[ścieżka]`), a kroki propozycji, których kolejności nie
wyznacza plan (rodzaje `semantic` i `tag_group`), rozdziela znakiem `·` zamiast strzałką `→`; pod nagłówkiem stoi
jedno zdanie, że kolejność ustala generator przy budowie. Strzałki zostają tylko tam, gdzie kolejność jest planem
(m.in. `journey_slice`, `crud`, `async_polling`). Powód: strzałki między krokami propozycji bez planu sugerowały
kolejność, której generator nie gwarantuje (ręczny test właściciela). Szczeble drabiny (`journey_slice`, dwa
i więcej) są jedną pozycją: liczba szczebli, zakres kroków i pełna lista nazw szczebli; wzorzec nie ma drabiny.
Linia pokrycia API jest drukowana zawsze, także przy 100% (`10 z 10 operacji · 0 poza ścieżkami`).

Zgoda koordynatora: zlecenie FIX-47.

### R38. `project_analyze_setup`: pola niepewne przed zastosowaniem

Wzorzec `run1/01d-project_analyze_setup` (wspólny dla przebiegów 1–3 i 5) ma pod linią
`proponowany profil: 9 pól, 2 do sprawdzenia` blok pól, których analiza nie była pewna: nagłówek
`2 pola niepewne (niska pewność albo sprzeczne źródła), zapytaj użytkownika przed zastosowaniem:`,
po jednej linii na pole z proponowaną wartością i powodem (`has_async_operations: true (pewność 60%)`,
`uses_csrf: false (sprzeczne źródła)`) i linię `poprawka po zastosowaniu: project_set_profile`. Pole jest
niepewne, gdy wybrana propozycja ma pewność poniżej 0,7 albo źródła analizy się nie zgadzają (status
`conflicted`). Świat „sklep” ma takie dwa pola: słabe `has_async_operations` (0,6) i `uses_csrf`, co do
którego źródła się nie zgadzają (0,93 z dokumentacji). Wzorzec `01e` się nie zmienia: wynik apply wypisuje
dalej pola do sprawdzenia, a `uses_csrf` do nich nie należy, więc zostaje w ostrzeżeniu
`profile_fields_uncertain` i pokazuje je `process_get_status` także po apply.

Powód: wartość zgadnięta przez analizę trafiała do profilu bez śladu; użytkownik ma o nią zostać zapytany,
zanim profil zacznie sterować generowaniem flowów.

Zgoda koordynatora: przegląd REV-PROJ-03 (poprawka P1).

### R39. Trzy narzędzia `flows_generate_*` zamiast jednego narzędzia budowy flowów

Dawne narzędzie budowy flowów dzieli się według mapy przejścia katalogu na `flows_generate_from_suggestions`,
`flows_generate_from_endpoints` i `flows_generate_from_har`. Treść wzorców się nie zmienia; zmieniają się nazwy
ich plików: `run1/04-flows_generate_from_suggestions`, `run2/03-flows_generate_from_endpoints` (dawniej z
przyrostkiem „reczne”), `run2/05-flows_generate_from_suggestions` (dawniej „propozycje”) i
`run4/04-flows_generate_from_har`. Wskazówki „→”, które każą wywołać narzędzie jeszcze raz, nazywają narzędzie
drogi, która je zwróciła. Nazwy w opisach wyżej zamieniono tym samym przebiegiem. Żądania do backendu są te same
co dawniej (test `tools.flowsGenerate.requests.test.ts`).

Zgoda koordynatora: zlecenie CORE-04.

### R40. `project_apply_setup`: pola nadal niepewne po zastosowaniu

Wzorzec `run1/01e-project_apply_setup` (wspólny dla przebiegów 1–3 i 5) ma pod listą pól do sprawdzenia linię
`nadal niepewne po analizie: uses_csrf → zapytaj o nie użytkownika`, a jego dane widoku pole `unsure`. Wynik apply
wypisuje teraz to, co zostaje w ostrzeżeniu `profile_fields_uncertain`: pola ostrzeżenia z analizy, których wynik
nie pokazuje do sprawdzenia, pola, które backend zapisał w proweniencji jako zastosowane bez rozstrzygnięcia
(`needs_confirmation`, `conflicted`, `defaulted`), pola wstrzymane do potwierdzenia i nieustaloną architekturę.
Świat „sklep” ma jedno takie pole: `uses_csrf`, co do którego źródła analizy się nie zgadzają (`conflicted`, R38);
prawdziwy backend zapisuje je w proweniencji z tym samym statusem, bo zamienia na `accepted` tylko status
`suggested`. To nie jest skutek braku proweniencji: brak `field_provenance` albo pusta mapa nie czyni żadnego
pola niepewnym, a analiza pewna wszystkich pól nie zostawia ani tej linii, ani ostrzeżenia (testy
`nothing unsure is no warning`). Wzorzec `run4/01e-project_apply_setup-without-docs` się nie zmienia: bez
analizy nie ma ostrzeżenia ani proweniencji.

Powód: wcześniej o tym polu po apply mówił tylko `process_get_status`; model, który czytał wynik apply, nie
wiedział, że ma jeszcze zapytać użytkownika.

Zgoda koordynatora: zlecenie FIX-54 (zmiana wprowadzona w FIX-51).

### R41. Dwa narzędzia scenariusza zamiast jednego

Dawne narzędzie scenariusza dzieli się według mapy przejścia katalogu na `scenario_suggest_split` (propozycja
podziału ruchu) i `scenario_generate` (generowanie scenariuszy z samokontrolą). Treść wzorców się nie zmienia;
zmieniają się nazwy ich plików: `run1/05-scenario_suggest_split-propozycja` i `run1/06-scenario_generate-generowanie`
(dawniej z nazwą dawnego narzędzia). Wskazówki „→”, które każą wywołać narzędzie jeszcze raz, nazywają
`scenario_generate`. Żądania do backendu są te same co dawniej (test `tools.scenario.requests.test.ts`).

Zgoda koordynatora: zlecenie CORE-05.

### R42. `scenario_check_self`: wszystkie próby po naprawie, ze wskazaniem kroku, który padł

Wynik self-checku, który przeszedł po naprawie, rysował dotąd jeden łańcuch (pierwszy, nieudany przebieg), linię
naprawy i zdanie „po 1 naprawie”. Backend podaje teraz kroki każdego przebiegu w kolejności wykonania, ze statusem
HTTP i przyczyną kroku, który padł, więc wzorzec `run2/10-scenario_check_self-naprawa` rysuje każdą próbę osobno:

- nagłówek próby (`próba 1 · wersja 1 ✕`, `próba 2 · wersja 2 ✓`) przed łańcuchem jej kroków;
- krok, który padł, z kodem HTTP (`zamówienie ✕ 403`) i linia z jego przyczyną (`✕ zamówienie 403: HTTP 403
Forbidden`) pod łańcuchem;
- linia naprawy między próbą, która padła, a próbą wersji, którą naprawa zapisała;
- po ostatniej próbie dotychczasowe zdanie (`✓ po 1 naprawie · 5 żądań · 1,4 s`) bez zmian.

Powód (decyzja właściciela): użytkownik ma widzieć, który krok padł i że scenariusz był naprawiany, także gdy
w końcu przeszedł. Wzorce przebiegów, które przeszły bez naprawy (`run1/09`, `run3/09`), się nie zmieniają: próba
jedyna nie ma nagłówka, a przejście kroków wygląda jak dawny łańcuch. Odmowa naprawy czyta zdanie dla człowieka
backendu (kod odmowy jest tylko w danych wyniku).

Zgoda koordynatora: zlecenie FIX-52 (decyzja właściciela w treści zlecenia).

### R43. Krok danych to cztery narzędzia: `data_check_readiness`, `data_suggest_actions`, `data_create_dataset`, `data_set_bindings`

Dawne narzędzie danych (plan, konta z pliku, zastosowanie planu) dzieli się według mapy przejścia katalogu.
Wzorce:

- `run1/07-data_check_readiness-plan` i `run5/08-data_check_readiness-plan-qa` (dawniej plan danych): ten
  sam plan, ale bez huba danych. Linia poprawki nazywa etykietę slotu (`User accounts muszą istnieć na perf`),
  bo nazwę zbioru (`konta`) podawała tylko propozycja huba; `view.json` ma `proposed: []` i `steps: []`.
- `run1/08a-data_create_dataset-konta-z-pliku` (dawniej konta z pliku): linia zbioru jak w R16, bez zamknięcia
  planu, za to z linią `→ dalej: data_set_bindings …` z całą mapą powiązań celu. Plan po zapisaniu pokazuje
  `data_check_readiness`, a przypięcie jest osobnym wywołaniem.
- `run1/08b-data_suggest_actions-apply` (dawniej zastosowanie planu): plan z propozycją huba, potem
  `wywołania, które stosują propozycję, w tej kolejności:` z dokładnymi argumentami (`data_set_bindings` z
  mapą, `data_create_dataset` z uchwytem reguł `data_suggestion:<id>/<n>`) i `pominięto N:` jak w R16. Wywołanie
  łamie się tylko między argumentami albo wpisami mapy, nigdy wewnątrz wartości. Liczba scenariuszy z pinem
  (R33) jest teraz w wyniku `data_set_bindings`.

Zapisy do backendu się nie zmieniły: ten sam ciąg zapisów, w tej samej kolejności i z tymi samymi treściami,
co dawne narzędzie we wszystkich ośmiu drogach (test `tools.data.requests.test.ts`). Konta z pliku nie pytają
już huba danych o nazwę zbioru (nazwa jest argumentem).

Wymaga zgody koordynatora (zlecenie CORE-06).

### R44. Start przebiegu i planowanie obciążenia to dwa narzędzia: `run_start` i `run_plan`

Dawne narzędzie startu testu i dawne narzędzie profili dzielą się według mapy przejścia katalogu: `run_start` wysyła
ruch do aplikacji celu, `run_plan` czyta profile i nic nie wysyła. Treść wzorców zmienia się tylko w nazwach narzędzi
w tekście (wzorzec `09a` ma poza tym inną wskazówkę „dalej”); zmieniają się też nazwy plików, które mają nazwę narzędzia: `run1/09a-run_plan`, `run1/10-run_start`, `run1/10-run_start-postep`,
`run5/09a-run_plan-qa`, `run5/11-run_start-qa` i `run5/11-run_start-qa-postep` (dawniej z nazwami dawnych narzędzi).
Wskazówki „→”, które każą wywołać narzędzie jeszcze raz albo przekazać profil dalej, nazywają `run_start` i
`run_plan`. Opisy wyżej zamieniono tym samym przebiegiem (odwołania do plików są aktualne).

Żądania do backendu są te same co dawniej, także odczyty (test `tools.run.requests.test.ts`).

Wymaga zgody koordynatora (zlecenie CORE-07).
