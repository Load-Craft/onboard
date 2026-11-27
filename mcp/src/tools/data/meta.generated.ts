/**
 * Generated file - do not edit.
 * Source: catalog/katalog.json, module data. Regenerate with "npm run gen:tools" (from mcp/).
 */

import type { ToolMeta } from '../moduleTool.js';

/** `data_suggest_actions`: Suggest the test data a scenario or composition needs (data hub LLM): proposed actions and the tool for each. Applies nothing. */
export const DATA_SUGGEST_ACTIONS = {
  name: 'data_suggest_actions',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_suggest_actions',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'composite',
  class: 'costly',
  safety: 'costly',
  secret: false,
  consent: {
    level: 2,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: {
      group: 'data:prepare',
      target: null,
    },
    cost: 'up to 3 LLM calls (none when the data is ready)',
    card: {
      title: 'Suggest the test data for {target}',
      fields: [
        {
          label: 'For',
          from: 'scenario_ids | composition_id',
          source: 'args',
        },
      ],
    },
    resolve: [],
    snapshot: false,
    follow_ups: ['data_generate_dataset', 'data_create_dataset'],
    freeze: [
      {
        path: 'ids.project_id',
        arg: 'project_id',
        explicit: true,
      },
      {
        path: 'ids.scenario_ids',
        arg: 'scenario_ids',
        explicit: true,
      },
      {
        path: 'ids.composition_id',
        arg: 'composition_id',
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
    args: 'Suggest the test data for {target}',
    result: '{actions} actions proposed',
  },
  route: 'copilot',
  description:
    'Suggest the test data a scenario or composition needs (data hub LLM): proposed actions and the tool for each. Applies nothing.',
  operations: [
    {
      operationId: 'get_actions_catalog_api_v1_projects__project_id__data_hub_actions_catalog_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/data-hub/actions-catalog',
    },
    {
      operationId: 'auto_plan_data_api_v1_projects__project_id__data_hub_auto_plan_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/data-hub/auto-plan',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: [
    'ids.project_id',
    'ids.scenario_ids',
    'ids.composition_id',
    'steps.scenario.generated',
  ],
  state_writes: ['steps.data.planned', 'problems', 'choices.data.needs_accounts'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: null,
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_ask_copilot`: Ask the data hub copilot in free form; returns its reply and proposed actions. Applies nothing. */
export const DATA_ASK_COPILOT = {
  name: 'data_ask_copilot',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_ask_copilot',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'atomic',
  class: 'costly',
  safety: 'costly',
  secret: false,
  consent: {
    level: 2,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: {
      group: 'data:copilot',
      target: null,
    },
    cost: '1-3 LLM calls per turn',
    card: {
      title: 'Ask the data hub copilot',
      fields: [
        {
          label: 'For',
          from: 'scenario_id | composition_id',
          source: 'args',
        },
        {
          label: 'Message',
          from: 'message',
          source: 'args',
        },
        {
          label: 'Load profile',
          from: 'profile (from the process choices)',
          source: 'state',
        },
      ],
    },
    resolve: [],
    snapshot: false,
    follow_ups: [],
    freeze: [
      {
        path: 'choices.run.profile',
        arg: 'profile',
        explicit: true,
      },
      {
        path: 'ids.project_id',
        arg: 'project_id',
        explicit: true,
      },
      {
        path: 'ids.scenario_ids',
        arg: 'scenario_id',
        explicit: true,
      },
      {
        path: 'ids.composition_id',
        arg: 'composition_id',
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
    args: 'Ask the data hub copilot',
    result: '{actions} actions proposed',
  },
  route: 'copilot',
  description:
    'Ask the data hub copilot in free form; returns its reply and proposed actions. Applies nothing.',
  operations: [
    {
      operationId: 'send_data_hub_message_api_v1_projects__project_id__data_hub_messages_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/data-hub/messages',
    },
  ],
  also_calls: [
    'get_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__get',
    'get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get',
  ],
  channels: [],
  state_reads: ['ids.project_id', 'ids.scenario_ids', 'ids.composition_id', 'choices.run.profile'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'message',
      type: 'string',
      min_length: 1,
      max_length: 4000,
      required: true,
      from_state: null,
      doc: 'The question for the data hub copilot.',
    },
    {
      name: 'scenario_id',
      type: 'string',
      min_length: 1,
      max_length: 200,
      from_state: 'ids.scenario_ids',
      doc: 'The scenario (id or name) the question is about; give this or composition_id.',
    },
    {
      name: 'composition_id',
      type: 'string',
      min_length: 1,
      max_length: 200,
      from_state: 'ids.composition_id',
      doc: 'The composition (id or name); give this or scenario_id.',
    },
    {
      name: 'profile',
      type: 'object',
      from_state: 'choices.run.profile',
      doc: 'The load profile to discuss; default: the chosen one.',
    },
  ],
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_get_copilot_history`: Get the project's data hub conversation. */
export const DATA_GET_COPILOT_HISTORY = {
  name: 'data_get_copilot_history',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_get_copilot_history',
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
    args: '',
    result: '{turns} turns',
  },
  route: 'copilot',
  description: "Get the project's data hub conversation.",
  operations: [
    {
      operationId: 'get_data_hub_history_api_v1_projects__project_id__data_hub_history_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/data-hub/history',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'limit',
      type: 'integer',
      min: 1,
      max: 100,
      default: 20,
      from_state: null,
      doc: 'How many of the latest messages to return (1-100).',
    },
  ],
  shows_content: null,
  install_allow: true,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_get_slots`: Get the data slots of a scenario or composition with compatible datasets and current bindings. */
export const DATA_GET_SLOTS = {
  name: 'data_get_slots',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_get_slots',
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
    args: '{target}',
    result: '{slots} slots, {bound} bound',
  },
  route: null,
  description:
    'Get the data slots of a scenario or composition with compatible datasets and current bindings.',
  operations: [
    {
      operationId:
        'get_scenario_slot_options_api_v1_projects__project_id__gatling_scenarios__scenario_id__slots_options_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/slots/options',
    },
    {
      operationId:
        'get_composition_slot_options_api_v1_projects__project_id__gatling_compositions__composition_id__slots_options_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/slots/options',
    },
  ],
  also_calls: [
    'get_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__get',
    'get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get',
  ],
  channels: [],
  state_reads: ['ids.project_id', 'ids.scenario_ids', 'ids.composition_id'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'scenario_id',
      type: 'uuid',
      from_state: 'ids.scenario_ids',
      doc: 'The scenario; default: the only one in this workspace.',
    },
    {
      name: 'composition_id',
      type: 'uuid',
      from_state: 'ids.composition_id',
      doc: 'The composition (not with scenario_id).',
    },
  ],
  shows_content: null,
  install_allow: true,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_set_bindings`: Set the slot-to-dataset bindings of a scenario or composition (whole map replaced; {} clears). */
export const DATA_SET_BINDINGS = {
  name: 'data_set_bindings',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_set_bindings',
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
        tool: 'data_set_bindings',
        how: 'the previous bindings',
        for: 'update',
      },
    ],
    reason: null,
  },
  log: {
    args: '{target}',
    result: '{count} slots bound',
  },
  route: null,
  description:
    'Set the slot-to-dataset bindings of a scenario or composition (whole map replaced; {} clears).',
  operations: [
    {
      operationId:
        'update_scenario_slot_bindings_api_v1_projects__project_id__gatling_scenarios__scenario_id__slot_bindings_put',
      method: 'PUT',
      path: '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/slot-bindings',
    },
    {
      operationId:
        'update_composition_slot_bindings_api_v1_projects__project_id__gatling_compositions__composition_id__slot_bindings_put',
      method: 'PUT',
      path: '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/slot-bindings',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.scenario_ids', 'ids.composition_id', 'ids.dataset_ids'],
  state_writes: ['ids.dataset_ids', 'steps.data.bindings_set', 'steps.data.datasets_ready'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: null,
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_set_slot_label`: Set the display label of a scenario's data slot. */
export const DATA_SET_SLOT_LABEL = {
  name: 'data_set_slot_label',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_set_slot_label',
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
        tool: 'data_set_slot_label',
        how: 'the previous label',
        for: 'update',
      },
    ],
    reason: null,
  },
  log: {
    args: '{slot}',
    result: 'slot {slot}: {label}',
  },
  route: null,
  description: "Set the display label of a scenario's data slot.",
  operations: [
    {
      operationId:
        'relabel_slot_api_v1_projects__project_id__data_hub_scenarios__scenario_id__slots__slot__label_patch',
      method: 'PATCH',
      path: '/api/v1/projects/{project_id}/data-hub/scenarios/{scenario_id}/slots/{slot}/label',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.scenario_ids'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'scenario_id',
      type: 'uuid',
      from_state: 'ids.scenario_ids',
      doc: 'The scenario; default: the only one in this workspace.',
    },
    {
      name: 'slot',
      type: 'string',
      min_length: 1,
      max_length: 100,
      from_state: null,
      required: true,
      doc: 'The data slot.',
    },
    {
      name: 'label',
      type: 'string',
      min_length: 1,
      max_length: 200,
      from_state: null,
      required: true,
      doc: "The slot's new label.",
    },
  ],
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_check_readiness`: Check whether the datasets cover a run of a scenario or composition under a given load and environment. Creates nothing. */
export const DATA_CHECK_READINESS = {
  name: 'data_check_readiness',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_check_readiness',
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
    args: '{target}',
    result: 'ready: {ok}; {short} slots short',
  },
  route: null,
  description:
    'Check whether the datasets cover a run of a scenario or composition under a given load and environment. Creates nothing.',
  operations: [
    {
      operationId:
        'feeder_preflight_api_v1_projects__project_id__gatling_executions_preflight_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/executions/preflight',
    },
    {
      operationId:
        'preflight_composition_feeders_api_v1_projects__project_id__gatling_compositions__composition_id__feeders_preflight_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/feeders/preflight',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: [
    'ids.project_id',
    'ids.scenario_ids',
    'ids.composition_id',
    'ids.dataset_ids',
    'choices.run.profile',
    'choices.run.env_id',
    'choices.scenario.split',
    'ids.env_id',
    'steps.data.bindings_set',
  ],
  state_writes: ['steps.data.datasets_ready', 'problems'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: null,
  shows_content: null,
  install_allow: true,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_list_datasets`: List the project's datasets: name, type, columns, row count (no rows). */
export const DATA_LIST_DATASETS = {
  name: 'data_list_datasets',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_list_datasets',
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
    args: '',
    result: '{count} datasets',
  },
  route: null,
  description: "List the project's datasets: name, type, columns, row count (no rows).",
  operations: [
    {
      operationId: 'list_feeders_api_v1_projects__project_id__gatling_feeders_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/feeders',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: null,
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_get_dataset`: Get a dataset: columns, recipe, row count; include adds rows (secrets masked), consumers, history, feed snippet, Redis status. */
export const DATA_GET_DATASET = {
  name: 'data_get_dataset',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_get_dataset',
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
    args: '{dataset_id} include={include}',
    result: '{name}: {rows} rows',
  },
  route: null,
  description:
    'Get a dataset: columns, recipe, row count; include adds rows (secrets masked), consumers, history, feed snippet, Redis status.',
  operations: [
    {
      operationId: 'get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}',
    },
    {
      operationId:
        'get_feeder_preview_api_v1_projects__project_id__gatling_feeders__feeder_id__preview_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/preview',
    },
    {
      operationId:
        'get_feeder_audit_api_v1_projects__project_id__gatling_feeders__feeder_id__audit_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/audit',
    },
    {
      operationId:
        'get_feeder_used_in_api_v1_projects__project_id__gatling_feeders__feeder_id__used_in_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/used-in',
    },
    {
      operationId:
        'gatling_feeder_redis_status_api_v1_projects__project_id__gatling_feeders__feeder_id__redis_status_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/redis/status',
    },
    {
      operationId:
        'preview_feeder_snippet_api_v1_projects__project_id__gatling_feeders_preview_snippet_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/preview-snippet',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.dataset_ids'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'dataset_id',
      type: 'uuid',
      from_state: 'ids.dataset_ids',
      doc: 'The dataset; default: the only one in this workspace.',
    },
    {
      name: 'include',
      type: 'string[]',
      enum: ['rows', 'consumers', 'history', 'snippet', 'redis'],
      max_items: 5,
      from_state: null,
      doc: 'rows: a masked preview (secret columns hidden); consumers: who uses it; history: revisions; snippet: the feed snippet; redis: pool status.',
    },
    {
      name: 'rows',
      type: 'integer',
      min: 1,
      max: 50,
      default: 10,
      from_state: null,
      doc: 'With include rows: how many rows (1-50).',
    },
    {
      name: 'offset',
      type: 'integer',
      min: 0,
      max: 100000,
      default: 0,
      from_state: null,
      doc: 'With include rows: the first row.',
    },
  ],
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_create_dataset`: Create a dataset from a local file, from column rules (no AI), or as a copy of another; preview=true returns sample rows and saves nothing. */
export const DATA_CREATE_DATASET = {
  name: 'data_create_dataset',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_create_dataset',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'atomic',
  class: 'write',
  safety: 'write',
  secret: false,
  consent: {
    level: 2,
    level3_reason: null,
    by_argument: {
      when: 'preview=true (niczego nie zapisuje)',
      level: 1,
      why: null,
      card: null,
    },
    escalate_to_3: ['secret_ref'],
    target_traffic: null,
    scope: {
      group: 'data:prepare',
      target: null,
    },
    cost: 'uploads the file when the source is a file',
    card: {
      title: 'Create dataset {name}',
      fields: [
        {
          label: 'Name',
          from: 'name',
          source: 'args',
        },
        {
          label: 'Source',
          from: 'file | rules | copy_of',
          source: 'args',
        },
        {
          label: 'Rows',
          from: 'rows',
          source: 'args',
        },
        {
          label: 'Preview only',
          from: 'preview',
          source: 'args',
        },
        {
          label: 'File content',
          from: '(size and sha256 of the file)',
          source: 'resolve',
        },
      ],
    },
    resolve: [
      {
        card: 'main',
        via: 'file',
        argument: 'file',
        provides: 'size and sha256 of the dataset file',
        protected: false,
        hash: ['size', 'sha256'],
        volatile: [],
      },
    ],
    snapshot: true,
    follow_ups: [],
    freeze: [
      {
        path: 'ids.project_id',
        arg: 'project_id',
        explicit: true,
      },
    ],
    max_items: null,
  },
  undo: {
    reversible: 'yes',
    ways: [
      {
        tool: 'data_delete',
        how: 'the new dataset',
        for: 'create',
      },
    ],
    reason: null,
  },
  log: {
    args: 'Create dataset {name}',
    result: 'dataset {name}: {rows} rows',
  },
  route: null,
  description:
    'Create a dataset from a local file, from column rules (no AI), or as a copy of another; preview=true returns sample rows and saves nothing.',
  operations: [
    {
      operationId: 'create_feeder_api_v1_projects__project_id__gatling_feeders_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders',
    },
    {
      operationId:
        'generate_feeder_from_rules_api_v1_projects__project_id__gatling_feeders_generate_from_rules_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/generate-from-rules',
    },
    {
      operationId:
        'preview_feeder_recipe_api_v1_projects__project_id__gatling_feeders_preview_recipe_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/preview-recipe',
    },
    {
      operationId:
        'duplicate_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__duplicate_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/duplicate',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id'],
  state_writes: ['ids.dataset_ids'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: null,
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_update_dataset`: Update a dataset's definition or replace its rows from a file. Direct edit, only on the user's request; normally use data_ask_copilot. */
export const DATA_UPDATE_DATASET = {
  name: 'data_update_dataset',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_update_dataset',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'atomic',
  class: 'write',
  safety: 'write',
  secret: false,
  consent: {
    level: 2,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: ['secret_ref'],
    target_traffic: null,
    scope: {
      group: 'data:prepare',
      target: null,
    },
    cost: 'uploads the file when rows are replaced',
    card: {
      title: 'Update dataset {name}',
      fields: [
        {
          label: 'Dataset',
          from: 'dataset_id',
          source: 'args',
        },
        {
          label: 'Definition',
          from: 'definition',
          source: 'args',
        },
        {
          label: 'Rows from',
          from: 'file',
          source: 'args',
        },
        {
          label: 'File content',
          from: '(size and sha256 of the file)',
          source: 'resolve',
        },
      ],
    },
    resolve: [
      {
        card: 'main',
        via: 'file',
        argument: 'file',
        provides: 'size and sha256 of the rows file',
        protected: false,
        hash: ['size', 'sha256'],
        volatile: [],
      },
    ],
    snapshot: true,
    follow_ups: [],
    freeze: [
      {
        path: 'ids.project_id',
        arg: 'project_id',
        explicit: true,
      },
      {
        path: 'ids.dataset_ids',
        arg: 'dataset_ids',
        explicit: true,
      },
    ],
    max_items: null,
  },
  undo: {
    reversible: 'yes',
    ways: [
      {
        tool: 'data_restore_dataset',
        how: 'the previous content',
        for: 'update',
      },
      {
        tool: 'data_update_dataset',
        how: 'the previous definition',
        for: 'update',
      },
    ],
    reason: null,
  },
  log: {
    args: 'Update dataset {name}',
    result: 'dataset {name} updated',
  },
  route: 'direct',
  description:
    "Update a dataset's definition or replace its rows from a file. Direct edit, only on the user's request; normally use data_ask_copilot.",
  operations: [
    {
      operationId: 'update_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__put',
      method: 'PUT',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}',
    },
    {
      operationId:
        'replace_feeder_content_api_v1_projects__project_id__gatling_feeders__feeder_id__content_put',
      method: 'PUT',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/content',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.dataset_ids'],
  state_writes: ['ids.dataset_ids', 'steps.data.datasets_ready'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'dataset_id',
      type: 'uuid',
      from_state: 'ids.dataset_ids',
      doc: 'The dataset; default: the only one in this workspace.',
    },
    {
      name: 'name',
      type: 'string',
      min_length: 1,
      max_length: 255,
      from_state: null,
      doc: 'The new name.',
    },
    {
      name: 'description',
      type: 'string',
      max_length: 500,
      from_state: null,
      doc: 'The new description; an empty text clears it.',
    },
    {
      name: 'file',
      type: 'string',
      min_length: 1,
      max_length: 260,
      from_state: null,
      doc: "A CSV file of the project directory (relative path, up to 2 MB) whose rows replace the dataset's; the server reads it.",
    },
  ],
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_regenerate_dataset`: Regenerate a dataset's rows from its recipe: mode=expand adds rows, mode=reroll replaces all. */
export const DATA_REGENERATE_DATASET = {
  name: 'data_regenerate_dataset',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_regenerate_dataset',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'atomic',
  class: 'costly',
  safety: 'costly',
  secret: false,
  consent: {
    level: 2,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: {
      group: 'data:prepare',
      target: null,
    },
    cost: 'recipe generators; AI columns call the LLM',
    card: {
      title: 'Regenerate rows of dataset {name}',
      fields: [
        {
          label: 'Dataset',
          from: 'dataset_id',
          source: 'args',
        },
        {
          label: 'Mode',
          from: 'mode',
          source: 'args',
        },
        {
          label: 'Rows',
          from: 'rows',
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
        path: 'ids.dataset_ids',
        arg: 'dataset_ids',
        explicit: true,
      },
    ],
    max_items: null,
  },
  undo: {
    reversible: 'yes',
    ways: [
      {
        tool: 'data_restore_dataset',
        how: 'the previous content',
        for: 'update',
      },
    ],
    reason: null,
  },
  log: {
    args: 'Regenerate rows of dataset {name}',
    result: 'dataset {name}: {rows} rows',
  },
  route: null,
  description:
    "Regenerate a dataset's rows from its recipe: mode=expand adds rows, mode=reroll replaces all.",
  operations: [
    {
      operationId:
        'expand_feeder_dataset_api_v1_projects__project_id__gatling_feeders__feeder_id__expand_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/expand',
    },
    {
      operationId:
        'regenerate_feeder_dataset_api_v1_projects__project_id__gatling_feeders__feeder_id__regenerate_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/regenerate',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.dataset_ids'],
  state_writes: ['steps.data.datasets_ready'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'dataset_id',
      type: 'uuid',
      from_state: 'ids.dataset_ids',
      doc: 'The dataset; default: the only one in this workspace.',
    },
    {
      name: 'mode',
      type: 'enum',
      enum: ['expand', 'reroll'],
      required: true,
      from_state: null,
      doc: 'expand: add new rows up to `rows`, existing rows stay; reroll: replace all rows with fresh ones.',
    },
    {
      name: 'rows',
      type: 'integer',
      min: 1,
      max: 100000,
      from_state: null,
      doc: 'expand: the target row count (required, above the current count); reroll: the new row count (default: the current count).',
    },
  ],
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_restore_dataset`: Restore a dataset's previous content (a second call switches back). */
export const DATA_RESTORE_DATASET = {
  name: 'data_restore_dataset',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_restore_dataset',
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
        tool: 'data_restore_dataset',
        how: 'call it again',
        for: 'update',
      },
    ],
    reason: null,
  },
  log: {
    args: '{dataset_id}',
    result: '{name}: previous content restored',
  },
  route: null,
  description: "Restore a dataset's previous content (a second call switches back).",
  operations: [
    {
      operationId:
        'restore_previous_feeder_content_api_v1_projects__project_id__gatling_feeders__feeder_id__restore_previous_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/restore-previous',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.dataset_ids'],
  state_writes: ['steps.data.datasets_ready'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'dataset_id',
      type: 'uuid',
      from_state: 'ids.dataset_ids',
      doc: 'The dataset; default: the only one in this workspace.',
    },
  ],
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_delete`: Delete datasets (ids). force=true also deletes ones still in use. */
export const DATA_DELETE = {
  name: 'data_delete',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_delete',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'atomic',
  class: 'destructive',
  safety: 'destructive',
  secret: false,
  consent: {
    level: 3,
    level3_reason: 'delete',
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: null,
    cost: null,
    card: {
      title: 'Delete dataset: {names}',
      fields: [
        {
          label: 'Item',
          from: 'dataset_id (name resolved by the registry)',
          source: 'labels',
        },
        {
          label: 'Also in use',
          from: 'force',
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
        path: 'ids.dataset_ids',
        arg: 'dataset_ids',
        explicit: true,
      },
    ],
    max_items: null,
  },
  undo: {
    reversible: 'no',
    ways: [],
    reason: 'permanent',
  },
  log: {
    args: 'Delete dataset: {names}',
    result: '{count} datasets deleted',
  },
  route: null,
  description: 'Delete datasets (ids). force=true also deletes ones still in use.',
  operations: [
    {
      operationId: 'delete_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__delete',
      method: 'DELETE',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}',
    },
  ],
  also_calls: [
    'get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get',
    'get_feeder_used_in_api_v1_projects__project_id__gatling_feeders__feeder_id__used_in_get',
  ],
  channels: [],
  state_reads: ['ids.project_id', 'ids.dataset_ids'],
  state_writes: ['ids.dataset_ids', 'steps.data.datasets_ready'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: true,
  views: null,
  arguments: [
    {
      name: 'dataset_id',
      type: 'uuid',
      required: true,
      from_state: null,
      doc: 'The dataset to delete.',
    },
    {
      name: 'force',
      type: 'boolean',
      default: false,
      from_state: null,
      doc: 'Also delete it when scenarios or compositions still use it.',
    },
  ],
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_generate_dataset`: Generate and save a dataset with AI for a flow, a scenario or one data slot. */
export const DATA_GENERATE_DATASET = {
  name: 'data_generate_dataset',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_generate_dataset',
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
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: {
      group: 'data:prepare',
      target: null,
    },
    cost: 'about one LLM generation per dataset',
    card: {
      title: 'Generate a dataset with AI for {target}',
      fields: [
        {
          label: 'For',
          from: 'flow_id | scenario_id | slot',
          source: 'args',
        },
        {
          label: 'Rows',
          from: 'rows',
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
        path: 'ids.flow_ids',
        arg: 'flow_ids',
        explicit: true,
      },
      {
        path: 'ids.scenario_ids',
        arg: 'scenario_ids',
        explicit: true,
      },
    ],
    max_items: null,
  },
  undo: {
    reversible: 'yes',
    ways: [
      {
        tool: 'data_delete',
        how: 'the new dataset',
        for: 'create',
      },
    ],
    reason: null,
  },
  log: {
    args: 'Generate a dataset with AI for {target}',
    result: 'dataset {name}: {rows} rows',
  },
  route: null,
  description: 'Generate and save a dataset with AI for a flow, a scenario or one data slot.',
  operations: [
    {
      operationId:
        'generate_feeder_async_api_v1_projects__project_id__gatling_feeders_generate_async_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/generate-async',
    },
    {
      operationId:
        'generate_feeder_data_api_v1_projects__project_id__gatling_feeders_generate_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/generate',
    },
    {
      operationId:
        'generate_feeder_from_scenario_api_v1_projects__project_id__gatling_feeders_generate_from_scenario_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/generate-from-scenario',
    },
    {
      operationId:
        'generate_slot_feeder_api_v1_projects__project_id__gatling_scenarios__scenario_id__slots__slot__generate_feeder_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/slots/{slot}/generate-feeder',
    },
  ],
  also_calls: ['list_feeders_api_v1_projects__project_id__gatling_feeders_get'],
  channels: ['gatlingFeeder'],
  state_reads: ['ids.project_id', 'ids.flow_ids', 'ids.scenario_ids'],
  state_writes: ['ids.dataset_ids', 'operations', 'problems'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'flow_id',
      type: 'string',
      min_length: 1,
      max_length: 200,
      from_state: 'ids.flow_ids',
      doc: 'Generate for a flow: the data its steps need (give this or scenario_id).',
    },
    {
      name: 'scenario_id',
      type: 'string',
      min_length: 1,
      max_length: 200,
      from_state: 'ids.scenario_ids',
      doc: 'Generate for a scenario, or (with slot) for one of its data slots.',
    },
    {
      name: 'slot',
      type: 'string',
      min_length: 1,
      max_length: 100,
      from_state: null,
      doc: 'One data slot of the scenario (with scenario_id).',
    },
    {
      name: 'rows',
      type: 'integer',
      min: 1,
      max: 100000,
      default: 100,
      from_state: null,
      doc: 'How many rows to generate.',
    },
    {
      name: 'name',
      type: 'string',
      min_length: 1,
      max_length: 200,
      from_state: null,
      doc: 'The name of the new dataset; default: made from the target.',
    },
    {
      name: 'feeder_type',
      type: 'enum',
      enum: ['csv', 'tsv', 'json'],
      default: 'csv',
      from_state: null,
      doc: 'The file format of the dataset (not for a slot).',
    },
    {
      name: 'enrich_with_llm',
      type: 'boolean',
      default: true,
      from_state: null,
      doc: 'A slot only: let a model enrich the values (a cost).',
    },
  ],
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_regenerate_column`: Regenerate one column of a dataset with a generator or AI; preview=true saves nothing. */
export const DATA_REGENERATE_COLUMN = {
  name: 'data_regenerate_column',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_regenerate_column',
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
      when: 'preview=true z generatorem (bez LLM, niczego nie zapisuje)',
      level: 1,
      why: null,
      card: null,
    },
    escalate_to_3: [],
    target_traffic: null,
    scope: {
      group: 'data:prepare',
      target: null,
    },
    cost: 'a generator is free; AI is about one LLM call',
    card: {
      title: 'Regenerate column {column} of {name}',
      fields: [
        {
          label: 'Dataset',
          from: 'dataset_id',
          source: 'args',
        },
        {
          label: 'Column',
          from: 'column',
          source: 'args',
        },
        {
          label: 'With',
          from: 'generator | AI',
          source: 'args',
        },
        {
          label: 'Preview only',
          from: 'preview',
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
        path: 'ids.dataset_ids',
        arg: 'dataset_ids',
        explicit: true,
      },
    ],
    max_items: null,
  },
  undo: {
    reversible: 'yes',
    ways: [
      {
        tool: 'data_restore_dataset',
        how: 'the previous content',
        for: 'update',
      },
    ],
    reason: null,
  },
  log: {
    args: 'Regenerate column {column} of {name}',
    result: 'column {column}: {rows} rows',
  },
  route: null,
  description:
    'Regenerate one column of a dataset with a generator or AI; preview=true saves nothing.',
  operations: [
    {
      operationId:
        'regenerate_single_feeder_column_api_v1_projects__project_id__gatling_feeders__feeder_id__regenerate_column_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/regenerate-column',
    },
  ],
  also_calls: [],
  channels: ['gatlingFeeder'],
  state_reads: ['ids.project_id', 'ids.dataset_ids'],
  state_writes: ['operations', 'problems'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: null,
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_get_generators`: Get the column generators for dataset rules, or guesses for given column names. */
export const DATA_GET_GENERATORS = {
  name: 'data_get_generators',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_get_generators',
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
    args: '',
    result: '{count} generators',
  },
  route: null,
  description: 'Get the column generators for dataset rules, or guesses for given column names.',
  operations: [
    {
      operationId:
        'list_recipe_generators_api_v1_projects__project_id__gatling_feeders_generators_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/gatling/feeders/generators',
    },
    {
      operationId:
        'guess_recipe_generators_api_v1_projects__project_id__gatling_feeders_generators_guess_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/generators/guess',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'columns',
      type: 'string',
      min_length: 1,
      max_length: 2000,
      from_state: null,
      doc: 'Column names to guess generators for, comma-separated (at most 50); without it, the list of all generators.',
    },
  ],
  shows_content: null,
  install_allow: true,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_check_dataset`: Check a dataset against the target: sign in with row 1, look up entities (database: test the connection). Sends requests to the target. */
export const DATA_CHECK_DATASET = {
  name: 'data_check_dataset',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_check_dataset',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'atomic',
  class: 'write+secret',
  safety: 'write',
  secret: true,
  consent: {
    level: 2,
    level3_reason: null,
    by_argument: null,
    escalate_to_3: ['protected_env'],
    target_traffic: 'probe',
    scope: {
      group: 'data:check',
      target: null,
    },
    cost: 'traffic: one sign-in and a few lookups',
    card: {
      title: 'Check dataset {name} against {env}',
      fields: [
        {
          label: 'Dataset',
          from: 'dataset_id',
          source: 'args',
        },
        {
          label: 'Environment',
          from: 'env',
          source: 'args',
        },
        {
          label: 'Signs in as',
          from: '(role or slot of the dataset, never values)',
          source: 'resolve',
        },
        {
          label: 'Requests',
          from: '(one sign-in plus up to 3 lookups per id column)',
          source: 'resolve',
        },
      ],
    },
    resolve: [
      {
        card: 'main',
        via: 'get',
        operationId:
          'get_environment_api_v1_projects__project_id__environments__environment_id__get',
        method: 'GET',
        path: '/api/v1/projects/{project_id}/environments/{environment_id}',
        provides: 'protected flag of the environment',
        protected: true,
        hash: ['id', 'protected'],
        volatile: [],
      },
      {
        card: 'main',
        via: 'get',
        operationId: 'get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get',
        method: 'GET',
        path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}',
        provides: 'columns and their semantics (sign-in role or slot; names only, never values)',
        protected: false,
        hash: ['columns', 'column_semantics'],
        volatile: [],
      },
    ],
    snapshot: true,
    follow_ups: [],
    freeze: [
      {
        path: 'choices.run.env_id',
        arg: 'env',
        explicit: true,
      },
      {
        path: 'ids.project_id',
        arg: 'project_id',
        explicit: true,
      },
      {
        path: 'ids.dataset_ids',
        arg: 'dataset_ids',
        explicit: true,
      },
      {
        path: 'ids.env_id',
        arg: 'env',
        explicit: true,
      },
    ],
    max_items: null,
  },
  undo: {
    reversible: 'nothing',
    ways: [],
    reason: 'read-only probes',
  },
  log: {
    args: 'Check dataset {name} against {env}',
    result: 'sign-in: {ok}; {found}/{checked} entities found',
  },
  route: null,
  description:
    'Check a dataset against the target: sign in with row 1, look up entities (database: test the connection). Sends requests to the target.',
  operations: [
    {
      operationId:
        'probe_feeder_against_target_api_v1_projects__project_id__gatling_feeders__feeder_id__probe_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/probe',
    },
    {
      operationId:
        'gatling_feeder_jdbc_test_connection_api_v1_projects__project_id__gatling_feeders_jdbc_test_connection_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/jdbc/test-connection',
    },
    {
      operationId:
        'gatling_feeder_jdbc_preview_api_v1_projects__project_id__gatling_feeders__feeder_id__jdbc_preview_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/jdbc/preview',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.dataset_ids', 'ids.env_id', 'choices.run.env_id'],
  state_writes: ['problems'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: true,
  views: null,
  arguments: null,
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `data_create_accounts`: Create test accounts in the target system through its register request and append them to a dataset. Passwords are never returned. */
export const DATA_CREATE_ACCOUNTS = {
  name: 'data_create_accounts',
  module: 'data',
  full_name: 'mcp__plugin_loadcraft_lc__data_create_accounts',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'process',
  class: 'costly+secret',
  safety: 'costly',
  secret: true,
  consent: {
    level: 3,
    level3_reason: 'traffic',
    by_argument: null,
    escalate_to_3: [],
    target_traffic: 'run',
    scope: null,
    cost: '{count} register requests to the target',
    card: {
      title: 'Create {count} test accounts in {env}',
      fields: [
        {
          label: 'Slot',
          from: 'slot',
          source: 'args',
        },
        {
          label: 'Count',
          from: 'count',
          source: 'args',
        },
        {
          label: 'Environment',
          from: 'env',
          source: 'args',
        },
        {
          label: 'Register request',
          from: '(from the scenario)',
          source: 'resolve',
        },
        {
          label: 'Append to dataset',
          from: 'dataset_id',
          source: 'args',
        },
      ],
    },
    resolve: [
      {
        card: 'main',
        via: 'get',
        operationId:
          'get_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__get',
        method: 'GET',
        path: '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}',
        provides: 'the register request of the scenario (its contract)',
        protected: false,
        hash: ['scenario_contract_v2'],
        volatile: [],
      },
    ],
    snapshot: true,
    follow_ups: [],
    freeze: [
      {
        path: 'choices.run.env_id',
        arg: 'env',
        explicit: true,
      },
      {
        path: 'ids.project_id',
        arg: 'project_id',
        explicit: true,
      },
      {
        path: 'ids.dataset_ids',
        arg: 'dataset_ids',
        explicit: true,
      },
      {
        path: 'ids.env_id',
        arg: 'env',
        explicit: true,
      },
    ],
    max_items: null,
  },
  undo: {
    reversible: 'no',
    ways: [],
    reason: 'the accounts stay in the target system',
  },
  log: {
    args: 'Create {count} test accounts in {env}',
    result: '{created} accounts created, {failed} failed',
  },
  route: null,
  description:
    'Create test accounts in the target system through its register request and append them to a dataset. Passwords are never returned.',
  operations: [
    {
      operationId:
        'provision_feeder_accounts_api_v1_projects__project_id__gatling_feeders__feeder_id__provision_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/provision',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'ids.dataset_ids', 'ids.env_id', 'choices.run.env_id'],
  state_writes: ['steps.data.accounts', 'steps.data.datasets_ready', 'operations', 'problems'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: true,
  views: null,
  arguments: null,
  shows_content: null,
  install_allow: false,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;
