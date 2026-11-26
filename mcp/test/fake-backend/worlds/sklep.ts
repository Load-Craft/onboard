// World "sklep" of the fake backend: one coherent data set matching the mock-up session
// (project, environments, operations, flows, scenarios, composition, datasets, one executed run
// and its AI analysis). Tool tests, the golden views and the demo mode all read it, so the
// numbers here are the numbers of the golden texts in `mcp/test/golden`.
//
// `seedSklep(store, { stage })` fills the store as it is after a given step of the session; a
// later stage keeps every record of the earlier ones. Records of shapes typed in the contract
// snapshot use the generated types; the Gatling documents are untyped in the snapshot, so their
// records have the key set of the backend's response builders (`test/fake-backend/worlds/sklep.test.ts` pins every list with its source line). Only `example.com` hosts, synthetic
// data, constant UUIDs: the same stage always gives the same records.

import { createHash } from 'node:crypto';

import type { components } from '../../../src/http/generated/api.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { createIdSource, type Store } from '../store.js';

type ProjectDetail = components['schemas']['ProjectDetail'];
type EnvironmentResponse = components['schemas']['EnvironmentResponse'];
type EndpointSummary = components['schemas']['EndpointSummary'];
type OpenAPISpecSummary = components['schemas']['OpenAPISpecSummary'];
type TelemetrySource = components['schemas']['TelemetrySource'];
type FlowDetail = components['schemas']['FlowDetail'];
type ValidatorResponse = components['schemas']['ValidatorResponse'];
type TestTypeResponse = components['schemas']['TestTypeResponse'];
type ProtocolConfig = components['schemas']['ProtocolConfig'];

// ---- public surface -----------------------------------------------------------------------

/** Session steps in order; a stage is the world after that step. */
export const SKLEP_STAGES = ['empty', 'project', 'flows', 'scenario', 'data', 'executed'] as const;

export type SklepStage = (typeof SKLEP_STAGES)[number];

/** Collection names of the world in the store. */
export const SKLEP_COLLECTIONS = {
  projects: 'projects',
  environments: 'environments',
  specs: 'openapi_specs',
  endpoints: 'openapi_endpoints',
  telemetry: 'telemetry_sources',
  validators: 'project_validators',
  testTypes: 'project_test_types',
  flows: 'flows',
  scenarios: 'gatling_scenarios',
  compositions: 'gatling_compositions',
  feeders: 'gatling_feeders',
  executions: 'gatling_executions',
  results: 'gatling_execution_results',
  analyses: 'gatling_execution_analyses',
} as const;

/**
 * Identifiers of the world. The ones that appear in golden texts are `SKLEP_IDS`
 * (`mcp/test/golden/index.ts`); the world takes them from there so the links in the golden texts
 * match the fake. The rest are constants of this world.
 */
export const SKLEP_WORLD_IDS = {
  ...SKLEP_IDS,
  spec: '0e6b4a91-3d27-4c58-9f10-7a2e5d8b3c64',
  environments: {
    perf: '4d8f1c63-2a9e-4b70-8e35-6c1a0f7d9b52',
    qa: '9a3e7b25-5c1d-4f86-a2d4-0b8e6f3c1a97',
    dev: 'e1c5a8f4-7b32-4d09-b6e1-3f9d2a4c8e70',
    prod: '6b2d9e07-1f4a-4c83-97b5-8d0c3e6a2f41',
  },
  flowPrzegladanie: 'd3a6f0b8-9e41-4725-8c1d-5b7e2a9f4c06',
  flowKonto: '1f8c4e72-6a0d-4b39-a5e8-9c2d7b3f0a15',
  scenarios: {
    przegladanie: 'b7e2d495-0c38-4a61-9d7f-4e1a8c5b3f20',
    zakupy: '28a9c1f6-d4e7-4b05-83a2-7f6e0d1c9b38',
    konto: 'f4d0b73a-8c19-4e62-b1a5-2d9f6e7c3a84',
  },
  composition: '73c1e5a9-4b28-4d0f-a6c3-1e8b9d2f7a05',
  compositionLinks: {
    przegladanie: 'a8f2d6c0-3e75-4b19-8d04-6c9a1f5e2b73',
    zakupy: '5e0b9a3d-7c42-4f86-b1e9-0a4d8c2f6e17',
    konto: 'c2d7f81e-9a63-4054-a8b2-3e5c0d7f1a96',
  },
  feeders: {
    frazy: '8b4e2c70-5f1a-4d93-9e06-a1c7d3f8b254',
    zamowienia: '3a9d7f15-e208-4c4b-85d1-6b0e4a2c9f78',
    konta: 'd6c0a4e8-1b57-4f32-a9c8-7e2f5d1b3a09',
  },
  gatlingProject: '9c4b1e7a-2f60-4d85-b3a9-5e0d8c2f1a76',
  selfCheckZakupy: '0b5e8d2a-c7f1-4936-b4a0-9d3c6e1f8a52',
  selfCheckKonto: '47d9a0c3-8e12-4b56-9fa1-c3e7b5d2084f',
  analysis: 'f9a1c3e7-2d84-4b60-8e57-0c6b4d9a1f23',
} as const;

/** The project's telemetry source; keyed by the project id. */
export type SklepTelemetrySource = TelemetrySource & { id: string };

/** An operation of the spec: the contract's `EndpointSummary` plus the spec it belongs to. */
export type SklepEndpoint = EndpointSummary & { spec_id: string };

/** How a dataset hands out its rows, as the contract enumerates it. */
export type SklepFeederStrategy = 'random' | 'queue' | 'shuffle' | 'circular';

export interface SklepSlot {
  slot: string;
  label: string;
  columns: string[];
  strategy: SklepFeederStrategy;
  column_specs: Record<string, unknown>[];
  identity_kind: 'existing' | 'fresh' | null;
  default_file: string;
  role: 'auth' | 'data' | null;
  generated: boolean;
  generated_rows: number | null;
}

/** A step of a run of the check, as the scenario lists it (execution order, plan position, status). */
export interface SklepSelfCheckStep {
  name: string;
  group: string | null;
  plan_index: number | null;
  is_preflight: boolean;
  method: string | null;
  path: string | null;
  result: 'ok' | 'failed' | 'not_run';
  http_status: number | null;
  reason: string | null;
}

/** The verdicts of a check and of a run of it, as the contract enumerates them. */
export type SklepCheckVerdict =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'target_unreachable'
  | 'waiting_for_data'
  | 'not_admitted'
  | 'skipped_protected_environment'
  | 'disabled'
  | 'interrupted'
  | 'goal_step_missing'
  | 'repairing'
  | 'passed_after_repair';

/** The failure of a check or of a repair round; `http_status` is the status the failing request answered. */
export interface SklepSelfCheckFailure {
  request_name: string | null;
  message: string;
  http_status: number | null;
  goal_url: string | null;
}

/** One repair round of a check: what failed, what the AI changed or why it refused. */
export interface SklepSelfCheckRepair {
  round: number;
  failure: SklepSelfCheckFailure;
  changes_summary: string;
  refused_reason: string | null;
  refused_code:
    | 'not_regenerable'
    | 'no_change'
    | 'invalid_change'
    | 'weakens_test'
    | 'unsupported_change'
    | 'build_failed'
    | null;
  refused_message: string | null;
  scenario_version_after: number | null;
  verdict: SklepCheckVerdict | null;
  recording_available: boolean;
}

/** One run of a check: its execution, the version it ran and its steps in the order they ran. */
export interface SklepSelfCheckRun {
  execution_id: string;
  scenario_version: number;
  status: SklepCheckVerdict | null;
  steps: SklepSelfCheckStep[];
  steps_omitted: number;
}

/** `SelfCheckState` of the backend as the scenario shows it. */
export interface SklepSelfCheck {
  status: 'passed' | 'waiting_for_data';
  scenario_version: number;
  execution_ids: string[];
  failure: null;
  notes: string[];
  missing_slots: string[];
  repairs: SklepSelfCheckRepair[];
  max_repair_rounds: number | null;
  runs: SklepSelfCheckRun[];
  started_at: string | null;
  finished_at: string | null;
}

