// Sentinel cases of the tools of module functional (test/security/canaryCases.ts finds them here): a
// secret in an answer of the backend never reaches the model, the log or the state file.

import type { Case } from '../../security/canaryCases.js';
import {
  seedCatalog,
  seedAnalytics,
  seedFunctionalCompare,
  seedApiLogs,
  seedFlowResults,
  seedFunctionalRuns,
  seedTemplates,
  seedFlows,
  seedFlowVersions,
  seedApplicable,
  seedEnforcement,
  seedOutcomeCandidates,
} from '../../fake-backend/routes/functional.js';
import { seedDiscovery } from '../../fake-backend/routes/functionalConsentWrites.js';
import { scriptTestTypes } from '../../fake-backend/routes/functionalProcess.js';
import { SKLEP_COLLECTIONS } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';

const FLOW_ID = '4c0e2d3f-0001-4d00-8000-000000000001';
const FLOW = {
  id: FLOW_ID,
  name: `Checkout password: ${BACKEND_CANARY}`,
  description: `Authorization: Bearer ${SHAPE_CANARY}`,
  openapi_spec_id: '3b9d1c2e-0001-4c00-8000-000000000001',
  version: '2.16.0',
  blocks_count: 1,
  blocks: [{ id: 'b1', type: 'request', name: `Authorization: Bearer ${SHAPE_CANARY}` }],
  edges: [],
  entry_block_id: 'b1',
  variables: { [`token password: ${BACKEND_CANARY}`]: 'x' },
  is_active: true,
  tags: [`Authorization: Bearer ${SHAPE_CANARY}`],
  timeout_ms: 1000,
  retry_count: 0,
  retry_delay_ms: 0,
  created_at: '2026-11-20T10:00:00Z',
  updated_at: '2026-11-20T10:00:00Z',
};

const TEMPLATE_ID = '5d1f3e40-0001-4e00-8000-000000000001';
const TEMPLATE = {
  id: TEMPLATE_ID,
  name: `Smoke password: ${BACKEND_CANARY}`,
  description: `Authorization: Bearer ${SHAPE_CANARY}`,
  openapi_spec_id: null,
  api_description: `password=${BACKEND_CANARY}`,
  tags: [`Authorization: Bearer ${SHAPE_CANARY}`],
  is_active: true,
  assertions_count: 1,
  endpoint_ids: [],
  flow_definition: {},
  assertions: [
    {
      type_id: 't1',
      type_name: `body password: ${BACKEND_CANARY}`,
      enabled: true,
      parameters: { text: `Authorization: Bearer ${SHAPE_CANARY}` },
    },
  ],
  runtime_parameters: [
    {
      name: `token password: ${BACKEND_CANARY}`,
      type: 'string',
      assertion_index: 0,
      assertion_type: 'x',
      default: `Authorization: Bearer ${SHAPE_CANARY}`,
      description: `password=${BACKEND_CANARY}`,
    },
  ],
  created_at: '2026-11-20T10:00:00Z',
  updated_at: '2026-11-20T10:00:00Z',
};

const RUN_ID = '6e2a4f51-0001-4f00-8000-000000000001';
const RUN = {
  id: RUN_ID,
  project_id: SKLEP_IDS.project,
  status: 'failed' as const,
  execution_type: 'template' as const,
  template_id: null,
  template_name: `Smoke password: ${BACKEND_CANARY}`,
  environment_id: null,
  environment_name: `Authorization: Bearer ${SHAPE_CANARY}`,
  triggered_by: `password=${BACKEND_CANARY}`,
  created_at: '2026-11-22T10:00:00Z',
  started_at: null,
  completed_at: null,
  duration_ms: 1,
  total_flows: 1,
  passed_flows: 0,
  failed_flows: 1,
  completed_flows: 1,
  total_validations: 1,
  passed_validations: 0,
  failed_validations: 1,
  error_message: `Authorization: Bearer ${SHAPE_CANARY}`,
  langgraph_thread_id: null,
  flow_versions: {},
  runtime_params: { [`token password: ${BACKEND_CANARY}`]: 'x' },
  config_snapshot: {},
};

