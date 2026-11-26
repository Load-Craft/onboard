[English](INSTALL.md) | **Polski**

# Instalacja pluginu LoadCraft dla Claude Code

Plugin prowadzi Cię w Claude Code od repozytorium do gotowego testu obciążeniowego w LoadCrafcie: przygotowuje
opis API, zakłada projekt, buduje flowy, uruchamia test i tłumaczy wynik. Ta strona prowadzi od zera do pierwszego
sprawdzenia w kilka minut. Potem przeczytaj [USAGE.pl.md](USAGE.pl.md).

## Czego potrzebujesz

- **Claude Code w wersji 2.1.271 lub nowszej.** Sprawdź: `claude --version`, zaktualizuj: `claude update`.
- **Node w wersji 22.17 lub nowszej.** Serwer pluginu to program w Node. Sprawdź: `node --version`.
- **Konto w LoadCrafcie** na instancji, która obsługuje tokeny API, i prawo do wydania tam tokenu.
  Plugin sam to sprawdza przy łączeniu i mówi, gdy instancja jest za stara.
- Projekt (repozytorium git), który chcesz przetestować. Uruchom Claude Code w jego katalogu głównym.

## 1. Dodaj plugin

W Claude Code:

```text
/plugin marketplace add Load-Craft/onboard
/plugin install loadcraft@loadcraft
```

To samo z terminala, poza Claude Code:

```bash
claude plugin marketplace add Load-Craft/onboard
claude plugin install loadcraft@loadcraft
```

Uruchom Claude Code ponownie albo wpisz `/reload-plugins`, żeby plugin się załadował.

## 2. Wydaj token API

1. Otwórz aplikację LoadCraft i wejdź w **Konto → Tokeny API** (**Account → API tokens**).
2. Utwórz token. Nadaj mu nazwę, którą rozpoznasz (na przykład nazwę swojego laptopa).
   Możesz ograniczyć go do jednego projektu i ustawić datę wygaśnięcia. Warto zrobić jedno i drugie.
3. Skopiuj token od razu. LoadCraft pokazuje go tylko raz.

Token działa jako Ty, z Twoją rolą w projekcie. Traktuj go jak hasło: nie wklejaj go do rozmowy i nie
commituj do gita.

## 3. Skonfiguruj plugin

Claude Code pyta o opcje pluginu przy instalacji albo włączeniu. Zmienisz je w każdej chwili przez
`/plugin` (karta Installed, ustawienia loadcraft) albo w terminalu `claude plugin configure loadcraft`, który pokazuje też opcje
jeszcze nieustawione.

