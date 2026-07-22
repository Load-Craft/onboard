[English](INSTALL.md) | **Polski**

# Instalacja — jednorazowa konfiguracja

Zrób to raz, przed pierwszym użyciem. Wybierz swoje narzędzie poniżej i
uruchom komendy w **katalogu głównym swojego projektu**. Komendy instalują
oba skille; folder każdego skilla zostaje kompletny (`SKILL.md` +
`references/` + `scripts/`), co jest wymagane do działania. (Wolisz ZIP-y?
Gotowe są w [`dist/`](../dist/) — rozpakuj je do tego samego katalogu
docelowego.)

## Claude Code

```bash
rm -rf /tmp/onboard
git clone --depth 1 https://github.com/Load-Craft/onboard /tmp/onboard
mkdir -p .claude/skills
cp -r /tmp/onboard/skills/loadcraft-openapi /tmp/onboard/skills/loadcraft-journeys .claude/skills/
```

Żeby skille były dostępne we **wszystkich** Twoich projektach zamiast w
jednym, skopiuj je zamiast tego do katalogu domowego:

```bash
mkdir -p ~/.claude/skills
cp -r /tmp/onboard/skills/loadcraft-openapi /tmp/onboard/skills/loadcraft-journeys ~/.claude/skills/
```

Claude Code wykrywa skille automatycznie — po instalacji po prostu poproś
*"przygotuj to API pod LoadCraft"*.

## Cursor

```bash
rm -rf /tmp/onboard
git clone --depth 1 https://github.com/Load-Craft/onboard /tmp/onboard
mkdir -p skills
cp -r /tmp/onboard/skills/loadcraft-openapi /tmp/onboard/skills/loadcraft-journeys skills/
```

Potem napisz w czacie:

```
@skills/loadcraft-openapi/SKILL.md
Przeczytaj tę instrukcję i wykonaj opisany workflow dla tego projektu.
```

## Codex (OpenAI)

```bash
rm -rf /tmp/onboard
git clone --depth 1 https://github.com/Load-Craft/onboard /tmp/onboard
mkdir -p skills
cp -r /tmp/onboard/skills/loadcraft-openapi /tmp/onboard/skills/loadcraft-journeys skills/
cat >> AGENTS.md <<'EOF'
Przy przygotowywaniu OpenAPI dla LoadCrafta wykonaj workflow
z skills/loadcraft-openapi/SKILL.md.
Przy opisywaniu ścieżek użytkownika — skills/loadcraft-journeys/SKILL.md.
EOF
```

Potem poproś Codexa np. *"przygotuj to API pod LoadCraft"*.

## GitHub Copilot (VS Code / JetBrains)

```bash
rm -rf /tmp/onboard
git clone --depth 1 https://github.com/Load-Craft/onboard /tmp/onboard
mkdir -p skills .github
cp -r /tmp/onboard/skills/loadcraft-openapi /tmp/onboard/skills/loadcraft-journeys skills/
cat >> .github/copilot-instructions.md <<'EOF'
Przy przygotowywaniu artefaktów LoadCrafta stosuj się do
skills/loadcraft-openapi/SKILL.md i skills/loadcraft-journeys/SKILL.md.
EOF
```

Potem w oknie czatu Copilota dodaj `skills/loadcraft-openapi/SKILL.md` jako
kontekst (**Add Context → Files** lub `#file`) i poproś o wykonanie workflow.

## Dowolne inne AI (ChatGPT, Gemini, itd.)

Wklej lub załącz zawartość `SKILL.md` oraz plików z `references/` i napisz:
*"To jest instrukcja robocza. Zastosuj ją do mojego projektu, faza po fazie."*
Walidator ze `scripts/` uruchom ręcznie na wyniku.

---

Zainstalowane? Przejdź do [przewodnika użytkownika](README.pl.md).