/** The scenario detail document (`_scenario_detail_payload`, `api/routes/gatling.py:4118`). */
export interface SklepScenario {
  id: string;
  name: string;
  description: string;
  simulation_class_name: string;
  source_flow_id: string;
  source_flow_version: number;
  truncate_after_block_id: string | null;
  flow_overlay_version: number | null;
  current_version: number;
  artifact_version: number;
  /** `null` without a compiled bundle. */
  generator_state: 'current' | 'built_with_older_generator' | null;
  /** Carries the generation metadata: source flow, resolved class mix, the self-check. */
  scenario_artifact: {
    artifact_version: number;
    feeders: Record<string, unknown>[];
    generation_metadata: {
      source_kind: string;
      source_flow_id: string;
      source_flow_version: number;
      generator: string;
      /** Data mix by test type, in percent; `happy_path` is the typical data. */
      resolved_class_mix: Record<string, number>;
      self_check: SklepSelfCheck | null;
    };
  };
  feeder_slots: SklepSlot[];
  sensitive_headers_missing_registration: string[];
  auth_credentials_without_consumer: string[];
  /** Slot → dataset id. */
  slot_bindings: Record<string, string>;
  slot_binding_states: { slot: string; feeder_id: string; state: 'pinned' }[];
  assertion_thresholds: Record<string, unknown> | null;
  project_assertion_thresholds: Record<string, unknown> | null;
  assertion_threshold_view: Record<string, unknown>;
  scenario_contract_v2: {
    required_inputs: string[];
    exports: string[];
    locals: string[];
    control_vars: string[];
    session_vars: string[];
  };
  self_check: SklepSelfCheck | null;
  session_seconds: number;
  session_seconds_kind: 'exact';
  pause_source_mix: Record<
    'recording' | 'default_human' | 'manual' | 'machine_wait' | 'unknown',
    { count: number; mean_ms: number | null }
  >;
  /** `null`: unknown, never 0. */
  requests_per_session: number | null;
  is_active: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

/** A member of a composition (`_format_composition`, `gatling_compositions.py:812-871`). */
/** What a composition link can drift in, as the contract enumerates it. */
export type SklepDriftField =
  'name' | 'description' | 'scenario_contract_v2' | 'scenario_artifact' | 'simulation_class_name';

export interface SklepCompositionLink {
  link_id: string;
  scenario_id: string;
  scenario_name: string;
  simulation_class_name: string;
  variant_label: string;
  /** Fraction of the traffic, 0..1. */
  proportion: number;
  order_index: number;
  injection_override: Record<string, unknown> | null;
  load_profile: Record<string, unknown> | null;
  feeder_bindings: {
    feeder_id: string;
    feeder_name: string;
    file_name: string;
    required_row_count: number;
    row_count: number;
    strategy: string;
  }[];
  think_time_ms: number | null;
  enabled: boolean;
  contract: { inputs: { name: string }[]; outputs: { name: string }[] } & Record<string, unknown>;
  scenario_artifact: Record<string, unknown> | null;
  scenario_contract_v2: Record<string, unknown> | null;
  scenario_version: number;
  scenario_created_at: string | null;
  artifact_digest: string;
  live_digest: string;
  has_drift: boolean;
  drift_fields: SklepDriftField[];
  pinned_version: number;
  current_version: number;
}

/** The composition document (`_format_composition`, `gatling_compositions.py:745-792`). */
export type SklepThrottleStep = {
  action: 'hold' | 'reach_rps' | 'jump_to_rps';
  duration_seconds?: number | null;
  rps?: number | null;
};

/** The protocol settings of a project or a composition nobody tuned: the defaults the contract declares. */
export const defaultProtocolConfig = (): ProtocolConfig => ({
  async_name_resolution: false,
  disable_auto_referer: false,
  disable_caching: false,
  disable_warm_up: false,
  http2_enabled: false,
  http2_prior_knowledge: false,
  infer_html_resources: false,
  per_user_name_resolution: false,
  proxy_type: 'http',
  share_connections: false,
  silent_resources: false,
});

export interface SklepComposition {
  id: string;
  name: string;
  description: string;
  /** Id of the Gatling project, not of the LoadCraft project. */
  project_id: string;
  injection_config: Record<string, unknown>;
  global_headers: Record<string, string> | null;
  global_think_time_ms: number | null;
  protocol_config: ProtocolConfig;
  throttle_steps: SklepThrottleStep[];
  pause_distribution: 'normal' | 'uniform' | 'exponential';
  normal_pause_std_dev_percent: number;
  status: 'ready';
  composition_mode: 'parallel';
  sequence_config: Record<string, unknown> | null;
  test_type_spec: Record<string, unknown> | null;
  assertion_inference: Record<string, unknown> | null;
  slot_bindings: Record<string, string>;
  slot_binding_states: { slot: string; feeder_id: string; state: 'pinned' }[];
  created_at: string;
  updated_at: string;
  validation: {
    is_valid: boolean;
    authoring_valid: boolean;
    errors: string[];
    warnings: string[];
    error_details: Record<string, unknown>[];
    warning_details: Record<string, unknown>[];
    issue_details: {
      level: 'error' | 'warning';
      message: string;
      scenario_id: string | null;
      step_index: number | null;
      suggestion: string | null;
      variable: string | null;
    }[];
    scenario_count: number;
    total_proportion: number;
    last_validated_at: string;
    validated_against_digest: string;
    effective_status: 'ready';
    has_drift: boolean;
    drifted_members: {
      current_version: number | null;
      drift_fields: SklepDriftField[];
      link_id: string;
      pinned_version: number | null;
      scenario_id: string;
      scenario_name: string | null;
      variant_label: string;
    }[];
    missing_bound_feeders: string[];
  };
  scenarios: SklepCompositionLink[];
}

/** A project dataset (`_serialize_feeder_model`, `api/routes/gatling.py:2050-2098`). */
export interface SklepFeeder {
  id: string;
  gatling_project_id: string;
  name: string;
  description: string | null;
  feeder_type: 'csv';
  strategy: SklepFeederStrategy;
  file_name: string;
  content: string | null;
  record_count: number;
  columns: string[];
  separator: string;
  transform_expression: null;
  feed_records_count: null;
  feed_records_count_expression: null;
  dsl: null;
  jdbc_config: null;
  redis_config: null;
  feeder_options: null;
  consumption: 'shared' | 'exclusive';
  column_semantics: Record<string, SklepColumnSemantic>;
  has_recipe: boolean;
  recipe_summary: { column_name: string; generator: string }[];
  content_hash: string;
  manually_edited: boolean;
  created_by: string;
  auto_linked_scenario_id: string | null;
  provenance: 'auto' | 'uploaded';
  audit_metadata: null;
  created_at: string;
  updated_at: string;
}

/** What a feeder column holds, as the contract enumerates it. */
export type SklepColumnSemantic =
  'identity' | 'credential' | 'entity-ref' | 'synthetic' | 'derived';

export type SklepFeederManifestEntry = {
  slot: string;
  source_kind: 'db_dataset';
  feeder_id: string;
  dataset_name: string;
  content_hash: string;
  resolution_state: 'pinned';
  resolution_state_unavailable: null;
  comparable: true;
  demand_values: number;
  binding_source: 'persisted';
};

/** The run manifest (`_run_manifest_payload`, `api/routes/gatling.py:12412`). */
export interface SklepRunManifest {
  workload: { kind: 'adr005'; value: { type: string; vusers: number; ramp: number } } | null;
  proportions: {
    source: 'single_scenario' | 'composition_links';
    weights: { scenario_id: string; variant_label: string; proportion: number }[];
  };
  target_base_url: string;
  target_environment_id: string;
  target_environment_name: string;
  members: {
    scenario_id: string;
    variant_label: string;
    scenario_version: number;
    artifact_digest_at_run: string;
  }[];
  feeders: SklepFeederManifestEntry[];
}

export type SklepAssertionOutcome = {
  subject: { scope: 'run'; path: string[] };
  metric: { kind: string; requests: string | null; stat: string | null; percentile: number | null };
  unit: string;
  condition: string;
  threshold: number[];
  inclusive: boolean;
  actual: number;
  passed: boolean;
  samples: number;
  reason: null;
  subject_label: string;
  target_label: string;
  condition_label: string;
  threshold_label: string;
  message: string;
};

/** `SlaVerdictV1.to_json` (`domain/services/gatling/sla_verdict.py:89-115`). */
export interface SklepSlaVerdict {
  format_version: 1;
  source: 'loadcraft-exact';
  status: 'passed' | 'failed';
  reason: null;
  detail: null;
  shards: string[];
  window_s: number;
  semantics: Record<string, string>;
  assertions: SklepAssertionOutcome[];
  gatling_exit_code: number;
  gatling_status: 'passed' | 'failed';
  gatling_disagrees: boolean;
  warnings: unknown[];
}

/**
 * A run row: the union of the execution list row (`list_executions`, `gatling.py:12486`) and the
 * detail document (`get_execution`, `gatling.py:13296`). A self-check is a run with one
 * `scenario_id`; a composition run has `composite_id`.
 */
export interface SklepExecution {
  id: string;
  scenario_id: string | null;
  composite_id: string | null;
  configuration_id: string | null;
  status: 'completed';
  supervised: boolean;
  started_at: string;
  completed_at: string;
  duration_seconds: number;
  load_window_state: 'measured';
  run_exit_code: number;
  sla_verdict: SklepSlaVerdict | null;
  invariant_summary: null;
  error_message: null;
  logs: null;
  has_result: boolean;
  result_has_errors: boolean;
  total_requests: number;
  ok_count: number;
  ko_count: number;
  created_at: string;
  source: 'self_check' | 'manual' | 'saved_run' | 'scheduled' | null;
  saved_run_id: string | null;
  saved_run_name: string | null;
  warnings: string[];
  run_manifest_state: 'captured';
  run_manifest: SklepRunManifest;
}

export type SklepPerRequest = {
  request_name: string;
  total_requests: number;
  ok_requests: number;
  ko_requests: number;
  /** Fraction, as the backend sends it. */
  error_rate: number;
  p50_histogram: number;
  p95_histogram: number;
  p99_histogram: number;
};

/** `EndpointRow` of `get_endpoints_summary` (`prometheus_query.py:994-1035`), without `time_series`. */
export type SklepEndpointRow = {
  name: string;
  group: string;
  count: number;
  ok_count: number;
  ko_count: number;
  mean_response_time: number;
  min_response_time: number;
  max_response_time: number;
  min_source: 'bucket-estimate';
  max_source: 'bucket-estimate';
  p50_histogram: number;
  p75_histogram: number;
  p90_histogram: number;
  p95_histogram: number;
  p99_histogram: number;
  rps: number;
  error_count: number;
  error_rate: number;
  http_status_counts: Record<string, number>;
};

/** An error group from Prometheus (`prometheus_query.py:800-842`). */
export type SklepErrorGroup = {
  error_hash: string;
  message: string;
  http_status: number;
  ko_limb: 'http_status';
  source: 'gatling-log';
  in_ko_count: true;
  count: number;
  percentage: number;
  affected_endpoints: string[];
  first_seen: string;
  last_seen: string;
};

export type SklepTimePoint = {
  elapsed_seconds: number;
  requests_per_second: number;
  ok_per_second: number;
  ko_per_second: number;
  mean_response_time: number;
  p50_histogram: number;
  p95_histogram: number;
  p99_histogram: number;
  max_response_time: number;
};

/**
 * The `…/result` document of a finished run, `aggregates_source: persisted`
 * (`gatling_results.py:741-751`, `executor.py:1127-1150`, `prometheus_query.py`).
 * `id` is the execution id: the document is keyed by its run.
 */
export interface SklepExecutionResult {
  id: string;
  aggregates_source: 'persisted';
  total_requests: number;
  ok_requests: number;
  ko_requests: number;
  ok_count: number;
  ko_count: number;
  /** Fraction (`ko / total`), not a percentage. */
  error_rate: number;
  mean_response_time: number;
  min_response_time: number;
  max_response_time: number;
  min_source: 'gatling-report';
  max_source: 'gatling-report';
  p50: number;
  p75: number;
  p90: number | null;
  p95: number;
  p99: number;
  percentile_source: 'gatling-report';
  /** Most virtual-user sessions in flight at once; null when none was stored; absent on a backend without the capability. */
  peak_active_users?: number | null;
  requests_per_second: number;
  throughput: number;
  duration_seconds: number;
  error_summary: { message: string; count: number }[];
  series_source: 'prometheus';
  series_retention: null;
  p50_histogram: number;
  p75_histogram: number;
  p90_histogram: number;
  p95_histogram: number;
  p99_histogram: number;
  per_request: SklepPerRequest[];
  endpoints: SklepEndpointRow[];
  errors: SklepErrorGroup[];
  error_traces: Record<string, unknown>[];
  time_series_data: SklepTimePoint[];
}

export type SklepAnalysisDocument = {
  verdict: 'pass' | 'partial' | 'fail';
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  error_analyses: {
    error_hash: string;
    http_status: number;
    probable_cause: string;
    confidence: 'high' | 'medium' | 'low';
    evidence: string[];
    evidence_sources: string[];
    suggested_fixes: string[];
  }[];
  performance_concerns: {
    endpoint: string;
    metric: string;
    observed: number;
    summary: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    window_start_offset: string;
    window_end_offset: string;
    before_ms: number;
    after_ms: number | null;
  }[];
  step_hypotheses: {
    kind: 'isolated' | 'shared';
    endpoints: string[];
    hypothesis: string;
    checks: string[];
  }[];
  recommendations: string[];
  grounding_dropped: Record<string, number>;
  latency_steps:
    | {
        endpoint: string;
        window_start: string;
        window_end: string;
        window_start_offset: string;
        window_end_offset: string;
        before_ms: number;
        during_ms: number;
        after_ms: number | null;
        ratio: number;
        buckets: number;
      }[]
    | null;
  latency_steps_reason: string | null;
  latency_step_pattern: unknown[];
  /** Present because the project has a telemetry source (`mcp_evidence.collect_external_evidence`). */
  external_evidence: {
    source: { kind: string; label: string; url: string };
    window: { start: string; end: string } | null;
    calls: Record<string, unknown>[];
    skipped: { tool: string; reason: string }[];
    error: string | null;
  };
};

/** The `…/analysis` document: the stored analysis with its bookkeeping. */
export interface SklepExecutionAnalysis {
  id: string;
  execution_id: string;
  verdict: 'pass' | 'partial' | 'fail';
  summary: string;
  analysis: SklepAnalysisDocument;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
  initiated_by: string;
  generated_at: string;
}

export interface SeedSklepOptions {
  stage: SklepStage;
}

/**
 * Fills `store` with the world as it is after `stage`. Seed an empty store once: records already
 * in the store make the insert throw, as for any collection.
 */
export function seedSklep(store: Store, options: SeedSklepOptions): void {
  const reached = (target: SklepStage): boolean =>
    SKLEP_STAGES.indexOf(options.stage) >= SKLEP_STAGES.indexOf(target);
  if (!reached('project')) return;

  const endpoints = buildEndpoints();
  seedProject(store, endpoints);
  if (!reached('flows')) return;

  const flows = buildFlows(endpoints);
  const flowCollection = store.collection<FlowDetail>(SKLEP_COLLECTIONS.flows);
  for (const flow of flows) flowCollection.insert(flow);
  if (!reached('scenario')) return;

  seedScenarios(store, flows, reached('data'));
  if (!reached('executed')) return;

  seedExecuted(store, endpoints);
}

// ---- constants ----------------------------------------------------------------------------

const PROJECT = SKLEP_IDS.project;
const GATLING_PROJECT = SKLEP_WORLD_IDS.gatlingProject;
const USER = 'user@example.com';
const PERF_API = 'https://api.perf.example.com';

const CREATED_PROJECT = '2026-11-22T10:00:00Z';
const CREATED_FLOWS = '2026-11-22T10:05:00Z';
const CREATED_SCENARIOS = '2026-11-22T10:10:00Z';
const CREATED_DATA = '2026-11-22T10:18:00Z';
const RUN = { start: '2026-11-22T10:30:00Z', end: '2026-11-22T10:40:18Z' };

const TOTAL_REQUESTS = 412_300;
const FAILED_REQUESTS = 2480;

/** Stable fake digest of a label (the backend stores SHA-256 hex digests). */
function digest(label: string): string {
  return createHash('sha256').update(label).digest('hex');
}

// ---- project, environments, spec, operations ----------------------------------------------

type Area = 'auth' | 'catalog' | 'cart' | 'orders' | 'account' | 'payments';

interface OperationRow {
  area: Area;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  operationId: string;
  summary: string;
  body?: boolean;
  query?: number;
  paginated?: boolean;
}

const CRUD: Record<OperationRow['method'], string> = {
  GET: 'read',
  POST: 'create',
  PUT: 'update',
  DELETE: 'delete',
};

/** 42 operations in 6 areas: 18 GET and 24 other methods. */
const OPERATIONS: readonly OperationRow[] = [
  {
    area: 'auth',
    method: 'POST',
    path: '/auth/login',
    operationId: 'login',
    summary: 'Log in and get a token',
    body: true,
  },
  {
    area: 'auth',
    method: 'POST',
    path: '/auth/register',
    operationId: 'register',
    summary: 'Register an account',
    body: true,
  },
  { area: 'auth', method: 'POST', path: '/auth/logout', operationId: 'logout', summary: 'Log out' },
  {
    area: 'auth',
    method: 'POST',
    path: '/auth/refresh',
    operationId: 'refresh_token',
    summary: 'Refresh the token',
    body: true,
  },
  {
    area: 'auth',
    method: 'POST',
    path: '/auth/password/reset',
    operationId: 'reset_password',
    summary: 'Request a password reset',
    body: true,
  },
  { area: 'auth', method: 'GET', path: '/auth/me', operationId: 'get_me', summary: 'Current user' },
  {
    area: 'catalog',
    method: 'GET',
    path: '/categories',
    operationId: 'list_categories',
    summary: 'List categories',
    paginated: true,
  },
  {
    area: 'catalog',
    method: 'GET',
    path: '/categories/{categoryId}',
    operationId: 'get_category',
    summary: 'Get a category',
  },
  {
    area: 'catalog',
    method: 'GET',
    path: '/products',
    operationId: 'search_products',
    summary: 'Search products',
    query: 3,
    paginated: true,
  },
  {
    area: 'catalog',
    method: 'GET',
    path: '/products/{productId}',
    operationId: 'get_product',
    summary: 'Get a product',
  },
  {
    area: 'catalog',
    method: 'GET',
    path: '/products/{productId}/reviews',
    operationId: 'list_reviews',
    summary: 'List reviews of a product',
    paginated: true,
  },
  {
    area: 'catalog',
    method: 'POST',
    path: '/products/{productId}/reviews',
    operationId: 'add_review',
    summary: 'Add a review',
    body: true,
  },
  {
    area: 'catalog',
    method: 'GET',
    path: '/products/{productId}/availability',
    operationId: 'get_availability',
    summary: 'Stock of a product',
  },
  {
    area: 'catalog',
    method: 'POST',
    path: '/products/{productId}/wishlist',
    operationId: 'add_to_wishlist',
    summary: 'Add to the wishlist',
  },
  {
    area: 'catalog',
    method: 'GET',
    path: '/brands',
    operationId: 'list_brands',
    summary: 'List brands',
  },
  { area: 'cart', method: 'GET', path: '/cart', operationId: 'get_cart', summary: 'Get the cart' },
  {
    area: 'cart',
    method: 'POST',
    path: '/cart/items',
    operationId: 'add_cart_item',
    summary: 'Add an item to the cart',
    body: true,
  },
  {
    area: 'cart',
    method: 'PUT',
    path: '/cart/items/{itemId}',
    operationId: 'update_cart_item',
    summary: 'Change the quantity of an item',
    body: true,
  },
  {
    area: 'cart',
    method: 'DELETE',
    path: '/cart/items/{itemId}',
    operationId: 'remove_cart_item',
    summary: 'Remove an item from the cart',
  },
  {
    area: 'cart',
    method: 'DELETE',
    path: '/cart',
    operationId: 'clear_cart',
    summary: 'Empty the cart',
  },
  {
    area: 'cart',
    method: 'POST',
    path: '/cart/coupon',
    operationId: 'apply_coupon',
    summary: 'Apply a coupon code',
    body: true,
  },
  {
    area: 'cart',
    method: 'GET',
    path: '/cart/shipping-options',
    operationId: 'list_shipping_options',
    summary: 'Shipping options of the cart',
  },
  {
    area: 'orders',
    method: 'POST',
    path: '/checkout',
    operationId: 'checkout',
    summary: 'Place an order',
    body: true,
  },
  {
    area: 'orders',
    method: 'GET',
    path: '/orders',
    operationId: 'list_orders',
    summary: 'List my orders',
    paginated: true,
  },
  {
    area: 'orders',
    method: 'GET',
    path: '/orders/{orderId}',
    operationId: 'get_order',
    summary: 'Get an order',
  },
  {
    area: 'orders',
    method: 'GET',
    path: '/orders/{orderId}/status',
    operationId: 'get_order_status',
    summary: 'Poll the status of an order',
  },
  {
    area: 'orders',
    method: 'POST',
    path: '/orders/{orderId}/cancel',
    operationId: 'cancel_order',
    summary: 'Cancel an order',
  },
  {
    area: 'orders',
    method: 'GET',
    path: '/orders/{orderId}/tracking',
    operationId: 'get_tracking',
    summary: 'Tracking of a shipment',
  },
  {
    area: 'orders',
    method: 'POST',
    path: '/orders/{orderId}/returns',
    operationId: 'create_return',
    summary: 'Start a return',
    body: true,
  },
  {
    area: 'orders',
    method: 'POST',
    path: '/orders/{orderId}/reorder',
    operationId: 'reorder',
    summary: 'Order the same items again',
  },
  {
    area: 'orders',
    method: 'PUT',
    path: '/orders/{orderId}/shipping-address',
    operationId: 'update_shipping_address',
    summary: 'Change the shipping address',
    body: true,
  },
  {
    area: 'account',
    method: 'GET',
    path: '/account',
    operationId: 'get_account',
    summary: 'Get my account',
  },
  {
    area: 'account',
    method: 'PUT',
    path: '/account',
    operationId: 'update_account',
    summary: 'Update my account',
    body: true,
  },
  {
    area: 'account',
    method: 'GET',
    path: '/account/addresses',
    operationId: 'list_addresses',
    summary: 'List my addresses',
  },
  {
    area: 'account',
    method: 'POST',
    path: '/account/addresses',
    operationId: 'add_address',
    summary: 'Add an address',
    body: true,
  },
  {
    area: 'account',
    method: 'PUT',
    path: '/account/addresses/{addressId}',
    operationId: 'update_address',
    summary: 'Update an address',
    body: true,
  },
  {
    area: 'account',
    method: 'DELETE',
    path: '/account/addresses/{addressId}',
    operationId: 'delete_address',
    summary: 'Delete an address',
  },
  {
    area: 'account',
    method: 'GET',
    path: '/account/payment-methods',
    operationId: 'list_payment_methods',
    summary: 'List my payment methods',
  },
  {
    area: 'account',
    method: 'POST',
    path: '/account/payment-methods',
    operationId: 'add_payment_method',
    summary: 'Add a payment method',
    body: true,
  },
  {
    area: 'payments',
    method: 'POST',
    path: '/payments/authorize',
    operationId: 'authorize_payment',
    summary: 'Authorize a payment',
    body: true,
  },
  {
    area: 'payments',
    method: 'GET',
    path: '/payments/{paymentId}',
    operationId: 'get_payment',
    summary: 'Get a payment',
  },
  {
    area: 'payments',
    method: 'POST',
    path: '/payments/{paymentId}/refund',
    operationId: 'refund_payment',
    summary: 'Refund a payment',
    body: true,
  },
];

function buildEndpoints(): SklepEndpoint[] {
  // Own id source: the ids of the operations do not depend on the store's seed.
  const newId = createIdSource(0x5c1e9);
  return OPERATIONS.map((row) => ({
    id: newId(),
    spec_id: SKLEP_WORLD_IDS.spec,
    path: row.path,
    method: row.method,
    operation_id: row.operationId,
    summary: row.summary,
    tags: [row.area],
    is_crud: true,
    crud_operation: CRUD[row.method] ?? null,
    is_paginated: row.paginated ?? false,
    async_pattern: 'none',
    parameters_count: (row.path.match(/\{/g)?.length ?? 0) + (row.query ?? 0),
    has_request_body: row.body ?? false,
  }));
}

function endpointId(endpoints: readonly SklepEndpoint[], method: string, path: string): string {
  const found = endpoints.find((e) => e.method === method && e.path === path);
  if (found === undefined) throw new Error(`sklep world: no operation ${method} ${path}`);
  return found.id;
}

function environment(
  name: string,
  id: string,
  api: string,
  frontend: string,
  extra: Partial<EnvironmentResponse>,
): EnvironmentResponse {
  return {
    id,
    project_id: PROJECT,
    name,
    description: null,
    base_url: api,
    frontend_url: frontend,
    default_headers: {},
    auth_type: 'none',
    auth_config: {},
    variables: {},
    is_active: true,
    is_default: false,
    protected: false,
    workload_caps: null,
    parent_environment_id: null,
    proxy_url: null,
    last_conformance: null,
    last_probe: { ok: true, api: true, frontend: true, checked_at: CREATED_PROJECT },
    ...extra,
  };
}

function seedProject(store: Store, endpoints: readonly SklepEndpoint[]): void {
  const project: ProjectDetail = {
    id: PROJECT,
    name: 'sklep',
    description: 'Sklep API',
    project_type: 'api',
    base_url: PERF_API,
    openapi_spec_id: SKLEP_WORLD_IDS.spec,
    default_headers: {},
    auth_config: {
      type: 'bearer',
      login: { method: 'POST', path: '/auth/login' },
      token: '$.token',
    },
    variables: {},
    is_active: true,
    created_at: CREATED_PROJECT,
    updated_at: CREATED_PROJECT,
    created_by: USER,
  };
  store.collection<ProjectDetail>(SKLEP_COLLECTIONS.projects).insert(project);

  const spec: OpenAPISpecSummary = {
    id: SKLEP_WORLD_IDS.spec,
    title: 'Sklep API',
    version: '2.14.0',
    description: 'Documentation of the shop API',
    created_at: CREATED_PROJECT,
    endpoints_count: endpoints.length,
    is_active: true,
    is_current: true,
    source_url: null,
  };
  store.collection<OpenAPISpecSummary>(SKLEP_COLLECTIONS.specs).insert(spec);

  const endpointCollection = store.collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints);
  for (const endpoint of endpoints) endpointCollection.insert(endpoint);

  const ids = SKLEP_WORLD_IDS.environments;
  const environments = store.collection<EnvironmentResponse>(SKLEP_COLLECTIONS.environments);
  environments.insert(
    environment('perf', ids.perf, PERF_API, 'https://perf.example.com', {
      is_default: true,
      last_conformance: { checked_get: 18, ok: 18, unchecked: 24, checked_at: CREATED_PROJECT },
    }),
  );
  environments.insert(
    environment('qa', ids.qa, 'https://api.qa.example.com', 'https://qa.example.com', {
      protected: true,
      workload_caps: { max_vu: 100, max_rps: 20 },
    }),
  );
  environments.insert(
    environment('dev', ids.dev, 'https://api.dev.example.com', 'https://dev.example.com', {}),
  );
  environments.insert(
    environment('prod', ids.prod, 'https://api.example.com', 'https://example.com', {
      protected: true,
      workload_caps: { max_vu: 20, max_rps: 5 },
    }),
  );

  const telemetry: SklepTelemetrySource = {
    id: PROJECT,
    kind: 'mcp',
    label: 'sklep-logs',
    url: 'https://logs-mcp.perf.example.com/mcp',
    enabled_tools: ['logs_summary', 'container_events'],
  };
  store.collection<SklepTelemetrySource>(SKLEP_COLLECTIONS.telemetry).insert(telemetry);
  seedValidatorsAndTestTypes(store);
}

// ---- flows --------------------------------------------------------------------------------

type Block = FlowDetail['blocks'][number];

interface RequestStep {
  kind: 'request';
  name: string;
  method: string;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  expectedStatuses?: number[];
  /** Variable name → JSONPath of the response. */
  saves?: Record<string, string>;
  authorized?: boolean;
  actionClass?: 'page' | 'form_submit' | 'in_page' | 'api_call';
}

interface PauseStep {
  kind: 'pause';
  minMs: number;
  maxMs: number;
}

/**
 * What the backend writes on a pause it adds before an API call (flow_generation/service.py:592):
 * a fixed English sentence, never the person's activity.
 */
const PAUSE_DESCRIPTION = 'Assumed default think time before an API call (not measured)';

type Step = RequestStep | PauseStep;

function buildBlocks(
  flowKey: string,
  steps: readonly Step[],
  endpoints: readonly SklepEndpoint[],
): Block[] {
  return steps.map((step, index): Block => {
    const id = `${flowKey}-${String(index + 1)}`;
    if (step.kind === 'pause') {
      return {
        id,
        type: 'pause',
        name: 'Pause',
        description: PAUSE_DESCRIPTION,
        enabled: true,
        config: {
          delay_min_ms: step.minMs,
          delay_max_ms: step.maxMs,
          distribution: 'uniform',
          source: 'default_human',
        },
      };
    }
    return {
      id,
      type: 'request',
      name: step.name,
      description: '',
      enabled: true,
      config: {
        endpoint_id: endpointId(endpoints, step.method, step.path),
        method: step.method,
        path: step.path,
        headers: step.authorized === true ? { Authorization: 'Bearer #{token}' } : {},
        query_params: step.query ?? {},
        path_params: {},
        body: step.body ?? null,
        expected_statuses: step.expectedStatuses ?? null,
        request_checks: Object.entries(step.saves ?? {}).map(([saveAs, selector]) => ({
          check_type: 'json_path',
          selector,
          save_as: saveAs,
        })),
        response_checks: [],
        save_variables: {},
        ...(step.actionClass === undefined ? {} : { action_start: { class: step.actionClass } }),
      },
    };
  });
}

function buildFlow(
  id: string,
  key: string,
  name: string,
  description: string,
  steps: readonly Step[],
  endpoints: readonly SklepEndpoint[],
): FlowDetail {
  const blocks = buildBlocks(key, steps, endpoints);
  const ids = blocks.map((block) => String(block['id']));
  return {
    id,
    project_id: PROJECT,
    name,
    description,
    flow_type: 'api',
    blocks,
    edges: ids.slice(0, -1).map((source, index) => ({
      id: `${key}-edge-${String(index + 1)}`,
      source,
      target: ids[index + 1],
    })),
    entry_block_id: ids[0] ?? null,
    variables: {},
    timeout_ms: 30_000,
    retry_count: 0,
    retry_delay_ms: 1000,
    generated_by: 'ai',
    generated_on_environment_id: SKLEP_WORLD_IDS.environments.perf,
    generation_target_url: PERF_API,
    generation_description: description,
    openapi_spec_id: SKLEP_WORLD_IDS.spec,
    source_endpoints: blocks
      .filter((block) => block['type'] === 'request')
      .map((block) => {
        const config = block['config'] as { method: string; path: string };
        return `${config.method}:${config.path}`;
      }),
    source_operations: [],
    tags: [],
    is_active: true,
    can_regenerate: true,
    current_version: 1,
    created_at: CREATED_FLOWS,
    updated_at: CREATED_FLOWS,
    created_by: USER,
  };
}

function buildFlows(endpoints: readonly SklepEndpoint[]): FlowDetail[] {
  const zakupy: Step[] = [
    {
      kind: 'request',
      name: 'Log in',
      method: 'POST',
      path: '/auth/login',
      body: { email: '#{email}', password: '#{password}' },
      saves: { token: '$.token' },
    },
    { kind: 'pause', minMs: 3000, maxMs: 8000 },
    {
      kind: 'request',
      name: 'Search products',
      method: 'GET',
      path: '/products',
      query: { q: '#{q}' },
      saves: { productId: '$.items[0].id' },
      authorized: true,
      actionClass: 'form_submit',
    },
    { kind: 'pause', minMs: 10_000, maxMs: 30_000 },
    {
      kind: 'request',
      name: 'Add to cart',
      method: 'POST',
      path: '/cart/items',
      body: { productId: '#{productId}', quantity: '#{quantity}' },
      saves: { cartId: '$.cartId' },
      authorized: true,
      actionClass: 'in_page',
    },
    { kind: 'pause', minMs: 20_000, maxMs: 45_000 },
    {
      kind: 'request',
      name: 'Check out',
      method: 'POST',
      path: '/checkout',
      body: { cartId: '#{cartId}', paymentMethod: 'card', cardNumber: '#{cardNumber}' },
      expectedStatuses: [201, 409],
      authorized: true,
      actionClass: 'form_submit',
    },
  ];
  const przegladanie: Step[] = [
    {
      kind: 'request',
      name: 'List categories',
      method: 'GET',
      path: '/categories',
      saves: { categoryId: '$.items[0].id' },
    },
    { kind: 'pause', minMs: 4000, maxMs: 12_000 },
    {
      kind: 'request',
      name: 'List products of a category',
      method: 'GET',
      path: '/products',
      query: { categoryId: '#{categoryId}' },
      actionClass: 'page',
    },
  ];
  const konto: Step[] = [
    {
      kind: 'request',
      name: 'Log in',
      method: 'POST',
      path: '/auth/login',
      body: { email: '#{email}', password: '#{password}' },
      saves: { token: '$.token' },
    },
    { kind: 'pause', minMs: 4000, maxMs: 12_000 },
    {
      kind: 'request',
      name: 'List my orders',
      method: 'GET',
      path: '/orders',
      authorized: true,
      actionClass: 'page',
    },
  ];
  return [
    buildFlow(
      SKLEP_IDS.flowZakupy,
      'zakupy',
      'zakupy',
      'Klient loguje się, szuka produktu, dodaje go do koszyka i składa zamówienie.',
      zakupy,
      endpoints,
    ),
    buildFlow(
      SKLEP_WORLD_IDS.flowPrzegladanie,
      'przegladanie',
      'przeglądanie',
      'Klient przegląda kategorie i produkty.',
      przegladanie,
      endpoints,
    ),
    buildFlow(
      SKLEP_WORLD_IDS.flowKonto,
      'konto',
      'konto',
      'Klient loguje się i sprawdza swoje zamówienia.',
      konto,
      endpoints,
    ),
  ];
}

// ---- validators and test types of the project ---------------------------------------------

function seedValidatorsAndTestTypes(store: Store): void {
  const newId = createIdSource(0x7e57);
  const validators = store.collection<ValidatorResponse>(SKLEP_COLLECTIONS.validators);
  const validatorRows: [string, string, string, number][] = [
    ['status_code', 'Status code', 'http', 1],
    ['response_time', 'Response time', 'performance', 2],
    ['json_schema', 'JSON schema', 'structure', 3],
    ['body_contains', 'Body contains', 'content', 4],
    ['header_present', 'Header present', 'http', 5],
  ];
  for (const [name, display, category, priority] of validatorRows) {
    validators.insert({
      id: newId(),
      project_id: PROJECT,
      default_params: {},
      is_enabled: true,
      priority,
      effective_name: name,
      effective_display_name: display,
      effective_validator_type: 'assertion',
      effective_category: category,
      evaluated_after_run: false,
    });
  }

  const testTypes = store.collection<TestTypeResponse>(SKLEP_COLLECTIONS.testTypes);
  // The first two are the project's own names for the base types `negative_testing` and
  // `edge_cases`, which is how a type's effective name differs from the base one.
  const testTypeRows: [string, string, string, number, string | null][] = [
    ['invalid_input', 'Invalid input', 'negative', 1, 'negative_testing'],
    ['boundary_values', 'Boundary values', 'edge', 2, 'edge_cases'],
    ['missing_required_fields', 'Missing required fields', 'negative', 3, null],
  ];
  for (const [name, display, category, priority, base] of testTypeRows) {
    testTypes.insert({
      id: newId(),
      project_id: PROJECT,
      default_count: 3,
      is_enabled: true,
      priority,
      base_type_name: base,
      effective_name: name,
      effective_display_name: display,
      effective_category: category,
    });
  }
}

// ---- scenarios, composition, data ---------------------------------------------------------

const SLOT_SEARCH = 'search_phrases';
const SLOT_ORDER = 'order_details';
const SLOT_ACCOUNTS = 'accounts';

type SlotSeed = Omit<SklepSlot, 'generated' | 'generated_rows'>;

const SLOTS: Record<string, SlotSeed> = {
  [SLOT_SEARCH]: {
    slot: SLOT_SEARCH,
    label: 'Search terms',
    columns: ['q'],
    strategy: 'random',
    column_specs: [{ name: 'q', type: 'search_term', example: 'koszula' }],
    identity_kind: null,
    default_file: 'search_phrases.csv',
    role: 'data',
  },
  [SLOT_ORDER]: {
    slot: SLOT_ORDER,
    label: 'Quantity & cardnumber',
    columns: ['quantity', 'cardNumber'],
    strategy: 'random',
    column_specs: [
      { name: 'quantity', type: 'integer', example: '2', minimum: 1, maximum: 5 },
      { name: 'cardNumber', type: 'card_number', card_networks: ['visa', 'mastercard'] },
    ],
    identity_kind: null,
    default_file: 'order_details.csv',
    role: 'data',
  },
  [SLOT_ACCOUNTS]: {
    slot: SLOT_ACCOUNTS,
    label: 'User accounts',
    columns: ['email', 'password'],
    strategy: 'queue',
    column_specs: [
      { name: 'email', type: 'email', example: 'user-1@example.com' },
      { name: 'password', type: 'password' },
    ],
    identity_kind: 'existing',
    default_file: 'accounts.csv',
    role: 'auth',
  },
};

/** Rows the generation shipped inside the artifact for the slots of plain data (`generated`). */
const GENERATED_ROWS: Record<string, number> = { [SLOT_SEARCH]: 500, [SLOT_ORDER]: 2000 };

function slot(key: string): SklepSlot {
  const found = SLOTS[key];
  if (found === undefined) throw new Error(`sklep world: no slot ${key}`);
  // `generated` is true where the rows ride in the artifact (`_bundle_satisfied_slot_rows`,
  // api/routes/gatling.py:4068-4089): the slots of plain data of this world; the accounts never.
  const rows = GENERATED_ROWS[key];
  return {
    ...found,
    columns: [...found.columns],
    column_specs: found.column_specs.map((spec) => ({ ...spec })),
    generated: rows !== undefined,
    generated_rows: rows ?? null,
  };
}

/** One request of a scenario's self-check: label of the chain step, `METHOD path`, its time. */
interface ChainStep {
  step: string;
  request: string;
  ms: number;
}

interface ScenarioSpec {
  id: string;
  name: string;
  flowId: string;
  className: string;
  slots: string[];
  /** Variables the scenario needs from data and the ones it exports. */
  inputs: string[];
  exports: string[];
  /** Mean length of one session: pause range (ms) → mean, in the flow. */
  pauseMeanMs: number[];
  chain: ChainStep[];
  selfCheckId: string;
}

const SCENARIO_SPECS: readonly ScenarioSpec[] = [
  {
    id: SKLEP_WORLD_IDS.scenarios.przegladanie,
    name: 'przeglądanie',
    flowId: SKLEP_WORLD_IDS.flowPrzegladanie,
    className: 'PrzegladanieSimulation',
    slots: [],
    inputs: [],
    exports: ['categoryId'],
    pauseMeanMs: [8000],
    chain: [
      { step: 'kategorie', request: 'GET /categories', ms: 100 },
      { step: 'produkt', request: 'GET /products', ms: 200 },
    ],
    selfCheckId: SKLEP_IDS.selfCheckExecution,
  },
  {
    id: SKLEP_WORLD_IDS.scenarios.zakupy,
    name: 'zakupy',
    flowId: SKLEP_IDS.flowZakupy,
    className: 'ZakupySimulation',
    slots: [SLOT_SEARCH, SLOT_ORDER, SLOT_ACCOUNTS],
    inputs: ['email', 'password', 'q', 'quantity', 'cardNumber'],
    exports: ['token', 'productId', 'cartId'],
    pauseMeanMs: [5500, 20_000, 32_500],
    chain: [
      { step: 'logowanie', request: 'POST /auth/login', ms: 200 },
      { step: 'wyszukanie', request: 'GET /products', ms: 300 },
      { step: 'koszyk', request: 'POST /cart/items', ms: 300 },
      { step: 'zamówienie', request: 'POST /checkout', ms: 400 },
    ],
    selfCheckId: SKLEP_WORLD_IDS.selfCheckZakupy,
  },
  {
    id: SKLEP_WORLD_IDS.scenarios.konto,
    name: 'konto',
    flowId: SKLEP_WORLD_IDS.flowKonto,
    className: 'KontoSimulation',
    slots: [SLOT_ACCOUNTS],
    inputs: ['email', 'password'],
    exports: ['token'],
    pauseMeanMs: [8000],
    chain: [
      { step: 'logowanie', request: 'POST /auth/login', ms: 200 },
      { step: 'zamówienia', request: 'GET /orders', ms: 200 },
    ],
    selfCheckId: SKLEP_WORLD_IDS.selfCheckKonto,
  },
];

const FEEDER_IDS: Record<string, string> = {
  [SLOT_SEARCH]: SKLEP_WORLD_IDS.feeders.frazy,
  [SLOT_ORDER]: SKLEP_WORLD_IDS.feeders.zamowienia,
  [SLOT_ACCOUNTS]: SKLEP_WORLD_IDS.feeders.konta,
};

const NEEDS_ACCOUNTS = (spec: ScenarioSpec): boolean => spec.slots.includes(SLOT_ACCOUNTS);
const chainMs = (spec: ScenarioSpec): number => spec.chain.reduce((sum, s) => sum + s.ms, 0);

/** Window of the self-check of a scenario: przeglądanie runs with the scenarios, the rest after the data. */
function selfCheckWindow(spec: ScenarioSpec): { start: string; end: string } {
  if (!NEEDS_ACCOUNTS(spec)) return { start: '2026-11-22T10:12:00Z', end: '2026-11-22T10:12:02Z' };
  return spec.name === 'zakupy'
    ? { start: '2026-11-22T10:20:00Z', end: '2026-11-22T10:20:03Z' }
    : { start: '2026-11-22T10:21:00Z', end: '2026-11-22T10:21:02Z' };
}

/** A step of the chain as a step of a run: named as the mock-up names it, method and path split, answered 200. */
function chainStepOf(step: ChainStep, index: number): SklepSelfCheckStep {
  const [method = null, path = null] = step.request.split(' ');
  return {
    name: step.step,
    group: null,
    plan_index: index,
    is_preflight: false,
    method,
    path,
    result: 'ok',
    http_status: 200,
    reason: null,
  };
}

function selfCheckState(spec: ScenarioSpec, withData: boolean): SklepSelfCheck {
  if (NEEDS_ACCOUNTS(spec) && !withData) {
    return {
      status: 'waiting_for_data',
      scenario_version: 1,
      execution_ids: [],
      failure: null,
      notes: [],
      missing_slots: [SLOT_ACCOUNTS],
      repairs: [],
      max_repair_rounds: 2,
      runs: [],
      started_at: null,
      finished_at: null,
    };
  }
  const window = selfCheckWindow(spec);
  return {
    status: 'passed',
    scenario_version: 1,
    execution_ids: [spec.selfCheckId],
    failure: null,
    notes: [],
    missing_slots: [],
    repairs: [],
    max_repair_rounds: 2,
    runs: [
      {
        execution_id: spec.selfCheckId,
        scenario_version: 1,
        status: 'passed',
        steps: spec.chain.map((step, index) => chainStepOf(step, index)),
        steps_omitted: 0,
      },
    ],
    started_at: window.start,
    finished_at: window.end,
  };
}

function buildScenario(spec: ScenarioSpec, flow: FlowDetail, withData: boolean): SklepScenario {
  const bound = withData && spec.slots.length > 0;
  const state = selfCheckState(spec, withData);
  const slotPct = (slotKey: string): Record<string, unknown> => ({
    feeder_type: 'csv',
    file: SLOTS[slotKey]?.default_file ?? '',
    strategy: SLOTS[slotKey]?.strategy ?? '',
    columns: SLOTS[slotKey]?.columns ?? [],
  });
  const sessionMs = spec.pauseMeanMs.reduce((a, b) => a + b, 0) + chainMs(spec);
  const mix = (
    count: number,
    meanMs: number | null,
  ): { count: number; mean_ms: number | null } => ({
    count,
    mean_ms: meanMs,
  });
  return {
    id: spec.id,
    name: spec.name,
    description: flow.description ?? '',
    simulation_class_name: spec.className,
    source_flow_id: flow.id,
    source_flow_version: flow.current_version,
    truncate_after_block_id: null,
    flow_overlay_version: null,
    generator_state: 'current',
    current_version: 1,
    artifact_version: 1,
    scenario_artifact: {
      artifact_version: 1,
      feeders: spec.slots.map(slotPct),
      generation_metadata: {
        source_kind: 'flow',
        source_flow_id: flow.id,
        source_flow_version: flow.current_version,
        generator: 'single_scenario_pipeline',
        resolved_class_mix: { happy_path: 95, invalid_input: 4, boundary_values: 1 },
        self_check: state,
      },
    },
    feeder_slots: spec.slots.map(slot),
    sensitive_headers_missing_registration: [],
    auth_credentials_without_consumer: [],
    slot_bindings: bound
      ? Object.fromEntries(spec.slots.map((key) => [key, FEEDER_IDS[key] ?? '']))
      : {},
    slot_binding_states: bound
      ? spec.slots.map((key) => ({
          slot: key,
          feeder_id: FEEDER_IDS[key] ?? '',
          state: 'pinned' as const,
        }))
      : [],
    assertion_thresholds: null,
    project_assertion_thresholds: null,
    assertion_threshold_view: {
      effective_tier: 'default',
      declared_at: { scenario: false, project: false },
      thresholds: {},
      declared_not_consumed: [],
      in_artifact: null,
    },
    scenario_contract_v2: {
      required_inputs: spec.inputs,
      exports: spec.exports,
      locals: [],
      control_vars: [],
      session_vars: [],
    },
    self_check: state,
    session_seconds: sessionMs / 1000,
    session_seconds_kind: 'exact',
    requests_per_session: null,
    pause_source_mix: {
      recording: mix(0, null),
      default_human: mix(
        spec.pauseMeanMs.length,
        Math.round(spec.pauseMeanMs.reduce((a, b) => a + b, 0) / spec.pauseMeanMs.length),
      ),
      manual: mix(0, null),
      machine_wait: mix(0, null),
      unknown: mix(0, null),
    },
    is_active: true,
    tags: [],
    created_at: CREATED_SCENARIOS,
    updated_at: withData ? CREATED_DATA : CREATED_SCENARIOS,
  };
}

function buildComposition(scenarios: readonly SklepScenario[]): SklepComposition {
  const shares: Record<string, number> = { przeglądanie: 0.4, zakupy: 0.5, konto: 0.1 };
  const linkIds: Record<string, string> = {
    przeglądanie: SKLEP_WORLD_IDS.compositionLinks.przegladanie,
    zakupy: SKLEP_WORLD_IDS.compositionLinks.zakupy,
    konto: SKLEP_WORLD_IDS.compositionLinks.konto,
  };
  const links: SklepCompositionLink[] = scenarios.map((scenario, index) => {
    const artifactDigest = digest(`${scenario.id}:artifact`);
    return {
      link_id: linkIds[scenario.name] ?? '',
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      simulation_class_name: scenario.simulation_class_name,
      variant_label: '',
      proportion: shares[scenario.name] ?? 0,
      order_index: index,
      injection_override: null,
      load_profile: null,
      feeder_bindings: [],
      think_time_ms: null,
      enabled: true,
      contract: {
        inputs: scenario.scenario_contract_v2.required_inputs.map((name) => ({ name })),
        outputs: scenario.scenario_contract_v2.exports.map((name) => ({ name })),
        locals: [],
        control_vars: [],
        session_vars: [],
      },
      scenario_artifact: scenario.scenario_artifact,
      scenario_contract_v2: scenario.scenario_contract_v2,
      scenario_version: scenario.current_version,
      scenario_created_at: scenario.created_at,
      artifact_digest: artifactDigest,
      live_digest: artifactDigest,
      has_drift: false,
      drift_fields: [],
      pinned_version: scenario.current_version,
      current_version: scenario.current_version,
    };
  });
  return {
    id: SKLEP_WORLD_IDS.composition,
    name: 'checkout',
    description: 'Przeglądanie 40%, zakupy 50%, konto 10%',
    project_id: GATLING_PROJECT,
    injection_config: {},
    global_headers: null,
    global_think_time_ms: null,
    protocol_config: defaultProtocolConfig(),
    throttle_steps: [],
    pause_distribution: 'uniform',
    normal_pause_std_dev_percent: 20,
    status: 'ready',
    composition_mode: 'parallel',
    sequence_config: null,
    test_type_spec: null,
    assertion_inference: null,
    slot_bindings: {},
    slot_binding_states: [],
    created_at: CREATED_SCENARIOS,
    updated_at: CREATED_SCENARIOS,
    validation: {
      is_valid: true,
      authoring_valid: true,
      errors: [],
      warnings: [],
      error_details: [],
      warning_details: [],
      issue_details: [],
      scenario_count: links.length,
      total_proportion: links.reduce((sum, link) => sum + link.proportion, 0),
      last_validated_at: CREATED_SCENARIOS,
      validated_against_digest: digest('composition:validated'),
      effective_status: 'ready',
      has_drift: false,
      drifted_members: [],
      missing_bound_feeders: [],
    },
    scenarios: links,
  };
}

function seedScenarios(store: Store, flows: readonly FlowDetail[], withData: boolean): void {
  if (withData) seedFeeders(store);

  const scenarios: SklepScenario[] = SCENARIO_SPECS.map((spec) => {
    const flow = flows.find((f) => f.id === spec.flowId);
    if (flow === undefined) throw new Error(`sklep world: no flow for scenario ${spec.name}`);
    return buildScenario(spec, flow, withData);
  });
  const scenarioCollection = store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
  for (const scenario of scenarios) scenarioCollection.insert(scenario);
  store
    .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
    .insert(buildComposition(scenarios));

  // The self-check runs that exist: browsing at once, the login flows once accounts exist.
  const executions = store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
  const results = store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results);
  for (const spec of SCENARIO_SPECS) {
    if (NEEDS_ACCOUNTS(spec) && !withData) continue;
    const window = selfCheckWindow(spec);
    executions.insert(selfCheckExecution(spec, window, withData));
    results.insert(selfCheckResult(spec));
  }
}

