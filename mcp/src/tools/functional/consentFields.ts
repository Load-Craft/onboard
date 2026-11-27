// The facts of the fields a call writes, for the consent cards of module functional: a short plain
// value is kept as masked text, any other by its size; a text is read by the mask first, so a secret
// it holds is registered before anything is kept or shown.

import type { FieldFact } from '../../render/functional/consentFields.js';
import { thirdParty, type CallContext } from '../kit/transitional.js';

const SHORT = 80;
const LONG_READ = 120;

export function factOf(ctx: CallContext, field: string, value: unknown): FieldFact {
  if (typeof value === 'string' && value.length <= SHORT && !value.includes('\n')) {
    return { field, value: thirdParty(ctx, value, SHORT), size: 0 };
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return { field, value: String(value), size: 0 };
  }
  if (typeof value === 'string') thirdParty(ctx, value, LONG_READ);
  const size = typeof value === 'string' || Array.isArray(value) ? value.length : 1;
  return { field, value: null, size };
}
