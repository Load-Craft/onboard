// The flow outline view against the four "zakupy" golden texts, the nested flow, the cut at the
// step limit and the generator questions.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildOutline, MAX_OUTLINE_STEPS, type FlowOutline } from '../src/flow/outline.js';
import type { components } from '../src/http/generated/api.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { renderFlowList, renderFlowOutline } from '../src/render/views/flowOutline.js';
import { createIdSource, createStore } from './fake-backend/store.js';
import { SKLEP_COLLECTIONS, seedSklep } from './fake-backend/worlds/sklep.js';
import { goldenText, type GoldenRun } from './golden/index.js';

type FlowDetail = components['schemas']['FlowDetail'];

const pl = createTranslator('pl');
const en = createTranslator('en');

function fixture(name: string): FlowDetail {
  const url = new URL(`./fixtures/flows/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as FlowDetail;
}

/** The golden text without its link lines. */
function goldenLines(run: GoldenRun, file: string): string[] {
  return goldenText(run, file)
    .replace(/\n$/u, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('↗'));
}

/** Lines of the golden text from the outline header on, the header written as the view writes it. */
function outlineOf(run: GoldenRun, file: string): string[] {
  const lines = goldenLines(run, file);
  const start = lines.findIndex((line) => /^(flow „)?zakupy”? .*kroków \(/.test(line));
  return lines
    .slice(start)
    .map((line, index) => (index === 0 ? line.replace(/^flow „zakupy” gotowy/, 'zakupy') : line));
}

const ZAKUPY: [string, GoldenRun, string, string][] = [
  ['run 1', 'run1', '04-flows_generate_from_suggestions', 'zakupy-run1'],
  ['run 2', 'run2', '03-flows_generate_from_endpoints', 'zakupy-run2-reczne'],
  ['run 3', 'run3', '04-flows_record_journeys', 'zakupy-run3-opis'],
  ['run 4', 'run4', '04-flows_generate_from_har', 'zakupy-run4-har'],
];

describe('renderFlowOutline, full', () => {
  it.each(ZAKUPY)(
    '%s: the rows of the golden text, character for character',
    (_l, run, file, name) => {
      const text = renderFlowOutline(buildOutline(fixture(name)), pl, { mode: 'full' });
      const golden = outlineOf(run, file);
      // Run 1 and 4 follow with the other flows on one line; the outline itself ends at the last row.
      const rows = golden.filter((line) => !/^przeglądanie · /.test(line));
      expect(text.split('\n')).toEqual(rows);
    },
  );

  it('names the action class of the next request, not an activity', () => {
    const text = renderFlowOutline(buildOutline(fixture('zakupy-run2-reczne')), pl, {
      mode: 'full',
    });
    expect(text).toContain('założona · strona');
    expect(text).toContain('założona · akcja w stronie');
    expect(text).toContain('założona · formularz');
    expect(text).not.toContain('wpisuje');
  });

  it('writes a recorded pause as one value, kept at the backend cap, in the locale of the call', () => {
    const outline = buildOutline(fixture('zakupy-run4-har'));
    expect(renderFlowOutline(outline, pl, { mode: 'full' })).toContain('4,2 s');
    const english = renderFlowOutline(outline, en, { mode: 'full' });
    expect(english).toContain('4.2 s');
    expect(english).toContain('recorded · form');
    expect(english).toContain('4 requests · 3 pauses');
  });

  it('indents the steps inside a container and keeps their numbers', () => {
    const outline = buildOutline(fixture('katalog-petla-galaz'));
    const lines = renderFlowOutline(outline, pl, { mode: 'full' }).split('\n').slice(1);
    expect(lines).toHaveLength(outline.steps.length);
    const starts: number[] = [];
    outline.steps.forEach((item, index) => {
      const line = lines[index] ?? '';
      expect(line.trimStart().startsWith(`${item.num}  `), line).toBe(true);
      if (item.kind === 'request') starts.push(line.indexOf(item.path ?? '?') - item.depth * 2);
    });
    // Every request's path starts at its level's indent from one and the same column.
    expect(new Set(starts).size).toBe(1);
    expect(Math.max(...outline.steps.map((item) => item.depth))).toBeGreaterThan(0);
  });

  it('says how many steps it shows when the outline was cut', () => {
    const base = buildOutline(fixture('zakupy-run1'));
    const cut: FlowOutline = {
      ...base,
      stepCount: MAX_OUTLINE_STEPS + 40,
      truncated: true,
    };
    const text = renderFlowOutline(cut, pl, { mode: 'full' });
    expect(text.split('\n').at(-1)).toBe(
      `pokazano ${String(base.steps.length)} z ${String(MAX_OUTLINE_STEPS + 40)} kroków`,
    );
    expect(renderFlowOutline(cut, en, { mode: 'full' }).split('\n').at(-1)).toBe(
      `showing ${String(base.steps.length)} of ${String(MAX_OUTLINE_STEPS + 40)} steps`,
    );
    expect(renderFlowOutline(base, pl, { mode: 'full' })).not.toContain('pokazano');
  });

  it('puts the generator questions under the outline', () => {
    const questions = [
      { field: 'auth.token', question: 'Które konto loguje?', why: 'x', kind: 'auth' },
      { field: 'status', question: 'Jakie statusy kończą odpytywanie?', why: '', kind: 'poll' },
    ];
    const lines = renderFlowOutline(buildOutline(fixture('zakupy-run1')), pl, {
      mode: 'full',
      questions,
    }).split('\n');
    expect(lines.slice(-2)).toEqual([
      'pytanie · auth.token: Które konto loguje?',
      'pytanie · status: Jakie statusy kończą odpytywanie?',
    ]);
  });
});

describe('renderFlowOutline, line', () => {
  it('is the name and the step count', () => {
    const outline = buildOutline(fixture('zakupy-run1'));
    expect(
      renderFlowOutline({ ...outline, name: 'przeglądanie', stepCount: 3 }, pl, { mode: 'line' }),
    ).toBe('przeglądanie · 3 kroki');
    expect(
      renderFlowOutline({ ...outline, name: 'browse', stepCount: 1 }, en, { mode: 'line' }),
    ).toBe('browse · 1 step');
  });
});

describe('renderFlowList', () => {
  function sklepOutlines(): FlowOutline[] {
    const store = createStore(createIdSource(1));
    seedSklep(store, { stage: 'flows' });
    const flows = store.collection<FlowDetail>(SKLEP_COLLECTIONS.flows).list();
    return ['zakupy', 'przeglądanie', 'konto'].map((name) => {
      const found = flows.find((flow) => flow.name === name);
      if (found === undefined) throw new Error(`no flow ${name}`);
      return buildOutline(found);
    });
  }

  it.each([
    ['run1', '04-flows_generate_from_suggestions'],
    ['run4', '04-flows_generate_from_har'],
  ] as const)(
    '%s: the first flow in full, the others on one line, as the golden text',
    (run, file) => {
      const [zakupy, ...others] = sklepOutlines();
      if (zakupy === undefined) throw new Error('no outline');
      const first = run === 'run4' ? buildOutline(fixture('zakupy-run4-har')) : zakupy;
      expect(renderFlowList([first, ...others], pl)).toBe(goldenLines(run, file).join('\n'));
    },
  );

  it('counts the flows with the plural of the language', () => {
    const [first] = sklepOutlines();
    if (first === undefined) throw new Error('no outline');
    const many = (n: number): FlowOutline[] => Array.from({ length: n }, () => first);
    expect(renderFlowList(many(2), pl).split('\n')[0]).toBe('2 flowy gotowe');
    expect(renderFlowList(many(5), pl).split('\n')[0]).toBe('5 flowów gotowych');
    expect(renderFlowList(many(1), pl).split('\n')[0]).toBe('1 flow gotowy');
    expect(renderFlowList(many(3), en).split('\n')[0]).toBe('3 flows ready');
  });

  it('wraps the one-line flows within the view width', () => {
    const [first] = sklepOutlines();
    if (first === undefined) throw new Error('no outline');
    const outlines = Array.from({ length: 9 }, (_v, i) => ({
      ...first,
      name: `flow-numer-${String(i)}`,
    }));
    const lines = renderFlowList(outlines, pl).split('\n');
    expect(lines.every((line) => [...line].length <= 77)).toBe(true);
    expect(lines.join(' ')).toContain('flow-numer-8 · 7 kroków');
  });
});
