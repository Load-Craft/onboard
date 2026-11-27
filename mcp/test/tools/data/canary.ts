// Sentinel cases of the tools of module data (test/security/canaryCases.ts finds them here): a
// secret in an answer of the backend never reaches the model, the log or the state file.

import { SKLEP_IDS } from '../../golden/index.js';
import type { Case } from '../../security/canaryCases.js';
import {
  seedDataHubAnswer,
  seedPreviousContent,
  seedSlotLabels,
} from '../../fake-backend/routes/dataWrites.js';
import {
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepFeeder,
} from '../../fake-backend/worlds/sklep.js';
import {
  seedGenerators,
  seedGuessRefusal,
  seedHubHistory,
  seedSlotOptions,
} from '../../fake-backend/routes/data.js';
import { scriptFeederGeneration } from '../../fake-backend/routes/dataGenerate.js';
import type { Fake } from '../../fake-backend/server.js';
import { BACKEND_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';

/** Datasets whose name, file name and columns carry credentials only the mask finds. */
function datasetSecrets(fake: Fake): void {
  const collection = fake.store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
  const [first] = collection.list();
  if (first === undefined) return;
  collection.update(first.id, {
    name: `accounts password: ${BACKEND_CANARY}`,
    file_name: `Authorization: Bearer ${SHAPE_CANARY}.csv`,
    columns: [`token ${BACKEND_CANARY}`, 'password'],
    column_semantics: { password: 'credential' },
  });
}

const GENERATE_SLOT = {
  scenario_id: SKLEP_WORLD_IDS.scenarios.zakupy,
  slot: 'search_phrases',
  rows: 10,
} as const;
const GENERATE_FLOW = { flow_id: SKLEP_IDS.flowZakupy, rows: 10, name: 'Canary data' } as const;

/** A scenario whose name carries credentials only the mask finds. */
function generationSecrets(fake: Fake): void {
  fake.store
    .collection<{ id: string; name: string }>(SKLEP_COLLECTIONS.scenarios)
    .update(SKLEP_WORLD_IDS.scenarios.zakupy, { name: `shop password: ${BACKEND_CANARY}` });
}

/** A conversation whose messages carry credentials only the mask finds. */
function conversationSecrets(fake: Fake): void {
  seedHubHistory(fake.store, [
    { role: 'user', content: `my password: ${BACKEND_CANARY}` },
    { role: 'assistant', content: `Authorization: Bearer ${SHAPE_CANARY}` },
  ]);
}

/** Generators whose label and hint carry credentials only the mask finds. */
function generatorSecrets(fake: Fake): void {
  seedGenerators(fake.store, [
    {
      label: `Mail password: ${BACKEND_CANARY}`,
      hint: `Authorization: Bearer ${SHAPE_CANARY}`,
      params: 'none',
    },
  ]);
}

/** The reply, the issues and the chips of the copilot carry credentials only the mask finds. */
function hubSecrets(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  seedDataHubAnswer(fake.store, SKLEP_IDS.project, {
    reply: `Use password: ${BACKEND_CANARY} and Authorization: Bearer ${SHAPE_CANARY}`,
    actions: [{ kind: 'resize', dataset_id: SKLEP_WORLD_IDS.feeders.frazy, rows: 5 }],
    issues: [`token=${SHAPE_CANARY}`],
    chips: [`Ask about password=${BACKEND_CANARY}`],
  });
}

/** A dataset with a password column and a plain column that carries a credential only the mask finds. */
function cellSecrets(fake: Fake): void {
  const rows = [
    `a@example.test,Pw-${BACKEND_CANARY},Authorization: Bearer ${SHAPE_CANARY}`,
    `b@example.test,Pw-${BACKEND_CANARY}-2,fine`,
  ];
  fake.store
    .collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders)
    .update(SKLEP_WORLD_IDS.feeders.konta, {
      content: ['email,password,notes', ...rows].join('\n'),
      columns: ['email', 'password', 'notes'],
      column_semantics: { email: 'identity', password: 'credential', notes: 'synthetic' },
      record_count: 2,
    });
}

/** A refusal of the guess that quotes credentials only the mask finds. */
function refusalSecrets(fake: Fake): void {
  seedGuessRefusal(
    fake.store,
    `Never: password: ${BACKEND_CANARY} Authorization: Bearer ${SHAPE_CANARY}`,
  );
}

