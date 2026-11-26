// The live gate reads the proposals of `flows_suggest_journeys` the way a model reads them: from the text
// of the view. The texts here come from the real view, so a change of its layout that the parser
// does not follow turns these tests red. The first real run read 0 names from 81 proposals because
// the parser knew only one-line rows.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import {
  renderSuggestJourneys,
  type SuggestionsData,
  type SuggestionView,
} from '../src/render/views/suggestJourneys.js';
import { ARROW, NAME_COLUMN_MAX, SET_SEPARATOR } from '../src/render/suggestJourneysLayout.js';
import {
  chooseJourneys,
  journeysFromText,
  proposalsFromText,
  readConfig,
  riskOf,
  type Proposal,
} from '../scripts/live-gate.js';

const LONG_FIRST_STEP =
  'Issues a session token from the e-mail address and the password of a customer of the shop';

function suggestion(name: string, steps: string[], patternType = 'semantic'): SuggestionView {
  return { name, steps, patternType };
}

const SHORT = suggestion('Checkout', ['Adds a product to the cart', 'Places the order']);
const LONG_FIRST = suggestion('Account', [
  LONG_FIRST_STEP,
  'Shows the orders of the customer',
  'Updates the shipping address of the customer',
]);
const LONG_NAME = suggestion('Administrator account lifecycle and audit trail', [
  'Issues an administrator token',
  'Deletes an administrator account.',
  'Lists the administrator accounts and the audit log entries recorded for one of them',
]);
const REJECTION = suggestion('Orders without a token', ['Lists the orders'], 'auth_rejection');
const NO_STEPS = suggestion('Empty', []);

function data(suggestions: SuggestionView[], rest: Partial<SuggestionsData> = {}): SuggestionsData {
  return {
    suggestions,
    more: 0,
    coverage: { covered: 0, total: 0, uncovered: [], more: 0 },
    failedUnits: [],
    refined: true,
    ...rest,
  };
}

const TAIL = {
  more: 14,
  coverage: {
    covered: 1234,
    total: 2000,
    uncovered: ['List the audit entries', 'Export the report of the whole month to a file', 'Ping'],
    more: 4,
  },
  failedUnits: ['payments', 'invoices and the credit notes of the shop'],
  refined: false,
} satisfies Partial<SuggestionsData>;

function render(view: SuggestionsData, locale: 'en' | 'pl' = 'en'): string {
  return renderSuggestJourneys(view, createTranslator(locale));
}

describe('reading the proposals from the text of the view', () => {
  it('uses a name column that the long names do not fit', () => {
    expect(LONG_NAME.name.length).toBeGreaterThan(NAME_COLUMN_MAX);
  });

  it.each([
    ['one-line rows', [SHORT, NO_STEPS]],
    [
      'a first step too long for the row, so the first arrow is on a continuation line',
      [LONG_FIRST],
    ],
    ['a name too long for the column, steps on the lines below', [LONG_NAME]],
    ['all kinds in one list', [SHORT, LONG_FIRST, LONG_NAME, REJECTION, NO_STEPS]],
    [
      'only long names, no column at all',
      [LONG_NAME, { ...LONG_NAME, name: `${LONG_NAME.name} 2` }],
    ],
  ])('recovers every name and every step: %s', (_what, list) => {
    for (const locale of ['en', 'pl'] as const) {
      const text = render(data(list), locale);
      const proposals = proposalsFromText(text);
      expect(proposals.map((p) => p.name)).toEqual(list.map((p) => p.name));
      expect(journeysFromText(text)).toEqual(list.map((p) => p.name));
      list.forEach((item, i) => {
        const steps = proposals[i]?.steps ?? '';
        for (const step of item.steps) expect(steps).toContain(step);
        expect(
          steps.split(ARROW).flatMap((part) => part.split(SET_SEPARATOR)).length,
        ).toBeGreaterThanOrEqual(Math.max(1, item.steps.length));
      });
    }
  });

  it('does not take the lines after the list for proposals', () => {
    const list = [SHORT, LONG_FIRST, LONG_NAME];
    for (const locale of ['en', 'pl'] as const) {
      const text = render(data(list, TAIL), locale);
      expect(text.split('\n').length).toBeGreaterThan(list.length * 2 + 4);
      expect(journeysFromText(text)).toEqual(list.map((p) => p.name));
    }
  });

  it('does not take the title or the tail for a name, also with long names only', () => {
    const text = render(data([LONG_NAME], TAIL));
    expect(journeysFromText(text)).toEqual([LONG_NAME.name]);
  });

  it('reads nothing from a list without proposals', () => {
    expect(journeysFromText(render(data([])))).toEqual([]);
  });
});

function proposal(name: string, steps: string): Proposal {
  return { name, steps };
}

describe('what the default choice leaves out', () => {
  it.each([
    ['a step that deletes', 'Logs in → Deletes an administrator account.'],
    ['a step that removes', 'Lists the carts → Removes the avatar image of a customer.'],
    ['a step that deactivates', 'Logs in → Deactivates the account of a customer'],
    ['a step that disables', 'Logs in → Disables the account of a customer'],
    ['a method DELETE', 'Logs in → DELETE /api/orders/{id}'],
    ['a step that changes a password', 'Logs in → Changes the password of a customer'],
    ['a step that sets permissions', 'Logs in → Updates the permissions of a role'],
    ['an administration step', 'Lists the administrator accounts → Shows one'],
  ])('%s', (_what, steps) => {
    expect(riskOf(proposal('Journey', steps))).toBeDefined();
  });

  it('an administration name', () => {
    expect(riskOf(proposal('Admin dashboard', 'Lists the orders'))).toBeDefined();
  });

  it.each([
    ['Checkout', 'Adds a product to the cart → Places the order'],
    ['Browse', 'Lists the categories → Shows a product → Searches the products'],
    ['Login only', 'Issues a session token from the e-mail address and the password'],
    ['Orders', 'Lists the orders of the customer → Shows the status of an order'],
  ])('keeps %s', (name, steps) => {
    expect(riskOf(proposal(name, steps))).toBeUndefined();
  });
});

