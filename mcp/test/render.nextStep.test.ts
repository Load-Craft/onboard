// The results that report a problem on the way (a run that failed, thresholds that could not be
// judged) name the next move, and the ones that are plain results do not.

import { describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import { renderGetReport, type ReportData } from '../src/render/views/getReport.js';

const base: ReportData = {
  verdict: { state: 'sla_passed', reasons: [] },
  run: {},
  requests: {},
  errors: [],
  endpoints: [],
};

const draw = (data: Partial<ReportData>, locale: 'en' | 'pl' = 'en'): string =>
  renderGetReport({ ...base, ...data }, createTranslator(locale)).replace(/\s+/gu, ' ');

describe('results_get_report: the next move of a verdict that is not about the application', () => {
  it('a failed run says to read the run error, fix it, run once more and then tell the user', () => {
    const text = draw({ verdict: { state: 'run_failed', reasons: [] }, failure: 'build broke' });
    expect(text).toMatch(/run error build broke .*→ the run itself failed, not the thresholds/u);
    expect(text).toMatch(
      /fix what it names, then run_start once more; if it fails again, tell the user/u,
    );
  });

  it.each([['sla_refused:no_samples'], ['invariants_not_evaluated']])(
    'thresholds LoadCraft could not judge (%s) are a LoadCraft problem to report, not to repair',
    (reason) => {
      const text = draw({ verdict: { state: 'sla_not_judged', reasons: [reason] } });
      expect(text).toContain('→ LoadCraft could not judge the thresholds');
      expect(text).toMatch(
        /not a result of the application\. Tell the user; do not read the numbers as a pass or a fail and do not try to repair it/u,
      );
    },
  );

  it('the same in Polish', () => {
    const text = draw({ verdict: { state: 'sla_not_judged', reasons: ['sla_refused:x'] } }, 'pl');
    expect(text).toContain('→ LoadCraft nie mógł ocenić progów');
    expect(draw({ verdict: { state: 'run_failed', reasons: [] } }, 'pl')).toContain(
      '→ padł sam run, nie progi',
    );
  });

  it.each([
    [{ state: 'sla_passed', reasons: [] }],
    [{ state: 'sla_failed', reasons: ['sla_failed'] }],
    [{ state: 'sla_not_judged', reasons: ['no_verdict'] }],
    [{ state: 'cancelled', reasons: [] }],
  ] as const)('%j has no hint: the result stands as it is', (verdict) => {
    expect(draw({ verdict })).not.toContain('→');
  });
});
