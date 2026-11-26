/**
 * Generated file - do not edit.
 * Source: catalog/katalog.json, module results. Regenerate with "npm run gen:tools" (from mcp/).
 */

import type { ToolMeta } from '../moduleTool.js';

/** `results_get_report`: Get the short report of a finished run: totals, thresholds, slowest requests, top errors. */
export const RESULTS_GET_REPORT = {
  name: 'results_get_report',
  module: 'results',
  full_name: 'mcp__plugin_loadcraft_lc__results_get_report',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'composite',
  class: 'read',
  safety: 'read',
  secret: false,
  consent: {
    level: 1,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: null,
    cost: null,
    card: null,
    resolve: [],
    snapshot: false,
    follow_ups: [],
    freeze: [],
    max_items: null,
  },
  undo: {
    reversible: null,
    ways: [],
    reason: null,
  },
  log: {
    args: '{run_id}',
    result: '{verdict}: {requests} requests, {errors} errors, p95 {p95} ms',
  },
  route: null,
  description:
    'Get the short report of a finished run: totals, thresholds, slowest requests, top errors.',
  operations: [
    {
      operationId:
        'get_execution_result_api_v1_projects__project_id__gatling_executions__execution_id__result_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/result',
    },
    {
      operationId:
        'get_execution_endpoints_api_v1_projects__project_id__gatling_executions__execution_id__endpoints_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints',
    },
  ],
  also_calls: [
    'get_execution_errors_api_v1_projects__project_id__gatling_executions__execution_id__errors_get',
    'compare_gatling_executions_api_v1_projects__project_id__gatling_executions_compare_get',
    'get_execution_baseline_api_v1_projects__project_id__gatling_executions__execution_id__baseline_get',
  ],
  channels: [],
  state_reads: ['ids.project_id', 'ids.run_id', 'choices.run.compare_to', 'steps.run.finished'],
  state_writes: ['steps.results.report', 'problems'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'run_id',
      type: 'uuid',
      from_state: 'ids.run_id',
    },
    {
      name: 'compare_to',
      type: 'uuid|baseline',
      from_state: 'choices.run.compare_to',
    },
  ],
  shows_content: null,
  install_allow: true,
  known_debt: null,
  annotations: null,
} as const satisfies ToolMeta;

/** `results_get_request`: Get one request's metrics and latency percentiles in a run. */
export const RESULTS_GET_REQUEST = {
  name: 'results_get_request',
  module: 'results',
  full_name: 'mcp__plugin_loadcraft_lc__results_get_request',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'composite',
  class: 'read',
  safety: 'read',
  secret: false,
  consent: {
    level: 1,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: null,
    cost: null,
    card: null,
    resolve: [],
    snapshot: false,
    follow_ups: [],
    freeze: [],
    max_items: null,
  },
  undo: {
    reversible: null,
    ways: [],
    reason: null,
  },
  log: {
    args: '{run_id} {request}',
    result: '{request}: p95 {p95} ms',
  },
  route: null,
  description: "Get one request's metrics and latency percentiles in a run.",
  operations: [
    {
      operationId:
        'get_execution_endpoint_detail_api_v1_projects__project_id__gatling_executions__execution_id__endpoints__name__get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints/{name}',
    },
    {
      operationId:
        'get_execution_endpoint_percentiles_api_v1_projects__project_id__gatling_executions__execution_id__endpoints__name__percentiles_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints/{name}/percentiles',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.run_id'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'run_id',
      type: 'uuid',
      from_state: 'ids.run_id',
    },
    {
      name: 'request',
      type: 'string',
      from_state: null,
    },
  ],
  shows_content: null,
  install_allow: true,
  known_debt: null,
  annotations: null,
} as const satisfies ToolMeta;

