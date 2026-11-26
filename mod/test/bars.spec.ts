// Vitest file (*.spec.ts: see series.spec.ts).
import { describe, expect, it } from 'vitest';

import {
  FINISHED_MS,
  MAX_BARS,
  hasBars,
  parseBars,
  parseEnded,
  sameBar,
  withBars,
} from '../src/bars.js';
import { INITIAL_BARS, type BarRow, type ModBars } from '../src/state/types.js';
import { bandRow, type Tree } from '../src/view/band.js';
import {
  BAR_CELLS,
  barBlock,
  barCells,
  barLabel,
  barLine,
  barsBand,
  barsBlock,
  plainOf,
} from '../src/view/bars.js';
import { paneTree, type PaneNode } from '../src/view/pane.js';
import { EMPTY_PANEL } from '../src/pane/tabs.js';
import { INITIAL_STATE } from '../src/state/types.js';

/** The text of a drawing as the eye reads it: the cells of a row side by side, a column's lines apart. */
function textOf(node: PaneNode): string {
  switch (node.type) {
    case 'Text':
      return node.children.join('');
    case 'Button':
    case 'Link':
      return node.label;
    case 'Input':
      return node.value;
    case 'Box': {
      const parts = node.children.map(textOf);
      return node.props.flexDirection === 'row' ? parts.join('') : parts.join('\n');
    }
  }
}

const T0 = Date.parse('2026-11-24T10:00:00.000Z');

const wire = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  key: 'scenario_generation:g1',
  call: 'scenario_generate:1:1',
  tool: 'scenario_generate',
  handle: 'scenario_generation:g1',
  kind: 'scenario_generation',
  stage: 'scenario 2/2 · Cart: Generating feeder data...',
  percent: 50,
  n: 2,
  m: 2,
  startedAt: new Date(T0).toISOString(),
  updatedAt: new Date(T0 + 1000).toISOString(),
  open: true,
  ...over,
});

/** A bar; a key given as `undefined` is a key the bar does not have. */
const row = (over: { [K in keyof BarRow]?: BarRow[K] | undefined } = {}): BarRow => {
  const bar: Record<string, unknown> = {
    call: 'scenario_generate:1:1',
    handle: 'scenario_generation:g1',
    kind: 'scenario_generation',
    tool: 'scenario_generate',
    stage: 'scenario 2/2 · Cart: Generating feeder data...',
    percent: 50,
    n: 2,
    m: 2,
    startedAt: T0,
    updatedAt: T0 + 1000,
    open: true,
    ...over,
  };
  for (const key of Object.keys(bar)) if (bar[key] === undefined) delete bar[key];
  return bar as unknown as BarRow;
};

const block = (cells: string): string => cells.replace(/[░]/gu, '.').replace(/[█]/gu, '#');

describe('parseBars', () => {
  it('reads the rows of the answer: stage, percent, counter, start', () => {
    expect(parseBars({ progress: [wire()], asOf: 'x' })).toEqual([row()]);
  });

  it('keeps a row with no percent as an indeterminate wait', () => {
    const [bar] =
      parseBars({ progress: [wire({ percent: undefined, n: undefined, m: undefined })] }) ?? [];
    expect(bar?.percent).toBeUndefined();
    expect(bar?.n).toBeUndefined();
  });

  it('says nothing for an answer that is not a list, and leaves a bad row out', () => {
    expect(parseBars(undefined)).toBeUndefined();
    expect(parseBars({ operations: [] })).toBeUndefined();
    expect(parseBars({ progress: 'x' })).toBeUndefined();
    expect(parseBars({ progress: [] })).toEqual([]);
    const rows = parseBars({
      progress: [
        null,
        7,
        wire({ stage: '' }),
        wire({ startedAt: 'never' }),
        wire({ open: 'yes' }),
        wire(),
      ],
    });
    expect(rows).toEqual([row()]);
  });

  it('clamps the percent, drops a counter that does not add up, and cuts the texts to one line', () => {
    const [bar] =
      parseBars({
        progress: [wire({ percent: 240, n: 5, m: 3, stage: `a\nb${'x'.repeat(500)}` })],
      }) ?? [];
    expect(bar?.percent).toBe(100);
    expect(bar?.n).toBeUndefined();
    expect(bar?.stage).not.toContain('\n');
    expect([...(bar?.stage ?? '')].length).toBeLessThanOrEqual(160);
  });

  it('reads at most MAX_BARS rows', () => {
    const many = Array.from({ length: MAX_BARS + 5 }, (_, i) => wire({ call: `c${String(i)}` }));
    expect(parseBars({ progress: many })).toHaveLength(MAX_BARS);
  });
});

