// Whether the server runs under the tests: a few checks of the plugin's own consistency (a missing
// text key, a log entry whose values disagree with the data of the call) fail loudly there and only
// degrade in production.

export function runsUnderTests(): boolean {
  return process.env['VITEST'] !== undefined || process.env['NODE_ENV'] === 'test';
}
