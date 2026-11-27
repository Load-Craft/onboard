// Texts of the line of an operation in progress, in both languages. A module of its own with no
// imports and no `process`, so that the mod can take just these (the whole dictionaries are far
// larger than the status line needs); the server's dictionaries spread them in under the same keys.

export const operationEn = {
  'status.operation.needsUser': 'waiting for the user: {what}',
  'runStart.progress.building': 'building… {time}',
  'runStart.progress.test': 'test {time}',
  'runStart.progress.rps': '{value} requests/s',
  'runStart.progress.p95': 'p95≈ {value}',
  'runStart.progress.errors': 'errors {value}',
} as const;

export const operationPl = {
  'status.operation.needsUser': 'czeka na użytkownika: {what}',
  'runStart.progress.building': 'budowanie… {time}',
  'runStart.progress.test': 'test {time}',
  'runStart.progress.rps': '{value} żądań/s',
  'runStart.progress.p95': 'p95≈ {value}',
  'runStart.progress.errors': 'błędy {value}',
} as const;