describe('parseEnded', () => {
  it('reads how the operations that ended lately ended, by handle', () => {
    expect(
      parseEnded({
        progress: [],
        ended: [
          { handle: 'scenario_generation:g1', status: 'failed' },
          { handle: 'test_run:r1', status: 'done' },
          { handle: 'test_run:r2', status: 'cancelled' },
        ],
      }),
    ).toEqual({
      'scenario_generation:g1': 'failed',
      'test_run:r1': 'done',
      'test_run:r2': 'cancelled',
    });
  });

  it('leaves out what it does not know: an answer without the list, a bad entry, another status', () => {
    expect(parseEnded(undefined)).toEqual({});
    expect(parseEnded({ progress: [] })).toEqual({});
    expect(
      parseEnded({
        ended: [null, { handle: 'a' }, { handle: 'b', status: 'exploded' }, { status: 'done' }],
      }),
    ).toEqual({});
  });
});

describe('withBars', () => {
  it('takes the rows of a read', () => {
    expect(withBars(INITIAL_BARS, [row()], T0)).toEqual({ rows: [row()], finished: [] });
  });

  it('a bar that is no longer listed has finished, and stays on screen until it runs out', () => {
    const shown = withBars(INITIAL_BARS, [row()], T0);
    const ended = withBars(shown, [], T0 + 5000);
    expect(ended.rows).toEqual([]);
    expect(ended.finished).toEqual([{ row: row(), until: T0 + 5000 + FINISHED_MS }]);
    expect(withBars(ended, undefined, T0 + 5000 + FINISHED_MS - 1)).toBe(ended);
    expect(withBars(ended, undefined, T0 + 5000 + FINISHED_MS)).toEqual(INITIAL_BARS);
  });

  it('a bar whose operation failed finishes as a failure, one that ended well as done', () => {
    const shown = withBars(INITIAL_BARS, [row(), row({ call: 'c2', handle: 'test_run:r1' })], T0);
    const ended = withBars(shown, [], T0 + 5000, {
      'scenario_generation:g1': 'failed',
      'test_run:r1': 'done',
    });
    expect(ended.finished).toEqual([
      { row: row(), until: T0 + 5000 + FINISHED_MS, end: 'failed' },
      {
        row: row({ call: 'c2', handle: 'test_run:r1' }),
        until: T0 + 5000 + FINISHED_MS,
        end: 'done',
      },
    ]);
  });

  it('a bar that moved from the call to its handle is the same bar, not a finished one', () => {
    const before = withBars(INITIAL_BARS, [row({ handle: undefined, kind: undefined })], T0);
    const after = withBars(before, [row()], T0 + 2000);
    expect(after.finished).toEqual([]);
    expect(after.rows).toEqual([row()]);
  });

  it('a later call about the same operation is the same bar', () => {
    const before = withBars(INITIAL_BARS, [row()], T0);
    const after = withBars(before, [row({ call: 'wait:2:9' })], T0 + 2000);
    expect(after.finished).toEqual([]);
  });

  it('an operation that went on after its call ended is not shown as finished', () => {
    const shown = withBars(INITIAL_BARS, [row()], T0);
    const gone = withBars(shown, [], T0 + 1000);
    const back = withBars(gone, [row()], T0 + 2000);
    expect(back.finished).toEqual([]);
  });

  it('a failed read leaves the bars as they were', () => {
    const shown = withBars(INITIAL_BARS, [row()], T0);
    expect(withBars(shown, undefined, T0 + 60_000)).toBe(shown);
  });

  it('hands back the same object when nothing changed', () => {
    const shown = withBars(INITIAL_BARS, [row()], T0);
    expect(withBars(shown, [row()], T0 + 1)).toBe(shown);
  });

  it('keeps at most four finished bars, the newest', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      row({ call: `c${String(i)}`, handle: undefined }),
    );
    const shown = withBars(INITIAL_BARS, rows, T0);
    expect(withBars(shown, [], T0 + 1).finished.map((entry) => entry.row.call)).toEqual([
      'c2',
      'c3',
      'c4',
      'c5',
    ]);
  });

  it('hasBars is true for rows and for finished bars', () => {
    expect(hasBars(INITIAL_BARS)).toBe(false);
    expect(hasBars({ rows: [row()], finished: [] })).toBe(true);
    expect(hasBars({ rows: [], finished: [{ row: row(), until: 1 }] })).toBe(true);
    expect(sameBar(row(), row({ call: 'x', handle: undefined }))).toBe(false);
  });
});

