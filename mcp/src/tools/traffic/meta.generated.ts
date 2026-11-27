/**
 * Generated file - do not edit.
 * Source: catalog/katalog.json, module traffic. Regenerate with "npm run gen:tools" (from mcp/).
 */

import type { ToolMeta } from '../moduleTool.js';

/** `traffic_list_snapshots`: List traffic snapshots, newest first, with quality summary and limits; include=format_sample adds the packet format by example. */
export const TRAFFIC_LIST_SNAPSHOTS = {
  name: 'traffic_list_snapshots',
  module: 'traffic',
  full_name: 'mcp__plugin_loadcraft_lc__traffic_list_snapshots',
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
    result: '{count} snapshots',
  },
  route: null,
  description:
    'List traffic snapshots, newest first, with quality summary and limits; include=format_sample adds the packet format by example.',
  operations: [
    {
      operationId: 'list_snapshots_api_v1_projects__project_id__production_traffic_snapshots_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/production-traffic/snapshots',
    },
    {
      operationId:
        'get_traffic_samples_api_v1_projects__project_id__production_traffic_samples_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/production-traffic/samples',
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
      name: 'include',
      type: 'string[]',
      enum: ['format_sample'],
      max_items: 1,
      from_state: null,
      doc: '"format_sample": the field names and shape of a traffic packet (no values).',
    },
    {
      name: 'limit',
      type: 'integer',
      min: 1,
      max: 100,
      default: 20,
      from_state: null,
      doc: 'How many snapshots to return (1-100).',
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

/** `traffic_get_snapshot`: Get one snapshot: quality report, excluded windows, per-route series (summarized by default). */
export const TRAFFIC_GET_SNAPSHOT = {
  name: 'traffic_get_snapshot',
  module: 'traffic',
  full_name: 'mcp__plugin_loadcraft_lc__traffic_get_snapshot',
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
    args: '{snapshot_id}',
    result: '{name}: quality {quality}',
  },
  route: null,
  description:
    'Get one snapshot: quality report, excluded windows, per-route series (summarized by default).',
  operations: [
    {
      operationId:
        'get_snapshot_api_v1_projects__project_id__production_traffic_snapshots__snapshot_id__get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/production-traffic/snapshots/{snapshot_id}',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id', 'choices.run.traffic_snapshot_id'],
  state_writes: [],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: false,
  views: null,
  arguments: [
    {
      name: 'snapshot_id',
      type: 'uuid',
      from_state: 'choices.run.traffic_snapshot_id',
      doc: 'The snapshot; default: the one chosen for runs of this workspace.',
    },
    {
      name: 'series',
      type: 'enum',
      enum: ['summary', 'points'],
      default: 'summary',
      from_state: null,
      doc: 'summary: per route the count, min, max and sum; points: up to 20 routes of 60 points.',
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

/** `traffic_import_snapshot`: Import a production traffic file (JSON or CSV): validate it and, with save=true, store it as a snapshot. */
export const TRAFFIC_IMPORT_SNAPSHOT = {
  name: 'traffic_import_snapshot',
  module: 'traffic',
  full_name: 'mcp__plugin_loadcraft_lc__traffic_import_snapshot',
  tier: 'pipeline',
  audience: 'model',
  always_load: false,
  kind: 'composite',
  class: 'write',
  safety: 'write',
  secret: false,
  consent: {
    level: 2,
    level3_reason: null,
    by_argument: {
      when: 'save=false (sama walidacja)',
      level: 1,
      why: null,
      card: null,
    },
    escalate_to_3: [],
    target_traffic: null,
    scope: {
      group: 'traffic:snapshot',
      target: null,
    },
    cost: 'uploads the file',
    card: {
      title: 'Import traffic snapshot from {file}',
      fields: [
        {
          label: 'File',
          from: 'file',
          source: 'args',
        },
        {
          label: 'Save',
          from: 'save',
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
        provides: 'size and sha256 of the snapshot file',
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
        tool: 'traffic_delete',
        how: 'kind=snapshot',
        for: 'create',
      },
    ],
    reason: null,
  },
  log: {
    args: 'Import traffic snapshot from {file}',
    result: 'snapshot {name}: quality {quality}',
  },
  route: null,
  description:
    'Import a production traffic file (JSON or CSV): validate it and, with save=true, store it as a snapshot.',
  operations: [
    {
      operationId:
        'preview_snapshot_api_v1_projects__project_id__production_traffic_snapshots_preview_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/production-traffic/snapshots/preview',
    },
    {
      operationId: 'save_snapshot_api_v1_projects__project_id__production_traffic_snapshots_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/production-traffic/snapshots',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id'],
  state_writes: ['choices.run.traffic_snapshot_id', 'steps.traffic.snapshot', 'problems'],
  next_steps: ['traffic_list_snapshots'],
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

/** `traffic_delete`: Delete traffic snapshots or revoke push tokens (kind + ids). Runs using a snapshot are not checked. */
export const TRAFFIC_DELETE = {
  name: 'traffic_delete',
  module: 'traffic',
  full_name: 'mcp__plugin_loadcraft_lc__traffic_delete',
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
      title: 'Delete {kind}: {names}',
      fields: [
        {
          label: 'Kind',
          from: 'kind',
          source: 'args',
        },
        {
          label: 'Item',
          from: 'item_id (name resolved by the registry)',
          source: 'labels',
        },
      ],
    },
    resolve: [],
    snapshot: false,
    follow_ups: [],
    freeze: [
      {
        path: 'choices.run.traffic_snapshot_id',
        arg: 'item_id',
        explicit: true,
      },
      {
        path: 'ids.project_id',
        arg: 'project_id',
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
    args: 'Delete {kind}: {names}',
    result: '{count} {kind} deleted',
  },
  route: null,
  description:
    'Delete traffic snapshots or revoke push tokens (kind + ids). Runs using a snapshot are not checked.',
  operations: [
    {
      operationId:
        'delete_snapshot_api_v1_projects__project_id__production_traffic_snapshots__snapshot_id__delete',
      method: 'DELETE',
      path: '/api/v1/projects/{project_id}/production-traffic/snapshots/{snapshot_id}',
    },
    {
      operationId:
        'revoke_ingest_token_api_v1_projects__project_id__production_traffic_tokens__token_id__delete',
      method: 'DELETE',
      path: '/api/v1/projects/{project_id}/production-traffic/tokens/{token_id}',
    },
  ],
  also_calls: [
    'get_snapshot_api_v1_projects__project_id__production_traffic_snapshots__snapshot_id__get',
    'list_ingest_tokens_api_v1_projects__project_id__production_traffic_tokens_get',
  ],
  channels: [],
  state_reads: ['ids.project_id', 'choices.run.traffic_snapshot_id'],
  state_writes: ['choices.run.traffic_snapshot_id', 'steps.traffic.snapshot'],
  next_steps: [],
  pending_operations: null,
  requires_capability: null,
  requires_user_interaction: true,
  views: null,
  arguments: [
    {
      name: 'kind',
      type: 'enum',
      enum: ['snapshot', 'token'],
      required: true,
      from_state: null,
      doc: 'What to delete: a traffic snapshot or a push token (revoked).',
    },
    {
      name: 'item_id',
      type: 'uuid',
      required: true,
      from_state: null,
      doc: 'The snapshot or token to delete.',
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

/** `traffic_get_push_setup`: Get the setup for pushing traffic from production: sender address and recipe, excluded run windows, existing push tokens (no secrets). */
export const TRAFFIC_GET_PUSH_SETUP = {
  name: 'traffic_get_push_setup',
  module: 'traffic',
  full_name: 'mcp__plugin_loadcraft_lc__traffic_get_push_setup',
  tier: 'extended',
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
    args: '',
    result: '{tokens} push tokens',
  },
  route: null,
  description:
    'Get the setup for pushing traffic from production: sender address and recipe, excluded run windows, existing push tokens (no secrets).',
  operations: [
    {
      operationId: 'get_ingest_recipe_api_v1_projects__project_id__production_traffic_recipe_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/production-traffic/recipe',
    },
    {
      operationId: 'list_ingest_tokens_api_v1_projects__project_id__production_traffic_tokens_get',
      method: 'GET',
      path: '/api/v1/projects/{project_id}/production-traffic/tokens',
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
  install_allow: true,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    override_reason: null,
  },
  known_debt: null,
} as const satisfies ToolMeta;

/** `traffic_create_token`: Create a push token; its secret is written to a local file and never returned. */
export const TRAFFIC_CREATE_TOKEN = {
  name: 'traffic_create_token',
  module: 'traffic',
  full_name: 'mcp__plugin_loadcraft_lc__traffic_create_token',
  tier: 'extended',
  audience: 'model',
  always_load: false,
  kind: 'atomic',
  class: 'write+secret',
  safety: 'write',
  secret: true,
  consent: {
    level: 3,
    level3_reason: 'secret',
    by_argument: null,
    escalate_to_3: [],
    target_traffic: null,
    scope: null,
    cost: null,
    card: {
      title: 'Create a traffic push token',
      fields: [
        {
          label: 'Name',
          from: 'name',
          source: 'args',
        },
        {
          label: 'Secret written to',
          from: '(local file, mode 0600)',
          source: 'derived',
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
    ],
    max_items: null,
  },
  undo: {
    reversible: 'yes',
    ways: [
      {
        tool: 'traffic_delete',
        how: 'kind=token revokes it',
        for: 'create',
      },
    ],
    reason: null,
  },
  log: {
    args: 'Create a traffic push token',
    result: 'token {name} created; secret in {path}',
  },
  route: null,
  description: 'Create a push token; its secret is written to a local file and never returned.',
  operations: [
    {
      operationId:
        'create_ingest_token_api_v1_projects__project_id__production_traffic_tokens_post',
      method: 'POST',
      path: '/api/v1/projects/{project_id}/production-traffic/tokens',
    },
  ],
  also_calls: [],
  channels: [],
  state_reads: ['ids.project_id'],
  state_writes: [],
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
