// The step "data for the load" of the gate: accounts are made only for a slot of accounts that the
// preflight still finds missing or blocking. The layout is the one of the live run: a slot of plain
// data that `data_create_dataset` filled (accepted, 100 rows against 200 advised) beside a slot of
// accounts that is still missing.

import { describe, expect, it } from 'vitest';

import {
  accountSlotsToFill,
  callFromText,
  consentOf,
  isPlainData,
  nextCallOf,
  stepsFromText,
} from '../scripts/live-gate.js';
import { createTranslator } from '../src/render/i18n/index.js';
import {
  renderCreateCard,
  renderCreated,
  renderDataPlan,
  type CreateCardView,
  type CreatedView,
  type DataPlanView,
} from '../src/render/views/data.js';

const DATA = { slot: 'extras', key: 'extras', have: 100, need: 200, status: 'ok', blocking: false };
const ACCOUNTS = {
  slot: 'users',
  key: 'users',
  have: null,
  need: null,
  status: 'missing',
  blocking: true,
};
const KINDS = new Map([
  ['extras', { identityKind: null, role: 'data' }],
  ['users', { identityKind: 'existing', role: 'auth' }],
]);

describe('accountSlotsToFill', () => {
  it('creates accounts for the slot of accounts, not for the accepted slot of data with fewer rows than advised', () => {
    const { fill, dataShort } = accountSlotsToFill([DATA, ACCOUNTS], KINDS);
    expect(fill.map((slot) => slot.slot)).toEqual(['users']);
    expect(dataShort.map((slot) => slot.slot)).toEqual(['extras']);
  });

  it('never fills an accepted slot of accounts, even when it has fewer rows than advised', () => {
    const accepted = { ...ACCOUNTS, have: 10, need: 50, status: 'ok', blocking: false };
    expect(accountSlotsToFill([DATA, accepted], KINDS).fill).toEqual([]);
  });

  it('does not make accounts for a slot of plain data that stays missing', () => {
    const open = { ...DATA, have: null, need: null, status: 'missing', blocking: true };
    const result = accountSlotsToFill([open], KINDS);
    expect(result.fill).toEqual([]);
    expect(result.dataStillOpen).toHaveLength(1);
  });

  it('takes a slot without stamps for an unknown, not for plain data', () => {
    expect(isPlainData({ identityKind: null, role: null })).toBe(false);
    expect(accountSlotsToFill([ACCOUNTS], new Map()).fill).toHaveLength(1);
  });

  it('does not decide by the column names or the name of the slot', () => {
    const named = { ...ACCOUNTS, slot: 'users' };
    const kinds = new Map([['users', { identityKind: null, role: 'data' }]]);
    expect(accountSlotsToFill([named], kinds).fill).toEqual([]);
  });
});

// The data tools answer with text only: the gate reads the token of a consent card, the numbered
// calls of a plan and the `→ next:` call where a model reads them. These texts come from the views
// of the plugin, not from copies, so a change of the views fails here first.
describe('the calls the gate reads from a data result', () => {
  const t = createTranslator('en');
  const longName = 'Sklep coupons, notes: quantity of the spring sale for every shop of the region';

  it('reads the token of the consent card of data_create_dataset, wrapped or not', () => {
    const view: CreateCardView = {
      needsConfirmation: true,
      confirm: 'k3Zp9qWx',
      name: longName,
      source: {
        kind: 'file',
        file: 'loadcraft/accounts.csv',
        size: 1200,
        sha256: 'ab'.repeat(32),
        rows: 30,
      },
      slot: { slot: 'accounts', target: 'gate-mix' },
      rows: null,
      revision: false,
    };
    expect(consentOf(renderCreateCard(view, t))).toEqual({
      tool: 'data_create_dataset',
      token: 'k3Zp9qWx',
    });
    expect(consentOf('slot scenario_auto_data: dataset "x data" made from its columns')).toBe(
      undefined,
    );
  });

  it('reads the numbered calls of a plan in their order, with their exact arguments', () => {
    const view: DataPlanView = {
      target: { kind: 'composition', name: 'gate-mix' },
      environment: 'gate',
      slots: [],
      fixes: [],
      ready: false,
      proposed: [],
      steps: [
        { tool: 'data_create_dataset', args: { scenario: 'gate-mix', slot: 'scenario_auto_data' } },
        {
          tool: 'data_create_dataset',
          args: { scenario: 'gate-mix', slot: 'order_details', project: 'sklep' },
        },
      ],
    };
    expect(stepsFromText(renderDataPlan(view, t))).toEqual(view.steps);
    expect(stepsFromText(renderDataPlan({ ...view, steps: [] }, t))).toEqual([]);
  });

  it('reads the pin a created dataset names, a long map across lines', () => {
    const next = {
      tool: 'data_set_bindings' as const,
      args: {
        scenario: 'gate-mix',
        bindings: { accounts: longName, order_details: 'order_details data', notes: 'a, b: c' },
      },
    };
    const bare: CreatedView = { source: 'slot', name: longName, rows: 200, slot: 'accounts' };
    const text = renderCreated({ ...bare, next }, t);
    expect(text.split('\n').length).toBeGreaterThan(2);
    expect(nextCallOf(text)).toEqual(next);
    expect(nextCallOf(renderCreated(bare, t))).toBe(undefined);
  });

  it('reads no call from a text that is not one', () => {
    expect(callFromText('data_set_bindings scenario "gate-mix"')).toBe(undefined);
    expect(callFromText('data_check_readiness scenario: "gate-mix"')).toEqual({
      tool: 'data_check_readiness',
      args: { scenario: 'gate-mix' },
    });
  });
});
