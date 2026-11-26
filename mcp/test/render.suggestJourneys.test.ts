import { describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import {
  renderSuggestJourneys,
  type SuggestionsData,
  type SuggestionView,
} from '../src/render/views/suggestJourneys.js';

const rung = (n: number): SuggestionView => ({
  name: `Rung ${String(n)} of the shop`,
  steps: Array.from({ length: n }, (_, i) => `Step ${String(i + 1)}`),
  patternType: 'journey_slice',
});

const MIXED: SuggestionView[] = [
  { name: 'Buying', steps: ['Log in', 'Add to cart', 'Pay'], patternType: 'semantic' },
  { name: 'Cart area', steps: ['Open cart', 'Empty cart'], patternType: 'tag_group' },
  { name: 'Lifecycle', steps: ['Create item', 'Read item', 'Delete item'], patternType: 'crud' },
  { name: 'No token', steps: ['List items'], patternType: 'auth_rejection' },
  rung(1),
  rung(2),
  rung(3),
  rung(4),
];

function data(suggestions: SuggestionView[], rest: Partial<SuggestionsData> = {}): SuggestionsData {
  return {
    suggestions,
    more: 0,
    coverage: { covered: 10, total: 10, uncovered: [], more: 0 },
    failedUnits: [],
    refined: true,
    ...rest,
  };
}

const render = (view: SuggestionsData, locale: 'en' | 'pl' = 'en'): string =>
  renderSuggestJourneys(view, createTranslator(locale));

const lineOf = (text: string, start: string): string =>
  text.split('\n').find((line) => line.startsWith(start)) ?? '';

describe('proposal kinds', () => {
  it('names the kind of every proposal with a short label, in both languages', () => {
    const en = render(data(MIXED), 'en');
    expect(lineOf(en, 'Buying')).toContain('[journey]');
    expect(lineOf(en, 'Cart area')).toContain('[feature]');
    expect(lineOf(en, 'Lifecycle')).toContain('[CRUD]');
    expect(lineOf(en, 'No token')).toContain('[expects 401]');
    const pl = render(data(MIXED), 'pl');
    expect(lineOf(pl, 'Buying')).toContain('[ścieżka]');
    expect(lineOf(pl, 'Cart area')).toContain('[funkcja]');
  });

  it('draws arrows only where the order is the plan', () => {
    const text = render(data(MIXED));
    expect(lineOf(text, 'Buying')).not.toContain('→');
    expect(lineOf(text, 'Buying')).toContain('Log in · Add to cart · Pay');
    expect(lineOf(text, 'Cart area')).not.toContain('→');
    expect(lineOf(text, 'Lifecycle')).toContain('Create item → Read item → Delete item');
  });

  it('says once that the order of unordered proposals is set at build time', () => {
    const en = render(data(MIXED), 'en');
    expect(en.match(/the generator sets the order of steps/g)).toHaveLength(1);
    expect(render(data(MIXED), 'pl')).toContain('kolejność kroków ustala generator');
    expect(render(data([rung(1), rung(2)]))).not.toContain('generator');
  });
});

describe('the ladder of slices', () => {
  const text = render(data(MIXED));

  it('is one entry with the count and the range, not one line per rung', () => {
    const header = text
      .slice(text.indexOf('ladder:'), text.indexOf('rungs:'))
      .replace(/\n\s*/g, ' ');
    expect(header).toContain('4 rungs');
    expect(header).toContain('Rung 1 of the shop');
    expect(header).toContain('Rung 4 of the shop');
    expect(header).toContain('1 step');
    expect(header).toContain('4 steps');
    expect(text.split('\n').filter((line) => line.startsWith('Rung'))).toEqual([]);
  });

  it('still lists every rung name, unchanged, for the build', () => {
    for (const n of [1, 2, 3, 4]) expect(text).toContain(`Rung ${String(n)} of the shop`);
    expect(text).not.toContain('Step 3');
  });

  it('keeps a lone rung an ordinary entry', () => {
    const single = render(data([rung(2)]));
    expect(single).not.toContain('ladder');
    expect(lineOf(single, 'Rung 2')).toContain('Step 1 → Step 2');
  });

  it('is announced in Polish with a plural of the count', () => {
    const pl = render(data(MIXED), 'pl');
    expect(lineOf(pl, 'drabina:')).toContain('4 szczeble');
  });
});

describe('the list is not cut', () => {
  it('shows 27 proposals of a real mix whole: 7 entries and one ladder', () => {
    const many = [...MIXED.slice(0, 3), ...Array.from({ length: 20 }, (_, i) => rung(i + 1))];
    const text = render(data(many));
    expect(text).not.toContain('more');
    for (let n = 1; n <= 20; n += 1) expect(text).toContain(`Rung ${String(n)} of the shop`);
  });

  it('says what happens to the rest when entries beyond the limit are left out', () => {
    const lots = Array.from({ length: 30 }, (_, i) => ({
      name: `Journey ${String(i)}`,
      steps: ['Do it'],
      patternType: 'semantic',
    }));
    const text = render(data(lots));
    expect(text).toContain('and 5 more');
    expect(text).toMatch(/saved for the build/);
  });
});

describe('API coverage line', () => {
  it('is printed also at 100%, in the same place', () => {
    const text = render(
      data(MIXED, { coverage: { covered: 10, total: 10, uncovered: [], more: 0 } }),
    );
    expect(text).toContain('10 of 10 operations · 0 outside the journeys');
    const partial = render(
      data(MIXED, { coverage: { covered: 8, total: 10, uncovered: ['X'], more: 0 } }),
    );
    const at = (t: string): number =>
      t.split('\n').findIndex((l) => l.includes(' of 10 operations'));
    expect(at(text)).toBe(at(partial));
  });

  it('is skipped when the project has no operations at all', () => {
    const text = render(
      data(MIXED, { coverage: { covered: 0, total: 0, uncovered: [], more: 0 } }),
    );
    expect(text).not.toContain('operations');
  });
});