// ---- datasets -----------------------------------------------------------------------------

interface FeederSeed {
  id: string;
  slot: string;
  name: string;
  records: number;
  generator: string;
  consumption: 'shared' | 'exclusive';
  semantics: Record<string, SklepColumnSemantic>;
  recipe: { column_name: string; generator: string }[];
  autoLinked: boolean;
}

const FEEDER_SEEDS: readonly FeederSeed[] = [
  {
    id: SKLEP_WORLD_IDS.feeders.frazy,
    slot: SLOT_SEARCH,
    name: 'frazy wyszukiwania',
    records: 500,
    generator: 'Samples a model wrote',
    consumption: 'shared',
    semantics: { q: 'synthetic' },
    recipe: [{ column_name: 'q', generator: 'Samples a model wrote' }],
    autoLinked: true,
  },
  {
    id: SKLEP_WORLD_IDS.feeders.zamowienia,
    slot: SLOT_ORDER,
    name: 'zamówienia',
    records: 2000,
    generator: 'Generators',
    consumption: 'shared',
    semantics: { quantity: 'synthetic', cardNumber: 'credential' },
    recipe: [
      { column_name: 'quantity', generator: 'Integer 1–5' },
      { column_name: 'cardNumber', generator: 'Card number (Visa, Mastercard)' },
    ],
    autoLinked: true,
  },
  {
    id: SKLEP_WORLD_IDS.feeders.konta,
    slot: SLOT_ACCOUNTS,
    name: 'konta',
    records: 2000,
    generator: 'POST /auth/register',
    consumption: 'exclusive',
    semantics: { email: 'identity', password: 'credential' },
    recipe: [],
    autoLinked: false,
  },
];