const VALIDATOR_ID = '8a4c6b73-0001-4a00-8000-000000000001';
const OTHER_RUN_ID = '6e2a4f51-0002-4f00-8000-000000000002';
const RESULT_ID = '7f3b5a62-0002-4a00-8000-000000000002';
const FLOW_RESULT = {
  id: RESULT_ID,
  execution_id: RUN_ID,
  flow_id: 'f2',
  flow_version: 1,
  test_type_id: 't1',
  test_type_name: `boundary password: ${BACKEND_CANARY}`,
  status: 'failed',
  started_at: null,
  completed_at: null,
  duration_ms: 1,
  error_message: `Authorization: Bearer ${SHAPE_CANARY}`,
  total_validations: 1,
  passed_validations: 0,
  failed_validations: 1,
  final_response: null,
  final_variables: {},
  generated_input: {},
  block_results: [
    {
      block_id: 'b1',
      block_name: `POST password: ${BACKEND_CANARY}`,
      block_type: 'request' as const,
      status: 'failed' as const,
      duration_ms: 1,
      auth_token_acquired: false,
      final_attempt_on_retry: false,
      grpc_streaming_count: 0,
      poll_count: 0,
      retry_attempts: 0,
      skipped_due_to_dependency: false,
      sse_events_received: 0,
      webhook_callbacks_received: 0,
      ws_messages_received: 0,
      ws_messages_sent: 0,
      request_url: `https://u:${BACKEND_CANARY}@h.example.test/x`,
      error_message: `password=${BACKEND_CANARY}`,
    },
  ],
  validation_results: [
    {
      validator_name: `v password: ${BACKEND_CANARY}`,
      passed: false,
      message: `Authorization: Bearer ${SHAPE_CANARY}`,
      expected: { a: `password: ${BACKEND_CANARY}` },
      actual: `Authorization: Bearer ${SHAPE_CANARY}`,
      execution_time_ms: 1,
      final_attempt_on_retry: false,
      retry_attempts: 0,
      skipped_due_to_dependency: false,
    },
  ],
};

const CATALOG_TYPE_ID = '1a2b3c4d-0001-4a00-8000-000000000001';

/** A shared base test type whose texts carry credentials only the mask finds. */
function taintedBaseType(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  seedCatalog.testTypes(fake.store, [
    {
      id: CATALOG_TYPE_ID,
      name: `probe password: ${BACKEND_CANARY}`,
      display_name: `Authorization: Bearer ${SHAPE_CANARY}`,
      category: 'negative',
      description: `password=${BACKEND_CANARY}`,
      is_active: true,
      is_builtin: false,
      expected_outcome: `secret ${BACKEND_CANARY}`,
      input_generation_prompt: `prompt ${BACKEND_CANARY}`,
      input_schema: {},
      example_inputs: [],
      created_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-01T10:00:00Z',
    },
  ]);
}

const PROJECT_TYPE_ID = '7a1b2c3d-0001-4a00-8000-000000000001';

/** A test type of the project whose name and texts carry credentials only the mask finds. */
function taintedProjectType(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  fake.store
    .collection<Record<string, unknown> & { id: string }>(SKLEP_COLLECTIONS.testTypes)
    .insert({
      id: PROJECT_TYPE_ID,
      project_id: SKLEP_IDS.project,
      default_count: 3,
      is_enabled: true,
      priority: 9,
      effective_name: `probe password: ${BACKEND_CANARY}`,
      effective_display_name: `Authorization: Bearer ${SHAPE_CANARY}`,
      effective_category: 'negative',
      custom_description: `password=${BACKEND_CANARY}`,
    });
}

const PROJECT_VALIDATOR_ID = '7a1b2c3d-0002-4b00-8000-000000000002';

/** A validator of the project whose name and texts carry credentials only the mask finds. */
function taintedProjectValidator(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  fake.store
    .collection<Record<string, unknown> & { id: string }>(SKLEP_COLLECTIONS.validators)
    .insert({
      id: PROJECT_VALIDATOR_ID,
      project_id: SKLEP_IDS.project,
      default_params: {},
      is_enabled: true,
      priority: 9,
      evaluated_after_run: false,
      effective_name: `check password: ${BACKEND_CANARY}`,
      effective_display_name: `Authorization: Bearer ${SHAPE_CANARY}`,
      effective_validator_type: 'assertion',
      effective_category: 'http',
      custom_description: `password=${BACKEND_CANARY}`,
    });
}

