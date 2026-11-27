// Lines of the gaps the generator left on a flow. Two classes of its warnings are told apart: a step
// that carries a token issued for another security scheme (`credential_scheme`; `definite` says the
// step gets 401 as built) and a key of the application under test that no environment supplies
// (`static_credential`). Every other gap is one `question` line. Texts from the backend are made one
// plain line first.

import type { Translator } from '../../context.js';
import { inline, VIEW_WIDTH, wrap } from '../primitives.js';

/** A gap the generator left on a flow, with the name of the flow. */
export interface FlowQuestionView {
  readonly flow: string;
  readonly field: string;
  readonly question: string;
  /** What the generator says about the gap; only the credential kinds are told apart. */
  readonly kind?: string;
  readonly why?: string;
  readonly steps?: readonly string[];
  readonly definite?: boolean;
}

const INDENT = '  ';
const MAX_NAME = 80;
const MAX_TEXT = 200;
export const MAX_STEPS = 5;
/** The text of a definite finding names the operation to add, so it is cut late. */
const MAX_WHY = 600;

/** A flow whose steps get 401 as built is no clean success. */
export const isDefinite = (item: FlowQuestionView): boolean =>
  item.kind === 'credential_scheme' && item.definite === true;

export const quoteAll = (names: readonly string[], limit: number): string => {
  const shown = names.slice(0, limit).map((name) => `"${inline(name, MAX_NAME)}"`);
  return names.length > limit ? `${shown.join(', ')} …` : shown.join(', ');
};

export function itemLines(item: FlowQuestionView, t: Translator): string[] {
  const flow = inline(item.flow, MAX_NAME);
  const steps = quoteAll(item.steps ?? [item.field], MAX_STEPS);
  if (item.kind === 'credential_scheme') {
    return wrap(
      t(
        item.definite === true ? 'build.flows.credential.definite' : 'build.flows.credential.doubt',
        {
          flow,
          steps,
        },
      ),
      VIEW_WIDTH,
      INDENT.length,
    ).concat(
      item.definite === true && item.why !== undefined && item.why !== ''
        ? wrap(inline(item.why, MAX_WHY), VIEW_WIDTH - INDENT.length).map((line) => INDENT + line)
        : [],
    );
  }
  if (item.kind === 'static_credential') {
    // the item does not name the environment: the key goes into the one the test runs against
    const where = t('build.flows.static.anyEnv');
    return wrap(
      t('build.flows.static', { flow, header: inline(item.field, MAX_NAME), where }),
      VIEW_WIDTH,
      INDENT.length,
    );
  }
  return wrap(
    t('build.flows.question', { flow, question: inline(item.question, MAX_TEXT) }),
    VIEW_WIDTH,
    INDENT.length,
  );
}

/** The next step for each class of warning, once, however many flows have it. */
export function nextStepLines(items: readonly FlowQuestionView[], t: Translator): string[] {
  const headers = [
    ...new Set(items.filter((i) => i.kind === 'static_credential').map((i) => i.field)),
  ];
  const next = [
    items.some(isDefinite) ? t('build.flows.next.definite') : undefined,
    items.some((i) => i.kind === 'credential_scheme' && i.definite !== true)
      ? t('build.flows.next.doubt')
      : undefined,
    headers.length > 0
      ? t('build.flows.next.static', { headers: quoteAll(headers, MAX_STEPS) })
      : undefined,
  ];
  return next.flatMap((text) =>
    text === undefined ? [] : wrap(`→ ${text}`, VIEW_WIDTH, INDENT.length),
  );
}
