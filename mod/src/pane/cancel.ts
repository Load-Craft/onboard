/**
 * The question behind the "Stop test" button of the panel. It is the consent of the cancel call
 * (consent/decide.ts): the same facts, the same wording, the same exact yes label. The facts come
 * from the last reading of the operation that the panel keeps, so no read is needed to ask, and
 * the question carries the time and the numbers of that reading. Pure: no `$`, no clock.
 */

import { consentPlan, decide, readFacts, type Question } from '../consent/decide.js';
import { EMPTY_LEDGER } from '../consent/ledger.js';
import type { Locale } from '../i18n.js';
import type { OperationSnapshot } from '../view/status.js';

/** The tool the button calls: the only call of `process_cancel` the mod ever makes. */
export const CANCEL_TOOL = 'process_cancel';

/** The `process_get_status` answer for an operation, rebuilt from its reading (the form `readFacts` takes). */
function asAnswer(snapshot: OperationSnapshot): Record<string, unknown> {
  return {
    operation: snapshot.operation,
    kind: snapshot.kind,
    elapsed_s: snapshot.elapsed_s,
    ...(snapshot.phase === undefined ? {} : { phase: snapshot.phase }),
    ...(snapshot.load_elapsed_s === undefined ? {} : { load_elapsed_s: snapshot.load_elapsed_s }),
    ...(snapshot.planned_s === undefined ? {} : { planned_s: snapshot.planned_s }),
  };
}

/**
 * The question to ask before the test of `snapshot` is stopped; `undefined` when there is nothing
 * to ask about (the operation is not a test, or has ended already). A consent given earlier is
 * not honoured here: pressing the button always asks.
 */
export function cancelQuestion(snapshot: OperationSnapshot, locale: Locale): Question | undefined {
  if (snapshot.kind !== 'test_run') return undefined;
  const plan = consentPlan(CANCEL_TOOL, { operation: snapshot.operation });
  const facts = plan === undefined ? undefined : readFacts(plan, asAnswer(snapshot));
  if (facts === undefined) return undefined;
  const decision = decide(facts, EMPTY_LEDGER, 0, locale);
  return 'ask' in decision ? decision.ask : undefined;
}
