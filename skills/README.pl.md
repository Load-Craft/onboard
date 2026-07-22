[English](README.md) | **Polski**

# Skille AI — instrukcje do pobrania

Ten katalog zawiera gotowe "skille" — instrukcje robocze dla asystentów AI,
które przygotowują pliki wejściowe dla LoadCrafta z kodu Twojego projektu.
Każdy skill to **jeden folder**: plik `SKILL.md` (główna instrukcja), katalog
`references/` z materiałami pomocniczymi oraz `scripts/` z walidatorem wyniku
(czysty Python 3, bez instalowania zależności).

Skille są **niezależne od narzędzia** — to zwykły Markdown + skrypt. Zadziałają
w Claude Code, Codex, GitHub Copilot, Cursor, Windsurf, Gemini CLI i w każdym
innym asystencie, któremu można podać plik lub wkleić tekst.

## Dostępne skille

| Skill | Wynik | Co robi |
|---|---|---|
| [`loadcraft-openapi`](loadcraft-openapi/) | `loadcraft/openapi.json` | Analizuje kod API (bez modyfikowania go) i buduje jeden plik OpenAPI zgodny z importerem LoadCrafta. Braków w kodzie nie zgaduje — raportuje je jako blokery. Umie też zaktualizować lub zaudytować istniejący plik. |
| [`loadcraft-journeys`](loadcraft-journeys/) | `loadcraft/journeys/*.txt` | Analizuje kod frontendu i opisuje ścieżki użytkownika czystym tekstem — każdy plik `.txt` wklejasz w LoadCrafcie jako opis scenariusza, bez żadnej obróbki. |

Skille domyślnie **tylko czytają** repozytorium — zapisują wyłącznie pliki
wynikowe w katalogu `loadcraft/`. Nie uruchamiają aplikacji ani nie instalują
zależności.

## Jak użyć — zasada ogólna

1. **Pobierz cały folder skilla** (SKILL.md + references/ + scripts/ muszą być
   razem — instrukcja odwołuje się do tych plików, a walidator jest częścią
   workflow).
2. Udostępnij go swojemu AI (sposoby poniżej).
3. Poproś AI: *"Przeczytaj plik SKILL.md i wykonaj opisany tam workflow dla
   tego projektu."*

Skill prowadzi AI przez analizę kodu, zapis wyniku i walidację. Na końcu
dostajesz plik(i) w `loadcraft/` oraz raport: co zostało pokryte, co pominięto
i dlaczego. Wynik możesz też sprawdzić ręcznie:

```bash
python3 skills/loadcraft-openapi/scripts/validate_openapi.py loadcraft/openapi.json
python3 skills/loadcraft-journeys/scripts/validate_journeys.py loadcraft/journeys
```

## Instrukcje dla konkretnych narzędzi

### Claude Code
Skopiuj folder skilla do projektu, do `.claude/skills/`:

```bash
mkdir -p .claude/skills
cp -r loadcraft-openapi .claude/skills/
```

Claude Code wykryje skill automatycznie — wystarczy poprosić np.
*"przygotuj to API pod LoadCraft"* albo wywołać go po nazwie. Możesz też
skopiować do `~/.claude/skills/`, żeby był dostępny we wszystkich projektach.

### Codex (OpenAI)
Wgraj folder do repozytorium i dopisz w `AGENTS.md` (w katalogu głównym):

```
Przy przygotowywaniu OpenAPI dla LoadCrafta wykonaj workflow
z skills/loadcraft-openapi/SKILL.md.
Przy opisywaniu ścieżek użytkownika — skills/loadcraft-journeys/SKILL.md.
```

Po publikacji tego repo na GitHubie skille można też instalować bezpośrednio:

```bash
npx skills add <owner>/<repo> --skill loadcraft-openapi
```

### Cursor
Wgraj folder skilla do repozytorium (np. do `skills/`), a w czacie napisz:

```
@skills/loadcraft-openapi/SKILL.md
Przeczytaj tę instrukcję i wykonaj opisany workflow dla tego projektu.
```

Opcjonalnie dodaj regułę w `.cursor/rules/`, która wskazuje na plik skilla,
żeby Cursor sięgał po niego automatycznie.

### GitHub Copilot (VS Code / JetBrains)
W oknie czatu Copilota dodaj plik jako kontekst (**Add Context → Files** lub
`#file`), wskaż `SKILL.md` i poproś o wykonanie workflow. Przy dłuższej pracy
warto dodać wpis w `.github/copilot-instructions.md`:

```
Przy przygotowywaniu artefaktów LoadCrafta stosuj się do
skills/loadcraft-openapi/SKILL.md i skills/loadcraft-journeys/SKILL.md.
```

### Dowolne inne AI (ChatGPT, Gemini, itd.)
Wklej lub załącz zawartość `SKILL.md` oraz plików z `references/` i napisz:
*"To jest instrukcja robocza. Zastosuj ją do mojego projektu, faza po fazie."*
Walidator ze `scripts/` uruchom ręcznie na wyniku.

## Uwagi

- Skille są napisane po angielsku (lepiej rozumiane przez wszystkie modele),
  ale możesz rozmawiać z AI po polsku — raporty będą w języku rozmowy.
  Pliki wynikowe (`openapi.json`, `journeys/*.txt`) powstają w formacie
  wymaganym przez LoadCraft niezależnie od języka rozmowy.
- Fragmenty o "subagentach" dotyczą narzędzi, które je wspierają (np. Claude
  Code); w narzędziach bez subagentów skill wykonuje te same kroki sekwencyjnie.
- Dane logowania do testów podajesz w LoadCrafcie osobno — skille celowo
  nie wpisują żadnych credentiali ani sekretów do plików wynikowych.
- Jeśli skill czegoś nie może potwierdzić w kodzie, nie zgaduje — pomija ten
  fragment i wymienia go w raporcie jako bloker do wyjaśnienia.
