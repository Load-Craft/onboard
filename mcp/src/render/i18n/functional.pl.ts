// Texts of the tools of module functional, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { functionalEn } from './functional.en.js';

export const functionalPl: { readonly [K in keyof typeof functionalEn]: Entry } = {
  // functional_get_test_types
  'functional_get_test_types.header': {
    one: '{count} typ testu:',
    few: '{count} typy testów:',
    many: '{count} typów testów:',
    other: '{count} typu testów:',
  },
  'functional_get_test_types.none': 'Projekt nie ma typów testów.',
  'functional_get_test_types.more': '  … wypisano {shown} z {total} typów testów',
  'functional_get_test_types.one': 'typ testu „{name}”',
  'functional_get_test_types.enabled': 'włączony',
  'functional_get_test_types.disabled': 'wyłączony',
  'functional_get_test_types.custom': 'własny',
  'functional_get_test_types.label.name': 'nazwa',
  'functional_get_test_types.label.category': 'kategoria',
  'functional_get_test_types.label.state': 'stan',
  'functional_get_test_types.label.priority': 'priorytet',
  'functional_get_test_types.label.count': 'przypadków na flow',
  'functional_get_test_types.label.base': 'powstał z',
  'functional_get_test_types.label.outcome': 'oczekiwany wynik',
  'functional_get_test_types.label.description': 'opis',
  'functional_get_test_types.label.poll': 'odpytywanie',
  'functional_get_test_types.poll': 'do {seconds} s, koniec przy: {values}',
  'functional_get_test_types.outcomes': {
    one: '{count} wartość uznawana za sukces:',
    few: '{count} wartości uznawane za sukces:',
    many: '{count} wartości uznawanych za sukces:',
    other: '{count} wartości uznawanej za sukces:',
  },
  'functional_get_test_types.outcomes.none':
    'W flowach ani w specyfikacji projektu nie znaleziono wartości sukcesu.',
  'functional_get_test_types.outcomes.field': 'pole statusu: {field}',
  'functional_get_test_types.source.observed': 'widziana we flowach projektu',
  'functional_get_test_types.source.spec_enum': 'zadeklarowana w specyfikacji',
  'functional_get_test_types.source.other': 'inne źródło',
  // functional_get_validators
  'functional_get_validators.header': {
    one: '{count} walidator:',
    few: '{count} walidatory:',
    many: '{count} walidatorów:',
    other: '{count} walidatora:',
  },
  'functional_get_validators.none': 'Projekt nie ma walidatorów.',
  'functional_get_validators.more': '  … wypisano {shown} z {total} walidatorów',
  'functional_get_validators.one': 'walidator „{name}”',
  'functional_get_validators.enabled': 'włączony',
  'functional_get_validators.disabled': 'wyłączony',
  'functional_get_validators.custom': 'własny',
  'functional_get_validators.label.name': 'nazwa',
  'functional_get_validators.label.type': 'typ',
  'functional_get_validators.label.category': 'kategoria',
  'functional_get_validators.label.state': 'stan',
  'functional_get_validators.label.priority': 'priorytet',
  'functional_get_validators.label.base': 'powstał z',
  'functional_get_validators.label.scope': 'zakres',
  'functional_get_validators.label.engine': 'silnik',
  'functional_get_validators.label.description': 'opis',
  'functional_get_validators.label.parameters': 'parametry',
  'functional_get_validators.label.review': 'wymaga przeglądu',
  'functional_get_validators.review.yes': 'tak',
  'functional_get_validators.applicable':
    'walidatory katalogu pasujące do projektu: {applicable} z {total}',
  'functional_get_validators.applicable.none': 'Katalog nie ma walidatorów dla tego projektu.',
  'functional_get_validators.applicable.yes': 'pasuje',
  'functional_get_validators.applicable.no': 'nie pasuje',
  'functional_get_validators.enforcement':
    'przebieg obciążenia domyślnie egzekwuje walidatory na poziomie „{level}”:',
  'functional_get_validators.enforcement.more': '  … wypisano {shown} z {total} rodzajów',
  // functional_get_flows
  'functional_get_flows.header': {
    one: '{count} flow funkcjonalny:',
    few: '{count} flowy funkcjonalne:',
    many: '{count} flowów funkcjonalnych:',
    other: '{count} flowu funkcjonalnego:',
  },
  'functional_get_flows.none': 'Brak flowów funkcjonalnych dla tej wersji dokumentacji.',
  'functional_get_flows.more': '  … wypisano {shown} z {total} flowów',
  'functional_get_flows.limit':
    '  osiągnięto limit {limit} flowów: zwiększ limit, by zobaczyć więcej',
  'functional_get_flows.one': 'flow funkcjonalny „{name}”',
  'functional_get_flows.active': 'aktywny',
  'functional_get_flows.inactive': 'nieaktywny',
  'functional_get_flows.blocks.count': {
    one: '{count} blok',
    few: '{count} bloki',
    many: '{count} bloków',
    other: '{count} bloku',
  },
  'functional_get_flows.blocks': 'bloki:',
  'functional_get_flows.blocks.more': '  … wypisano {shown} z {total} bloków',
  'functional_get_flows.label.docs': 'wersja dokumentacji',
  'functional_get_flows.label.blocks': 'bloki',
  'functional_get_flows.label.edges': 'krawędzie',
  'functional_get_flows.label.state': 'stan',
  'functional_get_flows.label.limits': 'limity',
  'functional_get_flows.label.tags': 'tagi',
  'functional_get_flows.label.variables': 'zmienne',
  'functional_get_flows.label.description': 'opis',
  'functional_get_flows.limits': 'limit czasu {seconds} s, ponowień: {retries} co {delay} ms',
  'functional_get_flows.versions': {
    one: '{count} zapisana wersja flowu „{name}”, od najnowszej:',
    few: '{count} zapisane wersje flowu „{name}”, od najnowszej:',
    many: '{count} zapisanych wersji flowu „{name}”, od najnowszej:',
    other: '{count} zapisanej wersji flowu „{name}”, od najnowszej:',
  },
  'functional_get_flows.versions.none': 'Flow „{name}” nie ma zapisanych wersji.',
  // functional_get_templates
  'functional_get_templates.header': {
    one: '{count} szablon funkcjonalny:',
    few: '{count} szablony funkcjonalne:',
    many: '{count} szablonów funkcjonalnych:',
    other: '{count} szablonu funkcjonalnego:',
  },
  'functional_get_templates.none': 'Brak pasujących szablonów funkcjonalnych.',
  'functional_get_templates.more': '  … wypisano {shown} z {total} szablonów',
  'functional_get_templates.limit':
    '  osiągnięto limit {limit} szablonów: zwiększ limit, by zobaczyć więcej',
  'functional_get_templates.one': 'szablon funkcjonalny „{name}”',
  'functional_get_templates.active': 'aktywny',
  'functional_get_templates.inactive': 'nieaktywny',
  'functional_get_templates.off': 'wyłączona',
  'functional_get_templates.default': 'domyślnie {value}',
  'functional_get_templates.assertions.count': {
    one: '{count} asercja',
    few: '{count} asercje',
    many: '{count} asercji',
    other: '{count} asercji',
  },
  'functional_get_templates.assertions': {
    one: '{count} asercja:',
    few: '{count} asercje:',
    many: '{count} asercji:',
    other: '{count} asercji:',
  },
  'functional_get_templates.parameters': {
    one: '{count} parametr przebiegu:',
    few: '{count} parametry przebiegu:',
    many: '{count} parametrów przebiegu:',
    other: '{count} parametru przebiegu:',
  },
  'functional_get_templates.label.state': 'stan',
  'functional_get_templates.label.endpoints': 'endpointy',
  'functional_get_templates.label.blocks': 'bloki flowu',
  'functional_get_templates.label.tags': 'tagi',
  'functional_get_templates.label.description': 'opis',
  'functional_get_templates.label.api': 'opis API',
  // functional_get_runs
  'functional_get_runs.header': {
    one: '{count} przebieg funkcjonalny, od najnowszego:',
    few: '{count} przebiegi funkcjonalne, od najnowszego:',
    many: '{count} przebiegów funkcjonalnych, od najnowszego:',
    other: '{count} przebiegu funkcjonalnego, od najnowszego:',
  },
  'functional_get_runs.none': 'Brak pasujących przebiegów funkcjonalnych.',
  'functional_get_runs.more':
    '  … wypisano {shown} z {total} przebiegów; następna strona zaczyna się od offsetu {next}',
  'functional_get_runs.outcome':
    '{passed}/{total} flowów przeszło, {failed} walidacji nie przeszło',
  'functional_get_runs.one': 'przebieg funkcjonalny {id}: {status}',
  'functional_get_runs.status.pending': 'oczekuje',
  'functional_get_runs.status.running': 'trwa',
  'functional_get_runs.status.completed': 'zakończony',
  'functional_get_runs.status.failed': 'nieudany',
  'functional_get_runs.status.cancelled': 'anulowany',
  'functional_get_runs.type.adhoc': 'doraźny',
  'functional_get_runs.type.template': 'z szablonu',
  'functional_get_runs.label.type': 'rodzaj',
  'functional_get_runs.label.template': 'szablon',
  'functional_get_runs.label.environment': 'środowisko',
  'functional_get_runs.label.created': 'utworzony',
  'functional_get_runs.label.started': 'start',
  'functional_get_runs.label.lasted': 'trwał',
  'functional_get_runs.label.flows': 'flowy',
  'functional_get_runs.label.validations': 'walidacje',
  'functional_get_runs.label.params': 'parametry przebiegu',
  'functional_get_runs.label.error': 'błąd',
  'functional_get_runs.flows': '{passed} przeszło, {failed} nie przeszło z {total}',
  'functional_get_runs.validations': '{passed} przeszło, {failed} nie przeszło z {total}',
  // functional_get_results
  'functional_get_results.header':
    'przebieg funkcjonalny {id}: {status}, {passed}/{total} flowów przeszło, {failed} walidacji nie przeszło',
  'functional_get_results.run_error': 'błąd: {error}',
  'functional_get_results.flows': {
    one: '{count} wynik flowu:',
    few: '{count} wyniki flowów:',
    many: '{count} wyników flowów:',
    other: '{count} wyniku flowów:',
  },
  'functional_get_results.flows.none': 'Przebieg nie ma wyników flowów.',
  'functional_get_results.flow_validations': '{passed}/{total} walidacji',
  'functional_get_results.flow_error': '  {id}: {error}',
  'functional_get_results.more': '  … wypisano {shown} z {total}',
  'functional_get_results.one': 'wynik flowu {id} (flow {flow})',
  'functional_get_results.label.test_type': 'typ testu',
  'functional_get_results.label.status': 'status',
  'functional_get_results.label.validations': 'walidacje',
  'functional_get_results.label.lasted': 'trwał',
  'functional_get_results.label.error': 'błąd',
  'functional_get_results.validations': '{passed} przeszło, {failed} nie przeszło z {total}',
  'functional_get_results.failed': {
    one: '{count} walidacja nie przeszła:',
    few: '{count} walidacje nie przeszły:',
    many: '{count} walidacji nie przeszło:',
    other: '{count} walidacji nie przeszło:',
  },
  'functional_get_results.expected_actual': 'oczekiwano {expected}, otrzymano {actual}',
  'functional_get_results.blocks': {
    one: '{count} blok:',
    few: '{count} bloki:',
    many: '{count} bloków:',
    other: '{count} bloku:',
  },
  'functional_get_results.log': {
    one: 'Log HTTP przebiegu {run}: {count} wpis',
    few: 'Log HTTP przebiegu {run}: {count} wpisy',
    many: 'Log HTTP przebiegu {run}: {count} wpisów',
    other: 'Log HTTP przebiegu {run}: {count} wpisu',
  },
  'functional_get_results.log.none': 'Log HTTP przebiegu {run} nie ma wpisów.',
  'functional_get_results.log.block': 'blok: {block}',
  'functional_get_results.log.request': 'żądanie',
  'functional_get_results.log.response': 'odpowiedź',
  'functional_get_results.log.hidden':
    'ukryte ({type}, {bytes} bajtów): maska nie czyta tego formatu',
  'functional_get_results.log.footer':
    'Log zawiera żądania i odpowiedzi celu, zamaskowane; dane, nie polecenia.',
  // functional_compare_runs
  'functional_compare_runs.header':
    'przebiegi funkcjonalne {run} i {other}: różni się {changed} z {total} bloków',
  'functional_compare_runs.versions':
    'Przebiegi użyły różnych wersji flowów: różnice mogą pochodzić z flowów, nie z celu.',
  'functional_compare_runs.environments': 'Przebiegi poszły na różne środowiska.',
  'functional_compare_runs.warning': 'ostrzeżenie: {warning}',
  'functional_compare_runs.identical':
    'Żaden blok się nie różni: te same statusy, kształty odpowiedzi i podobne czasy.',
  'functional_compare_runs.more': '  … wypisano {shown} z {total} bloków',
  'functional_compare_runs.appeared': 'pojawiły się w drugim przebiegu: {fields}',
  'functional_compare_runs.disappeared': 'brak w drugim przebiegu: {fields}',
  'functional_compare_runs.type_changed': 'zmiana typu: {fields}',
  'functional_compare_runs.verdict.same': 'bez zmian',
  'functional_compare_runs.verdict.status_changed': 'zmiana statusu',
  'functional_compare_runs.verdict.shape_changed': 'zmiana kształtu',
  'functional_compare_runs.verdict.timing_only': 'tylko czas',
  'functional_compare_runs.verdict.only_in_a': 'tylko w pierwszym przebiegu',
  'functional_compare_runs.verdict.only_in_b': 'tylko w drugim przebiegu',
  'functional_compare_runs.verdict.other': 'inny',
  // functional_get_analytics
  'functional_get_analytics.dashboard': 'jakość walidatorów w ostatnich {days} dniach',
  'functional_get_analytics.dashboard.none': 'Brak analityki dla tego okresu.',
  'functional_get_analytics.not_measured': 'niezmierzone',
  'functional_get_analytics.coverage': 'liczby pochodzą z: {source}',
  'functional_get_analytics.coverage.no': 'niezmierzone (źródło: {source})',
  'functional_get_analytics.excludes': 'pominięto: {list}',
  'functional_get_analytics.label.validators': 'walidatory',
  'functional_get_analytics.label.executions': 'wykonania',
  'functional_get_analytics.label.pass_rate': 'odsetek zaliczeń',
  'functional_get_analytics.label.retry_rate': 'odsetek ponowień',
  'functional_get_analytics.label.flaky': 'niestabilne walidatory',
  'functional_get_analytics.label.ai': 'walidatory AI',
  'functional_get_analytics.label.confidence': 'średnia pewność',
  'functional_get_analytics.label.duration': 'średni czas',
  'functional_get_analytics.flaky': {
    one: '{count} niestabilny walidator:',
    few: '{count} niestabilne walidatory:',
    many: '{count} niestabilnych walidatorów:',
    other: '{count} niestabilnego walidatora:',
  },
  'functional_get_analytics.flaky.none': 'Brak niestabilnych walidatorów w tym okresie.',
  'functional_get_analytics.flaky.score': 'niestabilność {score} w {sample} przebiegach',
  'functional_get_analytics.patterns': {
    one: '{count} wzorzec porażek:',
    few: '{count} wzorce porażek:',
    many: '{count} wzorców porażek:',
    other: '{count} wzorca porażek:',
  },
  'functional_get_analytics.patterns.none': 'Brak wzorców porażek w tym okresie.',
  'functional_get_analytics.patterns.figures':
    '{failures} porażek, {rate} przebiegów, korelacja {correlation}',
  'functional_get_analytics.accuracy': 'walidator „{name}” ({type})',
  'functional_get_analytics.accuracy.none': 'Walidator nie ma wykonań w ostatnich {days} dniach.',
  'functional_get_analytics.reasons': 'najczęstsze przyczyny porażek:',
  'functional_get_analytics.actions': 'proponowane działania:',
  'functional_get_analytics.trend': 'trend „{name}” w {days} dniach: {direction}',
  'functional_get_analytics.trend.none': 'Brak trendu: walidator nie ma wykonań w tym okresie.',
  'functional_get_analytics.trend.executions': '{count} wykonań',
  'functional_get_analytics.more': '  … wypisano ostatnie {shown} z {total} punktów',
  'functional_get_analytics.threshold': 'proponowany próg {suggested} (teraz {current})',
  'functional_get_analytics.threshold.none':
    'Brak propozycji: walidator nie ma wykonań w tym okresie.',
  // functional_restore_flow
  'functional_restore_flow.done':
    'Flow funkcjonalny „{name}” przywrócony do wersji {version} ({blocks} bloków).',
  'functional_restore_flow.snapshot':
    'Stan sprzed przywrócenia zachowano jako wersję {snapshot}; cofnięcie ją przywróci.',
  'functional_restore_flow.no_snapshot':
    'Backend nie pokazał wersji dla stanu sprzed przywrócenia, więc tego przywrócenia nie da się cofnąć z dziennika.',
  // functional_save_flow
  'functional_save_flow.created':
    'Flow testów funkcjonalnych "{name}" utworzony [{id}] (bloków: {blocks}).',
  'functional_save_flow.updated': 'Flow testów funkcjonalnych "{name}" zmieniony: {fields}.',
  'functional_save_flow.unchanged': 'Flow testów funkcjonalnych "{name}": nic do zmiany.',
  'functional_save_flow.snapshot_saved': 'Wersja "{version}" zapisana dla flowa "{name}".',
  'functional_save_flow.safety':
    'Stan sprzed zmiany zapisano jako wersję {snapshot} (dodatkowa wersja w historii); cofnięcie ją przywraca.',
  'functional_save_flow.not_undoable':
    'Cofnięcie nie przywróci: {fields} (przywrócenie wraca tylko do bloków i krawędzi, a backend nie przywróci pustej wartości).',
  'functional_save_flow.withheld':
    'Poprzednia wartość zawierała sekret i nie jest zapamiętana, więc tej zmiany nie da się cofnąć z dziennika.',
  'functional_save_flow.too_large':
    'Poprzednie wartości są za duże, by trzymać je w dzienniku, więc tej zmiany nie da się z niego cofnąć.',
  // functional_save_template
  'functional_save_template.created': 'Szablon testów funkcjonalnych "{name}" utworzony [{id}].',
  'functional_save_template.updated': 'Szablon testów funkcjonalnych "{name}" zmieniony: {fields}.',
  'functional_save_template.unchanged': 'Szablon testów funkcjonalnych "{name}": nic do zmiany.',
  'functional_save_template.not_undoable':
    'Backend nie przywróci pustej wartości, więc tej części zmiany nie cofnie dziennik: {fields}.',
  'functional_save_template.withheld':
    'Poprzednia wartość zawierała sekret i nie jest zapamiętana, więc tej zmiany nie da się cofnąć z dziennika.',
  'functional_save_template.too_large':
    'Poprzednie wartości są za duże, by trzymać je w dzienniku, więc tej zmiany nie da się z niego cofnąć.',
  // functional_get_catalog
  'functional_get_catalog.kind.test_types': 'bazowych typów testów',
  'functional_get_catalog.kind.validators': 'bazowych walidatorów',
  'functional_get_catalog.kind.assertion_types': 'typów asercji',
  'functional_get_catalog.header': {
    one: '{count} pozycja katalogu {kind}:',
    few: '{count} pozycje katalogu {kind}:',
    many: '{count} pozycji katalogu {kind}:',
    other: '{count} pozycji katalogu {kind}:',
  },
  'functional_get_catalog.none.assertion_types':
    'Katalog typów asercji jest na tym serwerze pusty: jego wbudowane typy dodaje osobny zasiew, nie ten od walidatorów. Nazwy w rodzaju status_code czy json_schema to walidatory: functional_get_catalog z kind "validators".',
  'functional_get_catalog.none': 'Katalog {kind} nie ma pasujących pozycji.',
  'functional_get_catalog.more': '  … wypisano {shown} z {total} pozycji',
  'functional_get_catalog.categories': 'kategorie: {list}',
  'functional_get_catalog.one': '{kind}: „{name}”',
  'functional_get_catalog.active': 'aktywny',
  'functional_get_catalog.inactive': 'nieaktywny',
  'functional_get_catalog.builtin': 'wbudowany',
  'functional_get_catalog.label.name': 'nazwa',
  'functional_get_catalog.label.category': 'kategoria',
  'functional_get_catalog.label.state': 'stan',
  'functional_get_catalog.label.type': 'rodzaj',
  'functional_get_catalog.label.description': 'opis',
  'functional_get_catalog.label.parameters': 'parametry',
  'functional_get_catalog.label.prompt': 'szablon promptu',
  'functional_get_catalog.prompt': 'jest (nie pokazany)',
  'error.functional_no_flows.message':
    'Ten projekt nie ma jeszcze testów funkcjonalnych: nie ma flowu do przywrócenia.',
  'error.functional_no_flows.hint':
    'Powiedz użytkownikowi: flowy funkcjonalne powstają z dokumentacji projektu i nie ma do czego wracać. functional_get_flows je wypisuje (pusta lista to potwierdza). Nie ponawiaj.',
  // functional_save_catalog
  'functional_save_catalog.kind.catalog_test_type': 'bazowy typ testu',
  'functional_save_catalog.kind.catalog_validator': 'bazowy walidator',
  'functional_save_catalog.kind.catalog_assertion_type': 'typ asercji',
  'functional_save_catalog.card.title':
    'Zapis wpisu katalogu „{name}” (wspólny dla wszystkich projektów)',
  'functional_save_catalog.card.new': 'nowy: {kind}',
  'functional_save_catalog.card.change': 'zmiana: {kind} {id}',
  'functional_save_catalog.card.value': '{field}: „{value}”',
  'functional_save_catalog.card.size': '{field}: długa wartość ({size})',
  'functional_save_catalog.card.builtin': 'to wpis wbudowany',
  'functional_save_catalog.card.undo.created': 'functional_delete usuwa nowy wpis',
  'functional_save_catalog.card.undo.changed':
    'functional_save_catalog z poprzednimi wartościami tych pól',
  'functional_save_catalog.created': '{kind} „{name}” utworzony ({id}).',
  'functional_save_catalog.unchanged':
    '{kind} „{name}”: nic do zmiany, wartości są już takie, jak podano.',
  'functional_save_catalog.updated': '{kind} „{name}” zapisany: {fields}.',
  'functional_save_catalog.not_undoable':
    'Backend nie przyjmie pustej wartości z powrotem, więc {fields} nie są cofane z dziennika.',
  'functional_save_catalog.withheld':
    'Tej zmiany nie da się cofnąć z dziennika: poprzednia wartość zawiera sekret albo jest za duża.',
  // functional_save_test_types
  'functional_save_test_types.card.title': 'Zapis typów testów w projekcie: {n}',
  'functional_save_test_types.card.title_update': 'Zmiana typu testu „{name}”',
  'functional_save_test_types.card.change': 'zmiana typu testu {id}',
  'functional_save_test_types.card.source.custom': 'nowe własne typy testów: {count}',
  'functional_save_test_types.card.source.catalog': 'typy z katalogu do dodania: {count}',
  'functional_save_test_types.card.source.suggestions': 'przyjęte propozycje AI: {count}',
  'functional_save_test_types.card.item': '{name}: {sets}',
  'functional_save_test_types.card.more': 'i jeszcze {count}',
  'functional_save_test_types.card.value': '{field}: „{value}”',
  'functional_save_test_types.card.size': '{field}: długa wartość ({size})',
  'functional_save_test_types.card.undo.add': 'dodany typ testu usuwa functional_delete, po jednym',
  'functional_save_test_types.card.undo.update':
    'functional_save_test_types z poprzednimi wartościami tych pól',
  'functional_save_test_types.added': {
    one: 'Zapisano {count} typ testu:',
    few: 'Zapisano {count} typy testów:',
    many: 'Zapisano {count} typów testów:',
    other: 'Zapisano {count} typu testów:',
  },
  'functional_save_test_types.saved': '- {name} ({id})',
  'functional_save_test_types.more': 'i jeszcze {count}',
  'functional_save_test_types.skipped': {
    one: '{count} już był w projekcie i został pominięty.',
    few: '{count} już były w projekcie i zostały pominięte.',
    many: '{count} już było w projekcie i zostało pominiętych.',
    other: '{count} już było w projekcie i zostało pominiętych.',
  },
  'functional_save_test_types.one_by_one':
    'Dodano kilka, więc dziennik nie trzyma cofnięcia: żeby je cofnąć, usuń je po jednym, tylko na słowo użytkownika.',
  'functional_save_test_types.unchanged':
    'Walidator „{name}”: nic do zmiany, wartości są już takie, jak podano.',
  'functional_save_test_types.updated': 'Walidator „{name}” zapisany: {fields}.',
  'functional_save_test_types.not_undoable':
    'Backend nie przyjmie pustej wartości z powrotem, więc {fields} nie są cofane z dziennika.',
  'functional_save_test_types.withheld':
    'Tej zmiany nie da się cofnąć z dziennika: poprzednia wartość zawiera sekret albo jest za duża.',
  // functional_save_validators
  'functional_save_validators.card.title': 'Zapis walidatorów w projekcie: {n}',
  'functional_save_validators.card.title_update': 'Zmiana walidatora „{name}”',
  'functional_save_validators.card.change': 'zmiana walidatora {id}',
  'functional_save_validators.card.source.custom': 'nowe własne walidatory: {count}',
  'functional_save_validators.card.source.catalog': 'walidatory z katalogu do dodania: {count}',
  'functional_save_validators.card.source.proposals': 'przyjęte propozycje AI: {count}',
  'functional_save_validators.card.item': '{name}: {sets}',
  'functional_save_validators.card.more': 'i jeszcze {count}',
  'functional_save_validators.card.value': '{field}: „{value}”',
  'functional_save_validators.card.size': '{field}: długa wartość ({size})',
  'functional_save_validators.card.undo.add': 'dodany walidator usuwa functional_delete, po jednym',
  'functional_save_validators.card.undo.update':
    'functional_save_validators z poprzednimi wartościami tych pól',
  'functional_save_validators.added': {
    one: 'Zapisano {count} walidator:',
    few: 'Zapisano {count} walidatory:',
    many: 'Zapisano {count} walidatorów:',
    other: 'Zapisano {count} walidatora:',
  },
  'functional_save_validators.saved': '- {name} ({id})',
  'functional_save_validators.more': 'i jeszcze {count}',
  'functional_save_validators.skipped': {
    one: '{count} już był w projekcie i został pominięty.',
    few: '{count} już były w projekcie i zostały pominięte.',
    many: '{count} już było w projekcie i zostało pominiętych.',
    other: '{count} już było w projekcie i zostało pominiętych.',
  },
  'functional_save_validators.one_by_one':
    'Dodano kilka, więc dziennik nie trzyma cofnięcia: żeby je cofnąć, usuń je po jednym, tylko na słowo użytkownika.',
  'functional_save_validators.unchanged':
    'Walidator „{name}”: nic do zmiany, wartości są już takie, jak podano.',
  'functional_save_validators.updated': 'Walidator „{name}” zapisany: {fields}.',
  'functional_save_validators.not_undoable':
    'Backend nie przyjmie pustej wartości z powrotem, więc {fields} nie są cofane z dziennika.',
  'functional_save_validators.withheld':
    'Tej zmiany nie da się cofnąć z dziennika: poprzednia wartość zawiera sekret albo jest za duża.',
  // functional_suggest_validators
  'functional_suggest_validators.card.title':
    'Propozycje walidatorów z dokumentacji API i zapisanych przebiegów',
  'functional_suggest_validators.card.docs':
    'czyta dokumentację API {id} i zapisane przebiegi projektu',
  'functional_suggest_validators.card.cost': 'jedno uruchomienie modelu; nic nie jest zapisywane',
  'functional_suggest_validators.card.undo': 'nic nie jest zapisywane, to tylko propozycje',
  'functional_suggest_validators.none':
    'Brak propozycji walidatorów: model rozważył {considered}, zabezpieczenia odrzuciły {rejected}.',
  'functional_suggest_validators.basis.no_operations':
    'Oparte na braku operacji: dokumentacja żadnych nie ma.',
  'functional_suggest_validators.basis.schema_only':
    'Oparte tylko na schematach dokumentacji, bez zapisanych odpowiedzi: pewność jest ograniczona.',
  'functional_suggest_validators.basis.recorded_responses': 'Oparte na zapisanych odpowiedziach.',
  'functional_suggest_validators.header': {
    one: 'Zaproponowano {count} walidator (nic nie jest zapisane):',
    few: 'Zaproponowano {count} walidatory (nic nie jest zapisane):',
    many: 'Zaproponowano {count} walidatorów (nic nie jest zapisane):',
    other: 'Zaproponowano {count} walidatora (nic nie jest zapisane):',
  },
  'functional_suggest_validators.item': '- {name} ({display}): {bucket}, pewność {confidence}%',
  'functional_suggest_validators.description': '  opis: {text}',
  'functional_suggest_validators.template': '  szablon: {text}',
  'functional_suggest_validators.params': '  parametry: {text}',
  'functional_suggest_validators.rationale': '  dlaczego: {text} (dowód: {source}, {count})',
  'functional_suggest_validators.more': 'i jeszcze {count}, niepokazane',
  'functional_suggest_validators.already': 'Projekt ma już {count} podobnych walidatorów.',
  'functional_suggest_validators.next':
    'Żeby zapisać któryś, wywołaj functional_save_validators z source proposals: nazwa jako klucz items, a display_name, description, template, default_params (parametry powyżej) i rationale jako jej pola.',
  // functional_delete
  'functional_delete.card.title.flow': 'Usunięcie: przepływ „{name}”',
  'functional_delete.card.item.flow': 'przepływ {id}',
  'functional_delete.card.what.flow': 'przepływ i jego zapisane wersje są usuwane',
  'functional_delete.done.flow': 'Przepływ „{name}” usunięty.',
  'functional_delete.card.title.template': 'Usunięcie: szablon „{name}”',
  'functional_delete.card.item.template': 'szablon {id}',
  'functional_delete.card.what.template': 'szablon jest usuwany',
  'functional_delete.done.template': 'Szablon „{name}” usunięty.',
  'functional_delete.card.title.test_type': 'Usunięcie: typ testu „{name}”',
  'functional_delete.card.item.test_type': 'typ testu {id}',
  'functional_delete.card.what.test_type': 'znika z tego projektu',
  'functional_delete.done.test_type': 'Typ testu „{name}” usunięty.',
  'functional_delete.card.title.validator': 'Usunięcie: walidator „{name}”',
  'functional_delete.card.item.validator': 'walidator {id}',
  'functional_delete.card.what.validator': 'znika z tego projektu',
  'functional_delete.done.validator': 'Walidator „{name}” usunięty.',
  'functional_delete.card.title.run': 'Usunięcie: przebieg „{name}”',
  'functional_delete.card.item.run': 'przebieg {id}',
  'functional_delete.card.what.run': 'przebieg i jego wyniki są usuwane',
  'functional_delete.done.run': 'Przebieg „{name}” usunięty.',
  'functional_delete.card.title.catalog_test_type': 'Usunięcie: typ testu z katalogu „{name}”',
  'functional_delete.card.item.catalog_test_type': 'typ testu z katalogu {id}',
  'functional_delete.card.what.catalog_test_type':
    'znika ze wspólnego katalogu, więc ze wszystkich projektów',
  'functional_delete.done.catalog_test_type': 'Typ testu z katalogu „{name}” usunięty.',
  'functional_delete.card.title.catalog_validator': 'Usunięcie: walidator z katalogu „{name}”',
  'functional_delete.card.item.catalog_validator': 'walidator z katalogu {id}',
  'functional_delete.card.what.catalog_validator':
    'znika ze wspólnego katalogu, więc ze wszystkich projektów',
  'functional_delete.done.catalog_validator': 'Walidator z katalogu „{name}” usunięty.',
  'functional_delete.card.title.catalog_assertion_type':
    'Usunięcie: typ asercji z katalogu „{name}”',
  'functional_delete.card.item.catalog_assertion_type': 'typ asercji z katalogu {id}',
  'functional_delete.card.what.catalog_assertion_type':
    'znika ze wspólnego katalogu, więc ze wszystkich projektów',
  'functional_delete.done.catalog_assertion_type': 'Typ asercji z katalogu „{name}” usunięty.',
  'functional_delete.card.flow': 'wersja {version}, bloków: {blocks}',
  'functional_delete.card.status': 'status: {status}',
  'functional_delete.card.builtin': 'to wpis wbudowany',
  'functional_delete.card.undo': 'usunięcie jest na stałe',
  'functional_delete.irreversible': 'Tego nie da się cofnąć.',
  // functional_suggest_test_types
  'functional_suggest_test_types.card.title': 'Propozycje typów testów z dokumentacji API',
  'functional_suggest_test_types.card.docs': 'czyta dokumentację API {id} projektu',
  'functional_suggest_test_types.card.focus': 'nacisk: {focus}',
  'functional_suggest_test_types.card.cost': 'jedno uruchomienie modelu; nic nie jest zapisywane',
  'functional_suggest_test_types.card.undo': 'nic nie jest zapisywane, to tylko propozycje',
  // the run on the test types (suggest and generate): progress and the finished view
  'functional.test_types_run.progress': '{what}: {step} ({percent}%)',
  'functional.test_types_run.what.suggest': 'Propozycje typów testów',
  'functional.test_types_run.what.generate': 'Generowanie typów testów',
  'functional.test_types_run.step.prepare_context': 'czytanie dokumentacji API',
  'functional.test_types_run.step.run_operation': 'model pracuje',
  'functional.test_types_run.unknown': 'nie podano',
  'functional.test_types_run.more': 'i jeszcze {count}, niepokazane',
  'functional.test_types_run.omitted': 'Model nie zobaczył {count} operacji dużego API.',
  'functional.test_types_run.suggest.none': 'Brak propozycji typów testów.',
  'functional.test_types_run.suggest.header': {
    one: 'Zaproponowano {count} typ testu (nic nie jest zapisane):',
    few: 'Zaproponowano {count} typy testów (nic nie jest zapisane):',
    many: 'Zaproponowano {count} typów testów (nic nie jest zapisane):',
    other: 'Zaproponowano {count} typu testów (nic nie jest zapisane):',
  },
  'functional.test_types_run.suggest.item': '- {name} ({display}), kategoria {category}',
  'functional.test_types_run.suggest.description': '  opis: {text}',
  'functional.test_types_run.suggest.outcome': '  oczekiwany wynik: {text}',
  'functional.test_types_run.suggest.prompt': '  prompt wejść: {text}',
  'functional.test_types_run.suggest.why': '  dlaczego: {text} (przykładowych wejść: {examples})',
  'functional.test_types_run.suggest.next':
    'Żeby zapisać któryś, wywołaj functional_save_test_types z source suggestions: nazwa jako klucz items, a category, display_name, description, input_prompt (prompt wejść powyżej) i expected_outcome jako jej pola.',
  'functional.test_types_run.generate.done':
    'Typy testów wygenerowane: utworzono {created}, projekt miał już {skipped}.',
  'functional.test_types_run.generate.created': '- {name} ({id})',
  'functional.test_types_run.generate.why': 'LoadCraft pisze: {text}',
  'functional.test_types_run.generate.one_by_one':
    'Utworzono kilka, więc dziennik nie trzyma cofnięcia: żeby je cofnąć, usuń je po jednym, tylko na słowo użytkownika.',
  'error.functional_test_types_failed.message':
    'Uruchomienie na typach testów nie powiodło się: {cause}.',
  'error.functional_test_types_failed.hint':
    'Nic nie zapisano. Uruchom je jeszcze raz; jeśli znów się nie uda, powiedz użytkownikowi.',
  // functional_generate_test_types
  'functional_generate_test_types.card.title': 'Wygenerowanie brakujących bazowych typów testów',
  'functional_generate_test_types.card.missing': {
    one: 'w projekcie brakuje {count} bazowego typu testu: {names}',
    few: 'w projekcie brakuje {count} bazowych typów testów: {names}',
    many: 'w projekcie brakuje {count} bazowych typów testów: {names}',
    other: 'w projekcie brakuje {count} bazowego typu testów: {names}',
  },
  'functional_generate_test_types.card.categories': 'tylko kategorie: {categories}',
  'functional_generate_test_types.card.cost':
    'jedno uruchomienie modelu, które uzupełnia oczekiwany wynik każdego typu',
  'functional_generate_test_types.card.undo':
    'functional_delete usuwa utworzony typ testu, po jednym',
  // functional_generate_payloads
  'functional_generate_payloads.card.title': 'Generowanie payloadów dla flowów: {n}',
  'functional_generate_payloads.card.flows': 'flowy: {names}',
  'functional_generate_payloads.card.types': 'typy testów: {names}',
  'functional_generate_payloads.card.type': '{name} (przypadków: {cases})',
  'functional_generate_payloads.card.cases': 'przypadków testowych do wygenerowania: {cases}',
  'functional_generate_payloads.card.target_default':
    'ZIP zapisze się jako nowy plik w loadcraft/payloads/; żaden plik nie jest nadpisywany',
  'functional_generate_payloads.card.target_file':
    'ZIP zapisze się w {file}, a gdy nazwa jest zajęta pod następną wolną; żaden plik nie jest nadpisywany',
  'functional_generate_payloads.card.cost':
    'jedno uruchomienie modelu na flow i typ testu: {n} flowów x {types} typów testów',
  'functional_generate_payloads.card.undo': 'zapisuje tylko lokalny plik; usuń go ręcznie',
  'functional_generate_payloads.progress': 'Generowanie payloadów: {step} ({percent}%)',
  'functional_generate_payloads.step.prepare': 'przygotowanie',
  'functional_generate_payloads.step.generate': 'model generuje',
  'functional_generate_payloads.step.package': 'pakowanie ZIP-a',
  'functional_generate_payloads.done':
    'Payloady dla flowów: {flows}, typów testów: {types} (przypadków: {cases}) zapisane w {path} ({bytes} bajtów).',
  'functional_generate_payloads.next':
    'ZIP nie jest tu czytany: rozpakuj go po payloady, jeden plik na żądanie każdego przypadku.',
  'error.functional_payloads_failed.message': 'Generowanie payloadów nie powiodło się: {cause}.',
  'error.functional_payloads_failed.hint':
    'Nic nie zapisano. Uruchom je jeszcze raz (nowa karta, „tak” użytkownika); jeśli znów się nie uda, powiedz użytkownikowi.',
  'error.functional_payloads_lost.message':
    'Payloady wygenerowano, ale ZIP-a nie da się już pobrać: LoadCraft wydaje go raz.',
  'error.functional_payloads_lost.hint':
    'Nic nie zapisano. Wygeneruj je jeszcze raz (nowa karta, „tak” użytkownika).',
  'error.functional_payloads_file.message':
    'Pliku {file} nie można użyć: ma to być ścieżka względna w katalogu projektu, kończąca się na .zip, bez ukrytego katalogu i bez „..”.',
  'error.functional_payloads_file.hint':
    'Podaj inną ścieżkę albo żadnej: ZIP trafi wtedy do loadcraft/payloads/.',
};