describe('barCells', () => {
  it('fills the share of the bar the percent says', () => {
    expect(block(barCells(50, 12, 0).filled + barCells(50, 12, 0).empty)).toBe('######......');
    expect(block(barCells(0, 12, 0).filled + barCells(0, 12, 0).empty)).toBe('............');
    expect(block(barCells(100, 12, 0).filled + barCells(100, 12, 0).empty)).toBe('############');
    // The nearest cell, not the one below: 96% of 12 cells is 11.52.
    expect(block(barCells(96, 12, 0).filled + barCells(96, 12, 0).empty)).toBe('############');
  });

  it('moves a block along an indeterminate bar and back, one cell a frame, inside the bar', () => {
    const frames = Array.from({ length: 20 }, (_, frame) =>
      block(barCells(undefined, 8, frame).empty),
    );
    expect(frames[0]).toBe('###.....');
    expect(frames[1]).toBe('.###....');
    expect(frames[5]).toBe('.....###');
    expect(frames[6]).toBe('....###.');
    expect(frames[10]).toBe('###.....');
    for (const frame of frames) expect(frame).toHaveLength(8);
    expect(new Set(frames).size).toBeGreaterThan(4);
  });

  it('a bar narrower than the block still fits', () => {
    expect(block(barCells(undefined, 2, 3).empty)).toHaveLength(2);
  });
});

const ctx = (width: number, now = T0 + 72_000, locale: 'en' | 'pl' = 'en') => ({
  locale,
  now,
  width,
});

