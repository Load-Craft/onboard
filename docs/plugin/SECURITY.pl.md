[English](SECURITY.md) | **Polski**

# Bezpieczeństwo pluginu LoadCraft

Co plugin wysyła z Twojego komputera, czego asystent AI nigdy nie widzi, gdzie leży token i jak odebrać dostęp.

## Co opuszcza Twój komputer

Plugin wysyła dane wyłącznie do Twojej instancji LoadCrafta (`loadcraft_url`) i tylko wtedy, gdy krok tego
wymaga. Kod źródłowy nigdy nie jest wysyłany. Mogą wyjść te rodzaje plików, każdy tylko z katalogu Twojego
projektu i w granicach limitu rozmiaru:

| Plik | Co to jest | Limit |
|---|---|---|
| `.json` | Opis API (OpenAPI) i opis API zdarzeń (AsyncAPI) | po 10 MB |
| `.har` | Nagranie z przeglądarki, do budowy flowów z nagrania | 100 MB |
| `.md` | Opis projektu | 64 KB |
| `.csv` | Lista kont testowych | 2 MB |

Poza plikami plugin wysyła to, co ustalisz w rozmowie: adresy środowisk, limity obciążenia, wybór flowów,
scenariusz i profil obciążenia. Plik spoza katalogu projektu jest odrzucany, także gdy prowadzi do niego dowiązanie.
Plik innego typu też jest odrzucany.

Nagranie (`.har`) zawiera prawdziwą sesję osoby, która nagrywała: ciasteczka, tokeny, wartości formularzy.
LoadCraft bierze nagranie do budowy flowów, więc nagrywaj na koncie testowym, nigdy na koncie prawdziwej osoby, a
Claude pyta przed wysłaniem.

## Czego asystent nie widzi

- **Twojego tokenu API.** Trafia do serwera pluginu jako wartość chroniona, jest wysyłany tylko w nagłówku
  żądania i maskowany w każdym logu i wyniku. Claude Code trzyma go w systemowym magazynie poświadczeń, nie w pliku
  ustawień. Asystent ma zakaz wypisywania go, a plugin ukrywa jego wartość (także zakodowaną) we wszystkim, co
  mogłoby trafić do asystenta.
- **Haseł z plików.** Dla kont testowych Claude podaje pluginowi ścieżkę pliku i nazwy kluczy; wartości plugin
  czyta sam. Model widzi nazwy plików i kluczy, nigdy wartości.
- **Haseł i sekretów z nagrań.** To, co jest w pliku `.har`, czyta plugin, nie model.
- **Treści błędów.** Gdy Twoja instancja LoadCrafta albo Twoja aplikacja odpowie błędem serwera (5xx) albo
  „brak autoryzacji” (401), treść tej odpowiedzi nie jest przekazywana asystentowi. Dostaje zamiast niej krótki opis
  problemu.
- **List kont testowych zwracanych przez backend.** Wartości sekretne są z nich usuwane w chwili odebrania.

Asystent traktuje teksty, które czyta, z Twojego repozytorium i z odpowiedzi usług, jako dane, a nie polecenia.

## Co LoadCraft robi z kontem testowym

LoadCraft używa podanych kont testowych, żeby w trakcie testu logować się jako użytkownik testowy. Używaj
wydzielonych kont testowych, z najmniejszymi prawami, jakich potrzebują flowy, nigdy kont prawdziwych osób.
Zakładanie kont w Twoim systemie (`data_create_accounts`) jest możliwe tylko po Twojej wyraźnej zgodzie w oknie, za
każdym razem; tej zgody nie zastępuje żadna reguła uprawnień.

## Produkcja i środowiska chronione

Test obciążeniowy może zaszkodzić systemowi, z którego korzystają prawdziwi ludzie. Plugin jest zbudowany tak, żeby
trudno było to zrobić przez pomyłkę:

- Claude nigdy nie wybiera środowiska do testu; robisz to Ty.
- Środowisko możesz oznaczyć jako chronione i nadać mu limity (wirtualni użytkownicy, żądania na sekundę).
  `project_save_env` tylko zaostrza tę ochronę, nigdy jej nie luzuje.
- Test na środowisku chronionym jest przycinany do jego limitów i startuje dopiero po Twojej zgodzie na
  pomniejszone liczby. Claude mówi wprost w raporcie, że obciążenie zostało przycięte.
- `run_start` prosi o Twoją zgodę za każdym razem, niezależnie od reguł uprawnień, i jest odrzucany w sesji
  nieinteraktywnej (`claude -p`).

## Gdzie leży token i jak go odwołać

Token zapisuje Claude Code w systemowym magazynie poświadczeń, gdy konfigurujesz plugin (`api_token`). Nie trafia
do repozytorium ani do `.claude/settings.json`.

Token działa jako Ty, z Twoją rolą. W LoadCrafcie, w **Konto → Tokeny API**, możesz:

- przy tworzeniu ograniczyć go do jednego projektu i ustawić datę wygaśnięcia;
- odwołać go w każdej chwili. Odwołanie działa natychmiast: następne wywołanie pluginu jest odrzucane, a
  `/loadcraft:doctor` mówi, że token nie jest już przyjmowany.

Jeśli sądzisz, że token wyciekł (wklejony do rozmowy, scommitowany, zgubiony razem z laptopem): najpierw go
odwołaj, potem utwórz nowy i wpisz przez ustawienia loadcraft w `/plugin`.

## Usuwanie projektów i flowów

Usunięcie (`project_delete`, `flows_delete`) następuje dopiero po „tak” w oknie Claude Code: asystent nie
może go dać za Ciebie. Claude Code pozwala jednak hookom odpowiadać na to okno: hook `Elicitation` albo
`ElicitationResult`, Twój albo dodany przez inny plugin, może odpowiedzieć albo zmienić odpowiedź za Ciebie.
Nie ustawiaj hooków, które same odpowiadają na pytania serwera LoadCraft. W trybie `bypassPermissions`
asystent może też bez pytania zmieniać ustawienia i hooki, więc tam okno chroni wywołania narzędzi, a nie
sesję bez ograniczeń; do usuwania używaj trybu, który pyta.

## Mod

Opcjonalny mod nie czyta tokenu, nie otwiera sieci i nie zmienia wywołań narzędzi ani wyników. Co dokładnie robi i
jak go wyłączyć: [przewodnik po modzie](../../mod/docs/USER.pl.md).

## Zgłaszanie problemu bezpieczeństwa

Prosimy nie zakładać publicznego zgłoszenia. Zgłoś problem prywatnie: na karcie **Security** repozytorium na
GitHubie wybierz **Report a vulnerability** ([Load-Craft/onboard](https://github.com/Load-Craft/onboard/security)).
Napisz, co udało się znaleźć, jak to odtworzyć i której wersji pluginu używasz (pokazuje ją `/plugin`). Nie wklejaj do
zgłoszenia prawdziwego tokenu.
