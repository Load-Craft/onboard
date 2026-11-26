// Names of the eight steps of a test session, in both languages. A module of its own with no
// imports and no `process`, so that the mod can take just these (the whole dictionaries are far
// larger than the band needs); the server's dictionaries spread them in under the same keys.

export const stepsEn = {
  'band.step.1': 'API docs',
  'band.step.2': 'Project',
  'band.step.3': 'Flows',
  'band.step.4': 'Scenario',
  'band.step.5': 'Test data',
  'band.step.6': 'Run',
  'band.step.7': 'Report',
  'band.step.8': 'Diagnosis',
  'band.skipped': 'skipped',
} as const;

export const stepsPl = {
  'band.step.1': 'Dokumentacja API',
  'band.step.2': 'Projekt',
  'band.step.3': 'Flow',
  'band.step.4': 'Scenariusz',
  'band.step.5': 'Dane testowe',
  'band.step.6': 'Uruchomienie',
  'band.step.7': 'Raport',
  'band.step.8': 'Diagnoza',
  'band.skipped': 'pominięty',
} as const;
