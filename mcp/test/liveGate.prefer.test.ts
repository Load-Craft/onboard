// `journeys.prefer`: the names of the proposals are made by a model, so they differ from project to
// project and from run to run. The gate picks by patterns matched to the name and the steps, as
// they stand in the text of the real view (long names included), and never fails because a pattern
// found nothing.

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
import { NAME_COLUMN_MAX } from '../src/render/suggestJourneysLayout.js';
import {
  checkLaunch,
  chooseJourneys,
  journeyWish,
  proposalsFromText,
  readConfig,
  type JourneyWish,
} from '../scripts/live-gate.js';

function view(name: string, steps: string[]): SuggestionView {
  return { name, steps, patternType: 'semantic' };
}

// Names of the second real run: long, different from the first run, no cart-to-order journey.
const LIST: SuggestionView[] = [
  view('Administrator account lifecycle and audit trail of the shop', [
    'Issues an administrator token',
    'Lists the administrator accounts',
  ]),
  view('Browse catalog and explore product detail', [
    'Lists the categories of the shop',
    'Shows one product with its reviews',
  ]),
  view('Registered customer — registration, profile and address book', [
    'Registers a customer account from an e-mail address',
    'Shows the profile of the customer',
    'Adds an address to the address book of the customer',
  ]),
  view('Authenticated customer — order history and payment retry', [
    'Lists the orders of the customer',
    'Retries the payment of an order that failed',
  ]),
  view('Customer cleanup of the cart and the account', [
    'Adds a product to the cart',
    'Deletes the account of the customer',
  ]),
  view('Newsletter signup', ['Subscribes an e-mail address to the newsletter']),
];

function data(suggestions: SuggestionView[]): SuggestionsData {
  return {
    suggestions,
    more: 0,
    coverage: { covered: 0, total: 0, uncovered: [], more: 0 },
    failedUnits: [],
    refined: true,
  };
}

const TEXT = renderSuggestJourneys(data(LIST), createTranslator('en'));
const PROPOSALS = proposalsFromText(TEXT);
const BROWSE = 'Browse catalog and explore product detail';
const ORDERS = 'Authenticated customer — order history and payment retry';
const REGISTERED = 'Registered customer — registration, profile and address book';

function choose(prefer: string[], count = prefer.length) {
  const wish: JourneyWish = { count, prefer };
  return chooseJourneys(PROPOSALS, wish);
}

describe('journeys.prefer on the text of the real view', () => {
  it('reads the long names from the view', () => {
    expect(LIST.some((item) => item.name.length > NAME_COLUMN_MAX)).toBe(true);
    expect(PROPOSALS.map((p) => p.name)).toEqual(LIST.map((p) => p.name));
  });

  it('takes the first safe proposal of each pattern, in the order of the patterns', () => {
    const choice = choose(['order|payment', 'browse|catalog|product']);
    expect(choice.problem).toBeUndefined();
    expect(choice.taken).toEqual([ORDERS, BROWSE]);
    expect(choice.notes).toEqual([
      `journeys.prefer /order|payment/ matched: "${ORDERS}"`,
      `journeys.prefer /browse|catalog|product/ matched: "${BROWSE}"`,
    ]);
  });

  it('ignores the case and reads the steps as well as the name', () => {
    // Only in the steps of the journey (the default choice would take the browse journey first).
    expect(choose(['ADDS AN ADDRESS TO THE ADDRESS BOOK']).taken).toEqual([REGISTERED]);
    expect(choose(['RETRIES THE PAYMENT']).taken).toEqual([ORDERS]);
    // Only in the name.
    expect(choose(['NEWSLETTER SIGNUP']).taken).toEqual(['Newsletter signup']);
  });

  it('does not take one proposal for two patterns', () => {
    const choice = choose(['customer', 'customer']);
    expect(choice.taken).toEqual([REGISTERED, ORDERS]);
  });

  it('does not fail when a pattern finds nothing: the default choice fills the place', () => {
    const choice = choose(['cart-to-order checkout'], 2);
    expect(choice.problem).toBeUndefined();
    expect(choice.taken).toEqual([BROWSE, REGISTERED]);
    expect(choice.notes?.[0]).toBe('journeys.prefer /cart-to-order checkout/ matched no proposal');
    expect(choice.notes).toContain(`taken by the default choice instead: "${BROWSE}"`);
  });

  it('keeps the hit and fills only the missing places', () => {
    const choice = choose(['order history', 'nothing like this'], 3);
    expect(choice.taken).toEqual([ORDERS, BROWSE, REGISTERED]);
  });

  it('skips a proposal that only deletes or administers, and fills the place', () => {
    const choice = choose(['cart', 'admin'], 2);
    expect(choice.problem).toBeUndefined();
    expect(choice.taken).not.toContain('Customer cleanup of the cart and the account');
    expect(choice.taken.some((name) => /administrator/iu.test(name))).toBe(false);
    expect(choice.taken).toEqual([BROWSE, REGISTERED]);
    expect(choice.notes?.[0]).toMatch(/\/cart\/ matched only proposals left out: .*deletes/u);
    expect(choice.notes?.[1]).toMatch(/\/admin\/ matched only proposals left out/u);
    expect(choice.skipped.map((s) => s.name)).toContain(
      'Customer cleanup of the cart and the account',
    );
  });

  it('prefers a safe proposal over a risky one that matches the same pattern', () => {
    const choice = choose(['customer']);
    expect(choice.taken).toEqual([REGISTERED]);
  });

  it('says so when even the default choice cannot fill the places', () => {
    const choice = chooseJourneys(PROPOSALS.slice(0, 1), { count: 2, prefer: ['nothing'] });
    expect(choice.taken).toEqual([]);
    expect(choice.problem).toMatch(/0 safe proposals/u);
  });

  it('chooses the same journeys for the same list, however often it is asked', () => {
    const first = choose(['browse|catalog|product', 'cart|checkout|order'], 3);
    for (let i = 0; i < 5; i += 1) {
      expect(choose(['browse|catalog|product', 'cart|checkout|order'], 3)).toEqual(first);
    }
    expect(first.taken).toEqual([BROWSE, ORDERS, REGISTERED]);
  });

  it('follows the order of the proposals when several match one pattern', () => {
    expect(choose(['customer'], 1).taken).toEqual([REGISTERED]);
    const reversed = [...PROPOSALS].reverse();
    expect(chooseJourneys(reversed, { count: 1, prefer: ['customer'] }).taken).toEqual([ORDERS]);
  });

  it('leaves `names` strict: a name that is not there is a problem', () => {
    const choice = chooseJourneys(PROPOSALS, { count: 1, names: ['Catalog browsing'] });
    expect(choice.problem).toMatch(/not found/u);
  });
});

