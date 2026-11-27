// The view of a consent card (docs/consent-card.md): the title and the lines a tool gives (what
// will happen, on what), and what the block adds from the catalog entry: the cost, whether it can
// be undone, why it is asked on its own (level 3), and the next step. The question the client shows
// the person carries the same lines, so the person confirms what the conversation showed.

import type { Translator } from '../context.js';

/** What a tool says on its card, in the language of the call. */
export interface CardView {
  readonly title: string;
  /** What will happen and on what, one fact a line. */
  readonly lines: readonly string[];
  /** What the call costs; given exactly when the catalog entry names a cost. */
  readonly cost?: string;
  /** How it is undone, or why it cannot be, or why there is nothing to undo. */
  readonly undo: string;
}

/** Why a new card was made although one was kept. */
export type CardRenewed = 'expired' | 'changed';

/** The data of a call that only made a card: nothing was done, the person has not been asked yet. */
export interface ConsentCardData<C> {
  readonly consent: 'needed';
  readonly tool: string;
  /** 3 for a tool of level 3 and for a call that meets an escalation of the catalog. */
  readonly level: 2 | 3;
  /** The facts of the tool, as it masked them. */
  readonly card: C;
  /** Values the card shows that move by themselves: shown, not part of what binds the card. */
  readonly volatile?: Readonly<Record<string, string | number | boolean | null>>;
  readonly costly: boolean;
  readonly reversible: 'yes' | 'no' | 'nothing';
  /** The reason of level 3 (`delete`, or the escalation); null on a level-2 card. */
  readonly why: string | null;
  readonly valid_minutes: number;
  readonly renewed?: CardRenewed;
}

export function isConsentCard(data: unknown): data is ConsentCardData<unknown> {
  return (
    typeof data === 'object' && data !== null && 'consent' in data && data.consent === 'needed'
  );
}

type Shared = Pick<ConsentCardData<unknown>, 'tool' | 'costly' | 'reversible' | 'why'>;

/** The lines the card and the question share, after the title and the tool's own lines. */
function terms(data: Shared, view: CardView, t: Translator): string[] {
  // the catalog entry decides whether the card has a cost line; the tool only words it
  if (data.costly !== (view.cost !== undefined)) {
    throw new TypeError(
      `${data.tool}: the card ${data.costly ? 'must say' : 'says'} a cost the catalog entry ${data.costly ? 'names' : 'does not name'}`,
    );
  }
  const lines: string[] = [];
  if (view.cost !== undefined) lines.push(t('consent.card.cost', { cost: view.cost }));
  lines.push(t(`consent.card.undo.${data.reversible}`, { how: view.undo }));
  if (data.why !== null) lines.push(t(`consent.card.why.${data.why}`));
  return lines;
}

/** The card as the conversation shows it. */
export function renderConsentCard(
  data: ConsentCardData<unknown>,
  view: CardView,
  t: Translator,
): string {
  return [
    t('consent.card.header', { level: data.level, title: view.title }),
    ...view.lines.map((line) => `  ${line}`),
    ...terms(data, view, t),
    ...(data.renewed === undefined ? [] : [t(`consent.card.renewed.${data.renewed}`)]),
    t('consent.card.next', { tool: data.tool, minutes: data.valid_minutes }),
  ].join('\n');
}

/** The question the client shows the person: plain text, the model never answers it. */
export function renderConsentQuestion(data: Shared, view: CardView, t: Translator): string {
  return [view.title, ...view.lines, ...terms(data, view, t), t('consent.question.tick')].join(
    '\n',
  );
}
