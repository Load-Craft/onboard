// The views of `functional_generate_payloads`: the card (which flows and test types, how many cases, where the
// ZIP goes, the cost), the progress while the model generates, and the result: the path of the saved ZIP and
// its size. The ZIP is never read: no name from inside it reaches the model. Names arrive masked and made one line.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

export interface PayloadTypeFact {
  readonly name: string;
  readonly cases: number;
}

/** What the card froze. `n` is the slot of the log entry (the count of flows). */
export interface PayloadFacts {
  readonly n: number;
  readonly flows: readonly string[];
  readonly types: readonly PayloadTypeFact[];
  readonly types_count: number;
  /** Test cases the backend will generate: flows x the sum of the cases per test type. */
  readonly cases: number;
  /** The path the ZIP is saved to as the call gave it; absent: a new file under `loadcraft/payloads/`. */
  readonly file?: string;
}

/** The steps of the backend, the only values the progress line takes from it. */
const STEPS = ['prepare', 'generate', 'package'] as const;
export type PayloadStep = (typeof STEPS)[number];
export const isPayloadStep = (value: string): value is PayloadStep =>
  (STEPS as readonly string[]).includes(value);

export interface PayloadsData {
  /** The path of the saved ZIP, relative to the project directory. */
  readonly path: string;
  readonly bytes: number;
  readonly flows: number;
  readonly test_types: number;
  readonly cases: number;
}

const P = 'functional_generate_payloads';

const list = (names: readonly string[], total: number): string =>
  names.join(', ') + (total > names.length ? ', …' : '');

export function cardViewGeneratePayloads(facts: PayloadFacts, t: Translator): CardView {
  const types = facts.types.map((type) =>
    t(`${P}.card.type`, { name: type.name, cases: type.cases }),
  );
  return {
    title: t(`${P}.card.title`, { n: facts.n }),
    lines: [
      t(`${P}.card.flows`, { names: list(facts.flows, facts.n) }),
      t(`${P}.card.types`, { names: list(types, facts.types_count) }),
      t(`${P}.card.cases`, { cases: num(facts.cases, t.locale) }),
      facts.file === undefined
        ? t(`${P}.card.target_default`)
        : t(`${P}.card.target_file`, { file: facts.file }),
    ],
    cost: t(`${P}.card.cost`, { n: facts.n, types: facts.types_count }),
    undo: t(`${P}.card.undo`),
  };
}

export function renderPayloadsProgress(
  state: { readonly step: PayloadStep | null; readonly percent: number },
  t: Translator,
): string {
  return t(`${P}.progress`, {
    step: t(`${P}.step.${state.step ?? 'prepare'}`),
    percent: num(state.percent, t.locale),
  });
}

export function renderPayloads(data: PayloadsData, t: Translator): string {
  return [
    t(`${P}.done`, {
      path: data.path,
      bytes: num(data.bytes, t.locale),
      flows: num(data.flows, t.locale),
      types: num(data.test_types, t.locale),
      cases: num(data.cases, t.locale),
    }),
    t(`${P}.next`),
  ].join('\n');
}
