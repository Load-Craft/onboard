// Texts of the project profile: `project_get`, the card and the result of `project_set_profile`,
// and the fields the analysis was unsure of (in the result of `project_analyze_setup` and in the
// status). Spread into both dictionaries under the same keys.

export const profileEn = {
  'projectProfile.header': 'profile of project "{name}":',
  'projectProfile.on': 'on: {fields}',
  'projectProfile.off': 'off: {fields}',
  'projectProfile.none': '—',
  'projectProfile.unsureMark': '(unsure)',
  'projectProfile.uncertain':
    'the analysis was unsure of: {fields} → ask the user; correct a field with project_set_profile',
  'projectProfile.stats': 'flows {flows} · runs {runs} · passed {passRate}% · last run {lastRun}',
  'projectProfile.setup.complete': 'setup complete',
  'projectProfile.telemetry.on': 'log server: {label}',
  'projectProfile.telemetry.off': 'log server: none',
  'projectProfile.card.title': {
    one: 'consent needed: set {count} profile field of project "{name}" (scope {scope}):',
    other: 'consent needed: set {count} profile fields of project "{name}" (scope {scope}):',
  },
  'projectProfile.card.renewed.missing':
    'Nothing was written: there is no card for this token any more (it was used or replaced).',
  'projectProfile.card.renewed.expired': 'Nothing was written: the card has expired.',
  'projectProfile.card.renewed.expired_at':
    'Nothing was written: the card issued at {time} has expired (a card is valid for {minutes} min).',
  'projectProfile.card.renewed.token':
    'Nothing was written: the token is not the one of the current card.',
  'projectProfile.card.renewed.changed':
    'Nothing was written: the profile or the fields differ from the card the user agreed to.',
  'projectProfile.change': '{field}: {current} → {value}',
  'projectProfile.unchanged': 'already set: {fields}',
  'projectProfile.card.next':
    'Nothing was written. Show this card to the user; only after a yes repeat the call with the same fields and confirm: "{confirm}".',
  'projectProfile.set.title': {
    one: '{count} profile field set in project "{name}":',
    other: '{count} profile fields set in project "{name}":',
  },
  'projectProfile.set.nothing': 'nothing to change in project "{name}": every value is already set',
  'projectProfile.set.reset':
    'flows built from now on use this profile; the self-check, the compiled scenario, the planned run and the HAR analysis are to be checked again',
  'projectProfile.stillUncertain':
    'still unsure after the analysis: {fields} → ask the user about them',
  'projectProfile.analysis.uncertain': {
    one: '{count} field unsure (low confidence or sources disagree), ask the user before applying:',
    other:
      '{count} fields unsure (low confidence or sources disagree), ask the user before applying:',
  },
  'projectProfile.analysis.confidence': 'confidence {pct}%',
  'projectProfile.analysis.conflicted': 'sources disagree',
  'projectProfile.analysis.fix': 'a correction after applying: project_set_profile',
  'projectProfile.analysis.needsConfirmation': "needs the user's confirmation, {confidence}",
  'projectProfile.analysis.confirm':
    'a field that needs a confirmation is not applied: ask the user, then set it with project_set_profile, whose card the user agrees to',
  'projectProfile.architecture.unknown': 'not determined: ask the user how the client is built',
  'projectProfile.provenance.heading': 'where the applied values came from:',
};

