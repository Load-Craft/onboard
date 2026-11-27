// A moment as the scenario views show it: the day and the minute of an ISO instant, in UTC
// (`2026-11-22 10:00`); a value that is not an ISO instant is shown as it came.

const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u;

export function momentOf(at: string): string {
  const match = ISO.exec(at);
  return match === null ? at : `${match[1] ?? ''} ${match[2] ?? ''}`;
}
