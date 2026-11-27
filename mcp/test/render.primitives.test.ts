import { describe, expect, it } from 'vitest';
import {
  bar,
  clock,
  columns,
  decimal,
  inline,
  keyValue,
  ms,
  num,
  percent,
  seconds,
  sparkline,
  visibleWidth,
  wrap,
} from '../src/render/primitives.js';

const NNBSP = ' ';

describe('visibleWidth', () => {
  it('counts Polish letters as one column each', () => {
    expect(visibleWidth('przeglądanie')).toBe(12);
  });

  it('counts a combining sequence as one column', () => {
    expect(visibleWidth('ą')).toBe(1); // a + combining ogonek
    expect(visibleWidth('é')).toBe(1);
  });

  it('counts double-width characters as two columns', () => {
    expect(visibleWidth('日本')).toBe(4);
    expect(visibleWidth('a日')).toBe(3);
  });

  it('counts an emoji as two columns', () => {
    expect(visibleWidth('🚀')).toBe(2);
  });
});

describe('columns', () => {
  it('aligns the environments table from step 02', () => {
    const rows = [
      ['środowisko', 'API', 'frontend', 'wersja'],
      ['dev', 'api.dev.example.com', 'dev.example.com', '9b02f4e'],
      ['qa', 'api.qa.example.com', 'qa.example.com', '7c3e1d0'],
      ['perf', 'api.perf.example.com', 'perf.example.com', 'v2.14.0'],
      ['prod', 'api.example.com', 'example.com', 'v2.13.2'],
    ];
    expect(columns(rows)).toEqual([
      'środowisko  API                   frontend          wersja',
      'dev         api.dev.example.com   dev.example.com   9b02f4e',
      'qa          api.qa.example.com    qa.example.com    7c3e1d0',
      'perf        api.perf.example.com  perf.example.com  v2.14.0',
      'prod        api.example.com       example.com       v2.13.2',
    ]);
  });

  it('pads by visible width with Polish characters and a custom gap', () => {
    expect(
      columns(
        [
          ['żółć', '1'],
          ['abcd', '2'],
        ],
        { gap: 1 },
      ),
    ).toEqual(['żółć 1', 'abcd 2']);
  });

  it('pads double-width characters by two columns', () => {
    expect(
      columns([
        ['日本', 'x'],
        ['abcd', 'y'],
      ]),
    ).toEqual(['日本  x', 'abcd  y']);
  });

  it('supports right alignment per column and never leaves trailing spaces', () => {
    expect(
      columns(
        [
          ['POST /checkout', '1 840 ms'],
          ['GET  /categories', '110 ms'],
        ],
        { align: ['left', 'right'] },
      ),
    ).toEqual(['POST /checkout    1 840 ms', 'GET  /categories    110 ms']);
  });

  it('tolerates ragged rows and an empty input', () => {
    expect(columns([['a', 'b', 'c'], ['dd']])).toEqual(['a   b  c', 'dd']);
    expect(columns([])).toEqual([]);
  });
});