const PROPOSALS: Proposal[] = [
  proposal('Administrator account lifecycle', 'Logs in → Deletes an administrator account.'),
  proposal('Address inspect and audit', 'Issues an administrator JWT → Retrieves one address'),
  proposal('Browse the shop', 'Lists the categories → Shows a product'),
  proposal('Checkout', 'Adds a product to the cart → Places the order'),
  proposal('Order status', 'Places the order → Polls its status'),
  proposal('Cart removal', 'Adds a product → DELETE /api/cart/items/{id}'),
];

describe('choosing the journeys', () => {
  it('takes the first safe proposals, never one with a deleting or an administration step', () => {
    const choice = chooseJourneys(PROPOSALS, { count: 2 });
    expect(choice.problem).toBeUndefined();
    expect(choice.taken).toEqual(['Browse the shop', 'Checkout']);
    expect(choice.skipped.map((s) => s.name)).toEqual([
      'Administrator account lifecycle',
      'Address inspect and audit',
      'Cart removal',
    ]);
    expect(choice.skipped.every((s) => s.reason !== '')).toBe(true);
  });

  it('says what is left when there are too few safe proposals', () => {
    const choice = chooseJourneys(PROPOSALS, { count: 4 });
    expect(choice.problem).toMatch(/3 safe proposals/u);
    expect(choice.problem).toMatch(/journeys\.names/u);
    expect(choice.problem).toContain('Cart removal');
  });

  it('takes exactly the names asked for, whatever they do', () => {
    const choice = chooseJourneys(PROPOSALS, {
      count: 2,
      names: ['Checkout', 'Administrator account lifecycle'],
    });
    expect(choice.problem).toBeUndefined();
    expect(choice.taken).toEqual(['Checkout', 'Administrator account lifecycle']);
  });

  it('fails when a name is not in the text and lists the names that are', () => {
    const choice = chooseJourneys(PROPOSALS, { count: 2, names: ['Checkout', 'Chekout'] });
    expect(choice.taken).toEqual([]);
    expect(choice.problem).toMatch(/Chekout/u);
    for (const p of PROPOSALS) expect(choice.problem).toContain(p.name);
  });

  it('compares names exactly', () => {
    const choice = chooseJourneys(PROPOSALS, { count: 1, names: ['checkout'] });
    expect(choice.problem).toBeDefined();
  });
});

describe('the configuration of the journeys', () => {
  function read(journeys: unknown): { value?: ReturnType<typeof readConfig>; error?: string } {
    const dir = mkdtempSync(join(tmpdir(), 'gate-config-'));
    try {
      const file = join(dir, 'gate.json');
      writeFileSync(
        file,
        JSON.stringify({
          backend: { url: 'http://127.0.0.1:8100' },
          workspace: { openapi: 'openapi.json' },
          environments: {
            main: { name: 'a', api: 'https://a.example.com' },
            capped: { name: 'b', api: 'https://a.example.com', limit: [5, 5] },
          },
          langfuse: { url: 'https://lf.example.com', environment: 'x' },
          journeys,
        }),
      );
      return { value: readConfig(file) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('accepts the number and the object with names', () => {
    expect(read(2).error).toBeUndefined();
    expect(read({ names: ['Checkout', 'Browse the shop'] }).error).toBeUndefined();
    expect(read({ count: 3 }).error).toBeUndefined();
  });

  it('refuses names that are not a list of strings', () => {
    expect(read({ names: 'Checkout' }).error).toMatch(/journeys\.names/u);
    expect(read({ names: [1] }).error).toMatch(/journeys\.names/u);
  });
});

describe('the ladder of the view', () => {
  const rung = (n: number): SuggestionView => ({
    name: `Login + Browse ${String(n)} of the shop and the long tail of the name`,
    steps: Array.from({ length: n }, (_, i) => `Step ${String(i + 1)}`),
    patternType: 'journey_slice',
  });
  const rungs = [1, 2, 3, 4, 5, 6, 7, 8].map(rung);
  const other = suggestion('Returns', ['Lists the returns'], 'crud');
  const list = [SHORT, ...rungs, other];

  it('does not take the rungs for proposals, in both languages', () => {
    for (const locale of ['en', 'pl'] as const) {
      const text = render(data(list, TAIL), locale);
      expect(journeysFromText(text)).toEqual(['Checkout', 'Returns']);
    }
  });

  it('refuses a rung in journeys.names and lists the available names', () => {
    const proposals = proposalsFromText(render(data(list)));
    const choice = chooseJourneys(proposals, { count: 1, names: [rungs[5]?.name ?? ''] });
    expect(choice.taken).toEqual([]);
    expect(choice.problem).toContain('does not choose the rungs of a ladder');
    expect(choice.problem).toContain('"Checkout"');
  });

  it('lets prefer take the next proposal or the default one when only a rung matches', () => {
    const proposals = proposalsFromText(render(data(list)));
    const choice = chooseJourneys(proposals, { count: 1, prefer: ['Browse 3'] });
    expect(choice.taken).toEqual(['Checkout']);
  });
});
