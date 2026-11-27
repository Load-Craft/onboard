// The coverage of module functional: the operations of the backend the tests of its tools call on the
// fake backend equal the operations of the module's written tools. Every view of every tool is called
// once here with a minimal world; the requests the fake saw are turned into the catalog's operations.

import { describe, it } from 'vitest';

import { MODULE_INDEX } from '../../../src/tools/_generated/modules.js';
import {
  seedAnalytics,
  seedApiLogs,
  seedApplicable,
  seedCatalog,
  seedEnforcement,
  seedFlowResults,
  seedFlows,
  seedFlowVersions,
  seedFunctionalCompare,
  seedFunctionalRuns,
  seedOutcomeCandidates,
  seedTemplates,
  type RunDetailBody,
} from '../../fake-backend/routes/functional.js';
import { SKLEP_COLLECTIONS } from '../../fake-backend/worlds/sklep.js';
import {
  expectModuleCoverage,
  operationOf,
  type UnusedOperations,
} from '../../helpers/moduleClosure.js';
import type { ToolRig } from '../../helpers/rig.js';
import { FUNCTIONAL_DEBTS } from './debts.js';
import { settleClock } from '../../helpers/clock.js';
import { answering, person } from '../../helpers/consentPerson.js';
import { scriptPayloads, scriptTestTypes } from '../../fake-backend/routes/functionalProcess.js';
import { functionalRig, PROJECT } from './rig.js';

/** The operations of written tools that no test calls, with why. */
const UNUSED: UnusedOperations = {
  list_ai_validators_api_v1_base_validators_ai_get:
    'functional_get_catalog is written in a reduced scope: no view of the AI validators',
  list_test_type_categories_api_v1_base_test_types_categories_get:
    'functional_get_catalog is written in a reduced scope: the categories come with the list',
  list_validator_categories_api_v1_base_validators_categories_get:
    'functional_get_catalog is written in a reduced scope: the categories come with the list',
  get_seed_status_api_v1_admin_seed_status_get:
    'functional_get_catalog is written in a reduced scope: no seed status',
};