function seedFeeders(store: Store): void {
  const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
  for (const seed of FEEDER_SEEDS) {
    const slotSeed = SLOTS[seed.slot];
    if (slotSeed === undefined) throw new Error(`sklep world: no slot ${seed.slot}`);
    feeders.insert({
      id: seed.id,
      gatling_project_id: GATLING_PROJECT,
      name: seed.name,
      description: seed.generator,
      feeder_type: 'csv',
      strategy: slotSeed.strategy,
      file_name: slotSeed.default_file,
      content: null,
      record_count: seed.records,
      columns: [...slotSeed.columns],
      separator: ',',
      transform_expression: null,
      feed_records_count: null,
      feed_records_count_expression: null,
      dsl: null,
      jdbc_config: null,
      redis_config: null,
      feeder_options: null,
      consumption: seed.consumption,
      column_semantics: seed.semantics,
      has_recipe: seed.recipe.length > 0,
      recipe_summary: seed.recipe,
      content_hash: digest(`${seed.id}:content`),
      manually_edited: false,
      created_by: USER,
      auto_linked_scenario_id: seed.autoLinked ? SKLEP_WORLD_IDS.scenarios.zakupy : null,
      provenance: seed.autoLinked ? 'auto' : 'uploaded',
      audit_metadata: null,
      created_at: CREATED_DATA,
      updated_at: CREATED_DATA,
    });
  }
}

