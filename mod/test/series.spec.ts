// Vitest file (*.spec.ts: `claude plugin test` would collect a *.test.ts and fail to load it).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { PluginState } from 'claude-code';

import { INITIAL_PROGRESS, type ModProgress } from '../src/state/types.js';
import { addSample, MAX_SAMPLES, runStartCall, sparkline, withProgress } from '../src/series.js';
import type { OperationSnapshot } from '../src/view/status.js';

// The declaration the manifest points at and `ModProgress` must describe the same value, both ways.
type Declared = PluginState['loadcraft']['progress'];
const declaredFromProgress: Declared = INITIAL_PROGRESS;
const progressFromDeclared: ModProgress = declaredFromProgress;

it('the declaration of the progress in types/index.d.ts is ModProgress', () => {
  expect(progressFromDeclared).toBe(INITIAL_PROGRESS);
});

const HANDLE = 'test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';

const running = (
  rps: number | null,
  extra: Partial<OperationSnapshot> = {},
): OperationSnapshot => ({
  operation: HANDLE,
  kind: 'test_run',
  phase: 'running',
  elapsed_s: 405,
  load_elapsed_s: 400,
  planned_s: 600,
  live: { rps, p95_ms: 910, error_pct: 0.6 },
  ...extra,
});

describe('sparkline', () => {
  it('is empty without samples and without room', () => {
    expect(sparkline([], 10)).toBe('');
    expect(sparkline([1, 2, 3], 0)).toBe('');
    expect(sparkline([1, 2, 3], -4)).toBe('');
  });

  it('draws one sample as one block', () => {
    expect(sparkline([690], 10)).toHaveLength(1);
    expect(sparkline([690], 10)).toMatch(/^[▁▂▃▄▅▆▇█]$/u);
  });

  it('draws a constant series as a flat line at the top of the scale', () => {
    expect(sparkline([690, 690, 690, 690], 10)).toBe('████');
  });

  it('draws a rising series with a block that never falls and ends on the tallest', () => {
    const line = sparkline([0, 100, 200, 300, 400, 500, 600, 700], 10);
    expect(line).toBe('▁▂▃▄▅▆▇█');
  });

  it('scales from zero, so that small noise on a steady rate stays flat', () => {
    expect(sparkline([690, 700, 695, 690], 10)).toBe('████');
  });

  it('shows the whole series when it is narrower than the width, the newest samples when wider', () => {
    expect(sparkline([1, 2, 3], 5)).toHaveLength(3);
    const long = Array.from({ length: 40 }, (_, index) => index + 1);
    const five = sparkline(long, 5);
    expect(five).toHaveLength(5);
    expect(five.endsWith('█')).toBe(true);
    // The newest five (36..40) against the scale of what is shown: all near the top.
    expect(five).toBe(sparkline(long.slice(-5), 5));
    expect(sparkline(long, 40)).toHaveLength(40);
    expect(sparkline(long, 40)[0]).toBe('▁');
  });

  it('draws zeros as the lowest block and ignores what is not a number', () => {
    expect(sparkline([0, 0, 0], 3)).toBe('▁▁▁');
    expect(sparkline([0, Number.NaN, Number.POSITIVE_INFINITY, 5], 4)).toBe('▁█');
  });
});

