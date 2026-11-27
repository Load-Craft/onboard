// Texts of the tools of module flows, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { flowsEn } from './flows.en.js';

export const flowsPl: { readonly [K in keyof typeof flowsEn]: Entry } = {
  'flows_export_walk_image.snapshot':
    'Zapisano obraz na żywo kroku {step}, próby {attempt} przejścia {handle}: {size}.',
  'flows_export_walk_image.still': 'Zapisano klatkę {still} przejścia {handle}: {size}.',
  'flows_export_walk_image.ignored':
    'Folder jest ignorowany przez git: obraz pokazuje to, co wyświetliła aplikacja.',
  'error.flows_walk_image_exists.message': 'Obraz o tej nazwie jest już zapisany w {path}.',
  'error.flows_walk_image_exists.hint':
    'Otwórz ten obraz albo wywołaj ponownie z overwrite: true, żeby go zastąpić.',
  'error.flows_walk_image_not_an_image.message':
    'Backend odpowiedział czymś, co nie jest obrazem PNG, JPEG ani WebP; nic nie zapisano.',
  'error.flows_walk_image_not_an_image.hint':
    'Nie ponawiaj tego samego wywołania. Powiedz użytkownikowi; przejście mogło się skończyć albo strony już nie ma.',
  'flows_save.why.unknown_step': 'zarys flowa nie ma takiego kroku',
  'flows_save.why.nested_step': 'jest wewnątrz grupy albo warunku',
  'flows_save.why.container': 'to sama grupa, pętla albo warunek',
  'flows_save.why.branching': 'prowadzi dalej dwiema drogami',
  'flows_save.why.would_empty': 'flow zostałby bez żadnego kroku',
  'flows_save.created': 'Flow „{name}” utworzony: v{version}, {steps}.',
  'flows_save.unchanged': 'Flow „{name}” już to mówi; nic się nie zmieniło.',
  'flows_save.saved': 'Flow „{name}” zapisany jako v{version} (było v{previous}): {what}.',
  'flows_save.dropped': 'usunięte kroki {steps}',
  'flows_save.graph_replaced': 'graf wymieniony',
  'flows_save.reason': 'Powód: {reason}',
  'flows_save.renamed': 'Flow „{name}” przemianowany (było „{from}”).',
  'flows_save.described': 'Flow „{name}” opisany.',
  'flows_save.description_changed': 'Opis zmieniony.',
  'flows_save.steps': {
    one: '{count} krok',
    few: '{count} kroki',
    many: '{count} kroków',
    other: '{count} kroku',
  },
  'error.flows_save_step_not_droppable.message': 'Kroku {step} nie można usunąć: {why}.',
  'error.flows_save_step_not_droppable.hint':
    'Usuwaj tylko kroki najwyższego poziomu zarysu z flows_get (żądanie albo pauzę), jeden łańcuch naraz; dla kroku w grupie albo warunku i dla flowa, który zostałby pusty, zapytaj użytkownika.',
  'error.flows_save_secret_in_graph.message':
    'Graf niesie sekret wpisany wprost w {path}; nic nie wysłano.',
  'error.flows_save_secret_in_graph.hint':
    'Wartość nagłówka, pola ciała albo zmiennej o nazwie jak token, hasło albo klucz nie jest zapisywana tym narzędziem: odwołaj się do niej przez odwołanie do zmiennej, a wartość trzymaj w środowisku albo danych testowych. Nigdy nie pytaj użytkownika o wartość do wpisania tutaj.',
  'flows_get_copilot_history.header': {
    one: 'Rozmowa z copilotem o flowie „{name}” ({count} tura):',
    few: 'Rozmowa z copilotem o flowie „{name}” ({count} tury):',
    many: 'Rozmowa z copilotem o flowie „{name}” ({count} tur):',
    other: 'Rozmowa z copilotem o flowie „{name}” ({count} tury):',
  },
  'flows_get_copilot_history.empty': 'Copilot nie rozmawiał jeszcze o flowie „{name}”.',
  'flows_get_copilot_history.more': 'pokazano ostatnie {shown} z {count} tur',
  'flows_get_copilot_history.proposed': 'propozycja: {type} — {description}',
  'flows_get_copilot_history.suggestions': 'Sugestie copilota dla flowa „{name}” ({count}):',
  'flows_get_copilot_history.suggestion': '{text} (blok {block})',
  'flows_get_copilot_history.no_suggestions': 'Copilot nie ma sugestii dla flowa „{name}”.',
  'flows_get_walks.header': {
    one: '{count} przejście:',
    few: '{count} przejścia:',
    many: '{count} przejść:',
    other: '{count} przejścia:',
  },
  'flows_get_walks.empty': 'Nie masz przejść w tym projekcie.',
  'flows_get_walks.more': 'pokazano pierwsze {shown} z {count} przejść',
  'flows_get_walks.awaits_approval': 'czeka na zatwierdzenie podziału',
  'flows_get_walks.at_step': 'krok {step}',
  'flows_get_walks.selected': 'wybrane',
  'flows_get_walks.walk_header': 'Przejście {handle} ({status}): {title}',
  'flows_get_walks.error': 'błąd: {text}',
  'flows_get_walks.all_failed': 'każda ścieżka zawiodła',
  'flows_get_walks.paths': 'ścieżki:',
  'flows_get_walks.steps': {
    one: '{count} krok',
    few: '{count} kroki',
    many: '{count} kroków',
    other: '{count} kroku',
  },
  'flows_get_walks.partial': 'częściowa',
  'flows_get_walks.flow': 'flow {id}',
  'flows_get_walks.saved': 'zapisane flowy:',
  'flows_get_walks.timeline': 'oś czasu:',
  'flows_get_walks.timeline_unavailable':
    'oś czasu: niedostępna (sesja przeglądu jest zamknięta albo przejście nie jest Twoje)',
  'flows_get_walks.review_until': 'przegląd otwarty do {at}',
  'flows_get_walks.plan': 'plan ścieżki {path}, próba {attempt}: {steps}',
  'flows_get_walks.step_line': 'ścieżka {path} próba {attempt} krok {step}: {label}',
  'flows_get_walks.note': 'notatka przy kroku {step} (ścieżka {path}): {text}',
  'flows_get_walks.other_events': 'inne zdarzenia: {events}',
  'flows_get_versions.header': {
    one: '{count} wersja flowa „{name}”:',
    few: '{count} wersje flowa „{name}”:',
    many: '{count} wersji flowa „{name}”:',
    other: '{count} wersji flowa „{name}”:',
  },
  'flows_get_versions.empty': 'Flow „{name}” nie ma zapisanych wersji.',
  'flows_get_versions.more': 'pokazano najnowsze {shown} z {count} wersji',
  'flows_get_versions.version_header': 'Wersja {version} flowa „{name}” ({day})',
  'flows_restore_version.warning.source_endpoints_not_restored':
    'Uwaga: przywrócenie cofnęło flow do innej wersji dokumentacji; te endpointy przestały być źródłowymi endpointami flowa: {endpoints}',
  'flows_restore_version.warning.spec_version_missing':
    'Uwaga: przywrócone kroki są związane z wersją dokumentacji, której już nie ma; flow zostaje przy swojej wersji dokumentacji.',
  'flows_restore_version.warning.spec_versions_mixed':
    'Uwaga: przywrócone kroki są związane z więcej niż jedną wersją dokumentacji; flow zostaje przy swojej wersji, przenieś go (flows_migrate_docs), by kroki były na jednej.',
  'flows_save_walk_note.added': 'Notatka dodana przy kroku {step}: "{text}"',
  'flows_save_walk_note.changed': 'Notatka {id} zmieniona przy kroku {step}: "{text}"',
  'flows_save_walk_note.unchanged': 'Notatka {id} już tak brzmi; nic nie zmieniono.',
  'flows_save_walk_note.remembered':
    'Jest też zapamiętana jako notatka projektu na kolejne przejścia.',
  'flows_save_walk_note.no_undo_new':
    'Nowej notatki nie da się cofnąć z dziennika: jeśli jest niepotrzebna, usuń ją w aplikacji.',
  'flows_save_walk_note.withheld':
    'Poprzedni tekst zawierał sekret i nie jest zapamiętany, więc tej zmiany nie da się cofnąć z dziennika.',
  'flows_duplicate.made': {
    one: 'Wykonano {count} kopię: {names}.',
    few: 'Wykonano {count} kopie: {names}.',
    many: 'Wykonano {count} kopii: {names}.',
    other: 'Wykonano {count} kopii: {names}.',
  },
  'flows_duplicate.onto_docs':
    'Wykonano 1 kopię: {name} na dokumentacji v{version} (kroki: {matched} bez zmian, {changed} zmienionych, {unmatched} nieprzepiętych, z {steps}).',
  'flows_duplicate.none': 'Nie wykonano żadnej kopii.',
  'flows_duplicate.failed': 'Nie skopiowano: {ids}',
  'flows_merge.done': '{name} utworzony z {count} flowów.',
  'flows_merge.warning': 'Uwaga: {warning}',
  'flows_restore_version.warning.other': 'Uwaga: przywrócenie zgłosiło "{code}".',
  'flows_restore_version.done':
    '{name}: v{version} przywrócona jako v{new} (v{previous} była bieżąca).',
  'flows_restore_version.nothing_restored': '(nic nie przywrócono)',
  'flows_restore_version.unchanged':
    '{name}: v{version} jest już bieżącą wersją; nic nie zmieniono.',
  'flows_list.header': {
    one: '{count} flow:',
    few: '{count} flowy:',
    many: '{count} flowów:',
    other: '{count} flowu:',
  },
  'flows_list.steps': {
    one: '{count} krok',
    few: '{count} kroki',
    many: '{count} kroków',
    other: '{count} kroku',
  },
  'flows_list.open': 'otwarte pytania: {count} (pewne: {definite})',
  'flows_list.inactive': 'nieaktywny',
  'flows_list.outdated': 'dokumentacja nieaktualna',
  'flows_list.empty': 'Ten projekt nie ma jeszcze flowów.',
  'flows_list.no_match': 'Żadna nazwa flowa nie zawiera „{query}”; odczytano {fetched} flowów.',
  'flows_list.more': 'pokazano pierwsze {shown} z {count} flowów',
  'flows_list.cut': 'projekt ma {total} flowów; odczytano {fetched} ostatnio zmienionych',
  // flows_ask_copilot
  'flows_ask_copilot.card.title': 'Pytanie do copilota flowa „{name}”',
  'flows_ask_copilot.card.flow': 'flow {id}, który czyta copilot',
  'flows_ask_copilot.card.review': 'bez pytania: copilot robi swój standardowy przegląd flowa',
  'flows_ask_copilot.card.message': 'pyta: „{message}”',
  'flows_ask_copilot.card.proposes': 'proponuje zmiany; żadna nie jest stosowana ani zapisywana',
  'flows_ask_copilot.card.cost': 'jedno albo dwa wywołania modelu (LLM) na tę turę',
  'flows_ask_copilot.card.undo': 'flow zostaje bez zmian',
  'flows_ask_copilot.header': 'Copilot flowa „{name}”:',
  'flows_ask_copilot.header_review': 'Copilot flowa, standardowy przegląd „{name}”:',
  'flows_ask_copilot.reply': 'odpowiedź: {reply}',
  'flows_ask_copilot.no_changes': 'Nie proponuje żadnych zmian.',
  'flows_ask_copilot.changes': {
    one: 'Zaproponowana zmiana: {count} (nic nie zastosowano):',
    few: 'Zaproponowane zmiany: {count} (nic nie zastosowano):',
    many: 'Zaproponowanych zmian: {count} (nic nie zastosowano):',
    other: 'Zaproponowanych zmian: {count} (nic nie zastosowano):',
  },
  'flows_ask_copilot.type.add': 'dodaj',
  'flows_ask_copilot.type.modify': 'zmień',
  'flows_ask_copilot.type.remove': 'usuń',
  'flows_ask_copilot.warnings': {
    one: '({count} ostrzeżenie)',
    few: '({count} ostrzeżenia)',
    many: '({count} ostrzeżeń)',
    other: '({count} ostrzeżenia)',
  },
  'flows_ask_copilot.more': 'pokazano pierwsze {shown} z {total} zmian',
  'flows_ask_copilot.proposal': 'Propozycja {id}: backend ją trzyma; nic nie zastosowano.',
  // flows_set_poll_terminals
  'flows_set_poll_terminals.done':
    'Pętla odpytywania „{field}” we flowie „{name}” ma odpowiedź: zapisano v{version} (wcześniej v{previous}).',
  'flows_set_poll_terminals.success': 'statusy powodzenia: {statuses}',
  'flows_set_poll_terminals.failure': 'statusy niepowodzenia: {statuses}',
  'flows_set_poll_terminals.no_failure': 'bez statusów niepowodzenia',
  'flows_set_poll_terminals.none_open': 'Na flowie nie zostało żadne otwarte pytanie.',
  'flows_set_poll_terminals.open': {
    one: 'Na flowie nadal jest otwarte {count} pytanie.',
    few: 'Na flowie nadal są otwarte {count} pytania.',
    many: 'Na flowie nadal jest otwartych {count} pytań.',
    other: 'Na flowie nadal jest otwartych {count} pytania.',
  },
  'flows_set_poll_terminals.undo':
    'Cofnięcie: flows_restore_version z wersją {previous}; przywraca bloki i otwarte pytanie.',
  // flows_apply_copilot_changes
  'flows_apply_copilot_changes.applied':
    'Zastosowano {applied} z {requested} zmian copilota we flowie „{name}”: zapisano v{version} (wcześniej v{previous}).',
  'flows_apply_copilot_changes.not_applied':
    'Żadna z {requested} zmian copilota nie została zastosowana we flowie „{name}”: backend odrzucił wszystkie, wersja nie została zapisana.',
  'flows_apply_copilot_changes.only_rejected':
    'Żadna zmiana nie została zastosowana we flowie „{name}”.',
  'flows_apply_copilot_changes.warning': 'ostrzeżenie przy zmianie {change}: {message}',
  'flows_apply_copilot_changes.rejected': {
    one: 'Zapisano jako odrzucone: {ids}.',
    few: 'Zapisano jako odrzucone: {ids}.',
    many: 'Zapisano jako odrzucone: {ids}.',
    other: 'Zapisano jako odrzucone: {ids}.',
  },
  'flows_apply_copilot_changes.not_recorded':
    'Flow został zapisany, ale zapis, co przyjęto i co odrzucono, się nie udał: historia może pokazywać zmiany bez wyniku.',
  'flows_apply_copilot_changes.undo':
    'Cofnięcie: flows_restore_version z wersją {previous}. Przywraca flow; wyniki zostają zapisane w historii.',
  'flows_apply_copilot_changes.no_undo':
    'Żadna wersja nie została zapisana, więc nie ma czego cofać.',
  'error.flows_copilot_turn_unknown.message': 'Historia copilota tego flowa nie ma tury „{id}”.',
  'error.flows_copilot_turn_unknown.hint':
    'Nic się nie zmieniło. Użyj message_id, który zwrócił flows_ask_copilot albo pokazuje flows_get_copilot_history przy turze ze zmianami.',
  'error.flows_copilot_change_unknown.message': 'Tura copilota nie ma zmiany o id {ids}.',
  'error.flows_copilot_change_unknown.hint':
    'Nic się nie zmieniło. Zmiany tej tury mają id: {known}.',
  'error.flows_apply_version_conflict.message':
    'Flow nie jest już w wersji {version}: zmienił się po odczycie propozycji, więc nic nie zastosowano.',
  'error.flows_apply_version_conflict.hint':
    'Odczytaj flow jeszcze raz (flows_get) i poproś copilota o nową propozycję dopasowaną do jego obecnego stanu.',
  'flows_regenerate.card.title': 'Ponowne wygenerowanie flowu „{name}”',
  'flows_regenerate.card.rewrites':
    'przebieg modelu wyprowadza flow na nowo z nagranych źródeł i zapisuje nową wersję nad v{version} (bloków: {blocks})',
  'flows_regenerate.card.description': 'wygenerowany na nowo z tego opisu: „{description}”',
  'flows_regenerate.card.skip_validators': 'walidatory nowej wersji nie są generowane',
  'flows_regenerate.card.failed_run':
    'przebieg, który zawiedzie albo trafi na źródło, którego nie umie odwzorować, zostawia flow bez zmian',
  'flows_regenerate.card.cost': 'około jednej generacji LLM',
  'flows_regenerate.card.undo': 'flows_restore_version przywraca v{version}',
  'flows_regenerate.running': 'Generuję na nowo „{name}”…',
  'flows_regenerate.progress': 'Generuję na nowo „{name}”: {step}…',
  'flows_regenerate.done': 'flow „{name}” wygenerowany na nowo: v{previous} → v{version}',
  'flows_regenerate.undo': 'cofnięcie: flows_restore_version z wersją {previous}',
  'error.flows_regenerate_unavailable.message':
    'Flowu „{name}” nie da się wygenerować na nowo: nie ma nagranych endpointów ani operacji źródłowych.',
  'error.flows_regenerate_unavailable.hint':
    'Flow zrobiony ręcznie albo z nagrania nie ma z czego się regenerować; zbuduj nowy narzędziem flows_generate_*.',
  'error.flows_regenerate_changed.message': 'Flow „{name}” zmienił się po wystawieniu karty.',
  'error.flows_regenerate_changed.hint':
    'Nic nie wystartowało. Wywołaj flows_regenerate ponownie: karta pokaże flow takim, jaki jest teraz.',
  'error.flows_regenerate_failed.message':
    'Ponowne wygenerowanie flowu „{name}” się nie udało: {detail}',
  'error.flows_regenerate_failed.hint':
    'Flow jest, jaki był. Przebieg kończy źródło, którego LoadCraft nie umie odwzorować, brak specyfikacji albo nieudana kontrola: popraw to i wywołaj ponownie.',
};
