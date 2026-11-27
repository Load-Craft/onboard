// Texts of the tools of module data, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { dataEn } from './data.en.js';

export const dataPl: { readonly [K in keyof typeof dataEn]: Entry } = {
  'data.semantics.identity': 'tożsamość',
  'data.semantics.secret': 'dane logowania',
  'data.consumption.shared': 'współdzielony',
  'data.consumption.exclusive': 'na wyłączność',
  'data.semantics.entity-ref': 'odwołanie',
  'data.semantics.synthetic': 'zwykła',
  'data.semantics.derived': 'pochodna',
  'data_get_dataset.header':
    'Zbiór "{name}" [{id}]: {type}, {rows}, {consumption}, strategia {strategy}; {origin}',
  'data_get_dataset.rows': {
    one: '{count} wiersz',
    few: '{count} wiersze',
    many: '{count} wierszy',
    other: '{count} wiersza',
  },
  'data_get_dataset.uploaded': 'wgrany',
  'data_get_dataset.generated': 'wygenerowany{edited}',
  'data_get_dataset.generated_for': 'wygenerowany dla scenariusza {scenario}{edited}',
  'data_get_dataset.edited': ', poprawiony ręcznie',
  'data_get_dataset.columns': 'kolumny: {columns}',
  'data_get_dataset.more_columns': 'jeszcze {count}',
  'data_get_dataset.recipe': 'przepis: {recipe}',
  'data_get_dataset.description': 'opis: {text}',
  'data_get_dataset.rows_range': 'wiersze {from}-{to} z {total}',
  'data_get_dataset.rows_none': 'wiersze: brak do pokazania ({total} w zbiorze)',
  'data_get_dataset.rows_unavailable': 'wiersze: niedostępne',
  'data_get_dataset.hidden': '(ukryte kolumny: {columns})',
  'data_get_dataset.consumers': 'używają go ({count}): {items}',
  'data_get_dataset.consumers_none': 'używają go: nikt',
  'data_get_dataset.consumers_unavailable': 'używają go: niedostępne',
  'data_get_dataset.history': 'wersje ({count}): {items}',
  'data_get_dataset.history_none': 'wersje: brak',
  'data_get_dataset.history_unavailable': 'wersje: niedostępne',
  'data_get_dataset.by': 'przez {who}',
  'data_get_dataset.snippet': 'fragment kodu podający dane:',
  'data_get_dataset.snippet_unavailable': 'fragment kodu podający dane: niedostępny',
  'data_get_dataset.redis_ok': 'pula Redis: zostało {remaining}',
  'data_get_dataset.redis_error': 'pula Redis: nie do odczytania ({detail})',
  'data_get_dataset.redis_unavailable': 'pula Redis: niedostępna',
  'data_get_generators.refused': 'nie jest generowana: {reason}',
  'data_get_generators.refused_declarable':
    'nie jest generowana: {reason}; można zadeklarować jako własne dane',
  'data_get_generators.more_choices': 'jeszcze {count}',
  'data_get_slots.kind.scenario': 'scenariusza',
  'data_get_slots.kind.composition': 'kompozycji',
  'data_get_slots.slots': {
    one: '{count} slot',
    few: '{count} sloty',
    many: '{count} slotów',
    other: '{count} slotu',
  },
  'data_get_slots.header': 'Sloty danych {kind} {id}: {slots}, {bound} powiązany',
  'data_get_slots.header_unknown':
    'Sloty danych {kind} {id}: {slots} (powiązania nieznane: nie udało się odczytać szczegółów {kind})',
  'data_get_slots.empty.scenario': 'Ten scenariusz nie ma slotów danych.',
  'data_get_slots.empty.composition': 'Ta kompozycja nie ma slotów danych.',
  'data_get_slots.identity.existing': 'istniejące loginy',
  'data_get_slots.identity.fresh': 'nowe rejestracje',
  'data_get_slots.columns': 'kolumny {columns}',
  'data_get_slots.more': 'jeszcze {count}',
  'data_get_slots.bound': 'powiązany z "{name}"',
  'data_get_slots.bound_id': 'powiązany ze zbiorem {id}',
  'data_get_slots.stale': 'nieaktualne powiązanie (zbiór już nie pasuje)',
  'data_get_slots.unbound': 'bez powiązania',
  'data_get_slots.never': 'nigdy nie generować: {columns}',
  'data_get_slots.generated_rows': {
    one: '{count} wygenerowany wiersz jest w scenariuszu',
    few: '{count} wygenerowane wiersze są w scenariuszu',
    many: '{count} wygenerowanych wierszy jest w scenariuszu',
    other: '{count} wygenerowanego wiersza jest w scenariuszu',
  },
  'data_get_slots.options': 'pasujące zbiory ({count}): {items}',
  'data_get_slots.options_none': 'pasujące zbiory: brak',
  'data_get_slots.option_rows': {
    one: '{count} wiersz',
    few: '{count} wiersze',
    many: '{count} wierszy',
    other: '{count} wiersza',
  },
  'data_get_generators.header': {
    one: '{count} generator:',
    few: '{count} generatory:',
    many: '{count} generatorów:',
    other: '{count} generatora:',
  },
  'data_get_generators.header_columns': {
    one: '{count} kolumna:',
    few: '{count} kolumny:',
    many: '{count} kolumn:',
    other: '{count} kolumny:',
  },
  'data_get_generators.empty': 'Backend nie podaje żadnych generatorów.',
  'data_get_generators.choices': 'wybór: {choices}',
  'data_get_generators.default_choice': '{value} (domyślny)',
  'data_get_generators.generator': 'generator {rule}',
  'data_get_generators.no_generator': 'brak nazwanego generatora',
  'data_get_generators.min': 'od {value}',
  'data_get_generators.max': 'do {value}',
  'data_get_generators.values': {
    one: 'z {count} wartości',
    few: 'z {count} wartości',
    many: 'z {count} wartości',
    other: 'z {count} wartości',
  },
  'data_get_generators.ref': 'odwołuje się do {column}',
  'data_get_copilot_history.header': {
    one: '{count} wiadomość rozmowy w centrum danych:',
    few: '{count} wiadomości rozmowy w centrum danych:',
    many: '{count} wiadomości rozmowy w centrum danych:',
    other: '{count} wiadomości rozmowy w centrum danych:',
  },
  'data_get_copilot_history.header_cut':
    'ostatnie {shown} z {total} wiadomości rozmowy w centrum danych:',
  'data_get_copilot_history.empty': 'Centrum danych nie ma zapisanej rozmowy dla tego projektu.',
  'data_get_copilot_history.role.user': 'Ty',
  'data_get_copilot_history.role.other': '{role}',
  'data_get_copilot_history.actions': 'zaproponował: {kinds}',
  'data_get_copilot_history.chips': {
    one: '{count} szybka odpowiedź',
    few: '{count} szybkie odpowiedzi',
    many: '{count} szybkich odpowiedzi',
    other: '{count} szybkiej odpowiedzi',
  },
  'data_list_datasets.header': {
    one: '{count} zbiór danych:',
    few: '{count} zbiory danych:',
    many: '{count} zbiorów danych:',
    other: '{count} zbioru danych:',
  },
  'data_list_datasets.empty': 'Ten projekt nie ma zbiorów danych.',
  'data_list_datasets.rows': {
    one: '{count} wiersz',
    few: '{count} wiersze',
    many: '{count} wierszy',
    other: '{count} wiersza',
  },
  'data_list_datasets.facts':
    '{type}, {rows}, {consumption}, strategia {strategy}; {origin}; kolumny: {columns}',
  'data_list_datasets.uploaded': 'wgrany',
  'data_list_datasets.generated': 'wygenerowany{edited}',
  'data_list_datasets.generated_for': 'wygenerowany dla scenariusza {scenario}{edited}',
  'data_list_datasets.edited': ', poprawiony ręcznie',
  'data_list_datasets.more_columns': 'jeszcze {count}',
  'data_list_datasets.more': 'pokazano pierwszych {shown} z {total} zbiorów danych',
  // data_set_slot_label
  'data_set_slot_label.done': 'Slot „{slot}” ma teraz etykietę „{label}”.',
  'data_set_slot_label.was': 'etykieta była: „{previous}”',
  'data_set_slot_label.was_none': 'slot nie miał etykiety',
  'data_set_slot_label.unchanged': 'Slot „{slot}”: nic do zmiany, etykieta to już „{label}”.',
  'data_set_slot_label.not_undoable.no_previous':
    'Slot nie miał etykiety, a etykiety nie można wyczyścić, więc tej zmiany nie da się cofnąć z dziennika.',
  'data_set_slot_label.not_undoable.secret':
    'Poprzednia etykieta zawierała sekret, więc nie jest zachowana: tej zmiany nie da się cofnąć z dziennika.',
  // data_restore_dataset
  'data_restore_dataset.done':
    'Zbiór danych „{name}” wrócił do poprzedniej zawartości: {rows} wierszy, {columns} kolumn.',
  'data_restore_dataset.undo':
    'Wywołaj ponownie, by wrócić do zawartości, która została zastąpiona.',
  // data_update_dataset
  'data_update_dataset.card.title': 'Zmiana zbioru danych „{name}”',
  'data_update_dataset.card.name': 'zmiana nazwy: „{from}” -> „{to}”',
  'data_update_dataset.card.description': 'nowy opis: „{to}”',
  'data_update_dataset.card.description_clear': 'wyczyszczenie opisu',
  'data_update_dataset.card.file':
    'wiersze zastąpi plik {file}: {rows} wierszy, {size} bajtów, sha256 {sha}…; kolumny: {columns}',
  'data_update_dataset.card.cost.none': 'nic nie jest wysyłane; zmienia się tylko definicja',
  'data_update_dataset.card.cost.upload': 'wysyła plik ({size} bajtów) do LoadCraft',
  'data_update_dataset.card.undo.definition': 'data_update_dataset z poprzednią nazwą i opisem',
  'data_update_dataset.card.undo.rows':
    'data_restore_dataset przywraca poprzednie wiersze (nazwa albo opis zmienione w tym samym wywołaniu nie są cofane)',
  'data_update_dataset.unchanged':
    'Zbiór danych „{name}”: nic do zmiany, wartości są już takie, jak podano.',
  'data_update_dataset.done': 'Zbiór danych „{name}” zmieniony: {parts}.',
  'data_update_dataset.part.name': 'nazwa',
  'data_update_dataset.part.description': 'opis',
  'data_update_dataset.part.rows': 'wiersze',
  'data_update_dataset.was_name': 'nazwa była: „{previous}”',
  'data_update_dataset.was_description': 'opis był: „{previous}”',
  'data_update_dataset.was_description_none': 'zbiór nie miał opisu',
  'data_update_dataset.rows_now': 'teraz {rows} wierszy, {columns} kolumn',
  'data_update_dataset.undo.definition':
    'Cofnięcie: data_update_dataset z poprzednimi wartościami (znów poprosi o zgodę).',
  'data_update_dataset.undo.rows':
    'Cofnięcie wierszy: data_restore_dataset. Jego drugie wywołanie wraca do poprzedniego stanu.',
  'data_update_dataset.undo.withheld':
    'Tej zmiany nie da się cofnąć z dziennika: poprzednia wartość zawiera sekret.',
  'data_update_dataset.undo.none': 'Nie ma czego cofać.',
  // data_regenerate_dataset
  'data_regenerate_dataset.card.title': 'Ponowne wygenerowanie wierszy zbioru „{name}”',
  'data_regenerate_dataset.card.mode.expand':
    'dopisanie nowych wierszy do {after} (teraz {now}); istniejące wiersze zostają',
  'data_regenerate_dataset.card.mode.reroll':
    'zastąpienie wszystkich {now} wierszy {after} nowymi z przepisu',
  'data_regenerate_dataset.card.recipe': 'przepis: {recipe}',
  'data_regenerate_dataset.card.cost':
    'uruchamia generatory przepisu dla {rows} wierszy; kolumna tworzona przez model woła LLM',
  'data_regenerate_dataset.card.undo': 'data_restore_dataset przywraca poprzednie wiersze',
  'data_regenerate_dataset.done.expand':
    'Zbiór danych „{name}” rozszerzony z {before} do {rows} wierszy ({columns} kolumn).',
  'data_regenerate_dataset.done.reroll':
    'Zbiór danych „{name}” przelosowany: {rows} nowych wierszy zamiast {before} ({columns} kolumn).',
  'data_regenerate_dataset.undo':
    'Cofnięcie: data_restore_dataset ze zbiorem. Jego drugie wywołanie wraca do poprzedniego stanu.',
  'error.data_update_kind.message':
    'Zbiór danych „{name}” ma typ {type}: tu można edytować tylko zbiory z wierszami (csv, tsv, ssv, json).',
  'error.data_update_kind.hint': 'Nic nie zmieniono. Użytkownik edytuje ten zbiór w aplikacji.',
  'error.data_file_changed.message':
    'Plik {file} zmienił się po wystawieniu karty, więc nic nie zostało wysłane.',
  'error.data_file_changed.hint':
    'Wywołaj narzędzie jeszcze raz, żeby dostać kartę dla pliku w obecnym stanie.',
  'error.data_regenerate_no_recipe.message':
    'Zbiór danych „{name}” nie ma zapisanego przepisu, więc LoadCraft nie może wygenerować do niego wierszy.',
  'error.data_regenerate_no_recipe.hint':
    'Nic nie zmieniono. Wczytaj wiersze z pliku przez data_update_dataset albo zapytaj użytkownika.',
  // data_delete
  'data_delete.card.title': 'Usunięcie zbioru danych „{name}”',
  'data_delete.card.item': {
    one: 'zbiór {id} z {rows} wierszem',
    few: 'zbiór {id} z {rows} wierszami',
    many: 'zbiór {id} z {rows} wierszami',
    other: 'zbiór {id} z {rows} wiersza',
  },
  'data_delete.card.users_none': 'żaden scenariusz ani kompozycja go nie czyta',
  'data_delete.card.users_unknown':
    'nie dało się sprawdzić, kto go czyta (backend odmówi usunięcia, gdy ktoś czyta, chyba że wymuszone)',
  'data_delete.card.users': {
    one: 'czyta go {count} scenariusz lub kompozycja, które zostają bez niego: {names}',
    few: 'czytają go {count} scenariusze lub kompozycje, które zostają bez niego: {names}',
    many: 'czyta go {count} scenariuszy i kompozycji, które zostają bez niego: {names}',
    other: 'czyta go {count} scenariusza i kompozycji, które zostają bez niego: {names}',
  },
  'data_delete.card.forced': 'wymuszone: zniknie, choć nadal go używają',
  'data_delete.card.stays':
    'zostają: scenariusze, kompozycje, dotychczasowe przebiegi i ich wyniki',
  'data_delete.card.undo': 'znika na stałe; dane trzeba wygenerować albo wczytać od nowa',
  'data_delete.done': 'Zbiór danych „{name}” usunięty ({count}).',
  'error.data_dataset_in_use.message':
    'Zbiór danych „{name}” nadal czyta {count} scenariuszy lub kompozycji: {users}.',
  'error.data_dataset_in_use.hint':
    'Nic się nie zmieniło. Powiedz użytkownikowi, kto go jeszcze używa. Tylko jeśli mimo to chce go usunąć, wywołaj data_delete jeszcze raz z force: true.',
  'data_delete.stays':
    'Scenariusze, kompozycje i dotychczasowe przebiegi zostają. Tego nie da się cofnąć.',
  // data_ask_copilot
  'data_ask_copilot.card.title': 'Pytanie do copilota danych',
  'data_ask_copilot.card.for.scenario': 'o scenariuszu „{name}” ({id})',
  'data_ask_copilot.card.for.composition': 'o kompozycji „{name}” ({id})',
  'data_ask_copilot.card.message': 'pyta: „{message}”',
  'data_ask_copilot.card.profile': 'z profilem obciążenia: {profile}',
  'data_ask_copilot.card.no_profile': 'bez profilu obciążenia (żaden nie jest wybrany)',
  'data_ask_copilot.card.proposes': 'proponuje działania; żadne nie jest stosowane ani zapisywane',
  'data_ask_copilot.card.cost': 'od jednego do trzech wywołań modelu (LLM) na tę turę',
  'data_ask_copilot.card.undo': 'dane zostają bez zmian',
  'data_ask_copilot.header.scenario': 'Copilot danych o scenariuszu „{name}”:',
  'data_ask_copilot.header.composition': 'Copilot danych o kompozycji „{name}”:',
  'data_ask_copilot.reply': 'odpowiedź: {reply}',
  'data_ask_copilot.no_actions': 'Nie proponuje żadnych działań.',
  'data_ask_copilot.actions': {
    one: 'Zaproponowane działanie: {count} (nic nie zastosowano): {kinds}',
    few: 'Zaproponowane działania: {count} (nic nie zastosowano): {kinds}',
    many: 'Zaproponowanych działań: {count} (nic nie zastosowano): {kinds}',
    other: 'Zaproponowanych działań: {count} (nic nie zastosowano): {kinds}',
  },
  'data_ask_copilot.issues': 'uwagi: {issues}',
  'data_ask_copilot.chips': 'podpowiada pytania: {chips}',
  'data_generate_dataset.card.title.flow': 'Wygeneruj zbiór danych przez AI dla flow {target}',
  'data_generate_dataset.card.title.scenario':
    'Wygeneruj zbiór danych przez AI dla scenariusza {target}',
  'data_generate_dataset.card.title.slot':
    'Wygeneruj zbiór danych przez AI dla slotu {slot} scenariusza {target}',
  'data_generate_dataset.card.for.flow': 'Dla: danych, których potrzebują kroki flow {target}',
  'data_generate_dataset.card.for.scenario': 'Dla: danych scenariusza {target}',
  'data_generate_dataset.card.for.slot': 'Dla: slotu {slot} scenariusza {target}',
  'data_generate_dataset.card.rows': 'Wierszy: {rows}, typ pliku {type}',
  'data_generate_dataset.card.name': 'Nowy zbiór nazwie się {name}',
  'data_generate_dataset.card.enrich.on':
    'Model wzbogaca wartości; zbiór nazwie LoadCraft od slotu',
  'data_generate_dataset.card.enrich.off':
    'Model nie wzbogaca wartości; zbiór nazwie LoadCraft od slotu',
  'data_generate_dataset.card.cost': 'około jedno generowanie przez model na zbiór',
  'data_generate_dataset.card.undo': 'data_delete usuwa nowy zbiór (też pyta użytkownika)',
  'data_generate_dataset.progress.start': 'Zaczynam generowanie zbioru',
  'data_generate_dataset.progress.step': 'Generowanie zbioru: {step} ({percent}%)',
  'data_generate_dataset.step.prepare': 'przygotowanie',
  'data_generate_dataset.step.generate': 'generowanie wierszy',
  'data_generate_dataset.step.format': 'formatowanie',
  'data_generate_dataset.step.save': 'zapis',
  'data_generate_dataset.done.created':
    'Wygenerowano zbiór {name}: {rows} wierszy, kolumn: {columns}.',
  'data_generate_dataset.done.refreshed':
    'Odświeżono zbiór {name} slotu: {rows} wierszy, kolumn: {columns}.',
  'data_generate_dataset.fewer': 'Poprosiłeś o {asked} wierszy; LoadCraft zrobił {rows}.',
  'data_generate_dataset.columns': 'Kolumny: {names}{more}',
  'data_generate_dataset.undo': 'Żeby go usunąć: data_delete z tym zbiorem (pyta użytkownika).',
  'error.data_generate_failed.message': 'LoadCraft nie wygenerował zbioru: {cause}',
  'error.data_generate_failed.hint':
    'Nic nie zapisano. Uruchom ponownie, gdy użytkownik zechce, albo wygeneruj dla scenariusza lub slotu.',
};
