// The report of the live gate: a step that failed shows the whole text of its tool results (the
// reason is often at the end), a step that passed keeps the short excerpt.

import { describe, expect, it } from 'vitest';

import { callText } from '../scripts/live-gate.js';

const LONG = Array.from({ length: 30 }, (_, index) => `line ${String(index + 1)}`).join('\n');

describe('the text of a call in the gate report', () => {
  it('is complete for a failed step', () => {
    expect(callText('failed', LONG)).toBe(LONG);
    expect(callText('failed', LONG)).toContain('line 30');
  });

  it('is cut to the first lines for a step that passed', () => {
    const shown = callText('passed', LONG);
    expect(shown).toContain('line 12');
    expect(shown).not.toContain('line 13');
    expect(shown).toContain('… (18 more lines)');
  });

  it('is cut for the other statuses too', () => {
    for (const status of ['needs human', 'skipped'] as const) {
      expect(callText(status, LONG)).toContain('… (18 more lines)');
    }
  });
});
