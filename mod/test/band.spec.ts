// Vitest file (see capabilities.spec.ts for why it is not named *.test.ts).
import { describe, expect, it } from 'vitest';

import { en } from '../../mcp/src/render/i18n/en.js';
import { pl } from '../../mcp/src/render/i18n/pl.js';
import { SKLEP_IDS } from '../../mcp/test/golden/index.js';
import { reduce } from '../src/state/reduce.js';
import { INITIAL_STATE, type ModState } from '../src/state/types.js';
import { ACCENT, bandRow, bandTree, statusLine, type Tree } from '../src/view/band.js';

const NOW = 1_700_000_000_000;
const WIDE = 220;

// The theme keys of Claude Code 2.1.325 (`ThemeKey` in its declarations); a colour outside this
// list and the accent follows no theme.
const THEME_KEYS = new Set([
  'text',
  'inverseText',
  'inactive',
  'subtle',
  'suggestion',
  'remember',
  'success',
  'error',
  'warning',
  'merged',
  'claude',
  'permission',
  'planMode',
  'autoAccept',
  'promptBorder',
  'bashBorder',
  'ide',
  'diffAdded',
  'diffRemoved',
  'diffAddedDimmed',
  'diffRemovedDimmed',
  'diffAddedWord',
  'diffRemovedWord',
]);

type Hint =
  | 'unbound'
  | 'setup_incomplete'
  | 'no_flows'
  | 'no_compositions'
  | 'needs_data'
  | 'no_runs'
  | 'no_analysis'
  | 'passed_no_diagnosis'
  | 'all_done';

/** The data block of `process_get_status` (`format: "data"`), as far as the reducer reads it. */
function status(
  hint: Hint,
  options: { protectedEnv?: boolean; operation?: string; project?: string; env?: string } = {},
): unknown {
  return {
    asOf: '2026-11-22T11:00:00.000Z',
    identity: { userId: 'u-1' },
    compat: { backendVersion: '2.4.0', apiRevision: 7, plugin: '1.0.0' },
    project: { id: SKLEP_IDS.project, name: options.project ?? 'sklep' },
    setup: { complete: true, missing: [] },
    environments: [
      {
        name: options.env ?? 'perf',
        isDefault: true,
        protected: options.protectedEnv ?? false,
        active: true,
        caps: {},
      },
    ],
    counts: { flows: 1, scenarios: 1, compositions: 1 },
    recentRuns: [],
    moreRuns: 0,
    operations:
      options.operation === undefined
        ? []
        : [
            {
              handle: options.operation,
              kind: 'test_run',
              startedAt: '2026-11-22T10:55:00.000Z',
            },
          ],
    next: {
      step: 'x',
      hint,
      ...(hint === 'passed_no_diagnosis' ? { skipped: ['results_analyze_run'] } : {}),
    },
  };
}

const stateOf = (data: unknown): ModState => reduce(INITIAL_STATE, { kind: 'status', data }, NOW);

const STEP_2 = stateOf(status('setup_incomplete'));
const STEP_6 = stateOf(status('no_runs', { operation: `test_run:${SKLEP_IDS.executionPerf}` }));
const STEP_8 = stateOf(status('all_done'));

type Run = { text: string; props: Record<string, string | number | boolean> };

/** The leaf runs of a tree: each Text that holds a string, with its props. */
function runs(node: unknown): Run[] {
  if (typeof node !== 'object' || node === null) return [];
  const tree = node as Tree;
  const found: Run[] = [];
  const own = (tree.children ?? []).filter((child): child is string => typeof child === 'string');
  if (tree.type === 'Text' && own.length > 0) {
    found.push({ text: own.join(''), props: tree.props ?? {} });
  }
  for (const child of tree.children ?? []) found.push(...runs(child));
  return found;
}

/** What the row shows, left to right, as one line. */
function line(tree: Tree | undefined): string {
  if (tree === undefined) throw new Error('no tree');
  const text = (node: unknown): string => {
    if (typeof node === 'string') return node;
    if (typeof node !== 'object' || node === null) return '';
    return ((node as Tree).children ?? []).map(text).join('');
  };
  return text(tree);
}

