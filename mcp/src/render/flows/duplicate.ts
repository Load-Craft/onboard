// The view of `flows_duplicate`: the copies made, what could not be copied, and (onto a docs version)
// how the steps were rebound. The texts arrive made one line and masked by the tool (`content`).

import type { Translator } from '../../context.js';

export interface DuplicateCopy {
  readonly id: string;
  readonly name: string;
  readonly version: number;
}

/** The backend's report of a copy onto another docs version. */
export interface DuplicateReport {
  readonly source_version: string;
  readonly target_version: string;
  readonly steps: number;
  readonly matched: number;
  readonly changed: number;
  readonly unmatched: number;
}

export interface DuplicateData {
  readonly project_id: string;
  /** How many copies were made. */
  readonly count: number;
  readonly copies: readonly DuplicateCopy[];
  /** The ids the backend could not copy. */
  readonly failed: readonly string[];
  /** Only for a copy onto a docs version; null otherwise. */
  readonly report: DuplicateReport | null;
}

export function renderDuplicate(data: DuplicateData, t: Translator): string {
  const lines: string[] = [];
  const [first] = data.copies;
  if (data.report !== null && first !== undefined) {
    lines.push(
      t('flows_duplicate.onto_docs', {
        name: first.name,
        version: data.report.target_version,
        steps: data.report.steps,
        matched: data.report.matched,
        changed: data.report.changed,
        unmatched: data.report.unmatched,
      }),
    );
  } else if (data.count > 0) {
    lines.push(
      t.plural('flows_duplicate.made', data.count, {
        names: data.copies.map((copy) => copy.name).join(', '),
      }),
    );
  } else {
    lines.push(t('flows_duplicate.none'));
  }
  if (data.failed.length > 0) {
    lines.push(t('flows_duplicate.failed', { ids: data.failed.join(', ') }));
  }
  return lines.join('\n');
}
