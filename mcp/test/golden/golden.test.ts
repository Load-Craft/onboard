import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GOLDEN_FILES, GOLDEN_RUNS, goldenName, goldenText, goldenUrl } from './index.js';

const MAX_LINE = 77;

// A link cannot be wrapped without breaking it, so a line that is only an arrow, an optional
// label and one LoadCraft address may be longer than the terminal width (see ROZNICE.md).
const LINK_LINE = /^ *↗ (?:[^\s:]+(?: [^\s:]+)*: )?https:\/\/app\.loadcraft\.io\/\S+$/u;

// Thousands separator in Polish views: U+202F NARROW NO-BREAK SPACE (`2 000`).
const NNBSP = String.fromCharCode(0x202f);
const NBSP = String.fromCharCode(0x00a0);
// A group that still uses a plain or no-break space somewhere in the number.
const PLAIN_GROUP = new RegExp(
  `(?<![\\p{L}\\d])\\d{1,3}(?:${NNBSP}\\d{3})*[ ${NBSP}]\\d{3}(?!\\d)`,
  'u',
);
// A correctly grouped number; whatever U+202F is left after removing these is misplaced.
const GROUPED_NUMBER = new RegExp(`(?<![\\p{L}\\d])\\d{1,3}(?:${NNBSP}\\d{3})+(?!\\d)`, 'gu');

const allFiles = [...new Set(GOLDEN_RUNS.flatMap((run) => GOLDEN_FILES[run]))].sort();

function lines(file: string): string[] {
  return readFileSync(goldenUrl(file), 'utf8').replace(/\n$/u, '').split('\n');
}

describe('golden files', () => {
  it.each(allFiles)('%s exists', (file) => {
    expect(existsSync(goldenUrl(file))).toBe(true);
  });

  it('every file in a run directory is listed by some run', () => {
    const onDisk = GOLDEN_RUNS.flatMap((run) =>
      readdirSync(goldenUrl(run))
        .filter((name) => name.endsWith('.pl.txt'))
        .map((name) => `${run}/${name}`),
    ).sort();
    expect(onDisk).toEqual(allFiles);
  });

  it.each(GOLDEN_RUNS)('%s lists each base name once', (run) => {
    const names = GOLDEN_FILES[run].map(goldenName);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(allFiles)('%s: no line longer than 77 characters, links excepted', (file) => {
    const tooLong = lines(file).filter(
      (line) => [...line].length > MAX_LINE && !LINK_LINE.test(line),
    );
    expect(tooLong).toEqual([]);
  });

  it.each(allFiles)('%s: no tabs, no trailing spaces, no empty lines', (file) => {
    const bad = lines(file).filter(
      (line) => line.includes('\t') || /\s$/u.test(line) || line === '',
    );
    expect(bad).toEqual([]);
  });

  // A number starts after a non-letter, so `p95 210 ms` is a label and a value, not a group.
  it.each(allFiles)('%s: thousands grouped with U+202F', (file) => {
    const plain = lines(file).filter((line) => PLAIN_GROUP.test(line));
    const misplaced = lines(file).filter((line) =>
      line.replace(GROUPED_NUMBER, '').includes(NNBSP),
    );
    expect({ plain, misplaced }).toEqual({ plain: [], misplaced: [] });
  });

  it.each(allFiles)('%s ends with exactly one newline', (file) => {
    const text = readFileSync(goldenUrl(file), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });
});

describe('goldenText', () => {
  it('reads a file owned by the run', () => {
    expect(goldenText('run2', '03-flows_generate_from_endpoints')).toMatch(
      /^flow „zakupy” gotowy/u,
    );
  });

  it('reads a file shared with an earlier run', () => {
    expect(goldenText('run4', '10-run_start')).toBe(goldenText('run1', '10-run_start.pl.txt'));
  });

  it('refuses a name the run does not list', () => {
    expect(() => goldenText('run5', '12-results_analyze_run')).toThrow(/run5/u);
  });
});