const DOCS_ID = '3b9d1c2e-0001-4c00-8000-000000000001';

/** A discovery whose proposals carry credentials only the mask finds. */
function taintedDiscovery(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  seedDiscovery(fake.store, {
    already_in_project: 0,
    considered_count: 1,
    rejected_count: 0,
    proposals: [
      {
        bucket: 'high',
        confidence: 0.9,
        description: `Authorization: Bearer ${SHAPE_CANARY}`,
        display_name: `check password: ${BACKEND_CANARY}`,
        evidence_count: 1,
        evidence_source: 'response_samples',
        fields: ['status'],
        name: `check password: ${BACKEND_CANARY}`,
        params: { secret: BACKEND_CANARY },
        rationale: `password=${BACKEND_CANARY}`,
        template: `token ${BACKEND_CANARY}`,
      },
    ],
    evidence_summary: {
      basis: 'recorded_responses',
      has_app_description: 0,
      openapi_schemas: 0,
      operations: 1,
      operations_not_shown: 0,
      response_samples: 1,
      sampled_operations: 1,
    },
  });
}

export const CANARY_CASES: readonly Case[] = [
  {
    tool: 'functional_get_test_types',
    label: 'the test types of the project',
    stage: 'executed',
    args: () => ({}),
  },
  {
    tool: 'functional_get_test_types',
    label: 'the expected outcomes, format data',
    stage: 'executed',
    args: () => ({ view: 'expected_outcomes', format: 'data' }),
    setup: (fake) => {
      seedOutcomeCandidates(fake.store, {
        status_field: `status password: ${BACKEND_CANARY}`,
        candidates: [
          { value: `Authorization: Bearer ${SHAPE_CANARY}`, source: 'observed', field: null },
        ],
      });
    },
  },
  {
    tool: 'functional_get_validators',
    label: 'the validators of the project',
    stage: 'executed',
    args: () => ({}),
  },
  {
    tool: 'functional_get_validators',
    label: 'the applicable catalog validators',
    stage: 'executed',
    args: () => ({ view: 'applicable' }),
    setup: (fake) => {
      seedApplicable(fake.store, {
        total: 1,
        applicable_total: 1,
        groups: {
          [`group password: ${BACKEND_CANARY}`]: [
            {
              id: 'a1',
              name: 'status_code',
              display_name: 'Status code',
              validator_type: 'assertion',
              applicable: true,
              reason: `Authorization: Bearer ${SHAPE_CANARY}`,
              activation: 'auto',
              requires_profile_flags: [],
              scope: 'step',
              group: 'http',
              has_engine: true,
              description: null,
            },
          ],
        },
      });
    },
  },
  {
    tool: 'functional_get_validators',
    label: 'the enforcement levels, format data',
    stage: 'executed',
    args: () => ({ view: 'gatling_enforcement', format: 'data' }),
    setup: (fake) => {
      seedEnforcement(fake.store, {
        default_level: `warn password: ${BACKEND_CANARY}`,
        levels: { [`kind Authorization: Bearer ${SHAPE_CANARY}`]: 'fail' },
      });
    },
  },
  {
    tool: 'functional_get_flows',
    label: 'one flow with its blocks',
    stage: 'executed',
    args: () => ({ flow: FLOW_ID }),
    setup: (fake) => {
      seedFlows(fake.store, [FLOW]);
    },
  },
  {
    tool: 'functional_get_flows',
    label: 'the versions of a flow',
    stage: 'executed',
    args: () => ({ flow: FLOW_ID, view: 'versions', format: 'data' }),
    setup: (fake) => {
      seedFlows(fake.store, [FLOW]);
      seedFlowVersions(fake.store, FLOW_ID, [
        {
          id: 'v1',
          flow_id: FLOW_ID,
          version: '1',
          created_at: '2026-11-20T10:00:00Z',
          change_reason: `password: ${BACKEND_CANARY}`,
        },
      ]);
    },
  },
  {
    tool: 'functional_get_templates',
    label: 'one template with assertions and runtime parameters',
    stage: 'executed',
    args: () => ({ template: TEMPLATE_ID }),
    setup: (fake) => {
      seedTemplates(fake.store, [TEMPLATE]);
    },
  },
  {
    tool: 'functional_get_templates',
    label: 'the templates, format data',
    stage: 'executed',
    args: () => ({ format: 'data' }),
    setup: (fake) => {
      seedTemplates(fake.store, [TEMPLATE]);
    },
  },
  {
    tool: 'functional_save_flow',
    label:
      'a change of blocks and a name over a flow whose name and previous values carry credentials',
    stage: 'executed',
    args: () => ({
      flow_id: FLOW_ID,
      name: 'A clean name',
      fields: { blocks: [{ id: 'b9', type: 'request' }], description: 'A clean description.' },
    }),
    setup: (fake) => {
      seedFlows(fake.store, [FLOW]);
      seedFlowVersions(fake.store, FLOW_ID, []);
    },
  },
  {
    tool: 'functional_save_flow',
    label: 'the same, only fields, names tainted, format data',
    stage: 'executed',
    names: true,
    args: () => ({ flow_id: FLOW_ID, fields: { tags: ['clean'] }, format: 'data' }),
    setup: (fake) => {
      seedFlows(fake.store, [FLOW]);
      seedFlowVersions(fake.store, FLOW_ID, []);
    },
  },
  {
    tool: 'functional_save_template',
    label: 'a change over a template whose name and previous values carry credentials',
    stage: 'executed',
    args: () => ({
      template_id: TEMPLATE_ID,
      name: 'A clean name',
      fields: { api_description: 'A clean description of the shop API.', tags: ['clean'] },
    }),
    setup: (fake) => {
      seedTemplates(fake.store, [TEMPLATE]);
    },
  },
  {
    tool: 'functional_save_template',
    label: 'the same, names tainted, format data',
    stage: 'executed',
    names: true,
    args: () => ({
      template_id: TEMPLATE_ID,
      fields: { tags: ['clean'] },
      format: 'data',
    }),
    setup: (fake) => {
      seedTemplates(fake.store, [TEMPLATE]);
    },
  },
  {
    tool: 'functional_get_runs',
    label: 'one functional run',
    stage: 'executed',
    args: () => ({ run_id: RUN_ID }),
    setup: (fake) => {
      seedFunctionalRuns(fake.store, [RUN]);
    },
  },
  {
    tool: 'functional_get_runs',
    label: 'the functional runs, format data',
    stage: 'executed',
    args: () => ({ format: 'data' }),
    setup: (fake) => {
      seedFunctionalRuns(fake.store, [RUN]);
    },
  },
  {
    tool: 'functional_get_results',
    label: 'the summary of a run with a failing flow',
    stage: 'executed',
    args: () => ({ run_id: RUN_ID }),
    setup: (fake) => {
      seedFunctionalRuns(fake.store, [RUN]);
      seedFlowResults(fake.store, RUN_ID, [FLOW_RESULT]);
    },
  },
  {
    tool: 'functional_get_results',
    label: 'one flow result with its validations and blocks',
    stage: 'executed',
    args: () => ({ run_id: RUN_ID, view: 'one', result_id: RESULT_ID }),
    setup: (fake) => {
      seedFunctionalRuns(fake.store, [RUN]);
      seedFlowResults(fake.store, RUN_ID, [FLOW_RESULT]);
    },
  },
  {
    tool: 'functional_get_results',
    label: 'the HTTP log, format data',
    stage: 'executed',
    args: () => ({ run_id: RUN_ID, view: 'http_log', format: 'data' }),
    setup: (fake) => {
      seedFunctionalRuns(fake.store, [RUN]);
      seedApiLogs(fake.store, RUN_ID, [
        {
          id: 'l1',
          sequence_number: 1,
          timestamp: '2026-11-22T10:00:06Z',
          log_type: 'request',
          method: 'POST',
          url: `https://u:${BACKEND_CANARY}@h.example.test/x`,
          message: `Authorization: Bearer ${SHAPE_CANARY}`,
          request_headers: { 'x-api-key': `${SHAPE_CANARY}` },
          request_body: { note: `password: ${BACKEND_CANARY}` },
          response_body: { echo: `Authorization: Bearer ${SHAPE_CANARY}` },
        },
      ]);
    },
  },
  {
    tool: 'functional_compare_runs',
    label: 'two functional runs compared block by block',
    stage: 'executed',
    args: () => ({ run_id: RUN_ID, other: OTHER_RUN_ID }),
    setup: (fake) => {
      seedFunctionalRuns(fake.store, [RUN, { ...RUN, id: OTHER_RUN_ID }]);
      seedFunctionalCompare(fake.store, {
        execution_a_id: RUN_ID,
        execution_b_id: OTHER_RUN_ID,
        same_flow_versions: true,
        warnings: [`Authorization: Bearer ${SHAPE_CANARY}`],
        blocks: [
          {
            block_id: 'b1',
            block_name: `POST password: ${BACKEND_CANARY}`,
            verdict: 'shape_changed',
            shape_diff: {
              only_in_a: [[`token password: ${BACKEND_CANARY}`, 'string']],
              type_changed: [['x', 'number', `Authorization: Bearer ${SHAPE_CANARY}`]],
            },
          },
        ],
      });
    },
  },
  {
    tool: 'functional_get_analytics',
    label: 'the dashboard with flaky validators and failure patterns',
    stage: 'executed',
    args: () => ({}),
    setup: (fake) => {
      seedAnalytics.dashboard(fake.store, {
        period_days: 30,
        generated_at: '2026-11-27T12:00:00Z',
        summary: {
          total_validators: 1,
          total_executions: 1,
          overall_pass_rate: 0.5,
          flaky_validators_count: 1,
          ai_validators_count: 0,
        },
        coverage: {
          measured: true,
          source: `Authorization: Bearer ${SHAPE_CANARY}`,
          excludes: [`password: ${BACKEND_CANARY}`],
        },
        flaky_validators: [
          {
            validator_id: 'v1',
            validator_name: `v password: ${BACKEND_CANARY}`,
            flakiness_score: 0.5,
            pass_rate_variance: 0.1,
            sample_size: 10,
            recommendation: `Authorization: Bearer ${SHAPE_CANARY}`,
            evidence: [`password=${BACKEND_CANARY}`],
          },
        ],
        failure_patterns: [
          {
            pattern_type: `type password: ${BACKEND_CANARY}`,
            pattern_value: `Authorization: Bearer ${SHAPE_CANARY}`,
            failure_count: 1,
            failure_rate: 0.1,
            correlation_strength: 0.5,
            sample_messages: [`password=${BACKEND_CANARY}`],
          },
        ],
      });
    },
  },
  {
    tool: 'functional_get_analytics',
    label: 'the accuracy of one validator, format data',
    stage: 'executed',
    args: () => ({ view: 'accuracy', validator: VALIDATOR_ID, format: 'data' }),
    setup: (fake) => {
      seedAnalytics.accuracy(fake.store, VALIDATOR_ID, {
        validator_id: VALIDATOR_ID,
        validator_name: `v password: ${BACKEND_CANARY}`,
        validator_type: 'assertion',
        total_executions: 1,
        pass_count: 0,
        fail_count: 1,
        pass_rate: 0,
        retry_rate: 0,
        common_failure_reasons: [`Authorization: Bearer ${SHAPE_CANARY}`],
        suggested_actions: [`password=${BACKEND_CANARY}`],
      });
    },
  },
  {
    tool: 'functional_restore_flow',
    label: 'a flow restored to a saved version, with a name and labels that hold credentials',
    stage: 'executed',
    args: () => ({ flow_id: FLOW_ID, version: '2.15.0' }),
    setup: (fake) => {
      seedFlows(fake.store, [{ ...FLOW, name: `Checkout password: ${BACKEND_CANARY}` }]);
      seedFlowVersions(fake.store, FLOW_ID, [
        { id: 'v1', flow_id: FLOW_ID, version: '2.15.0', created_at: '2026-11-20T10:00:00Z' },
      ]);
    },
  },
  {
    tool: 'functional_get_catalog',
    label: 'a list of base validators with credentials in its texts',
    stage: 'executed',
    args: () => ({ kind: 'validators' }),
    setup: (fake) => {
      seedCatalog.validators(fake.store, [
        {
          id: '2b3c4d5e-0001-4b00-8000-000000000001',
          name: `v password: ${BACKEND_CANARY}`,
          display_name: `Authorization: Bearer ${SHAPE_CANARY}`,
          category: `c password: ${BACKEND_CANARY}`,
          description: `password=${BACKEND_CANARY}`,
          validator_type: 'assertion',
          is_active: true,
          is_builtin: false,
          activation: 'auto',
          group: 'g',
          scope: 'step',
          requires_profile_flags: [],
          ai_prompt_template: `secret prompt ${BACKEND_CANARY}`,
          parameters: [{ name: `p password: ${BACKEND_CANARY}` }],
          created_at: '2026-11-01T10:00:00Z',
          updated_at: '2026-11-01T10:00:00Z',
        },
      ]);
    },
  },
  {
    tool: 'functional_get_catalog',
    label: 'one assertion type by name, format data',
    stage: 'executed',
    args: () => ({ kind: 'assertion_types', entry_id: 'equals', format: 'data' }),
    setup: (fake) => {
      seedCatalog.assertionTypes(fake.store, [
        {
          id: '3c4d5e6f-0001-4c00-8000-000000000001',
          name: 'equals',
          display_name: `Authorization: Bearer ${SHAPE_CANARY}`,
          category: 'c',
          description: `password=${BACKEND_CANARY}`,
          is_active: true,
          is_builtin: false,
          parameters: [{ name: `p password: ${BACKEND_CANARY}` }],
          prompt_template: `secret ${BACKEND_CANARY}`,
          created_at: '2026-11-01T10:00:00Z',
          updated_at: '2026-11-01T10:00:00Z',
        },
      ]);
    },
  },
  {
    tool: 'functional_save_catalog',
    label: 'the card of a change over a shared entry whose texts carry credentials',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    args: () => ({
      kind: 'catalog_test_type',
      entry_id: CATALOG_TYPE_ID,
      fields: { description: 'A clean description' },
    }),
    setup: taintedBaseType,
  },
  {
    tool: 'functional_save_catalog',
    label: 'the change after the yes of the person, previous values tainted',
    stage: 'executed',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('functional_save_catalog', {
        kind: 'catalog_test_type',
        entry_id: CATALOG_TYPE_ID,
        fields: { description: 'A clean description' },
      });
      return {};
    },
    args: () => ({
      kind: 'catalog_test_type',
      entry_id: CATALOG_TYPE_ID,
      fields: { description: 'A clean description' },
    }),
    setup: taintedBaseType,
  },
  {
    tool: 'functional_save_test_types',
    label: 'the card of a change over a project test type whose texts carry credentials',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    args: () => ({ test_type_id: PROJECT_TYPE_ID, fields: { description: 'A clean description' } }),
    setup: taintedProjectType,
  },
  {
    tool: 'functional_save_test_types',
    label: 'the change after the yes of the person, previous values tainted',
    stage: 'executed',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('functional_save_test_types', {
        test_type_id: PROJECT_TYPE_ID,
        fields: { description: 'A clean description' },
      });
      return {};
    },
    args: () => ({ test_type_id: PROJECT_TYPE_ID, fields: { description: 'A clean description' } }),
    setup: taintedProjectType,
  },
  {
    tool: 'functional_save_validators',
    label: 'the card of a change over a project validator whose texts carry credentials',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    args: () => ({
      validator_id: PROJECT_VALIDATOR_ID,
      fields: { description: 'A clean description' },
    }),
    setup: taintedProjectValidator,
  },
  {
    tool: 'functional_save_validators',
    label: 'the change after the yes of the person, previous values tainted',
    stage: 'executed',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('functional_save_validators', {
        validator_id: PROJECT_VALIDATOR_ID,
        fields: { description: 'A clean description' },
      });
      return {};
    },
    args: () => ({
      validator_id: PROJECT_VALIDATOR_ID,
      fields: { description: 'A clean description' },
    }),
    setup: taintedProjectValidator,
  },
  {
    tool: 'functional_suggest_validators',
    label: 'the card of a suggestion (it sends no request)',
    stage: 'executed',
    personSaysYes: true,
    local: true,
    args: () => ({ docs_id: DOCS_ID }),
  },
  {
    tool: 'functional_suggest_validators',
    label: 'the proposals after the yes of the person, their texts tainted',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    before: async (drive) => {
      await drive.once('functional_suggest_validators', { docs_id: DOCS_ID });
      return {};
    },
    args: () => ({ docs_id: DOCS_ID }),
    setup: taintedDiscovery,
  },
  {
    tool: 'functional_delete',
    label: 'the card of a deletion of a shared entry whose texts carry credentials',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    args: () => ({ kind: 'catalog_test_type', item_id: CATALOG_TYPE_ID }),
    setup: taintedBaseType,
  },
  {
    tool: 'functional_delete',
    label: 'a flow deleted after the yes of the person, its name tainted',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    before: async (drive) => {
      await drive.once('functional_delete', { kind: 'flow', item_id: FLOW_ID });
      return {};
    },
    args: () => ({ kind: 'flow', item_id: FLOW_ID }),
    setup: (fake) => {
      seedFlows(fake.store, [FLOW]);
    },
  },
  {
    tool: 'functional_suggest_test_types',
    label: 'the card of a suggestion (it sends no request)',
    stage: 'executed',
    personSaysYes: true,
    local: true,
    args: () => ({ docs_id: DOCS_ID, focus_areas: 'security' }),
  },
  {
    tool: 'functional_suggest_test_types',
    label: 'the suggestions after the yes of the person, their texts carry credentials',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    before: async (drive) => {
      await drive.once('functional_suggest_test_types', { docs_id: DOCS_ID });
      return {};
    },
    args: () => ({ docs_id: DOCS_ID }),
    setup: (fake) => {
      scriptTestTypes(fake, {
        endMs: 0,
        suggestions: [
          {
            category: 'security',
            description: `Authorization: Bearer ${SHAPE_CANARY}`,
            display_name: `Probe password: ${BACKEND_CANARY}`,
            example_inputs: [],
            expected_outcome: null,
            input_generation_prompt: `use token ${BACKEND_CANARY}`,
            name: `probe password: ${BACKEND_CANARY}`,
            rationale: `password=${BACKEND_CANARY}`,
          },
        ],
      });
    },
  },
  {
    tool: 'functional_generate_test_types',
    label: 'the card over base test types whose texts carry credentials',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    args: () => ({}),
    setup: taintedBaseType,
  },
  {
    tool: 'functional_generate_test_types',
    label:
      'the generation after the yes of the person, the created types and the rationale tainted',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    before: async (drive) => {
      await drive.once('functional_generate_test_types', {});
      return {};
    },
    args: () => ({}),
    setup: (fake) => {
      taintedBaseType(fake);
      scriptTestTypes(fake, {
        endMs: 0,
        created: [`probe password: ${BACKEND_CANARY}`],
        rationale: `Authorization: Bearer ${SHAPE_CANARY}`,
      });
    },
  },
  {
    tool: 'functional_generate_payloads',
    label: 'the card over a flow and a test type whose names carry credentials',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    args: () => ({ flow_ids: { [FLOW_ID]: {} }, test_types: { [PROJECT_TYPE_ID]: 3 } }),
    setup: (fake) => {
      seedFlows(fake.store, [FLOW]);
      taintedProjectType(fake);
    },
  },
  {
    tool: 'functional_generate_payloads',
    label: 'the generation after the yes of the person; the ZIP is saved, never read',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    before: async (drive) => {
      await drive.once('functional_generate_payloads', {
        flow_ids: { [FLOW_ID]: {} },
        test_types: { [PROJECT_TYPE_ID]: 3 },
      });
      return {};
    },
    args: () => ({ flow_ids: { [FLOW_ID]: {} }, test_types: { [PROJECT_TYPE_ID]: 3 } }),
    setup: (fake) => {
      seedFlows(fake.store, [FLOW]);
      taintedProjectType(fake);
    },
  },
];
