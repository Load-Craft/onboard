// Texts of `project_delete` and `flows_delete`: the card with what goes, the choice between flows
// of one name, the result, and the refusals. Spread into both dictionaries under the same keys.

export const deletionEn = {
  'delete.card.project': {
    one: 'consent needed, cannot be undone: delete {count} project for good (scope {scope}):',
    other: 'consent needed, cannot be undone: delete {count} projects for good (scope {scope}):',
  },
  'delete.card.flow': {
    one: 'consent needed, cannot be undone: delete {count} flow of project "{project}" for good (scope {scope}):',
    other:
      'consent needed, cannot be undone: delete {count} flows of project "{project}" for good (scope {scope}):',
  },
  'delete.item.project': '"{name}" (id {id})',
  'delete.item.flow': '"{name}" (id {id}, v{version}, updated {at})',
  'delete.goes.project':
    'goes with it: flows {flows} · scenarios {scenarios} · compositions {compositions} · docs versions {docs} · environments {environments} · datasets {datasets} · runs {runs}',
  'delete.goes.flow': 'goes with them: every version of these flows',
  'delete.stays.flow':
    'stay, pointing at a deleted flow: scenarios {scenarios} · compositions with them {compositions}',
  'delete.count.unknown': 'unknown',
  'delete.count.more': '{n}+',
  'delete.bound':
    'this repository is bound to "{name}": its binding (loadcraft/project.json) and its process state go too',
  'delete.tests.unknown':
    'whether a test runs on them could not be checked: the deletion is refused until LoadCraft can check it',
  'delete.card.next':
    'Nothing was deleted. Show this card to the user, then repeat the call with the same arguments and confirm: "{confirm}": Claude Code then asks the user in a dialog of its own, and only their yes there deletes; a yes in the chat does not count. Where no dialog can be shown the call is refused, and the user deletes in LoadCraft.',
  'delete.card.renewed.missing':
    'Nothing was deleted: there is no card for this token any more (it was used or replaced); this is a new card.',
  'delete.card.renewed.expired': 'Nothing was deleted: the card had expired; this is a new card.',
  'delete.card.renewed.token':
    'Nothing was deleted: the token is not the one of the current card; this is a new card.',
  'delete.card.renewed.changed':
    'Nothing was deleted: the call names other items than the card the user saw; this is a new card.',
  'delete.choice': {
    one: 'Nothing was deleted and no card was made: {count} name matches more than one flow. Ask the user which to delete:',
    other:
      'Nothing was deleted and no card was made: {count} names match more than one flow. Ask the user which to delete:',
  },
  'delete.choice.name': '"{name}" is {count} flows:',
  'delete.choice.next': 'then call flows_delete again with flow_ids of the chosen flows',
  'delete.done.project': {
    one: '{count} project deleted for good in LoadCraft',
    other: '{count} projects deleted for good in LoadCraft',
  },
  'delete.done.flow': {
    one: '{count} flow of project "{project}" deleted for good',
    other: '{count} flows of project "{project}" deleted for good',
  },
  'delete.done.failed': 'not deleted, LoadCraft did not find them: {ids}',
  'delete.done.unbound':
    'this repository is no longer bound to a LoadCraft project: loadcraft/project.json and the process state of the project are gone; project_create binds it again',
  'delete.done.flows.reset':
    'scenarios, compositions and test data built on them are to be checked again; a scenario of a deleted flow cannot be generated again',
  'delete.done.irreversible': 'this cannot be undone',
  'error.delete_kind_unsupported.message':
    'Nothing was deleted: {tool} does not delete {kind} yet; it deletes {supported}.',
  'error.delete_kind_unsupported.hint': 'The user deletes it in the LoadCraft app.',
  'error.delete_busy.message': 'Nothing was deleted: {operation} is still running on {target}.',
  'error.delete_busy.hint':
    'Follow it with process_wait or stop it with process_cancel, then ask for the deletion again.',
  'error.consent_missing.message':
    'Nothing was deleted: the user did not say yes in the dialog Claude Code showed for this deletion (declined, closed, or no dialog could be shown).',
  'error.consent_missing.hint':
    'Do not repeat the call on your own; ask the user what they want. Where no dialog can be shown (claude -p) the user deletes in the LoadCraft app: {link}',
  'error.run_not_finished.message':
    'Nothing was deleted: a browser walk of this project is still working (walking, walking a path again, or closing its review).',
  'error.run_not_finished.hint': 'Ask for the deletion again once that walk is done.',
  'delete.done.unbindFailed':
    'the deletion is done, but this repository could not be unbound: remove loadcraft/project.json by hand, or bind it to another project with project_create; do not repeat the deletion',
  'delete.ask.project': {
    one: 'Delete for good, this cannot be undone: {count} LoadCraft project',
    other: 'Delete for good, this cannot be undone: {count} LoadCraft projects',
  },
  'delete.ask.flow': {
    one: "Delete for good, this cannot be undone: {count} flow of project '{project}', with every version",
    other:
      "Delete for good, this cannot be undone: {count} flows of project '{project}', with every version",
  },
  'delete.ask.tick': 'Tick the box to delete them; leave it empty to keep them.',
  'error.delete_unchecked.message':
    'Nothing was deleted: LoadCraft could not check that no test runs on {target} (the list of runs could not be read to the end).',
  'error.delete_unchecked.hint':
    'Ask for the deletion again in a while; if it stays so, the user deletes in the LoadCraft app.',
};