/** `results_get_errors`: Get the error groups of a run, or one group by hash. */
export const RESULTS_GET_ERRORS = {
  name: 'results_get_errors',
  module: 'results',
  full_name: 'mcp__plugin_loadcraft_lc__results_get_errors',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'atomic',
  class: 'read',
  safety: 'read',
  secret: false,
  consent: {
    level: 1,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: null,
    cost: null,
    card: null,
    resolve: [],
    snapshot: false,
    follow_ups: [],
    freeze: [],
    max_items: null,
  },
  undo: {
    reversible: null,
    ways: [],
    reason: null,
  },
  log: {
    args: '{run_id}',
    result: '{groups} error groups',
  },
  route: null,
  description: 'Get the error groups of a run, or one group by hash.',
  operations: [
    {
      operationId:
        'get_execution_errors_api_v1_projects__project_id__gatling_executions__execution_id__errors_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/errors',
    },
    {
      operationId:
        'get_execution_error_detail_api_v1_projects__project_id__gatling_executions__execution_id__errors__error_hash__get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/errors/{error_hash}',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.run_id'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'run_id',
      type: 'uuid',
      from_state: 'ids.run_id',
    },
  ],
  shows_content: null,
  install_allow: true,
  known_debt: null,
  annotations: null,
} as const satisfies ToolMeta;

/** `results_get_traces`: Get request traces of a run (all or failed only), or one trace by id. Headers and bodies masked. */
export const RESULTS_GET_TRACES = {
  name: 'results_get_traces',
  module: 'results',
  full_name: 'mcp__plugin_loadcraft_lc__results_get_traces',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'atomic',
  class: 'read+secret',
  safety: 'read',
  secret: true,
  consent: {
    level: 1,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: null,
    cost: null,
    card: null,
    resolve: [],
    snapshot: false,
    follow_ups: [],
    freeze: [],
    max_items: null,
  },
  undo: {
    reversible: null,
    ways: [],
    reason: null,
  },
  log: {
    args: '{run_id}',
    result: '{count} traces',
  },
  route: null,
  description:
    'Get request traces of a run (all or failed only), or one trace by id. Headers and bodies masked.',
  operations: [
    {
      operationId:
        'get_execution_traces_api_v1_projects__project_id__gatling_executions__execution_id__traces_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/traces',
    },
    {
      operationId:
        'get_execution_error_traces_api_v1_projects__project_id__gatling_executions__execution_id__error_traces_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/error-traces',
    },
    {
      operationId:
        'get_execution_trace_detail_api_v1_projects__project_id__gatling_executions__execution_id__traces__trace_id__get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/traces/{trace_id}',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.run_id'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'run_id',
      type: 'uuid',
      from_state: 'ids.run_id',
    },
  ],
  shows_content: {
    what: 'treści żądań i odpowiedzi śladów przebiegu (nagłówki: nazwy, ciała po masce)',
    unrecognized: 'hidden_entirely',
  },
  install_allow: false,
  known_debt: null,
  annotations: null,
} as const satisfies ToolMeta;

/** `results_get_logs`: Get Gatling log lines of a run (masked, truncated). */
export const RESULTS_GET_LOGS = {
  name: 'results_get_logs',
  module: 'results',
  full_name: 'mcp__plugin_loadcraft_lc__results_get_logs',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'atomic',
  class: 'read+secret',
  safety: 'read',
  secret: true,
  consent: {
    level: 1,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: null,
    cost: null,
    card: null,
    resolve: [],
    snapshot: false,
    follow_ups: [],
    freeze: [],
    max_items: null,
  },
  undo: {
    reversible: null,
    ways: [],
    reason: null,
  },
  log: {
    args: '{run_id}',
    result: '{lines} lines',
  },
  route: null,
  description: 'Get Gatling log lines of a run (masked, truncated).',
  operations: [
    {
      operationId:
        'get_execution_logs_api_v1_projects__project_id__gatling_executions__execution_id__logs_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/logs',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.run_id'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'run_id',
      type: 'uuid',
      from_state: 'ids.run_id',
    },
  ],
  shows_content: null,
  install_allow: false,
  known_debt: null,
  annotations: null,
} as const satisfies ToolMeta;