export const profilePl = {
  'projectProfile.header': 'profil projektu „{name}”:',
  'projectProfile.on': 'włączone: {fields}',
  'projectProfile.off': 'wyłączone: {fields}',
  'projectProfile.none': '—',
  'projectProfile.unsureMark': '(niepewne)',
  'projectProfile.uncertain':
    'analiza nie była pewna: {fields} → zapytaj użytkownika; pole poprawia project_set_profile',
  'projectProfile.stats':
    'flowy {flows} · przebiegi {runs} · zaliczone {passRate}% · ostatni przebieg {lastRun}',
  'projectProfile.setup.complete': 'ustawienia kompletne',
  'projectProfile.telemetry.on': 'serwer logów: {label}',
  'projectProfile.telemetry.off': 'serwer logów: brak',
  'projectProfile.card.title': {
    one: 'potrzebna zgoda: ustawić {count} pole profilu projektu „{name}” (zakres {scope}):',
    few: 'potrzebna zgoda: ustawić {count} pola profilu projektu „{name}” (zakres {scope}):',
    many: 'potrzebna zgoda: ustawić {count} pól profilu projektu „{name}” (zakres {scope}):',
    other: 'potrzebna zgoda: ustawić {count} pola profilu projektu „{name}” (zakres {scope}):',
  },
  'projectProfile.card.renewed.missing':
    'Nic nie zapisano: karty z tym tokenem już nie ma (została użyta albo zastąpiona).',
  'projectProfile.card.renewed.expired': 'Nic nie zapisano: karta straciła ważność.',
  'projectProfile.card.renewed.expired_at':
    'Nic nie zapisano: karta wydana o {time} straciła ważność (karta jest ważna {minutes} min).',
  'projectProfile.card.renewed.token': 'Nic nie zapisano: token nie należy do bieżącej karty.',
  'projectProfile.card.renewed.changed':
    'Nic nie zapisano: profil albo pola różnią się od karty, na którą użytkownik się zgodził.',
  'projectProfile.change': '{field}: {current} → {value}',
  'projectProfile.unchanged': 'już ustawione: {fields}',
  'projectProfile.card.next':
    'Nic nie zapisano. Pokaż tę kartę użytkownikowi; dopiero po „tak” powtórz wywołanie z tymi samymi polami i confirm: "{confirm}".',
  'projectProfile.set.title': {
    one: 'ustawiono {count} pole profilu projektu „{name}”:',
    few: 'ustawiono {count} pola profilu projektu „{name}”:',
    many: 'ustawiono {count} pól profilu projektu „{name}”:',
    other: 'ustawiono {count} pola profilu projektu „{name}”:',
  },
  'projectProfile.set.nothing':
    'nic do zmiany w projekcie „{name}”: każda wartość jest już ustawiona',
  'projectProfile.set.reset':
    'flowy budowane od teraz używają tego profilu; self-check, skompilowany scenariusz, plan przebiegu i analizę HAR trzeba sprawdzić ponownie',
  'projectProfile.stillUncertain':
    'nadal niepewne po analizie: {fields} → zapytaj o nie użytkownika',
  'projectProfile.analysis.uncertain': {
    one: '{count} pole niepewne (niska pewność albo sprzeczne źródła), zapytaj użytkownika przed zastosowaniem:',
    few: '{count} pola niepewne (niska pewność albo sprzeczne źródła), zapytaj użytkownika przed zastosowaniem:',
    many: '{count} pól niepewnych (niska pewność albo sprzeczne źródła), zapytaj użytkownika przed zastosowaniem:',
    other:
      '{count} pola niepewne (niska pewność albo sprzeczne źródła), zapytaj użytkownika przed zastosowaniem:',
  },
  'projectProfile.analysis.confidence': 'pewność {pct}%',
  'projectProfile.analysis.conflicted': 'sprzeczne źródła',
  'projectProfile.analysis.fix': 'poprawka po zastosowaniu: project_set_profile',
  'projectProfile.analysis.needsConfirmation': 'wymaga potwierdzenia użytkownika, {confidence}',
  'projectProfile.analysis.confirm':
    'pole wymagające potwierdzenia nie zostanie zastosowane: zapytaj użytkownika, potem ustaw je przez project_set_profile, na którego kartę użytkownik się zgadza',
  'projectProfile.architecture.unknown':
    'nieustalona: zapytaj użytkownika, jak zbudowany jest klient',
  'projectProfile.provenance.heading': 'skąd pochodzą zastosowane wartości:',
};
