# Mod LoadCraft

Plugin LoadCraft działa w pełni bez moda: pracę wykonują skille, serwer MCP i komendy
`/loadcraft:…`. Mod to opcjonalna warstwa, która działa wewnątrz Claude Code i dodaje to, czego sam
plugin nie narysuje ani nie zapyta. Jest częścią pluginu i jest domyślnie włączony.

English version: [USER.md](USER.md).

## Co daje mod

| Bez moda | Z modem |
| --- | --- |
| Plan ośmiu kroków model trzyma w rozmowie | Wiersz nad polem wpisywania: projekt, środowisko, osiem kroków (zrobione, bieżący, przed nami). W VS Code tego wiersza nie ma, krok trafia do linii statusu |
| Postęp testu jako tekst w wyniku | Linia statusu z czasem testu i liczbami na żywo, żywy wiersz z małym wykresem pod trwającym `run_start` (terminal), powiadomienie, gdy operacja się kończy albo czeka na Ciebie |
| Czekanie na długą operację (analiza projektu, propozycje ścieżek, flowy, scenariusze, sprawdzenie danych, konta, test) z samym tekstem do oglądania | Pasek postępu przy każdej operacji w toku: etap (`scenariusz 2/2 · …`), procent, gdy LoadCraft go podaje, albo powoli przesuwający się blok, gdy nie, czas od startu. Jeden pasek na operację: w wierszu nad polem wpisywania, pod czekającym wywołaniem i w panelu; gdy operacja się kończy, jej pasek przez kilka sekund mówi *zakończone* i znika |
| Zgodę zbiera skill w rozmowie | Okno z liczbami przed testem, przed założeniem kont, przed logowaniem agenta przeglądarki i przed przerwaniem testu |
| Wyniki jako zwykły tekst | Raport, diagnoza i konspekt flow rysowane w kolorze z tych samych danych, z których powstaje tekst narzędzia |
| — | Panel boczny `/loadcraft-panel`: trwający test z przyciskiem **Przerwij test**, projekt, ostatnie wyniki oraz zakładka **Ścieżka**, w której wybierasz sposób budowy flowów i proponowane ścieżki do zbudowania (wybór trafia do agenta jako wiadomość; to nie jest zgoda na nic, co zapisuje albo kosztuje) |

To, co czyta model, się nie zmienia: mod rysuje dla Ciebie i Ciebie pyta, nie przepisuje wyników
ani argumentów narzędzi.

## Wymagania

- Claude Code **2.1.287** lub nowszy w terminalu; aplikacja Desktop **2.1.286** lub nowsza;
  rozszerzenie VS Code **2.1.299** lub nowsze (**2.1.304** w sesji, która nie pobiera flag funkcji,
  np. na Amazon Bedrock). Wersję sprawdzisz poleceniem `claude --version` albo `/status` w Desktop.
  W starszej wersji mod się nie ładuje, a plugin działa jak bez niego.
- Skonfigurowany **token API** pluginu (`/plugin` → LoadCraft → konfiguracja). Bez niego Claude Code
  nie ładuje moda, a sprawdzenie przy starcie pluginu podpowiada `/loadcraft:doctor`.
- Niczego nie trzeba włączać: mody są domyślnie włączone. Dawną zmienną
  `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` te wersje pomijają; ustawienie jej na `0` nie wyłącza modów.

## Jak sprawdzić, że działa

- W sesji w terminalu wpisz `/plugin`. Przygaszona linia pod zakładkami wymienia mody załadowane w
  sesji, np. `1 mod active · loadcraft` (liczba obejmuje też Twoje inne mody).
- Po pierwszym wywołaniu narzędzia LoadCraft wiersz nad polem wpisywania pokazuje projekt i krok.
- `/loadcraft-panel` otwiera panel boczny.
- Jeśli nic się nie pojawia: uruchom `claude --debug` i poszukaj w logu `hooks module loadcraft@… loaded`
  albo `not loaded:` z powodem. `claude plugin test` uruchomione w katalogu bez moda mówi, czy Twoje
  ustawienia w ogóle pozwalają ładować mody (`no hooks module to load` znaczy, że tak).