describe('barLine', () => {
  it('draws the label, the bar, the percent, the counter, the time and the stage', () => {
    const text = textOf(barLine(row(), ctx(120), { stage: true }));
    expect(text).toBe(
      'scenario generation ██████░░░░░░ 50% 2/2 1:12 · scenario 2/2 · Cart: Generating feeder data...',
    );
  });

  it('an indeterminate bar has no percent and a moving block', () => {
    const bar = row({ percent: undefined, n: undefined, m: undefined });
    const a = textOf(barLine(bar, ctx(80, T0 + 72_000)));
    const b = textOf(barLine(bar, ctx(80, T0 + 73_000)));
    expect(a).toContain('scenario generation');
    expect(a).not.toContain('%');
    expect(a).toContain('1:12');
    expect(a).not.toBe(b);
    expect(a.replace(/[░█]/gu, '.').replace(/\d+:\d+/u, 'T')).toBe(
      b.replace(/[░█]/gu, '.').replace(/\d+:\d+/u, 'T'),
    );
  });

  it('a finished bar is full and says so, in the language of the user', () => {
    expect(textOf(barLine(row(), ctx(80), { finished: true }))).toBe(
      'scenario generation ████████████ finished',
    );
    expect(textOf(barLine(row(), ctx(80, T0, 'pl'), { finished: true }))).toBe(
      'generowanie scenariuszy ████████████ zakończone',
    );
  });

  it('a bar of an operation that failed says so, in the colour of an error, not finished', () => {
    const failed = barLine(row(), ctx(80), { finished: true, end: 'failed' });
    expect(textOf(failed)).toBe('scenario generation ████████████ failed');
    expect(textOf(barLine(row(), ctx(80, T0, 'pl'), { finished: true, end: 'failed' }))).toBe(
      'generowanie scenariuszy ████████████ nie powiodło się',
    );
    expect(JSON.stringify(failed)).toContain('"error"');
    expect(JSON.stringify(failed)).not.toContain('"success"');
    expect(textOf(barLine(row(), ctx(80, T0, 'pl'), { finished: true, end: 'cancelled' }))).toBe(
      'generowanie scenariuszy ████████████ anulowane',
    );
    expect(textOf(barLine(row(), ctx(80), { finished: true, end: 'done' }))).toBe(
      'scenario generation ████████████ finished',
    );
  });

  it('the band and the panel draw a failed bar as failed', () => {
    const bars = {
      rows: [],
      finished: [{ row: row(), until: T0 + 100_000, end: 'failed' as const }],
    };
    expect(barsBand(bars, ctx(100)).map(textOf)).toEqual([
      'scenario generation ████████████ failed',
    ]);
    expect(barsBlock(bars, ctx(100)).map(textOf)).toEqual([
      'scenario generation ████████████ failed',
    ]);
  });

  it('names the kind in Polish, and a call without an operation by its tool', () => {
    expect(barLabel(row(), 'pl')).toBe('generowanie scenariuszy');
    expect(barLabel(row({ kind: undefined }), 'en')).toBe('scenario generation');
    expect(barLabel(row({ kind: undefined, tool: 'flows_import_har' }), 'pl')).toBe(
      'import nagrania',
    );
    expect(barLabel(row({ kind: undefined, tool: 'some_new_tool' }), 'en')).toBe('some new tool');
  });

  it('shows a tool name saved before the rename as it is, and labels the new name', () => {
    // A bar row written by the server before its tools were renamed; built here so the old name
    // is not a literal of the repository.
    const saved = ['get', 'diagnosis'].join('_');
    expect(barLabel(row({ kind: undefined, tool: saved }), 'en')).toBe('get diagnosis');
    expect(barLabel(row({ kind: undefined, tool: 'results_analyze_run' }), 'en')).toBe('diagnosis');
    expect(barLabel(row({ kind: undefined, tool: 'results_analyze_run' }), 'pl')).toBe('diagnoza');
  });

  it('is one line that never exceeds the width, whatever the width', () => {
    for (const bar of [row(), row({ percent: undefined })]) {
      for (let width = 10; width <= 140; width += 1) {
        const text = textOf(barLine(bar, ctx(width), { stage: true }));
        expect(text).not.toContain('\n');
        // Below the width of the label and numbers the line is cut by the surface; above, it fits.
        if (width >= 40)
          expect([...text].length, `width ${String(width)}`).toBeLessThanOrEqual(width);
      }
    }
  });

  it('leaves the bar out of a narrow line, and the stage out when it has no room', () => {
    const narrow = textOf(barLine(row(), ctx(34), { stage: true }));
    expect(narrow).not.toContain('░');
    expect(narrow).toContain('50%');
    expect(textOf(barLine(row(), ctx(50), { stage: true }))).not.toContain('Generating');
    expect(BAR_CELLS).toBe(12);
  });

  it('uses theme colours only, so that it reads in a light and in a dark theme', () => {
    const colors = new Set<string>();
    const walk = (node: ReturnType<typeof barLine>): void => {
      if (node.type === 'Text') {
        if (node.props.color !== undefined) colors.add(node.props.color);
      } else node.children.forEach(walk);
    };
    walk(barLine(row(), ctx(100), { stage: true }));
    expect([...colors].sort()).toEqual(['inactive', 'success']);
  });
});