/** True when the text holds a C0 or C1 control character (a newline, an escape, a bell …). */
function hasControl(text: string): boolean {
  return [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

const rowsOf = (tree: Tree): number =>
  tree.type === 'Box' && tree.props?.['flexDirection'] === 'column' ? 2 : 1;

const run = (tree: Tree | undefined, text: string): Run | undefined =>
  runs(tree).find((item) => item.text.trim() === text);

describe('band: the steps', () => {
  it('step 2 in Polish: 01 done, 02 current, the rest ahead (full names when they fit)', () => {
    const tree = bandTree(STEP_2, 'pl', WIDE);
    expect(line(tree)).toBe(
      'LoadCraft · sklep · perf  ✓ 01 Dokumentacja API  02 Projekt  03 Flow  04 Scenariusz  05 Dane testowe  06 Uruchomienie  07 Raport  08 Diagnoza',
    );
  });

  it('step 6 in English: five done, 06 current', () => {
    const tree = bandTree(STEP_6, 'en', WIDE);
    expect(line(tree)).toBe(
      'LoadCraft · sklep · perf  ✓ 01 API docs  ✓ 02 Project  ✓ 03 Flows  ✓ 04 Scenario  ✓ 05 Test data  06 Run  07 Report  08 Diagnosis',
    );
  });

  it('step 8 in Polish: seven done, 08 current', () => {
    const tree = bandTree(STEP_8, 'pl', WIDE);
    expect(line(tree)).toBe(
      'LoadCraft · sklep · perf  ✓ 01 Dokumentacja API  ✓ 02 Projekt  ✓ 03 Flow  ✓ 04 Scenariusz  ✓ 05 Dane testowe  ✓ 06 Uruchomienie  ✓ 07 Raport  08 Diagnoza',
    );
  });

  it('a done step is accent green, the current one bold and inverse, the ones ahead dim', () => {
    const tree = bandTree(STEP_6, 'en', WIDE);
    expect(run(tree, '✓ 01 API docs')?.props).toMatchObject({ color: ACCENT });
    expect(run(tree, '✓ 05 Test data')?.props).toMatchObject({ color: ACCENT });
    expect(run(tree, '06 Run')?.props).toMatchObject({ inverse: true, weight: 'bold' });
    expect(run(tree, '07 Report')?.props).toMatchObject({ dimColor: true });
    expect(run(tree, '08 Diagnosis')?.props).toMatchObject({ dimColor: true });
    // Only the current step is inverse; only the ones ahead are dim.
    const all = runs(tree).filter((item) => /^(✓ )?0\d /.test(item.text.trim()));
    expect(all.filter((item) => item.props['inverse'] === true)).toHaveLength(1);
    expect(all.filter((item) => item.props['dimColor'] === true)).toHaveLength(2);
    expect(all.filter((item) => item.props['color'] === ACCENT)).toHaveLength(5);
  });

  it('a step that is not in the done list is not marked, whatever the current step', () => {
    const state: ModState = { ...STEP_6, done: [1, 2, 4] };
    const tree = bandTree(state, 'en', WIDE);
    expect(line(tree)).toContain(
      '✓ 01 API docs  ✓ 02 Project  03 Flows  ✓ 04 Scenario  05 Test data  06 Run',
    );
  });
});

describe('band: narrow', () => {
  it('under 80 columns: numbers only, the current step with its name', () => {
    const tree = bandTree(STEP_6, 'pl', 79);
    const text = line(tree);
    expect(text).toContain('06 Uruchomienie');
    for (const n of ['01', '02', '03', '04', '05', '07', '08']) expect(text).toContain(n);
    for (const name of [
      'Dokumentacja',
      'Projekt',
      'Flow',
      'Scenariusz',
      'Dane testowe',
      'Raport',
      'Diagnoza',
    ]) {
      expect(text).not.toContain(name);
    }
    expect([...text].length).toBeLessThanOrEqual(79);
  });

  it('keeps the current step when even the numbers do not fit', () => {
    for (const width of [60, 45, 30, 20]) {
      const text = line(bandTree(STEP_8, 'pl', width));
      expect(text).toContain('08 Diagnoza');
      expect([...text].length).toBeLessThanOrEqual(width);
    }
  });

  it('is one row at every width', () => {
    for (const width of [20, 40, 79, 80, 120, 300]) {
      const tree = bandTree(STEP_6, 'en', width);
      expect(tree).toBeDefined();
      if (tree === undefined) continue;
      expect(rowsOf(tree)).toBe(1);
      expect(line(tree)).not.toContain('\n');
      // The one text of the row cuts what does not fit instead of wrapping it.
      expect(runs(tree).length).toBeGreaterThan(0);
      expect(JSON.stringify(tree)).toContain('"wrap":"truncate-end"');
    }
  });
});

describe('band: nothing to show', () => {
  it('no state yet → undefined', () => {
    expect(bandTree(INITIAL_STATE, 'en', WIDE)).toBeUndefined();
  });

  it('a step known from a tool name but no project → undefined', () => {
    const state: ModState = { ...INITIAL_STATE, step: 2, done: [1], isStale: false };
    expect(bandTree(state, 'en', WIDE)).toBeUndefined();
  });

  it('a stale state (after /clear) → undefined, even with a project in it', () => {
    const state: ModState = { ...STEP_6, isStale: true };
    expect(bandTree(state, 'en', WIDE)).toBeUndefined();
    expect(statusLine(state, 'en')).toBeUndefined();
  });

  it('a project but no step → undefined', () => {
    const state: ModState = { ...STEP_2, step: 0, done: [] };
    expect(bandTree(state, 'en', WIDE)).toBeUndefined();
  });

  it('a state with a project and no environment still shows the project', () => {
    const { environment: _environment, ...rest } = STEP_2;
    expect(line(bandTree(rest, 'en', WIDE))).toMatch(/^LoadCraft · sklep {2}✓ 01/);
  });
});

describe('band: protected environment', () => {
  it('a warning sign sits beside the name', () => {
    const state = stateOf(status('no_runs', { protectedEnv: true, env: 'qa' }));
    const tree = bandTree(state, 'en', WIDE);
    expect(line(tree)).toContain('LoadCraft · sklep · qa ⚠  ');
    expect(run(tree, '⚠')?.props).toMatchObject({ color: 'warning' });
  });

  it('is on the narrow row too, and absent for an environment without a limit', () => {
    const state = stateOf(status('no_runs', { protectedEnv: true, env: 'qa' }));
    expect(line(bandTree(state, 'pl', 70))).toContain('qa ⚠');
    expect(line(bandTree(STEP_6, 'pl', 70))).not.toContain('⚠');
    expect(line(bandTree(STEP_6, 'pl', WIDE))).not.toContain('⚠');
  });
});

describe('band: text from the server', () => {
  it('control characters and escape sequences never reach the row', () => {
    const state = stateOf(
      status('no_runs', { project: 'sk\nlep\u001b[31m\u0007', env: 'pe\trf\u009b' }),
    );
    const text = line(bandTree(state, 'en', WIDE));
    expect(hasControl(text)).toBe(false);
    // The colour sequence goes whole, as in every view of the server (`inline`).
    expect(text).toContain('sk lep');
    expect(text).not.toContain('[31m');
  });

  it('a very long name is cut with an ellipsis', () => {
    const state = stateOf(status('no_runs', { project: 'p'.repeat(200) }));
    const text = line(bandTree(state, 'en', WIDE));
    expect(text).toContain(`${'p'.repeat(31)}…`);
    expect(text).not.toContain('p'.repeat(33));
  });
});

describe('band: colours', () => {
  it('every colour is a theme key or the one accent', () => {
    for (const state of [
      STEP_2,
      STEP_6,
      STEP_8,
      stateOf(status('no_runs', { protectedEnv: true })),
    ]) {
      for (const width of [30, 79, WIDE]) {
        const colours = new Set<string>();
        const visit = (node: unknown): void => {
          if (typeof node !== 'object' || node === null) return;
          const tree = node as Tree;
          for (const key of ['color', 'backgroundColor']) {
            const value = tree.props?.[key];
            if (typeof value === 'string') colours.add(value);
          }
          for (const child of tree.children ?? []) visit(child);
        };
        visit(bandTree(state, 'en', width));
        for (const colour of colours)
          expect(THEME_KEYS.has(colour) || colour === ACCENT).toBe(true);
      }
    }
    expect(ACCENT).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('band: dictionary', () => {
  it('the step names are in both dictionaries, the same eight keys', () => {
    for (let step = 1; step <= 8; step += 1) {
      expect(typeof en[`band.step.${step}` as keyof typeof en]).toBe('string');
      expect(typeof pl[`band.step.${step}` as keyof typeof pl]).toBe('string');
    }
  });
});

describe('bandRow: what lies beneath', () => {
  it('puts the tree and the drawing beneath it in one column', () => {
    const tree = bandTree(STEP_6, 'en', WIDE);
    if (tree === undefined) throw new Error('no tree');
    const beneath = { type: 'Text', children: ['other mod'] };
    const row = bandRow(tree, beneath);
    expect(row.type).toBe('Box');
    expect(row.children).toEqual([tree, beneath]);
    // No size or overflow prop: an older Claude Code lays the other rows out in this Box.
    for (const prop of ['width', 'height', 'overflow', 'maxHeight']) {
      expect(row.props ?? {}).not.toHaveProperty(prop);
    }
  });

  it('draws the tree alone when what lies beneath is no tree', () => {
    const tree = bandTree(STEP_6, 'en', WIDE);
    if (tree === undefined) throw new Error('no tree');
    expect(bandRow(tree, undefined).children).toEqual([tree]);
    expect(bandRow(tree, 'text').children).toEqual([tree]);
    expect(bandRow(tree, null).children).toEqual([tree]);
  });
});

describe('statusLine', () => {
  it('is the short form of the row: project, environment, step, how many are done', () => {
    expect(statusLine(STEP_6, 'en')).toBe('LoadCraft · sklep · perf · 06 Run (5/8)');
    expect(statusLine(STEP_2, 'pl')).toBe('LoadCraft · sklep · perf · 02 Projekt (1/8)');
  });

  it('marks a protected environment', () => {
    const state = stateOf(status('no_runs', { protectedEnv: true, env: 'qa' }));
    expect(statusLine(state, 'en')).toBe('LoadCraft · sklep · qa ⚠ · 06 Run (5/8)');
  });

  it('is undefined while there is nothing to show', () => {
    expect(statusLine(INITIAL_STATE, 'en')).toBeUndefined();
    expect(
      statusLine({ ...INITIAL_STATE, step: 3, done: [1, 2], isStale: false }, 'en'),
    ).toBeUndefined();
  });

  it('is one line of at most 200 characters, with no control characters', () => {
    const state = stateOf(
      status('no_runs', {
        project: 'a\nb'.repeat(200),
        env: 'c\u001b'.repeat(200),
        protectedEnv: true,
      }),
    );
    const text = statusLine(state, 'pl');
    expect(text).toBeDefined();
    expect([...(text ?? '')].length).toBeLessThanOrEqual(200);
    expect(hasControl(text ?? '')).toBe(false);
    expect(text).toContain('06 Uruchomienie');
  });
});

describe('band: a test that passed (FIX-25)', () => {
  const REPORT_READ = reduce(
    stateOf(status('passed_no_diagnosis')),
    { kind: 'tool', tool: 'results_get_report' },
    NOW + 1,
  );

  it('07 is ticked although it is the current step, and 08 is shown as skipped', () => {
    expect(line(bandTree(REPORT_READ, 'en', WIDE))).toBe(
      'LoadCraft · sklep · perf  ✓ 01 API docs  ✓ 02 Project  ✓ 03 Flows  ✓ 04 Scenario  ✓ 05 Test data  ✓ 06 Run  ✓ 07 Report  — 08 Diagnosis (skipped)',
    );
    expect(line(bandTree(REPORT_READ, 'pl', WIDE))).toContain(
      '✓ 07 Raport  — 08 Diagnoza (pominięty)',
    );
  });

  it('the current step is still the bold inverse one, the skipped one is dim', () => {
    const tree = bandTree(REPORT_READ, 'en', WIDE);
    expect(run(tree, '✓ 07 Report')?.props).toMatchObject({
      inverse: true,
      weight: 'bold',
    });
    expect(run(tree, '— 08 Diagnosis (skipped)')?.props).toMatchObject({
      dimColor: true,
    });
    expect(run(tree, '— 08 Diagnosis (skipped)')?.props).not.toHaveProperty('inverse');
  });

  it('narrow: the number carries the mark', () => {
    const text = line(bandTree(REPORT_READ, 'en', 79));
    expect(text).toContain('✓ 07 Report');
    expect(text).toContain('—08');
    expect(text).not.toContain('Diagnosis');
  });

  it('a test that failed has 08 ahead, not skipped', () => {
    const failed = reduce(
      stateOf(status('no_analysis')),
      { kind: 'tool', tool: 'results_get_report' },
      NOW + 1,
    );
    const text = line(bandTree(failed, 'en', WIDE));
    expect(text).toContain('✓ 07 Report  08 Diagnosis');
    expect(text).not.toContain('skipped');
  });

  it('the status line names the skipped step', () => {
    expect(statusLine(REPORT_READ, 'en')).toBe(
      'LoadCraft · sklep · perf · 07 Report (7/8) · 08 skipped',
    );
    expect(statusLine(REPORT_READ, 'pl')).toBe(
      'LoadCraft · sklep · perf · 07 Raport (7/8) · 08 pominięty',
    );
  });
});
