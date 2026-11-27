// Texts of the cards above the prompt (the mod's notification card), in both languages. A module of
// its own with no imports and no `process`, so that the mod can take just these; the server's
// dictionaries spread them in under the same keys.

export const cardEn = {
  'card.end.done': 'Test finished',
  'card.end.failed': 'Failed: {what}',
  'card.end.noReason': 'No reason given. Open the panel or ask Claude.',
  'card.docs.title': {
    one: '{count} flow is on an older version of the API documentation',
    other: '{count} flows are on an older version of the API documentation',
  },
  'card.profile.title': {
    one: '{count} profile field to confirm',
    other: '{count} profile fields to confirm',
  },
  'card.names': '{names}',
  'card.namesMore': '{names} and {count} more',
  'card.action.show': 'show',
  'card.action.ask': 'ask Claude',
  'card.action.close': 'close',
  'card.action.later': 'later',
  'card.action.preview': 'preview migration',
  'card.action.fields': 'show fields',
  'card.queue': '+{count} more',
  'card.toast': '{title}. Type {command} to see it.',
  'card.panel.title': 'Notices',
  'card.check.repair': 'Self-check “{name}”: step {step} failed — AI repair in progress',
  'card.check.failed': 'Self-check “{name}” did not pass',
} as const;

export const cardPl = {
  'card.end.done': 'Test zakończony',
  'card.end.failed': 'Niepowodzenie: {what}',
  'card.end.noReason': 'Brak podanej przyczyny. Otwórz panel albo zapytaj Claude’a.',
  'card.docs.title': {
    one: '{count} flow jest na starszej wersji dokumentacji API',
    few: '{count} flowy są na starszej wersji dokumentacji API',
    many: '{count} flowów jest na starszej wersji dokumentacji API',
    other: '{count} flowu jest na starszej wersji dokumentacji API',
  },
  'card.profile.title': {
    one: '{count} pole profilu do potwierdzenia',
    few: '{count} pola profilu do potwierdzenia',
    many: '{count} pól profilu do potwierdzenia',
    other: '{count} pola profilu do potwierdzenia',
  },
  'card.names': '{names}',
  'card.namesMore': '{names} i {count} więcej',
  'card.action.show': 'pokaż',
  'card.action.ask': 'zapytaj Claude’a',
  'card.action.close': 'zamknij',
  'card.action.later': 'później',
  'card.action.preview': 'podgląd migracji',
  'card.action.fields': 'pokaż pola',
  'card.queue': '+{count} więcej',
  'card.toast': '{title}. Wpisz {command}, żeby zobaczyć.',
  'card.panel.title': 'Powiadomienia',
  'card.check.repair': 'Self-check „{name}”: krok {step} padł — trwa naprawa AI',
  'card.check.failed': 'Self-check „{name}” nie przeszedł',
} as const;