/** `results_export_report`: Export the archived Gatling HTML report to a local folder and return its path. */
export const RESULTS_EXPORT_REPORT = {
  name: 'results_export_report',
  module: 'results',
  full_name: 'mcp__plugin_loadcraft_lc__results_export_report',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'composite',
  class: 'read',
  safety: 'read',
  secret: false,
  consent: {
    level: 1,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: null,
    cost: null,
    card: null,
    resolve: [],
    snapshot: false,
    follow_ups: [],
    freeze: [],
    max_items: null,
  },
  undo: {
    reversible: null,
    ways: [],
    reason: null,
  },
  log: {
    args: '{run_id}',
    result: '{path}',
  },
  route: null,
  description: 'Export the archived Gatling HTML report to a local folder and return its path.',
  operations: [
    {
      operationId:
        'get_execution_report_index_api_v1_projects__project_id__gatling_executions__execution_id__report_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/report',
    },
    {
      operationId:
        'get_execution_report_asset_api_v1_projects__project_id__gatling_executions__execution_id__report__filepath__get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/report/{filepath}',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.run_id'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'run_id',
      type: 'uuid',
      from_state: 'ids.run_id',
    },
  ],
  shows_content: null,
  install_allow: true,
  known_debt: null,
  annotations: null,
} as const satisfies ToolMeta;

