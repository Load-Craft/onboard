// A model reads only the text of a result. The data tools take the KEY of a data slot in their `slot`
// parameter, so every view that names a data slot shows the key next to the label, in the form
// `Label (slot: key)`. The text of the plan, of `process_get_status` (data section and preflight) and of the
// self-check is checked here for the key of each slot, the way a model would have to read it.

import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { createTranslator } from '../src/render/i18n/index.js';
import { renderSelfCheckChain, type ScenarioCheck } from '../src/render/views/selfCheckChain.js';
import { processGetStatus } from '../src/tools/processGetStatus.js';
import { dataCheckReadiness } from '../src/tools/dataCheckReadiness.js';
import { dataCreateDataset } from '../src/tools/dataCreateDataset.js';
import { dataCreateAccounts } from '../src/tools/dataCreateAccounts.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerDataRoutes, seedAutoDatasets } from './fake-backend/routes/data.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerCompositionRoutes } from './fake-backend/routes/compositions.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProvisionRoutes } from './fake-backend/routes/provision.js';
import { registerExecutionRoutes } from './fake-backend/routes/executions.js';
import { registerStatusRoutes } from './fake-backend/routes/status.js';
import { seedSklep, type SklepStage } from './fake-backend/worlds/sklep.js';
import { createTestClock } from './helpers/clock.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

const NOW = Date.parse('2026-11-22T10:30:00Z');
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

const KEYS = ['search_phrases', 'order_details', 'accounts'] as const;
const LOCALES = ['en', 'pl'] as const;

async function rig(stage: SklepStage, locale: 'en' | 'pl'): Promise<ToolRig> {
  return toolRig({
    tools: [dataCheckReadiness, dataCreateAccounts, processGetStatus],
    world: (fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerStatusRoutes(fake);
      registerDataRoutes(fake);
      registerExecutionRoutes(fake);
      registerProvisionRoutes(fake);
      registerCompositionRoutes(fake);
      seedSklep(fake.store, { stage });
      seedAutoDatasets(fake.store);
    },
    fake: {
      meta: {
        capabilities: [
          'meta',
          'provision_environment',
          'provision_register_operation',
          'provision_protected_confirmation',
        ],
      },
    },
    clock: createTestClock(NOW),
    env: { LOADCRAFT_LOCALE: locale },
    files: BOUND,
  });
}

describe.each(LOCALES)('slot key in views (%s)', (locale) => {
  it('the data plan shows the key of every slot as `(slot: key)`', async () => {
    const r = await rig('scenario', locale);
    const result = await r.call('data_check_readiness', { scenario: 'checkout' });
    if (result.isError) throw new Error(result.text);
    for (const key of KEYS) expect(result.text).toMatch(new RegExp(`\\(slot:\\s+${key}\\)`, 'u'));
  });

  it('the data section of process_get_status shows the key of every slot', async () => {
    const r = await rig('scenario', locale);
    const result = await r.call('process_get_status', { detail: 'data' });
    if (result.isError) throw new Error(result.text);
    for (const key of KEYS) expect(result.text).toMatch(new RegExp(`\\(slot:\\s+${key}\\)`, 'u'));
  });

  it('the preflight of process_get_status names the key of the slot the data is short on', async () => {
    const r = await rig('data', locale);
    const result = await r.call('process_get_status', {
      preflight: {
        scenario: 'checkout',
        environment: 'perf',
        profile: { type: 'ramp_concurrency', vusers: 5000, ramp: 600 },
      },
    });
    if (result.isError) throw new Error(result.text);
    expect(result.text).toMatch(/\(slot: accounts\)/u);
  });

  it('the preflight names the key of a slot that has no dataset at all', async () => {
    const r = await rig('scenario', locale);
    const result = await r.call('process_get_status', {
      preflight: {
        scenario: 'checkout',
        environment: 'perf',
        profile: { type: 'smoke', vusers: 1 },
      },
    });
    if (result.isError) throw new Error(result.text);
    expect(result.text).toMatch(/\(slot: accounts\)/u);
  });

  it('the unknown-slot error lists the keys to choose from', async () => {
    const r = await rig('scenario', locale);
    const result = await r.call('data_create_accounts', {
      scenario: 'checkout',
      slot: 'User accounts',
      count: 10,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[slot_unknown]');
    for (const key of KEYS) expect(result.text).toContain(key);
  });
});

describe.each(LOCALES)('slot key in the self-check (%s)', (locale) => {
  const t = createTranslator(locale);
  const check: ScenarioCheck = {
    name: 'zakupy',
    status: 'waiting_for_data',
    steps: [],
    requests: 0,
    responseMs: 0,
    failure: null,
    notes: [],
    missingSlots: [
      { slot: 'accounts', label: 'User accounts' },
      { slot: 'cards', label: 'Cards' },
    ],
    repairs: [],
  };

  it('names the label and the key of each slot the check waits for', () => {
    const text = renderSelfCheckChain({ scenarios: [check] }, t);
    expect(text).toContain('User accounts (slot: accounts)');
    expect(text).toContain('Cards (slot: cards)');
  });

  it('does not repeat a label that is already the key', () => {
    const text = renderSelfCheckChain(
      { scenarios: [{ ...check, missingSlots: [{ slot: 'accounts', label: 'accounts' }] }] },
      t,
    );
    expect(text).not.toContain('(slot:');
    expect(text).toContain('accounts');
  });
});

describe('the slot parameter of data_create_dataset and data_create_accounts', () => {
  const dataset = z.toJSONSchema(dataCreateDataset.input) as {
    properties: Record<string, { description?: string }>;
  };
  const accounts = z.toJSONSchema(dataCreateAccounts.input) as {
    properties: Record<string, { description?: string }>;
  };

  it('data_create_dataset says where the key comes from', () => {
    expect(dataset.properties['slot']?.description ?? '').toMatch(/as the data plan shows it/u);
  });

  it('data_create_accounts says where the key comes from', () => {
    expect(accounts.properties['slot']?.description ?? '').toMatch(
      /slot key shown in the data plan \(data_check_readiness\)/u,
    );
  });
});