describe('journeys.prefer looks at the names before the steps', () => {
  const GUEST = 'Guest checkout journey';
  const CATALOG = 'Catalog and product pages';
  const CHECKOUT = 'Cart and order placement';
  const PROPOSED = proposalsFromText(
    renderSuggestJourneys(
      data([
        view(GUEST, ['Browses the catalog as a guest', 'Opens a product', 'Pays for the order']),
        view(CATALOG, ['Lists the categories', 'Shows one product']),
        view(CHECKOUT, ['Adds a product to the cart', 'Places the order']),
      ]),
      createTranslator('en'),
    ),
  );

  it('takes the proposal whose name matches, not the first one whose steps match', () => {
    const choice = chooseJourneys(PROPOSED, {
      count: 2,
      prefer: ['browse|catalog|product', 'cart|checkout|order'],
    });
    expect(choice.taken).toEqual([CATALOG, GUEST]);
  });

  it('reads the steps only when no name matches, and never takes one proposal twice', () => {
    const choice = chooseJourneys(PROPOSED, { count: 2, prefer: ['browses the catalog', 'guest'] });
    expect(choice.taken).toEqual([GUEST, CATALOG]);
    expect(choice.notes?.[1]).toMatch(/\/guest\/ matched only proposals already taken/u);
  });
});

describe('the configuration of journeys.prefer', () => {
  function read(journeys: unknown): { error?: string } {
    const dir = mkdtempSync(join(tmpdir(), 'gate-prefer-'));
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
      readConfig(file);
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('accepts patterns and takes their number as the count', () => {
    expect(read({ prefer: ['browse|catalog', 'cart|checkout'] }).error).toBeUndefined();
    expect(journeyWish({ journeys: { prefer: ['a', 'b', 'c'] } })).toEqual({
      count: 3,
      prefer: ['a', 'b', 'c'],
    });
    expect(journeyWish({ journeys: { prefer: ['a'], count: 3 } }).count).toBe(3);
  });

  it('refuses what is not a list of patterns, or a pattern that does not compile', () => {
    expect(read({ prefer: 'browse' }).error).toMatch(/journeys\.prefer/u);
    expect(read({ prefer: [''] }).error).toMatch(/journeys\.prefer/u);
    expect(read({ prefer: ['(open'] }).error).toMatch(/not a regular expression/u);
  });

  function refusals(journeys: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'gate-prefer-'));
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
      return checkLaunch(readConfig(file), {}).join('\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('refuses names together with prefer, a repeated pattern and too many patterns', () => {
    expect(refusals({ names: ['a'], prefer: ['a'] })).toMatch(/exclude each other/u);
    expect(refusals({ prefer: ['a', 'a'] })).toMatch(/lists a pattern twice/u);
    expect(refusals({ prefer: ['a', 'b', 'c', 'd', 'e', 'f'] })).toMatch(/1 to 5 patterns/u);
    expect(refusals({ prefer: ['a', 'b'], count: 1 })).toMatch(/more patterns than/u);
    expect(refusals({ prefer: ['a', 'b'] })).not.toMatch(/journeys\.prefer/u);
  });
});

describe('journeys.prefer on the steps', () => {
  it('does not match the label of the kind the view puts before the steps', () => {
    // The word "journey" is only the label `[journey]`; no step has it.
    const choice = choose(['^journey$']);
    expect(choice.notes?.[0]).toContain('matched no proposal');
    expect(choose(['\\[journey\\]']).notes?.[0]).toContain('matched no proposal');
  });
});
