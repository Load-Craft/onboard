// The view of `traffic_delete` and of the lines of its consent card: the snapshot that goes (its
// window, how much it holds, who pushed it) or the push token that is revoked (its label, when it
// was made and last used), and what stays. Labels are texts the sender wrote: they arrive masked and
// made one line. The series and the token itself are never read.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';
import { day, span } from './time.js';

export type TrafficDeleteKind = 'snapshot' | 'token';

/** What the card froze. `names` and `kind` are also the slots of the log entry. */
export interface TrafficDeleteFacts {
  readonly kind: TrafficDeleteKind;
  readonly names: string;
  readonly id: string;
  /** A snapshot: its window (ISO), the rows and routes it holds, and the label of the token that pushed it. */
  readonly window_start?: string;
  readonly window_end?: string;
  readonly rows?: number;
  readonly routes?: number;
  readonly sender?: string | null;
  /** A snapshot: it is the one chosen for the runs of this workspace (the choice is dropped with it). */
  readonly chosen?: boolean;
  /** A token: when it was made and last used (ISO; null: never). */
  readonly created?: string;
  readonly last_used?: string | null;
}

export interface TrafficDeleteData {
  readonly kind: TrafficDeleteKind;
  readonly id: string;
  readonly names: string;
  /** 1 when it was deleted or revoked now; 0 for a token that was revoked already. */
  readonly count: number;
}

export function cardViewTrafficDelete(facts: TrafficDeleteFacts, t: Translator): CardView {
  const lines: string[] = [t(`traffic_delete.card.item.${facts.kind}`, { id: facts.id })];
  if (facts.kind === 'snapshot') {
    lines.push(
      t('traffic_delete.card.snapshot_holds', {
        window: span(facts.window_start ?? '', facts.window_end ?? ''),
        rows: num(facts.rows ?? 0, t.locale),
        routes: num(facts.routes ?? 0, t.locale),
      }),
    );
    if (facts.sender !== null && facts.sender !== undefined) {
      lines.push(t('traffic_delete.card.snapshot_sender', { sender: facts.sender }));
    }
    if (facts.chosen === true) lines.push(t('traffic_delete.card.snapshot_chosen'));
  } else {
    lines.push(
      t(
        facts.last_used === null || facts.last_used === undefined
          ? 'traffic_delete.card.token_never_used'
          : 'traffic_delete.card.token_used',
        {
          created: day(facts.created ?? ''),
          used: day(facts.last_used ?? ''),
        },
      ),
    );
  }
  lines.push(t(`traffic_delete.card.stays.${facts.kind}`));
  return {
    title: t(`traffic_delete.card.title.${facts.kind}`, { name: facts.names }),
    lines,
    undo: t(`traffic_delete.card.undo.${facts.kind}`),
  };
}

export function renderTrafficDelete(data: TrafficDeleteData, t: Translator): string {
  if (data.count === 0) return t('traffic_delete.already', { name: data.names });
  return [
    t(`traffic_delete.done.${data.kind}`, { name: data.names, count: num(data.count, t.locale) }),
    t(`traffic_delete.stays.${data.kind}`),
  ].join('\n');
}