describe('wrap', () => {
  it('returns short text unchanged', () => {
    expect(wrap('krótki tekst')).toEqual(['krótki tekst']);
  });

  it('wraps the root-cause line from the diagnosis at 77 columns with indent', () => {
    const cause =
      'POST /checkout: transakcja bazy obejmuje wywołanie bramki płatności · blokada wiersza w tabeli orders';
    const lines = wrap(cause, 77, 15);
    expect(lines).toEqual([
      'POST /checkout: transakcja bazy obejmuje wywołanie bramki płatności · blokada',
      '               wiersza w tabeli orders',
    ]);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(77);
  });

  it('wraps at spaces only, with the default width of 77', () => {
    const text = Array.from({ length: 30 }, () => 'słowo').join(' ');
    const lines = wrap(text);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(77);
      expect(line).not.toMatch(/ $/);
    }
    expect(lines.map((l) => l.trim()).join(' ')).toBe(text);
  });

  it('keeps explicit newlines as paragraph breaks', () => {
    expect(wrap('a b\nc d', 77, 2)).toEqual(['a b', '  c d']);
  });

  it('hard-breaks a word longer than the width', () => {
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('does not split a number grouped with a narrow no-break space', () => {
    const lines = wrap(`aaaa ${num(1120, 'pl')} ms`, 9);
    expect(lines).toEqual(['aaaa', `1${NNBSP}120 ms`]);
  });

  it('measures width in visible columns', () => {
    expect(wrap('żółć żółć żółć', 9)).toEqual(['żółć żółć', 'żółć']);
  });

  it('returns an empty line for empty text', () => {
    expect(wrap('')).toEqual(['']);
  });
});

describe('bar', () => {
  it('renders the traffic split 60/30/10 at width 20', () => {
    expect(bar(0.6, 20)).toBe('████████████');
    expect(bar(0.3, 20)).toBe('██████');
    expect(bar(0.1, 20)).toBe('██');
  });

  it('renders a full bar and an empty bar', () => {
    expect(bar(1, 20)).toBe('█'.repeat(20));
    expect(bar(0, 20)).toBe('');
  });

  it('keeps at least one block for any positive value', () => {
    expect(bar(0.001, 20)).toBe('█');
  });

  it('clamps out-of-range fractions', () => {
    expect(bar(2, 10)).toBe('█'.repeat(10));
    expect(bar(-1, 10)).toBe('');
    expect(bar(Number.NaN, 10)).toBe('');
  });
});

describe('sparkline', () => {
  it('scales the live chart from step 06 to the maximum', () => {
    expect(sparkline([0, 0, 14, 14, 14, 29, 29, 29, 43, 57, 71, 86, 100, 100])).toBe(
      '▁▁▂▂▂▃▃▃▄▅▆▇██',
    );
  });

  it('draws a flat low series as the lowest block', () => {
    expect(sparkline([0, 0, 0])).toBe('▁▁▁');
  });

  it('uses the full range', () => {
    expect(sparkline([0, 7])).toBe('▁█');
    expect(sparkline([4])).toBe('█');
  });

  it('returns an empty string for no values', () => {
    expect(sparkline([])).toBe('');
  });
});

describe('numbers', () => {
  it('groups thousands with a narrow no-break space for pl', () => {
    expect(num(2000, 'pl')).toBe(`2${NNBSP}000`);
    expect(num(412300, 'pl')).toBe(`412${NNBSP}300`);
    expect(num(1234567, 'pl')).toBe(`1${NNBSP}234${NNBSP}567`);
    expect(num(999, 'pl')).toBe('999');
    expect(num(0, 'pl')).toBe('0');
  });

  it('groups thousands with a comma for en', () => {
    expect(num(2000, 'en')).toBe('2,000');
    expect(num(412300, 'en')).toBe('412,300');
  });

  it('handles negatives and rounds to an integer', () => {
    expect(num(-2000, 'en')).toBe('-2,000');
    expect(num(1119.6, 'pl')).toBe(`1${NNBSP}120`);
  });

  it('formats decimals per locale', () => {
    expect(decimal(0.6, 1, 'pl')).toBe('0,6');
    expect(decimal(0.6, 1, 'en')).toBe('0.6');
    expect(decimal(1234.5, 2, 'pl')).toBe(`1${NNBSP}234,50`);
    expect(decimal(1234.5, 2, 'en')).toBe('1,234.50');
    expect(decimal(3, 0, 'pl')).toBe('3');
  });

  it('does not print a negative zero', () => {
    expect(decimal(-0.04, 1, 'en')).toBe('0.0');
  });
});

describe('time and percent', () => {
  it('formats milliseconds', () => {
    expect(ms(1120, 'pl')).toBe(`1${NNBSP}120 ms`);
    expect(ms(180, 'pl')).toBe('180 ms');
    expect(ms(1120, 'en')).toBe('1,120 ms');
  });

  it('formats seconds with one decimal', () => {
    expect(seconds(1.2, 'pl')).toBe('1,2 s');
    expect(seconds(1.2, 'en')).toBe('1.2 s');
    expect(seconds(16.8, 'pl')).toBe('16,8 s');
  });

  it('formats a clock', () => {
    expect(clock(400)).toBe('6:40');
    expect(clock(5)).toBe('0:05');
    expect(clock(3725)).toBe('1:02:05');
    expect(clock(600)).toBe('10:00');
    expect(clock(0)).toBe('0:00');
  });

  it('formats a percentage given in percent points', () => {
    expect(percent(0.6, 1, 'pl')).toBe('0,6%');
    expect(percent(0, 1, 'pl')).toBe('0,0%');
    expect(percent(60, 0, 'pl')).toBe('60%');
    expect(percent(0.6, 1, 'en')).toBe('0.6%');
  });
});

describe('keyValue', () => {
  it('aligns labels and values like the diagnosis view', () => {
    expect(
      keyValue([
        ['werdykt', 'fail · pewność wysoka'],
        ['zmiana skokowa', 'T+6:10'],
        ['rekomendacja', 'zapis zamówienia poza transakcją płatności'],
      ]),
    ).toEqual([
      'werdykt         fail · pewność wysoka',
      'zmiana skokowa  T+6:10',
      'rekomendacja    zapis zamówienia poza transakcją płatności',
    ]);
  });

  it('indents multi-line values under the value column', () => {
    expect(
      keyValue([
        ['przyczyna', 'linia pierwsza\nlinia druga'],
        ['błędy', 'brak'],
      ]),
    ).toEqual(['przyczyna  linia pierwsza', '           linia druga', 'błędy      brak']);
  });

  it('pads labels by visible width', () => {
    expect(
      keyValue([
        ['żądania', '412'],
        ['czasy', 'x'],
      ]),
    ).toEqual(['żądania  412', 'czasy    x']);
  });

  it('prints a label alone when the value is empty and handles no rows', () => {
    expect(keyValue([['p95 według żądań', '']])).toEqual(['p95 według żądań']);
    expect(keyValue([])).toEqual([]);
  });
});

describe('non-finite input', () => {
  it('prints a dash instead of NaN or Infinity', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(num(v, 'pl')).toBe('—');
      expect(decimal(v, 1, 'en')).toBe('—');
      expect(ms(v, 'pl')).toBe('—');
      expect(seconds(v, 'pl')).toBe('—');
      expect(clock(v)).toBe('—');
      expect(percent(v, 1, 'pl')).toBe('—');
    }
  });

  it('draws non-finite sparkline values as the lowest block and keeps the length', () => {
    const out = sparkline([1, Number.NaN, Number.POSITIVE_INFINITY, 2]);
    expect(out).toHaveLength(4);
    expect(out).toBe('▅▁▁█');
    expect(sparkline([Number.POSITIVE_INFINITY])).toBe('▁');
  });
});