// ---- runs ---------------------------------------------------------------------------------

function feederManifest(
  slots: readonly string[],
  demand: Record<string, number>,
): SklepFeederManifestEntry[] {
  return slots.map((key) => {
    const id = FEEDER_IDS[key] ?? '';
    return {
      slot: key,
      source_kind: 'db_dataset',
      feeder_id: id,
      dataset_name: FEEDER_SEEDS.find((seed) => seed.id === id)?.name ?? '',
      content_hash: digest(`${id}:content`),
      resolution_state: 'pinned',
      resolution_state_unavailable: null,
      comparable: true,
      demand_values: demand[key] ?? 0,
      binding_source: 'persisted',
    };
  });
}

function member(spec: ScenarioSpec): SklepRunManifest['members'][number] {
  return {
    scenario_id: spec.id,
    variant_label: '',
    scenario_version: 1,
    artifact_digest_at_run: digest(`${spec.id}:artifact`),
  };
}

function selfCheckExecution(
  spec: ScenarioSpec,
  window: { start: string; end: string },
  withData: boolean,
): SklepExecution {
  const total = spec.chain.length;
  return {
    id: spec.selfCheckId,
    scenario_id: spec.id,
    composite_id: null,
    configuration_id: null,
    status: 'completed',
    supervised: false,
    started_at: window.start,
    completed_at: window.end,
    duration_seconds: chainMs(spec) / 1000,
    load_window_state: 'measured',
    run_exit_code: 0,
    sla_verdict: null,
    invariant_summary: null,
    error_message: null,
    logs: null,
    has_result: true,
    result_has_errors: false,
    total_requests: total,
    ok_count: total,
    ko_count: 0,
    created_at: window.start,
    source: 'self_check',
    saved_run_id: null,
    saved_run_name: null,
    warnings: [],
    run_manifest_state: 'captured',
    run_manifest: {
      workload: null,
      proportions: {
        source: 'single_scenario',
        weights: [{ scenario_id: spec.id, variant_label: '', proportion: 1 }],
      },
      target_base_url: PERF_API,
      target_environment_id: SKLEP_WORLD_IDS.environments.perf,
      target_environment_name: 'perf',
      members: [member(spec)],
      feeders: withData
        ? feederManifest(spec.slots, { [SLOT_SEARCH]: 1, [SLOT_ORDER]: 1, [SLOT_ACCOUNTS]: 1 })
        : [],
    },
  };
}

