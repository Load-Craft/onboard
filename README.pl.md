[English](README.md) | **Polski**

# onboard — skille przygotowujące artefakty dla LoadCrafta

Repozytorium dystrybucyjne skilli (instrukcji roboczych dla asystentów AI),
które klienci uruchamiają na własnym kodzie, żeby wyprodukować **gotowe pliki
wejściowe dla LoadCrafta**. Skille działają w Claude Code, Codex i innych
narzędziach zgodnych z formatem Agent Skills.

| Skill | Co dostajesz | Co z tym robisz |
|---|---|---|
| [`loadcraft-openapi`](skills/loadcraft-openapi/) | `loadcraft/openapi.json` — opis Twojego API | importujesz go w LoadCrafcie jako specyfikację API |
| [`loadcraft-journeys`](skills/loadcraft-journeys/) | `loadcraft/journeys/*.txt` — scenariusze użytkownika, jeden na plik | zawartość każdego pliku wklejasz w pole opisu scenariusza w LoadCrafcie |
| [`loadcraft-asyncapi`](skills/loadcraft-asyncapi/) | `loadcraft/asyncapi.json` — opis Twojego API zdarzeń/wiadomości (WebSockety, Kafka, MQTT…) | importujesz go w LoadCrafcie jako specyfikację AsyncAPI |
| [`loadcraft-overview`](skills/loadcraft-overview/) | `loadcraft/overview.md` — opis zwykłym językiem, o czym jest Twój projekt | zawartość wklejasz w pole description przy setupie projektu w LoadCrafcie |

Wszystkie skille działają według tych samych zasad: tylko czytają Twój kod (niczego
nie zmieniają, nie instalują ani nie uruchamiają), nigdy nie zgadują — czego
nie mogą potwierdzić, to wypisują w raporcie jako pytanie do wyjaśnienia — a
hasła, tokeny i dane klientów nie trafiają do plików.

## Układ repozytorium

- **[`skills/`](skills/)** — źródło skilli + [przewodnik użytkownika](skills/README.pl.md)
  i [instalacja](skills/INSTALL.pl.md). Każdy skill: `SKILL.md` +
  `references/` + `scripts/` (walidator w czystym Pythonie, bez zależności).
- **`dist/`** — gotowe ZIP-y do pobrania (jeden na skill). Odśwież po zmianach:
  `./scripts/package.sh`.
- **`.claude-plugin/`, `.codex-plugin/`** — manifesty pluginów; po publikacji
  repo skille można też instalować przez
  `npx skills add <owner>/<repo> --skill loadcraft-openapi`.
- **`tests/`** — testy walidatorów na neutralnych fixture'ach. Uruchamianie:
  `python3 -m unittest discover -s tests -v`.
- **[`AGENTS.md`](AGENTS.md)** — zasady utrzymania pakietu (zmiany kontraktu
  test-first, wersjonowanie, checklist przed wydaniem).
- **[`EVALUATION.md`](EVALUATION.md)** — raport z ewaluacji skilli na projekcie
  Shopcraft, w tym porównanie z poprzednią generacją skilli (`api-docs`,
  `user-flows` — dostępne w historii gita).

Katalog `.claude/skills/` zawiera tylko symlinki do `skills/` — dzięki temu
skille działają lokalnie w Claude Code, a źródło prawdy jest jedno.
