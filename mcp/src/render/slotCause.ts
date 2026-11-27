// The cause of a data slot that stops a run, as the backend gives it. When a slot is short for a
// reason the counts do not show (a pool of 1,000 rows a run already drew from, no pool at all), the
// backend's own sentence says why; a bare "1,000 of 1 rows" or "no usable dataset" would hide it.

import { withRunHandles, type SpentPool } from '../contract/spentPool.js';
import type { Translator } from '../context.js';
import { num, inline } from './primitives.js';
import { slotRef } from './slotRef.js';

/** What a view knows of one slot of a data check. */
export interface CauseSlot {
  readonly slot: string;
  readonly label: string;
  readonly status: string;
  readonly dataset: string | null;
  readonly have: number | null;
  readonly need: number | null;
  /** The backend's sentence for the slot; a third party's text. */
  readonly message?: string | null;
  readonly identityKind?: 'existing' | 'fresh' | null;
  /** The dataset the backend says to make again, its name already masked; null when none. */
  readonly regenerate?: { readonly datasetId: string; readonly dataset: string | null } | null;
  /** What earlier runs took from the pool, read from the backend's sentence; null when unknown. */
  readonly spent?: SpentPool | null;
}

/** `100 rows, 0 free (spent by e-…), 100 needed · ` when the pool's facts are known, else rows and need. */
function countsOf(
  have: string,
  need: number | null,
  facts: SpentPool | null,
  t: Translator,
): string {
  if (facts === null) {
    return need === null
      ? t('data.cause.have', { have })
      : t('data.cause.both', { have, need: num(need, t.locale) });
  }
  const by =
    facts.runs.length === 0
      ? t('data.cause.byEarlier')
      : t('data.cause.by', { runs: facts.runs.join(', ') });
  const free = num(facts.free, t.locale);
  return need === null
    ? t('data.cause.spent', { have, free, by })
    : t('data.cause.spentNeed', { have, free, by, need: num(need, t.locale) });
}

/** A sentence longer than this is cut; the backend's cause sentences run to about 500 characters. */
const CAUSE_LIMIT = 520;
const NAME_LIMIT = 120;

/**
 * `label: counts · the backend's sentence`, or null when the counts say it all: the slot is not
 * short of rows, has no sentence, or has fewer rows than the load needs (then "2 of 5 rows" is the
 * whole story). The counts name what they are, and only when a dataset is bound to the slot.
 */
export function slotCause(slot: CauseSlot, t: Translator, labelLimit?: number): string | null {
  if (slot.status !== 'short_rows') return null;
  const spent = slot.regenerate ?? null;
  if (spent === null) {
    if (slot.message == null) return null;
    if (slot.have !== null && slot.need !== null && slot.have < slot.need) return null;
  }
  const backend = withRunHandles(inline(slot.message ?? '', CAUSE_LIMIT));
  if (backend === '' && spent === null) return null;
  const facts = slot.spent ?? null;
  const have = slot.dataset !== null && slot.have !== null ? num(slot.have, t.locale) : null;
  const counts = have === null ? '' : countsOf(have, slot.need, facts, t);
  // The backend writes English. A view in another language says the facts it could read in its own
  // words and keeps a sentence it could not read as a quote of the backend (DOKTOR-02).
  const message =
    t.locale === 'en'
      ? backend
      : facts !== null
        ? facts.rereads === null
          ? ''
          : t('data.cause.rereads', { strategy: inline(facts.rereads, NAME_LIMIT) })
        : backend === ''
          ? ''
          : t('data.cause.backend', { message: backend });
  const fresh = slot.identityKind === 'fresh';
  // The backend's fix names the dataset to make again; it then says the way on itself, so the
  // generic sentence of a slot of new identities gives way to it (the kind is still named).
  const kind =
    spent !== null
      ? fresh
        ? t('data.cause.identity', { identity: t('data.identity.fresh') })
        : ''
      : fresh
        ? t('data.cause.fresh', { identity: t('data.identity.fresh') })
        : '';
  const fix =
    spent === null
      ? ''
      : t('data.cause.regenerate', {
          dataset: inline(spent.dataset ?? slot.dataset ?? spent.datasetId, NAME_LIMIT),
          id: spent.datasetId,
        });
  const whole = t('data.cause', {
    label: slotRef(slot.label, slot.slot, t, labelLimit),
    counts,
    message: message === '' ? fix.replace(/^ · /u, '') : message,
    kind: message === '' ? kind : `${kind}${fix}`,
  });
  // Facts with nothing after them leave a separator with nothing on its other side.
  return whole.replace(/ · (?: · )+/gu, ' · ').replace(/ · $/u, '');
}
