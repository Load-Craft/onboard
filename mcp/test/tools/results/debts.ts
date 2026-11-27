// The debts of module results: the tools of the catalog that are not written tools of the module,
// with why.

import type { ToolDebts } from '../../helpers/moduleClosure.js';

/**
 * Four tools are still today's tools, registered under the catalog's names outside the module (their
 * move into it is a task of its own).
 */
export const RESULTS_DEBTS: ToolDebts = {
  results_get_report: 'legacy',
  results_get_errors: 'legacy',
  results_get_traces: 'legacy',
  results_analyze_run: 'legacy',
};