## Co mod robi, a czego nie

Mod to kod, który działa z Twoimi uprawnieniami wewnątrz Claude Code; nie ma piaskownicy. Ten mod
trzyma się poniższych zasad, a jego testy sprawdzają każdą z nich na zbudowanym pliku:

- **Nie** otwiera sieci, nie czyta ani nie zapisuje plików, nie uruchamia programów, nie czyta
  zmiennych środowiska ani ustawień, nie woła modelu, nie zatwierdza wywołań narzędzi, nie przepisuje
  promptu, wywołania narzędzia ani wyniku. Jedyny tekst, jaki wkłada do rozmowy, to wybór z zakładki
  **Ścieżka** panelu (sposób budowy flowów, ścieżki do zbudowania), wysłany jako jedna wiadomość
  pluginu po naciśnięciu przycisku. Sam z siebie nie wysyła niczego, a wybór nie jest zgodą: pytania
  serwera nadal należą do Ciebie.
- Z opcji pluginu czyta tylko język; tokenu API mod nie czyta i nigdy nie zapisuje go w stanie sesji.
- Do serwera MCP tego pluginu woła zamkniętą listę narzędzi:
  - `process_get_status`, tylko do odczytu, z `format: "data"`: fakty dla wiersza kroków, linii statusu,
    panelu, rysunków wyników i okna zgody; z `progress: true` czyta paski z własnego pliku stanu pluginu i niczego
    nie pyta LoadCraft;
  - `process_cancel`, wyłącznie po Twojej odpowiedzi „tak” w oknie przycisku **Przerwij test**.

  Nigdy nie woła `run_start` ani żadnego narzędzia, które coś zmienia.
- W stanie sesji trzyma pięć wartości (`session`, `progress`, `bars`, `panel`, `consent`): nazwy projektu
  i środowiska, krok, operację w toku, ostatni odczyt testu, Twoje zgody z ostatnich dziesięciu
  minut i paski widoczne na ekranie. Blok paska bez procentu przesuwa się o jedną komórkę na
  sekundę i nigdy nie mruga; ta wersja Claude Code nie daje modowi sygnału „ogranicz ruch”, a zegar
  za nim chodzi tylko, gdy jakiś pasek jest na ekranie. W magazynie pluginu trzyma jedną preferencję: czy panel otwiera się sam przy starcie testu.
  Żadnego tokenu, hasła ani adresu Twojego systemu.

## Okno zgody

Przed wywołaniem ze skutkiem poza edytorem mod czyta fakty z serwera i pyta:

- `run_start` na środowisku **chronionym** albo z obciążeniem **przyciętym** do limitów środowiska:
  środowisko, obciążenie żądane i faktyczne, planowany czas, dane testowe. Test w limitach
  niechronionego środowiska nie wywołuje pytania.
- `data_create_accounts`, które **zakłada konta** w testowanym systemie: ile, dla którego slotu, na
  którym środowisku. Claude Code przed każdym jego wywołaniem pokazuje też własne okno zgody.
- `flows_describe_journeys`, gdy agent przeglądarki **loguje się** kontem z pliku.
- `process_cancel` operacji, która jeszcze trwa: której i jak daleko doszła.

Tylko pierwsza opcja oznacza „tak”. „Nie”, zamknięcie okna albo własny tekst odrzucają wywołanie:
narzędzie nie rusza, a model czyta, że odmówiłeś, i dostaje polecenie, żeby nie ponawiać. „Tak”
przepuszcza wywołanie bez zmian. Gdy serwer poprosi potem o jawne potwierdzenie (`confirm_capped`,
`confirm_protected`) i model powtórzy wywołanie z nim, mod nie pyta drugi raz: jedno „tak” obejmuje
jedno powtórzenie z tymi samymi liczbami, przez dziesięć minut.

