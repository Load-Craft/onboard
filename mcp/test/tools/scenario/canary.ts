// Sentinel cases of the tools of module scenario (test/security/canaryCases.ts finds them here): a
// secret in an answer of the backend never reaches the model, the log or the state file.

import type { Case } from '../../security/canaryCases.js';
import {
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepComposition,
  type SklepScenario,
} from '../../fake-backend/worlds/sklep.js';
import {
  seedCompositionFiles,
  seedCopilotHistory,
  seedScenarioVersions,
  seedTemplates,
} from '../../fake-backend/routes/scenario.js';
import { scriptHealthCheck } from '../../fake-backend/routes/healthCheck.js';
import type { Fake } from '../../fake-backend/server.js';
import { BACKEND_CANARY, HEADER_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';

/** A scenario whose name and description carry credentials only the mask finds. */
function scenarioSecrets(fake: Fake): void {
  const collection = fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
  const [first] = collection.list();
  if (first === undefined) return;
  collection.update(first.id, {
    name: `login password: ${BACKEND_CANARY}`,
    description: `Authorization: Bearer ${SHAPE_CANARY}`,
    scenario_artifact: {
      ...first.scenario_artifact,
      headers: { 'x-api-key': HEADER_CANARY },
    } as SklepScenario['scenario_artifact'],
  });
}

/** Versions whose reason and stored artifact carry credentials only the mask finds. */
function versionSecrets(fake: Fake): void {
  seedScenarioVersions(fake, SKLEP_WORLD_IDS.scenarios.przegladanie, [
    {
      version: 1,
      change_reason: `password: ${BACKEND_CANARY}`,
      artifact: {
        headers: { 'x-api-key': HEADER_CANARY },
        login: `Authorization: Bearer ${SHAPE_CANARY}`,
      },
    },
  ]);
}

/** A conversation whose messages carry credentials only the mask finds. */
function conversationSecrets(fake: Fake): void {
  seedCopilotHistory(fake, SKLEP_WORLD_IDS.scenarios.przegladanie, [
    { role: 'user', content: `my password: ${BACKEND_CANARY}` },
    { role: 'assistant', content: `Authorization: Bearer ${SHAPE_CANARY}` },
  ]);
}

/** The scenario is at version 2 over a stored version 1; its name carries credentials only the mask finds. */
function restorableScenario(fake: Fake): void {
  const id = SKLEP_WORLD_IDS.scenarios.przegladanie;
  const collection = fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
  const scenario = collection.require(id, 'scenario');
  seedScenarioVersions(fake, id, [
    {
      version: 1,
      change_reason: `password: ${BACKEND_CANARY}`,
      artifact: scenario.scenario_artifact,
    },
    { version: 2, artifact: scenario.scenario_artifact },
  ]);
  collection.update(id, {
    current_version: 2,
    name: `browse Authorization: Bearer ${SHAPE_CANARY} password: ${BACKEND_CANARY}`,
  });
}

/** A composition whose name and members' scenario names carry credentials, two members drifted. */
function driftedComposition(fake: Fake): void {
  const scenarios = fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
  for (const id of Object.values(SKLEP_WORLD_IDS.scenarios))
    scenarios.update(id, { current_version: 3 });
  const compositions = fake.store.collection<SklepComposition>(SKLEP_COLLECTIONS.compositions);
  const composition = compositions.require(SKLEP_WORLD_IDS.composition, 'composition');
  compositions.update(composition.id, {
    name: `mix Authorization: Bearer ${SHAPE_CANARY}`,
    scenarios: composition.scenarios.map((link, index) => ({
      ...link,
      scenario_name: `member password: ${BACKEND_CANARY}`,
      pinned_version: index === 0 ? 3 : 1,
      has_drift: index !== 0,
      drift_fields: index === 0 ? [] : ['scenario_artifact' as const],
    })),
  });
}

/** A composition with a load test, whose name and dataset names carry credentials, and a dataset that is short of rows. */
function typedComposition(fake: Fake): void {
  const compositions = fake.store.collection<SklepComposition>(SKLEP_COLLECTIONS.compositions);
  const composition = compositions.require(SKLEP_WORLD_IDS.composition, 'composition');
  compositions.update(composition.id, {
    name: `mix Authorization: Bearer ${SHAPE_CANARY}`,
    test_type_spec: { type: 'load_test', target_users: 10, duration_seconds: 60 },
    scenarios: composition.scenarios.map((link) => ({
      ...link,
      feeder_bindings: [
        {
          feeder_id: SKLEP_WORLD_IDS.feeders.frazy,
          feeder_name: `products password: ${BACKEND_CANARY}`,
          file_name: 'products.csv',
          required_row_count: 5,
          row_count: 40,
          strategy: 'queue',
        },
      ],
    })),
  });
}

/** The built-in template soak-test, every text of it carries credentials; a second one has a canary id. */
function templateSecrets(fake: Fake): void {
  const secret = `x Authorization: Bearer ${SHAPE_CANARY} password: ${BACKEND_CANARY}`;
  seedTemplates(fake, [
    {
      id: 'soak-test',
      name: secret,
      description: secret,
      category: secret,
      difficulty: secret,
      tags: [secret],
      scenarios: [
        {
          name: secret,
          description: secret,
          stub_scala: secret,
          inputs: [secret],
          outputs: [secret],
        },
      ],
      default_composition: {
        name: secret,
        proportions: { [secret]: 1 },
        injection_profile: { type: secret, total_users: 1, duration_seconds: 1 },
        thresholds: { [secret]: 1 },
      },
      feeder_schemas: [{ name: secret, columns: [secret], sample_rows: [[secret]] }],
    },
    { id: secret, name: 'Second' },
  ]);
}

/** A composition whose name and description carry credentials only the mask finds. */
function compositionSecrets(fake: Fake): void {
  const collection = fake.store.collection<SklepComposition>(SKLEP_COLLECTIONS.compositions);
  const [first] = collection.list();
  if (first === undefined) return;
  collection.update(first.id, {
    name: `mix password: ${BACKEND_CANARY}`,
    description: `Authorization: Bearer ${SHAPE_CANARY}`,
    global_headers: { 'x-api-key': HEADER_CANARY },
  });
}

/** Compositions whose names carry credentials only the mask finds. */
function taintCompositionNames(fake: Fake): void {
  const collection = fake.store.collection<SklepComposition>(SKLEP_COLLECTIONS.compositions);
  for (const composition of collection.list()) {
    collection.update(composition.id, {
      name: `login password: ${BACKEND_CANARY} Authorization: Bearer ${SHAPE_CANARY}`,
    });
  }
}

/** A generated project whose file text and path carry credentials only the mask finds. */
function codeSecrets(fake: Fake): void {
  seedCompositionFiles(fake, SKLEP_WORLD_IDS.composition, {
    'src/Simulation.scala': [
      `val auth = "Authorization: Bearer ${SHAPE_CANARY}"`,
      `val password = "${BACKEND_CANARY}"`,
      `.header("x-api-key", "${HEADER_CANARY}")`,
    ].join('\n'),
    [`src/login password: ${BACKEND_CANARY}`]: 'val a = 1',
  });
}

/** A composition whose stored check is not valid and whose messages carry credentials. */
function checkSecrets(fake: Fake): void {
  const collection = fake.store.collection<SklepComposition>(SKLEP_COLLECTIONS.compositions);
  const composition = collection.require(SKLEP_WORLD_IDS.composition);
  collection.update(composition.id, {
    validation: {
      ...composition.validation,
      is_valid: false,
      issue_details: [
        {
          level: 'error',
          message: `login password: ${BACKEND_CANARY}`,
          scenario_id: null,
          step_index: 1,
          suggestion: `Authorization: Bearer ${SHAPE_CANARY}`,
          variable: `token=${HEADER_CANARY}`,
        },
      ],
    },
  });
}

export const CANARY_CASES: readonly Case[] = [
  {
    tool: 'scenario_set_composition_type',
    label: 'a stress test over a composition whose names carry credentials',
    stage: 'scenario',
    args: () => ({
      composition_id: SKLEP_WORLD_IDS.composition,
      type: 'stress_test',
      spec: { target_users: 1000, duration_seconds: 300 },
    }),
    setup: typedComposition,
  },
  {
    tool: 'scenario_set_composition_type',
    label: 'the same, names tainted, format data',
    stage: 'scenario',
    names: true,
    args: () => ({
      composition_id: SKLEP_WORLD_IDS.composition,
      type: 'stress_test',
      spec: { target_users: 1000, duration_seconds: 300 },
      format: 'data',
    }),
    setup: typedComposition,
  },
  {
    tool: 'scenario_update_pins',
    label: 'drifted members of a composition whose names carry credentials',
    stage: 'scenario',
    args: () => ({ composition_id: SKLEP_WORLD_IDS.composition }),
    setup: driftedComposition,
  },
  {
    tool: 'scenario_update_pins',
    label: 'the same, names tainted, format data',
    stage: 'scenario',
    names: true,
    args: () => ({ composition_id: SKLEP_WORLD_IDS.composition, format: 'data' }),
    setup: driftedComposition,
  },
  {
    tool: 'scenario_restore_version',
    label: 'an older version of a scenario whose name carries credentials',
    stage: 'scenario',
    args: () => ({ scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie, version: 1 }),
    setup: restorableScenario,
  },
  {
    tool: 'scenario_restore_version',
    label: 'the same, names tainted, format data',
    stage: 'scenario',
    names: true,
    args: () => ({
      scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie,
      version: 1,
      format: 'data',
    }),
    setup: restorableScenario,
  },
  {
    tool: 'scenario_list',
    label: 'list of the scenarios',
    stage: 'scenario',
    args: () => ({}),
    setup: scenarioSecrets,
  },
  {
    tool: 'scenario_list',
    label: 'format data, names tainted',
    stage: 'scenario',
    names: true,
    args: () => ({ format: 'data' }),
    setup: scenarioSecrets,
  },
  {
    tool: 'scenario_get',
    label: 'the scenario with the contract, drift and artifact',
    stage: 'scenario',
    args: () => ({
      scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie,
      include: ['contract', 'drift', 'artifact'],
    }),
    setup: scenarioSecrets,
  },
  {
    tool: 'scenario_get',
    label: 'format data, names tainted',
    stage: 'scenario',
    names: true,
    args: () => ({
      scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie,
      include: ['artifact'],
      format: 'data',
    }),
    setup: scenarioSecrets,
  },
  {
    tool: 'scenario_get_versions',
    label: 'the list of versions',
    stage: 'scenario',
    args: () => ({ scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie }),
    setup: versionSecrets,
  },
  {
    tool: 'scenario_get_versions',
    label: 'one version with its artifact, names tainted, format data',
    stage: 'scenario',
    names: true,
    args: () => ({
      scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie,
      version: 1,
      format: 'data',
    }),
    setup: versionSecrets,
  },
  {
    tool: 'scenario_get_copilot_history',
    label: "a scenario's conversation",
    stage: 'scenario',
    args: () => ({ scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie }),
    setup: conversationSecrets,
  },
  {
    tool: 'scenario_get_copilot_history',
    label: 'the same, names tainted, format data',
    stage: 'scenario',
    names: true,
    args: () => ({ scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie, format: 'data' }),
    setup: conversationSecrets,
  },
  {
    tool: 'scenario_export',
    label: 'the exported ZIP is saved; its answer is a file',
    stage: 'scenario',
    fileAnswer: true,
    args: () => ({ scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie }),
  },
  {
    tool: 'scenario_get_templates',
    label: 'the list of the templates whose texts carry credentials',
    stage: 'project',
    args: () => ({}),
    setup: templateSecrets,
  },
  {
    tool: 'scenario_get_templates',
    label: 'the same, format data',
    stage: 'project',
    args: () => ({ format: 'data' }),
    setup: templateSecrets,
  },
  {
    tool: 'scenario_get_templates',
    label: 'one template whose texts carry credentials',
    stage: 'project',
    args: () => ({ template: 'soak-test' }),
    setup: templateSecrets,
  },
  {
    tool: 'scenario_get_templates',
    label: 'one template with its draft composition, texts carry credentials',
    stage: 'project',
    args: () => ({ template: 'soak-test', include: ['draft'] }),
    setup: templateSecrets,
  },
  {
    tool: 'scenario_list_compositions',
    label: 'list of the compositions',
    stage: 'scenario',
    args: () => ({}),
    setup: compositionSecrets,
  },
  {
    tool: 'scenario_list_compositions',
    label: 'format data, names tainted',
    stage: 'scenario',
    names: true,
    args: () => ({ format: 'data' }),
    setup: compositionSecrets,
  },
  {
    tool: 'scenario_get_composition',
    label: 'the composition with secret headers and tainted texts',
    stage: 'scenario',
    args: () => ({ composition_id: SKLEP_WORLD_IDS.composition }),
    setup: compositionSecrets,
  },
  {
    tool: 'scenario_get_composition',
    label: 'format data, names tainted',
    stage: 'scenario',
    names: true,
    args: () => ({ composition_id: SKLEP_WORLD_IDS.composition, format: 'data' }),
    setup: compositionSecrets,
  },
  {
    tool: 'scenario_save',
    label: 'a scenario whose name and tags carry credentials, changed',
    stage: 'scenario',
    names: true,
    args: () => ({
      scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie,
      name: 'Renamed',
      tags: 'one, two',
    }),
  },
  {
    tool: 'scenario_save',
    label: 'a new scenario, format data',
    stage: 'scenario',
    args: () => ({ name: 'A new one', format: 'data' }),
  },
  {
    tool: 'scenario_delete',
    label: 'the card of a scenario whose names, and those of its compositions, carry credentials',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    args: () => ({ scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie }),
    setup: (fake) => {
      scenarioSecrets(fake);
      taintCompositionNames(fake);
    },
  },
  {
    tool: 'scenario_delete',
    label: 'a composition deleted after the yes of the person, its name tainted',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    before: async (drive) => {
      await drive.once('scenario_delete', { composition_id: SKLEP_WORLD_IDS.composition });
      return {};
    },
    args: () => ({ composition_id: SKLEP_WORLD_IDS.composition }),
    setup: taintCompositionNames,
  },
  {
    tool: 'scenario_get_composition_code',
    label: 'the tree with credentials in a path',
    stage: 'scenario',
    names: true,
    args: () => ({ composition_id: SKLEP_WORLD_IDS.composition }),
    setup: codeSecrets,
  },
  {
    tool: 'scenario_get_composition_code',
    label: 'one file with credentials in its text, format data',
    stage: 'scenario',
    names: true,
    args: () => ({
      composition_id: SKLEP_WORLD_IDS.composition,
      path: 'src/Simulation.scala',
      format: 'data',
    }),
    setup: codeSecrets,
  },
  {
    tool: 'scenario_check_composition',
    label: 'a composition whose check messages carry credentials',
    stage: 'scenario',
    args: () => ({ composition_id: SKLEP_WORLD_IDS.composition }),
    setup: checkSecrets,
  },
  {
    tool: 'scenario_check_composition',
    label: 'format data, names tainted',
    stage: 'scenario',
    names: true,
    args: () => ({ composition_id: SKLEP_WORLD_IDS.composition, format: 'data' }),
    setup: checkSecrets,
  },
  {
    tool: 'scenario_save_composition',
    label: 'the card of a reshare over a composition whose texts hold credentials',
    stage: 'scenario',
    personSaysYes: true,
    args: () => ({
      composition_id: SKLEP_WORLD_IDS.composition,
      members: { przeglądanie: 60, zakupy: 40 },
    }),
    setup: compositionSecrets,
  },
  {
    tool: 'scenario_save_composition',
    label: 'a reshare after the yes of the person, the names tainted',
    stage: 'scenario',
    personSaysYes: true,
    names: true,
    before: async (drive) => {
      await drive.once('scenario_save_composition', {
        composition_id: SKLEP_WORLD_IDS.composition,
        members: {
          [SKLEP_WORLD_IDS.scenarios.przegladanie]: 60,
          [SKLEP_WORLD_IDS.scenarios.zakupy]: 40,
        },
      });
      return {};
    },
    args: () => ({
      composition_id: SKLEP_WORLD_IDS.composition,
      members: {
        [SKLEP_WORLD_IDS.scenarios.przegladanie]: 60,
        [SKLEP_WORLD_IDS.scenarios.zakupy]: 40,
      },
    }),
    setup: compositionSecrets,
  },
  {
    tool: 'scenario_compile_composition',
    label: 'the card of a build over a composition whose texts hold credentials',
    stage: 'scenario',
    personSaysYes: true,
    args: () => ({ composition_id: SKLEP_WORLD_IDS.composition }),
    setup: compositionSecrets,
  },
  {
    tool: 'scenario_compile_composition',
    label: 'a build after the yes of the person, the names tainted',
    stage: 'scenario',
    personSaysYes: true,
    names: true,
    before: async (drive) => {
      await drive.once('scenario_compile_composition', {
        composition_id: SKLEP_WORLD_IDS.composition,
      });
      return {};
    },
    args: () => ({ composition_id: SKLEP_WORLD_IDS.composition }),
    setup: compositionSecrets,
  },
  {
    tool: 'scenario_ask_copilot',
    label: 'the card of a question to the copilot of a scenario whose name carries credentials',
    stage: 'scenario',
    personSaysYes: true,
    args: () => ({
      scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie,
      message: 'What should be fixed?',
      profile: { type: 'ramp', vusers: 10 },
    }),
    setup: restorableScenario,
  },
  {
    tool: 'scenario_ask_copilot',
    label: 'a review after the yes of the person, the names tainted',
    stage: 'scenario',
    personSaysYes: true,
    names: true,
    before: async (drive) => {
      await drive.once('scenario_ask_copilot', {
        scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie,
        review: true,
      });
      return {};
    },
    args: () => ({ scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie, review: true }),
    setup: restorableScenario,
  },
  {
    tool: 'scenario_check_drift',
    label: 'the card of a check over a scenario whose name carries credentials',
    stage: 'scenario',
    personSaysYes: true,
    args: () => ({
      scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie,
      reference_source: 'openapi',
      reference_id: 'spec-0001',
    }),
    setup: scenarioSecrets,
  },
  {
    tool: 'scenario_check_drift',
    label: 'the check after the yes of the person, a report whose texts carry credentials',
    stage: 'scenario',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('scenario_check_drift', {
        scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie,
        reference_source: 'openapi',
        reference_id: 'spec-0001',
      });
      return {};
    },
    args: () => ({
      scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie,
      reference_source: 'openapi',
      reference_id: 'spec-0001',
    }),
    setup: (fake) => {
      scenarioSecrets(fake);
      scriptHealthCheck(fake, {
        endMs: 0,
        result: {
          recommendations: [
            `use password: ${BACKEND_CANARY} and Authorization: Bearer ${SHAPE_CANARY}`,
          ],
          uncovered_endpoints: [`GET /pay?token=${BACKEND_CANARY}`],
        },
      });
    },
  },
];