/** `results_check_production`: Check a production-replay run: achieved load against the plan, and the think-time verdict. */
export const RESULTS_CHECK_PRODUCTION = {
  name: 'results_check_production',
  module: 'results',
  full_name: 'mcp__plugin_loadcraft_lc__results_check_production',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'composite',
  class: 'read',
  safety: 'read',
  secret: false,
  consent: {
    level: 1,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: null,
    cost: null,
    card: null,
    resolve: [],
    snapshot: false,
    follow_ups: [],
    freeze: [],
    max_items: null,
  },
  undo: {
    reversible: null,
    ways: [],
    reason: null,
  },
  log: {
    args: '{run_id}',
    result: 'load achieved: {achieved}%; think time: {verdict}',
  },
  route: null,
  description:
    'Check a production-replay run: achieved load against the plan, and the think-time verdict.',
  operations: [
    {
      operationId:
        'get_production_overlay_api_v1_projects__project_id__gatling_executions__execution_id__production_overlay_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/production-overlay',
    },
    {
      operationId:
        'get_think_time_verdict_api_v1_projects__project_id__gatling_executions__execution_id__think_time_verdict_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/think-time-verdict',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.run_id'],
  state_writes: ['steps.results.production_verdict'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'run_id',
      type: 'uuid',
      from_state: 'ids.run_id',
    },
  ],
  shows_content: null,
  install_allow: true,
  known_debt: null,
  annotations: null,
} as const satisfies ToolMeta;

/** `results_compare_runs`: Compare two runs metric by metric; compare_to=baseline uses the pinned baseline. */
export const RESULTS_COMPARE_RUNS = {
  name: 'results_compare_runs',
  module: 'results',
  full_name: 'mcp__plugin_loadcraft_lc__results_compare_runs',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'atomic',
  class: 'read',
  safety: 'read',
  secret: false,
  consent: {
    level: 1,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: null,
    cost: null,
    card: null,
    resolve: [],
    snapshot: false,
    follow_ups: [],
    freeze: [],
    max_items: null,
  },
  undo: {
    reversible: null,
    ways: [],
    reason: null,
  },
  log: {
    args: '{run_id} vs {compare_to}',
    result: '{better} better, {worse} worse',
  },
  route: null,
  description: 'Compare two runs metric by metric; compare_to=baseline uses the pinned baseline.',
  operations: [
    {
      operationId:
        'compare_gatling_executions_api_v1_projects__project_id__gatling_executions_compare_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/compare',
    },
    {
      operationId:
        'get_execution_baseline_api_v1_projects__project_id__gatling_executions__execution_id__baseline_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/baseline',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.run_id', 'choices.run.compare_to'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'run_id',
      type: 'uuid',
      from_state: 'ids.run_id',
    },
    {
      name: 'compare_to',
      type: 'uuid|baseline',
      from_state: 'choices.run.compare_to',
    },
  ],
  shows_content: null,
  install_allow: true,
  known_debt: null,
  annotations: null,
} as const satisfies ToolMeta;

/** `results_set_baseline`: Set a run as the baseline for its scenario and environment pair. */
export const RESULTS_SET_BASELINE = {
  name: 'results_set_baseline',
  module: 'results',
  full_name: 'mcp__plugin_loadcraft_lc__results_set_baseline',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'atomic',
  class: 'write',
  safety: 'write',
  secret: false,
  consent: {
    level: 1,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: null,
    cost: null,
    card: null,
    resolve: [],
    snapshot: false,
    follow_ups: [],
    freeze: [],
    max_items: null,
  },
  undo: {
    reversible: 'yes',
    ways: [
      {
        tool: 'results_set_baseline',
        how: 'the previous baseline run',
        for: 'update',
      },
    ],
    reason: null,
  },
  log: {
    args: '{run_id}',
    result: 'run {run_id} is the baseline',
  },
  route: null,
  description: 'Set a run as the baseline for its scenario and environment pair.',
  operations: [
    {
      operationId:
        'pin_execution_as_baseline_api_v1_projects__project_id__gatling_executions__execution_id__baseline_put',
      method: 'PUT',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/baseline',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.run_id'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'run_id',
      type: 'uuid',
      from_state: 'ids.run_id',
    },
  ],
  shows_content: null,
  install_allow: false,
  known_debt: null,
  annotations: null,
} as const satisfies ToolMeta;

/** `results_analyze_run`: Analyze why a run went as it did: returns the stored AI analysis, or starts one and waits. */
export const RESULTS_ANALYZE_RUN = {
  name: 'results_analyze_run',
  module: 'results',
  full_name: 'mcp__plugin_loadcraft_lc__results_analyze_run',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'process',
  class: 'costly',
  safety: 'costly',
  secret: false,
  consent: {
    level: 2,
    level3_reason: null,
    by_argument: {
      when: 'zapisana analiza już istnieje (wraca bez startu nowej)',
      level: 1,
      why: null,
      card: null,
    },
    escalate_to_3: [],
    target_traffic: null,
    scope: {
      group: 'results:analyze',
      target: null,
    },
    cost: 'one LLM analysis (a stored analysis is returned free)',
    card: {
      title: 'Analyze run {run_id} with AI',
      fields: [
        {
          label: 'Run',
          from: 'run_id',
          source: 'args',
        },
      ],
    },
    resolve: [],
    snapshot: false,
    follow_ups: [],
    freeze: [
      {
        path: 'ids.project_id',
        arg: 'project_id',
        explicit: true,
      },
      {
        path: 'ids.run_id',
        arg: 'run_id',
        explicit: true,
      },
    ],
    max_items: null,
  },
  undo: {
    reversible: 'nothing',
    ways: [],
    reason: 'proposes only, nothing is saved',
  },
  log: {
    args: 'Analyze run {run_id} with AI',
    result: '{findings} findings',
  },
  route: null,
  description:
    'Analyze why a run went as it did: returns the stored AI analysis, or starts one and waits.',
  operations: [
    {
      operationId:
        'get_execution_analysis_api_v1_projects__project_id__gatling_executions__execution_id__analysis_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/analysis',
    },
    {
      operationId:
        'analyze_execution_async_api_v1_projects__project_id__gatling_executions__execution_id__analyze_async_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/analyze-async',
    },
  ],
  also_calls: [],
  channels: ['analysis'],
  state_reads: ['ids.project_id', 'ids.run_id', 'steps.run.finished'],
  state_writes: ['steps.results.analysis', 'operations', 'problems'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'run_id',
      type: 'uuid',
      from_state: 'ids.run_id',
    },
  ],
  shows_content: null,
  install_allow: false,
  known_debt: null,
  annotations: null,
} as const satisfies ToolMeta;
