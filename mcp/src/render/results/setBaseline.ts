// The view of `results_set_baseline`: which run is the baseline now, the baseline that was there
// before, and how to undo the change (or why it cannot be undone). Only handles and facts of the
// backend's answers: the backend does not say whether a baseline was pinned by hand or adopted
// automatically, so the view says so instead of guessing.

import type { Translator } from '../../context.js';

export interface BaselineRef {
  /** The handle of the run (`e-1a2b3c4d`) and its UUID. */
  readonly run_id: string;
  readonly execution_id: string;
  /** Whether the run has measurements: a run without them cannot be pinned again. */
  readonly has_measurements: boolean;
}

export interface SetBaselineData {
  /** The handle of the run (`e-1a2b3c4d`; the log shows it) and its UUID. */
  readonly run_id: string;
  readonly execution_id: string;
  /** False when the run already was the baseline: nothing was sent. */
  readonly changed: boolean;
  /** The baseline of the pair before the call; null when it had none. */
  readonly previous: BaselineRef | null;
  /** Whether the log entry holds an undo (the previous baseline can be pinned again). */
  readonly undoable: boolean;
}

export function renderSetBaseline(data: SetBaselineData, t: Translator): string {
  if (!data.changed) return t('results_set_baseline.already', { run: data.run_id });
  const lines = [t('results_set_baseline.done', { run: data.run_id })];
  const { previous } = data;
  if (previous === null) {
    lines.push(t('results_set_baseline.before.none'));
    lines.push(t('results_set_baseline.undo.none'));
    return lines.join('\n');
  }
  lines.push(
    t(
      previous.has_measurements
        ? 'results_set_baseline.before'
        : 'results_set_baseline.before.unmeasured',
      { run: previous.run_id },
    ),
  );
  lines.push(
    data.undoable
      ? t('results_set_baseline.undo', { id: previous.execution_id })
      : t('results_set_baseline.undo.unmeasured'),
  );
  return lines.join('\n');
}