**Dlaczego Claude Code może zapytać jeszcze raz.** Mod niczego nie zatwierdza za Claude Code. Po
Twoim „tak” Claude Code robi własne sprawdzenie uprawnień: `run_start` zawsze pokazuje okno uprawnień
Claude Code (serwer oznacza je jako wymagające Ciebie), a inne narzędzia pytają, jeśli nie masz dla
nich reguły zezwalającej. Przed testem możesz więc zobaczyć dwa okna: moda, z liczbami, i Claude Code.

**Kiedy mod się nie wtrąca.** Gdy nie ma kogo zapytać (`claude -p`, Agent SDK), gdy serwer nie poda
faktów (np. starszy serwer) albo gdy sam mod zawiedzie, zanim zapyta, wywołanie idzie dalej jak bez
moda i działają zabezpieczenia serwera: obciążenie jest przycinane do limitów środowiska, a chronione
środowisko wymaga jawnego potwierdzenia, o które pyta skill.

## Jak wyłączyć mod

| Co                             | Jak                                                   | Co jeszcze się zatrzymuje                                                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cały plugin                    | `/plugin` → **Installed** → LoadCraft → wyłącz        | Mod nie ma osobnego przełącznika: zatrzymują się też skille, serwer MCP i komendy                                                                                                                         |
| Wszystko, na jedną sesję       | Uruchom `claude --safe-mode`                          | Wszystkie zainstalowane pluginy (także LoadCraft ze skillami i serwerem), Twoje hooki, serwery MCP, `CLAUDE.md` i inne dostosowania. Służy do sprawdzenia, czy problem pochodzi z moda                    |
| Wszystkie mody, plugin zostaje | `"disableAllHooks": true` w `~/.claude/settings.json` | Wszystkie Twoje inne mody, hooki z ustawień, własna linia statusu i `/goal`; także sprawdzenie przy starcie pluginu (`/loadcraft:doctor` działa dalej). Skille, serwer MCP i `/loadcraft:status` działają |

Żeby włączyć ponownie, cofnij tę samą zmianę. W organizacji administrator może też odrzucać mody
użytkowników (niżej).

## Dla administratorów

**Przejrzyj, zanim dopuścisz.** Uruchom `claude plugin validate` na katalogu pluginu (Claude Code
2.1.323 lub nowszy wypisuje długie listy w całości). Dla tego moda zobaczysz:

```text
❯ ../mod/register.js hooks: session.start, tool.call{tool=…run_start|…data_create_accounts|…flows_describe_journeys|…process_cancel}, tool.call{tool=…process_get_status}, tool.call{tool=/"^mcp__plugin_loadcraft_lc__"/}, ui.render{component=AbovePrompt} (default matcher key: plugin), ui.render{component=ToolUse}, ui.render{component=ToolResult}, ui.render{component=ToolProgress}, command.run{command=loadcraft-panel}, ui.render{component=Pane} (default matcher key: plugin)
❯ ../mod/register.js gating hook with .catch: tool.call{…}
❯ ../mod/register.js calls: $.clock.after, $.clock.every, $.clock.now, $.command.register, $.mcp.call, $.prompt.submit, $.session.surfaces, $.state.get, $.state.set, $.store.get, $.store.set, $.ui.ask, $.ui.invalidate, $.ui.notify, $.ui.open, $.ui.resolve, $.ui.status, $.ui.toast
❯ ../mod/register.js state writes: loadcraft.consent, loadcraft.panel, loadcraft.progress, loadcraft.session
```

- `tool.call` oznacza, że mod widzi każde wywołanie narzędzia. Reaguje tylko na narzędzia tego
  pluginu (trzy filtry powyżej) i nigdy nie odpowiada zamiast narzędzia.
