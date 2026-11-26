// Vitest file (*.spec.ts: see series.spec.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { progressRow, progressTree } from '../src/view/progress.js';
import { textOf } from '../src/view/tree.js';
import { sparkline } from '../src/series.js';
import { statusLine, type OperationSnapshot } from '../src/view/status.js';

const golden = (path: string): string =>
  readFileSync(
    join(import.meta.dirname, '..', '..', 'mcp', 'test', 'golden', path),
    'utf8',
  ).replace(/\n$/u, '');

const RUNNING: OperationSnapshot = {
  operation: 'test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42',
  kind: 'test_run',
  phase: 'running',
  elapsed_s: 405,
  load_elapsed_s: 400,
  planned_s: 600,
  live: { rps: 690, p95_ms: 910, error_pct: 0.6 },
};
const SAMPLES = [120, 340, 500, 640, 690];

const line = (
  snapshot: OperationSnapshot | undefined,
  samples: readonly number[],
  locale: 'en' | 'pl',
  width = 100,
): string => {
  const tree = progressTree(snapshot, samples, locale, width);
  if (tree === undefined) throw new Error('no tree');
  return textOf(tree);
};

describe('progressTree', () => {
  it('pl: the numbers of run 1 as the progress pattern has them, then the chart', () => {
    const text = line(RUNNING, SAMPLES, 'pl');
    expect(text).toBe(
      `test ${golden('run1/10-run_start-postep.pl.txt')} ${sparkline(SAMPLES, 24)}`,
    );
    expect(text.startsWith('test 6:40 / 10:00 · 690 żądań/s · p95≈ 910 ms · błędy 0,6% ')).toBe(
      true,
    );
    expect(text).toMatch(/[▁▂▃▄▅▆▇█]{5}$/u);
  });

  it('en: the same line in English', () => {
    expect(line(RUNNING, SAMPLES, 'en')).toBe(
      `test 6:40 / 10:00 · 690 requests/s · p95≈ 910 ms · errors 0.6% ${sparkline(SAMPLES, 24)}`,
    );
  });

  it('is the status line without the product name, plus the chart', () => {
    const status = statusLine(RUNNING, 'pl').replace(/^LoadCraft · /u, '');
    expect(line(RUNNING, [], 'pl')).toBe(status);
  });

  it('draws no chart without samples, and no trailing space', () => {
    expect(line(RUNNING, [], 'en')).toBe(
      'test 6:40 / 10:00 · 690 requests/s · p95≈ 910 ms · errors 0.6%',
    );
  });

  it('gives the chart the room the line leaves, and drops it when there is none', () => {
    const base = line(RUNNING, [], 'en');
    const samples = Array.from({ length: 40 }, (_, index) => index);
    const narrow = line(RUNNING, samples, 'en', base.length + 1 + 6);
    expect(narrow).toBe(`${base} ${sparkline(samples, 6)}`);
    expect(line(RUNNING, samples, 'en', base.length + 1 + 3)).toBe(
      `${base} ${sparkline(samples, 3)}`,
    );
    expect(line(RUNNING, samples, 'en', base.length + 1 + 2)).toBe(base);
    expect(line(RUNNING, samples, 'en', 10)).toBe(base);
    // The chart is never wider than 24 columns, however much room there is.
    expect(line(RUNNING, samples, 'en', 200)).toBe(`${base} ${sparkline(samples, 24)}`);
  });

  it('says that the project is being built while there are no numbers', () => {
    const building: OperationSnapshot = {
      operation: RUNNING.operation,
      kind: 'test_run',
      phase: 'building',
      elapsed_s: 18,
      planned_s: 600,
    };
    expect(line(building, [], 'pl')).toBe('budowanie… 0:18');
  });

  it('is undefined without a snapshot, for an operation that is over, and for another kind', () => {
    expect(progressTree(undefined, SAMPLES, 'en', 100)).toBeUndefined();
    expect(progressTree({ ...RUNNING, phase: 'completed' }, SAMPLES, 'en', 100)).toBeUndefined();
    expect(progressTree({ ...RUNNING, phase: 'failed' }, SAMPLES, 'en', 100)).toBeUndefined();
    expect(
      progressTree({ ...RUNNING, kind: 'analysis', operation: 'analysis:1' }, SAMPLES, 'en', 100),
    ).toBeUndefined();
  });

  it('is one line of text that the terminal cuts rather than wraps', () => {
    const tree = progressTree(RUNNING, SAMPLES, 'en', 100);
    expect(tree?.type).toBe('Text');
    expect(tree?.type === 'Text' ? tree.props.wrap : undefined).toBe('truncate-end');
  });
});

describe('progressRow', () => {
  const tree = progressTree(RUNNING, [], 'en', 100);
  if (tree === undefined) throw new Error('no tree');

  it('keeps the hint of Claude Code beneath the line, dim', () => {
    const row = progressRow(tree, '(ctrl+b to run in background)');
    expect(textOf(row)).toBe(`${textOf(tree)}\n(ctrl+b to run in background)`);
    expect(row.type === 'Box' ? row.children[1] : undefined).toMatchObject({
      props: { dimColor: true },
    });
  });

  it('leaves the line alone without a hint, and cleans a hint of control characters', () => {
    expect(progressRow(tree, undefined)).toBe(tree);
    expect(progressRow(tree, '')).toBe(tree);
    expect(progressRow(tree, 42)).toBe(tree);
    expect(textOf(progressRow(tree, '(ctrl+b)\u001b[31m\nrun'))).toBe(
      `${textOf(tree)}\n(ctrl+b) run`,
    );
  });
});
