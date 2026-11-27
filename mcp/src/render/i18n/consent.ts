// Texts of the consent card of module tools (`tools/kit/consent.ts`, docs/consent-card.md): the
// lines the block adds to the card of every tool, and the question the client shows the person.
// Spread into both dictionaries under the same keys. The title, the lines, the cost and the undo
// of one tool are its own texts, of its module dictionary (`<tool_name>.card.*`).

export const consentEn = {
  'consent.card.header': 'Consent needed (level {level}) · {title}',
  'consent.card.cost': 'Cost: {cost}',
  'consent.card.undo.yes': 'Can be undone: {how}',
  'consent.card.undo.no': 'Cannot be undone: {how}',
  'consent.card.undo.nothing': 'Nothing to undo: {how}',
  'consent.card.why.delete': 'Asked on its own: it deletes for good.',
  'consent.card.why.secret_ref':
    'Asked on its own: the call names a file that may hold secrets. LoadCraft reads it; its values are never shown.',
  'consent.card.why.protected_env': 'Asked on its own: the environment is protected.',
  'consent.card.why.schedule': 'Asked on its own: it changes a schedule.',
  'consent.card.why.external': 'Asked on its own: it sends data to a service outside LoadCraft.',
  'consent.card.why.scheduled_run':
    'Asked on its own: the saved run has a schedule, so its next start uses this change without another question.',
  'consent.card.renewed.expired': 'The earlier card expired: this is a new one.',
  'consent.card.renewed.changed':
    'The arguments or the facts differ from the earlier card: this is a new one.',
  'consent.card.next':
    'Nothing was done yet. Tell the user what this card says. To go on, call {tool} again with the same arguments: the user is then asked to confirm in a dialog, and only their yes there runs it. The card is valid for {minutes} min.',
  'consent.question.tick': 'Tick the box to confirm. Anything else changes nothing.',
} as const;

export const consentPl = {
  'consent.card.header': 'Potrzebna zgoda (poziom {level}) · {title}',
  'consent.card.cost': 'Koszt: {cost}',
  'consent.card.undo.yes': 'Da się cofnąć: {how}',
  'consent.card.undo.no': 'Nie da się cofnąć: {how}',
  'consent.card.undo.nothing': 'Nie ma czego cofać: {how}',
  'consent.card.why.delete': 'Pytane osobno: usuwa na stałe.',
  'consent.card.why.secret_ref':
    'Pytane osobno: wywołanie wskazuje plik, który może zawierać sekrety. Czyta go LoadCraft; jego wartości nie są nigdzie pokazywane.',
  'consent.card.why.protected_env': 'Pytane osobno: środowisko jest chronione.',
  'consent.card.why.schedule': 'Pytane osobno: zmienia harmonogram.',
  'consent.card.why.external': 'Pytane osobno: wysyła dane do usługi poza LoadCraft.',
  'consent.card.why.scheduled_run':
    'Pytane osobno: zapisany przebieg ma harmonogram, więc następny start użyje tej zmiany bez kolejnego pytania.',
  'consent.card.renewed.expired': 'Poprzednia karta wygasła: to jest nowa.',
  'consent.card.renewed.changed':
    'Argumenty albo fakty różnią się od poprzedniej karty: to jest nowa.',
  'consent.card.next':
    'Nic jeszcze nie zrobiono. Powiedz użytkownikowi, co jest na tej karcie. Żeby iść dalej, wywołaj {tool} jeszcze raz z tymi samymi argumentami: użytkownik dostanie wtedy okno z prośbą o potwierdzenie i dopiero jego „tak” w tym oknie uruchomi wywołanie. Karta jest ważna {minutes} min.',
  'consent.question.tick':
    'Zaznacz pole, żeby potwierdzić. Każda inna odpowiedź niczego nie zmienia.',
} as const;