/** `[request, total, ko, p50, p95, p99]`: totals add up to `TOTAL_REQUESTS`, every error is a 504 on checkout. */
const REQUEST_TABLE: readonly [string, number, number, number, number, number][] = [
  ['POST /auth/login', 82_460, 0, 60, 140, 260],
  ['GET /categories', 54_980, 0, 40, 110, 210],
  ['GET /products', 123_690, 0, 120, 290, 520],
  ['POST /cart/items', 68_725, 0, 210, 620, 1100],
  ['POST /checkout', 68_725, FAILED_REQUESTS, 540, 1840, 30_000],
  ['GET /orders', 13_720, 0, 90, 210, 380],
];

interface Totals {
  total: number;
  ko: number;
  durationSeconds: number;
  /** Run-wide latency (exact, from the Gatling report) and the histogram estimate beside it. */
  exact: {
    mean: number;
    min: number;
    max: number;
    p50: number;
    p75: number;
    p95: number;
    p99: number;
  };
  histogram: { p50: number; p75: number; p90: number; p95: number; p99: number };
  errorHash: string | null;
}

function endpointRow(
  row: readonly [string, number, number, number, number, number],
  durationSeconds: number,
): SklepEndpointRow {
  const [name, total, ko, p50, p95, p99] = row;
  const ok = total - ko;
  return {
    name,
    group: '',
    count: total,
    ok_count: ok,
    ko_count: ko,
    mean_response_time: Math.round(p50 * 1.4),
    min_response_time: Math.max(5, Math.round(p50 / 8)),
    max_response_time: ko > 0 ? 30_000 : p99 * 2,
    min_source: 'bucket-estimate',
    max_source: 'bucket-estimate',
    p50_histogram: p50,
    p75_histogram: Math.round((p50 + p95) / 2),
    p90_histogram: Math.round(p50 + (p95 - p50) * 0.75),
    p95_histogram: p95,
    p99_histogram: p99,
    rps: Math.round((total / durationSeconds) * 100) / 100,
    error_count: ko,
    error_rate: ko / total,
    http_status_counts: ko > 0 ? { '201': ok, '504': ko } : { '200': ok },
  };
}

