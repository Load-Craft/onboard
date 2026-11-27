// Texts of the tools of module scenario, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { scenarioEn } from './scenario.en.js';

export const scenarioPl: { readonly [K in keyof typeof scenarioEn]: Entry } = {
  'scenario_set_composition_type.done': '"{name}" uruchamia teraz {type} (poprzednio: {previous}).',
  'scenario_set_composition_type.done_new': '"{name}" uruchamia teraz {type}.',
  'scenario_set_composition_type.unchanged':
    '"{name}" już uruchamia ten {type}; nic nie zmieniono.',
  'scenario_set_composition_type.data_ok':
    'Każdy zbiór danych ma już tyle wierszy, ile wymaga nowy typ.',
  'scenario_set_composition_type.grow':
    'Dane do powiększenia: {scenario}: {dataset} ma {rows} wierszy, potrzeba {required}.',
  'scenario_set_composition_type.basis_peak':
    'zbiór {strategy} jest liczony z podwojonego szczytu równoległych sesji, nie z liczby użytkowników',
  'scenario_set_composition_type.basis_rate':
    'zbiór {strategy} jest liczony z tempa przybywania razy czas trwania razy zapas bezpieczeństwa, nie z liczby użytkowników',
  'scenario_set_composition_type.refusal': 'LoadCraft nie wyliczył dla niego wierszy: {reason}',
  'scenario_set_composition_type.no_previous':
    'Kompozycja nie miała wcześniej rodzaju testu, więc tej zmiany nie da się cofnąć z dziennika.',
  'scenario_set_composition_type.unknown_previous':
    'Poprzedni rodzaj testu nie jest jednym z tych, które to narzędzie ustawia, więc tej zmiany nie da się cofnąć z dziennika.',
  'error.scenario_composition_spec_refused.message':
    'LoadCraft odrzucił parametry rodzaju testu: {detail}',
  'error.scenario_composition_spec_refused.hint':
    'Nic nie zmieniono. Każdy rodzaj wymaga target_users i duration_seconds (dodatnie liczby całkowite); opcjonalne dla wszystkich: ramp_up_seconds, think_time_ms, max_duration_seconds. Wg rodzaju: load_test ramp_down_seconds; stress_test stress_multiplier (powyżej 1); spike_test spike_users (wymagane) i spike_duration_seconds; breakpoint_test step_users, step_duration_seconds, max_steps; capacity_test target_rps. Inne pola są odrzucane. Popraw parametry i wywołaj ponownie.',
  'scenario_set_composition_type.more': 'pokazano pierwsze {shown} z {total} zbiorów danych',
  'scenario_update_pins.done': {
    one: '{count} członek kompozycji "{name}" przepięty na bieżącą wersję swojego scenariusza:',
    few: '{count} członkowie kompozycji "{name}" przepięci na bieżące wersje swoich scenariuszy:',
    many: '{count} członków kompozycji "{name}" przepiętych na bieżące wersje swoich scenariuszy:',
    other: '{count} członka kompozycji "{name}" przepiętych na bieżące wersje swoich scenariuszy:',
  },
  'scenario_update_pins.member': '- {scenario}: {from} -> {to}',
  'scenario_update_pins.more': 'pokazano pierwszych {shown} z {total} członków',
  'scenario_update_pins.still': '{count} członków nadal się rozjeżdża.',
  'scenario_update_pins.unpinned': {
    one: '{count} członek nie jest przypięty do żadnej wersji: sam podąża za bieżącą wersją swojego scenariusza.',
    few: '{count} członkowie nie są przypięci do żadnej wersji: sami podążają za bieżącymi wersjami swoich scenariuszy.',
    many: '{count} członków nie jest przypiętych do żadnej wersji: sami podążają za bieżącymi wersjami swoich scenariuszy.',
    other:
      '{count} członka nie jest przypiętych do żadnej wersji: sami podążają za bieżącymi wersjami swoich scenariuszy.',
  },
  'scenario_update_pins.same_content': {
    one: '{count} członek jest przypięty do starszego numeru wersji, ale jego treść jest bieżąca: rozjazd wynika z treści, nie z numeru.',
    few: '{count} członkowie są przypięci do starszych numerów wersji, ale ich treść jest bieżąca: rozjazd wynika z treści, nie z numerów.',
    many: '{count} członków jest przypiętych do starszych numerów wersji, ale ich treść jest bieżąca: rozjazd wynika z treści, nie z numerów.',
    other:
      '{count} członka jest przypiętych do starszych numerów wersji, ale ich treść jest bieżąca: rozjazd wynika z treści, nie z numerów.',
  },
  'scenario_update_pins.none':
    'Żaden członek kompozycji "{name}" się nie rozjechał; nic nie zmieniono.',
  'scenario_restore_version.done':
    '{name}: v{version} przywrócona jako v{new} (v{previous} była bieżąca); self-check wyczyszczony.',
  'scenario_restore_version.nothing_restored': '(nic nie przywrócono)',
  'scenario_restore_version.unchanged':
    '{name}: v{version} jest już bieżącą wersją; nic nie zmieniono.',
  'scenario.check_state.none': 'nigdy nie uruchomiony',
  'scenario.check_state.stale': '{status} na v{checked}, scenariusz ma już v{current}',
  'scenario.check_state.pending': 'w kolejce',
  'scenario.check_state.running': 'trwa',
  'scenario.check_state.passed': 'zaliczony',
  'scenario.check_state.failed': 'niezaliczony',
  'scenario.check_state.target_unreachable': 'cel był nieosiągalny',
  'scenario.check_state.waiting_for_data': 'czeka na dane',
  'scenario.check_state.not_admitted': 'niedopuszczony',
  'scenario.check_state.skipped_protected_environment': 'pominięty, środowisko jest chronione',
  'scenario.check_state.disabled': 'wyłączony',
  'scenario.check_state.interrupted': 'przerwany',
  'scenario.check_state.goal_step_missing': 'brakuje kroku docelowego',
  'scenario.check_state.repairing': 'trwa naprawa',
  'scenario.check_state.passed_after_repair': 'zaliczony po naprawie',
  'scenario_list.header': {
    one: '{count} scenariusz:',
    few: '{count} scenariusze:',
    many: '{count} scenariuszy:',
    other: '{count} scenariusza:',
  },
  'scenario_list.empty': 'Ten projekt nie ma jeszcze scenariuszy.',
  'scenario_list.from_flow': 'z flow {flow} v{version}',
  'scenario_list.older_generator': 'zbudowany starszym generatorem, przebuduj go',
  'scenario_list.no_flow': 'bez flow źródłowego',
  'scenario_list.check': 'self-check: {state}',
  'scenario_list.more': 'pokazano pierwsze {shown} z {total} scenariuszy',
  'scenario_get.none': 'brak',
  'scenario_get.inactive': 'nieaktywny',
  'scenario_get.from_flow': 'z flow {flow} v{version}',
  'scenario_get.no_flow': 'bez flow źródłowego',
  'scenario_get.older_generator': 'zbudowany starszym generatorem',
  'scenario_get.check': 'self-check: {state}',
  'scenario_get.check_old': 'self-check: {state} na v{checked}, scenariusz ma już v{current}',
  'scenario_get.check.none': 'self-check: nigdy nie uruchomiony',
  'scenario_get.failure': 'błąd w kroku {where}: {message}',
  'scenario_get.missing_slots': 'sloty bez danych: {slots}',
  'scenario_get.repairs': {
    one: '{count} automatyczna naprawa',
    few: '{count} automatyczne naprawy',
    many: '{count} automatycznych napraw',
    other: '{count} automatycznej naprawy',
  },
  'scenario_get.slots': {
    one: '{count} slot danych:',
    few: '{count} sloty danych:',
    many: '{count} slotów danych:',
    other: '{count} slotu danych:',
  },
  'scenario_get.no_slots': 'brak slotów danych',
  'scenario_get.binding.bound': 'powiązany',
  'scenario_get.binding.stale': 'powiązanie nieaktualne',
  'scenario_get.binding.unbound': 'niepowiązany',
  'scenario_get.contract': 'kontrakt zmiennych:',
  'scenario_get.contract.inputs': 'wymaga: {names}',
  'scenario_get.contract.exports': 'udostępnia: {names}',
  'scenario_get.contract.session': 'zmienne sesji: {names}',
  'scenario_get.contract_unavailable': 'kontrakt zmiennych: niedostępny',
  'scenario_get.drift': 'dryf: {score} (0 świeży, 1 nieaktualny), sprawdzono {checked}',
  'scenario_get.drift.none': 'dryf: jeszcze nie sprawdzano',
  'scenario_get.drift.unavailable': 'dryf: niedostępny',
  'scenario_get.artifact': 'zapisany artefakt (sekrety zamaskowane):',
  'scenario_get.artifact_cut': '… artefakt ucięty',
  'scenario_get.artifact_hidden':
    'zapisany artefakt ukryty: jego formatu nie da się zamaskować ({bytes} bajtów)',
  'scenario_get.artifact_none': 'brak zapisanego artefaktu',
  'scenario_get_versions.header': {
    one: '{count} wersja scenariusza {id}, od najnowszej:',
    few: '{count} wersje scenariusza {id}, od najnowszej:',
    many: '{count} wersji scenariusza {id}, od najnowszej:',
    other: '{count} wersji scenariusza {id}, od najnowszej:',
  },
  'scenario_get_versions.one': 'Scenariusz {id}: {line}',
  'scenario_get_versions.empty': 'Ten scenariusz nie ma zapisanych wersji.',
  'scenario_get_versions.cut': 'wariant ucięty po bloku',
  'scenario_get_versions.no_snapshot': 'bez migawki artefaktu, nie da się przywrócić',
  'scenario_get_versions.more': 'pokazano najnowsze {shown} z {total} wersji',
  'scenario_get_copilot_history.header.scenario': {
    one: '{count} wiadomość copilota scenariusza {id}:',
    few: '{count} wiadomości copilota scenariusza {id}:',
    many: '{count} wiadomości copilota scenariusza {id}:',
    other: '{count} wiadomości copilota scenariusza {id}:',
  },
  'scenario_get_copilot_history.header.planner': {
    one: '{count} wiadomość planera podziału ruchu {id}:',
    few: '{count} wiadomości planera podziału ruchu {id}:',
    many: '{count} wiadomości planera podziału ruchu {id}:',
    other: '{count} wiadomości planera podziału ruchu {id}:',
  },
  'scenario_get_copilot_history.header_cut.scenario':
    'ostatnie {shown} z {total} wiadomości copilota scenariusza {id}:',
  'scenario_get_copilot_history.header_cut.planner':
    'ostatnie {shown} z {total} wiadomości planera podziału ruchu {id}:',
  'scenario_get_copilot_history.empty.scenario':
    'Copilot tego scenariusza nie ma zapisanej rozmowy.',
  'scenario_get_copilot_history.empty.planner': 'Ten szkic planera nie ma zapisanej rozmowy.',
  'scenario_get_copilot_history.role.user': 'Ty',
  'scenario_get_copilot_history.role.other': '{role}',
  'scenario_get_copilot_history.actions': 'zaproponował: {kinds}',
  'scenario_get_copilot_history.proposal': {
    one: 'zaproponował podział {count} flow',
    few: 'zaproponował podział {count} flow',
    many: 'zaproponował podział {count} flow',
    other: 'zaproponował podział {count} flow',
  },
  'scenario_get_copilot_history.chips': {
    one: '{count} szybka odpowiedź',
    few: '{count} szybkie odpowiedzi',
    many: '{count} szybkich odpowiedzi',
    other: '{count} szybkiej odpowiedzi',
  },
  'scenario_export.saved': 'Wyeksportowano projekt Gatling scenariusza {id} jako ZIP ({kb} KB).',
  'scenario_export.omitted':
    'Plików ze zbiorami danych w nim nie ma, celowo: zawierają prawdziwe wartości i nigdy nie trafiają do eksportu.',
  'scenario_export.conf_unread':
    'Nie udało się tu odczytać jego application.conf: dołóż pliki zbiorów, które ten plik wymienia, i ustaw zmienne środowiska, które czyta.',
  'scenario_export.add_datasets': {
    one: 'Dołóż {count} plik zbioru danych w {folder} (tylko nazwy i kolumny; wartości są Twoje):',
    few: 'Dołóż {count} pliki zbiorów danych w {folder} (tylko nazwy i kolumny; wartości są Twoje):',
    many: 'Dołóż {count} plików zbiorów danych w {folder} (tylko nazwy i kolumny; wartości są Twoje):',
    other:
      'Dołóż {count} pliku zbiorów danych w {folder} (tylko nazwy i kolumny; wartości są Twoje):',
  },
  'scenario_export.folder_unknown': 'folderze application.conf',
  'scenario_export.role.auth': '(konta do logowania)',
  'scenario_export.columns': 'kolumny {names}',
  'scenario_export.columns_unknown': 'kolumny nieznane',
  'scenario_export.set_env': {
    one: 'Ustaw {count} zmienną środowiska (własna wartość):',
    few: 'Ustaw {count} zmienne środowiska (własne wartości):',
    many: 'Ustaw {count} zmiennych środowiska (własne wartości):',
    other: 'Ustaw {count} zmiennej środowiska (własne wartości):',
  },
  'scenario_export.nothing_to_add':
    'Konfiguracja nie czyta żadnego pliku zbioru ani zmiennej środowiska: nic do dołożenia.',
  'scenario_export.recipe': 'kroki startu: {path}',
  'scenario_export.file_title': 'Uruchomienie wyeksportowanego scenariusza {id}',
  'scenario_export.file_steps': 'Potem zbuduj i uruchom projekt z jego folderu:',
  'scenario_export.file_readme':
    'README.txt w ZIP-ie pochodzi z backendu i mówi tylko, jak zbudować; ten plik mówi, co dołożyć najpierw.',
  'scenario_export.ignored':
    'Folder jest ignorowany przez git; wcześniejszy eksport nigdy nie jest zastępowany.',
  'scenario_export.open': 'otwórz: {path}',
  'scenario_get_templates.header': {
    one: '{count} szablon scenariusza:',
    few: '{count} szablony scenariuszy:',
    many: '{count} szablonów scenariuszy:',
    other: '{count} szablonów scenariuszy:',
  },
  'scenario_get_templates.empty': 'LoadCraft nie ma żadnych szablonów scenariuszy.',
  'scenario_get_templates.line': '{name} {id} {category}, {difficulty}, scenariuszy: {scenarios}',
  'scenario_get_templates.about': 'opis: {description}',
  'scenario_get_templates.more': 'pokazano pierwsze {shown} z {count}',
  'scenario_get_templates.kind': 'szablon',
  'scenario_get_templates.none': 'brak',
  'scenario_get_templates.one.header': 'Szablon {name} {id}: {category}, {difficulty}',
  'scenario_get_templates.one.tags': 'tagi: {tags}',
  'scenario_get_templates.one.scenarios': 'Scenariusze ({count}):',
  'scenario_get_templates.one.scenario': '{name} potrzebuje: {inputs}; daje: {outputs}',
  'scenario_get_templates.one.files': 'Pliki danych ({count}):',
  'scenario_get_templates.one.file': '{name} kolumny: {columns}',
  'scenario_get_templates.draft': 'Szkic konfiguracji',
  'scenario_get_templates.draft.name': 'nazwa: {name}',
  'scenario_get_templates.draft.load': 'obciążenie: {type}, {users} użytkowników, {seconds} s',
  'scenario_get_templates.draft.sudden':
    'Uwaga: wszyscy użytkownicy ({users}) startują bez rampy; taki skok może przeciążyć małe albo lokalne środowisko, zanim test cokolwiek zmierzy. Sprawdź obciążenie przed zapisaniem kompozycji.',
  'scenario_get_templates.draft.mix': 'miks: {mix}',
  'scenario_get_templates.draft.mix_note':
    'Wagi miksu dzielą ruch między scenariusze (każdy wirtualny użytkownik wykonuje jeden z nich, w tej proporcji); to nie kolejność i nie przekazują wartości z jednego scenariusza do drugiego: scenariusz, który potrzebuje wartości z innego, bierze ją z własnych danych.',
  'scenario_get_templates.draft.thresholds': 'progi: {thresholds}',
  'scenario.part.none': 'brak',
  'scenario.part.unavailable': 'niedostępne (LoadCraft odpowiedział {status})',
  'scenario_list_compositions.header': {
    one: '{count} kompozycja:',
    few: '{count} kompozycje:',
    many: '{count} kompozycji:',
    other: '{count} kompozycji:',
  },
  'scenario_list_compositions.header_status': {
    one: '{count} kompozycja o statusie {status}:',
    few: '{count} kompozycje o statusie {status}:',
    many: '{count} kompozycji o statusie {status}:',
    other: '{count} kompozycji o statusie {status}:',
  },
  'scenario_list_compositions.empty': 'Ten projekt nie ma jeszcze kompozycji.',
  'scenario_list_compositions.empty_status': 'Ten projekt nie ma kompozycji o statusie {status}.',
  'scenario_list_compositions.members': {
    one: '{count} członek',
    few: '{count} członków',
    many: '{count} członków',
    other: '{count} członka',
  },
  'scenario_list_compositions.enabled': '{count} włączonych',
  'scenario_list_compositions.invalid': 'ostatnie sprawdzenie nieudane',
  'scenario_list_compositions.drift': 'członkowie z dryfem',
  'scenario_list_compositions.more': 'pokazano pierwsze {shown} z {total} kompozycji',
  'scenario_get_composition.members': {
    one: '{count} członek:',
    few: '{count} członków:',
    many: '{count} członków:',
    other: '{count} członka:',
  },
  'scenario_get_composition.share': '{percent}% ruchu',
  'scenario_get_composition.test_type': 'rodzaj testu: {type}{params}',
  'scenario_get_composition.no_test_type': 'rodzaj testu: nie ustawiono',
  'scenario_get_composition.pinned': 'przypięty v{pinned}',
  'scenario_get_composition.drifted':
    'przypięty v{pinned}, scenariusz zmienił się od tamtej pory (teraz v{current})',
  'scenario_get_composition.same_content':
    'przypięty v{pinned}, scenariusz ma v{current} o tej samej treści',
  'scenario_get_composition.off': 'wyłączony',
  'scenario_get_composition.own_injection': 'własne wstrzykiwanie',
  'scenario_get_composition.datasets': {
    one: '{count} zbiór danych',
    few: '{count} zbiory danych',
    many: '{count} zbiorów danych',
    other: '{count} zbioru danych',
  },
  'scenario_get_composition.load': 'profil obciążenia: {profile}',
  'scenario_get_composition.load_cut': '… profil obciążenia ucięty',
  'scenario_get_composition.load_hidden':
    'profil obciążenia ukryty: jego formatu nie da się zamaskować ({bytes} bajtów)',
  'scenario_get_composition.no_headers': 'nagłówki domyślne: brak',
  'scenario_get_composition.headers':
    'nagłówki domyślne: {names} (wartości nigdy nie są pokazywane)',
  'scenario_get_composition.pauses': 'pauzy: {distribution}, czas namysłu {think}',
  'scenario_get_composition.pauses_members':
    'pauzy: {distribution}, czas namysłu ustawia każdy członek',
  'scenario_get_composition.no_check': 'ostatnie sprawdzenie: brak zapisanego',
  'scenario_get_composition.check_valid': 'ostatnie sprawdzenie ({at}): poprawna',
  'scenario_get_composition.check_valid_nodate': 'ostatnie sprawdzenie: poprawna',
  'scenario_get_composition.check_valid_warnings':
    'ostatnie sprawdzenie ({at}): poprawna, ostrzeżeń: {count}',
  'scenario_get_composition.check_valid_warnings_nodate':
    'ostatnie sprawdzenie: poprawna, ostrzeżeń: {count}',
  'scenario_get_composition.check_invalid_nodate': 'ostatnie sprawdzenie: niepoprawna',
  'scenario_get_composition.check_invalid': 'ostatnie sprawdzenie ({at}): niepoprawna',
  'scenario_get_composition.error': 'błąd (LoadCraft): {text}',
  'scenario_get_composition.warning': 'ostrzeżenie (LoadCraft): {text}',
  'scenario_get_composition.missing_feeders': 'brakuje powiązanych zbiorów danych: {names}',
  'scenario_save.created': 'scenariusz "{name}" utworzony, pusty: bez skryptu',
  'scenario_save.saved': 'scenariusz "{name}" zapisany',
  'scenario_save.unchanged': 'scenariusz "{name}": podane wartości już ma; nic nie zmieniono.',
  'scenario_save.change.name': '  nazwa: "{was}" → "{now}"',
  'scenario_save.change.tags': '  tagi: {was} → {now}',
  'scenario_save.change.active': '  aktywny: {was} → {now}',
  'scenario_save.change.slo': '  progi SLO: {was} → {now}',
  'scenario_save.slo.inherited': 'projektu',
  'scenario_save.slo.stock': 'standardowe',
  'scenario_save.slo.own': 'własne ({list})',
  'scenario_save.tags.none': '(brak)',
  'scenario_save.yes': 'tak',
  'scenario_save.no': 'nie',
  'scenario_save.undo':
    '→ cofnięcie: scenario_save z poprzednimi wartościami (zmiana nazwy tworzy kolejną wersję)',
  'scenario_save.undo.none':
    'bez cofnięcia: poprzedniego tagu z przecinkiem nie da się zapisać z powrotem; ustaw tagi ponownie ręcznie',
  'scenario_save.undo.created':
    '→ cofnięcie: usunięcie nowego scenariusza {id} (decyduje użytkownik)',
  'scenario_save.refuse.no_fields':
    'podaj co najmniej jedno z: name, tags, is_active, slo_thresholds, slo_from_project',
  'scenario_save.refuse.slo_conflict': 'slo_thresholds i slo_from_project: true wykluczają się',
  'scenario_save.refuse.too_many_tags': 'najwyżej 20 tagów',
  'scenario_save.refuse.active_on_create':
    'is_active dotyczy istniejącego scenariusza: podaj scenario_id',
  'scenario_save.refuse.slo_from_project_on_create':
    'slo_from_project dotyczy istniejącego scenariusza: podaj scenario_id',
  'error.scenario_save_refused.message': 'Niczego nie zapisano: {reason}.',
  'error.scenario_save_refused.hint': 'Zmień argumenty i wywołaj ponownie; nic nie wysłano.',
  // scenario_delete
  'scenario_delete.card.title.scenario': 'Usunięcie scenariusza „{name}”',
  'scenario_delete.card.title.composition': 'Usunięcie kompozycji „{name}”',
  'scenario_delete.card.item.scenario':
    'scenariusz {id} razem ze wszystkimi wersjami i wzorcami porównania',
  'scenario_delete.card.item.composition': 'kompozycja {id} z ustawieniami i powiązaniami członków',
  'scenario_delete.card.versions': {
    one: 'razem z nim znika {count} zapisana wersja',
    few: 'razem z nim znikają {count} zapisane wersje',
    many: 'razem z nim znika {count} zapisanych wersji',
    other: 'razem z nim znika {count} zapisanej wersji',
  },
  'scenario_delete.card.versions_unknown':
    'razem z nim znikają zapisane wersje (nie udało się policzyć)',
  'scenario_delete.card.compositions': {
    one: 'wychodzi z {count} kompozycji (kompozycja zostaje): {names}',
    few: 'wychodzi z {count} kompozycji (zostają): {names}',
    many: 'wychodzi z {count} kompozycji (zostają): {names}',
    other: 'wychodzi z {count} kompozycji (zostają): {names}',
  },
  'scenario_delete.card.compositions_none': 'żadna kompozycja go nie zawiera',
  'scenario_delete.card.compositions_unknown':
    'nie udało się odczytać kompozycji, które go zawierają; wychodzi ze wszystkich',
  'scenario_delete.card.members': {
    one: 'zostaje {count} scenariusz członek: {names}',
    few: 'zostają {count} scenariusze członkowie: {names}',
    many: 'zostaje {count} scenariuszy członków: {names}',
    other: 'zostaje {count} scenariusza członka: {names}',
  },
  'scenario_delete.card.members_none': 'nie ma scenariuszy członków',
  'scenario_delete.card.stays.scenario':
    'zostają: dotychczasowe przebiegi z wynikami, zbiory danych, flow, z którego powstał',
  'scenario_delete.card.stays.composition':
    'zostają: scenariusze, dotychczasowe przebiegi z wynikami, zbiory danych',
  'scenario_delete.card.undo': 'usunięcie jest na stałe; nowy scenariusz powstaje z jego flow',
  'scenario_delete.done.scenario': 'Scenariusz „{name}” usunięty ({count}).',
  'scenario_delete.done.composition': 'Kompozycja „{name}” usunięta ({count}).',
  'scenario_delete.stays.scenario':
    'Dotychczasowe przebiegi, zbiory danych i flow zostają. Tego nie da się cofnąć.',
  'scenario_delete.stays.composition':
    'Scenariusze członkowie, dotychczasowe przebiegi i zbiory danych zostają. Tego nie da się cofnąć.',
  'scenario_get_composition_code.header': {
    one: 'Wygenerowany projekt Gatlinga ma {count} plik:',
    few: 'Wygenerowany projekt Gatlinga ma {count} pliki:',
    many: 'Wygenerowany projekt Gatlinga ma {count} plików:',
    other: 'Wygenerowany projekt Gatlinga ma {count} pliku:',
  },
  'scenario_get_composition_code.empty': 'Wygenerowany projekt Gatlinga nie ma plików.',
  'scenario_get_composition_code.more': 'pokazano pierwsze {shown} z {total} plików',
  'scenario_get_composition_code.hint':
    'Podaj path, żeby przeczytać jeden z tych plików; sekrety w nim są zamaskowane.',
  'scenario_get_composition_code.file_header': '{path} ({language}):',
  'scenario_get_composition_code.hidden':
    'plik ukryty: jego formatu nie da się zamaskować ({bytes} bajtów)',
  'scenario_get_composition_code.cut': '… plik ucięty',
  'scenario_check_composition.valid': 'Kompozycja {id} przechodzi sprawdzenie (sprawdzono {at}).',
  'scenario_check_composition.invalid':
    'Kompozycja {id} nie przechodzi sprawdzenia (sprawdzono {at}).',
  'scenario_check_composition.authoring': 'Jest poprawna w zapisie.',
  'scenario_check_composition.shares': '{members} członków, razem {percent}% ruchu.',
  'scenario_check_composition.issues': 'problemy: {errors} błędów, {warnings} ostrzeżeń',
  'scenario_check_composition.no_issues': 'Brak problemów między członkami.',
  'scenario_check_composition.error': 'błąd (LoadCraft)',
  'scenario_check_composition.warning': 'ostrzeżenie (LoadCraft)',
  'scenario_check_composition.step': 'krok {n}',
  'scenario_check_composition.variable': 'zmienna {name}',
  'scenario_check_composition.suggestion': 'spróbuj: {text}',
  'scenario_check_composition.more': '… i jeszcze {count} problemów',
  'scenario_check_composition.drift': {
    one: '{count} członek ma dryf względem swojego scenariusza:',
    few: '{count} członków ma dryf względem swoich scenariuszy:',
    many: '{count} członków ma dryf względem swoich scenariuszy:',
    other: '{count} członka ma dryf względem swoich scenariuszy:',
  },
  'scenario_check_composition.versions':
    'przypięty v{pinned}, scenariusz zmienił się od tamtej pory (teraz v{current})',
  'scenario_check_composition.missing_feeders': 'brakuje powiązanych zbiorów danych: {names}',
  'scenario_save_composition.card.title': 'Zapis kompozycji „{name}”',
  'scenario_save_composition.card.create': 'nowa kompozycja „{name}”',
  'scenario_save_composition.card.rename': 'zmiana nazwy: „{was}” → „{now}”',
  'scenario_save_composition.card.member.added': 'dodanie {name}: {now}%',
  'scenario_save_composition.card.member.removed': 'usunięcie {name} (było {was}%)',
  'scenario_save_composition.card.member.changed': '{name}: {was}% → {now}%',
  'scenario_save_composition.card.member.same': '{name}: {now}% (bez zmian)',
  'scenario_save_composition.card.more': '… i jeszcze {count} członków',
  'scenario_save_composition.card.profile': 'profil obciążenia: {was} → {now}',
  'scenario_save_composition.profile.none': '(brak)',
  'scenario_save_composition.card.undo.create': 'usunięcie nowej kompozycji (decyduje użytkownik)',
  'scenario_save_composition.card.undo.update':
    'scenario_save_composition przywraca poprzednią nazwę, członków i profil; usunięty członek wraca z ustawieniami domyślnymi',
  'scenario_save_composition.done.created': 'kompozycja „{name}” utworzona, członków: {members}',
  'scenario_save_composition.done.updated': 'kompozycja „{name}” zapisana: {parts}',
  'scenario_save_composition.done.unchanged': 'kompozycja „{name}”: nic do zmiany',
  'scenario_save_composition.part.name': 'nazwa',
  'scenario_save_composition.part.members': 'członkowie i udziały',
  'scenario_save_composition.part.profile': 'profil obciążenia',
  'scenario_save_composition.total': 'udziały dają razem {total}%',
  'scenario_save_composition.valid.yes': 'backend uznaje ją za poprawną',
  'scenario_save_composition.valid.no': 'backend uznaje ją za NIEPOPRAWNĄ',
  'scenario_save_composition.valid.unknown': 'backend nie mógł jej sprawdzić',
  'scenario_save_composition.error': 'błąd: {text}',
  'scenario_save_composition.warning': 'ostrzeżenie: {text}',
  'scenario_save_composition.undo.previous':
    '→ cofnięcie: scenario_save_composition z poprzednimi wartościami (usunięty członek wraca z ustawieniami domyślnymi)',
  'scenario_save_composition.undo.delete':
    '→ cofnięcie: usunięcie nowej kompozycji (decyduje użytkownik)',
  'scenario_save_composition.undo.withheld':
    'bez cofnięcia: poprzednia wartość zawiera sekret i nie jest zachowana',
  'scenario_compile_composition.card.title': 'Kompilacja kompozycji „{name}”',
  'scenario_compile_composition.card.members':
    'buduje projekt Gatlinga, jaki trafiłby do przebiegu, z {enabled} włączonych członków (z {members})',
  'scenario_compile_composition.card.nothing_runs':
    'nic nie rusza na celu i nic się nie zapisuje; wywołanie czeka na build',
  'scenario_compile_composition.card.cost': 'build na backendzie, do 2 min; bez LLM',
  'scenario_compile_composition.card.undo': 'tylko buduje',
  'scenario_compile_composition.done.compiled': 'kompozycja „{name}” skompilowana w {seconds} s',
  'scenario_compile_composition.done.code_failed':
    'kompozycja „{name}” się nie kompiluje ({seconds} s)',
  'scenario_compile_composition.done.environment_failed':
    'zawiodło środowisko budowania, nie kod kompozycji „{name}” ({seconds} s): spróbuj później',
  'scenario_compile_composition.done.no_enabled_member':
    'kompozycja „{name}” nie ma włączonego członka: nie było czego budować',
  'scenario_compile_composition.error': 'błąd: {text}',
  'scenario_compile_composition.warning': 'ostrzeżenie: {text}',
  'scenario_compile_composition.more': '… i jeszcze {count}',
  'scenario_compile_composition.output': 'wynik budowania ma {lines} linii i nie jest pokazany',
  'scenario_compile_composition.problem.code_failed':
    'Wygenerowany projekt kompozycji „{name}” się nie kompiluje.',
  'scenario_compile_composition.problem.environment_failed':
    'Zawiodło środowisko budowania przy kompilacji kompozycji „{name}”.',
  'scenario_compile_composition.problem.no_enabled_member':
    'Kompozycja „{name}” nie ma włączonego członka do kompilacji.',
  'scenario_compile_composition.problem.compiled': 'Kompozycja „{name}” skompilowana.',
  'error.scenario_compile_refused.message': 'Backend nie zbudował kompozycji „{name}”.',
  'error.scenario_compile_refused.hint':
    'Włączony członek nie ma buildu albo ma pole, którego build odrzuca; wygeneruj ten scenariusz ponownie i spróbuj jeszcze raz.',
  'scenario_ask_copilot.card.title': 'Pytanie do copilota scenariusza „{name}”',
  'scenario_ask_copilot.card.message': 'pytanie: „{message}”',
  'scenario_ask_copilot.card.review': 'standardowy przegląd gotowości scenariusza (stały prompt)',
  'scenario_ask_copilot.card.profile': 'profil obciążenia: {profile}',
  'scenario_ask_copilot.profile.none': '(brak)',
  'scenario_ask_copilot.card.proposes':
    'proponuje akcje i żadnej nie stosuje; wymiana zostaje w historii copilota scenariusza',
  'scenario_ask_copilot.card.cost':
    'jedno lub dwa wywołania LLM (plan próbowany jeszcze raz, gdy zawiedzie)',
  'scenario_ask_copilot.card.undo': 'tylko proponuje; nic w scenariuszu się nie zmienia',
  'scenario_ask_copilot.done.message': 'copilot odpowiedział na pytanie o „{name}”',
  'scenario_ask_copilot.done.review': 'copilot ocenił gotowość „{name}”',
  'scenario_ask_copilot.reply': 'odpowiedź: {reply}',
  'scenario_ask_copilot.reply.cut': 'odpowiedź (ucięta): {reply}',
  'scenario_ask_copilot.actions.none': 'żadna akcja nie została zaproponowana',
  'scenario_ask_copilot.actions': 'zaproponowane akcje: {count}',
  'scenario_ask_copilot.action.adjust_and_regenerate': '{index}. przebudowa scenariusza: {summary}',
  'scenario_ask_copilot.action.generate_slot_feeder':
    '{index}. wygenerowanie zbioru dla slotu „{about}” ({summary})',
  'scenario_ask_copilot.action.rewrite_validator':
    '{index}. przepisanie walidatora „{about}”: {summary}',
  'scenario_ask_copilot.action.other': '{index}. {summary}',
  'scenario_ask_copilot.more': '… i jeszcze {count}',
  'scenario_ask_copilot.applied.none':
    'nic nie zastosowano: każdą propozycję rozstrzyga użytkownik',
  'scenario_check_drift.card.title': 'Sprawdź dryf scenariusza {name}',
  'scenario_check_drift.card.scenario': 'Scenariusz: {name} ({id})',
  'scenario_check_drift.card.reference.har': 'Porównanie z nagraną sesją HAR {id}',
  'scenario_check_drift.card.reference.openapi': 'Porównanie z wersją dokumentacji {id}',
  'scenario_check_drift.card.cost': 'około jednego porównania przez model',
  'scenario_check_drift.card.undo': 'nie ma czego cofać: zapisuje tylko werdykt',
  'scenario_check_drift.progress.start': 'Zaczynam sprawdzanie dryfu',
  'scenario_check_drift.progress.step': 'Sprawdzanie dryfu: {step} ({percent}%)',
  'scenario_check_drift.node.extract_endpoints': 'czytam endpointy wzorca',
  'scenario_check_drift.node.compare': 'porównuję ze scenariuszem',
  'scenario_check_drift.node.recommend': 'piszę rekomendacje',
  'scenario_check_drift.result':
    'Scenariusz {name}: nieaktualność {score} (0 aktualny, 1 nieaktualny), sprawdzono {at}',
  'scenario_check_drift.reference': 'Porównano z {kind} {id}',
  'scenario_check_drift.source.har': 'sesją HAR',
  'scenario_check_drift.source.openapi': 'wersją dokumentacji',
  'scenario_check_drift.no_report':
    'Odczytano tylko wynik: raportu tego sprawdzenia nie otrzymano.',
  'scenario_check_drift.summary':
    '{current} endpointów bez zmian, {drifted} zmienionych lub usuniętych, {parameters} dryfów parametrów, {uncovered} ze wzorca bez wywołania',
  'scenario_check_drift.status.modified': 'zmieniony',
  'scenario_check_drift.status.removed': 'usunięty ze wzorca',
  'scenario_check_drift.location.query': 'query',
  'scenario_check_drift.location.header': 'nagłówek',
  'scenario_check_drift.location.body': 'ciało',
  'scenario_check_drift.more_endpoints': '… i jeszcze {count} zmienionych endpointów',
  'scenario_check_drift.recommendations': 'rekomendacje (LoadCraft):',
  'scenario_check_drift.uncovered': 'endpointy wzorca, których scenariusz nie wywołuje ({count}):',
  'error.scenario_drift_failed.message': 'LoadCraft nie dokończył sprawdzania dryfu: {cause}',
  'error.scenario_drift_failed.hint':
    'Sprawdź, że id wzorca to sesja HAR albo wersja dokumentacji tego projektu (scenario_list, project_get_docs), i uruchom sprawdzenie jeszcze raz.',
  'error.scenario_drift_cancelled.message':
    'Sprawdzanie dryfu zostało anulowane, zanim się skończyło.',
  'error.scenario_drift_cancelled.hint':
    'Uruchom scenario_check_drift jeszcze raz, gdy użytkownik chce sprawdzenia.',
  // kolizje slotow (scenario_save_composition, scenario_check_composition)
  'scenario.slot_collision':
    'Ostrzeżenie: członkowie {members} deklarują slot „{slot}” inaczej ({differs}); jeden zbiór danych nie pasuje do wszystkich.',
  'scenario.slot_collision.columns': 'inne kolumny',
  'scenario.slot_collision.role': 'inna rola',
  'scenario.slot_collision.identity': 'nowe konta wobec istniejących',
};
