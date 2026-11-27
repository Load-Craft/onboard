/**
 * Building blocks shared by every tool view: columns, wrapping to the view width,
 * bars, a sparkline, and locale-aware numbers and times. Pure functions, no dependencies.
 *
 * Widths are measured in visible terminal columns: a grapheme cluster (found with
 * `Intl.Segmenter`) counts as one column, a wide (East Asian, emoji) cluster as two,
 * and a lone combining or format mark as none.
 */

export type Locale = 'pl' | 'en';
export type Align = 'left' | 'right';

/** Default width of a view line (the layout budget of a tool result). */
export const VIEW_WIDTH = 77;

/** Thousands separator for Polish: narrow no-break space, so a number never splits when wrapped. */
const PL_GROUP = ' ';

/** Shown instead of NaN or Infinity. */
const NO_VALUE = '—';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, CJK compatibility
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe6f], // CJK compatibility forms
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], // pictographs, emoticons
  [0x1f900, 0x1f9ff], // supplemental pictographs
  [0x20000, 0x3fffd], // CJK extensions B and up
];

const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]+$/u;
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;

function graphemeWidth(grapheme: string): number {
  if (ZERO_WIDTH.test(grapheme)) return 0;
  const cp = grapheme.codePointAt(0);
  if (cp === undefined) return 0;
  if (EMOJI_PRESENTATION.test(grapheme)) return 2;
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp >= lo && cp <= hi) return 2;
  }
  return 1;
}

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/** Number of terminal columns the text occupies. */
export function visibleWidth(text: string): number {
  let width = 0;
  for (const g of graphemes(text)) width += graphemeWidth(g);
  return width;
}

function pad(text: string, width: number, align: Align): string {
  const fill = ' '.repeat(Math.max(0, width - visibleWidth(text)));
  return align === 'right' ? fill + text : text + fill;
}

/**
 * Aligns rows into columns, each as wide as its widest cell. The last cell of a row is
 * never padded when left-aligned, so lines carry no trailing spaces.
 */
export function columns(
  rows: readonly (readonly string[])[],
  options: { gap?: number; align?: readonly Align[] } = {},
): string[] {
  const gap = ' '.repeat(options.gap ?? 2);
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, visibleWidth(cell));
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) => {
        const align = options.align?.[i] ?? 'left';
        if (align === 'left' && i === row.length - 1) return cell;
        return pad(cell, widths[i] ?? 0, align);
      })
      .join(gap)
      .trimEnd(),
  );
}

/** The narrowest a wrapped (last) column may get; below it a table switches to blocks. */
export const MIN_DETAIL_WIDTH = 24;

/** Indent of the detail lines under a head line in the block layout. */
const BLOCK_INDENT = 2;

/**
 * Rows whose last column is free text that wraps: `cells` are aligned to the widest of each
 * column, the `detail` is wrapped under the column after them. When the columns in front leave
 * the detail less than `MIN_DETAIL_WIDTH`, every row is shown as a block instead (the cells on
 * a line of their own, the detail indented below it), so no column is ever squeezed to a sliver.
 * Cells are never cut; a cell wider than the width is the caller's to shorten.
 */
export function hangingRows(
  rows: readonly { readonly cells: readonly string[]; readonly detail: string }[],
  options: { gap?: number; width?: number; minDetail?: number } = {},
): string[] {
  const gap = options.gap ?? 2;
  const width = options.width ?? VIEW_WIDTH;
  const minDetail = options.minDetail ?? MIN_DETAIL_WIDTH;
  const widths: number[] = [];
  for (const row of rows) {
    row.cells.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, visibleWidth(cell));
    });
  }
  const prefix = widths.reduce((sum, w) => sum + w + gap, 0);
  const spacer = ' '.repeat(gap);
  if (width - prefix >= minDetail) {
    return rows.flatMap((row) => {
      const [first = '', ...rest] = wrap(row.detail, width - prefix);
      const head = row.cells.map((cell, i) => pad(cell, widths[i] ?? 0, 'left')).join(spacer);
      return [(head + spacer + first).trimEnd(), ...rest.map((line) => ' '.repeat(prefix) + line)];
    });
  }
  return rows.flatMap((row) => [
    ...wrap(row.cells.join(spacer).trimEnd(), width),
    ...(row.detail === ''
      ? []
      : wrap(row.detail, width - BLOCK_INDENT).map((line) => ' '.repeat(BLOCK_INDENT) + line)),
  ]);
}

