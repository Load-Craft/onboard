// Moments of the traffic module's views, in UTC: a day, a minute, or a span within a day. The
// backend gives ISO stamps; one that does not parse is shown cut, never as "Invalid Date".

import { inline } from '../primitives.js';

const parsed = (iso: string): string | null => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
};

/** `2026-11-21` */
export function day(iso: string): string {
  return parsed(iso)?.slice(0, 10) ?? inline(iso, 32);
}

/** `2026-11-26 03:00 UTC` */
export function minute(iso: string): string {
  const at = parsed(iso);
  return at === null ? inline(iso, 32) : `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`;
}

/** `2026-11-20 10:00–10:30 UTC` within one day, else `2026-11-26 00:00 – 2026-11-27 00:00 UTC`. */
export function span(startIso: string, endIso: string): string {
  const start = parsed(startIso);
  const end = parsed(endIso);
  if (start === null || end === null) return `${minute(startIso)} – ${minute(endIso)}`;
  return start.slice(0, 10) === end.slice(0, 10)
    ? `${start.slice(0, 10)} ${start.slice(11, 16)}–${end.slice(11, 16)} UTC`
    : `${start.slice(0, 10)} ${start.slice(11, 16)} – ${end.slice(0, 10)} ${end.slice(11, 16)} UTC`;
}
