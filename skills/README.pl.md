[English](README.md) | **Polski**

# Przygotowanie plików wejściowych dla LoadCrafta — przewodnik użytkownika

**Cel:** LoadCraft generuje testy obciążeniowe z dwóch wejść — specyfikacji
API i opisów scenariuszy. Te skille sprawiają, że Twój asystent AI (Claude
Code, Codex, Cursor, GitHub Copilot…) wyprodukuje oba **z kodu Twojego
projektu** — trafnie i bez dotykania samego kodu. Nie musisz sam pisać ani
czytać kodu.

> **Pierwsze użycie?** Najpierw zainstaluj skille: **[INSTALL.pl.md](INSTALL.pl.md)**
> — kilka komend do skopiowania, per narzędzie. Robisz to raz.

| Skill | Na jakim projekcie | Co powstaje |
|---|---|---|
| `loadcraft-openapi` | Twoje API (backend) | `loadcraft/openapi.json` + raport |
| `loadcraft-journeys` | Twoja aplikacja webowa (frontend) | `loadcraft/journeys/*.txt` + raport |
| `loadcraft-asyncapi` | Twoje API zdarzeń/wiadomości (WebSockety, Kafka, MQTT…) | `loadcraft/asyncapi.json` + raport |

## Twoje kroki

### 1. Zainstaluj skille (raz)

Uruchom komendy dla swojego narzędzia z [INSTALL.pl.md](INSTALL.pl.md). Już
zainstalowane? Przejdź od razu do kroku 2.

### 2. Poproś AI

W Claude Code wystarczy zwykła prośba własnymi słowami:

> Przygotuj to API pod LoadCraft.

albo dla frontendu:

> Opisz ścieżki użytkownika w tej aplikacji pod LoadCraft.

albo dla API zdarzeń/wiadomości:

> Opisz asynchroniczne API tej aplikacji pod LoadCraft.

Claude Code sam znajdzie skill i wykona go. W narzędziach, które nie wykrywają
skilli automatycznie, wskaż plik wprost — dokładne sformułowanie dla każdego
narzędzia jest w [INSTALL.pl.md](INSTALL.pl.md).

Od tego momentu skill działa sam: analizuje kod, zapisuje pliki i je waliduje.
Przy większym projekcie może to chwilę potrwać — celowo pracuje endpoint po
endpoincie i ekran po ekranie, dla trafności. Ty nie robisz nic, aż pojawi się
raport.

### 3. Przeczytaj raport

Na końcu AI przedstawia raport: co zostało pokryte i listę **blokerów**, jeśli
są. Bloker znaczy, że AI nie mogło czegoś potwierdzić w kodzie i odmówiło
zgadywania. Blokery przekaż swoim deweloperom albo zespołowi LoadCrafta —
każdy to konkretne pytanie, nie ogólny błąd. Plik z otwartymi blokerami jest
użyteczny, ale traktuj go jako niekompletny, dopóki nie zostaną wyjaśnione.

### 4. Przekaż pliki do LoadCrafta

- **`loadcraft/openapi.json`** → zaimportuj w LoadCrafcie jako specyfikację
  swojego API.
- **każdy `loadcraft/journeys/*.txt`** → skopiuj całą zawartość pliku i wklej
  w pole opisu scenariusza w LoadCrafcie. Jeden plik = jeden scenariusz. Nie
  edytuj i nie łącz plików — każdy jest napisany tak, żeby użyć go dokładnie
  w tej formie.
- **`loadcraft/asyncapi.json`** → zaimportuj w LoadCrafcie jako specyfikację
  AsyncAPI.
- Dane kont testowych podajesz bezpośrednio w konfiguracji LoadCrafta — w
  plikach celowo ich nie ma.
- Raport nie jest wejściem do LoadCrafta — zachowaj go dla zespołu.

## Co się wydarzy podczas przebiegu — a co na pewno nie

- AI **tylko czyta** Twój kod. Niczego w projekcie nie zmienia, niczego nie
  instaluje i nie uruchamia Twojej aplikacji.
- Wyniki lądują w nowym katalogu `loadcraft/` w Twoim projekcie.
- Jeśli AI nie może czegoś potwierdzić w kodzie, nie zgaduje — wymienia to w
  raporcie jako bloker.
- Do plików wynikowych nie trafiają żadne hasła, tokeny ani dane klientów.

## Samodzielne sprawdzenie wyniku (opcjonalne)

Skill waliduje swój wynik sam, zanim go dostarczy — to jest więc dodatkowa
kontrola, nie obowiązkowy krok. W katalogu głównym projektu:

```bash
python3 .claude/skills/loadcraft-openapi/scripts/validate_openapi.py loadcraft/openapi.json
python3 .claude/skills/loadcraft-journeys/scripts/validate_journeys.py loadcraft/journeys
python3 .claude/skills/loadcraft-asyncapi/scripts/validate_asyncapi.py loadcraft/asyncapi.json
```

(Jeśli instalowałeś skille do `skills/` — Cursor, Codex, Copilot — dostosuj
ścieżkę.) `PASS` oznacza, że pliki są strukturalnie gotowe dla LoadCrafta.
Możesz też po prostu poprosić AI, żeby uruchomiło te komendy za Ciebie.

## Jak nie zaśmiecać głównego brancha swojego repozytorium

Katalog `loadcraft/` nie musi żyć na głównym branchu. Żeby utrzymać główny
branch repozytorium z kodem w czystości, uruchom skill na dedykowanym branchu:

```bash
git checkout -b loadcraft-artifacts   # jednorazowo: utwórz branch
# ... tutaj uruchom skill (krok 2) ...
git add loadcraft/
git commit -m "Pliki wejściowe LoadCrafta"
```

Przy kolejnym odświeżeniu najpierw zaktualizuj branch o bieżący kod, potem
poproś AI ponownie:

```bash
git checkout loadcraft-artifacts
git merge main                        # AI musi widzieć aktualny kod
# ... poproś AI o aktualizację plików ...
git add loadcraft/
git commit -m "Odśwież pliki wejściowe LoadCrafta"
```

Plik OpenAPI zapisuje, z którego commita kodu powstał, więc aktualizacja na
bocznym branchu działa dokładnie tak samo jak na głównym. Alternatywnie dodaj
`loadcraft/` do `.gitignore` i trzymaj pliki całkiem poza kontrolą wersji —
LoadCraft potrzebuje tylko plików, nie Twojego repozytorium. Jeśli cokolwiek z
tego brzmi obco, poproś swojego asystenta AI, żeby zrobił to za Ciebie — to
zwykłe komendy gita.

## Ponowny przebieg po zmianach w kodzie

Po prostu poproś AI jeszcze raz (krok 2). Każdy skill zapisuje, z której
wersji kodu powstały jego pliki, i sprawdza tylko to, co się od tego czasu
zmieniło: skille OpenAPI i AsyncAPI aktualizują dotknięte operacje, a skill
journeys weryfikuje ponownie dotknięte pliki `.txt` i raportuje rozjazdy.

## Uwagi

- Skille są napisane po angielsku (lepiej rozumiane przez wszystkie modele),
  ale możesz rozmawiać z AI po polsku — raporty będą w języku rozmowy. Pliki
  wynikowe powstają w formacie wymaganym przez LoadCraft niezależnie od
  języka rozmowy.
- Fragmenty o "subagentach" dotyczą narzędzi, które je wspierają (np. Claude
  Code); w narzędziach bez subagentów skill wykonuje te same kroki
  sekwencyjnie.