function buildResult(
  executionId: string,
  table: readonly (readonly [string, number, number, number, number, number])[],
  totals: Totals,
  timeSeries: SklepTimePoint[],
): SklepExecutionResult {
  const ok = totals.total - totals.ko;
  const rps = totals.total / totals.durationSeconds;
  return {
    id: executionId,
    aggregates_source: 'persisted',
    total_requests: totals.total,
    ok_requests: ok,
    ko_requests: totals.ko,
    ok_count: ok,
    ko_count: totals.ko,
    error_rate: totals.ko / totals.total,
    mean_response_time: totals.exact.mean,
    min_response_time: totals.exact.min,
    max_response_time: totals.exact.max,
    min_source: 'gatling-report',
    max_source: 'gatling-report',
    p50: totals.exact.p50,
    p75: totals.exact.p75,
    p90: null,
    p95: totals.exact.p95,
    p99: totals.exact.p99,
    percentile_source: 'gatling-report',
    requests_per_second: rps,
    throughput: rps,
    duration_seconds: totals.durationSeconds,
    error_summary:
      totals.errorHash === null ? [] : [{ message: '504 Gateway Timeout', count: totals.ko }],
    series_source: 'prometheus',
    series_retention: null,
    p50_histogram: totals.histogram.p50,
    p75_histogram: totals.histogram.p75,
    p90_histogram: totals.histogram.p90,
    p95_histogram: totals.histogram.p95,
    p99_histogram: totals.histogram.p99,
    per_request: table.map(([name, total, ko, p50, p95, p99]) => ({
      request_name: name,
      total_requests: total,
      ok_requests: total - ko,
      ko_requests: ko,
      error_rate: ko / total,
      p50_histogram: p50,
      p95_histogram: p95,
      p99_histogram: p99,
    })),
    endpoints: table.map((row) => endpointRow(row, totals.durationSeconds)),
    errors:
      totals.errorHash === null
        ? []
        : [
            {
              error_hash: totals.errorHash,
              message: 'HTTP 504',
              http_status: 504,
              ko_limb: 'http_status',
              source: 'gatling-log',
              in_ko_count: true,
              count: totals.ko,
              percentage: 100,
              affected_endpoints: ['POST /checkout'],
              first_seen: '2026-11-22T10:36:10Z',
              last_seen: '2026-11-22T10:40:00Z',
            },
          ],
    error_traces: [],
    time_series_data: timeSeries,
  };
}

