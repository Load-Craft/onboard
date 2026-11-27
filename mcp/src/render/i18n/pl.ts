// Polish dictionary. The annotation makes a missing or extra key a compile error.
// Product names (load profiles, Normal / Realistic / Custom, SLA FAILED) stay untranslated.

import type { Dictionary } from './en.js';
import { operationPl } from './operation.js';
import { stepsPl } from './steps.js';
import { resultsPl } from './results.js';
import { panePl } from './pane.js';
import { cardPl } from './card.js';
import { profilePl } from './profile.js';
import { deletionPl } from './deletion.js';
import { consentPl } from './consent.js';
import { failuresPl } from './failures.js';

export const pl: Dictionary = {
  ...operationPl,
  // The eight steps of a test session, as the mod's band above the prompt names them.
  ...stepsPl,
  ...resultsPl,
  ...panePl,
  ...cardPl,
  ...profilePl,
  ...deletionPl,
  ...consentPl,
  ...failuresPl,

  'demo.notice': 'tryb demonstracyjny — dane przykładowe',

  'link.projectProfile': 'Profil aplikacji',
  'link.flow': 'Flow',
  'link.describeRun': 'podgląd na żywo',
  'link.harImport': 'Import HAR',
  'link.composition': 'Kompozycja',
  'link.scenario': 'Scenariusz',
  'link.feeders': 'Zbiory danych',
  'link.executionLive': 'Przebieg na żywo',
  'link.executionResults': 'Wyniki',
  'link.compare': 'Porównanie',
  'link.projects': 'Projekty',
  'link.flows': 'Flowy',

  'operation.channelUnavailable': 'Kanał na żywo jest niedostępny; sprawdzam wynik co 5 s.',
  'operation.progressNote': '{message} {note}',
  'operation.running.state': 'Operacja wciąż trwa w LoadCraft: {operation}.',
  'operation.running.next':
    'Wywołaj process_wait z operation „{operation}”, żeby czekać dalej; LoadCraft w tym czasie pracuje.',
  'operation.needs_user.state': 'Operacja czeka na użytkownika: {operation}.',
  'operation.needs_user.next':
    'Pokaż użytkownikowi komunikat powyżej; gdy skończy, wywołaj process_wait z operation „{operation}”.',

  'error.unauthorized.message': 'LoadCraft nie przyjął tokenu API: jest nieważny albo odwołany.',
  'error.unauthorized.hint':
    'Utwórz w LoadCraft nowy token API, wpisz go w opcjach wtyczki i uruchom /loadcraft:doctor.',
  'error.unauthorized.noToken.message':
    'Token API LoadCraft nie jest ustawiony, więc nic nie wysłano.',
  'error.unauthorized.noToken.hint':
    'Ustaw token API w opcjach wtyczki i uruchom /loadcraft:doctor.',
  'error.forbidden.message': 'LoadCraft odmówił tej akcji dla bieżącego tokenu API.',
  'error.forbidden.hint':
    'Powiedz użytkownikowi: właściciel tokenu nie ma dostępu do tego projektu albo tej akcji. Nie ponawiaj.',
  'error.not_found.message':
    'LoadCraft nie zna tej pozycji: nie powstała, została usunięta albo należy do innego projektu.',
  'error.not_found.hint':
    'Sprawdź identyfikator albo najpierw wypisz pozycje i wybierz jedną z listy.{available}',
  'error.ambiguous.message': 'Do „{name}” pasuje więcej niż jedna pozycja ({kind}).',
  'error.ambiguous.hint':
    'Zapytaj użytkownika, o którą chodzi, albo użyj identyfikatora. Kandydaci: {candidates}.',
  'error.no_project.message':
    'Nie wybrano projektu: katalog nie jest powiązany z projektem LoadCraft i nie podano żadnego.',
  'error.no_project.hint': 'Uruchom project_create albo podaj nazwę projektu.',
  'error.not_implemented.message':
    'To narzędzie jest zarejestrowane, ale jeszcze nie napisane: niczego nie zrobiło.',
  'error.not_implemented.hint':
    'Nie ponawiaj; powiedz użytkownikowi, że ten krok nie jest dostępny w tej wersji pluginu.',
  'error.missing_argument.message':
    'Potrzebny jest argument {name}: nie podano go, a stan procesu go nie zawiera.',
  'error.missing_argument.hint':
    'Podaj {name} albo uruchom process_get_status, żeby zobaczyć, co zawiera stan, i wywołaj narzędzie ponownie.',
  'error.missing_argument.hint.scenario_id':
    'Podaj scenario_id: scenario_list pokazuje scenariusze projektu z ich id (dla planera podziału ruchu podaj draft_id), potem wywołaj narzędzie ponownie.',
  'error.missing_argument.hint.docs_id':
    'Podaj docs_id: project_get_docs z versions=true wypisze id zapisanych dokumentacji (sam project_get_docs poda aktywną), potem wywołaj narzędzie ponownie.',
  'error.missing_argument.hint.composition_id':
    'Podaj composition_id, id albo nazwę: scenario_list_compositions wypisuje kompozycje projektu (scenario_generate tworzy ją, gdy projekt żadnej nie ma), potem wywołaj narzędzie ponownie.',
  'error.missing_argument.hint.environment_id':
    'Podaj environment_id, środowisko zapisanego przebiegu: project_get_envs je wypisuje. Zapisany przebieg dostaje środowisko, które mu podano, nigdy takie, które wybrała ta przestrzeń, potem wywołaj narzędzie ponownie.',
  'error.missing_argument.hint.workload':
    'Podaj workload, obciążenie zapisanego przebiegu jako {type, vusers, ramp, hold}: run_plan podaje gotowe profile. Zastępuje zapisane obciążenie w całości, potem wywołaj narzędzie ponownie.',
  'error.missing_argument.hint.profile':
    'Podaj profile, profil obciążenia do użycia (type, vusers, ramp, hold): run_get_profiles wypisuje zapisane profile; ta przestrzeń żadnego jeszcze nie wybrała, potem wywołaj narzędzie ponownie.',
  'error.missing_argument.hint.snapshot_id':
    'Podaj snapshot_id: traffic_list_snapshots wypisuje migawki ruchu produkcyjnego projektu z ich id (pusta lista oznacza, że żadna nie została jeszcze wysłana), potem wywołaj narzędzie jeszcze raz.',
  'error.missing_argument.hint.run_id':
    'Podaj run_id: run_list wypisuje przebiegi projektu od najnowszego z ich uchwytami (e-xxxxxxxx), potem wywołaj narzędzie jeszcze raz.',
  'error.missing_argument.hint.compare_to':
    'Podaj compare_to: uchwyt albo UUID przebiegu z run_list, albo „baseline” dla przypiętego odniesienia; potem wywołaj narzędzie jeszcze raz.',
  'error.missing_argument.hint.flow_id':
    'Podaj flow_id: flows_list wypisuje flowy projektu z ich id, potem wywołaj narzędzie jeszcze raz.',
  'error.missing_argument.hint.dataset_id':
    'Podaj dataset_id: data_list_datasets wypisuje zbiory danych projektu z ich id, potem wywołaj narzędzie jeszcze raz.',
  'error.missing_argument.hint.walk_id':
    'Podaj walk_id: żadne narzędzie nie wypisuje przejść. Id drukuje wywołanie, które nagrało przejście (flows_record_journeys), a stan procesu pamięta ostatnie; ta przestrzeń nie ma żadnego, więc zapytaj użytkownika, o które przejście chodzi.',
  'error.missing_argument.hint.draft_id':
    'Podaj draft_id: id szkicu podziału ruchu, który zwrócił scenario_suggest_split. Żadne narzędzie nie wypisuje szkiców, a ta przestrzeń nie ma żadnego: najpierw zaproponuj podział.',
  'resolve.kind.project': 'projekt',
  'resolve.kind.environment': 'środowisko',
  'resolve.kind.flow': 'flow',
  'resolve.kind.scenario': 'scenariusz',
  'resolve.kind.composition': 'kompozycja',
  'resolve.kind.execution': 'wykonanie',
  'resolve.kind.target': 'kompozycja albo scenariusz',
  'resolve.notFound': 'Nie znaleziono: {kind} „{name}”. Dostępne: {names}.',
  'resolve.notFound.empty': 'Nie znaleziono: {kind} „{name}”. Lista jest pusta.',
  'resolve.more': '{names} i jeszcze {count}',

  'verdict.state.sla_passed': 'SLA PASSED',
  'verdict.state.sla_failed': 'SLA FAILED',
  'verdict.state.sla_not_judged': 'bez werdyktu SLA',
  'verdict.state.invariants_violated': 'naruszone niezmienniki',
  'verdict.state.completed_with_errors': 'zakończony z błędami',
  'verdict.state.run_failed': 'nieudany',
  'verdict.state.cancelled': 'anulowany',
  'verdict.state.in_progress': 'w toku',

  'status.identity': 'zalogowany jako {user} · LoadCraft {version} · API {revision} ✓',
  'status.project': 'Projekt „{name}”',
  'status.setup.complete': 'konfiguracja kompletna ✓',
  'status.setup.incomplete': 'konfiguracja niepełna · brakuje: {missing}',
  'status.setup.incompleteUnknown': 'konfiguracja niepełna',
  'status.env.default': 'domyślne',
  'status.env.protected': 'chronione',
  'status.env.caps': 'limit {caps}',
  'status.env.capUsers': {
    one: '{count} użytkownik',
    few: '{count} użytkowników',
    many: '{count} użytkowników',
    other: '{count} użytkownika',
  },
  'status.env.capRps': {
    one: '{count} zapytanie/s',
    few: '{count} zapytania/s',
    many: '{count} zapytań/s',
    other: '{count} zapytania/s',
  },
  'status.env.noCaps': 'bez limitu',
  'status.env.protectedNoCaps': 'bez limitów, więc uruchomienie zostanie odrzucone',
  'status.env.inactive': 'nieaktywne',
  'status.count.flows': {
    one: '{count} flow',
    few: '{count} flowy',
    many: '{count} flowów',
    other: '{count} flowu',
  },
  'status.count.scenarios': {
    one: '{count} scenariusz',
    few: '{count} scenariusze',
    many: '{count} scenariuszy',
    other: '{count} scenariusza',
  },
  'status.count.compositions': {
    one: '{count} kompozycja',
    few: '{count} kompozycje',
    many: '{count} kompozycji',
    other: '{count} kompozycji',
  },
  'status.runs.title': 'ostatnie uruchomienia',
  'status.runs.none': 'jeszcze żaden test nie był uruchomiony',
  'status.ops.title': 'operacje w toku (wynik odbierze process_wait)',
  'status.ops.started': 'start {ago}',
  'status.ago.now': 'przed chwilą',
  'status.ago.minutes': {
    one: '{count} min temu',
    few: '{count} min temu',
    many: '{count} min temu',
    other: '{count} min temu',
  },
  'status.ago.hours': {
    one: '{count} godz. temu',
    few: '{count} godz. temu',
    many: '{count} godz. temu',
    other: '{count} godz. temu',
  },
  'status.ago.days': {
    one: '{count} dzień temu',
    few: '{count} dni temu',
    many: '{count} dni temu',
    other: '{count} dnia temu',
  },
  'flow.list.ready': {
    one: '{count} flow gotowy',
    few: '{count} flowy gotowe',
    many: '{count} flowów gotowych',
    other: '{count} flowu gotowego',
  },
  'flow.get.version': 'wersja {version}',
  'slot.ref': '{label} (slot: {key})',
  'status.section.flows': 'flowy',
  'status.section.scenarios': 'scenariusze',
  'status.section.compositions': 'kompozycje: {names}',
  'status.section.data': 'sloty danych',
  'status.scenario.flow': 'flow {flow}',
  'status.scenario.version': 'v{version}',
  'status.selfCheck.passed': 'self-check ✓',
  'status.selfCheck.waiting_for_data': 'self-check czeka na dane',
  'status.selfCheck.other': 'self-check: {status}',
  'status.selfCheck.none': 'bez self-checku',
  'status.data.none': 'żaden scenariusz nie potrzebuje danych testowych',
  'status.data.legend': '✓ zbiór przypięty · ✕ brak, self-check na niego czeka',
  'status.next.unbound': 'Repozytorium nie jest związane z projektem — zacznij od project_create.',
  'status.next.setup_incomplete':
    'dalej: project_analyze_setup, potem project_apply_setup — dokończą konfigurację',
  'status.next.analysis_done':
    'dalej: project_apply_setup z analysis "{subject}" — analiza jest skończona, jej propozycje czekają na zastosowanie; nie analizuj ponownie',
  'status.next.no_flows':
    'dalej: flows_suggest_journeys — zaproponuje ścieżki; flowy powstają też przez flows_generate_from_endpoints, flows_describe_journeys albo flows_import_har',
  'status.next.no_compositions':
    'dalej: scenario_suggest_split — zaproponuje podział ruchu między flowy; scenario_generate zbuduje potem scenariusz',
  'status.next.needs_data': 'dalej: data_check_readiness — scenariusze czekają na dane: {subject}',
  'status.next.no_runs':
    'dalej: wybierz środowisko i profil, potem run_start — wszystko gotowe do pierwszego testu',
  'status.next.no_analysis': 'dalej: results_get_report dla {subject}, potem results_analyze_run',
  'status.next.passed_no_diagnosis':
    'dalej: results_get_report dla {subject}, żeby odczytać wynik — progi dotrzymane, nic więcej nie trzeba; diagnoza tylko na prośbę',
  'status.next.all_done':
    'dalej: wybierz środowisko i profil, potem run_start — ostatni test ma analizę; kolejny uruchom np. po poprawce',
  'data.title': {
    one: 'plan danych · {count} slot',
    few: 'plan danych · {count} sloty',
    many: 'plan danych · {count} slotów',
    other: 'plan danych · {count} slotu',
  },
  'data.title.none': 'plan danych · brak slotów',
  'data.label.more': '+{count} więcej',
  'data.cause': '{label}: {counts}{message}{kind}',
  'data.cause.have': '{have} wierszy w zbiorze · ',
  'data.cause.both': '{have} wierszy w zbiorze, potrzebne {need} · ',
  'data.cause.fresh':
    ' · {identity}: nowy zbiór (data_create_dataset ze scenario i slot) liczy zużyte wartości od zera',
  'data.cause.spent': '{have} wierszy w zbiorze, wolnych {free}{by} · ',
  'data.cause.spentNeed': '{have} wierszy w zbiorze, wolnych {free}{by}, potrzebne {need} · ',
  'data.cause.by': ' (zużyte przez {runs})',
  'data.cause.byEarlier': ' (zużyte przez wcześniejsze przebiegi)',
  'data.cause.rereads':
    'strategia „{strategy}” czyta plik od początku przy każdym przebiegu, więc ten przebieg wydałby najpierw już zużyte wartości',
  'data.cause.backend': 'backend: „{message}”',
  'data.cause.identity': ' · {identity}',
  'data.cause.regenerate':
    ' · wygeneruj na nowo zbiór „{dataset}” (id {id}): data_create_dataset ze scenario i slot robi nowe wiersze, albo wczytaj plik CSV z niezużytymi wartościami przez file i slot',
  'data.identity.fresh': 'nowe tożsamości do rejestracji (każda użyta raz)',
  'data.exclusive': 'wyłączne',
  'data.state.bound': 'przypięty',
  'data.state.auto': 'auto',
  'data.state.missing': 'brak',
  'data.state.column_mismatch': 'złe kolumny',
  'data.state.short_rows': 'za mało wierszy',
  'data.state.stale_pin': 'nieaktualne wiązanie',
  'data.state.empty_column': 'pusta kolumna',
  'data.state.parse_error': 'błąd pliku',
  'data.fix.accounts_must_exist': '{dataset} muszą istnieć na {environment}',
  'data.fix.dataset_missing': 'czeka na dane: {label}',
  'data.fix.data_missing': '{label}: brak danych, wypełni je wywołanie z propozycji',
  'data.fix.data_generate':
    '{label}: brak danych, data_create_dataset zrobi wiersze z kolumn slotu',
  'data.fix.data_generate.fresh':
    '{label}: brak danych, data_create_dataset zrobi nowe tożsamości z kolumn slotu; po każdym biegu, który dotarł do celu, zrób je od nowa, użyte są już zarejestrowane',
  'data.fix.slot_mixed':
    '{label}: jeden slot obsługuje logowanie i rejestrację: rozdziel go, osobny slot dla rejestracji',
  'data.fix.data_from_file':
    '{label}: brak danych, a żadne narzędzie nie ma jak ich zrobić ({reason}){hub} · podaj plik CSV z kolumnami {columns} przez data_create_dataset z file i slot',
  'data.fix.data_from_file.hub': ' · hub danych: {reply}',
  'data.fix.data_from_file.no_source': 'żaden scenariusz celu nie deklaruje wszystkich jego kolumn',
  'data.fix.data_from_file.secret_columns':
    'ma kolumnę z sekretem, a LoadCraft sekretów nie wymyśla',
  'data.fix.data_from_file.refused': 'LoadCraft odmówił: {detail}',
  'data.fix.column_mismatch': '{label}: zbiór ma złe kolumny',
  'data.fix.stale_pin': '{label}: wiązanie jest nieaktualne',
  'data.fix.empty_column': '{label}: zbiór ma pustą kolumnę',
  'data.fix.parse_error': '{label}: zbioru nie da się odczytać',
  'data.fixes': {
    one: '{count} poprawka przed testem: {fixes}',
    few: '{count} poprawki przed testem: {fixes}',
    many: '{count} poprawek przed testem: {fixes}',
    other: '{count} poprawki przed testem: {fixes}',
  },
  'data.ready':
    'każdy slot przypięty i wypełniony · czy wierszy starczy na profil, sprawdza run_plan z profilem',
  'data.ready.noSlots': 'scenariusz nie potrzebuje danych testowych · test może ruszyć',
  'data.provision.progress': '{done} / {total} kont',
  'data.provision.created': {
    one: '{count} założone',
    few: '{count} założone',
    many: '{count} założonych',
    other: '{count} założonych',
  },
  'data.provision.through': ' przez {operation}',
  'data.provision.batches.exact': ' ({batches} × {size})',
  'data.provision.batches': {
    one: ' ({batches} partia po maks. {size})',
    few: ' ({batches} partie po maks. {size})',
    many: ' ({batches} partii po maks. {size})',
    other: ' ({batches} partii po maks. {size})',
  },
  'data.provision.nothing': 'nic do założenia · zbiór ma już {count} kont',
  'data.provision.earlier': 'wcześniejsze wywołanie założyło {count}',
  'data.provision.on': ' na {environment}',
  'data.provision.failed': 'nieudanych: {count}',
  'data.provision.failure': 'cel odpowiedział {status}: {count}×',
  'data.provision.aborted': 'LoadCraft przerwał serię po kolejnych porażkach',
  'data.provision.next':
    '→ odczytaj status: 400 lub 422, żądanie rejestracji nie pasuje do celu (sprawdź flow albo podaj register_operation); 401 lub 403, cel wymaga klucza albo nagłówka (project_save_env z headers) albo nie pozwala na rejestrację; 409, takie konta już istnieją (podaj je w pliku: data_create_dataset z file i slot); 429 lub błąd serwera, cel jest przeciążony (powtórz raz z mniejszą liczbą).',
  'data.provision.masked': 'hasła zamaskowane',
  'data.provision.incomplete':
    'istnieje {done} z {total} kont · test nie jest gotowy; powtórz wywołanie, aby dołożyć resztę',
  'data.provision.confirm':
    'Założenie {count} kont dla {target} na chronionym środowisku {environment} wymaga zgody użytkownika; nic nie zostało wysłane. Zapytaj użytkownika i dopiero po zgodzie powtórz wywołanie z confirm_protected: true.',
  'data.provision.noCandidates': 'nie znaleziono w specyfikacji API',
  'data.provision.running':
    'Konta dla slotu {slot}: serwer wtyczki zakłada je dalej po tym wywołaniu. Wywołaj process_wait z operation "{operation}", żeby śledzić postęp; nie wołaj dla nich ponownie data_create_accounts.',
  'data.provision.running.joined':
    'Konta dla slotu {slot} już były zakładane: to wywołanie dołączyło do tej pracy zamiast zaczynać drugą. Wywołaj process_wait z operation "{operation}", żeby śledzić postęp.',
  'data.provision.stopped.cancelled':
    '{done} z {total} kont istnieje · zatrzymane przez process_cancel',
  'data.provision.stopped.restart':
    '{done} z {total} kont istnieje · serwer wtyczki zakończył pracę przed końcem zakładania',
  'data.provision.stopped.complete':
    'wszystkie konta istnieją, zbiór przypięty do slotu · plan pokaże data_check_readiness',
  'data.provision.stopped.next':
    'test nie jest gotowy · data_create_accounts dla slotu {slot} z count {count} dołoży tylko brakujące konta',
  'data.file.rows': {
    one: '{count} wiersz z {file}',
    few: '{count} wiersze z {file}',
    many: '{count} wierszy z {file}',
    other: '{count} wiersza z {file}',
  },
  'data.file.revision': 'nowa rewizja zbioru',
  'data.steps': {
    one: 'wywołanie, które go wypełni:',
    few: 'wywołania, które je wypełnią, w tej kolejności:',
    many: 'wywołania, które je wypełnią, w tej kolejności:',
    other: 'wywołania, które je wypełnią, w tej kolejności:',
  },
  'data.steps.suggested': {
    one: 'wywołanie, które stosuje propozycję:',
    few: 'wywołania, które stosują propozycję, w tej kolejności:',
    many: 'wywołania, które stosują propozycję, w tej kolejności:',
    other: 'wywołania, które stosują propozycję, w tej kolejności:',
  },
  'data.steps.next': '→ dalej: {call}',
  'data.suggest.none': 'hub danych nie proponuje żadnych akcji',
  'data.skipped': 'pominięto {count}:',
  'data.skip.separate_call': 'zakładanie kont wymaga osobnego narzędzia (data_create_accounts)',
  'data.skip.secret_columns':
    'zbiór „{name}” ma kolumny z hasłami · konta z pliku (data_create_dataset z file i slot) albo data_create_accounts',
  'data.skip.no_rules': 'zbiór „{name}”: propozycja nie podaje reguł kolumn',
  'data.skip.exists': 'zbiór „{name}” już istnieje w projekcie',
  'data.skip.dataset_gone': 'slot {slot}: zbioru nie ma w projekcie',
  'data.skip.slot_gone': 'slot {slot}: żaden scenariusz celu go nie czyta',
  'data.skip.not_applied': '{kind}: żadne narzędzie danych tego nie stosuje',
  'data.skip.over_limit':
    'kolejne akcje huba danych: {count}; wywołaniami staje się najwyżej 40, po ich wykonaniu wywołaj ponownie data_suggest_actions',
  'data.card.suggest': 'karta zgody · propozycja danych testowych dla {target}',
  'data.card.create': 'karta zgody · utworzenie zbioru „{name}”',
  'data.card.for': 'Dla: {target}',
  'data.card.cost': 'Koszt: do 3 wywołań LLM huba danych · nic nie jest zapisywane',
  'data.card.source.file': 'Źródło: plik {file} · bajtów: {size} · sha256 {sha}',
  'data.card.source.rules': 'Źródło: reguły kolumn {handle}',
  'data.card.source.slot': 'Źródło: kolumny slotu {slot}',
  'data.card.slot': 'Dla slotu: {slot} w {target}',
  'data.card.rows': 'Wierszy: {rows}',
  'data.card.revision': 'Zbiór istnieje: plik będzie jego nową rewizją.',
  'data.card.regenerate':
    'Zbiór istnieje: jego wiersze powstaną od nowa, z nowymi wartościami (nowy rachunek zużycia).',
  'data.card.cost.fresh':
    'Koszt: LoadCraft może użyć swojego modelu i dziennego budżetu projektu na zbiory danych; nic nie idzie do celu · nowe tożsamości do rejestracji, każda użyta raz: po biegu, który dotarł do celu, zrób je od nowa',
  'data.card.next':
    '→ zapytaj użytkownika; dopiero po jego zgodzie wywołaj {tool} ponownie z tymi samymi argumentami i confirm: "{confirm}"',
  'data.card.cost.slot':
    'Koszt: LoadCraft może użyć swojego modelu do wierszy i budżetu projektu na zbiory danych',
  'data.card.renewed.missing':
    'Nic nie zrobiono: dla tego confirm nie ma karty. To jest nowa karta.',
  'data.card.renewed.expired': 'Nic nie zrobiono: karta wygasła (30 minut). To jest nowa karta.',
  'data.card.renewed.token':
    'Nic nie zrobiono: token nie należy do bieżącej karty. To jest nowa karta.',
  'data.card.renewed.changed':
    'Nic nie zrobiono: wywołanie niosło inne argumenty niż karta albo plik się zmienił. To jest nowa karta dla nich.',
  'data.created.rules': 'zbiór „{name}” z reguł · wierszy: {rows}',
  'data.created.slot': 'slot {slot}: zbiór „{name}” z jego kolumn · wierszy: {rows}',
  'data.bindings.title': {
    one: 'powiązania {target} · {count} slot',
    few: 'powiązania {target} · {count} sloty',
    many: 'powiązania {target} · {count} slotów',
    other: 'powiązania {target} · {count} slotu',
  },
  'data.bindings.none': 'powiązania {target} · brak',
  'data.bindings.scenarios': ' · przypięte w scenariuszach: {count}',
  'data.bindings.cleared': 'usunięte: {slots}',
  'data.bindings.unchanged': 'cel ma już te powiązania · nic nie zostało wysłane',
  'error.probes_disabled.message':
    'Projekt nie pozwala LoadCraft wysyłać żądań do swojego celu, więc nie da się założyć kont.',
  'error.probes_disabled.hint':
    'Poproś użytkownika o włączenie sond celu w ustawieniach projektu ({url}); to narzędzie nie zmienia tej zgody.',
  'error.slot_unknown.message': 'Scenariusz nie ma slotu danych „{slot}”. Sloty: {available}.',
  'error.slot_unknown.hint':
    'Wywołaj data_check_readiness ze scenariuszem, aby zobaczyć sloty, i wybierz jeden.',
  'error.slot_new_identities.message':
    'Slot „{slot}” trzyma nowe tożsamości do rejestracji (każda użyta raz), więc nie zakłada się dla niego kont z góry.',
  'error.slot_new_identities.hint':
    'Wypełnij go przez data_create_dataset ze scenariuszem i slotem: LoadCraft zrobi nowe wiersze, a po każdym biegu, który dotarł do celu, robi się je od nowa. Nic nie zostało wysłane do celu.',
  'error.slot_mixed_identities.message':
    'Slot „{slot}” obsługuje logowanie w jednym scenariuszu i rejestrację w innym, więc żaden jeden zbiór do niego nie pasuje.',
  'error.slot_mixed_identities.hint':
    'Rozdziel slot: osobny dla rejestracji, żeby logowanie miało prawdziwe konta, a rejestracja nowe tożsamości. Nic nie zostało wysłane do celu.',
  'error.slot_not_accounts.message':
    'Slot „{slot}” nie jest slotem kont: trzyma zwykłe dane, więc nie da się dla niego założyć kont.',
  'error.slot_not_accounts.hint': '{next} Nic nie zostało wysłane do celu.',
  'error.slot_not_accounts.next.generate':
    'Wypełnij go przez data_create_dataset ze scenariuszem i slotem: zrobi wiersze z kolumn slotu.',
  'error.slot_not_accounts.next.file':
    'Nie da się go wygenerować: podaj plik CSV z kolumnami {columns} przez data_create_dataset z file i slot.',
  'error.slot_not_accounts.next.filled':
    'Nic nie trzeba: data_check_readiness pokazuje go jako wypełniony.',
  'error.accounts_file_columns_missing.message':
    'Plik {file} nie ma kolumny {missing}. Slot czyta: {columns}.',
  'error.accounts_file_columns_missing.hint':
    'Dopisz kolumny do nagłówka pliku (wielkość liter nie ma znaczenia) albo podaj inny plik. Nic nie zostało wysłane.',
  'error.accounts_file_empty.message': 'Plik {file} nie ma wierszy pod nagłówkiem.',
  'error.accounts_file_empty.hint':
    'Podaj plik z co najmniej jednym kontem. Nic nie zostało wysłane.',
  'error.accounts_file_row_short.message':
    'Wiersz {line} pliku {file} ma mniej komórek niż nagłówek.',
  'error.accounts_file_row_short.hint':
    'Popraw ten wiersz pliku i powtórz wywołanie. Nic nie zostało wysłane.',
  'error.register_operation_required.message':
    'Żaden flow scenariusza nie ma żądania zakładającego konto. Kandydaci ze specyfikacji API: {candidates}.',
  'error.register_operation_required.hint':
    'Zapytaj użytkownika, która operacja zakłada konto, i powtórz wywołanie z register_operation ustawionym na nią. Nic nie zostało wysłane.',
  'error.register_operation_not_in_spec.message':
    'Specyfikacja API projektu nie ma takiej operacji. Backend napisał: „{detail}”',
  'error.register_operation_not_in_spec.hint':
    'Podaj METODA:/ścieżka albo identyfikator operacji dokładnie tak, jak na liście kandydatów.',
  'error.register_operation_method_not_allowed.message':
    'Operacja nie jest POST, a konta powstają tylko przez POST. Backend napisał: „{detail}”',
  'error.register_operation_method_not_allowed.hint': 'Wybierz operację POST z listy kandydatów.',
  'error.register_operation_unfillable.message':
    'Operacja wymaga wartości, których wtyczka nie wymyśli. Backend napisał: „{detail}”',
  'error.register_operation_unfillable.hint':
    'Powiedz użytkownikowi, jakie pola wskazano; wczytaj konta z pliku (data_create_dataset z file i slot) albo nagraj rejestrację we flow, aby użyć jej prawdziwego żądania.',
  'error.register_operation_dataset_mismatch.message':
    'Zbiór ma kolumny logowania, których operacja nie wysyła. Backend napisał: „{detail}”',
  'error.register_operation_dataset_mismatch.hint':
    'Wybierz operację, która wysyła e-mail lub login i hasło, albo popraw kolumny slotu.',
  'error.provision_already_running.message':
    'Konta dla slotu {slot} są już zakładane z innymi ustawieniami ({operation}).',
  'error.provision_already_running.hint':
    'Wywołaj process_wait z operation "{operation}" aż do końca albo zatrzymaj zakładanie przez process_cancel; potem wywołaj data_create_accounts z nowymi ustawieniami.',
  'error.dataset_source.message':
    'data_create_dataset przyjmuje jedno źródło: file (ze scenariuszem i slotem), rules (uchwyt wypisany przez data_suggest_actions) albo sam scenariusz i slot (wiersze z kolumn slotu).',
  'error.dataset_source.hint': 'Powtórz wywołanie z jednym źródłem. Nic nie zostało wysłane.',
  'error.suggestion_unknown.message':
    'Zestaw reguł {handle} nie jest przechowywany: pochodzi ze starszej propozycji albo żadnej nie było.',
  'error.suggestion_unknown.hint':
    'Wywołaj ponownie data_suggest_actions i użyj uchwytu z jego ostatniego wyniku. Nic nie zostało wysłane.',
  'error.suggestion_rules_unusable.message':
    'Zestawu reguł {handle} nie da się zamienić w zbiór: {reason}.',
  'error.suggestion_rules_unusable.hint':
    'Takie dane wczytaj z pliku CSV (data_create_dataset z file i slot) albo załóż konta przez data_create_accounts. Nic nie zostało wysłane.',
  'error.suggestion_rules_unusable.reason.no_rules': 'nie podaje reguł kolumn',
  'error.suggestion_rules_unusable.reason.secret_columns':
    'ma kolumny z hasłami, których się nie generuje',
  'error.dataset_name_taken.message': 'Projekt ma już zbiór „{name}”.',
  'error.dataset_name_taken.hint':
    'Przypnij go przez data_set_bindings albo powtórz wywołanie z inną nazwą. Nic nie zostało wysłane.',
  'error.slot_data_unavailable.message':
    'Wierszy slotu {slot} nie da się zrobić z jego kolumn: {reason}.',
  'error.slot_data_unavailable.hint':
    'Podaj plik CSV z kolumnami {columns} przez data_create_dataset z file i slot (konta: data_create_accounts po zgodzie użytkownika). Nic nie zostało wysłane.',
  'error.slot_data_unavailable.reason.accounts': 'trzyma konta',
  'error.never_fabricated_columns.message':
    'LoadCraft nigdy nie zmyśla wartości {columns} slotu {slot}: muszą być prawdziwe (login, sekret, wartość wskazująca coś, co istnieje w systemie docelowym).',
  'error.never_fabricated_columns.hint':
    'Podaj plik CSV z prawdziwymi wartościami kolumn {all} przez data_create_dataset z file, scenario i slot; narzędzia danych nie zaproponują już generowania dla tego slotu.',
  'error.slot_data_refused.message': 'LoadCraft odmówił zrobienia wierszy slotu {slot}: {detail}',
  'error.slot_data_refused.hint':
    'Podaj plik CSV z kolumnami {columns} przez data_create_dataset z file i slot; narzędzia danych nie zaproponują już generowania dla tego slotu.',
  'error.dataset_unknown.message': 'Projekt nie ma zbioru „{dataset}”. Zbiory: {available}.',
  'error.dataset_unknown.hint':
    'Nazwij zbiór jego nazwą albo id, tak jak pokazuje go wynik narzędzia danych. Nic nie zostało wysłane.',
  'error.dataset_ambiguous.message': 'Więcej niż jeden zbiór projektu nazywa się „{dataset}”.',
  'error.dataset_ambiguous.hint': 'Podaj jego id. Nic nie zostało wysłane.',
  'error.data_refused.message': 'LoadCraft odmawia danych tej kompozycji: {reason}',
  'error.data_refused.hint':
    'Napraw to, co wskazuje, albo zaplanuj scenariusze kompozycji pojedynczo.',
  'error.environment_needs_caps.message':
    'Środowisko {environment} jest chronione i nie ma limitów obciążenia, więc LoadCraft odrzuci każdy test na nim.',
  'error.environment_needs_caps.hint':
    'Ustaw limity (maks. użytkowników, maks. nowych użytkowników na sekundę) środowiska {environment} na stronie projektu w LoadCraft, w kroku Environments, albo wybierz inne środowisko.',
  'error.environment_caps_unreadable.message':
    'Limitów obciążenia środowiska {environment} nie da się odczytać, więc test nie zostanie uruchomiony.',
  'error.environment_caps_unreadable.hint':
    'Sprawdź max_vu i max_rps środowiska {environment} w LoadCraft (liczby całkowite, co najmniej 1).',
  'error.spike_not_possible.message':
    'Spike nie zmieści się na środowisku {environment}: limit {limit} nie mieści żadnego spike’a (druga seria jest 2× większa od pierwszej).',
  'error.spike_not_possible.hint':
    'Wybierz inny profil (run_plan pokazuje, co się mieści) albo podnieś limit środowiska.',
  'error.stress_over_limit.message':
    'Schodki stress zawsze dochodzą do co najmniej {floor} nowych/s, a limit środowiska {environment} to {limit} nowych/s.',
  'error.stress_over_limit.hint':
    'Wybierz profil o stałym tempie w granicach limitu albo podnieś limit środowiska.',
  'error.data_not_ready.message':
    'Nie uruchomiono: dane nie wystarczą dla tego obciążenia. {rows}.',
  'error.data_not_ready.hint':
    'Przygotuj dane (data_check_readiness nazywa, czego brakuje na {environment}), potem wywołaj run_start ponownie.',
  'error.run_needs_rebuild.message':
    'Scenariusz tego testu trzeba wygenerować ponownie, zanim da się go uruchomić (nie ma budowy modułowej).',
  'error.run_needs_rebuild.hint':
    'Wygeneruj scenariusz ponownie narzędziem scenario_generate, potem wywołaj run_start.',
  'error.setup_incomplete.message': 'Konfiguracja projektu jest niepełna. Brakuje: {missing}.',
  'error.setup_incomplete.hint':
    'Uruchom project_analyze_setup, potem project_apply_setup; dokończą konfigurację.',
  'error.setup_incomplete.unknown': 'kilku kroków konfiguracji',
  'error.setup_incomplete.part.environments': 'środowisk',
  'error.setup_incomplete.part.evidence': 'materiału źródłowego (OpenAPI, HAR lub innego)',
  'error.setup_incomplete.part.analysis': 'analizy',
  'error.setup_incomplete.part.profile': 'profilu aplikacji',
  'error.setup_incomplete.part.validators': 'walidatorów',
  'error.setup_incomplete.part.test_types': 'typów testów',
  'error.agent_browsers_busy.message': 'Obie przeglądarki agenta są zajęte innymi przebiegami.',
  'error.agent_browsers_busy.hint': 'Spróbuj za kilka minut albo użyj nagrania HAR.',
  'error.protected_environment_requires_caps.message':
    'To środowisko jest chronione i przed uruchomieniem wymaga limitów obciążenia.',
  'error.protected_environment_requires_caps.hint':
    'Podaj obciążenie mieszczące się w limitach środowiska albo wybierz inne środowisko.',
  'error.protected_environment_requires_confirmation.message':
    'Serwer zażądał zgody na założenie kont na chronionym środowisku {environment}, choć wtyczka ją wysłała. To nieoczekiwane; nic nie zostało założone.',
  'error.protected_environment_requires_confirmation.hint':
    'Nie ponawiaj wywołania. Opisz użytkownikowi, co się stało, i sprawdź, czy środowisko i wersja wtyczki są właściwe.',
  'error.protected_environment_requires_acknowledgement.message':
    'To środowisko jest chronione: uruchomienie wymaga wyraźnej zgody użytkownika.',
  'error.protected_environment_requires_acknowledgement.hint':
    'Zapytaj użytkownika, czy uruchomić test na tym środowisku; dopiero po zgodzie powtórz wywołanie z confirm_capped: true.',
  'error.workload_exceeds_environment_caps.message':
    'Limity środowiska nie pozwalają na to obciążenie. Backend napisał: „{detail}”',
  'error.workload_exceeds_environment_caps.hint':
    'Limity środowiska nie pozwalają na ten profil ani tę kompozycję. Zmień profil (run_plan) albo środowisko; nie ponawiaj tego samego wywołania.',
  'error.spike_exceeds_environment_caps.message':
    'Limity środowiska nie pozwalają na spike. Backend napisał: „{detail}”',
  'error.spike_exceeds_environment_caps.hint':
    'Limity środowiska nie pozwalają na ten profil. Zmień profil (run_plan) albo środowisko; nie ponawiaj tego samego wywołania.',
  'error.no_default_environment.message':
    'Projekt nie ma środowiska domyślnego i żadne nie zostało wybrane.',
  'error.no_default_environment.hint':
    'Podaj środowisko wprost albo poproś użytkownika o oznaczenie domyślnego w LoadCraft.',
  'error.llm_generation_failed.message':
    'LoadCraft nie zdołał wygenerować wyniku modelem językowym.',
  'error.llm_generation_failed.hint':
    'Pokaż użytkownikowi przyczynę; ponowienie tego samego wywołania nie pomoże.',
  'error.llm_generation_failed.hintRetryable':
    'To błąd przejściowy: powtórz to samo wywołanie jeszcze raz.',
  'error.llm_not_configured.message':
    'W LoadCraft nie skonfigurowano modelu językowego, więc ten krok niczego nie wygeneruje.',
  'error.llm_not_configured.hint':
    'Poproś użytkownika o skonfigurowanie dostawcy modelu w ustawieniach LoadCraft i ponów.',
  'error.prompt_over_budget.message': 'Dane wejściowe są za duże jak na budżet modelu językowego.',
  'error.prompt_over_budget.hint':
    'Zawęź zakres (mniej endpointów, mniejszy plik albo krótszy opis) i ponów.',
  'error.timeout.message': 'LoadCraft nie odpowiedział w czasie.',
  'error.timeout.hint': 'Ponów raz; jeśli się powtórzy, uruchom /loadcraft:doctor.',
  'error.network_error.message': 'Nie można połączyć się z LoadCraft przez sieć.',
  'error.network_error.hint':
    'Spróbuj ponownie za chwilę; jeśli się powtarza, uruchom /loadcraft:doctor.',
  'error.unexpected_redirect.message':
    'LoadCraft odpowiedział na {request} przekierowaniem (HTTP {status}) na {host}. Wtyczka nie idzie za przekierowaniami, więc żądania tam nie powtórzono.',
  'error.unexpected_redirect.hint':
    'Sprawdź adres LoadCraft w opcjach wtyczki: http zamiast https albo brakujący lub nadmiarowy końcowy ukośnik, potem uruchom /loadcraft:doctor.',
  'error.response_too_large.message': 'LoadCraft odesłał odpowiedź większą niż limit {limit}.',
  'error.response_too_large.hint':
    'Zawęź zapytanie (filtr, mniejsza strona albo pojedynczy element) i ponów.',
  'error.bad_gateway.message':
    'Coś między wtyczką a LoadCraft (proxy albo sam serwer) odpowiedziało stroną błędu zamiast API.',
  'error.bad_gateway.hint':
    'Poczekaj chwilę i ponów; jeśli się utrzymuje, uruchom /loadcraft:doctor.',
  'error.backend_too_old.message':
    'Ten serwer LoadCraft jest starszy, niż wtyczka obsługuje ({reason}).',
  'error.backend_too_old.reason.revision': 'wersja API {have}, wtyczka wymaga {need}',
  'error.backend_too_old.reason.capability': 'serwer nie ma funkcji „{capability}”',
  'error.backend_too_old.reason.noMeta': 'serwer nie podaje swojej wersji',
  'error.backend_too_old.hint':
    'Poproś użytkownika o aktualizację serwera LoadCraft albo zainstaluj starszą wersję wtyczki.{advice}',
  'error.invalid_arguments.message': 'Argumenty się wykluczają: {reason}.',
  'error.invalid_arguments.hint': 'Zmień argumenty i wywołaj ponownie; nic nie zostało wysłane.',
  'error.invalid_arguments.rule.generate_one_target': 'podaj flow_id albo scenario_id, nie oba',
  'error.invalid_arguments.rule.generate_slot_needs_scenario':
    'slot to slot scenariusza: podaj z nim scenario_id, nie flow_id',
  'error.invalid_arguments.rule.generate_slot_name':
    'zbiór slotu nazywa LoadCraft od slotu: pomiń name',
  'error.invalid_arguments.rule.update_without_fields': 'podaj nową nazwę, nowy opis albo oba',
  'error.invalid_arguments.rule.apimap_one_of':
    'podaj prefixes (ścieżki oddzielone przecinkami) albo detected: true, nie oba i nie żadne',
  'error.invalid_arguments.rule.apimap_prefix_limits':
    'najwyżej 64 prefiksy, każdy najwyżej 512 znaków i żaden pusty',
  'error.invalid_arguments.rule.note_nothing_to_change': 'podaj nowy tekst, nowy zakres albo oba',
  'error.invalid_arguments.rule.note_at_without_scope':
    'at wskazuje stronę albo krok zakresu, podaj z nim scope',
  'error.invalid_arguments.rule.choices_empty':
    'podaj co najmniej jedno pole choices, na przykład flows.method',
  'error.invalid_arguments.rule.choices_secret':
    '{path} wygląda na sekret; wybory są zapisywane w stanie obszaru roboczego, wskaż plik zamiast tego',
  'error.invalid_arguments.rule.flows_merge_count':
    'flow_ids musi zawierać od 2 do 20 flowów rozdzielonych przecinkami',
  'error.invalid_arguments.rule.flows_duplicate_count':
    'flow_ids musi zawierać od 1 do 20 flowów rozdzielonych przecinkami',
  'error.invalid_arguments.rule.flows_duplicate_docs_one':
    'docs_id kopiuje jeden flow: podaj dokładnie jeden flow w flow_ids',
  'error.invalid_arguments.rule.flows_duplicate_name_needs_docs':
    'name dotyczy kopii na wersję dokumentacji: podaj z nim docs_id',
  'error.invalid_arguments.rule.walk_note_remember_new':
    'remember dotyczy nowej notatki: nie podawaj go z note_id',
  'error.invalid_arguments.rule.composition_save_at_least_one':
    'podaj nazwę, członków albo profil do zmiany',
  'error.invalid_arguments.rule.composition_save_create_needs_members':
    'nowa kompozycja potrzebuje członków: scenariusz -> udział w procentach',
  'error.invalid_arguments.rule.composition_save_duplicate_member':
    'members wymienia ten sam scenariusz dwa razy (po id i po nazwie albo dwa razy po nazwie)',
  'error.invalid_arguments.rule.composition_save_variants':
    'kompozycja ma kilku członków tego samego scenariusza (warianty): members nie rozstrzyga którego; zmień ich w aplikacji',
  'error.invalid_arguments.rule.copilot_ask_one_of':
    'podaj dokładnie jedno z: message i review: true',
  'error.invalid_arguments.rule.composition_spec_type':
    'rodzaj testu podaje się w type: usuń type ze spec',
  'error.invalid_arguments.rule.functional_template_new_needs':
    'nowy szablon wymaga name oraz w fields api_description i flow_definition',
  'error.invalid_arguments.rule.functional_template_nothing':
    'podaj name albo co najmniej jedno pole do zmiany',
  'error.invalid_arguments.rule.functional_template_docs_new_only':
    'docs_id dotyczy nowego szablonu: nie podawaj go z template_id',
  'error.invalid_arguments.rule.functional_flow_new_needs': 'nowy flow wymaga name',
  'error.invalid_arguments.rule.functional_flow_new_only':
    'is_active dotyczy zmiany: pomiń go w nowym flowie',
  'error.invalid_arguments.rule.functional_flow_change_only':
    'docs_id dotyczy nowego flowa: nie podawaj go z flow_id',
  'error.invalid_arguments.rule.functional_flow_snapshot_alone':
    'snapshot wersji przyjmuje tylko flow_id, version i reason',
  'error.invalid_arguments.rule.functional_flow_reason_needs_version':
    'reason należy do snapshotu wersji: podaj z nim version',
  'error.invalid_arguments.rule.functional_flow_nothing':
    'podaj name albo co najmniej jedno pole do zmiany',
  'error.invalid_arguments.rule.effective_without_env':
    'effective wymaga env (id środowiska albo „default”)',
  'error.invalid_arguments.rule.versions_with_docs_id':
    'versions wypisuje zapisane wersje, nie podawaj z nim docs_id',
  'error.invalid_arguments.rule.include_without_endpoint':
    'include dotyczy jednego endpointu, podaj z nim endpoint',
  'error.invalid_arguments.rule.save_profile_create_needs_name_and_type':
    'nowy profil wymaga nazwy i typu',
  'error.invalid_arguments.rule.save_profile_without_fields':
    'podaj co najmniej jedno pole do zmiany',
  'error.invalid_arguments.rule.versions_without_flow':
    'versions wypisuje historię jednego flowu, podaj z nim flow',
  'error.invalid_arguments.rule.templates_too_many_tags': 'listę może zawężać co najwyżej 10 tagów',
  'error.invalid_arguments.rule.runs_one_without_run':
    'widok one czyta jeden przebieg, podaj z nim run_id',
  'error.invalid_arguments.rule.runs_by_template_without_template':
    'by_template wypisuje przebiegi jednego szablonu, podaj z nim template',
  'error.invalid_arguments.rule.results_one_without_result':
    'widok one czyta jeden wynik flowu, podaj z nim result_id',
  'error.invalid_arguments.rule.compare_same_functional_run':
    'przebieg porównany sam ze sobą nic nie pokaże, podaj dwa różne przebiegi',
  'error.invalid_arguments.rule.analytics_without_validator':
    'accuracy, trend i threshold_suggestion dotyczą jednego walidatora, podaj z nimi validator',
  'error.invalid_arguments.rule.catalog_assertion_types_active':
    'is_active nie zawęża typów asercji, pomiń go',
  'error.invalid_arguments.rule.list_active_with_query':
    'is_active zawęża listę projektów, nie wyszukiwanie: pomiń jedno z nich',
  'error.invalid_arguments.rule.filter_with_endpoint':
    'method i query filtrują listę, nie podawaj ich z endpoint',
  'log.foreignWriter':
    'Inna wersja wtyczki LoadCraft zapisuje ten sam plik stanu (wcześniej otwarta sesja wciąż działa): zamknij starą sesję albo zrób reconnect wtyczki; wpisy tej sesji, które usunęła, zostały przywrócone.',
  'log.entryNotSaved':
    'Wywołanie się udało, ale jego wpis w dzienniku obszaru roboczego nie został zapisany ({code}).',
  'log.entryNotSaved.refused':
    'Wywołanie się udało, ale jego wpis w dzienniku obszaru roboczego nie został zapisany ({code}; schemat stanu odrzucił: {fields}).',
  'error.invalid_arguments.rule.get_templates_only_with': 'include działa tylko razem z template',
  'error.invalid_arguments.rule.catalog_field_not_of_kind':
    'pole w fields nie należy do tego rodzaju (typ testu: category, display_name, description, expected_outcome, input_generation_prompt, input_schema, example_inputs, is_active; walidator: category, display_name, description, validator_type, activation, group, scope, requires_profile_flags, ai_prompt_template, parameters, is_active; typ asercji: category, display_name, description, prompt_template, parameters, is_active)',
  'error.invalid_arguments.rule.catalog_new_needs':
    'nowy wpis wymaga name i wymaganych pól swojego rodzaju (typ testu: category, display_name, input_generation_prompt; walidator: activation, category, display_name, group, scope, validator_type; typ asercji: category, display_name)',
  'error.invalid_arguments.rule.catalog_name_new_only':
    'name dotyczy nowego wpisu; nazwy istniejącego nie można zmienić',
  'error.invalid_arguments.rule.catalog_nothing': 'podaj w fields co najmniej jedno pole do zmiany',
  'error.invalid_arguments.rule.test_types_one_mode':
    'podaj source z items (dodanie) albo test_type_id z fields (zmiana jednego), nie oba i nie żadne',
  'error.invalid_arguments.rule.test_types_field_unknown':
    'pole tu nie pasuje (dodanie: category, display_name, description, input_prompt, example_inputs, expected_outcome, default_count, priority, poll_completion_values, poll_timeout_ms; propozycje: to samo bez dwóch pól poll; zmiana przyjmuje też name i is_enabled)',
  'error.invalid_arguments.rule.test_types_items_count': 'items przyjmuje od 1 do 50 wpisów',
  'error.invalid_arguments.rule.test_types_catalog_ids':
    'przy source catalog każdy klucz items to id typu testu z katalogu, a jego wartość to {}',
  'error.invalid_arguments.rule.test_types_suggestion_needs':
    'przyjęta propozycja wymaga category, display_name, description i input_prompt',
  'error.invalid_arguments.rule.test_types_nothing':
    'podaj w fields co najmniej jedno pole do zmiany',
  'error.invalid_arguments.rule.validators_one_mode':
    'podaj source z items (dodanie) albo validator_id z fields (zmiana jednego), nie oba i nie żadne',
  'error.invalid_arguments.rule.validators_field_unknown':
    'pole tu nie pasuje (dodanie: display_name, description, ai_prompt, parameters, validator_type, default_params, scope, template, priority; propozycje: display_name, description, template, default_params, rationale, scope, priority; zmiana: name, display_name, description, ai_prompt, parameters, validator_type, default_params, priority, is_enabled, needs_review)',
  'error.invalid_arguments.rule.validators_items_count': 'items przyjmuje od 1 do 50 wpisów',
  'error.invalid_arguments.rule.validators_catalog_ids':
    'przy source catalog każdy klucz items to id walidatora z katalogu, a jego wartość to {}',
  'error.invalid_arguments.rule.validators_proposal_needs':
    'przyjęta propozycja wymaga display_name, description i template',
  'error.invalid_arguments.rule.validators_nothing':
    'podaj w fields co najmniej jedno pole do zmiany',
  'error.invalid_arguments.rule.suggest_docs_not_active':
    'docs_id nie jest aktywną dokumentacją projektu; propozycje czytają aktywną dokumentację (project_get_docs je wylicza)',
  'error.invalid_arguments.rule.payloads_items_count':
    'flow_ids i test_types przyjmują od 1 do 50 wpisów',
  'error.invalid_arguments.rule.payloads_ids': 'każdy klucz flow_ids i test_types jest id (UUID)',
  'error.invalid_arguments.rule.data_copilot_one_of':
    'podaj scenario_id albo composition_id, nie oba',
  'error.invalid_arguments.rule.poll_terminals_success_needed':
    'podaj co najmniej jeden status powodzenia w success_terminals',
  'error.invalid_arguments.rule.poll_terminals_too_many':
    'podaj najwyżej 20 statusów w success_terminals i w failure_terminals',
  'error.invalid_arguments.rule.copilot_apply_nothing':
    'podaj co najmniej jedno id zmiany w accept albo w reject',
  'error.invalid_arguments.rule.copilot_apply_too_many':
    'podaj najwyżej 50 id zmian w accept i w reject',
  'error.invalid_arguments.rule.copilot_apply_overlap':
    'to samo id zmiany nie może być naraz w accept i w reject',
  'error.invalid_arguments.rule.delete_at_least_one': 'podaj scenario_id albo composition_id',
  'error.invalid_arguments.rule.delete_one_of': 'podaj scenario_id albo composition_id, nie oba',
  'error.invalid_arguments.rule.regenerate_expand_needs_rows':
    'mode=expand wymaga rows, liczby wierszy, do której rozszerzyć',
  'error.invalid_arguments.rule.regenerate_expand_above_current':
    'dla mode=expand rows musi być większe niż obecna liczba wierszy zbioru',
  'error.invalid_arguments.rule.update_dataset_at_least_one':
    'podaj co najmniej jeden z: name, description, file',
  'error.invalid_arguments.rule.http_settings_at_least_one':
    'podaj co najmniej jedno z: base_url, protocol, headers_env_file',
  'error.invalid_arguments.rule.http_settings_base_url':
    'base_url to adres http albo https bez nazwy użytkownika i hasła',
  'error.invalid_arguments.rule.http_settings_headers_empty':
    'headers_env_file nie ma żadnej linii KEY=VALUE z wartością',
  'error.invalid_arguments.rule.http_settings_headers_count':
    'headers_env_file ma więcej niż 20 nagłówków',
  'error.invalid_arguments.rule.http_settings_header_name':
    'nazwa nagłówka w headers_env_file to litery, cyfry i myślniki, i nie host, content-length, transfer-encoding, connection ani authorization',
  'error.invalid_arguments.rule.http_settings_header_value':
    'wartość nagłówka w headers_env_file nie ma znaków sterujących i ma najwyżej 8192 znaki',
  'error.invalid_arguments.rule.run_save_name_required': 'nowy zapisany przebieg wymaga nazwy',
  'error.invalid_arguments.rule.run_save_target_one_of':
    'nowy zapisany przebieg wymaga dokładnie jednego z: scenario_id, composition_id',
  'error.invalid_arguments.rule.run_save_target_fixed':
    'scenario_id, composition_id i source_execution_id są dla nowego zapisanego przebiegu; zapisany przebieg zachowuje swój cel',
  'error.invalid_arguments.rule.run_save_at_least_one':
    'podaj co najmniej jedno z: name, environment_id, target_base_url, workload, feeder_bindings',
  'error.invalid_arguments.rule.run_save_production_only':
    'obciążenie typu production wymaga planu production oraz ramp i hold równych 0; inny typ go nie przyjmuje',
  'error.invalid.message': 'LoadCraft odrzucił dane jako niepoprawne. Backend napisał: „{detail}”',
  'error.invalid.hint':
    'Popraw dane wskazane w komunikacie i powtórz wywołanie; jeśli brakuje danych (np. za mało wierszy), najpierw je przygotuj.',
  'error.conflict.message':
    'Żądanie koliduje z bieżącym stanem w LoadCraft. Backend napisał: „{detail}”',
  'error.conflict.hint':
    'Sprawdź bieżący stan (process_get_status) i powtórz krok tylko wtedy, gdy nadal ma sens.',
  'error.rate_limited.message':
    'LoadCraft ogranicza liczbę żądań albo wyczerpano budżet AI. Backend napisał: „{detail}”',
  'error.rate_limited.hint':
    'Odczekaj chwilę przed ponowieniem; jeśli wyczerpano dzienny budżet AI, powiedz o tym użytkownikowi zamiast ponawiać.',
  'error.server_error.message': 'LoadCraft zawiódł przy obsłudze żądania (HTTP {status}).',
  'error.server_error.hint':
    'Ponów raz; jeśli znowu się nie uda, pokaż użytkownikowi komunikat i uruchom /loadcraft:doctor.',
  'error.unavailable.message': 'LoadCraft jest chwilowo niedostępny (HTTP {status}).',
  'error.unavailable.hint':
    'Poczekaj chwilę i ponów; jeśli się utrzymuje, uruchom /loadcraft:doctor.',
  'error.gateway_timeout.message':
    'Serwer między wtyczką a LoadCraft nie doczekał się odpowiedzi (HTTP {status}).',
  'error.gateway_timeout.hint':
    'Krok może nadal trwać w LoadCraft: sprawdź process_get_status, zanim go powtórzysz.',
  'error.unknown.message':
    'LoadCraft odrzucił żądanie (HTTP {status}, {code}). Backend napisał: „{detail}”',
  'error.unknown.withheld':
    'LoadCraft odrzucił żądanie (HTTP {status}, {code}). Treść z backendu nie jest pokazywana dla tego statusu.',
  'error.detail.withheld': 'niepokazywana dla tego statusu',
  'error.jobText.withheld': 'treść z LoadCraft nie jest pokazywana',
  'error.unknown.hint':
    'Pokaż użytkownikowi ten komunikat; zmień dane wejściowe, jeśli wskazuje na problem z nimi, w przeciwnym razie nie powtarzaj wywołania.',
  'error.internal_error.message': 'Krok nie powiódł się z powodu, którego wtyczka nie opisuje.',
  'error.internal_error.hint': 'Ponów raz; jeśli się powtórzy, uruchom /loadcraft:doctor.',
  'error.plugin_not_configured.message': 'Wtyczka LoadCraft jest źle skonfigurowana:',
  'error.plugin_not_configured.hint':
    'Popraw opcje wtyczki, potem uruchom /loadcraft:doctor, aby sprawdzić ustawienia.',

  'error.internal_secret_in_state.message':
    'Zarejestrowana wartość sekretu nie może trafić do pliku stanu.',
  'error.state_unreadable.message': 'Plik stanu jest nieczytelny.',
  'error.state_unreadable.hint': 'Usuń loadcraft/.cache/state.json ręcznie.',
  'error.env_missing.message':
    'Nie wybrano środowiska: wywołanie go nie podaje, a proces ani projekt nie mają ustawionego.',
  'error.env_missing.hint': 'Podaj środowisko (env) albo ustaw je dla projektu i wywołaj ponownie.',
  'error.new_project_pending.message':
    'W tym katalogu na decyzję czeka już karta utworzenia projektu.',
  'error.new_project_pending.hint':
    'Odpowiedz na tę kartę (tak albo nie), zanim utworzysz kolejny projekt.',
  'error.state_schema_unsupported.message':
    'Plik stanu ma schemat {schema}, którego ta wersja wtyczki nie zna.',
  'error.state_schema_unsupported.hint': 'Zaktualizuj wtyczkę LoadCraft.',
  'error.secret_not_storable.message': 'Wartość sekretu nie może trafić do pliku stanu.',
  'error.state_update_invalid.message': 'Zmiana stanu nie pasuje do schematu stanu: {fields}.',
  'error.pending_full.message': 'Na decyzję czeka ponad {limit} kart; nowa karta się nie mieści.',
  'error.pending_full.hint':
    'Najpierw odpowiedz na otwarte karty albo je anuluj, potem wywołaj ponownie.',
  'error.rebind_cards_dropped.message':
    '{count} kart sprzed utworzenia projektu odrzucono: projekt ma za dużo kart.',
  'error.rebind_cards_dropped.hint':
    'Zaproponuj ponownie to, czego brakuje, po odpowiedzi na otwarte karty albo ich anulowaniu.',
  'error.state_conflict.message': 'Plik stanu zmieniał się w trakcie zapisu; niczego nie zapisano.',
  'error.state_conflict.hint':
    'Wywołaj ponownie. Jeśli się powtarza, sprawdź, czy żaden inny program nie edytuje loadcraft/.cache/state.json.',
  'error.state_locked.message': 'Inny proces LoadCraft trzyma blokadę pliku stanu.',
  'error.state_locked.hint':
    'Wywołaj ponownie za chwilę. Jeśli się powtarza, a w tym repozytorium nie działa inna sesja, usuń loadcraft/.cache/state.json.lock.',
  'error.binding_invalid.message':
    'Plik loadcraft/project.json nie jest poprawny albo nie ma oczekiwanej struktury.',
  'error.binding_invalid.hint': 'Popraw albo usuń plik, potem uruchom project_create ponownie.',
  'error.binding_schema_unsupported.message':
    'Plik loadcraft/project.json ma schemat {schema}, którego ta wersja wtyczki nie zna.',
  'error.binding_schema_unsupported.hint': 'Zaktualizuj wtyczkę LoadCraft.',
  'error.binding_other_instance.message':
    'To repozytorium jest powiązane z projektem na innej instancji LoadCraft.',
  'error.binding_other_instance.hint':
    'Skieruj wtyczkę na tę instancję albo usuń loadcraft/project.json, żeby powiązać od nowa.',
  'error.path_outside_workspace.message': 'Ścieżka wychodzi poza katalog projektu.',
  'error.path_outside_workspace.hint': 'Użyj pliku z katalogu projektu.',
  'error.workspace_not_found.message': 'Katalog projektu nie istnieje.',
  'error.file_not_found.message': 'Nie znaleziono pliku albo nie można go odczytać: {file}',
  'error.file_not_found.hint': 'Sprawdź ścieżkę względem katalogu projektu.',
  'error.env_file_not_allowed.message':
    '{file} nie jest plikiem env; konta czytam tylko z plików .env, .env.* lub *.env.',
  'error.env_file_not_allowed.hint': 'Wskaż plik env z kluczami kont testowych.',
  'error.file_changed.message': 'Plik {file} zmienił się po sprawdzeniu.',
  'error.file_changed.hint': 'Ponów, gdy plik będzie już na swoim miejscu.',
  'error.file_too_large.message': 'Plik {file} przekracza limit {limit}.',
  'error.file_too_large.hint': 'Użyj mniejszego pliku.',
  'error.file_changed_while_sending.message': 'Plik {file} zmienił się w trakcie wysyłania.',
  'error.file_changed_while_sending.hint': 'Ponów, gdy plik będzie już na swoim miejscu.',
  'error.not_a_file.message': '{file} nie jest zwykłym plikiem.',
  'error.not_a_file.hint': 'Wskaż plik, a nie katalog ani plik specjalny.',
  'error.file_encoding_invalid.message': '{file} nie jest poprawnym UTF-8.',
  'error.env_key_invalid.message':
    'Nazwa klucza env jest niepoprawna; użyj liter, cyfr i podkreśleń.',
  'error.env_key_missing.message': 'W pliku {file} brakuje {names} albo wartość jest pusta.',
  'error.env_key_missing.hint':
    'Dopisz {names} do {file} albo podaj nazwy kluczy, w których jest konto.',
  'error.unsupported_file_type.message':
    'Plik {file} nie może być użyty jako {kind}: przyjmuję tylko pliki {extension}.',
  'error.file_not_allowed.message': 'Plik nie został otwarty przez listę dozwolonych.',
  'error.invalid_operation.message': '„{value}” nie jest poprawnym uchwytem operacji.',
  'error.invalid_operation.hint':
    'Podaj uchwyt operacji dokładnie tak, jak zwróciło go narzędzie (<rodzaj>:<id>, np. „test_run:0b5c77aa-…”), albo uruchom process_get_status, żeby zobaczyć trwające operacje.',
  'error.operation_lost.message':
    'LoadCraft nie zna już operacji „{value}”, a jej wyniku nie znaleziono.',
  'error.operation_lost.hint':
    'LoadCraft został zrestartowany; sprawdź process_get_status i uruchom krok ponownie.',
  'error.operation_unknown.message':
    'Ten katalog nie ma zapisu operacji „{value}”: zaczęto ją w innym katalogu albo pamięć podręczna została wyczyszczona.',
  'error.operation_unknown.hint':
    'Uruchom process_get_status, żeby zobaczyć trwające operacje, albo uruchom krok ponownie.',
  'error.operation_kind_unsupported.message':
    'Na operacje rodzaju „{kind}” ta wersja pluginu nie umie czekać.',
  'error.operation_kind_unsupported.hint':
    'Uruchom process_get_status, żeby zobaczyć stan projektu; jeśli operację zaczęła nowsza wersja pluginu, zaktualizuj plugin.',
  'error.not_cancellable.message': 'Operacji rodzaju „{kind}” nie da się zatrzymać.',
  'error.not_cancellable.hint':
    'Zatrzymać można tylko: {kinds}. Użyj process_wait z uchwytem, żeby zobaczyć, jak ta operacja się kończy.',
  'cancel.stopped': 'Zatrzymano {operation} w LoadCraft; nie dobiegnie do końca.',
  'cancel.stopping':
    'LoadCraft zatrzymuje {operation}: bieżąca ścieżka się kończy, a zbudowane dotąd ścieżki zostaną zapisane.',
  'cancel.stopping.next': 'Wywołaj process_wait z {operation}, żeby zobaczyć zapisane flowy.',
  'cancel.notRunning':
    '{operation} nie trwa (już się zakończyła albo LoadCraft jej nie ma), więc nie było czego zatrzymywać.',
  'cancel.notRunning.next': 'Wywołaj process_wait z {operation}, żeby zobaczyć, jak się skończyła.',
  'cancel.ended':
    'Wykonanie {operation} zakończyło się już ({status}), więc nie było czego zatrzymywać.',
  'cancel.ended.next': 'Wywołaj results_get_report z {handle}, żeby zobaczyć, jak się skończyło.',
  'cancel.planEnded':
    'Przebieg {operation} zakończył się już ({status}), więc nie było czego zatrzymywać.',
  'cancel.planEnded.next':
    'Nic już po nim nie działa w LoadCraft. Wywołaj process_wait z {operation}, żeby zobaczyć, jak się skończył, albo flows_describe_journeys, żeby zaplanować od nowa.',
  'cancel.noneRunning': 'Żaden test w projekcie {project} nie trwa, więc nie ma czego zatrzymywać.',
  'cancel.running.item': '{handle} ({status})',
  'cancel.running.local': '{handle}',
  'cancel.running.none': 'brak',
  'cancel.running.unavailable': 'nie udało się odczytać listy',
  'cancel.status.interrupted': 'przerwany',
  'cancel.status.needs_input': 'czeka na odpowiedź',
  'cancel.status.pending': 'czeka na start',
  'cancel.status.building': 'budowanie',
  'cancel.status.running': 'trwa',
  'cancel.status.completed': 'zakończone',
  'cancel.status.failed': 'nieudane',
  'cancel.status.cancelled': 'zatrzymane',
  'error.cancel_target_unknown.message':
    'Nie ma wykonania testu ani trwającej operacji „{value}” w tym projekcie LoadCraft.',
  'error.cancel_target_unknown.hint':
    'Trwające operacje, które można zatrzymać: {running}. Podaj jedną z nich tak, jak jest zapisana,.',
  'error.cancel_which.message':
    'Brak jednego testu uruchomionego z tego repozytorium do zatrzymania. Testy trwające w tym projekcie: {running}.',
  'error.cancel_which.hint':
    'Zapytaj użytkownika, który test zatrzymać, i wywołaj process_cancel z jego uchwytem e-…; żadnego nie zatrzymuj sam, może należeć do kogoś innego.',

  // scenario_suggest_split and scenario_generate
  'buildScenario.created': {
    one: '{count} scenariusz + kompozycja „{name}”',
    few: '{count} scenariusze + kompozycja „{name}”',
    many: '{count} scenariuszy + kompozycja „{name}”',
    other: '{count} scenariusza + kompozycja „{name}”',
  },
  'buildScenario.updated': {
    one: '{count} scenariusz + kompozycja „{name}” (zaktualizowana)',
    few: '{count} scenariusze + kompozycja „{name}” (zaktualizowana)',
    many: '{count} scenariuszy + kompozycja „{name}” (zaktualizowana)',
    other: '{count} scenariusza + kompozycja „{name}” (zaktualizowana)',
  },
  'buildScenario.weightsOnly': 'kompozycja „{name}” · nowe proporcje, bez generowania',
  'buildScenario.compiled': 'kod skompilowany ✓',
  'buildScenario.notCompiled': 'kod nieskompilowany ✕',
  'buildScenario.dataMix': 'dane: {shares}',
  'buildScenario.data.typical': 'typowe',
  'buildScenario.data.invalid': 'błędne',
  'buildScenario.data.edge': 'brzegowe',
  'buildScenario.none': 'brak',
  'buildScenario.failure.retried': '{reason} (także po jednym ponowieniu)',
  'buildScenario.failure.repeated':
    '{reason} (ta sama przyczyna co we wcześniejszym flow; bez ponowienia)',
  'buildScenario.failure.error': 'LoadCraft zgłosił błąd; jego treść nie jest pokazywana',
  'buildScenario.failure.cancelled': 'generowanie anulowane',
  'buildScenario.failure.notProduced': 'przyczyna nieznana (kanał był niedostępny) — ponów',
  'buildScenario.progress.start': 'scenariusz {index}/{total} · {flow}: start generowania',
  'buildScenario.progress.step': 'scenariusz {index}/{total} · {flow}: {step} ({percent}%)',
  'buildScenario.generationDone':
    'Scenariusz dla „{flow}” jest gotowy. Wywołaj scenario_generate ponownie z tymi samymi argumentami, żeby dokończyć kompozycję.',
  'buildScenario.generationFailed': 'Scenariusz dla „{flow}” nie powstał: {reason}',
  'error.proportions_sum.message': 'Proporcje sumują się do {sum}%, a muszą do 100 (± 0,5).',
  'error.proportions_sum.hint':
    'Popraw `proportions` tak, żeby sumowały się do 100, i wywołaj ponownie.',
  'error.proportions_not_positive.message':
    'Każdy flow potrzebuje udziału większego od zera; nie mają go: {flows}.',
  'error.proportions_not_positive.hint':
    'Daj każdemu flow dodatni procent albo usuń flow z `flows`.',
  'error.proportions_missing.message': 'Proporcje pomijają flowy: {flows}.',
  'error.proportions_missing.hint': 'Podaj procent dla każdego flow kompozycji: {expected}.',
  'error.proportions_unknown.message':
    'Proporcje wymieniają flowy, których nie ma w tej kompozycji: {keys}.',
  'error.proportions_unknown.hint':
    'Użyj nazw łączonych flowów ({expected}) albo podaj je w `flows`.',
  'error.data_mix_invalid.message':
    'Wagi `data_mix` muszą być nieujemne i sumować się do więcej niż zero.',
  'error.data_mix_invalid.hint': 'Podaj "normal", "realistic" albo wagi po nazwach typów testów.',
  'error.data_mix_unknown_type.message':
    'Mieszanka danych wymienia typy testów, których projekt nie ma włączonych: {types}. Włączone: {available}.',
  'error.data_mix_unknown_type.hint':
    'Użyj nazw włączonych typów (i happy_path dla danych typowych) albo najpierw włącz typ w LoadCraft.',
  'error.data_mix_realistic_unavailable.message':
    'Mieszanka realistic potrzebuje włączonych typów testów opartych na negative_testing i edge_cases; brakuje: {missing}. Włączone: {available}.',
  'error.data_mix_realistic_unavailable.hint':
    'Jeśli projekt nie ma jeszcze typów testów, wywołaj `project_apply_setup`: doda domyślne. W innym razie podaj `data_mix` jako wagi po nazwach włączonych typów albo użyj "normal".',
  'error.composition_flows_differ.message':
    'Kompozycja „{name}” już istnieje i łączy inne flowy: {saved}. Prośba: {requested}. Nic nie zmieniono.',
  'error.composition_flows_differ.hint':
    'Wywołaj ponownie z inną nazwą kompozycji albo zapytaj użytkownika, co zrobić z istniejącą.',
  'error.scenario_generation_failed.message':
    'Nie utworzono kompozycji „{name}”: brak scenariusza dla {failed} z {total} flowów.\n{failures}\nGotowe: {ready}.',
  'error.scenario_generation_failed.hint':
    'Wywołaj scenario_generate ponownie z tymi samymi argumentami: gotowe scenariusze zostaną użyte, wygenerowane będą tylko brakujące.',
  'error.scenario_generation_refused.message':
    'Nie utworzono kompozycji „{name}”: brak scenariusza dla {failed} z {total} flowów.\n{failures}\nGotowe: {ready}.',
  'error.scenario_generation_refused.hint':
    'LoadCraft odmówił tych flowów albo porażka wróciła z tą samą przyczyną; wywołanie z niezmienionymi danymi skończy się tak samo. Przeczytaj przyczynę przy każdym flow i zmień to, co ona wskazuje (dane w kroku flow, sam flow albo dokumentację API, z której flow powstał), a potem wywołaj scenario_generate ponownie. Gdy przyczyna nie jest pokazana, powiedz użytkownikowi, które flowy nie powstały, zamiast ponawiać.',
  // project_connect_telemetry
  'telemetry.connected': {
    one: 'połączono ✓ · {count} narzędzie: {names}',
    few: 'połączono ✓ · {count} narzędzia: {names}',
    many: 'połączono ✓ · {count} narzędzi: {names}',
    other: 'połączono ✓ · {count} narzędzia: {names}',
  },
  'telemetry.connectedNone':
    'połączono ✓ · żadne narzędzie nie nadaje się do samodzielnego wołania',
  'telemetry.window': 'wołane po teście · okno: cały test ±2 min',
  'telemetry.extraInput': 'nigdy niewołane, potrzebują czegoś więcej niż start i end: {names}',
  'telemetry.notOffered': 'serwer ich nie udostępnia: {names}',
  'telemetry.idle': 'dostępne, ale niewłączone: {names}',
  'error.telemetry_url_credentials.message': 'Adres nie może zawierać danych logowania.',
  'error.telemetry_url_credentials.hint':
    'LoadCraft nie przechowuje poświadczeń serwera logów. Podaj adres bez użytkownika i hasła.',
  'error.telemetry_url_query.message': 'Adres nie może zawierać zapytania (?…) ani fragmentu (#…).',
  'error.telemetry_url_query.hint': 'Usuń parametry z adresu; poświadczeń nie podajemy w adresie.',
  'error.telemetry_url_scheme.message': 'Adres musi zaczynać się od https.',
  'error.telemetry_url_scheme.hint': 'Podaj adres https serwera logów.',
  'error.telemetry_url_invalid.message': 'Ten tekst nie jest poprawnym adresem.',
  'error.telemetry_url_invalid.hint':
    'Podaj pełny adres https serwera logów, na przykład https://logs.example.com/mcp.',
  'error.telemetry_unreachable.message':
    'LoadCraft nie mógł użyć tego serwera logów. Backend napisał: „{detail}”',
  'error.telemetry_unreachable.hint':
    'Serwer logów musi być dostępny publicznie przez HTTP z serwera LoadCraft; lokalny serwer stdio się nie nada. Powiedz o tym użytkownikowi i nie ponawiaj z tym samym adresem.',
  // ---- results_analyze_run -------------------------------------------------------------------
  'diagnosis.progress.start': 'Analiza AI trwa…',
  'diagnosis.progress.step': 'Analiza AI: {step} ({percent}%)',
  'error.analysis_failed.message':
    'Analiza AI nie powiodła się w LoadCraft; treść jego błędu nie jest pokazywana.',
  'error.analysis_failed.hint':
    'Wywołaj results_analyze_run ponownie z force: true; jeśli znów się nie uda, uruchom /loadcraft:doctor.',
  'error.analysis_refused.message':
    'LoadCraft odmówił analizy AI; treść jego odmowy nie jest pokazywana.',
  'error.analysis_refused.hint':
    'Nie ponawiaj: LoadCraft pisze, że kolejna próba skończy się tak samo. Powiedz o tym użytkownikowi.',
  'error.analysis_series_expired.message':
    'Analiza AI nie jest możliwa: serie metryk tego testu już wygasły.',
  'error.analysis_series_expired.hint':
    'Nie ponawiaj. results_get_report nadal pokaże wyniki zapisane po teście.',
  'error.analysis_not_produced.message':
    'Analiza AI nie powstała w ciągu 5 minut, przyczyna nieznana.',
  'error.analysis_not_produced.hint': 'Wywołaj results_analyze_run ponownie z force: true.',
  'report.compare.with': 'z {previous}',
  'report.compare.incomparable': 'nieporównywalne z {previous}: {reasons}',
  'report.compare.noFigures': 'liczb nie zestawiam: różnica mierzyłaby warunki, nie kod',
  'report.compare.diff.profile': 'inny profil (było {was}, jest {is})',
  'report.compare.diff.workload': 'inny profil obciążenia',
  'report.compare.diff.environment': 'inne środowisko',
  'report.compare.diff.scope': 'inny scenariusz albo inna kompozycja',
  'report.compare.diff.unspecified': 'LoadCraft uznaje wykonania za nieporównywalne',
  'report.compare.diff.cancelled.previous': 'poprzednie wykonanie anulowano',
  'report.compare.diff.cancelled.current': 'to wykonanie anulowano',
  'report.compare.diff.run_failed.previous': 'poprzednie wykonanie padło',
  'report.compare.diff.run_failed.current': 'to wykonanie padło',
  'report.compare.note.unverified':
    'nie wiadomo, czy warunki były te same: LoadCraft zapisał za mało o jednym z wykonań (obciążenie, cel albo wersję)',
  'report.compare.note.capped.previous':
    'poprzednie wykonanie ograniczył limit środowiska ({to} z {from})',
  'report.compare.note.capped.current': 'to wykonanie ograniczył limit środowiska ({to} z {from})',
  'report.compare.note.capped.unknown.previous': 'poprzednie wykonanie ograniczył limit środowiska',
  'report.compare.note.capped.unknown.current': 'to wykonanie ograniczył limit środowiska',
  'report.compare.note.durations': 'wykonania trwały różnie ({was} i {is})',
  'report.compare.note.p95Sources':
    'p95 obu wykonań pochodzi z różnych (lub nieznanych) estymatorów: pokazane jako ≈, bez oceny',
  'report.compare.row.p95': 'p95',
  'report.compare.row.errors': 'błędy',
  'report.compare.row.perSecond': 'żądania/s',
  'report.compare.better': 'poprawa',
  'report.compare.worse': 'regresja',
  'report.compare.same': 'bez istotnej zmiany',
  'report.compare.changed': 'zmiana',
  'report.compare.unknown': 'brak pomiaru w jednym z wykonań',
  'report.compare.threshold':
    'p95 całego testu; zmiana poniżej {pct}% to szum (błędy: także poniżej {points} p.p.)',
  'report.compare.composition': 'kompozycja: liczby i ich zmiana, bez oceny zmiany',
  'error.compare_same_run.message':
    'compare_to wskazuje ten sam test, którego raport powstaje ({execution}).',
  'error.compare_same_run.hint':
    'Podaj wcześniejsze wykonanie do porównania: jego uchwyt z process_get_status albo z wcześniejszego run_start.',
  'error.compare_no_result.message':
    'LoadCraft nie ma wyniku dla {execution}, więc nie da się go porównać.',
  'error.compare_no_result.hint':
    'Porównaj z wykonaniem, które się skończyło i zostawiło wynik; process_get_status wymienia ostatnie.',
  'error.result_needs_data.message': 'Dane wyniku podaję tylko w formacie danych.',
  'error.result_needs_data.hint':
    'To jest dla klienta, który rysuje wyniki. Żeby odczytać wynik, wywołaj jego własne narzędzie (results_get_report, results_analyze_run, flows_get).',
  'error.result_not_available.message': 'LoadCraft nie ma wyniku „{kind}” dla {id}.',
  'error.result_not_available.hint':
    'Wywołaj narzędzie tego wyniku (results_analyze_run uruchomi analizę, gdy użytkownik jej chce), zamiast pytać o nią process_get_status.',
  'error.run_in_progress.message': 'Test {execution} jeszcze trwa, więc raportu jeszcze nie ma.',
  'error.run_in_progress.hint':
    'Wywołaj process_wait z operation „{operation}”, a potem results_get_report ponownie.',
  'suggest.title': {
    one: '{count} propozycja ścieżki z dokumentacji API:',
    few: '{count} propozycje ścieżek z dokumentacji API:',
    many: '{count} propozycji ścieżek z dokumentacji API:',
    other: '{count} propozycji ścieżek z dokumentacji API:',
  },
  'suggest.none': 'Dokumentacja API nie dała żadnych propozycji ścieżek.',
  'suggest.type.semantic': 'ścieżka',
  'suggest.type.tag_group': 'funkcja',
  'suggest.type.crud': 'CRUD',
  'suggest.type.auth_rejection': 'oczekuje 401',
  'suggest.type.async_polling': 'odpytywanie',
  'suggest.type.journey_slice': 'szczebel',
  'suggest.unordered':
    'Kroki rozdzielone znakiem · to zbiór: kolejność kroków ustala generator przy budowie.',
  'suggest.ladder': {
    one: 'drabina: {count} szczebel, od {first} ({firstSteps}) do {last} ({lastSteps})',
    few: 'drabina: {count} szczeble, od {first} ({firstSteps}) do {last} ({lastSteps})',
    many: 'drabina: {count} szczebli, od {first} ({firstSteps}) do {last} ({lastSteps})',
    other: 'drabina: {count} szczebla, od {first} ({firstSteps}) do {last} ({lastSteps})',
  },
  'suggest.ladderSteps': {
    one: '{count} krok',
    few: '{count} kroki',
    many: '{count} kroków',
    other: '{count} kroku',
  },
  'suggest.ladderRungs': 'szczeble:',
  'suggest.more': '… i {count} więcej, zapisane do budowy, ale tu niewypisane',
  'suggest.coverage': '{covered} z {total} operacji · {outside} poza ścieżkami',
  'suggest.uncovered': 'poza ścieżkami: {names}',
  'suggest.failed':
    'bez doprecyzowania: {names}; wywołaj ponownie z force: true, żeby spróbować jeszcze raz',
  'suggest.heuristicOnly': 'propozycje heurystyczne, nie doprecyzowane przez model (refine: false)',
  'suggest.progress.start': 'Szukam ścieżek użytkownika w dokumentacji API…',
  'suggest.progress.step': '{label}: {described} z {total}',
  'suggest.progress.label': '{label}',
  'suggest.advice.retry': 'Uruchom flows_suggest_journeys ponownie.',
  'suggest.advice.noRefine': 'Użyj refine: false, żeby dostać propozycje bez udziału modelu.',
  'error.no_openapi_spec.message':
    'Projekt nie ma dokumentacji OpenAPI, z której można zaproponować ścieżki.',
  'error.no_openapi_spec.hint':
    'Dodaj dokumentację (project_import_docs albo project_analyze_setup z dokumentem) albo zbuduj flowy inaczej: flows_describe_journeys lub flows_import_har.',
  'error.websocket_unavailable.message':
    'Kanał WebSocket do LoadCraft nie otwiera się z tej sieci, a LoadCraft anuluje doprecyzowanie, którego nikt nie obserwuje.',
  'error.websocket_unavailable.hint': '{advice}',
  'error.refine_failed.message':
    'LoadCraft nie zdołał doprecyzować propozycji ścieżek; treść jego błędu nie jest pokazywana.',
  'error.refine_failed.hint': '{advice}',
  'error.refine_cancelled.message': 'LoadCraft anulował doprecyzowanie propozycji.',
  'error.refine_cancelled.hint':
    'Uruchom flows_suggest_journeys ponownie i nie przerywaj wywołania: LoadCraft zatrzymuje doprecyzowanie, którego nikt nie obserwuje, po 45 s.',
  'error.refine_expired.message':
    'Doprecyzowanie propozycji wygasło: LoadCraft zatrzymuje doprecyzowanie, którego nikt nie obserwuje, po 45 s albo zapomniał o zadaniu.',
  'error.refine_expired.hint':
    'Wywołaj flows_suggest_journeys ponownie, żeby zacząć nowe doprecyzowanie, i nie przerywaj wywołania.',
  // ---- flows_import_har --------------------------------------------------------------------------
  'importHar.progress.upload': 'wysyłanie… {seconds} s',
  'importHar.progress.analyze': 'analiza… {seconds} s',
  'importHar.size.mb': '{count} MB',
  'importHar.size.kb': '{count} KB',
  'importHar.filtered': {
    one: '{count} odfiltrowane jako szum',
    few: '{count} odfiltrowane jako szum',
    many: '{count} odfiltrowanych jako szum',
    other: '{count} odfiltrowanych jako szum',
  },
  'importHar.summary.sent': 'wysłano {size} · {requests} · {filtered}',
  'importHar.summary.reused': 'już wysłane {size} · {requests} · {filtered}',
  'importHar.login': 'logowanie: {auth} · adres: {address}',
  'importHar.address.default': '{environment} (domyślne)',
  'importHar.auth.none': 'nie wykryto',
  'importHar.auth.bearer_token': 'token',
  'importHar.auth.cookie_session': 'ciasteczko sesji',
  'importHar.auth.basic_auth': 'dane Basic',
  'importHar.auth.other': '{kind}',
  'importHar.auth.from': '{kind} z {endpoint}',
  'importHar.paths': {
    one: '{count} grupa akcji w nagraniu',
    few: '{count} grupy akcji w nagraniu',
    many: '{count} grup akcji w nagraniu',
    other: '{count} grupy akcji w nagraniu',
  },
  'importHar.paths.none': 'w nagraniu nie znaleziono grup akcji',
  'importHar.more': '… i {count} więcej',
  'importHar.corr.title': 'korelacje: {parts}',
  'importHar.corr.none': 'korelacje: nie znaleziono',
  'importHar.corr.accepted': {
    one: '{count} przyjęta automatycznie',
    few: '{count} przyjęte automatycznie',
    many: '{count} przyjętych automatycznie',
    other: '{count} przyjęte automatycznie',
  },
  'importHar.corr.uncertain': {
    one: '{count} niepewna',
    few: '{count} niepewne',
    many: '{count} niepewnych',
    other: '{count} niepewne',
  },
  'importHar.corr.ambiguous': {
    one: '{count} niejednoznaczna',
    few: '{count} niejednoznaczne',
    many: '{count} niejednoznacznych',
    other: '{count} niejednoznaczne',
  },
  'importHar.warning.sanitized_export':
    'Nagranie nie ma treści odpowiedzi (ani ciasteczek), więc nie da się z niego wygenerować flow. Nagraj je ponownie w Chrome DevTools z włączoną opcją „Allow generating HAR with sensitive data”, zapisz jako HAR i wyślij jeszcze raz.',
  'importHar.warning.different_host':
    'Adres z nagrania ({host}) to nie domyślne środowisko ({environment}). Sprawdź, które środowisko chcesz testować.',
  'importHar.warning.empty_har': 'Nagranie nie zawiera żadnych żądań.',
  'importHar.warning.all_static':
    'Wszystkie żądania w nagraniu to pliki statyczne. Nagraj sesję, w której używasz aplikacji.',
  'importHar.warning.weak_response_har':
    'Nagranie ma mało treści odpowiedzi; korelacje będą ostrożne.',
  'importHar.warning.llm_fallback':
    'Model językowy był niedostępny, więc szum oceniono heurystyką.',
  'importHar.warning.backend': 'LoadCraft zgłosił jeszcze: {code}.',
  'error.har_proxy_timeout.message':
    'Wywołanie nie powiodło się po około minucie (HTTP {status}): przerwał je serwer pośredniczący między pluginem a LoadCraftem. To wdrożenie stoi prawdopodobnie za proxy z domyślnym limitem czasu.',
  'error.har_proxy_timeout.hint':
    'Poproś osobę, która utrzymuje ten LoadCraft, o podniesienie limitu czasu proxy dla tras HAR do 300 s, a potem wyślij nagranie jeszcze raz.',
  // konfiguracja projektu: project_create, project_save_env, project_check_env, project_analyze_setup, project_apply_setup
  'initProject.header.project': 'Projekt „{name}”',
  'initProject.header.reused': 'istniejący',
  'initProject.header.noDocs': 'bez dokumentacji API',
  'initProject.header.operations': {
    one: '{count} operacja',
    few: '{count} operacje',
    many: '{count} operacji',
    other: '{count} operacji',
  },
  'initProject.analysis.label': 'analiza projektu',
  'initProject.analysis.none': 'analiza projektu: brak materiałów · profil uzupełni nagranie HAR',
  'initProject.analysis.queued': 'analiza projektu: w kolejce',
  'initProject.analysis.running': 'analiza projektu w toku',
  'initProject.analysis.progress': 'analiza projektu: {label}',
  'initProject.analysis.step.input_to_messages': 'przygotowanie materiału',
  'initProject.analysis.step.parse_uploaded_evidence': 'czytanie wysłanych materiałów',
  'initProject.analysis.step.fetch_docs_evidence': 'pobieranie dokumentacji',
  'initProject.analysis.step.fetch_repo_evidence': 'czytanie repozytorium',
  'initProject.analysis.step.aggregate_evidence': 'zestawianie materiału',
  'initProject.analysis.step.enrich_profile': 'wnioskowanie o profilu (model)',
  'initProject.analysis.step.enrich_modules': 'nazywanie modułów (model)',
  'initProject.analysis.step.enrich_summary': 'streszczenie aplikacji (model)',
  'initProject.analysis.step.finalize_response': 'kończenie analizy',
  'initProject.profile.line': 'profil: {fields}',
  'initProject.profile.fields': {
    one: '{count} pole',
    few: '{count} pola',
    many: '{count} pól',
    other: '{count} pola',
  },
  'initProject.profile.toReview': {
    one: '{count} do sprawdzenia',
    few: '{count} do sprawdzenia',
    many: '{count} do sprawdzenia',
    other: '{count} do sprawdzenia',
  },
  'initProject.profile.applied': 'profil zastosowany ✓',
  'initProject.profile.notApplied': 'profil niezastosowany',
  'projectSetup.analysis.proposed': 'proponowany profil: {fields}',
  'projectSetup.analysis.next':
    '→ dalej: project_apply_setup z analysis "{operation}"; zastosuje proponowany profil i doda domyślne walidatory i typy testów',
  'projectSetup.analysis.nextWithout':
    '→ dalej: project_apply_setup bez analysis; doda domyślne walidatory i typy testów',
  'error.setup_analysis_running.message':
    'Analiza projektu {operation} jeszcze trwa; jej propozycje nie są gotowe.',
  'error.setup_analysis_running.hint':
    'Kontynuuj przez process_wait z tym uchwytem, potem wywołaj project_apply_setup ponownie.',
  'error.setup_analysis_other_project.message':
    'Analiza projektu {operation} należy do innego projektu; jej propozycji nie stosuję w tym.',
  'error.setup_analysis_other_project.hint':
    'Uruchom project_analyze_setup dla związanego projektu i podaj uchwyt z jego wyniku.',
  'initProject.provision.validators': 'walidatory {count}',
  'initProject.provision.testTypes': 'typy testów {count}',
  'initProject.provision.toReview': '(do przejrzenia)',
  'initProject.auth.label': 'logowanie: {login}',
  'initProject.auth.tokenFrom': 'token z {endpoint}',
  'initProject.auth.methodAt': '{method} ({endpoint})',
  'initProject.auth.bearer_jwt': 'token JWT',
  'initProject.auth.session_cookie': 'ciasteczko sesji',
  'initProject.auth.oauth2_code': 'OAuth2 (kod)',
  'initProject.auth.oauth2_pkce': 'OAuth2 (PKCE)',
  'initProject.auth.api_key': 'klucz API',
  'initProject.auth.basic': 'Basic',
  'initProject.auth.saml': 'SAML',
  'initProject.auth.none': 'bez logowania',
  'error.setup_analysis_failed.message':
    'LoadCraft nie dokończył analizy projektu ({phase}): {message}',
  'error.setup_analysis_failed.hint':
    'Usuń przyczynę (popraw dokumentację albo opis) i uruchom project_analyze_setup ponownie; powtórzy analizę, a project_apply_setup dokończy konfigurację.',
  'initProject.connection.ok': 'połączenie ok: {names}',
  'initProject.connection.both': '(API i frontend)',
  'initProject.connection.apiOnly': '(API)',
  'initProject.connection.problem': 'połączenie {name}: {parts}',
  'initProject.probe.api': 'API {status}',
  'initProject.probe.frontend': 'frontend {status}',
  'initProject.status.ok': 'ok',
  'initProject.status.blocked': 'zablokowane: adres prywatny, LoadCraft go nie osiągnie',
  'initProject.status.unreachable': 'nieosiągalne',
  'initProject.status.tls_error': 'błąd TLS',
  'initProject.status.too_many_redirects': 'za dużo przekierowań',
  'initProject.status.not_checked': 'niesprawdzone',
  'initProject.connection.next':
    '→ LoadCraft nie dosięgnął adresu powyżej: sprawdź go z użytkownikiem i popraw (adres zablokowany jest prywatny, więc LoadCraft go nie dosięgnie), potem popraw go w ustawieniach środowiska w LoadCraft (project_save_env dodaje środowiska, nigdy nie zmienia adresu istniejącego) i wywołaj project_check_env jeszcze raz; do czasu odpowiedzi nie uruchamiaj na tym środowisku testu ani nie zakładaj kont.',
  'initProject.status.other': '{status}',
  'initProject.env.differs':
    'uwaga: środowisko {name} ma inny {field} niż w żądaniu: {current} (żądano {requested}) — bez zmian',
  'initProject.env.none': 'brak',
  'initProject.env.protectionSet': '{name}: ochrona ustawiona ({limit})',
  'initProject.env.protectionKept':
    'uwaga: środowisko {name} zostaje chronione: {current}. Luźniejsza część żądania ({parts}) nie została zastosowana; ochronę luzuje się albo zdejmuje tylko w interfejsie LoadCraft, ręcznie.',
  'initProject.env.protectionKeptNoLimit':
    'uwaga: środowisko {name} zostaje chronione: {current}. Żądanie nie ma dla niego limitu, więc nic nie zluzowano; ochronę zdejmuje się tylko w interfejsie LoadCraft, ręcznie.',
  'initProject.header.areas': {
    one: '{count} obszar',
    few: '{count} obszary',
    many: '{count} obszarów',
    other: '{count} obszaru',
  },
  'initProject.conformance.label': 'zgodność: {parts}',
  'initProject.conformance.exists': '{count} GET ✓',
  'initProject.conformance.missing': 'brakujące {count}: {paths}',
  'initProject.conformance.more': 'i {count} więcej',
  'initProject.conformance.inconclusive': 'niejednoznaczne {count}',
  'initProject.conformance.inconclusiveStatuses': 'niejednoznaczne {count} (HTTP {statuses})',
  'initProject.conformance.reportStatus': 'raport {status}',
  'initProject.conformance.headersHint':
    'Większość sond dostała 400, 401 albo 403: sprawdź stałe nagłówki i uwierzytelnienie środowiska; nagłówki ustawia project_save_env',
  'initProject.conformance.unchecked': '{count} niesprawdzone ({reasons})',
  'initProject.conformance.reason.methods': 'nie-GET',
  'initProject.conformance.reason.params': 'parametry',
  'initProject.conformance.reason.offHost': 'inny host',
  'initProject.conformance.headersSent': 'wysłane nagłówki: {names}',
  'initProject.conformance.headersHintSent':
    'Większość sond dostała 400, 401 albo 403, choć wysłano nagłówki {names}: sprawdź ich wartości i uwierzytelnienie środowiska; nagłówki ustawia project_save_env',
  'initProject.conformance.headersHintNone':
    'Większość sond dostała 400, 401 albo 403, a nie wysłano żadnego stałego nagłówka: cel może wymagać nagłówka (np. klucza API); nagłówki środowiska ustawia project_save_env',
  'initProject.conformance.skipped': 'zgodność: pominięta — środowisko chronione',
  'initProject.conformance.failed': 'zgodność: sprawdzenie nie powiodło się',
  'initProject.review.heading': 'do sprawdzenia, zapytaj użytkownika:',
  'initProject.review.model': 'model',
  'initProject.field.api': 'adres API',
  'initProject.field.frontend': 'adres frontendu',
  'initProject.field.limit': 'limit',
  'error.project_name_taken.message':
    'Nazwa projektu „{name}” jest już zajęta w LoadCraft przez projekt, którego ten token API nie widzi.',
  'error.project_name_taken.hint':
    'Zapytaj użytkownika o inną nazwę projektu albo o dostęp do istniejącego, potem powtórz project_create.',
  'error.init_project_default_repeated.message':
    'Więcej niż jedno środowisko oznaczono jako domyślne: {names}.',
  'error.init_project_default_repeated.hint':
    'Oznacz default: true dokładnie jedno środowisko (gdy żadne nie jest oznaczone, domyślne jest pierwsze).',
  'error.init_project_environment_repeated.message': 'Nazwa środowiska „{name}” powtarza się.',
  'error.init_project_environment_repeated.hint': 'Nadaj każdemu środowisku własną nazwę.',
  'error.init_project_environment_not_protected.message':
    'Na środowisku „{environment}” nie ustawiono żądanego limitu i ochrony: zapis się nie udał albo LoadCraft go nie pokazuje. Środowisko może być niechronione.',
  'error.init_project_environment_not_protected.hint':
    'Nie uruchamiaj na nim testów. Ustaw limit w ustawieniach środowiska w LoadCraft (albo poproś o to użytkownika), potem sprawdź przez process_get_status.',
  'error.init_project_address_invalid.message':
    'Adres {field} środowiska „{environment}” nie jest poprawnym adresem http(s).',
  'error.init_project_address_invalid.hint':
    'Podaj host (api.example.com) albo adres http(s) bez nazwy użytkownika i hasła.',
  'error.init_project_header_name_invalid.message':
    'Nazwa nagłówka „{name}” środowiska „{environment}” jest niedozwolona.',
  'error.init_project_header_name_invalid.hint':
    'Nazwa nagłówka to litery, cyfry i myślniki, zaczyna się od litery (x-api-key). Nie przyjmujemy Host, Content-Length, Transfer-Encoding, Connection ani Authorization. Popraw nazwę i powtórz wywołanie.',
  'error.init_project_header_repeated.message':
    'Nagłówek „{name}” jest wymieniony więcej niż raz dla środowiska „{environment}”.',
  'error.init_project_header_repeated.hint':
    'Wymień każdy nagłówek raz; nazwy porównujemy bez względu na wielkość liter.',
  'error.init_project_header_variable_missing.message':
    'Zmiennej {variable} (nagłówek „{name}” środowiska „{environment}”) brakuje albo jest pusta w {file}.',
  'error.init_project_header_variable_missing.hint':
    'Poproś użytkownika o dopisanie {variable} do {file} albo o nazwę zmiennej (lub pliku), w której leży wartość, i powtórz wywołanie. Nigdy nie pytaj o samą wartość i nie czytaj pliku samodzielnie.',
  'error.init_project_header_value_invalid.message':
    'Wartość {variable} z {file} nie nadaje się na nagłówek: zawiera koniec wiersza albo inny znak sterujący.',
  'error.init_project_header_value_invalid.hint':
    'Poproś użytkownika o poprawienie zmiennej w pliku (jedna linia, bez znaków sterujących) i powtórz wywołanie.',
  'error.init_project_headers_unpreservable.message':
    'Środowisko „{environment}” ma nagłówki, które LoadCraft maskuje ({names}); aktualizacja zastępuje cały zestaw, a zamaskowanej wartości nie da się odesłać, więc zostałyby utracone.',
  'error.init_project_headers_unpreservable.hint':
    'Nagłówków tego środowiska nie zmieniono. Wymień w wywołaniu wszystkie nagłówki tego środowiska (każdy ze zmiennej w pliku env) albo poproś użytkownika o ustawienie nagłówków w ustawieniach środowiska w LoadCraft, i powtórz wywołanie.',
  'error.init_project_headers_not_set.message':
    'Nagłówki środowiska „{environment}” nie zostały zapisane: LoadCraft nie zwraca ich po zapisie.',
  'error.init_project_headers_not_set.hint':
    'Nie uruchamiaj na nim testów. Powtórz wywołanie albo poproś użytkownika o ustawienie nagłówków w ustawieniach środowiska w LoadCraft.',
  'initProject.headers': 'nagłówki: {list}',
  'initProject.headers.item': '{name} z {variable}',
  'error.init_project_description_too_long.message':
    '{source} ma {length} znaków; opis projektu mieści najwyżej {limit}.',
  'error.init_project_description_too_long.hint': 'Skróć go do {limit} znaków i powtórz wywołanie.',
  'error.full_rebuild_required.message':
    'Self-check nie może ruszyć: ten scenariusz nie ma budowy modułowej.',
  'error.full_rebuild_required.hint':
    'Zregeneruj scenariusz przez scenario_generate, potem ponów scenario_check_self.',
  'selfCheck.header': 'self-check · {environment} (domyślne) · 1 użytkownik · jedno przejście',
  'selfCheck.headerNoEnvironment': 'self-check · 1 użytkownik · jedno przejście',
  'selfCheck.phase.pending': 'w kolejce',
  'selfCheck.phase.running': 'sprawdzanie',
  'selfCheck.phase.repairing': 'naprawa AI',
  'selfCheck.pending': 'w kolejce',
  'selfCheck.running': 'sprawdzanie',
  'selfCheck.repairing': 'naprawa AI w toku',
  'selfCheck.passedNoChain': '✓ przeszedł · łańcuch żądań niedostępny',
  'selfCheck.repairCount': {
    one: 'po {count} naprawie',
    few: 'po {count} naprawach',
    many: 'po {count} naprawach',
    other: 'po {count} naprawach',
  },
  'selfCheck.run': 'próba {n} · wersja {version}',
  'selfCheck.runBare': 'próba {n}',
  'selfCheck.stepsOmitted': {
    one: '… {count} krok poza listą',
    few: '… {count} kroki poza listą',
    many: '… {count} kroków poza listą',
    other: '… {count} kroku poza listą',
  },
  'selfCheck.attemptsOmitted': {
    one: '… {count} próba pominięta',
    few: '… {count} próby pominięte',
    many: '… {count} prób pominiętych',
    other: '… {count} próby pominiętej',
  },
  'selfCheck.failed': '✕ nie przeszedł',
  'selfCheck.repair': 'naprawa AI: {changes}',
  'selfCheck.repairBare': 'naprawa AI',
  'selfCheck.repairVersion': 'wersja {version}',
  'selfCheck.repairRefused': 'naprawa AI odrzucona: {reason}',
  'selfCheck.waiting_for_data': 'czeka na dane: {slots}',
  'selfCheck.waiting_for_dataBare': 'czeka na dane',
  'selfCheck.next.waiting_for_data':
    '→ odczytaj data_check_readiness: nazywa, co wypełnia slot (data_create_dataset dla zwykłych danych albo pliku CSV, data_create_accounts dla kont po zgodzie użytkownika); potem scenario_check_self jeszcze raz.',
  'selfCheck.target_unreachable': 'cel nieosiągalny',
  'selfCheck.not_admitted': 'niedopuszczony do uruchomienia: {reason}',
  'selfCheck.reason.no_default_environment': 'projekt nie ma środowiska domyślnego',
  'selfCheck.reason.protected_environment_requires_caps':
    'środowisko domyślne jest chronione i nie ma limitów obciążenia',
  'selfCheck.skipped_protected_environment': 'pominięty: środowisko domyślne jest chronione',
  'selfCheck.interrupted': 'przerwany (restart LoadCraft) — ponów',
  'selfCheck.disabled': 'wyłączony w profilu projektu',
  'selfCheck.goal_step_missing': 'flow nie ma kroku kończącego podróż',
  'selfCheck.goal_step_missingAt': 'flow nie ma kroku kończącego podróż: {goal}',
  'selfCheck.other': 'status: {status}',
  'selfCheck.next.failed':
    '→ przeczytaj krok, który padł, i jego odpowiedź powyżej, potem działaj według przyczyny: 401 albo 403 to logowanie lub konta; 400 z nazwą klucza albo nagłówka to stały nagłówek środowiska (project_save_env z headers); przy innej przyczynie powiedz użytkownikowi, co pokazuje odpowiedź. Nie uruchamiaj testu.',
  'selfCheck.next.goal_step_missing':
    '→ flow nigdy nie dochodzi do celu: zbuduj go od nowa (flows_generate_from_endpoints pod inną nazwą, flows_describe_journeys albo flows_generate_from_har) i powiedz użytkownikowi; nie uruchamiaj testu.',
  'selfCheck.next.target_unreachable':
    '→ domyślne środowisko nie odpowiedziało: zapytaj użytkownika, czy aplikacja tam działa i czy LoadCraft sięga jej adresu; do czasu odpowiedzi nie uruchamiaj testu.',
  'selfCheck.next.not_admitted':
    '→ LoadCraft nie dopuścił sprawdzenia z powodu podanego powyżej: powiedz użytkownikowi i nie obchodź tego.',
  'selfCheck.next.skipped_protected_environment':
    '→ nic nie sprawdzono: scenariusz jest niesprawdzony, więc tak to opisz; o dalszym kroku decyduje użytkownik.',
  // run_plan
  'profiles.title': {
    one: 'Profile obciążenia dla {count} użytkownika na {environment}',
    few: 'Profile obciążenia dla {count} użytkowników na {environment}',
    many: 'Profile obciążenia dla {count} użytkowników na {environment}',
    other: 'Profile obciążenia dla {count} użytkownika na {environment}',
  },
  'profiles.limit.caps': 'Limit środowiska {environment}: {caps}.',
  'profiles.limit.none': 'Środowisko {environment} nie ma limitów obciążenia.',
  'profiles.limit.protectedNoCaps':
    'Środowisko {environment} jest chronione i nie ma limitów obciążenia, więc run_start odmówi uruchomienia.',
  'profiles.cap.users': {
    one: '{count} użytkownik',
    few: '{count} użytkowników',
    many: '{count} użytkowników',
    other: '{count} użytkownika',
  },
  'profiles.cap.rate': '{value} nowych/s',
  'profiles.default': '(domyślny)',
  'profiles.desc.ramp': '{users} rozłożonych na {ramp}',
  'profiles.desc.constant': '{rate} nowych/s przez {hold}',
  'profiles.desc.ramp_hold': '{users} w {ramp}, potem {rate} nowych/s przez {hold}',
  'profiles.desc.stress': '5 stopni po {step}, do {peak} nowych/s',
  'profiles.desc.constant_concurrency': '{users} jednocześnie przez {hold}',
  'profiles.desc.ramp_concurrency': '0 → {users} jednocześnie w {ramp}',
  'profiles.desc.spike': '{users} naraz, {hold} przerwy, potem {peak}',
  'profiles.desc.soak': '{users} jednocześnie przez {hold}',
  'profiles.marker.clamped': '→ przycięty do {to}',
  'profiles.marker.spike':
    '→ przycięty do {to} (limit {limit} ÷ 2: druga seria jest 2× większa od pierwszej)',
  'profiles.marker.refused':
    '→ niedostępny: limit {limit} nie mieści spike’a (druga seria jest 2× większa od pierwszej)',
  'profiles.marker.stressFloor': '(schodki i tak dochodzą do co najmniej {peak} nowych/s)',
  'profiles.data.ready': 'dane ✓',
  'profiles.data.short': 'dane ✕ {slots}',
  'profiles.data.slot': '{label}: {have} z {need} wierszy',
  'profiles.data.refused': 'dane ✕ {reason}',
  'profiles.data.slotNone': '{label}: brak zbioru',
  'profiles.json.title': 'Argument „profile” dla run_start, pod numerem z listy:',
  'profiles.next': 'dalej: run_start z wybranym profilem, jego linia powyżej jako „profile”.',
  // ---- flows_generate_* -------------------------------------------------------------------
  'build.progress': '{done}/{total} · {name}…',
  'build.progress.done': '{done}/{total}',
  'build.flows.partial': {
    one: '{count} z {total} flowów gotowy',
    few: '{count} z {total} flowów gotowe',
    many: '{count} z {total} flowów gotowych',
    other: '{count} z {total} flowów gotowych',
  },
  'build.flows.single': 'flow „{name}” gotowy · {steps} ({requests} · {pauses})',
  'build.manual.running': 'Generuję „{name}”…',
  'build.manual.progress': 'Generuję „{name}”: {step}…',
  'build.manual.noDetail': 'LoadCraft nie podał przyczyny',
  'build.manual.unknownIds': {
    one: 'endpointu {ids}',
    few: 'endpointów {ids}',
    many: 'endpointów {ids}',
    other: 'endpointów {ids}',
  },
  'build.manual.closest': ' Najbliższe znane: {items}.',
  'error.unknown_endpoints.message': 'LoadCraft nie zna {what}.{closest}',
  'error.unknown_endpoints.hint':
    'Podaj endpointy jako „METHOD /path” (na przykład „POST /auth/login”), UUID albo operationId z dokumentacji API.',
  'error.flow_exists.message': 'Flow o nazwie „{name}” już istnieje; {tool} go nie nadpisuje.',
  'error.flow_exists.hint': 'Wywołaj {tool} jeszcze raz z inną nazwą.',
  'error.flow_generation_failed.message': 'Flow „{name}” nie powstał: {detail}',
  'error.flow_generation_failed.hint':
    'Sprawdź argumenty wywołania, potem wywołaj {tool} jeszcze raz; druga próba może się udać.',
  'error.flow_generation_cancelled.message':
    'Generowanie flow „{name}” zostało anulowane w LoadCraft.',
  'error.flow_generation_cancelled.hint':
    'Wywołaj {tool} jeszcze raz, jeśli flow nadal jest potrzebny.',
  'build.har.generating': 'Generuję flow z nagrania… {seconds} s',
  'build.har.progress': 'Generuję z nagrania: {step}…',
  'build.har.accepted': {
    one: 'Podział przyjęty: {count} ścieżka, buduję jej flow…',
    few: 'Podział przyjęty: {count} ścieżki, buduję ich flowy…',
    many: 'Podział przyjęty: {count} ścieżek, buduję ich flowy…',
    other: 'Podział przyjęty: {count} ścieżki, buduję ich flowy…',
  },
  'build.har.building': 'Buduję flowy: {step}…',
  'build.har.advice.retry':
    'Druga próba może się udać: wywołaj flows_generate_from_har jeszcze raz z tymi samymi argumentami.',
  'build.har.advice.fix':
    'Nagraj ścieżkę ponownie albo zbuduj flow inną drogą (flows_describe_journeys albo ręcznie).',
  'build.har.advice.noSplit':
    'Bez podziału: wywołaj flows_generate_from_har z split: false i nazwą (name) — jeden flow z całego nagrania.',
  'build.har.splitting': 'LoadCraft dzieli nagranie na ścieżki…',
  'error.har_split_abandoned.message':
    'Podział nagrania skończył się razem z procesem serwera, który trzymał jego połączenie; LoadCraft porzuca taki przebieg i nie znaleziono żadnego flow z niego.',
  'error.har_split_abandoned.hint':
    'Zacznij od nowa: wywołaj flows_generate_from_har z tym samym har i split: true (nie process_wait).',
  'build.har.where.channel': 'błąd kanału HAR',
  'build.har.where.http': 'HTTP {status}',
  'build.flows.note.single_journey':
    'Nagranie ma jedną ścieżkę, więc LoadCraft zbudował jeden flow bez podziału.',
  'error.har_path_excluded.message':
    '{file} leży w katalogu ukrytym, w node_modules albo jest plikiem ukrytym; nagrań stamtąd nie wysyłam.',
  'error.har_path_excluded.hint':
    'Poproś użytkownika o zapisanie nagrania w projekcie (np. nagrania/sesja.har) i podaj tę ścieżkę. Nic nie wysłano.',
  'error.har_split_missing.message':
    'Budowanie z nagrania wymaga split: czy podzielić je na ścieżki, czy zbudować jeden flow.',
  'error.har_split_missing.hint':
    'Zapytaj użytkownika, czy podzielić nagranie (flow na każdą ścieżkę), czy zbudować jeden flow, i wywołaj flows_generate_from_har ze split: true albo split: false.',
  'error.har_name_required.message':
    'Jeden flow z całego nagrania (split: false) wymaga nazwy (name).',
  'error.har_name_required.hint':
    'Zapytaj użytkownika o nazwę flow i wywołaj flows_generate_from_har jeszcze raz z name.',
  'error.har_paths_without_split.message':
    'paths wybiera ścieżki podziału, a to wywołanie ma split: false.',
  'error.har_paths_without_split.hint': 'Podaj split: true razem z paths albo pomiń paths.',
  'error.har_split_unknown_paths.message':
    'LoadCraft nie zaproponował ścieżki {names}; zaproponował: {available}. Przebieg anulowano, nic nie zbudowano.',
  'error.har_split_unknown_paths.hint':
    'Wywołaj flows_generate_from_har jeszcze raz z paths z tej listy albo bez paths, żeby zbudować wszystkie.',
  'error.har_split_interrupted.message':
    'Połączenie z LoadCraft zerwało się w trakcie dzielenia nagrania; LoadCraft porzuca taki przebieg i nie zbudował żadnego flow.',
  'error.har_split_interrupted.hint':
    'Wywołaj flows_generate_from_har jeszcze raz z tymi samymi argumentami: cały podział przejdzie od nowa. Jeśli połączenie dalej się zrywa, użyj split: false.',
  'error.har_split_timeout.message':
    'LoadCraft nie skończył dzielenia nagrania w {minutes} minut; przebieg anulowano.',
  'error.har_split_timeout.hint':
    'Wywołaj flows_generate_from_har później albo użyj split: false, żeby zbudować jeden flow z całego nagrania.',
  'error.har_split_cancelled.message': 'Podział nagrania anulowano w LoadCraft.',
  'error.har_split_cancelled.hint':
    'Wywołaj flows_generate_from_har jeszcze raz, jeśli flowy nadal są potrzebne.',
  'error.har_split_unavailable.message':
    'Kanału WebSocket, na którym LoadCraft dzieli nagrania, nie da się otworzyć z tej sieci.',
  'error.har_split_unavailable.hint':
    'Użyj split: false (jeden flow z całego nagrania przez zwykłe HTTP) albo uruchom /loadcraft:doctor.',
  'error.har_generation_failed.message':
    'LoadCraft nie zbudował flowów z nagrania ({where}); jego własnego tekstu nie pokazuję, bo może cytować nagranie.',
  'error.har_generation_failed.hint': '{advice}',
  'error.har_recording_incomplete.message':
    'Nagranie zapisano bez treści odpowiedzi i nagłówków sesji, więc flow z niego nie zaloguje się.',
  'error.har_recording_incomplete.hint':
    'Poproś użytkownika o nowe nagranie z włączoną opcją „Allow generating HAR with sensitive data” w narzędziach deweloperskich przeglądarki przed zapisem HAR, a potem wywołaj to samo narzędzie z nowym plikiem.',
  'error.har_session_expired.message':
    'LoadCraft nie ma już nagrania (restart albo wygasła sesja); nie zbudowano żadnego flow.',
  'error.har_session_expired.hint':
    'Wywołaj flows_generate_from_har jeszcze raz z tymi samymi argumentami: nagranie zostanie najpierw wysłane ponownie.',
  'build.flows.unchecked':
    'Nie sprawdzono unikalności nazwy wśród wszystkich {total} flowów projektu.',
  'build.flows.item': '{name} {steps}',
  'build.flows.failed': '✕ {name}: błąd',
  'build.flows.failedRetry': '✕ {name}: błąd (można ponowić)',
  'build.flows.warning':
    '⚠ Niegotowy do uruchomienia: {flows} dostaje 401 na części kroków (szczegóły niżej).',
  'build.flows.credential.definite':
    '✕ {flow}: {steps} dostaną 401: niosą token wydany dla innego schematu bezpieczeństwa.',
  'build.flows.credential.doubt':
    '? {flow}: {steps} mogą nieść token, którego dokumentacja dla nich nie przyjmuje.',
  'build.flows.static':
    '! {flow}: brak wartości klucza API aplikacji testowanej w nagłówku "{header}"{where}.',
  'build.flows.static.anyEnv': ' w środowisku, na którym uruchamiasz',
  'build.flows.next.definite':
    'Dodaj do flowu operację logowania tego schematu bezpieczeństwa i przebuduj flow przez flows_generate_from_endpoints; do tego czasu te kroki kończą się 401.',
  'build.flows.next.doubt':
    'Zapytaj użytkownika, jaki token mają nieść te kroki; nie odpowiadaj sam i nie uruchamiaj flowu wcześniej.',
  'build.flows.next.static':
    'Ustaw nagłówek {headers} w środowisku przez project_save_env (from_env, żeby wartość nie trafiła do rozmowy): to klucz API aplikacji docelowej, nie Twój token LoadCraft; poproś o niego użytkownika.',
  'build.flows.question': 'pytanie · {flow}: {question}',
  'build.flows.retry':
    'Żeby ponowić, wywołaj flows_generate_from_suggestions jeszcze raz z suggestions: {names}.',
  'build.flows.reason.not_created':
    'flow nie powstał, przyczyna nieznana (kanał na żywo był niedostępny)',
  'build.flows.reason.no_result': 'przebieg skończył się bez wyniku dla tej propozycji',
  'build.flows.reason.unreadable': 'flow powstał, ale LoadCraft go nie zwrócił',
  'build.flows.reason.too_large':
    'LoadCraft odmówił: ścieżka obejmuje za dużo operacji albo zbyt rozbudowane schematy jak na model; druga próba skończy się tak samo',
  'build.flows.reason.refused': 'LoadCraft odmówił; druga próba skończy się tak samo',
  'build.flows.reason.validation':
    'flow wygenerowany przez LoadCraft nie przeszedł własnych kontroli; druga próba może skończyć się tak samo',
  'build.flows.reason.validation_auth':
    'Flow wygenerowany przez LoadCraft nie przeszedł kontroli autoryzacji: ścieżka wymaga logowania, a żaden krok nie woła endpointu tokenu; druga próba może skończyć się tak samo',
  'build.advice.too_large':
    'Podziel ścieżkę na mniejsze: wybierz propozycję z mniejszą liczbą takich operacji albo zbuduj flow z nagrania HAR lub z opisu (flows_import_har, flows_describe_journeys).',
  'build.advice.retry':
    'Wywołaj flows_generate_from_suggestions jeszcze raz z nazwami, które zawiodły; druga próba może się udać.',
  'build.advice.auth':
    'Jeśli to ścieżka logowania albo konta, sprawdź, czy dokumentacja opisuje endpoint tokenu (bez niego LoadCraft nie dołoży kroku logowania); w innym razie wybierz inną propozycję z flows_suggest_journeys, opisz ścieżkę własnymi słowami (flows_describe_journeys) albo zbuduj flow z nagrania (flows_import_har).',
  'build.advice.fix':
    'LoadCraft odmówił tej ścieżki, a przyczyny tu nie widać. Wybierz inną propozycję z flows_suggest_journeys, opisz ścieżkę własnymi słowami (flows_describe_journeys) albo zbuduj flow z nagrania (flows_import_har). Jeśli to ścieżka logowania albo konta, sprawdź, czy dokumentacja opisuje endpoint tokenu.',
  'error.no_suggestions.message': 'Dla tego projektu nie ma zapisanych propozycji ścieżek.',
  'error.no_suggestions.hint':
    'Najpierw wywołaj flows_suggest_journeys, potem flows_generate_from_suggestions z nazwami z jego listy.',
  'error.unknown_suggestions.message':
    'Brak zapisanej propozycji o nazwie {names}; zapisane: {available}.',
  'error.unknown_suggestions.hint':
    'Użyj nazw z tej listy albo wywołaj flows_suggest_journeys jeszcze raz po świeże propozycje.',
  'error.suggestions_stale.message':
    'Zapisane propozycje są nieaktualne: dokumentacja API zmieniła się po ich przygotowaniu.',
  'error.suggestions_stale.hint':
    'Wywołaj flows_suggest_journeys jeszcze raz, potem flows_generate_from_suggestions z nazwami z nowej listy.',
  'error.build_flows_failed.message': 'Żaden flow nie powstał: {detail}',
  'error.build_flows_failed.hint': '{advice}',
  'runStart.clamped': 'obciążenie przycięte do {to} (limit środowiska {environment})',
  'runStart.clamped.spike':
    'obciążenie przycięte do {to} (limit środowiska {environment} ÷ 2: druga seria jest 2× większa od pierwszej)',
  'runStart.data.ok': 'sprawdzenie danych pod profil ✓',
  'runStart.data.slot': '{name} {have} ≥ potrzebne ~{need}',
  'runStart.data.slotShort': '{label}: {have} z {need} wierszy',
  'runStart.data.slotNone': '{label}: brak użytecznego zbioru ({status})',
  'runStart.data.notReady': 'sprawdzenie danych nie przeszło',
  'runStart.started': 'test uruchomiony · {label} · {shape}',
  'runStart.confirm.head': 'Test „{target}” nie został uruchomiony: {reason}; nic nie wysłano.',
  'runStart.confirm.numbers':
    'Żądany profil: {profile}, {requested} · pójdzie z: {effective} · limit środowiska {environment}: {limit}',
  'runStart.confirm.next':
    'Zapytaj użytkownika i dopiero po zgodzie powtórz wywołanie z tymi samymi argumentami i confirm_capped: true.',
  'runStart.confirm.protected': 'środowisko {environment} jest chronione',
  'runStart.confirm.clamped':
    'profil przekracza limit środowiska {environment} i zostanie przycięty',
  'runStart.confirm.both':
    'środowisko {environment} jest chronione, a profil przekracza jego limit i zostanie przycięty',
  'migrateDocs.capabilityAdvice':
    ' Do tego czasu scenariusz z tych flowów czyta wersję dokumentacji, do której są przypięte.',
  'migrateDocs.nothing':
    'Żaden flow nie jest na starszej wersji dokumentacji: każdy przypięty flow jest na {target}. Nie ma czego migrować.',
  'migrateDocs.flows': {
    one: '{count} flow',
    few: '{count} flowy',
    many: '{count} flowów',
    other: '{count} flowu',
  },
  'migrateDocs.steps': {
    one: '{count} krok',
    few: '{count} kroki',
    many: '{count} kroków',
    other: '{count} kroku',
  },
  'migrateDocs.counts':
    '{steps}: {matched} zgodnych, {changed} zmienionych, {unmatched} bez odpowiednika',
  'migrateDocs.more': '… i {count} innych',
  'migrateDocs.preview.head': 'Podgląd, nic nie zapisano: {flows} → wersja dokumentacji {target}',
  'migrateDocs.preview.next':
    'Pokaż to użytkownikowi i zapytaj, które różnice wartości przyjąć. Potem wywołaj flows_migrate_docs bez preview, z tymi samymi flow_ids i adopt_value_ids (albo adopt_values: "all"): zwróci kartę zgody.',
  'migrateDocs.preview.allowUnmatched':
    'Flow oznaczony „przejdzie tylko z allow_unmatched” zostaje na miejscu, chyba że użytkownik zgodzi się na allow_unmatched: true; jego kroki bez endpointu zachowują żądanie, ale tracą powiązanie z dokumentacją.',
  'migrateDocs.preview.nothing': 'Żaden flow nie może przejść: omów odmowy z użytkownikiem.',
  'migrateDocs.needsAllowUnmatched': 'przejdzie tylko z allow_unmatched: krok stracił endpoint',
  'migrateDocs.refused': 'odmowa: {reason}',
  'migrateDocs.refusal.flow_not_found': 'nie ma takiego flowu w projekcie',
  'migrateDocs.refusal.not_pinned': 'flow nie jest przypięty do wersji; już czyta bieżącą',
  'migrateDocs.refusal.already_on_target': 'już jest na wersji docelowej',
  'migrateDocs.refusal.source_spec_missing':
    'wersja dokumentacji, do której jest przypięty, już nie istnieje',
  'migrateDocs.refusal.unmatched_steps':
    'kroki straciły endpoint w wersji docelowej (bez allow_unmatched)',
  'migrateDocs.refusal.lint_failed': 'po przeniesieniu flow nie przeszedłby kontroli LoadCraft',
  'migrateDocs.refusal.unknown': 'nie zmigrowany',
  'migrateDocs.unmatched': 'krok',
  'migrateDocs.reason.endpoint_removed': 'endpoint usunięty',
  'migrateDocs.reason.unbound': 'bez endpointu, zostaje bez zmian',
  'migrateDocs.value': 'wartość',
  'migrateDocs.value.removed': '(usunięta)',
  'migrateDocs.value.id': 'id',
  'migrateDocs.value.notAdoptable':
    'tylko do wiadomości: pole wymagane, dla którego wersja docelowa nie podaje wartości',
  'migrateDocs.kind.example_changed': 'zmieniony przykład',
  'migrateDocs.kind.example_removed': 'usunięty przykład',
  'migrateDocs.kind.not_in_enum': 'niedozwolona w wersji docelowej',
  'migrateDocs.kind.param_removed': 'usunięty parametr',
  'migrateDocs.kind.required_added': 'nowe pole wymagane',
  'migrateDocs.check':
    'kontrola  {step} · {selector} (zapisuje {variable}) nie pasuje już do odpowiedzi z wersji docelowej',
  'migrateDocs.dropped': 'endpointy usunięte z flowu: {endpoints}',
  'migrateDocs.staleIf': 'scenariusze, które staną się nieaktualne: {names}',
  'migrateDocs.stale': 'scenariusze teraz nieaktualne: {names}',
  'migrateDocs.card.renewed.missing':
    'Nic nie zmigrowano: dla tego potwierdzenia nie ma karty. To jest nowa karta.',
  'migrateDocs.card.renewed.expired':
    'Nic nie zmigrowano: karta wygasła (30 minut). To jest nowa karta.',
  'migrateDocs.card.renewed.token':
    'Nic nie zmigrowano: token nie należy do bieżącej karty. To jest nowa karta.',
  'migrateDocs.card.renewed.changed':
    'Nic nie zmigrowano: potwierdzenie niosło inne argumenty niż jego karta. To jest nowa karta dla nich.',
  'migrateDocs.migrated.notRefreshed':
    'Po migracji nie udało się odczytać listy flowów; ostrzeżenie o starszej dokumentacji wynika z wyników powyżej.',
  'migrateDocs.card.title': {
    one: 'Migracja {count} flowu na bieżącą wersję dokumentacji',
    few: 'Migracja {count} flowów na bieżącą wersję dokumentacji',
    many: 'Migracja {count} flowów na bieżącą wersję dokumentacji',
    other: 'Migracja {count} flowu na bieżącą wersję dokumentacji',
  },
  'migrateDocs.card.flows': 'Flowy',
  'migrateDocs.card.target': 'Wersja docelowa',
  'migrateDocs.card.adopt': 'Przyjęcie przykładów',
  'migrateDocs.card.adopt.none': 'żadne',
  'migrateDocs.card.adopt.all': 'wszystkie',
  'migrateDocs.card.picked': {
    one: '{count} wybrana',
    few: '{count} wybrane',
    many: '{count} wybranych',
    other: '{count} wybranej',
  },
  'migrateDocs.card.allowUnmatched': 'KROKI BEZ ODPOWIEDNIKA',
  'migrateDocs.card.yes': 'TAK',
  'migrateDocs.card.no': 'nie',
  'migrateDocs.card.docs': 'Bieżąca wersja',
  'migrateDocs.card.outdated': 'Flowy na starszej wersji',
  'migrateDocs.card.effect':
    'Nic jeszcze nie zmigrowano; zapytaj użytkownika. Każdy flow zachowa id i dostanie nową wersję; jego scenariusze zostaną podpięte i staną się nieaktualne.',
  'migrateDocs.card.next': 'Dopiero po „tak”: to samo wywołanie z confirm: "{token}".',
  'migrateDocs.migrated.head':
    'Zmigrowano {count} z {flows} na wersję dokumentacji {target}: {matched} zgodnych, {changed} zmienionych, {unmatched} bez odpowiednika',
  'migrateDocs.adopted': {
    one: 'przyjęto {count} wartość',
    few: 'przyjęto {count} wartości',
    many: 'przyjęto {count} wartości',
    other: 'przyjęto {count} wartości',
  },
  'migrateDocs.undo': 'cofnięcie: przywróć v{version}',
  'migrateDocs.migrated.undo':
    'Migrację cofa przywrócenie wersji podanej przy „cofnięcie” w historii flowu w LoadCraft; przywrócenie przepina też dokumentację z powrotem.',
  'migrateDocs.migrated.rebuild':
    'Nieaktualne scenariusze dalej uruchamiają kod zbudowany ze starszej dokumentacji: zbuduj je ponownie przez scenario_generate (ta sama nazwa i flowy) przed testem.',
  'migrateDocs.migrated.refused':
    'Powiedz użytkownikowi, które flowy zostały i dlaczego; powtórz tylko to, na co pozwala odmowa (np. allow_unmatched: true po „tak”).',
  'error.flows_migration_stale.message':
    'Nic nie zmigrowano: {flows} zmienił się od podglądu albo karty, które widział użytkownik.',
  'error.flows_migration_stale.hint':
    'Wywołaj ponownie flows_migrate_docs z preview: true, pokaż nowy podgląd i zapytaj jeszcze raz, zanim potwierdzisz.',
  'error.flows_migration_conflict.message':
    'Nic nie zmigrowano: {flows} zmienił się w trakcie zapisu w LoadCraft, więc cała migracja została wycofana.',
  'error.flows_migration_conflict.hint':
    'Wywołaj ponownie flows_migrate_docs z preview: true, pokaż nowy podgląd i zapytaj jeszcze raz, zanim potwierdzisz.',
  'error.flows_migration_values_unknown.message':
    'Nic nie zmigrowano: te identyfikatory wartości nie są przyjmowalnymi różnicami tych flowów: {ids}.',
  'error.flows_migration_values_unknown.hint':
    'Weź identyfikatory z nowego wywołania flows_migrate_docs z preview: true (albo użyj adopt_values: "all") i zapytaj jeszcze raz.',
  'error.flows_migration_target_unknown.message':
    'Projekt nie ma wersji dokumentacji {target}; nic nie wysłano.',
  'error.flows_migration_target_unknown.hint':
    'Pomiń target_spec_id, żeby przenieść flowy na bieżącą wersję.',
  'oldDocs.list': {
    one: '{count} flow na starszej wersji dokumentacji: {names}',
    few: '{count} flowy na starszej wersji dokumentacji: {names}',
    many: '{count} flowów na starszej wersji dokumentacji: {names}',
    other: '{count} flowu na starszej wersji dokumentacji: {names}',
  },
  'oldDocs.scenario': {
    one: '{names} jest na starszej wersji dokumentacji: scenariusz przeczyta tę wersję, nie bieżącą',
    few: '{names} są na starszej wersji dokumentacji: scenariusze przeczytają tę wersję, nie bieżącą',
    many: '{names} są na starszej wersji dokumentacji: scenariusze przeczytają tę wersję, nie bieżącą',
    other:
      '{names} są na starszej wersji dokumentacji: scenariusze przeczytają tę wersję, nie bieżącą',
  },
  'oldDocs.more': '{names} i {count} innych',
  'needsInput.list': {
    one: '{count} flow z otwartymi pytaniami generatora{definite}: {names}',
    few: '{count} flowy z otwartymi pytaniami generatora{definite}: {names}',
    many: '{count} flowów z otwartymi pytaniami generatora{definite}: {names}',
    other: '{count} flowu z otwartymi pytaniami generatora{definite}: {names}',
  },
  'needsInput.scenario': {
    one: '{names} ma otwarte pytania generatora{definite}; scenariusz powstaje z flowu takiego, jaki jest',
    few: '{names} mają otwarte pytania generatora{definite}; scenariusze powstają z flowów takich, jakie są',
    many: '{names} mają otwarte pytania generatora{definite}; scenariusze powstają z flowów takich, jakie są',
    other:
      '{names} mają otwarte pytania generatora{definite}; scenariusze powstają z flowów takich, jakie są',
  },
  'needsInput.run': {
    one: '{count} flow projektu ma otwarte pytania generatora{definite}: wyniki mogą pokazać jego błędy',
    few: '{count} flowy projektu mają otwarte pytania generatora{definite}: wyniki mogą pokazać ich błędy',
    many: '{count} flowów projektu ma otwarte pytania generatora{definite}: wyniki mogą pokazać ich błędy',
    other:
      '{count} flowu projektu ma otwarte pytania generatora{definite}: wyniki mogą pokazać ich błędy',
  },
  'needsInput.definite': {
    one: ' ({count} pewne: jego kroki dostaną 401)',
    few: ' ({count} pewne: ich kroki dostaną 401)',
    many: ' ({count} pewnych: ich kroki dostaną 401)',
    other: ' ({count} pewnego: ich kroki dostaną 401)',
  },
  'needsInput.next':
    '→ flows_get pokaże pytania; uzupełnij dane albo klucz środowiska (project_save_env) albo przebuduj flow; nic nie jest blokowane',
  'oldDocs.next':
    '→ flows_migrate_docs preview: true pokaże, co przejdzie na bieżącą wersję; sama migracja pyta o zgodę',
  'updateOpenapi.operations': {
    one: '{count} operacja',
    few: '{count} operacje',
    many: '{count} operacji',
    other: '{count} operacji',
  },
  'updateOpenapi.version': 'wersja {version}',
  'updateOpenapi.current': 'nowa bieżąca wersja dokumentacji',
  'updateOpenapi.currentWith': 'nowa bieżąca wersja dokumentacji · {operations}',
  'updateOpenapi.previous':
    'poprzednia ({previous}) zostaje w historii · flowów do migracji: {flows}',
  'updateOpenapi.previousUnnamed': 'poprzednia zostaje w historii · flowów do migracji: {flows}',
  'updateOpenapi.flows': '{count}',
  'updateOpenapi.flows.atLeast': 'co najmniej {count}',
  'updateOpenapi.unchanged': 'dokumentacja bez zmian, nic nie wysłano',
  'updateOpenapi.unchangedWith': 'dokumentacja bez zmian, nic nie wysłano · {operations}',
  'updateOpenapi.sameAs': 'plik ma tę samą treść co bieżąca wersja ({previous})',
  'updateOpenapi.note.profile_and_test_types_not_refreshed':
    'profil i typy testów nie są odświeżane automatycznie: powstały z poprzedniej wersji',
  'error.file_not_in_worktree.message':
    'Plik nie leży ani w katalogu projektu, ani w innym drzewie roboczym tego repozytorium.',
  'error.file_not_in_worktree.hint':
    'Podaj plik w katalogu projektu albo w drzewie roboczym z listy „git worktree list”.',
  'error.openapi_not_json.message': 'Plik {file} nie jest poprawnym JSON-em.',
  'error.openapi_not_openapi.message':
    'Plik {file} to JSON, ale nie dokument OpenAPI: brak wersji „openapi” albo „swagger” i brak „paths”.',
  'error.openapi_not_openapi.hint':
    'Sprawdź ścieżkę: wyślij dokument OpenAPI tego API (openapi.json), nie inny plik JSON. Nic nie wysłano.',
  'error.openapi_not_json.hint':
    'Wyślij dokumentację jako plik OpenAPI .json (dokument YAML najpierw przekonwertuj).',
  'error.document_path_excluded.message':
    '{file} leży w katalogu ukrytym, w node_modules albo jest plikiem ukrytym; dokumentacji stamtąd się nie czyta.',
  'error.document_path_excluded.hint':
    'Wskaż dokument API w projekcie (np. openapi.json), nie plik z katalogu ukrytego ani z zależności. Nic nie wysłano.',
  'error.document_path_ignored.message':
    '{file} jest ignorowany przez git; dokumentacji nie czyta się ze ścieżek ignorowanych.',
  'error.document_path_ignored.hint':
    'Wskaż dokument API z repozytorium, nie wynik budowania ani plik lokalny. Nic nie wysłano.',
  'error.asyncapi_not_asyncapi.message':
    '{file} to JSON, ale nie dokument AsyncAPI: brak wersji "asyncapi" albo "info" i "channels".',
  'error.asyncapi_not_asyncapi.hint':
    'Sprawdź ścieżkę: wyślij dokument AsyncAPI tego API, nie inny plik JSON. Nic nie wysłano.',
  'status.preflight.head':
    'Sprawdzenie przed testem, nic nie uruchomiono: {target} na {environment}',
  'status.preflight.protected': 'chronione',
  'status.preflight.limit': 'limit {caps}',
  'status.preflight.noLimit': 'bez limitu',
  'status.preflight.load': '{label} {requested}',
  'status.preflight.loadClamped': '{label} {requested} → {effective} (przycięte)',
  'status.preflight.consent': 'przed prawdziwym testem potrzebna zgoda',
  'status.preflight.noConsent': 'zgoda niepotrzebna',
  'status.preflight.dataReady': 'dane gotowe',
  'status.preflight.dataShort': 'za mało danych: {rows}',
  'status.preflight.planned': 'plan {time}',
  'status.preflight.free': 'środowisko wolne',
  'status.preflight.busy': 'środowisko zajęte ({handle})',
  'status.operation.head': 'Operacja {handle}',
  'status.operation.since': 'od startu {time}',
  'status.operation.phase.pending': 'czeka na start',
  'status.operation.phase.building': 'budowanie',
  'status.operation.phase.running': 'trwa',
  'status.operation.phase.completed': 'zakończona',
  'status.operation.phase.failed': 'nieudana',
  'status.operation.phase.cancelled': 'zatrzymana',
  'status.operation.phase.abandoned': 'bez śladu życia',
  'runStart.progress.seconds': '{n} s',
  'runStart.done.build': 'budowanie ✓ {time}',
  'runStart.done.clamped': 'przycięty do {to}: ten wynik nic nie mówi o pełnym obciążeniu',
  'runStart.done.completed': 'test zakończony · wykonanie {handle} · dalej: results_get_report',
  'runStart.done.cancelled':
    'test przerwany przed końcem · wykonanie {handle} · dalej: results_get_report',
  'runStart.joined':
    'Test {target} na środowisku {environment} już trwa ({handle}); drugi test nie został uruchomiony, to wywołanie śledzi trwający.',
  'error.run_already_running.message':
    'Test {target} na środowisku {environment} już trwa ({handle}); drugie obciążenie tego samego środowiska nie zostało uruchomione.',
  'error.run_already_running.hint':
    'Wywołaj process_wait z {handle}, żeby go śledzić, albo uruchom nowy test po jego zakończeniu.',
  'error.run_environment_busy.message':
    'Na środowisku {environment} już trwa inny test ({handle}, {link}); drugie obciążenie nie zostało uruchomione.',
  'error.run_environment_busy.hint':
    'Poczekaj na jego koniec (śledź go na stronie na żywo) i wywołaj run_start jeszcze raz albo zapytaj użytkownika, czy go zatrzymać.',
  'error.run_build_elsewhere.message':
    'Trwa budowanie innego testu w tym projekcie ({handle}, {link}); jego środowisko nie jest jeszcze znane, więc może to być {environment}. Drugie obciążenie nie zostało uruchomione.',
  'error.run_build_elsewhere.hint':
    'Poczekaj na koniec budowania (śledź je na stronie na żywo) i wywołaj run_start jeszcze raz; zapytaj użytkownika, jeśli to nie jego test.',
  'error.run_occupancy_unknown.message':
    'Nie udało się ustalić, czy środowisko jest wolne: lista testów tego projektu jest nieczytelna albo niepełna ({reason}). Obciążenie nie zostało uruchomione.',
  'error.run_occupancy_unknown.hint':
    'Spróbuj za chwilę; jeśli się powtarza, uruchom /loadcraft:doctor. Gdy powodem jest page_too_recent, ostatnie 100 testów nie sięga dość daleko wstecz, żeby wykluczyć trwający test: sprawdź process_get_status albo poczekaj na koniec testów. Nie zakładaj, że środowisko jest wolne; wywołaj run_start jeszcze raz dopiero potem.',
  'runStart.failed.noDetail': 'LoadCraft nie podał przyczyny',
  'error.run_failed.message': 'Test nie powiódł się w LoadCraft: {detail}',
  'error.run_failed.hint':
    'Usuń przyczynę z komunikatu i wywołaj run_start jeszcze raz; wykonanie {handle} zostaje w LoadCraft razem z logiem.',
  'error.run_abandoned.message': 'Test porzucony po stronie LoadCraft (restart?).',
  'error.run_abandoned.hint':
    'Sprawdź stan przez process_get_status i wywołaj run_start jeszcze raz; wykonanie {handle} się nie zakończy.',
  'describe.plan': 'plan {plan}',
  'describe.paths': {
    one: '{count} ścieżka',
    few: '{count} ścieżki',
    many: '{count} ścieżek',
    other: '{count} ścieżki',
  },
  'describe.sharedSignIn.all': 'logowanie wspólne dla wszystkich',
  'describe.sharedSignIn.some': 'logowanie wspólne dla: {names}',
  'describe.dependsOnPrior': 'po poprzedniej ścieżce',
  'describe.ownIdentity': 'własne konto, bez wspólnego logowania: {names}',
  'describe.more': '+{count}',
  'describe.started.single':
    'Jedna ścieżka: LoadCraft nie pyta o podział i już przechodzi aplikację.',
  'describe.started.approved': 'Ścieżki zatwierdzono już w LoadCraft; przejście trwa.',
  'describe.next': 'dalej: flows_record_journeys z planem {plan}',
  'describe.progress.queued': 'LoadCraft uruchamia przeglądarkę…',
  'describe.progress.planning': 'LoadCraft rozpisuje opis na ścieżki…',
  'describe.state.awaiting': 'czeka na zatwierdzenie ścieżek',
  'describe.state.planning': 'wciąż planuje',
  'describe.state.other': 'ma stan {status}',
  'describe.failed.noDetail': 'LoadCraft nie podał przyczyny',
  'describe.refusal.unauthorized': 'authentication_required: kanał nie przyjął tokenu API',
  'describe.refusal.not_found':
    'run_not_found: przebieg nieznany albo uruchomiony przez kogoś innego',
  'describe.refusal.forbidden':
    'HTTP 403: origin_not_allowed, project_access_denied, authentication_required albo run_not_found; LoadCraft nie mówi, który',
  'describe.unreachable.private': 'to adres prywatny albo lokalny',
  'describe.unreachable.blocked': 'ostatni test połączenia środowiska został zablokowany',
  'describe.unreachable.link_local':
    'to adres link-local (zakres metadanych chmury), którego LoadCraft nigdy nie otwiera',
  'describe.unreachable.blocked_local':
    'backend LoadCraft na tej maszynie zablokował go w ostatnim teście połączenia; jego administrator może dopuścić adresy prywatne w ustawieniach backendu',
  'error.environment_without_frontend.message':
    'Środowisko {environment} nie ma adresu frontendu, a przeglądarka LoadCraft otwiera aplikację właśnie tam.',
  'error.environment_without_frontend.hint':
    'Zapytaj użytkownika o adres frontendu {environment}, dodaj go do środowiska w LoadCraft i wywołaj flows_describe_journeys ponownie; albo nagraj ścieżki w przeglądarce i użyj flows_import_har.',
  'error.target_unreachable.message': 'Przeglądarka LoadCraft nie osiągnie {url}: {reason}.',
  'error.target_unreachable.hint':
    'Użyj nagrania HAR: użytkownik przeklika aplikację we własnej przeglądarce, zapisze plik HAR, a ty przekażesz go do flows_import_har.',
  'error.describe_run_failed.message':
    'LoadCraft nie rozpisał ścieżek (przebieg {status}): {detail}',
  'error.describe_run_failed.hint':
    'Sprawdź adres, opis i konto (treść błędu jest w logu wtyczki, tu jej nie ma) i wywołaj flows_describe_journeys ponownie; nic nie zostało zapisane.',
  'error.plan_not_received.message':
    'Plan ścieżek nie przyszedł w ciągu {seconds} s; przebieg {state}.',
  'error.plan_not_received.hint':
    'Wywołaj flows_describe_journeys ponownie z tymi samymi argumentami: kontynuuje ten przebieg i nie uruchamia drugiego. Przebieg w LoadCraft: {link}',
  'error.describe_channel_refused.message':
    'LoadCraft odrzucił połączenie z kanałem przebiegu ({reason}).',
  'error.describe_channel_refused.hint':
    'Przebieg czeka w LoadCraft ({link}). LOADCRAFT_API_URL musi być adresem, pod którym LoadCraft jest osiągalny, a proxy przed nim musi przekazywać nagłówek Host; uruchom /loadcraft:doctor.',
  'error.describe_channel_unavailable.message':
    'Z tej sieci nie da się otworzyć kanału WebSocket do LoadCraft, a plan ścieżek i jego zatwierdzenie idą tylko nim.',
  'error.describe_channel_unavailable.hint':
    'Przebieg czeka w LoadCraft, gdzie użytkownik może zatwierdzić ścieżki ({link}); albo nagraj ścieżki w przeglądarce i użyj flows_import_har.',
  'record.browser': 'Playwright · Chromium · {host}',
  'record.browser.noHost': 'Playwright · Chromium',
  'record.takeOver': 'tam przejmiesz sterowanie, gdyby agent utknął',
  'record.path.saved': 'flow gotowy ✓ · {steps}',
  'record.path.partial': 'częściowy · {reason}',
  'record.path.failed': 'nieudany {attempts}',
  'record.path.failedReason': 'nieudany {attempts} · {reason}',
  'record.path.failedPlain': 'nieudany',
  'record.path.failedPlainReason': 'nieudany · {reason}',
  'record.path.notDriven': 'nieprzejechany: ścieżka, którą kontynuuje, nie doszła do celu',
  'record.path.notDrivenReason': 'nieprzejechany · {reason}',
  'record.path.stopped': 'zatrzymany',
  'record.path.stoppedReason': 'zatrzymany · {reason}',
  'record.path.unfinished': 'nieprzejechany: przebieg skończył się wcześniej',
  'record.attempts': {
    one: 'po {count} próbie',
    few: 'po {count} próbach',
    many: 'po {count} próbach',
    other: 'po {count} próby',
  },
  'record.obstacle':
    '⚠ {name}: {obstacles} — test obciążeniowy nie przejdzie tego kroku; wyłącz go na środowisku testowym',
  'record.obstacle.captcha': 'CAPTCHA',
  'record.obstacle.second_factor': 'logowanie dwuskładnikowe',
  'record.obstacle.one_time_code': 'kod jednorazowy',
  'record.obstacle.payment': 'płatność z 3-D Secure',
  'record.partialHelp':
    'Zanim ponowisz częściową ścieżkę, otwórz podgląd na żywo: agent prosi tam o pomoc przy przeszkodzie tylko wtedy, gdy ktoś patrzy.',
  'record.ended': 'przebieg zakończony ({status}): {detail}',
  'record.saved': {
    one: '{count} flow zapisany',
    few: '{count} flowy zapisane',
    many: '{count} flowów zapisanych',
    other: '{count} flowu zapisanego',
  },
  'record.savedNone': 'żaden flow nie został zapisany',
  'record.progress.step': '{step}/{steps} · {label}…',
  'record.progress.label': '{label}…',
  'record.progress.driving': 'jedzie…',
  'record.progress.queued': 'czeka…',
  'record.progress.building': 'buduje flow…',
  'record.progress.built': 'zbudowany · zapis na końcu',
  'record.progress.retrying': 'próba {attempt} nieudana, ponawia…',
  'record.progress.failed': 'nieudany',
  'record.progress.stopped': 'zatrzymany',
  'record.progress.help': 'czeka na pomoc: {reason}',
  'record.progress.setup': 'logowanie wspólne…',
  'record.progress.awaiting': 'LoadCraft wznawia przebieg po zatwierdzeniu ścieżek…',
  'record.progress.start': 'LoadCraft zaczyna przechodzić ścieżki…',
  'record.progress.stopping':
    'LoadCraft zatrzymuje przejście: bieżąca ścieżka się kończy, zbudowane ścieżki zostaną zapisane.',
  'record.help.reason.captcha': 'CAPTCHA',
  'record.help.reason.second_factor': 'kod jednorazowy',
  'record.help.reason.unknown_blocker': 'nieznana przeszkoda',
  'record.help.ask': 'Agent LoadCraft prosi o pomoc na ścieżce {name}: {reason}.',
  'record.help.says': 'Agent pisze: „{text}”',
  'record.help.how':
    'Przeglądarkę może przejąć tylko twórca przebiegu, w aplikacji LoadCraft: otwórz podgląd na żywo i przejmij tam sterowanie.',
  'record.approvalPending':
    'Plan {plan} czeka na zatwierdzenie; stąd nic nie zostało zatwierdzone.',
  'record.approvalPending.paths': 'Ścieżki planu: {names}.',
  'record.approvalPending.next':
    'Pokaż użytkownikowi te ścieżki; gdy je zatwierdzi, wywołaj flows_record_journeys z planem „{plan}”. Może je też zatwierdzić w aplikacji LoadCraft (link niżej); flows_record_journeys z tym samym planem śledzi wtedy przejazd.',
  'record.unknownPaths.more': '{names} i {count} więcej',
  'error.record_approval_denied.message': 'LoadCraft nie przyjął zatwierdzenia ścieżek ({code}).',
  'error.record_approval_denied.hint':
    'Ścieżki zatwierdza tylko twórca przebiegu z rolą editor w projekcie: poproś właściciela projektu o rolę albo zatwierdź je w aplikacji ({link}).',
  'error.record_unknown_paths.message': 'Plan {plan} nie ma ścieżki o nazwie {names}.',
  'error.record_unknown_paths.hint':
    'Użyj nazw z planu, tak jak pokazał je flows_describe_journeys ({available}), albo paths: "all".',
  'error.plan_not_ready.message':
    'Plan {plan} nie jest gotowy: LoadCraft wciąż rozpisuje opis na ścieżki.',
  'error.plan_not_ready.hint':
    'Wywołaj process_wait z operation „{operation}”; gdy pokaże plan, wywołaj flows_record_journeys z jego uchwytem.',
  'error.record_run_failed.message':
    'Przejście ścieżek skończyło się bez zapisanego flow (przebieg {status}): {detail}',
  'error.record_run_failed.hint':
    'Nic nie zapisano. Treść błędu jest w logu wtyczki, tu jej nie ma: sprawdź adres, opis i konto, potem zacznij od nowa od flows_describe_journeys albo nagraj ścieżki w przeglądarce i użyj flows_import_har.',
  'error.record_stop_refused.message': 'LoadCraft nie zatrzymał przejścia ({code}).',
  'error.record_stop_refused.hint':
    'Użytkownik steruje teraz przeglądarką w aplikacji: niech tam zatrzyma przejście albo najpierw odda przeglądarkę ({link}).',
  'error.report_not_archived.message':
    'LoadCraft nie przechowuje raportu Gatlinga przebiegu {run}.',
  'error.report_not_archived.hint':
    'Raport archiwizuje się, gdy przebieg się kończy; przebieg, który się nie uruchomił, go nie ma.',
  'error.not_a_production_run.message': 'Przebieg {run} nie odtwarzał ruchu produkcyjnego.',
  'error.not_a_production_run.hint': 'results_get_report opisze każdy przebieg.',
  'error.no_baseline.message':
    'Dla scenariusza i obciążenia przebiegu {run} nie przypięto linii bazowej.',
  'error.no_baseline.hint': 'Podaj zamiast tego compare_to z uchwytem przebiegu.',
  'error.report_exists.message': 'Raport przebiegu {run} został już wyeksportowany: {path}.',
  'error.report_exists.hint': 'Podaj overwrite: true tylko wtedy, gdy użytkownik chce go zastąpić.',
};