describe('addSample', () => {
  it('appends a number, skips a missing one', () => {
    expect(addSample([1], 2)).toEqual([1, 2]);
    expect(addSample([1], null)).toEqual([1]);
    expect(addSample([1], undefined)).toEqual([1]);
    expect(addSample([1], Number.NaN)).toEqual([1]);
  });

  it('never grows beyond the bound, dropping the oldest', () => {
    let samples: readonly number[] = [];
    for (let index = 0; index < MAX_SAMPLES * 3; index += 1) samples = addSample(samples, index);
    expect(samples).toHaveLength(MAX_SAMPLES);
    expect(samples[0]).toBe(MAX_SAMPLES * 2);
    expect(samples[samples.length - 1]).toBe(MAX_SAMPLES * 3 - 1);
    expect(addSample([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });
});

describe('withProgress', () => {
  const opened = withProgress(INITIAL_PROGRESS, { kind: 'open', call: 'toolu_1' });

  it('opens with an empty series, and nothing changes for the same call again', () => {
    expect(opened).toEqual({ call: 'toolu_1', samples: [] });
    expect(withProgress(opened, { kind: 'open', call: 'toolu_1' })).toBe(opened);
  });

  it('a new call starts a new series', () => {
    const second = withProgress(
      withProgress(opened, { kind: 'snapshot', snapshot: running(500) }),
      {
        kind: 'open',
        call: 'toolu_2',
      },
    );
    expect(second).toEqual({ call: 'toolu_2', samples: [] });
  });

  it('keeps the snapshot and the rps of every read while the call is open', () => {
    let state = opened;
    for (const rps of [100, 300, 690]) {
      state = withProgress(state, { kind: 'snapshot', snapshot: running(rps) });
    }
    expect(state.samples).toEqual([100, 300, 690]);
    expect(state.snapshot?.live?.rps).toBe(690);
  });

  it('takes no sample while the numbers are not there, but keeps the snapshot', () => {
    const state = withProgress(opened, {
      kind: 'snapshot',
      snapshot: {
        operation: HANDLE,
        kind: 'test_run',
        phase: 'building',
        elapsed_s: 18,
        planned_s: 600,
      },
    });
    expect(state.samples).toEqual([]);
    expect(state.snapshot?.phase).toBe('building');
  });

  it('restarts the series for another operation', () => {
    const first = withProgress(opened, { kind: 'snapshot', snapshot: running(100) });
    const other = withProgress(first, {
      kind: 'snapshot',
      snapshot: running(5, { operation: 'test_run:other-1' }),
    });
    expect(other.samples).toEqual([5]);
  });

  it('draws nothing for a call that is not open, and for an operation of another kind', () => {
    expect(withProgress(INITIAL_PROGRESS, { kind: 'snapshot', snapshot: running(100) })).toBe(
      INITIAL_PROGRESS,
    );
    expect(
      withProgress(opened, {
        kind: 'snapshot',
        snapshot: running(100, { kind: 'analysis', operation: 'analysis:1' }),
      }),
    ).toBe(opened);
  });

  it('clears the series and the snapshot when the operation ends or is lost', () => {
    const live = withProgress(opened, { kind: 'snapshot', snapshot: running(100) });
    const ended = withProgress(live, {
      kind: 'snapshot',
      snapshot: running(100, { phase: 'completed' }),
    });
    expect(ended).toEqual({ call: 'toolu_1', samples: [] });
    expect(withProgress(live, { kind: 'end' })).toEqual({ call: 'toolu_1', samples: [] });
    expect(withProgress(opened, { kind: 'end' })).toBe(opened);
  });

  it('closes only the call it was opened for', () => {
    const live = withProgress(opened, { kind: 'snapshot', snapshot: running(100) });
    expect(withProgress(live, { kind: 'close', call: 'toolu_9' })).toBe(live);
    expect(withProgress(live, { kind: 'close', call: 'toolu_1' })).toBe(INITIAL_PROGRESS);
    expect(withProgress(INITIAL_PROGRESS, { kind: 'close', call: 'toolu_1' })).toBe(
      INITIAL_PROGRESS,
    );
  });
});

describe('runStartCall', () => {
  it('is the id of a call of run_start and of no other tool', () => {
    const prefix = 'mcp__plugin_loadcraft_lc__';
    expect(runStartCall(`${prefix}run_start`, 'toolu_1')).toBe('toolu_1');
    expect(runStartCall(`${prefix}wait`, 'toolu_1')).toBeUndefined();
    expect(runStartCall('mcp__other__run_start', 'toolu_1')).toBeUndefined();
    expect(runStartCall(`${prefix}run_start`, undefined)).toBeUndefined();
    expect(runStartCall(`${prefix}run_start`, '')).toBeUndefined();
    expect(runStartCall(`${prefix}run_start`, 7)).toBeUndefined();
  });
});

describe('the progress atom has one writer', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  const sources = files(root).map((path) => readFileSync(path, 'utf8'));
  const count = (pattern: RegExp): number =>
    sources.reduce((sum, source) => sum + (source.match(pattern)?.length ?? 0), 0);

  it('is declared once and updated in exactly one place (noteProgress), never written elsewhere', () => {
    expect(count(/key: 'progress'/g)).toBe(1);
    expect(count(/\bupdate\(\$, progress/g)).toBe(1);
    expect(count(/\bnoteProgress\(/g)).toBeGreaterThanOrEqual(4);
    expect(count(/\$\.state\.set/g)).toBe(0);
  });
});