| Opcja | Co wpisać |
|---|---|
| `loadcraft_url` („LoadCraft web app (browser address)”) | Opcjonalne; tylko dla lokalnego lub własnego LoadCrafta. Adres, który otwierasz w przeglądarce, żeby używać LoadCrafta; linki w wynikach narzędzi prowadzą tutaj. To nie jest adres API backendu. Domyślnie `https://app.loadcraft.io`. Zmiana adresu sprawia, że podłączone już repozytorium wygląda na podłączone do innej instancji: powtórz raz zakładanie projektu z tą samą nazwą. |
| `api_token` | Token z kroku 2. Claude Code trzyma go w systemowym magazynie poświadczeń (opcja jest oznaczona jako wrażliwa), nie w pliku ustawień. |
| `locale` | Język komunikatów pluginu: `en` albo `pl`. Claude i tak odpowiada w języku, w którym piszesz. |
| `demo` | Domyślnie wyłączona. Włącz, żeby wypróbować plugin na przykładowych danych bez konta w LoadCrafcie (zobacz [Wypróbuj bez konta](#wypróbuj-bez-konta)). |
| `api_url` („Backend API address (leave empty if same as web app)”) | Zostaw puste. Potrzebne tylko, gdy backend stoi pod innym adresem niż aplikacja, na przykład lokalnie na osobnych portach. Wpisz pełny adres razem z `/api/v1`, np. `http://localhost:8000/api/v1`; jest używany tak, jak go wpiszesz. Puste oznacza adres aplikacji z dopiskiem `/api/v1`. |

## 4. Sprawdź instalację

Uruchom:

```text
/loadcraft:doctor
```

Komenda sprawdza po kolei wersję Node, czy serwer jest połączony, czy token jest przyjęty, czy backend jest
zgodny i czy repozytorium jest już przypisane do projektu. Przy każdej usterce mówi, jak ją naprawić. Gdy
wszystko gra, spróbuj:

```text
/loadcraft:status
```

Pokaże, do kogo należy token, z jakim projektem jest związane to repozytorium (przy pierwszym uruchomieniu z
żadnym) i jaki jest następny krok. Gdy plugin nie może działać (brak tokenu, za stary Node), Claude Code na
początku sesji wypisze też jednozdaniową wskazówkę z odesłaniem do `/loadcraft:doctor`.

## 5. Reguły uprawnień (opcjonalnie)

Domyślnie Claude Code pyta przed każdym wywołaniem narzędzia LoadCrafta. Nieszkodliwe możesz raz zezwolić w
`~/.claude/settings.json` (dla wszystkich projektów) albo w `.claude/settings.json` projektu (dla tego projektu).
Plugin nie może dostarczyć tych reguł za Ciebie.

Uruchomienie testu nigdy nie jest objęte regułami: `run_start` prosi o Twoją zgodę za każdym razem, niezależnie
od reguł. To samo dotyczy zakładania kont w Twoim systemie (`data_create_accounts`). W sesji nieinteraktywnej
(`claude -p`) te wywołania są odrzucane, bo nie ma kto odpowiedzieć. Testy uruchamiaj w zwykłej sesji.

### Wariant A: same odczyty

Pozwala asystentowi czytać stan pracy i wyniki, i nic więcej:

<!-- allow:reads begin: npm run update:shared writes this block from the catalog; do not edit -->
```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_loadcraft_lc__process_get_status",
      "mcp__plugin_loadcraft_lc__flows_get",
      "mcp__plugin_loadcraft_lc__run_plan",
      "mcp__plugin_loadcraft_lc__results_get_report",
      "mcp__plugin_loadcraft_lc__results_get_errors",
      "mcp__plugin_loadcraft_lc__process_wait",
      "mcp__plugin_loadcraft_lc__project_get",
      "mcp__plugin_loadcraft_lc__data_check_readiness",
      "mcp__plugin_loadcraft_lc__project_list_notes"
    ]
  }
}
```
<!-- allow:reads end -->

`results_get_traces` pokazuje żądania wysłane przez test i to, co wróciło, dlatego nie ma go w żadnym wariancie:
wartości nagłówków nigdy nie są pokazywane, rozpoznane sekrety w ciałach i adresach są maskowane, a ciało
w formacie, którego narzędzie nie umie odczytać, jest ukryte w całości.

### Wariant B: wszystko, co zostaje wewnątrz LoadCrafta

Dodaje narzędzia, które tworzą i zmieniają rzeczy wyłącznie w LoadCrafcie (projekt, dokumentacja, flowy,
scenariusz, analiza AI):

<!-- allow:inside begin: npm run update:shared writes this block from the catalog; do not edit -->
```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_loadcraft_lc__process_get_status",
      "mcp__plugin_loadcraft_lc__flows_get",
      "mcp__plugin_loadcraft_lc__run_plan",
      "mcp__plugin_loadcraft_lc__results_get_report",
      "mcp__plugin_loadcraft_lc__results_get_errors",
      "mcp__plugin_loadcraft_lc__process_wait",
      "mcp__plugin_loadcraft_lc__project_get",
      "mcp__plugin_loadcraft_lc__data_check_readiness",
      "mcp__plugin_loadcraft_lc__project_create",
      "mcp__plugin_loadcraft_lc__project_save_env",
      "mcp__plugin_loadcraft_lc__project_check_env",
      "mcp__plugin_loadcraft_lc__project_analyze_setup",
      "mcp__plugin_loadcraft_lc__project_apply_setup",
      "mcp__plugin_loadcraft_lc__project_set_profile",
      "mcp__plugin_loadcraft_lc__project_connect_telemetry",
      "mcp__plugin_loadcraft_lc__project_import_docs",
      "mcp__plugin_loadcraft_lc__flows_suggest_journeys",
      "mcp__plugin_loadcraft_lc__flows_migrate_docs",
      "mcp__plugin_loadcraft_lc__flows_generate_from_suggestions",
      "mcp__plugin_loadcraft_lc__flows_generate_from_endpoints",
      "mcp__plugin_loadcraft_lc__scenario_suggest_split",
      "mcp__plugin_loadcraft_lc__results_analyze_run",
      "mcp__plugin_loadcraft_lc__project_list_notes"
    ]
  }
}
```
<!-- allow:inside end -->
<!-- left-out begin: npm run update:shared --><!-- left-out end -->

Celowo pominięte, żeby Claude Code dalej pytał: `run_start` i `data_create_accounts` (dotykają Twojego systemu;
Claude Code i tak pyta o nie za każdym razem), `data_create_dataset` (może wysłać do LoadCrafta plik z kontami),
`data_suggest_actions` (pokazuje kartę zgody i pyta model huba danych LoadCrafta; dopóki serwer sam nie pyta o zgodę, pytanie Claude Code jest jedynym), `data_set_bindings` (zmienia, które zbiory danych czyta test),
`scenario_check_self` i `scenario_generate` (przepuszczają jednego użytkownika testowego przez Twoją aplikację; generowanie scenariusza kończy się tym sprawdzeniem), `flows_describe_journeys` i `flows_record_journeys` (przeglądarka
przechodzi przez Twoją aplikację i może się logować), `results_get_traces` (pokazuje żądania wysłane przez test i odpowiedzi Twojej aplikacji), `flows_import_har` i `flows_generate_from_har` (wysyłają nagranie, które zawiera
prawdziwą sesję), `process_cancel` (zatrzymuje test) oraz `project_delete` i `flows_delete` (usuwają na stałe). Niezależnie od
tej listy Claude Code pyta Cię przed każdym wywołaniem obu usunięć (także w trybie bypass i auto), a samo usunięcie
pyta jeszcze raz w oknie Claude Code, gdzie usuwa tylko Twoje „tak”; gdzie nikt nie odpowie (`claude -p`), są
odrzucane, a usuwasz w aplikacji.
`project_check_env`, `project_apply_setup` i `project_import_docs` mogą wysłać kilka żądań kontrolnych na
środowisko, które nie jest chronione; jeśli tego nie chcesz, pomiń je także. Dozwolone czy nie, `project_set_profile` i `flows_migrate_docs` najpierw pokazują zmianę
i zapisują ją dopiero po Twoim „tak”.

Usunięcie (`project_delete`, `flows_delete`) następuje dopiero po „tak” w oknie Claude Code: asystent nie
może go dać za Ciebie. Claude Code pozwala jednak hookom odpowiadać na to okno: hook `Elicitation` albo
`ElicitationResult`, Twój albo dodany przez inny plugin, może odpowiedzieć albo zmienić odpowiedź za Ciebie.
Nie ustawiaj hooków, które same odpowiadają na pytania serwera LoadCraft. W trybie `bypassPermissions`
asystent może też bez pytania zmieniać ustawienia i hooki, więc tam okno chroni wywołania narzędzi, a nie
sesję bez ograniczeń; do usuwania używaj trybu, który pyta.

## Aktualizacja

```bash
claude plugin marketplace update loadcraft
claude plugin update loadcraft@loadcraft
```

Potem uruchom Claude Code ponownie: nowa wersja zaczyna działać po restarcie.

## Odinstalowanie

```text
/plugin uninstall loadcraft@loadcraft
```

Odinstalowanie niczego nie usuwa w LoadCrafcie ani w Twoim repozytorium. Folder `loadcraft/` w projekcie zostaje
(trzyma opis API i powiązanie z projektem). Żeby mieć pewność, że token nie zadziała, odwołaj go w LoadCrafcie w
**Konto → Tokeny API**.

## Opcjonalnie: mod

Plugin ma w zestawie mod: wiersz stanu nad promptem, żywą linię w trakcie testu, okno z liczbami przed testem
i panel boczny. Jest domyślnie włączony, a plugin działa tak samo bez niego. Jak to sprawdzić, co robi i jak go
wyłączyć: [mod/docs/USER.pl.md](../../mod/docs/USER.pl.md). Uwaga: `claude --safe-mode` i wyłączenie pluginu w
`/plugin` wyłączają cały plugin, nie tylko mod.

## Wypróbuj bez konta

Tryb demonstracyjny uruchamia plugin na małym przykładowym backendzie, który startuje na Twoim komputerze, na
przykładzie sklepu `sklep`. Nie potrzebuje konta w LoadCrafcie, tokenu ani sieci. Każdy wynik kończy się linią
„tryb demonstracyjny — dane przykładowe”, a do Twojego repozytorium nic nie trafia (powiązanie z przykładowym
projektem leży w katalogu tymczasowym).

Z pluginu: włącz opcję `demo` (ustawienia loadcraft w `/plugin`) i uruchom Claude Code ponownie. Plugin nadal prosi o
`api_token`, bo to opcja wymagana; wpisz dowolny tekst, tryb demonstracyjny nigdzie go nie wysyła. `loadcraft_url`
i `api_url` zostaw bez zmian (adres domyślny liczy się jako nieustawiony). Tryb odmawia startu, gdy ustawisz inny
adres, żeby przykładowe dane nigdy nie pomieszały się z prawdziwym LoadCraftem. Wyłącz `demo`, żeby wrócić do swojego konta.

Ręcznie, bez pluginu (na przykład do nagrania sesji), z kopii tego repozytorium i Node 22 lub nowszego:

```bash
LOADCRAFT_DEMO=1 node mcp/dist/server.mjs
```

Zegar przykładowego backendu chodzi 30 razy szybciej niż rzeczywisty, więc dziesięciominutowy test trwa około
dwudziestu sekund; współczynnik zmienia `LOADCRAFT_DEMO_SPEED`. Tryb potrzebuje pliku `mcp/dist/demo-backend.mjs`
obok `server.mjs`. Dane przykładowe w repozytorium `evals/fixtures/sklep` (opis API i pliki kont) pasują do przykładu
sklepu; uruchom Claude Code w tym folderze, żeby przejść całą sesję.

## Inne narzędzia

Cursor, GitHub Copilot i inni asystenci nie mogą używać pluginu. Nadal mogą korzystać z czterech skilli
przygotowania (opis API, journeys, API zdarzeń, opis projektu); zobacz [instalację skilli](../../skills/INSTALL.pl.md).
Codex: zobacz [sekcję Codex](#codex) (skille plus ręcznie skonfigurowany serwer MCP).

## Codex

Plugin Codexa dostarcza skille. Nie uruchamia za Ciebie serwera MCP: dokumentacja pluginów Codexa nie opisuje
sposobu, w jaki plugin przekazałby sekret (token API) dołączonemu serwerowi stdio, więc manifest nie deklaruje
serwera i dodajesz serwer LoadCraft do Codexa samodzielnie. To ten sam `mcp/dist/server.mjs`, którego używa plugin
Claude Code.

1. Pobierz kopię tego repozytorium i zapisz bezwzględną ścieżkę do `mcp/dist/server.mjs` (wymagany Node 22 lub nowszy).
2. Wydaj token API w LoadCraft w **Konto → Tokeny API** i wyeksportuj go w powłoce, z której uruchamiasz Codexa:

   ```bash
   export LOADCRAFT_API_TOKEN="<twój token>"
   ```

3. Dodaj serwer do `~/.codex/config.toml` (albo do `.codex/config.toml` zaufanego projektu):

   ```toml
   [mcp_servers.loadcraft]
   command = "node"
   args = ["/path/to/onboard/mcp/dist/server.mjs"]
   env_vars = ["LOADCRAFT_API_TOKEN"]

   [mcp_servers.loadcraft.env]
   LOADCRAFT_URL = "https://app.loadcraft.io"
   LOADCRAFT_LOCALE = "pl"
   ```

   `env_vars` przekazuje zmienną po nazwie z Twojego środowiska, więc token nie trafia do pliku. Nie wpisuj tokenu
   w `[mcp_servers.loadcraft.env]`: ta tabela przechowuje wartości jawnym tekstem. To przekazywanie zmiennych
   środowiska przez Codexa, nie magazyn poświadczeń. Opcjonalnie: `LOADCRAFT_API_URL` zmienia adres API (na
   przykład `http://localhost:8000`), a `LOADCRAFT_WORKSPACE` ustawia folder projektu (domyślnie folder, w którym
   Codex uruchamia serwer).

4. Uruchom Codexa ponownie i sprawdź, czy serwer `loadcraft` jest na liście (`/mcp` w interfejsie terminala).

Skill prowadzący zadaje pytania przez `AskUserQuestion`, gdy to narzędzie istnieje, a w przeciwnym razie zwykłym
tekstem z ponumerowanymi opcjami, więc w Codeksie działa tak samo.
