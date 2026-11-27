// Texts of the tools of module github, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { githubEn } from './github.en.js';

export const githubPl: { readonly [K in keyof typeof githubEn]: Entry } = {
  'github_get_status.linked': 'Połączenie projektu z GitHubem: połączony',
  'github_get_status.signed_in':
    'Połączenie projektu z GitHubem: zalogowany, repozytorium jeszcze nie wybrane',
  'github_get_status.not_linked':
    'Połączenie projektu z GitHubem: brak; repozytorium łączy się w aplikacji LoadCraft, nie w tej wtyczce.',
  'github_get_status.repository': 'repozytorium: {url}{where}',
  'github_get_status.branch_host': ' (gałąź {branch} na {host})',
  'github_get_status.branch': ' (gałąź {branch})',
  'github_get_status.sync': 'synchronizacja: {status}{last}; {auto}; {secret}',
  'github_get_status.last': ', ostatnia {at}',
  'github_get_status.last_commit': ', ostatnia {at} na commicie {commit}',
  'github_get_status.status.not_configured': 'nieskonfigurowana',
  'github_get_status.status.idle': 'bezczynna',
  'github_get_status.status.syncing': 'w toku',
  'github_get_status.status.error': 'błąd',
  'github_get_status.auto_on': 'automatyczna synchronizacja włączona',
  'github_get_status.auto_off': 'automatyczna synchronizacja wyłączona',
  'github_get_status.secret_set': 'sekret webhooka ustawiony',
  'github_get_status.secret_unset': 'bez sekretu webhooka',
  'github_get_status.history': 'ostatnie synchronizacje ({shown} z {total}):',
  'github_get_status.history_none': 'ostatnie synchronizacje: jeszcze żadnej',
  'github_get_status.history_unavailable': 'ostatnie synchronizacje: niedostępne',
  'github_get_status.op.push': 'wysłanie',
  'github_get_status.op.pull': 'pobranie',
  'github_get_status.ok': 'udane',
  'github_get_status.failed': 'nieudane',
  'github_get_status.files': {
    one: 'plików {count}',
    few: 'plików {count}',
    many: 'plików {count}',
    other: 'plików {count}',
  },
  'github_get_status.commit': 'commit {commit}',
  'github_plan_push.header':
    'Plan wysłania kompozycji {composition}: zmieniłoby się plików {files} {changes}',
  'github_plan_push.nothing': 'Plan wysłania kompozycji {composition}: nic by się nie zmieniło.',
  'github_plan_push.status.new': 'nowy',
  'github_plan_push.status.modified': 'zmieniony',
  'github_plan_push.more': 'pokazano pierwsze {shown} z {total} plików',
  'error.github_not_linked.message':
    'Projekt nie jest połączony z repozytorium GitHub, więc {reason}.',
  'error.github_not_linked.rule.push': 'nie ma dokąd wysyłać',
  'error.github_not_linked.rule.read': 'nie ma skąd czytać zmian',
  'error.github_not_linked.hint':
    'Powiedz użytkownikowi: repozytorium łączy się w aplikacji LoadCraft (ustawienia GitHub projektu), nie w tej wtyczce. github_get_status pokazuje połączenie. Nie ponawiaj, dopóki nie zostanie połączone.',
  // github_get_changes
  'github_get_changes.header': {
    one: '{count} plik zmieniony od ostatniej synchronizacji:',
    few: '{count} pliki zmienione od ostatniej synchronizacji:',
    many: '{count} plików zmienionych od ostatniej synchronizacji:',
    other: '{count} pliku zmienionego od ostatniej synchronizacji:',
  },
  'github_get_changes.none':
    'Żaden plik w repozytorium nie zmienił się od ostatniej synchronizacji.',
  'github_get_changes.more': '  … wypisano {shown} z {total} plików',
  'github_get_changes.marker':
    'Znacznik synchronizacji stoi teraz na commicie {commit}: drugie wywołanie zwróci pustą listę, dopóki repozytorium znów się nie zmieni.',
  'github_get_changes.change.added': 'dodany',
  'github_get_changes.change.modified': 'zmieniony',
  'github_get_changes.change.deleted': 'usunięty',
  'github_get_changes.change.other': 'zmiana',
  // github_disconnect
  'github_disconnect.card.title': 'Rozłączenie projektu z {repo}',
  'github_disconnect.card.link': 'usuwa połączenie projektu z repozytorium {repo}',
  'github_disconnect.card.link_branch':
    'usuwa połączenie projektu z repozytorium {repo} (gałąź {branch})',
  'github_disconnect.card.auto_sync': 'automatyczna synchronizacja tego połączenia się kończy',
  'github_disconnect.card.stays':
    'repozytorium i jego pliki nie są ruszane; flow i scenariusze w LoadCraft zostają',
  'github_disconnect.card.undo':
    'użytkownik łączy je z powrotem w aplikacji LoadCraft; potrzebny jest token, żaden nie jest zachowany',
  'github_disconnect.none':
    'Projekt nie jest połączony z repozytorium GitHub; nie ma czego rozłączać.',
  'github_disconnect.done': 'Rozłączono projekt z {repo}.',
  'github_disconnect.again':
    'Żeby połączyć go znów, użytkownik wchodzi do aplikacji LoadCraft (potrzebny jest token; żaden nie jest zachowany).',
  // github_push
  'github_push.no_branch': 'domyślna gałąź',
  'github_push.card.title': 'Wysłanie kompozycji „{name}” do {repo}',
  'github_push.card.commit': 'commit na gałęzi {branch} z komunikatem „{message}”',
  'github_push.card.pr':
    'otwiera pull request zamiast commitu na gałęzi {branch}; komunikat „{message}”',
  'github_push.card.files': {
    one: 'zmienia się {count} plik (+{additions} −{deletions}):',
    few: 'zmieniają się {count} pliki (+{additions} −{deletions}):',
    many: 'zmienia się {count} plików (+{additions} −{deletions}):',
    other: 'zmienia się {count} pliku (+{additions} −{deletions}):',
  },
  'github_push.card.more': '  … pokazano {shown} z {total} plików',
  'github_push.card.leaves': 'wygenerowany kod testów trafia do {repo}, poza LoadCraft',
  'github_push.card.undo': 'nie stąd: commit zostaje w repozytorium, użytkownik cofa go tam',
  'github_push.nothing':
    'Nie ma czego wysyłać: kompozycja {composition} nie ma pliku różniącego się od repozytorium.',
  'github_push.done': {
    one: 'Wysłano {count} plik do {repo} (gałąź {branch}): commit {commit}.',
    few: 'Wysłano {count} pliki do {repo} (gałąź {branch}): commit {commit}.',
    many: 'Wysłano {count} plików do {repo} (gałąź {branch}): commit {commit}.',
    other: 'Wysłano {count} pliku do {repo} (gałąź {branch}): commit {commit}.',
  },
  'github_push.done_pr': {
    one: 'Otwarto pull request w {repo} z {count} plikiem (gałąź {branch}): commit {commit}.',
    few: 'Otwarto pull request w {repo} z {count} plikami (gałąź {branch}): commit {commit}.',
    many: 'Otwarto pull request w {repo} z {count} plikami (gałąź {branch}): commit {commit}.',
    other: 'Otwarto pull request w {repo} z {count} pliku (gałąź {branch}): commit {commit}.',
  },
  'github_push.revert':
    'Wtyczka tego nie cofa: żeby to wycofać, użytkownik robi revert commitu w repozytorium.',
};
