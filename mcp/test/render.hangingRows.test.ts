// A table whose last column wraps must never leave that column a sliver: when the columns in front
// of it take the width, the rows switch to a block layout (head line, detail indented below).

import { describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import { hangingRows, MIN_DETAIL_WIDTH, visibleWidth } from '../src/render/primitives.js';
import { renderDataPlan, type DataPlanView } from '../src/render/views/data.js';

const t = createTranslator('en');

/** Small deterministic generator (mulberry32), so a failing case can be replayed. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['couponCode', 'email', 'notes', 'paymentMethod', 'productVariant', 'quantity', 'x'];

function phrase(next: () => number, words: number): string {
  return Array.from({ length: words }, () => WORDS[Math.floor(next() * WORDS.length)]).join(' ');
}

describe('hangingRows', () => {
  it('keeps the aligned layout while the detail has room', () => {
    const lines = hangingRows(
      [
        { cells: ['a', 'x'], detail: 'first detail' },
        { cells: ['bbb', 'y'], detail: 'second' },
      ],
      { gap: 2, width: 77 },
    );
    expect(lines).toEqual(['a    x  first detail', 'bbb  y  second']);
  });

  it('switches to blocks when the detail column would be narrower than the minimum', () => {
    const head = 'L'.repeat(70);
    const lines = hangingRows(
      [{ cells: [head, 'missing'], detail: 'couponCode · email · notes' }],
      {
        gap: 2,
        width: 77,
      },
    );
    expect(lines[0]).toContain(head);
    expect(lines.slice(1).join(' ')).toContain('couponCode · email · notes');
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(77);
  });

  it('property: no line is wider than the width, the detail column is never below the minimum, nothing is lost', () => {
    const next = rng(29);
    for (let round = 0; round < 300; round++) {
      const width = 40 + Math.floor(next() * 60);
      const rows = Array.from({ length: 1 + Math.floor(next() * 4) }, () => ({
        cells: [
          phrase(next, 1 + Math.floor(next() * 12))
            .replaceAll(' ', '_')
            .slice(0, width - 12),
          'missing',
        ],
        detail: phrase(next, Math.floor(next() * 14)),
      }));
      const lines = hangingRows(rows, { gap: 2, width });
      const text = lines.join('\n');
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      const prefix = Math.max(...rows.map((row) => visibleWidth(row.cells[0] ?? ''))) + 2 + 7 + 2;
      const aligned = width - prefix >= MIN_DETAIL_WIDTH;
      // The detail's text is intact whatever the layout.
      for (const row of rows) {
        for (const word of row.detail.split(' ').filter((w) => w !== ''))
          expect(text).toContain(word);
        expect(text).toContain(row.cells[0] ?? '');
      }
      // The layout choice follows the rule, and a block layout stays short.
      const detailWords = rows.reduce((n, row) => n + row.detail.length, 0);
      expect(lines.length).toBeLessThanOrEqual(
        rows.length * (2 + Math.ceil(detailWords / (width - 4))) + 2,
      );
      if (aligned) {
        for (const line of lines) {
          // an aligned continuation line starts at the detail column, which is at most width - minimum
          expect(line.length - line.trimStart().length).toBeLessThanOrEqual(
            width - MIN_DETAIL_WIDTH,
          );
        }
      } else {
        for (const line of lines)
          expect(line.length - line.trimStart().length).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('the data plan with a long slot label', () => {
  const view: DataPlanView = {
    target: { kind: 'scenario', name: 'gate-mix' },
    environment: null,
    slots: [
      {
        slot: 'scenario_auto_data',
        label:
          'Couponcode & email & notes & paymentmethod & productvariant & quantity & shippingmethod',
        state: 'missing',
        columns: [
          { name: 'couponCode', qualifier: null },
          { name: 'email', qualifier: null },
          { name: 'notes', qualifier: null },
          { name: 'paymentMethod', qualifier: null },
          { name: 'productVariant', qualifier: null },
          { name: 'quantity', qualifier: '1–5' },
          { name: 'shippingMethod', qualifier: null },
        ],
        sources: [],
        exclusive: false,
        usedBy: [],
      },
    ],
    fixes: [{ kind: 'data_missing', slot: 'scenario_auto_data', label: 'x' }],
    ready: false,
    proposed: [],
    steps: [],
  };

  it('keeps the slot key whole, shortens the label and stays short and narrow', () => {
    const text = renderDataPlan(view, t);
    const lines = text.split('\n');
    expect(text).toContain('(slot: scenario_auto_data)');
    expect(text).toContain('+4 more');
    expect(text).toContain('couponCode');
    expect(text).toContain('shippingMethod');
    expect(lines.length).toBeLessThan(14);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(77);
    // no line is a one-character sliver
    for (const line of lines) expect(line.trim().length === 1).toBe(false);
  });
});