export const deletionPl = {
  'delete.card.project': {
    one: 'potrzebna zgoda, bez cofnięcia: usunąć na stałe {count} projekt (zakres {scope}):',
    few: 'potrzebna zgoda, bez cofnięcia: usunąć na stałe {count} projekty (zakres {scope}):',
    many: 'potrzebna zgoda, bez cofnięcia: usunąć na stałe {count} projektów (zakres {scope}):',
    other: 'potrzebna zgoda, bez cofnięcia: usunąć na stałe {count} projektu (zakres {scope}):',
  },
  'delete.card.flow': {
    one: 'potrzebna zgoda, bez cofnięcia: usunąć na stałe {count} flow projektu „{project}” (zakres {scope}):',
    few: 'potrzebna zgoda, bez cofnięcia: usunąć na stałe {count} flowy projektu „{project}” (zakres {scope}):',
    many: 'potrzebna zgoda, bez cofnięcia: usunąć na stałe {count} flowów projektu „{project}” (zakres {scope}):',
    other:
      'potrzebna zgoda, bez cofnięcia: usunąć na stałe {count} flowu projektu „{project}” (zakres {scope}):',
  },
  'delete.item.project': '„{name}” (id {id})',
  'delete.item.flow': '„{name}” (id {id}, v{version}, zmieniony {at})',
  'delete.goes.project':
    'znika z nim: flowy {flows} · scenariusze {scenarios} · kompozycje {compositions} · wersje dokumentacji {docs} · środowiska {environments} · zbiory danych {datasets} · przebiegi {runs}',
  'delete.goes.flow': 'znika z nimi: każda wersja tych flowów',
  'delete.stays.flow':
    'zostają, wskazując usunięty flow: scenariusze {scenarios} · kompozycje z nimi {compositions}',
  'delete.count.unknown': 'nieznane',
  'delete.count.more': '{n}+',
  'delete.bound':
    'to repozytorium jest przypięte do „{name}”: jego powiązanie (loadcraft/project.json) i stan procesu też znikną',
  'delete.tests.unknown':
    'nie udało się sprawdzić, czy trwa na nich test: usunięcie będzie odrzucane, dopóki LoadCraft tego nie sprawdzi',
  'delete.card.next':
    'Nic nie usunięto. Pokaż tę kartę użytkownikowi, potem powtórz wywołanie z tymi samymi argumentami i confirm: "{confirm}": Claude Code zapyta wtedy użytkownika we własnym oknie i usunie tylko jego „tak” tam; „tak” w czacie się nie liczy. Gdzie okna nie da się pokazać, wywołanie zostanie odrzucone, a użytkownik usunie w LoadCraft.',
  'delete.card.renewed.missing':
    'Nic nie usunięto: nie ma już karty dla tego tokenu (została użyta albo zastąpiona); to nowa karta.',
  'delete.card.renewed.expired': 'Nic nie usunięto: karta wygasła; to nowa karta.',
  'delete.card.renewed.token':
    'Nic nie usunięto: token nie należy do bieżącej karty; to nowa karta.',
  'delete.card.renewed.changed':
    'Nic nie usunięto: wywołanie wskazuje inne obiekty niż karta, którą widział użytkownik; to nowa karta.',
  'delete.choice': {
    one: 'Nic nie usunięto i nie powstała karta: {count} nazwa pasuje do kilku flowów. Zapytaj użytkownika, które usunąć:',
    few: 'Nic nie usunięto i nie powstała karta: {count} nazwy pasują do kilku flowów. Zapytaj użytkownika, które usunąć:',
    many: 'Nic nie usunięto i nie powstała karta: {count} nazw pasuje do kilku flowów. Zapytaj użytkownika, które usunąć:',
    other:
      'Nic nie usunięto i nie powstała karta: {count} nazwy pasują do kilku flowów. Zapytaj użytkownika, które usunąć:',
  },
  'delete.choice.name': '„{name}” to {count} flowy:',
  'delete.choice.next': 'potem wywołaj flows_delete jeszcze raz z flow_ids wybranych flowów',
  'delete.done.project': {
    one: '{count} projekt usunięty na stałe w LoadCraft',
    few: '{count} projekty usunięte na stałe w LoadCraft',
    many: '{count} projektów usuniętych na stałe w LoadCraft',
    other: '{count} projektu usunięte na stałe w LoadCraft',
  },
  'delete.done.flow': {
    one: '{count} flow projektu „{project}” usunięty na stałe',
    few: '{count} flowy projektu „{project}” usunięte na stałe',
    many: '{count} flowów projektu „{project}” usuniętych na stałe',
    other: '{count} flowu projektu „{project}” usunięte na stałe',
  },
  'delete.done.failed': 'nieusunięte, LoadCraft ich nie znalazł: {ids}',
  'delete.done.unbound':
    'to repozytorium nie jest już przypięte do projektu LoadCraft: loadcraft/project.json i stan procesu projektu zniknęły; project_create przypnie je znowu',
  'delete.done.flows.reset':
    'scenariusze, kompozycje i dane testowe zbudowane na nich trzeba sprawdzić jeszcze raz; scenariusza usuniętego flowu nie da się wygenerować ponownie',
  'delete.done.irreversible': 'tego nie da się cofnąć',
  'error.delete_kind_unsupported.message':
    'Nic nie usunięto: {tool} nie usuwa jeszcze {kind}; usuwa {supported}.',
  'error.delete_kind_unsupported.hint': 'Użytkownik usuwa to w aplikacji LoadCraft.',
  'error.delete_busy.message': 'Nic nie usunięto: na {target} trwa jeszcze {operation}.',
  'error.delete_busy.hint':
    'Poczekaj na koniec przez process_wait albo zatrzymaj przez process_cancel, potem poproś o usunięcie jeszcze raz.',
  'error.consent_missing.message':
    'Nic nie usunięto: użytkownik nie powiedział „tak” w oknie, które Claude Code pokazał dla tego usunięcia (odmówił, zamknął je albo okna nie dało się pokazać).',
  'error.consent_missing.hint':
    'Nie powtarzaj wywołania sam; zapytaj użytkownika, czego chce. Gdzie okna nie da się pokazać (claude -p), użytkownik usuwa w aplikacji LoadCraft: {link}',
  'error.run_not_finished.message':
    'Nic nie usunięto: przebieg w przeglądarce w tym projekcie jeszcze pracuje (przechodzi ścieżkę, przechodzi ją ponownie albo zamyka przegląd).',
  'error.run_not_finished.hint': 'Poproś o usunięcie jeszcze raz, gdy ten przebieg się skończy.',
  'delete.done.unbindFailed':
    'usunięcie się udało, ale nie udało się odpiąć tego repozytorium: usuń loadcraft/project.json ręcznie albo przypnij je do innego projektu przez project_create; nie powtarzaj usunięcia',
  'delete.ask.project': {
    one: 'Usunąć na stałe, bez cofnięcia: {count} projekt LoadCraft',
    few: 'Usunąć na stałe, bez cofnięcia: {count} projekty LoadCraft',
    many: 'Usunąć na stałe, bez cofnięcia: {count} projektów LoadCraft',
    other: 'Usunąć na stałe, bez cofnięcia: {count} projektu LoadCraft',
  },
  'delete.ask.flow': {
    one: "Usunąć na stałe, bez cofnięcia: {count} flow projektu '{project}', z każdą wersją",
    few: "Usunąć na stałe, bez cofnięcia: {count} flowy projektu '{project}', z każdą wersją",
    many: "Usunąć na stałe, bez cofnięcia: {count} flowów projektu '{project}', z każdą wersją",
    other: "Usunąć na stałe, bez cofnięcia: {count} flowu projektu '{project}', z każdą wersją",
  },
  'delete.ask.tick': 'Zaznacz pole, żeby usunąć; zostaw puste, żeby zachować.',
  'error.delete_unchecked.message':
    'Nic nie usunięto: LoadCraft nie mógł sprawdzić, że na {target} nie trwa żaden test (listy przebiegów nie dało się odczytać do końca).',
  'error.delete_unchecked.hint':
    'Poproś o usunięcie jeszcze raz za chwilę; jeśli tak zostanie, użytkownik usuwa w aplikacji LoadCraft.',
};
