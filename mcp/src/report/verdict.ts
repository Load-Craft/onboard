/**
 * Run verdict: the state a run ended in and why.
 *
 * This is a second copy of a rule owned by the LoadCraft frontend, which is the only place the
 * backend's facts are combined today. Source of truth:
 *   loadcraft @ d93e08d808fa600074a8118c719d1cbd3e2d5865
 *   frontend/src/features/gatling/pages/resultsVerdict.ts (last changed in ef95d17bfb07)
 * `test/fixtures/verdict-cases.json` is derived from the same branches and tests. When the frontend
 * rule changes, this file and that table have to be re-checked together.
 *
 * Vocabulary mapping (frontend kind -> state):
 *   ok                      -> sla_passed (the exact SLA verdict says passed) or
 *                              sla_not_judged (no exact verdict, or a refused one)
 *   sla_fail,
 *   sla_and_invariants_fail -> sla_failed (violated invariants are named in `reasons`)
 *   invariants_violated     -> invariants_violated
 *   completed_with_errors   -> completed_with_errors
 *   run_fail                -> run_failed
 *   cancelled, in_progress  -> the same
 * The invariants-not-evaluated warning is the reason `invariants_not_evaluated`, never a state.
 */

export type VerdictState =
  | 'sla_passed'
  | 'sla_failed'
  | 'sla_not_judged'
  | 'invariants_violated'
  | 'completed_with_errors'
  | 'run_failed'
  | 'cancelled'
  | 'in_progress';

export type ExecutionStatus =
  'pending' | 'building' | 'running' | 'completed' | 'failed' | 'cancelled';

/** The exact SLA verdict, cut to what the rule reads (frontend `SlaVerdict`). */
export interface SlaVerdictFact {
  status: 'passed' | 'failed' | 'refused';
  reason?: string | null;
}

/**
 * The stored invariant report, cut to what the rule reads (frontend `RunAggregateReportSummary`).
 * Only an `evaluated` report has rows to read.
 */
export type InvariantSummaryFact =
  | {
      state: 'evaluated';
      results: { name: string; status: string; passed: boolean }[];
      value_ledger?: {
        state: string;
        rows: { variable: string; verdict?: string; outcome: string }[];
      };
    }
  | { state: 'evaluation_failed'; error_type?: string; error_message?: string }
  | { state: 'evaluating' };

export interface VerdictInput {
  status: ExecutionStatus;
  run_exit_code?: number | null;
  sla_verdict?: SlaVerdictFact | null;
  invariant_summary?: InvariantSummaryFact | null;
  result_has_errors?: boolean | null;
}

export interface Verdict {
  state: VerdictState;
  /** Stable machine codes; the render layer turns them into text. */
  reasons: string[];
}

/**
 * Gatling's exit code for "ran to completion, assertions violated"
 * (resultsVerdict.ts:84 `ASSERTIONS_FAILED_EXIT_CODE`).
 */
const ASSERTIONS_FAILED_EXIT_CODE = 2;

/**
 * resultsVerdict.ts:96-101 `slaMissed`: the exact verdict decides when present; the exit code
 * decides only a row that has none.
 */
function slaFailure(input: VerdictInput): { failed: boolean; reason: string | null } {
  const exact = input.sla_verdict;
  if (exact) {
    return exact.status === 'failed'
      ? { failed: true, reason: 'sla_failed' }
      : { failed: false, reason: null };
  }
  return input.run_exit_code === ASSERTIONS_FAILED_EXIT_CODE
    ? { failed: true, reason: 'sla_exit_code_2_legacy' }
    : { failed: false, reason: null };
}

interface InvariantFacts {
  violated: string[];
  notEvaluated: boolean;
}

/**
 * resultsVerdict.ts:166-192 `withInvariants`, first half. Only an evaluated report has rows; a
 * failed or unfinished evaluation is a warning, because unknown is not violated. A row is violated
 * only when it was evaluated and did not pass (`passed: false` alone is not enough: an
 * insufficient-data row can carry it). A value-ledger row whose outcome is `fail` is violated; an
 * undecided row, or a ledger that is not `measured`, is a warning.
 */
function readInvariants(summary: InvariantSummaryFact | null | undefined): InvariantFacts {
  if (!summary) return { violated: [], notEvaluated: false };
  if (summary.state !== 'evaluated') return { violated: [], notEvaluated: true };
  const rows = summary.results;
  const ledger = summary.value_ledger;
  const ledgerRows = ledger?.rows ?? [];
  const violated = [
    ...rows
      .filter((row) => row.status === 'evaluated' && !row.passed)
      .map((row) => `invariant_violated:${row.name}`),
    ...ledgerRows
      .filter((row) => row.outcome === 'fail')
      .map((row) => `value_ledger_failed:${row.variable}`),
  ];
  const ledgerUndecided =
    ledger !== undefined &&
    (ledger.state !== 'measured' || ledgerRows.some((row) => row.outcome === 'undecided'));
  const notEvaluated = ledgerUndecided || rows.some((row) => row.status === 'insufficient_data');
  return { violated, notEvaluated };
}

/**
 * resultsVerdict.ts:193-203 `withInvariants`, second half: precedence of a finished run's states.
 * SLA failure (with or without violated invariants) > violated invariants > errors > pass.
 */
function finishedVerdict(
  input: VerdictInput,
  sla: { failed: boolean; reason: string | null },
): Verdict {
  const invariants = readInvariants(input.invariant_summary);
  const warning = invariants.notEvaluated ? ['invariants_not_evaluated'] : [];
  const violated = invariants.violated.length > 0;

  if (sla.failed) {
    return {
      state: 'sla_failed',
      reasons: [sla.reason ?? 'sla_failed', ...invariants.violated, ...warning],
    };
  }
  if (violated) {
    return { state: 'invariants_violated', reasons: [...invariants.violated, ...warning] };
  }
  const refused =
    input.sla_verdict?.status === 'refused'
      ? [`sla_refused:${input.sla_verdict.reason ?? 'unknown'}`]
      : [];
  if (input.result_has_errors === true) {
    return {
      state: 'completed_with_errors',
      reasons: [...refused, 'result_has_errors', ...warning],
    };
  }
  const judged = input.sla_verdict?.status === 'passed';
  return { state: judged ? 'sla_passed' : 'sla_not_judged', reasons: [...refused, ...warning] };
}

/**
 * resultsVerdict.ts:131-164 `deriveVerdict`: status decides first.
 *  - pending / building / running -> in_progress (:141-144)
 *  - completed -> a finished run (:145-150)
 *  - cancelled -> cancelled (:151-152)
 *  - failed -> an SLA failure only when the SLA facts say so (a legacy exit-2 row, or an exact
 *    failed verdict); otherwise run_failed. A refused exact verdict is a run failure whose SLA
 *    was never read (:153-162).
 */
export function runVerdict(execution: VerdictInput): Verdict {
  switch (execution.status) {
    case 'pending':
    case 'building':
    case 'running':
      return { state: 'in_progress', reasons: [] };
    case 'cancelled':
      return { state: 'cancelled', reasons: [] };
    case 'completed':
      return finishedVerdict(execution, slaFailure(execution));
    case 'failed': {
      const sla = slaFailure(execution);
      if (sla.failed) return finishedVerdict(execution, sla);
      const refused =
        execution.sla_verdict?.status === 'refused'
          ? [`sla_refused:${execution.sla_verdict.reason ?? 'unknown'}`]
          : [];
      return { state: 'run_failed', reasons: refused };
    }
  }
}