/** Splits a word wider than `width` into chunks that each fit. */
function hardBreak(word: string, width: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const g of graphemes(word)) {
    const w = graphemeWidth(g);
    if (currentWidth + w > width && current !== '') {
      chunks.push(current);
      current = '';
      currentWidth = 0;
    }
    current += g;
    currentWidth += w;
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

/**
 * Wraps text on spaces. Continuation lines start with `indent` spaces and, like every
 * line, fit within `width` columns. A newline in the text starts a new (indented) line.
 * Only the ASCII space separates words: no-break spaces stay inside a word.
 */
export function wrap(text: string, width = VIEW_WIDTH, indent = 0): string[] {
  const prefix = ' '.repeat(indent);
  const room = Math.max(1, width - indent);
  const lines: string[] = [];

  text.split('\n').forEach((paragraph, index) => {
    const firstRoom = index === 0 && lines.length === 0 ? width : room;
    let limit = firstRoom;
    let current = '';
    let currentWidth = 0;
    const flush = (): void => {
      lines.push(lines.length === 0 || current === '' ? current : prefix + current);
      current = '';
      currentWidth = 0;
      limit = room;
    };

    for (const word of paragraph.split(' ').filter((w) => w !== '')) {
      const wordWidth = visibleWidth(word);
      if (current !== '' && currentWidth + 1 + wordWidth <= limit) {
        current += ` ${word}`;
        currentWidth += 1 + wordWidth;
        continue;
      }
      if (current !== '') flush();
      if (wordWidth <= limit) {
        current = word;
        currentWidth = wordWidth;
        continue;
      }
      const chunks = hardBreak(word, limit);
      chunks.slice(0, -1).forEach((chunk) => {
        current = chunk;
        flush();
      });
      current = chunks[chunks.length - 1] ?? '';
      currentWidth = visibleWidth(current);
    }
    if (current !== '' || paragraph === '' || lines.length === 0) flush();
  });

  return lines;
}

// ---- text from outside ------------------------------------------------------------------

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI_8BIT = String.fromCharCode(0x9b);
const OSC_8BIT = String.fromCharCode(0x9d);
const ST_8BIT = String.fromCharCode(0x9c);

/** Operating-system commands (`ESC ] … BEL` or `… ESC \`), e.g. a terminal title or a hyperlink. */
const OSC = new RegExp(
  `(?:${ESC}\\]|${OSC_8BIT})[^${BEL}${ESC}${ST_8BIT}]*(?:${BEL}|${ESC}\\\\|${ST_8BIT})?`,
  'gu',
);
/** Control sequences (`ESC [ … final`), colours and cursor moves; also the one-byte introducer. */
const CSI = new RegExp(`(?:${ESC}\\[|${CSI_8BIT})[0-?]*[ -/]*[@-~]`, 'gu');
/** Any other two-byte escape (`ESC` and one character). */
const ESCAPE = new RegExp(`${ESC}[@-_]`, 'gu');
/** Tabs and every kind of line break: each becomes a space. */
const BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/gu;
/** Controls (C0, C1), format characters (bidi, zero-width), lone surrogates and tag characters. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\u{E0000}-\u{E007F}]/gu;
const SPACES = / {2,}/gu;

/**
 * `inline()` without the cut: the one-line form of a text. The secret masker searches for a
 * registered value in this form too, so it knows the value after a view put it on one line.
 */
export function oneLine(text: string): string {
  return text
    .replace(OSC, '')
    .replace(CSI, '')
    .replace(ESCAPE, '')
    .replace(BREAKS, ' ')
    .replace(INVISIBLE, '')
    .replace(SPACES, ' ')
    .trim();
}

/**
 * Text that came from the backend, a model or a log, made safe to put inside one line of a view:
 * line breaks and tabs become spaces; terminal escape sequences, control characters, bidi and
 * zero-width marks and tag characters are removed; runs of spaces become one; the ends are trimmed.
 * With `maxLen`, a longer text is cut to `maxLen` characters (grapheme clusters, so a letter with
 * its accent or an emoji is never split), the last one being `…`.
 * Every view passes each such value through here, so a name like `x\n↗ https://…` cannot draw a
 * line that looks like a link or an instruction.
 */
export function inline(text: string, maxLen?: number): string {
  const clean = oneLine(text);
  if (maxLen === undefined) return clean;
  if (maxLen < 1) return '';
  const parts = graphemes(clean);
  if (parts.length <= maxLen) return clean;
  return `${parts
    .slice(0, maxLen - 1)
    .join('')
    .trimEnd()}…`;
}

/** Horizontal bar of full blocks; at least one block for any positive fraction. */
export function bar(fraction: number, width: number): string {
  if (!(fraction > 0) || width <= 0) return '';
  const blocks = Math.min(width, Math.max(1, Math.round(fraction * width)));
  return '█'.repeat(blocks);
}

const SPARK = '▁▂▃▄▅▆▇█';

/** Mini chart scaled to the maximum of the series (values at or below zero are the lowest block). */
export function sparkline(values: readonly number[]): string {
  const max = Math.max(0, ...values.filter(Number.isFinite));
  return values
    .map((v) => {
      if (!Number.isFinite(v) || !(v > 0) || max === 0) return SPARK[0];
      return SPARK[Math.min(SPARK.length - 1, Math.round((v / max) * (SPARK.length - 1)))];
    })
    .join('');
}

function group(digits: string, locale: Locale): string {
  const separator = locale === 'pl' ? PL_GROUP : ',';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** Integer with thousands separators (narrow no-break space for `pl`, comma for `en`). */
export function num(value: number, locale: Locale): string {
  return decimal(value, 0, locale);
}

/** Fixed number of fraction digits, locale decimal mark and thousands separators. */
export function decimal(value: number, digits: number, locale: Locale): string {
  if (!Number.isFinite(value)) return NO_VALUE;
  const fixed = Math.abs(value).toFixed(digits);
  const [whole = '0', fraction] = fixed.split('.');
  const mark = locale === 'pl' ? ',' : '.';
  const body = group(whole, locale) + (fraction === undefined ? '' : mark + fraction);
  const negative = value < 0 && /[1-9]/.test(fixed);
  return negative ? `-${body}` : body;
}

/** Milliseconds, e.g. `1 120 ms`. */
export function ms(value: number, locale: Locale): string {
  return Number.isFinite(value) ? `${num(value, locale)} ms` : NO_VALUE;
}

/** Seconds with one decimal, e.g. `1,2 s`. */
export function seconds(value: number, locale: Locale): string {
  return Number.isFinite(value) ? `${decimal(value, 1, locale)} s` : NO_VALUE;
}

/** Elapsed time as `m:ss`, or `h:mm:ss` from one hour up. */
export function clock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return NO_VALUE;
  const total = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A value already expressed in percent points (0.6 is `0,6%`, not 60%). */
export function percent(value: number, digits: number, locale: Locale): string {
  return Number.isFinite(value) ? `${decimal(value, digits, locale)}%` : NO_VALUE;
}

/**
 * Report/diagnosis layout: labels aligned to the widest one, values after two spaces,
 * continuation lines of a multi-line value indented under the value column.
 */
export function keyValue(rows: readonly (readonly [string, string])[]): string[] {
  const labelWidth = Math.max(0, ...rows.map(([label]) => visibleWidth(label)));
  const indent = ' '.repeat(labelWidth + 2);
  return rows.flatMap(([label, value]) => {
    if (value === '') return [label];
    return value.split('\n').map((line, i) => {
      if (i === 0) return `${pad(label, labelWidth, 'left')}  ${line}`;
      return line === '' ? '' : indent + line;
    });
  });
}