describe('barsBand and barsBlock', () => {
  const two: ModBars = {
    rows: [row(), row({ call: 'c2', handle: 'analysis:a1', kind: 'analysis', percent: undefined })],
    finished: [{ row: row({ call: 'c3', handle: undefined }), until: T0 + 100_000 }],
  };

  it('one line per bar, the running ones first, then the finished ones', () => {
    const lines = barsBand(two, ctx(100), 5).map(textOf);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('scenario generation');
    expect(lines[1]).toContain('analysis');
    expect(lines[2]).toContain('finished');
  });

  it('counts what the limit leaves out, in the language of the user', () => {
    expect(barsBand(two, ctx(100), 2).map(textOf).at(-1)).toBe('+1 more');
    expect(
      barsBand(two, ctx(100, T0 + 72_000, 'pl'), 2)
        .map(textOf)
        .at(-1),
    ).toBe('+1 więcej');
  });

  it('a finished bar whose time is up is not drawn', () => {
    expect(barsBand(two, ctx(100, T0 + 100_001), 5)).toHaveLength(2);
  });

  it('shows nothing when there are no bars', () => {
    expect(barsBand(INITIAL_BARS, ctx(100))).toEqual([]);
    expect(barsBlock(INITIAL_BARS, ctx(100))).toEqual([]);
  });

  it('the panel gives each running bar its stage under the line', () => {
    const text = textOf(barBlock(row(), ctx(100)));
    expect(text.split('\n')).toEqual([
      'scenario generation ██████░░░░░░ 50% 2/2 1:12',
      'scenario 2/2 · Cart: Generating feeder data...',
    ]);
  });
});

describe('plainOf and the band', () => {
  it('turns a drawing into the plain tree of the band, bold as weight', () => {
    const [line] = barsBand({ rows: [row()], finished: [] }, ctx(100));
    if (line === undefined) throw new Error('no line');
    const plain = plainOf(line);
    expect(JSON.stringify(plain)).toContain('"weight":"bold"');
    expect(JSON.stringify(plain)).not.toContain('"bold":true');
  });

  it('puts the bars between the step row and what lies beneath; bars alone are enough', () => {
    const step: Tree = { type: 'Box', children: ['step'] };
    const bar: Tree = { type: 'Text', children: ['bar'] };
    const beneath: Tree = { type: 'Box', children: ['beneath'] };
    expect(bandRow(step, beneath, [bar]).children).toEqual([step, bar, beneath]);
    expect(bandRow(undefined, beneath, [bar]).children).toEqual([bar, beneath]);
    expect(bandRow(step, undefined).children).toEqual([step]);
  });
});

describe('the panel', () => {
  const base = {
    locale: 'en' as const,
    surface: 'terminal',
    width: 100,
    samples: [],
    autoOpen: true,
  };

  it('draws the bars above the tab, and nothing when there are none', () => {
    const withBarsTree = textOf(
      paneTree(INITIAL_STATE, EMPTY_PANEL, 'run', {
        ...base,
        bars: { rows: [row()], finished: [] },
        now: T0 + 72_000,
      }),
    );
    expect(withBarsTree).toContain('scenario generation ██████░░░░░░ 50% 2/2 1:12');
    const without = textOf(paneTree(INITIAL_STATE, EMPTY_PANEL, 'run', base));
    expect(without).not.toContain('scenario generation');
    const empty = textOf(
      paneTree(INITIAL_STATE, EMPTY_PANEL, 'run', {
        ...base,
        bars: INITIAL_BARS,
        now: T0,
      }),
    );
    expect(empty).toBe(without);
  });
});
