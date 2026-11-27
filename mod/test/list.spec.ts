// Vitest file (see capabilities.spec.ts for why it is not named *.test.ts).
//
// The list of the panel (view/list.ts) as data: the filter, the rows with their marks and names, the
// preview and the way back, the groups, and the counter of marked and shown entries.
import { describe, expect, it } from 'vitest';

import {
  EMPTY_VIEW,
  listTree,
  matches,
  rowKeyOf,
  WINDOW,
  addedMarks,
  entryOfElement,
  toggledMarks,
  visibleEntries,
  withBack,
  withGroupToggled,
  withOpen,
  withQuery,
  type ListEntry,
  type ListNode,
  type ListSpec,
  type ListView,
} from '../src/view/list.js';
import { text } from '../src/view/tree.js';

const ENTRIES: readonly ListEntry[] = [
  {
    key: 'Checkout',
    label: 'Checkout',
    notes: ['User journey'],
    search: 'Log in · Pay',
    summary: '2 steps',
  },
  { key: 'Zażółć', label: 'Zażółć gęślą jaźń', notes: ['CRUD'], search: 'Utwórz · Usuń' },
  { key: 'R1', label: 'Rung one', notes: ['Slice'], search: 'Log in', group: 'ladder' },
  { key: 'R2', label: 'Rung two', notes: ['Slice'], search: 'Log in · Open cart', group: 'ladder' },
];

const spec = (
  view: ListView = EMPTY_VIEW,
  marked: readonly string[] = [],
  hotkeys = true,
  limit?: number,
): ListSpec => ({
  id: 'journey',
  entries: ENTRIES,
  groups: [{ key: 'ladder', label: 'Ladder: 2 rungs', summary: 'from 1 to 2 steps' }],
  marks: { marked: new Set(marked), ...(limit === undefined ? {} : { limit }) },
  view,
  hotkeys,
  preview: (entry) => [text(`preview of ${entry.key}`)],
  texts: {
    filter: 'Filter',
    placeholder: 'name or step',
    counter: (count, visible, limit) =>
      `marked: ${String(count)}${limit === undefined ? '' : ` of ${String(limit)}`}, shown: ${String(visible)}`,
    empty: 'Nothing proposed.',
    noMatch: 'Nothing matches.',
    more: (count) => `+${String(count)} more`,
    back: 'Back to the list',
    mark: 'Mark',
    unmark: 'Unmark',
    markCurrent: 'x: mark the row',
  },
});

function walk(node: ListNode): ListNode[] {
  return node.type === 'Box' ? [node, ...node.children.flatMap(walk)] : [node];
}
const all = (nodes: readonly ListNode[]): ListNode[] => nodes.flatMap(walk);
const buttons = (nodes: readonly ListNode[]) =>
  all(nodes).flatMap((node) => (node.type === 'Button' ? [node] : []));
const texts = (nodes: readonly ListNode[]): string =>
  all(nodes)
    .flatMap((node) =>
      node.type === 'Text' ? [node.children.join('')] : node.type === 'Button' ? [node.label] : [],
    )
    .join('\n');

describe('the filter', () => {
  it('keeps the entries every word is found in, by name or by the search text, any case', () => {
    expect(visibleEntries(ENTRIES, withQuery(EMPTY_VIEW, 'log')).map((e) => e.key)).toEqual([
      'Checkout',
      'R1',
      'R2',
    ]);
    expect(visibleEntries(ENTRIES, withQuery(EMPTY_VIEW, 'LOG cart')).map((e) => e.key)).toEqual([
      'R2',
    ]);
    expect(visibleEntries(ENTRIES, withQuery(EMPTY_VIEW, '  ')).map((e) => e.key)).toHaveLength(4);
  });

  it('ignores the marks of letters both ways', () => {
    expect(matches(ENTRIES[1] as ListEntry, 'zazolc jazn')).toBe(true);
    expect(matches(ENTRIES[1] as ListEntry, 'usun')).toBe(true);
    expect(matches(ENTRIES[0] as ListEntry, 'łóg')).toBe(true);
    expect(matches(ENTRIES[0] as ListEntry, 'zażółć')).toBe(false);
  });

  it('is an input field that holds the query, and says when nothing matches', () => {
    const nodes = listTree(spec(withQuery(EMPTY_VIEW, 'nothing like it')));
    const input = all(nodes).find((node) => node.type === 'Input');
    expect(input).toMatchObject({
      type: 'Input',
      key: 'journey-filter',
      value: 'nothing like it',
      list: 'journey',
    });
    expect(texts(nodes)).toContain('Nothing matches.');
    expect(texts(nodes)).toContain('marked: 0, shown: 0');
  });
});

