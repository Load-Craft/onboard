# onboard — skille przygotowujące artefakty dla LoadCrafta

Repozytorium dystrybucyjne skilli (instrukcji roboczych dla asystentów AI),
które klienci uruchamiają na własnym kodzie, żeby wyprodukować **gotowe pliki
wejściowe dla LoadCrafta**. Skille działają w Claude Code, Codex i innych
narzędziach zgodnych z formatem Agent Skills.

| Skill | Artefakt | Co robi |
|---|---|---|
| [`loadcraft-openapi`](skills/loadcraft-openapi/) | `loadcraft/openapi.json` | Analizuje kod API (read-only) i buduje jeden plik OpenAPI w profilu zgodności LoadCrafta (3.0.3, jawne `security` per operacja, bez stratnych `anyOf`), walidowany dołączonym skryptem. |
| [`loadcraft-journeys`](skills/loadcraft-journeys/) | `loadcraft/journeys/*.txt` | Analizuje kod frontendu i pisze ścieżki użytkownika jako czysty tekst — każdy plik to dokładnie wartość pola opisu scenariusza w LoadCrafcie. |

Oba skille mają wspólne zasady: repo klienta jest tylko do odczytu, braki
dowodów w kodzie są raportowane jako blokery (nigdy zgadywane ani wpisywane
jako TODO do artefaktu), sekrety i dane klienta nie trafiają do wyników.

## Układ repozytorium

- **[`skills/`](skills/)** — źródło skilli + [instrukcja użycia](skills/README.md)
  dla każdego narzędzia. Każdy skill: `SKILL.md` + `references/` + `scripts/`
  (walidator w czystym Pythonie, bez zależności).
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
  Shopcraft, w tym porównanie z poprzednią generacją skilli.
- **`legacy/`** — poprzednie skille ogólnego przeznaczenia (`api-docs`,
  `user-flows`). Produkowały dokumentację dla ludzi, nie bezpośredni input
  LoadCrafta; zachowane jako materiał źródłowy.

Katalog `.claude/skills/` zawiera tylko symlinki do `skills/` — dzięki temu
skille działają lokalnie w Claude Code, a źródło prawdy jest jedno.