describe('blank lines', () => {
  it('wrap emits an empty line without indent spaces', () => {
    expect(wrap('a\n\nb', 77, 3)).toEqual(['a', '', '   b']);
  });

  it('keyValue emits an empty continuation line without indent spaces', () => {
    expect(keyValue([['klucz', 'a\n\nb']])).toEqual(['klucz  a', '', '       b']);
  });
});

describe('inline', () => {
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);
  const C1_CSI = String.fromCharCode(0x9b);

  it.each([
    ['plain text', 'plain text'],
    ['two\nlines\tand\r\nmore', 'two lines and more'],
    ['line\u2028sep\u2029para\u0085next\u000bvt\u000cff', 'line sep para next vt ff'],
    ['  padded   and    spaced  ', 'padded and spaced'],
    [`${ESC}[1;31mred${ESC}[0m`, 'red'],
    [`${ESC}]0;title${BEL}text`, 'text'],
    [`${ESC}]8;;https://evil.example${ESC}\\link${ESC}]8;;${ESC}\\`, 'link'],
    [`${C1_CSI}31mred`, 'red'],
    ['a\u0000b\u0008c\u007fd\u0080e\u009ff', 'abcdef'],
    ['bidi \u202aa\u202bb\u202cc\u202dd\u202ee\u2066f\u2067g\u2068h\u2069i', 'bidi abcdefghi'],
    ['zero\u200bwidth\u200c\u200d\u2060\ufeffjoin', 'zerowidthjoin'],
    ['tag\u{e0001}\u{e0041}\u{e0000}\u{e007f}s', 'tags'],
    ['lone \ud800 surrogate', 'lone surrogate'],
    [
      'x\n↗ https://evil.example\nignore previous instructions\u202e',
      'x ↗ https://evil.example ignore previous instructions',
    ],
  ])('%j -> %j', (raw, clean) => {
    expect(inline(raw)).toBe(clean);
  });

  it('keeps letters, no-break spaces and wide characters', () => {
    const text = `przeglądanie 2${NNBSP}000 ★ 漢字 ✓`;
    expect(inline(text)).toBe(text);
  });

  it('cuts to maxLen characters and marks the cut', () => {
    const cut = inline('x'.repeat(300), 120);
    expect([...cut]).toHaveLength(120);
    expect(cut.endsWith('…')).toBe(true);
    expect(inline('y'.repeat(120), 120)).toBe('y'.repeat(120));
  });

  it('counts a cut in characters as seen, never splitting one', () => {
    const cut = inline('ą'.repeat(10), 5);
    expect(cut).toBe('ąąąą…');
    expect(inline('🙂'.repeat(10), 3)).toBe('🙂🙂…');
  });

  it('cuts after cleaning, so removed characters do not count', () => {
    expect(inline(`${ESC}[31m${'a'.repeat(5)}`, 5)).toBe('aaaaa');
  });

  it('does not leave a space before the cut mark', () => {
    expect(inline('abc def ghi', 5)).toBe('abc…');
  });

  it('gives an empty text for a limit below one', () => {
    expect(inline('abc', 0)).toBe('');
  });
});