- Nie ma `$.fs`, `$.process`, `$.http`, `$.env`, `$.settings`, `$.model`, `$.tool` ani
  `tool.check`. Z `$.prompt` mod używa tylko `submit`, z jednej funkcji, dla zakładki Ścieżka.
- `$.mcp.call` woła narzędzie podłączonego serwera MCP **bez okna uprawnień**. Linia nie wymienia
  narzędzi; w tym modzie to `process_get_status` (tylko odczyt) i `process_cancel` (tylko po „tak” użytkownika w oknie
  moda), oba na własnym serwerze pluginu `plugin:loadcraft:lc`.
- Hook z `.catch` przepuszcza wywołanie, gdy sam zawiedzie, więc awaria moda nigdy nie blokuje
  narzędzia; zabezpieczenia serwera zostają.

**Wbudowany strażnik.** Żaden hook moda nie jest na zdarzeniu, które wbudowany strażnik
(`cc-plugin-sec-default`) pomija, więc mod działa tak samo tam, gdzie strażnik się ładuje.

**Odrzucanie modów użytkowników.** Opcja strażnika `allowManagedModsOnly` w ustawieniach zarządzanych
(`pluginConfigs` → `cc-plugin-sec-default@builtin` → `options`) sprawia, że Claude Code odrzuca ten
mod, gdy użytkownik sam zainstalował plugin; reszta pluginu (skille, serwer MCP, komendy) ładuje się
dalej. W logu debugowania jest wtedy `refused by cc-plugin-sec-default: mods are limited to your
organization's by policy (allowManagedModsOnly)`. `disableAllHooks` w ustawieniach zarządzanych
zatrzymuje każdy mod i każdy hook, także organizacji.

**Mod jako własny mod organizacji.** Żeby mod działał tam, gdzie mody użytkowników są odrzucane,
zainstaluj plugin tak, żeby liczył się jako Wasz, w ustawieniach zarządzanych:

- `enabledPlugins`: plugin ustawiony na `true`;
- `extraKnownMarketplaces`: marketplace, który go wymienia (ze zdalnego marketplace’u wymaga to
  Claude Code 2.1.324 lub nowszego; przypnij marketplace, żeby kontrolować, kiedy zmienia się kod);
- `prependPlugins` albo `appendPlugins`: identyfikator pluginu. Przy `prependPlugins` wpisz też
  `sec-default@builtin`, inaczej wbudowany strażnik zostanie usunięty.

Sprawdź na maszynie testowej przez `claude --debug`: linia `hooks module loadcraft@<marketplace> loaded`
ma `tier prepend` (albo `append`). `tier user` znaczy, że plugin wciąż liczy się jako użytkownika;
linia `… is enabled by managed settings, but` mówi dlaczego. Szczegóły: strona Claude Code „Manage
mods for your organization”.

## Gdzie działa

| Gdzie                                                    | Mod                                                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `claude` w terminalu (także terminal edytora, JetBrains) | Wszystko                                                                                                             |
| Aplikacja Desktop, zakładka Code                         | Wszystko oprócz żywego wiersza pod `run_start` (tylko terminal)                                                       |
| Rozszerzenie VS Code                                     | Bez wiersza nad polem wpisywania (krok jest w linii statusu), bez żywego wiersza, bez skrótów klawiszowych           |
| `claude -p`, Agent SDK                                   | Hooki działają, nic nie jest rysowane; okno zgody nie ma kogo zapytać, więc wywołanie trafia do zabezpieczeń serwera |
| Desktop w sesji WSL                                      | Niedostępny: pluginy nie są dostępne w sesjach WSL                                                                   |
| Desktop w sesji SSH                                      | Niedostępny dla pluginu zainstalowanego tylko na Twoim komputerze: Desktop nie kopiuje jego hooków na zdalną maszynę |

Po `/clear`, `/resume` albo `/branch` wiersz nad polem wpisywania jest pusty do następnego wywołania
narzędzia LoadCraft, które go uzupełni.