const RUN = '6e2a4f51-0001-4f00-8000-000000000001';
const OTHER = '6e2a4f51-0002-4f00-8000-000000000002';
const FLOW = '4c0e2d3f-0001-4d00-8000-000000000001';
const TEMPLATE = '5d1f3e40-0001-4e00-8000-000000000001';
const RESULT = '7f3b5a62-0001-4a00-8000-000000000001';
const BASE_TYPE = '1a2b3c4d-0001-4a00-8000-000000000001';
const BASE_VALIDATOR = '2b3c4d5e-0001-4b00-8000-000000000001';
const ASSERTION = '3c4d5e6f-0001-4c00-8000-000000000001';
const DOCS = '3b9d1c2e-0001-4c00-8000-000000000001';
const stamp = { created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z' };

const run = (id: string): RunDetailBody => ({
  id,
  project_id: PROJECT,
  status: 'completed',
  execution_type: 'template',
  template_id: TEMPLATE,
  template_name: 'Smoke',
  environment_id: null,
  environment_name: null,
  triggered_by: null,
  created_at: '2026-11-22T10:00:00Z',
  started_at: null,
  completed_at: null,
  duration_ms: 1,
  total_flows: 1,
  passed_flows: 1,
  failed_flows: 0,
  completed_flows: 1,
  total_validations: 1,
  passed_validations: 1,
  failed_validations: 0,
  error_message: null,
  langgraph_thread_id: null,
  flow_versions: {},
  runtime_params: {},
  config_snapshot: {},
});

function seed(r: ToolRig): void {
  const { store } = r.fake;
  seedOutcomeCandidates(store, { status_field: 'status', candidates: [] });
  seedApplicable(store, { total: 0, applicable_total: 0, groups: {} });
  seedEnforcement(store, { default_level: 'warn', levels: {} });
  seedFlows(store, [
    {
      id: FLOW,
      name: 'Checkout',
      description: null,
      openapi_spec_id: '3b9d1c2e-0001-4c00-8000-000000000001',
      version: '2.16.0',
      blocks_count: 0,
      blocks: [],
      edges: [],
      variables: {},
      is_active: true,
      tags: [],
      timeout_ms: 1000,
      retry_count: 0,
      retry_delay_ms: 0,
      ...stamp,
    },
  ]);
  seedFlowVersions(store, FLOW, [
    { id: 'v1', flow_id: FLOW, version: '2.15.0', created_at: '2026-11-20T10:00:00Z' },
  ]);
  seedTemplates(store, [
    {
      id: TEMPLATE,
      name: 'Smoke',
      description: null,
      openapi_spec_id: null,
      tags: [],
      is_active: true,
      assertions_count: 0,
      flow_definition: {},
      ...stamp,
    },
  ]);
  seedFunctionalRuns(store, [run(RUN), run(OTHER)]);
  seedFlowResults(store, RUN, [
    {
      id: RESULT,
      execution_id: RUN,
      flow_id: FLOW,
      flow_version: 1,
      test_type_id: 't',
      test_type_name: 'invalid_input',
      status: 'passed',
      started_at: null,
      completed_at: null,
      duration_ms: 1,
      error_message: null,
      total_validations: 0,
      passed_validations: 0,
      failed_validations: 0,
      final_response: null,
      final_variables: {},
      generated_input: {},
      block_results: [],
      validation_results: [],
    },
  ]);
  seedApiLogs(store, RUN, [
    { id: 'l1', sequence_number: 1, timestamp: '2026-11-22T10:00:00Z', log_type: 'request' },
  ]);
  seedFunctionalCompare(store, {
    execution_a_id: RUN,
    execution_b_id: OTHER,
    same_flow_versions: true,
    blocks: [],
  });
  seedCatalog.testTypes(store, [
    {
      id: BASE_TYPE,
      name: 'negative_testing',
      display_name: 'Negative',
      category: 'negative',
      description: null,
      is_active: true,
      is_builtin: true,
      expected_outcome: null,
      input_generation_prompt: '',
      input_schema: {},
      example_inputs: [],
      ...stamp,
    },
  ]);
  seedCatalog.validators(store, [
    {
      id: BASE_VALIDATOR,
      name: 'status_code',
      display_name: 'Status code',
      category: 'http',
      description: null,
      validator_type: 'assertion',
      is_active: true,
      is_builtin: true,
      activation: 'auto',
      group: 'http',
      scope: 'step',
      requires_profile_flags: [],
      ai_prompt_template: null,
      parameters: [],
      ...stamp,
    },
  ]);
  seedCatalog.assertionTypes(store, [
    {
      id: ASSERTION,
      name: 'equals',
      display_name: 'Equals',
      category: 'comparison',
      description: null,
      is_active: true,
      is_builtin: true,
      ...stamp,
    },
  ]);
  const [validator] = store.collection<{ id: string }>(SKLEP_COLLECTIONS.validators).list();
  const id = validator?.id ?? '';
  seedAnalytics.dashboard(store, {
    period_days: 30,
    generated_at: '2026-11-27T12:00:00Z',
    summary: {
      total_validators: 1,
      total_executions: 1,
      overall_pass_rate: 1,
      flaky_validators_count: 0,
      ai_validators_count: 0,
    },
  });
  seedAnalytics.flaky(store, []);
  seedAnalytics.patterns(store, []);
  seedAnalytics.accuracy(store, id, {
    validator_id: id,
    validator_name: 'v',
    validator_type: 'assertion',
    total_executions: 1,
    pass_count: 1,
    fail_count: 0,
    pass_rate: 1,
    retry_rate: 0,
  });
  seedAnalytics.trend(store, id, {
    validator_id: id,
    validator_name: 'v',
    period_days: 30,
    trend_direction: 'stable',
  });
  seedAnalytics.threshold(store, id, {
    validator_id: id,
    suggested_threshold: 0.5,
    rationale: 'r',
  });
}

/** A tool on a consent card is called twice with the same arguments: the card, then the yes. */
function twice(tool: string, args: Record<string, unknown>): [string, Record<string, unknown>][] {
  return [
    [tool, args],
    [tool, args],
  ];
}

function consentCalls(testType: string, validator: string): [string, Record<string, unknown>][] {
  const catalogFields = { category: 'http', display_name: 'Body size' };
  return [
    ...twice('functional_save_catalog', {
      kind: 'catalog_test_type',
      name: 'rate_limits',
      fields: { category: 'load', display_name: 'Rate', input_generation_prompt: 'Burst' },
    }),
    ...twice('functional_save_catalog', {
      kind: 'catalog_test_type',
      entry_id: BASE_TYPE,
      fields: { description: 'Changed' },
    }),
    ...twice('functional_save_catalog', {
      kind: 'catalog_validator',
      name: 'body_size',
      fields: {
        ...catalogFields,
        activation: 'auto',
        group: 'http',
        scope: 'step',
        validator_type: 'assertion',
      },
    }),
    ...twice('functional_save_catalog', {
      kind: 'catalog_validator',
      entry_id: BASE_VALIDATOR,
      fields: { description: 'Changed' },
    }),
    ...twice('functional_save_catalog', {
      kind: 'catalog_assertion_type',
      name: 'matches',
      fields: catalogFields,
    }),
    ...twice('functional_save_catalog', {
      kind: 'catalog_assertion_type',
      entry_id: ASSERTION,
      fields: { description: 'Changed' },
    }),
    ...twice('functional_save_test_types', { test_type_id: testType, fields: { priority: 42 } }),
    ...twice('functional_save_test_types', {
      source: 'custom',
      items: { rate_burst: { category: 'load' } },
    }),
    ...twice('functional_save_test_types', { source: 'catalog', items: { [BASE_TYPE]: {} } }),
    ...twice('functional_save_test_types', {
      source: 'suggestions',
      items: {
        slow_login: {
          category: 'load',
          display_name: 'Slow login',
          description: 'Login under load',
          input_prompt: 'Make slow logins',
        },
      },
    }),
    ...twice('functional_save_validators', { validator_id: validator, fields: { priority: 42 } }),
    ...twice('functional_save_validators', {
      source: 'custom',
      items: { body_has_id: { scope: 'step' } },
    }),
    ...twice('functional_save_validators', { source: 'catalog', items: { [BASE_VALIDATOR]: {} } }),
    ...twice('functional_suggest_validators', { docs_id: '3b9d1c2e-0001-4c00-8000-000000000001' }),
    ...deleteCalls(testType, validator),
  ];
}

/** One deletion of each kind: the card, then the yes; the items are those the seed made. */
function deleteCalls(testType: string, validator: string): [string, Record<string, unknown>][] {
  const items: [string, string][] = [
    ['flow', FLOW],
    ['template', TEMPLATE],
    ['test_type', testType],
    ['validator', validator],
    ['run', OTHER],
    ['catalog_test_type', BASE_TYPE],
    ['catalog_validator', BASE_VALIDATOR],
    ['catalog_assertion_type', ASSERTION],
  ];
  return items.flatMap(([kind, id]) => twice('functional_delete', { kind, item_id: id }));
}

describe('module functional: the tests call every operation of the written tools', () => {
  it('equals the operations of the catalog, but those named unused; the debts call none', async () => {
    const r = await functionalRig({
      tools: MODULE_INDEX.functional,
      seed: (fake) => void fake,
      elicit: answering(person()),
    });
    seed(r);
    const [firstType] = r.fake.store.collection<{ id: string }>(SKLEP_COLLECTIONS.testTypes).list();
    const [firstValidator] = r.fake.store
      .collection<{ id: string }>(SKLEP_COLLECTIONS.validators)
      .list();
    const validator = firstValidator?.id ?? '';
    const calls: [string, Record<string, unknown>][] = [
      ['functional_get_test_types', {}],
      ['functional_get_test_types', { test_type: firstType?.id }],
      ['functional_get_test_types', { view: 'expected_outcomes' }],
      ['functional_get_validators', {}],
      ['functional_get_validators', { validator }],
      ['functional_get_validators', { view: 'applicable' }],
      ['functional_get_validators', { view: 'gatling_enforcement' }],
      ['functional_get_flows', {}],
      ['functional_get_flows', { flow: FLOW }],
      ['functional_get_flows', { flow: FLOW, view: 'versions' }],
      ['functional_get_templates', {}],
      ['functional_get_templates', { template: TEMPLATE }],
      ['functional_get_runs', {}],
      ['functional_get_runs', { run_id: RUN }],
      ['functional_get_runs', { view: 'by_template', template: TEMPLATE }],
      ['functional_get_results', { run_id: RUN }],
      ['functional_get_results', { run_id: RUN, view: 'flows' }],
      ['functional_get_results', { run_id: RUN, view: 'one', result_id: RESULT }],
      ['functional_get_results', { run_id: RUN, view: 'http_log' }],
      ['functional_compare_runs', { run_id: RUN, other: OTHER }],
      ['functional_get_analytics', {}],
      ['functional_get_analytics', { view: 'flaky' }],
      ['functional_get_analytics', { view: 'failure_patterns' }],
      ['functional_get_analytics', { view: 'accuracy', validator }],
      ['functional_get_analytics', { view: 'trend', validator }],
      ['functional_get_analytics', { view: 'threshold_suggestion', validator }],
      ['functional_get_catalog', { kind: 'test_types' }],
      ['functional_get_catalog', { kind: 'test_types', entry_id: BASE_TYPE }],
      ['functional_get_catalog', { kind: 'validators' }],
      ['functional_get_catalog', { kind: 'validators', entry_id: BASE_VALIDATOR }],
      ['functional_get_catalog', { kind: 'assertion_types' }],
      ['functional_get_catalog', { kind: 'assertion_types', entry_id: ASSERTION }],
      ['functional_get_catalog', { kind: 'assertion_types', entry_id: 'equals' }],
      ['functional_restore_flow', { flow_id: FLOW, version: '2.15.0' }],
      ['functional_save_flow', { flow_id: FLOW, name: 'Checkout renamed' }],
      ['functional_save_flow', { flow_id: FLOW, fields: { blocks: [{ id: 'b1' }] } }],
      ['functional_save_flow', { flow_id: FLOW, version: 'release-1' }],
      [
        'functional_save_flow',
        { name: 'New flow', docs_id: '3b9d1c2e-0001-4c00-8000-000000000001' },
      ],
      ['functional_save_template', { template_id: TEMPLATE, name: 'Smoke renamed' }],
      [
        'functional_save_template',
        {
          name: 'New one',
          fields: { api_description: 'The shop API, described.', flow_definition: {} },
        },
      ],
      ...consentCalls(firstType?.id ?? '', validator),
    ];
    // before the deletions below remove the flow and the test type it uses
    scriptPayloads(r.fake, { endMs: 0 });
    const payloadArgs = { flow_ids: { [FLOW]: {} }, test_types: { [firstType?.id ?? '']: 2 } };
    await r.call('functional_generate_payloads', payloadArgs);
    const payloads = await settleClock(r, r.call('functional_generate_payloads', payloadArgs), {
      limitMs: 200_000,
    });
    if (payloads.isError) throw new Error(`functional_generate_payloads: ${payloads.text}`);
    for (const [tool, args] of calls) {
      const result = await r.call(tool, args);
      if (result.isError) throw new Error(`${tool} ${JSON.stringify(args)}: ${result.text}`);
    }
    // the long operations: the clock moves until each call settles; one run loses its frames, so the REST
    // outcome is read
    for (const script of [{ endMs: 0 }, { outcome: 'silent' as const, endMs: 2000 }]) {
      scriptTestTypes(r.fake, script);
      const args = { docs_id: DOCS, focus_areas: script.endMs === 0 ? 'a' : 'b' };
      await r.call('functional_suggest_test_types', args);
      const done = await settleClock(r, r.call('functional_suggest_test_types', args), {
        limitMs: 200_000,
      });
      if (done.isError) throw new Error(`functional_suggest_test_types: ${done.text}`);
    }
    scriptTestTypes(r.fake, { endMs: 0, created: ['edge_cases'] });
    await r.call('functional_generate_test_types', {});
    const generated = await settleClock(r, r.call('functional_generate_test_types', {}), {
      limitMs: 200_000,
    });
    if (generated.isError) throw new Error(`functional_generate_test_types: ${generated.text}`);
    const called = new Set(
      r.fake.calls
        .map((call) => operationOf('functional', call.method, call.path))
        .filter((id): id is string => id !== undefined),
    );
    expectModuleCoverage('functional', called, FUNCTIONAL_DEBTS, UNUSED);
  });
});