function selfCheckResult(spec: ScenarioSpec): SklepExecutionResult {
  const times = spec.chain.map((step) => step.ms).sort((a, b) => a - b);
  const total = times.length;
  const sum = times.reduce((a, b) => a + b, 0);
  const median = times[Math.floor((total - 1) / 2)] ?? 0;
  const max = times[total - 1] ?? 0;
  const table = spec.chain.map((step) => [step.request, 1, 0, step.ms, step.ms, step.ms] as const);
  return buildResult(
    spec.selfCheckId,
    table,
    {
      total,
      ko: 0,
      durationSeconds: sum / 1000,
      exact: {
        mean: sum / total,
        min: times[0] ?? 0,
        max,
        p50: median,
        p75: max,
        p95: max,
        p99: max,
      },
      histogram: { p50: median, p75: max, p90: max, p95: max, p99: max },
      errorHash: null,
    },
    [],
  );
}

/** One point per 5 s of the 10-minute ramp: the p95 crosses 400 ms at T+6:10 and keeps rising. */
function loadTimeSeries(): SklepTimePoint[] {
  const points: SklepTimePoint[] = [];
  for (let elapsed = 0; elapsed <= 595; elapsed += 5) {
    const users = (elapsed / 600) * 2000;
    const rps = Math.round(users * 0.62 * 100) / 100;
    const slow = elapsed >= 370;
    const koPerSecond = slow ? Math.round(rps * 0.016 * 100) / 100 : 0;
    points.push({
      elapsed_seconds: elapsed,
      requests_per_second: rps,
      ok_per_second: Math.round((rps - koPerSecond) * 100) / 100,
      ko_per_second: koPerSecond,
      mean_response_time: slow ? 420 + (elapsed - 370) : 90 + Math.round(elapsed / 5),
      p50_histogram: slow ? 260 + Math.round((elapsed - 370) / 2) : 90 + Math.round(elapsed / 8),
      p95_histogram: slow ? 900 + (elapsed - 370) * 2 : 150 + Math.round(elapsed * 0.6),
      p99_histogram: slow ? 2400 + (elapsed - 370) * 3 : 300 + elapsed,
      max_response_time: slow ? 30_000 : 600 + elapsed,
    });
  }
  return points;
}

function seedExecuted(store: Store, endpoints: readonly SklepEndpoint[]): void {
  const known = new Set(endpoints.map((e) => `${e.method} ${e.path}`));
  for (const [name] of REQUEST_TABLE) {
    if (!known.has(name)) throw new Error(`sklep world: ${name} is not an operation of the spec`);
  }
  const perf = SKLEP_WORLD_IDS.environments.perf;
  const window = 598;
  const duration = 597.5;

  const assertions: SklepAssertionOutcome[] = [
    {
      subject: { scope: 'run', path: [] },
      metric: { kind: 'response_time', requests: 'all', stat: 'percentile', percentile: 95 },
      unit: 'ms',
      condition: 'lt',
      threshold: [400],
      inclusive: false,
      actual: 1120,
      passed: false,
      samples: TOTAL_REQUESTS,
      reason: null,
      subject_label: 'Global',
      target_label: '95th percentile of response time',
      condition_label: 'is less than',
      threshold_label: '400.0',
      message: 'Global: 95th percentile of response time is less than 400.0',
    },
    {
      subject: { scope: 'run', path: [] },
      metric: { kind: 'request_percentage', requests: 'failed', stat: null, percentile: null },
      unit: 'percent',
      condition: 'lt',
      threshold: [1],
      inclusive: false,
      actual: 0.6,
      passed: true,
      samples: TOTAL_REQUESTS,
      reason: null,
      subject_label: 'Global',
      target_label: 'percentage of failed events',
      condition_label: 'is less than',
      threshold_label: '1.0',
      message: 'Global: percentage of failed events is less than 1.0',
    },
  ];
  const slaVerdict: SklepSlaVerdict = {
    format_version: 1,
    source: 'loadcraft-exact',
    status: 'failed',
    reason: null,
    detail: null,
    shards: ['injector-1'],
    window_s: window,
    semantics: {
      percentile: 'exact nearest-rank on whole milliseconds',
      mean: 'exact',
      std_dev: 'exact',
      no_samples: 'fails',
      ambiguous_path: 'fails',
    },
    assertions,
    gatling_exit_code: 2,
    gatling_status: 'failed',
    gatling_disagrees: false,
    warnings: [],
  };
  const weights = SCENARIO_SPECS.map((spec) => ({
    scenario_id: spec.id,
    variant_label: '',
    proportion: spec.name === 'zakupy' ? 0.5 : spec.name === 'konto' ? 0.1 : 0.4,
  }));

  store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).insert({
    id: SKLEP_IDS.executionPerf,
    scenario_id: null,
    composite_id: SKLEP_WORLD_IDS.composition,
    configuration_id: null,
    status: 'completed',
    supervised: false,
    started_at: RUN.start,
    completed_at: RUN.end,
    duration_seconds: duration,
    load_window_state: 'measured',
    run_exit_code: 2,
    sla_verdict: slaVerdict,
    invariant_summary: null,
    error_message: null,
    logs: null,
    has_result: true,
    result_has_errors: true,
    total_requests: TOTAL_REQUESTS,
    ok_count: TOTAL_REQUESTS - FAILED_REQUESTS,
    ko_count: FAILED_REQUESTS,
    created_at: RUN.start,
    source: null,
    saved_run_id: null,
    saved_run_name: null,
    warnings: [],
    run_manifest_state: 'captured',
    run_manifest: {
      workload: { kind: 'adr005', value: { type: 'ramp_concurrency', vusers: 2000, ramp: 600 } },
      proportions: { source: 'composition_links', weights },
      target_base_url: PERF_API,
      target_environment_id: perf,
      target_environment_name: 'perf',
      members: SCENARIO_SPECS.map(member),
      feeders: feederManifest([SLOT_SEARCH, SLOT_ORDER, SLOT_ACCOUNTS], {
        [SLOT_SEARCH]: 1000,
        [SLOT_ORDER]: 1000,
        [SLOT_ACCOUNTS]: 1200,
      }),
    },
  });

  store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results).insert(
    buildResult(
      SKLEP_IDS.executionPerf,
      REQUEST_TABLE,
      {
        total: TOTAL_REQUESTS,
        ko: FAILED_REQUESTS,
        durationSeconds: duration,
        exact: { mean: 262, min: 8, max: 30_000, p50: 180, p75: 410, p95: 1120, p99: 2900 },
        histogram: { p50: 175, p75: 400, p90: 780, p95: 1100, p99: 2850 },
        errorHash: 'http-504',
      },
      loadTimeSeries(),
    ),
  );

  const evidence = 'Lock wait timeout exceeded; try restarting transaction';
  const summary =
    'Test przekroczył próg p95 (1120 ms przy progu 400 ms). Przyczyną jest POST /checkout: od T+6:10 ' +
    'średni czas rośnie z 240 do 1310 ms, a 2480 żądań kończy się odpowiedzią 504.';
  store.collection<SklepExecutionAnalysis>(SKLEP_COLLECTIONS.analyses).insert({
    id: SKLEP_WORLD_IDS.analysis,
    execution_id: SKLEP_IDS.executionPerf,
    verdict: 'fail',
    summary,
    analysis: {
      verdict: 'fail',
      summary,
      confidence: 'high',
      error_analyses: [
        {
          error_hash: 'http-504',
          http_status: 504,
          probable_cause:
            'POST /checkout: transakcja bazy obejmuje wywołanie bramki płatności · blokada wiersza w tabeli orders',
          confidence: 'high',
          evidence: [evidence],
          evidence_sources: ['mcp:logs_summary'],
          suggested_fixes: ['zapis zamówienia poza transakcją płatności'],
        },
      ],
      performance_concerns: [
        {
          endpoint: 'POST /checkout',
          metric: 'latency_step',
          observed: 1310,
          summary: 'Średni czas POST /checkout rośnie z 240 do 1310 ms od T+6:10.',
          severity: 'high',
          window_start_offset: 'T+6:10',
          window_end_offset: 'T+10:00',
          before_ms: 240,
          after_ms: null,
        },
      ],
      step_hypotheses: [
        {
          kind: 'isolated',
          endpoints: ['POST /checkout'],
          hypothesis:
            'Blokada wiersza w tabeli orders trzymana na czas wywołania bramki płatności.',
          checks: ['Czy transakcja zamówienia obejmuje wywołanie bramki płatności?'],
        },
      ],
      recommendations: ['zapis zamówienia poza transakcją płatności'],
      grounding_dropped: { errors_ungrounded: 0, evidence_ungrounded: 0, evidence_snapped: 0 },
      latency_steps: [
        {
          endpoint: 'POST /checkout',
          window_start: '2026-11-22T10:36:10Z',
          window_end: '2026-11-22T10:40:00Z',
          window_start_offset: 'T+6:10',
          window_end_offset: 'T+10:00',
          before_ms: 240,
          during_ms: 1310,
          after_ms: null,
          ratio: 5.46,
          buckets: 46,
        },
      ],
      latency_steps_reason: null,
      latency_step_pattern: [],
      external_evidence: {
        source: {
          kind: 'mcp',
          label: 'sklep-logs',
          url: 'https://logs-mcp.perf.example.com/mcp',
        },
        window: { start: '2026-11-22T10:28:00Z', end: '2026-11-22T10:42:18Z' },
        calls: [
          {
            tool: 'logs_summary',
            arguments: { start: '2026-11-22T10:28:00Z', end: '2026-11-22T10:42:18Z' },
            called_at: '2026-11-22T10:41:10Z',
            duration_ms: 840,
            size_bytes: 96,
            truncated: false,
            is_error: false,
            content: `orders-db: ${evidence}`,
          },
        ],
        skipped: [{ tool: 'container_events', reason: 'bundle limit reached' }],
        error: null,
      },
    },
    model: 'claude-sonnet-5-5',
    input_tokens: 18_400,
    output_tokens: 1250,
    cost_usd: 0.07,
    duration_ms: 21_000,
    initiated_by: USER,
    generated_at: '2026-11-22T10:41:00Z',
  });
}
