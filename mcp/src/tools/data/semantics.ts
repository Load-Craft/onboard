// What a column holds, as the data tools report it. The backend's word for a column of credentials
// is not passed on: the scope that learns the secrets of a call has registered it (the map of a
// dataset names such a column `password`, and the value of a secret field is masked wherever it
// appears), so it would come back as `[redacted]`. The tools say `secret` instead.

import type { ColumnSemantics } from '../../render/data/semantics.js';

type BackendSemantics = 'identity' | 'credential' | 'entity-ref' | 'synthetic' | 'derived';

export function semanticsOf(value: BackendSemantics | null | undefined): ColumnSemantics | null {
  if (value === undefined || value === null) return null;
  return value === 'credential' ? 'secret' : value;
}

/** The meaning of a column the backend always names (a guess has one for every column). */
export function guessedSemantics(value: BackendSemantics): ColumnSemantics {
  return value === 'credential' ? 'secret' : value;
}
