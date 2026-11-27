// An address from the project's own configuration as a view may show it: origin and path only (no
// credentials, query or fragment), masked as a third party's text, made one line.

import { content, type CallContext } from '../moduleCall.js';

export function addressOf(
  ctx: CallContext,
  raw: string | null | undefined,
  max = 300,
): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const url = new URL(raw);
    const path = url.pathname === '/' ? '' : url.pathname;
    return content(ctx, `${url.origin}${path}`, max);
  } catch {
    return content(ctx, raw.split(/[?#]/u)[0] ?? '', max);
  }
}