/** Slots whose label, column and dataset name carry credentials only the mask finds. */
function slotSecrets(fake: Fake): void {
  const slots = [
    {
      slot: 'accounts',
      label: `Login password: ${BACKEND_CANARY}`,
      role: 'data' as const,
      columns: [`token ${SHAPE_CANARY}`, 'email'],
      column_specs: [],
      bind_withheld_columns: [],
      never_fabricated_columns: ['email'],
      generated: null,
      generated_rows: null,
      identity_kind: null,
      options: [
        {
          id: SKLEP_WORLD_IDS.feeders.konta,
          name: `Authorization: Bearer ${SHAPE_CANARY}`,
          rows: 3,
          columns_ok: true as const,
        },
      ],
    },
  ];
  seedSlotOptions(fake.store, SKLEP_WORLD_IDS.scenarios.przegladanie, slots);
  seedSlotOptions(fake.store, SKLEP_WORLD_IDS.composition, slots);
}

export const CANARY_CASES: readonly Case[] = [
  {
    tool: 'data_list_datasets',
    label: 'list of the datasets',
    stage: 'data',
    args: () => ({}),
    setup: datasetSecrets,
  },
  {
    tool: 'data_list_datasets',
    label: 'format data, names tainted',
    stage: 'data',
    names: true,
    args: () => ({ format: 'data' }),
    setup: datasetSecrets,
  },
  {
    tool: 'data_set_slot_label',
    label: 'a slot relabelled over a label that holds credentials',
    stage: 'data',
    args: () => ({
      scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie,
      slot: 'search_phrases',
      label: 'Clean label',
    }),
    setup: (fake) => {
      seedSlotLabels(fake.store, SKLEP_WORLD_IDS.scenarios.przegladanie, {
        search_phrases: `Authorization: Bearer ${SHAPE_CANARY}`,
      });
    },
  },
  {
    tool: 'data_restore_dataset',
    label: 'a dataset restored over cells that hold credentials',
    stage: 'data',
    args: () => ({ dataset_id: SKLEP_WORLD_IDS.feeders.frazy }),
    setup: (fake) => {
      datasetSecrets(fake);
      seedPreviousContent(fake.store, SKLEP_WORLD_IDS.feeders.frazy, {
        content: `email,password\na@example.test,${BACKEND_CANARY}\n`,
        record_count: 1,
        content_hash: 'previous-hash',
      });
    },
  },
  {
    tool: 'data_get_copilot_history',
    label: 'the data hub conversation',
    stage: 'data',
    args: () => ({}),
    setup: conversationSecrets,
  },
  {
    tool: 'data_get_copilot_history',
    label: 'the same, names tainted, format data',
    stage: 'data',
    names: true,
    args: () => ({ format: 'data' }),
    setup: conversationSecrets,
  },
  {
    tool: 'data_get_generators',
    label: 'the list of generators',
    stage: 'data',
    args: () => ({}),
    setup: generatorSecrets,
  },
  {
    tool: 'data_get_generators',
    label: 'a guess for columns, names tainted, format data',
    stage: 'data',
    names: true,
    args: () => ({ columns: 'email,password,age', format: 'data' }),
    setup: generatorSecrets,
  },
  {
    tool: 'data_update_dataset',
    label: 'the card of a rename over a dataset whose texts hold credentials',
    stage: 'data',
    personSaysYes: true,
    args: () => ({ dataset_id: SKLEP_WORLD_IDS.feeders.frazy, name: 'Clean name' }),
    setup: datasetSecrets,
  },
  {
    tool: 'data_update_dataset',
    label: 'rows from a file with secret cells, after the yes of the person',
    stage: 'data',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('data_update_dataset', {
        dataset_id: SKLEP_WORLD_IDS.feeders.frazy,
        file: 'data/konta.csv',
      });
      return {};
    },
    args: () => ({ dataset_id: SKLEP_WORLD_IDS.feeders.frazy, file: 'data/konta.csv' }),
    setup: datasetSecrets,
  },
  {
    tool: 'data_regenerate_dataset',
    label: 'the card of an expansion over a dataset whose texts hold credentials',
    stage: 'data',
    personSaysYes: true,
    args: () => ({ dataset_id: SKLEP_WORLD_IDS.feeders.frazy, mode: 'expand', rows: 900 }),
    setup: datasetSecrets,
  },
  {
    tool: 'data_regenerate_dataset',
    label: 'a reroll after the yes of the person',
    stage: 'data',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('data_regenerate_dataset', {
        dataset_id: SKLEP_WORLD_IDS.feeders.frazy,
        mode: 'reroll',
      });
      return {};
    },
    args: () => ({ dataset_id: SKLEP_WORLD_IDS.feeders.frazy, mode: 'reroll' }),
    setup: datasetSecrets,
  },
  {
    tool: 'data_delete',
    label: 'the card of a deletion over a dataset whose texts hold credentials',
    stage: 'data',
    personSaysYes: true,
    args: () => ({ dataset_id: SKLEP_WORLD_IDS.feeders.frazy }),
    setup: datasetSecrets,
  },
  {
    tool: 'data_delete',
    label: 'the deletion after the yes of the person',
    stage: 'data',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('data_delete', { dataset_id: SKLEP_WORLD_IDS.feeders.frazy });
      return {};
    },
    args: () => ({ dataset_id: SKLEP_WORLD_IDS.feeders.frazy }),
    setup: datasetSecrets,
  },
  {
    tool: 'data_ask_copilot',
    label: 'the card of a question carrying a credential',
    stage: 'data',
    personSaysYes: true,
    args: () => ({
      message: `why? password=${BACKEND_CANARY}`,
      scenario_id: SKLEP_WORLD_IDS.scenarios.zakupy,
    }),
    setup: hubSecrets,
  },
  {
    tool: 'data_ask_copilot',
    label: 'the proposal after the yes of the person',
    stage: 'data',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('data_ask_copilot', {
        message: 'plan',
        scenario_id: SKLEP_WORLD_IDS.scenarios.zakupy,
      });
      return {};
    },
    args: () => ({ message: 'plan', scenario_id: SKLEP_WORLD_IDS.scenarios.zakupy }),
    setup: hubSecrets,
  },
  {
    tool: 'data_get_dataset',
    label: 'a dataset with password cells, every part asked for',
    stage: 'data',
    args: () => ({
      dataset_id: SKLEP_WORLD_IDS.feeders.konta,
      include: ['rows', 'consumers', 'history', 'snippet', 'redis'],
    }),
    setup: cellSecrets,
  },
  {
    tool: 'data_get_dataset',
    label: 'the same, names tainted, format data',
    stage: 'data',
    names: true,
    args: () => ({
      dataset_id: SKLEP_WORLD_IDS.feeders.konta,
      include: ['rows', 'history'],
      format: 'data',
    }),
    setup: cellSecrets,
  },
  {
    tool: 'data_get_generators',
    label: 'a guess whose refusals quote credentials',
    stage: 'data',
    args: () => ({ columns: 'email,password,age' }),
    setup: refusalSecrets,
  },
  {
    tool: 'data_generate_dataset',
    label: 'the card of a generation for a scenario whose name carries credentials',
    stage: 'data',
    personSaysYes: true,
    args: () => ({ scenario_id: SKLEP_WORLD_IDS.scenarios.zakupy, rows: 10 }),
    setup: generationSecrets,
  },
  {
    tool: 'data_generate_dataset',
    label:
      'a slot generation after the yes of the person, the dataset whose columns carry credentials',
    stage: 'data',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('data_generate_dataset', GENERATE_SLOT);
      return {};
    },
    args: () => GENERATE_SLOT,
    setup: generationSecrets,
  },
  {
    tool: 'data_generate_dataset',
    label:
      'a run for a flow after the yes of the person, a failure whose cause carries credentials',
    stage: 'data',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('data_generate_dataset', GENERATE_FLOW);
      return {};
    },
    args: () => GENERATE_FLOW,
    setup: (fake) => {
      generationSecrets(fake);
      scriptFeederGeneration(fake, { endMs: 1000, columns: [`token ${BACKEND_CANARY}`, 'email'] });
    },
  },
  {
    tool: 'data_get_slots',
    label: 'the slots of a scenario',
    stage: 'data',
    args: () => ({ scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie }),
    setup: slotSecrets,
  },
  {
    tool: 'data_get_slots',
    label: 'the slots of a composition, names tainted, format data',
    stage: 'data',
    names: true,
    args: () => ({ composition_id: SKLEP_WORLD_IDS.composition, format: 'data' }),
    setup: slotSecrets,
  },
];