describe('the rows', () => {
  it('a row is a mark and a name: Enter on the mark marks, Enter on the name opens the preview', () => {
    const nodes = listTree(spec());
    const mark = buttons(nodes).find((b) => b.key === 'journey-0');
    const name = buttons(nodes).find((b) => b.key === 'journey-open-0');
    expect(mark).toMatchObject({
      label: '[ ]',
      action: { kind: 'list.mark', list: 'journey', keys: ['Checkout'] },
    });
    expect(name).toMatchObject({
      label: 'Checkout',
      action: { kind: 'list.open', list: 'journey', key: 'Checkout' },
    });
    expect(texts(listTree(spec(EMPTY_VIEW, ['Checkout'])))).toContain('[x]');
  });

  it('the counter counts every mark, also one the filter hides, and the entries shown', () => {
    const nodes = listTree(spec(withQuery(EMPTY_VIEW, 'zazolc'), ['Checkout', 'R1']));
    expect(texts(nodes)).toContain('marked: 2, shown: 1');
    expect(buttons(nodes).map((b) => b.key)).toEqual([
      'journey-find',
      'journey-mark-current',
      'journey-1',
      'journey-open-1',
    ]);
  });

  it('every key is unique', () => {
    for (const view of [
      EMPTY_VIEW,
      withGroupToggled(EMPTY_VIEW, 'ladder'),
      withQuery(EMPTY_VIEW, 'log'),
    ]) {
      const keys = all(listTree(spec(view))).flatMap((node) =>
        node.type === 'Button' || node.type === 'Input' ? [node.key] : [],
      );
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('with no entries says so, without a filter', () => {
    const nodes = listTree({ ...spec(), entries: [] });
    expect(texts(nodes)).toBe('Nothing proposed.');
    expect(all(nodes).some((node) => node.type === 'Input')).toBe(false);
  });
});

describe('an entry that cannot be marked', () => {
  it('has no mark and no mark in its preview; the others keep theirs', () => {
    const entries: readonly ListEntry[] = [
      { key: 'A', label: 'Plain', notes: [], search: '' },
      { key: 'B', label: 'Odd', notes: [], search: '', unmarkable: true },
    ];
    const nodes = listTree({ ...spec(), entries, groups: [] });
    expect(buttons(nodes).map((b) => b.key)).toEqual([
      'journey-find',
      'journey-mark-current',
      'journey-0',
      'journey-open-0',
      'journey-open-1',
    ]);
    const noted = listTree({
      ...spec(),
      entries,
      groups: [],
      texts: { ...spec().texts, unmarkable: 'cannot be marked' },
    });
    expect(texts(noted)).toContain('cannot be marked');
    const open = listTree({ ...spec(withOpen(EMPTY_VIEW, 'B')), entries, groups: [] });
    expect(buttons(open).map((b) => b.key)).toEqual(['journey-back']);
  });
});

describe('a group (a ladder)', () => {
  it('is one row, closed at first; its mark marks every rung, its name opens it', () => {
    const closed = listTree(spec());
    expect(texts(closed)).toContain('▸ Ladder: 2 rungs');
    expect(texts(closed)).toContain('from 1 to 2 steps');
    expect(buttons(closed).some((b) => b.key === 'journey-open-2')).toBe(false);
    expect(buttons(closed).find((b) => b.key === 'journey-group-0')?.action).toEqual({
      kind: 'list.mark',
      list: 'journey',
      keys: ['R1', 'R2'],
    });
    expect(buttons(closed).find((b) => b.key === 'journey-group-open-0')?.action).toEqual({
      kind: 'list.group',
      list: 'journey',
      group: 'ladder',
    });
    const open = listTree(spec(withGroupToggled(EMPTY_VIEW, 'ladder'), ['R2']));
    expect(texts(open)).toContain('▾ Ladder: 2 rungs');
    expect(buttons(open).find((b) => b.key === 'journey-group-0')?.label).toBe('[-]');
    expect(buttons(open).find((b) => b.key === 'journey-3')?.label).toBe('[x]');
    expect(buttons(open).find((b) => b.key === 'journey-2')?.label).toBe('[ ]');
  });

  it('opens by itself under a filter and holds only the rungs it matches', () => {
    const nodes = listTree(spec(withQuery(EMPTY_VIEW, 'cart')));
    expect(texts(nodes)).toContain('▾ Ladder: 2 rungs');
    expect(buttons(nodes).find((b) => b.key === 'journey-group-0')?.action).toMatchObject({
      keys: ['R2'],
    });
    expect(buttons(nodes).some((b) => b.key === 'journey-open-2')).toBe(false);
    expect(buttons(nodes).some((b) => b.key === 'journey-open-3')).toBe(true);
  });

  it('a press on its mark marks all rungs, and a second one, with all marked, unmarks them', () => {
    expect(toggledMarks(['X', 'R2'], ['R1', 'R2'])).toEqual(['X', 'R2', 'R1']);
    expect(toggledMarks(['X', 'R2', 'R1'], ['R1', 'R2'])).toEqual(['X']);
    expect(toggledMarks(['X'], ['X'])).toEqual([]);
  });
});

describe('the preview and the way back', () => {
  it('shows the entry with its body, a way back (b) and its mark (x)', () => {
    const nodes = listTree(spec(withOpen(withQuery(EMPTY_VIEW, 'log'), 'Checkout'), ['Checkout']));
    expect(texts(nodes)).toContain('preview of Checkout');
    expect(all(nodes).some((node) => node.type === 'Input')).toBe(false);
    const back = buttons(nodes).find((b) => b.key === 'journey-back');
    const mark = buttons(nodes).find((b) => b.key === 'journey-preview-mark');
    expect(back).toMatchObject({
      label: '← Back to the list',
      hotkey: 'b',
      action: { kind: 'list.back' },
    });
    expect(mark).toMatchObject({
      label: '[x] Unmark',
      hotkey: 'x',
      action: { keys: ['Checkout'] },
    });
  });

  it('has no hotkeys where the surface draws none', () => {
    const nodes = listTree(spec(withOpen(EMPTY_VIEW, 'Checkout'), [], false));
    expect(buttons(nodes).some((b) => b.hotkey !== undefined)).toBe(false);
    expect(buttons(nodes).find((b) => b.key === 'journey-preview-mark')?.label).toBe('[ ] Mark');
  });

  it('back keeps the filter and the open groups, and names the row to put the cursor on', () => {
    const before = withGroupToggled(withQuery(EMPTY_VIEW, 'log'), 'ladder');
    const back = withBack(withOpen(before, 'R2'));
    expect(back).toEqual(before);
    expect(withBack(before)).toBe(before);
    const keys = ENTRIES.map((entry) => entry.key);
    expect(rowKeyOf('journey', keys, 'R2')).toBe('journey-open-3');
    expect(rowKeyOf('journey', keys, 'gone')).toBeUndefined();
  });

  it('an entry that left the list draws the list, not an empty preview', () => {
    const nodes = listTree(spec(withOpen(EMPTY_VIEW, 'gone')));
    expect(all(nodes).some((node) => node.type === 'Input')).toBe(true);
  });
});

describe('the head of the list, the window and the limit', () => {
  it('the filter field does not take the keys by itself; f puts the cursor in it', () => {
    const nodes = listTree(spec());
    const input = all(nodes).find((node) => node.type === 'Input');
    expect(input).not.toHaveProperty('autoFocus');
    expect(buttons(nodes).find((b) => b.key === 'journey-find')).toMatchObject({
      hotkey: 'f',
      action: { kind: 'list.find', list: 'journey' },
    });
    expect(buttons(listTree(spec(EMPTY_VIEW, [], false))).some((b) => b.hotkey !== undefined)).toBe(
      false,
    );
  });

  it('x marks the row under the cursor: by the mark or the name of a row', () => {
    const keys = ENTRIES.map((entry) => entry.key);
    expect(buttons(listTree(spec())).find((b) => b.key === 'journey-mark-current')).toMatchObject({
      hotkey: 'x',
      action: { kind: 'list.markCurrent', list: 'journey' },
    });
    expect(entryOfElement('journey', keys, 'journey-open-1')).toBe('Zażółć');
    expect(entryOfElement('journey', keys, 'journey-3')).toBe('R2');
    expect(entryOfElement('journey', keys, 'journey-filter')).toBeUndefined();
    expect(entryOfElement('journey', keys, 'journey-group-0')).toBeUndefined();
    expect(entryOfElement('journey', keys, undefined)).toBeUndefined();
  });

  it('draws at most WINDOW rows and names the rest, which the filter reaches', () => {
    const many: ListEntry[] = Array.from({ length: 120 }, (_, i) => ({
      key: `J${String(i)}`,
      label: `Journey ${String(i)}`,
      notes: [],
      search: i === 110 ? 'needle' : '',
    }));
    const nodes = listTree({ ...spec(EMPTY_VIEW, ['J115']), entries: many });
    const names = buttons(nodes).filter((b) => b.key.startsWith('journey-open-'));
    expect(names).toHaveLength(WINDOW);
    expect(texts(nodes)).toContain(`+${String(120 - WINDOW)} more`);
    expect(texts(nodes)).toContain('marked: 1, shown: 120');
    const found = listTree({ ...spec(withQuery(EMPTY_VIEW, 'needle'), ['J115']), entries: many });
    expect(buttons(found).map((b) => b.key)).toContain('journey-open-110');
    expect(texts(found)).not.toContain('more');
  });

  it('counts the marks of the limit, and marking stops at it', () => {
    expect(texts(listTree(spec(EMPTY_VIEW, ['R1'], true, 2)))).toContain(
      'marked: 1 of 2, shown: 4',
    );
    expect(toggledMarks(['A'], ['B', 'C'], 2)).toEqual(['A', 'B']);
    expect(toggledMarks(['A', 'B'], ['C'], 2)).toEqual(['A', 'B']);
    expect(addedMarks(['A'], ['A', 'B', 'C'], 2)).toEqual(['A', 'B']);
    expect(addedMarks(['A', 'B'], ['B'])).toEqual(['A', 'B']);
  });

  it('a list to read takes no marks: no [ ], no x, no mark in the preview', () => {
    const full = spec();
    const reading: ListSpec = {
      id: full.id,
      entries: full.entries,
      groups: full.groups,
      view: full.view,
      texts: full.texts,
      preview: full.preview,
      hotkeys: full.hotkeys,
    };
    const nodes = listTree(reading);
    expect(buttons(nodes).some((b) => b.label.startsWith('['))).toBe(false);
    expect(buttons(nodes).some((b) => b.key === 'journey-mark-current')).toBe(false);
    const preview = listTree({ ...reading, view: withOpen(EMPTY_VIEW, 'Checkout') });
    expect(buttons(preview).map((b) => b.key)).toEqual(['journey-back']);
  });

  it('every text from the data reads as one line', () => {
    const odd: ListEntry = {
      key: 'odd',
      label: 'two\nlines',
      notes: ['a\tnote'],
      summary: 'sum\nmary',
      search: '',
    };
    const nodes = listTree({ ...spec(), entries: [odd] });
    for (const node of all(nodes)) {
      if (node.type === 'Button') expect(node.label).not.toMatch(/[\n\t]/u);
      if (node.type === 'Text') expect(node.children.join('')).not.toMatch(/[\n\t]/u);
    }
  });
});
