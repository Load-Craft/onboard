/**
 * Generated file - do not edit.
 * Source: catalog/katalog.json. Regenerate with "npm run gen:catalog" (from mcp/).
 */

import type { OperationId } from './http/generated/operations.js';
import type { ChannelId } from './ws/generated/channels.js';

export const TOOL_NAMES = [
  "process_get_status",
  "process_wait",
  "process_cancel",
  "process_answer",
  "process_set_choices",
  "process_set_decision",
  "project_list",
  "project_get",
  "project_create",
  "project_update",
  "project_set_profile",
  "project_delete",
  "project_get_envs",
  "project_save_env",
  "project_check_env",
  "project_get_docs",
  "project_get_endpoints",
  "project_import_docs",
  "project_set_active_docs",
  "project_analyze_setup",
  "project_apply_setup",
  "project_get_apimap",
  "project_set_apimap",
  "project_connect_telemetry",
  "project_disconnect_telemetry",
  "project_list_notes",
  "project_update_note",
  "project_list_team",
  "project_save_member",
  "project_get_activity",
  "project_get_http_settings",
  "project_set_http_settings",
  "flows_suggest_journeys",
  "flows_generate_from_suggestions",
  "flows_generate_from_endpoints",
  "flows_generate_from_har",
  "flows_regenerate",
  "flows_import_har",
  "flows_describe_journeys",
  "flows_record_journeys",
  "flows_get_walks",
  "flows_retry_walk",
  "flows_save_walk_note",
  "flows_export_walk_image",
  "flows_list",
  "flows_get",
  "flows_get_versions",
  "flows_restore_version",
  "flows_save",
  "flows_delete",
  "flows_duplicate",
  "flows_migrate_docs",
  "flows_merge",
  "flows_set_poll_terminals",
  "flows_ask_copilot",
  "flows_apply_copilot_changes",
  "flows_get_copilot_history",
  "scenario_list",
  "scenario_get",
  "scenario_save",
  "scenario_delete",
  "scenario_generate",
  "scenario_regenerate",
  "scenario_check_self",
  "scenario_check_drift",
  "scenario_export",
  "scenario_get_versions",
  "scenario_restore_version",
  "scenario_suggest_split",
  "scenario_ask_copilot",
  "scenario_get_copilot_history",
  "scenario_list_compositions",
  "scenario_get_composition",
  "scenario_save_composition",
  "scenario_check_composition",
  "scenario_compile_composition",
  "scenario_get_composition_code",
  "scenario_update_pins",
  "scenario_set_composition_type",
  "scenario_get_templates",
  "data_suggest_actions",
  "data_ask_copilot",
  "data_get_copilot_history",
  "data_get_slots",
  "data_set_bindings",
  "data_set_slot_label",
  "data_check_readiness",
  "data_list_datasets",
  "data_get_dataset",
  "data_create_dataset",
  "data_update_dataset",
  "data_regenerate_dataset",
  "data_restore_dataset",
  "data_delete",
  "data_generate_dataset",
  "data_regenerate_column",
  "data_get_generators",
  "data_check_dataset",
  "data_create_accounts",
  "run_plan",
  "run_start",
  "run_start_saved",
  "run_list",
  "run_get",
  "run_delete",
  "run_get_profiles",
  "run_save_profile",
  "run_get_saved",
  "run_save",
  "run_set_schedule",
  "run_get_usage",
  "results_get_report",
  "results_get_request",
  "results_get_errors",
  "results_get_traces",
  "results_get_logs",
  "results_export_report",
  "results_check_production",
  "results_compare_runs",
  "results_set_baseline",
  "results_analyze_run",
  "traffic_list_snapshots",
  "traffic_get_snapshot",
  "traffic_import_snapshot",
  "traffic_delete",
  "traffic_get_push_setup",
  "traffic_create_token",
  "functional_get_catalog",
  "functional_save_catalog",
  "functional_import_catalog",
  "functional_get_test_types",
  "functional_save_test_types",
  "functional_suggest_test_types",
  "functional_generate_test_types",
  "functional_get_validators",
  "functional_save_validators",
  "functional_suggest_validators",
  "functional_get_analytics",
  "functional_get_flows",
  "functional_save_flow",
  "functional_restore_flow",
  "functional_get_templates",
  "functional_save_template",
  "functional_delete",
  "functional_start_run",
  "functional_get_runs",
  "functional_get_results",
  "functional_compare_runs",
  "functional_generate_payloads",
  "github_get_status",
  "github_connect",
  "github_plan_push",
  "github_push",
  "github_get_changes",
  "github_disconnect"
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const MODULE_NAMES = [
  "process",
  "project",
  "flows",
  "scenario",
  "data",
  "run",
  "results",
  "traffic",
  "functional",
  "github"
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

export interface CatalogCardField {
  readonly label: string;
  readonly from: string;
  readonly source: string;
}

export interface CatalogCard {
  readonly title: string;
  readonly fields: readonly CatalogCardField[];
  readonly cost?: string;
}

export interface CatalogConsent {
  readonly level: 1 | 2 | 3;
  readonly level3_reason: string | null;
  readonly by_argument: {
    readonly when: string;
    readonly level: 1 | 2 | 3;
    readonly why: string | null;
    readonly card: CatalogCard | null;
  } | null;
  readonly escalate_to_3: readonly string[];
  readonly target_traffic: string | null;
  readonly scope: { readonly group: string; readonly target: string | null } | null;
  readonly cost: string | null;
  readonly card: CatalogCard | null;
  readonly resolve: readonly Readonly<Record<string, unknown>>[];
  readonly snapshot: boolean;
  readonly follow_ups: readonly ToolName[];
  readonly freeze: readonly Readonly<Record<string, unknown>>[];
  /** The most items one call of the tool may name (a delete); null when the catalog sets no limit. */
  readonly max_items: number | null;
}

export interface CatalogUndo {
  readonly reversible: string | null;
  readonly ways: readonly Readonly<Record<string, unknown>>[];
  readonly reason: string | null;
}

export interface CatalogTool {
  readonly name: ToolName;
  readonly module: ModuleName;
  readonly full_name: string;
  readonly v1_name: string | null;
  readonly tier: 'core' | 'pipeline' | 'extended';
  readonly audience: 'model' | 'mod';
  readonly always_load: boolean;
  readonly kind: 'atomic' | 'composite' | 'process';
  readonly class:
    | 'read'
    | 'write'
    | 'destructive'
    | 'costly'
    | 'read+secret'
    | 'write+secret'
    | 'costly+secret';
  readonly safety: string;
  readonly secret: boolean;
  readonly consent: CatalogConsent;
  readonly undo: CatalogUndo;
  readonly log: { readonly args: string; readonly result: string };
  readonly route: string | null;
  readonly description: string;
  /** Tools the result of this one names as the next step. */
  readonly next_steps: readonly ToolName[];
  /** The backend operations a tool still waits for (an id of the plan); null when none. */
  readonly pending_operations: string | null;
  /** The capability of `GET /api/v1/meta` the tool needs; null when it needs none. */
  readonly requires_capability: string | null;
  /** A deviation of the tool from its catalog entry the maintainers know of (in words); null when none. */
  readonly known_debt: string | null;
  /** The tool asks the user in a dialog of the client (a server question), so it cannot run without one. */
  readonly requires_user_interaction: boolean;
  /** The install instructions list the tool as allowed without a permission prompt. */
  readonly install_allow: boolean;
  /** The paged lists a tool returns beside its text: which detail, the item type and the page size. */
  readonly views: readonly Readonly<Record<string, unknown>>[] | null;
  /** The arguments of the tool that the process state fills when the caller omits them. */
  readonly arguments:
    | readonly {
        readonly name: string;
        readonly type: string;
        readonly from_state: string | null;
        /** Further facts of the argument (doc, required, default, enum, min, max, …). */
        readonly [key: string]: unknown;
      }[]
    | null;
  /** The content of a third party the tool shows, and what is done with a part the plugin cannot read. */
  readonly shows_content: {
    readonly what: string;
    readonly unrecognized: string;
  } | null;
  /**
   * The MCP hints the catalog fixes, with the reason when they differ from the class; absent in a
   * catalog that does not give them (the hints then follow the class and the level).
   */
  readonly annotations?: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly override_reason: string | null;
  } | null;
}

export interface CatalogModule {
  readonly name: ModuleName;
  readonly tier: 'core' | 'pipeline' | 'extended';
  readonly subagent: string | null;
  readonly skill: string;
  readonly state_in: string;
  readonly state_out: string;
  readonly subagent_tools: readonly ToolName[] | null;
  readonly subagent_tools_default_mode: readonly ToolName[] | null;
  readonly subagent_model: string | null;
  readonly counts: Readonly<Record<string, number>>;
  readonly tools: readonly ToolName[];
}

export interface StateInvalidation {
  readonly event: string;
  readonly triggers: readonly string[];
  readonly invalidates: readonly string[];
}

/**
 * When a check is required: always (true), never (false), or while the state field `when` (a path in the
 * process, such as choices.flows.method) holds one of the values `in`.
 */
export type CheckRequired =
  | boolean
  | { readonly when: string; readonly in: readonly (string | boolean)[] };

/** A check a step stores under steps.<module>.<check>. */
export interface StateCheck {
  readonly path: string;
  readonly module: ModuleName;
  readonly check: string;
  readonly type: string;
  readonly description: string;
  readonly writers: readonly string[];
  readonly readers: readonly string[];
  readonly required: CheckRequired;
}

export interface WsFrame {
  readonly channel: string;
  readonly frame: string;
  readonly effect: string;
  readonly resume: string;
}

/** A problem code with a fixed rule: its severity, its fields, and the tools that set, clear and show it. */
export interface ProblemCode {
  readonly code: string;
  readonly severity: 'blocker' | 'warning';
  readonly fields: readonly string[];
  readonly set_by: readonly string[];
  readonly cleared_by: readonly string[];
  readonly shown_by: readonly string[];
}

export const CATALOG: Readonly<Record<ToolName, CatalogTool>> = {
  "process_get_status": {
    "name": "process_get_status",
    "module": "process",
    "full_name": "mcp__plugin_loadcraft_lc__process_get_status",
    "v1_name": "process_get_status",
    "tier": "core",
    "audience": "model",
    "always_load": true,
    "kind": "composite",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "detail={detail} view={view}",
      "result": "step {step}; {pending} pending, {running} running, {problems} problems"
    },
    "route": null,
    "description": "Get the process state: step, next action, pending cards, running operations, problems. Start here and after /clear.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": [
      {
        "detail": "flows",
        "item": "FlowListItem",
        "page": {
          "default": 20,
          "max": 100
        },
        "args": [
          "offset",
          "limit"
        ],
        "ref": "suggestions:list:flows:<project_id>"
      },
      {
        "detail": "runs",
        "item": "RunListItem",
        "page": {
          "default": 20,
          "max": 100
        },
        "args": [
          "offset",
          "limit"
        ],
        "ref": "suggestions:list:runs:<project_id>"
      }
    ],
    "arguments": null,
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "process_wait": {
    "name": "process_wait",
    "module": "process",
    "full_name": "mcp__plugin_loadcraft_lc__process_wait",
    "v1_name": "process_wait",
    "tier": "core",
    "audience": "model",
    "always_load": true,
    "kind": "process",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{handle}",
      "result": "{handle}: {status}"
    },
    "route": null,
    "description": "Wait on a running operation by handle; returns the starting tool's result, or the handle again when the call times out.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "process_cancel": {
    "name": "process_cancel",
    "module": "process",
    "full_name": "mcp__plugin_loadcraft_lc__process_cancel",
    "v1_name": "process_cancel",
    "tier": "core",
    "audience": "model",
    "always_load": true,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": {
        "when": "uchwyt wskazuje trwający przebieg obciążeniowy albo funkcjonalny (każdy wołający: zgodę daje pytanie serwera)",
        "level": 3,
        "why": "stop",
        "card": {
          "title": "Stop run {handle}",
          "fields": [
            {
              "label": "Run",
              "from": "handle",
              "source": "args"
            },
            {
              "label": "Elapsed",
              "from": "(from the last reading)",
              "source": "resolve"
            },
            {
              "label": "Requests sent",
              "from": "(from the last reading)",
              "source": "resolve"
            }
          ],
          "cost": "the run ends now; its partial results are kept"
        }
      },
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [
        {
          "card": "alt",
          "via": "get",
          "operationId": "get_execution_api_v1_projects__project_id__gatling_executions__execution_id__get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/gatling/executions/{execution_id}",
          "provides": "elapsed time and request counter of a load run",
          "protected": false,
          "hash": [
            "id",
            "status"
          ],
          "volatile": [
            "elapsed",
            "requests_sent"
          ]
        },
        {
          "card": "alt",
          "via": "get",
          "operationId": "get_execution_api_v1_projects__project_id__executions__execution_id__get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/executions/{execution_id}",
          "provides": "elapsed time and request counter of a functional run",
          "protected": false,
          "hash": [
            "id",
            "status"
          ],
          "volatile": [
            "elapsed",
            "requests_sent"
          ]
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.run_id",
          "arg": "run_id",
          "explicit": true
        },
        {
          "path": "ids.functional_run_id",
          "arg": "retry_of",
          "explicit": true
        },
        {
          "path": "ids.har_session_id",
          "arg": "har_session_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "a cancelled operation cannot be resumed; what was built is kept"
    },
    "log": {
      "args": "{handle}",
      "result": "{handle}: cancelled"
    },
    "route": null,
    "description": "Cancel a running operation by its handle (a load run also by its id); what was already built is kept.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "process_answer": {
    "name": "process_answer",
    "module": "process",
    "full_name": "mcp__plugin_loadcraft_lc__process_answer",
    "v1_name": "process_answer",
    "tier": "core",
    "audience": "model",
    "always_load": true,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "every call it ran has its own log entry with its own undo"
    },
    "log": {
      "args": "{id} {answer}",
      "result": "{id}: {answer}; {done} calls done, {failed} failed"
    },
    "route": null,
    "description": "Answer a pending card by id: yes runs its stored calls with their stored arguments (needs the user's decision), no drops them.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "process_set_choices": {
    "name": "process_set_choices",
    "module": "process",
    "full_name": "mcp__plugin_loadcraft_lc__process_set_choices",
    "v1_name": "process_set_choices",
    "tier": "core",
    "audience": "model",
    "always_load": true,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "process_set_choices",
          "how": "the previous values (kept in the log entry)",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{keys}",
      "result": "{changed}"
    },
    "route": null,
    "description": "Set user decisions (flow method, journeys, traffic split, environment, load profile, run target) that module tools use as defaults.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "choices",
        "type": "object",
        "from_state": null,
        "required": true,
        "doc": "The choices to set, grouped as the process state groups them (flows, scenario, run, data, functional); null clears a field."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "process_set_decision": {
    "name": "process_set_decision",
    "module": "process",
    "full_name": "mcp__plugin_loadcraft_lc__process_set_decision",
    "v1_name": null,
    "tier": "core",
    "audience": "mod",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "a decision is final; value=no before the card runs withdraws a yes"
    },
    "log": {
      "args": "{id} {value}",
      "result": "{id}: {value}"
    },
    "route": null,
    "description": "Panel only: set the user's decision (yes, no, change, undo) on a pending card or a log entry. Calls from the model are refused.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_list": {
    "name": "project_list",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_list",
    "v1_name": "project_list",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{query}",
      "result": "{count} projects"
    },
    "route": null,
    "description": "List projects, or search projects, flows, scenarios and runs by text.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "query",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": null,
        "doc": "Search projects, flows, scenarios and runs by this text; without it, the list of projects."
      },
      {
        "name": "is_active",
        "type": "boolean",
        "from_state": null,
        "doc": "Only active (true) or inactive (false) projects (the list, not the search)."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 100,
        "default": 50,
        "from_state": null,
        "doc": "How many projects or search hits to return (1-100)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_get": {
    "name": "project_get",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_get",
    "v1_name": "project_get",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "include={include}",
      "result": "{name}"
    },
    "route": null,
    "description": "Get a project's profile; include adds statistics, setup readiness, log server.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_create": {
    "name": "project_create",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_create",
    "v1_name": "project_create",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "project:setup",
        "target": null
      },
      "cost": null,
      "card": {
        "title": "Create project {name}",
        "fields": [
          {
            "label": "Name",
            "from": "name",
            "source": "args"
          },
          {
            "label": "Description",
            "from": "description",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "project_delete",
          "how": "kind=project",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Create project {name}",
      "result": "project {name} {created|adopted}"
    },
    "route": null,
    "description": "Create a project, or adopt the one with the same name, and bind this workspace to it.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_update": {
    "name": "project_update",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_update",
    "v1_name": "project_update",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "project_update",
          "how": "the previous name and description",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{name}",
      "result": "{changed}"
    },
    "route": null,
    "description": "Update a project's name or description.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "name",
        "type": "string",
        "min_length": 1,
        "max_length": 255,
        "from_state": null,
        "doc": "The project's new name; a name another project uses is refused."
      },
      {
        "name": "description",
        "type": "string",
        "max_length": 8000,
        "from_state": null,
        "doc": "The project's new description; an empty text clears it."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_set_profile": {
    "name": "project_set_profile",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_set_profile",
    "v1_name": null,
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "project:profile",
        "target": null
      },
      "cost": null,
      "card": {
        "title": "Set {n} profile fields of the project",
        "fields": [
          {
            "label": "Fields",
            "from": "fields",
            "source": "args"
          },
          {
            "label": "Current values",
            "from": "(project profile now)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "get_project_api_v1_projects__project_id__get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}",
          "provides": "the current project profile",
          "protected": false,
          "hash": [
            "project_profile"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "project_set_profile",
          "how": "the previous values of the fields (kept in the log entry)",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Set {n} profile fields of the project",
      "result": "{n} fields set: {fields}"
    },
    "route": null,
    "description": "Set fields of the project profile (architecture, auth, protocol, flags); other fields are kept. Changes how flows are generated.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": "Karta zgody poziomu 2 działa wzorcem confirm z tokenem, bo ogólnych kart pending i process_answer jeszcze nie ma; po ich wdrożeniu narzędzie przechodzi na kartę z katalogu."
  },
  "project_delete": {
    "name": "project_delete",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_delete",
    "v1_name": "project_delete",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "destructive",
    "safety": "destructive",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "delete",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": {
        "title": "Delete {kind}: {names}",
        "fields": [
          {
            "label": "Kind",
            "from": "kind",
            "source": "args"
          },
          {
            "label": "Items",
            "from": "ids (names resolved by the registry)",
            "source": "labels"
          },
          {
            "label": "Max per card",
            "from": "(5 projects)",
            "source": "derived"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.env_id",
          "arg": "env",
          "explicit": true
        }
      ],
      "max_items": 5
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "permanent"
    },
    "log": {
      "args": "Delete {kind}: {names}",
      "result": "{count} {kind} deleted"
    },
    "route": null,
    "description": "Delete projects, environments, members, agent notes or own API tokens (kind + ids). Permanent.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_get_envs": {
    "name": "project_get_envs",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_get_envs",
    "v1_name": "project_get_envs",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read+secret",
    "safety": "read",
    "secret": true,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{env}",
      "result": "{count} environments"
    },
    "route": null,
    "description": "Get the project's environments: the list, or one (effective=true resolves inherited values). Header and variable values are masked.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "env",
        "type": "uuid|default",
        "from_state": null,
        "doc": "One environment: its id, or \"default\" for the default one; without it, the list."
      },
      {
        "name": "effective",
        "type": "boolean",
        "default": false,
        "from_state": null,
        "doc": "true: values inherited from the default environment are resolved (with env only)."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_save_env": {
    "name": "project_save_env",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_save_env",
    "v1_name": "project_save_env",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [
        "protected_env",
        "secret_ref"
      ],
      "target_traffic": null,
      "scope": {
        "group": "project:setup",
        "target": null
      },
      "cost": null,
      "card": {
        "title": "Save environment {name}",
        "fields": [
          {
            "label": "Name",
            "from": "name",
            "source": "args"
          },
          {
            "label": "Address",
            "from": "base_url",
            "source": "args"
          },
          {
            "label": "Frontend address",
            "from": "frontend_url",
            "source": "args"
          },
          {
            "label": "Limits",
            "from": "max_vu, max_rps",
            "source": "args"
          },
          {
            "label": "Protected",
            "from": "protected",
            "source": "args"
          },
          {
            "label": "Fixed headers from",
            "from": "headers_env_file",
            "source": "args"
          },
          {
            "label": "Default",
            "from": "make_default",
            "source": "args"
          },
          {
            "label": "Env file content",
            "from": "(sha256 of the file; values are never shown)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "get_environment_api_v1_projects__project_id__environments__environment_id__get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/environments/{environment_id}",
          "provides": "the saved environment (absent for a new one): protected flag",
          "protected": true,
          "hash": [
            "id",
            "base_url",
            "protected",
            "is_default"
          ],
          "volatile": []
        },
        {
          "card": "main",
          "via": "file",
          "argument": "headers_env_file",
          "provides": "sha256 of the env file with fixed headers",
          "protected": false,
          "hash": [
            "size",
            "sha256"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "project_save_env",
          "how": "the previous values (header values must be read again)",
          "for": "update"
        },
        {
          "tool": "project_delete",
          "how": "kind=env, for a new one",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Save environment {name}",
      "result": "environment {name} saved"
    },
    "route": null,
    "description": "Save an environment (address, limits, protection, fixed headers read from an env file; no id: create) and optionally make it the default.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_check_env": {
    "name": "project_check_env",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_check_env",
    "v1_name": "project_check_env",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [
        "protected_env"
      ],
      "target_traffic": "probe",
      "scope": {
        "group": "project:probe",
        "target": null
      },
      "cost": "traffic: one request per documented endpoint",
      "card": {
        "title": "Probe environment {env}",
        "fields": [
          {
            "label": "Environment",
            "from": "env",
            "source": "args"
          },
          {
            "label": "Address",
            "from": "(from the environment)",
            "source": "resolve"
          },
          {
            "label": "Requests",
            "from": "one read-only request per documented endpoint",
            "source": "args"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "get_environment_api_v1_projects__project_id__environments__environment_id__get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/environments/{environment_id}",
          "provides": "address and protected flag of the environment",
          "protected": true,
          "hash": [
            "base_url",
            "protected"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.env_id",
          "arg": "env",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "read-only probes"
    },
    "log": {
      "args": "Probe environment {env}",
      "result": "reachable: {ok}; {found}/{documented} endpoints exist"
    },
    "route": null,
    "description": "Check an environment: probe its address; conformance with the docs only once they exist. Sends requests to the target.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_get_docs": {
    "name": "project_get_docs",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_get_docs",
    "v1_name": "project_get_docs",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{kind} {docs_id}",
      "result": "{kind} v{version}"
    },
    "route": null,
    "description": "Get the project's active API docs (OpenAPI or AsyncAPI), the stored versions, or one version by id.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "kind",
        "type": "enum",
        "enum": [
          "openapi",
          "asyncapi"
        ],
        "default": "openapi",
        "from_state": null,
        "doc": "Which documentation: openapi (default) or asyncapi."
      },
      {
        "name": "docs_id",
        "type": "uuid",
        "from_state": null,
        "doc": "One stored version by its id; without it, the active documentation."
      },
      {
        "name": "versions",
        "type": "boolean",
        "default": false,
        "from_state": null,
        "doc": "true: the list of stored versions instead (not with docs_id)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_get_endpoints": {
    "name": "project_get_endpoints",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_get_endpoints",
    "v1_name": "project_get_endpoints",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{endpoint}",
      "result": "{count} endpoints"
    },
    "route": null,
    "description": "Get the endpoints of the API docs: the list, or one with its schema and validator bindings.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "docs_id",
        "type": "uuid",
        "from_state": "ids.docs_id",
        "doc": "The documentation version; default: the one of this workspace (see project_get_docs)."
      },
      {
        "name": "endpoint",
        "type": "string",
        "min_length": 1,
        "max_length": 300,
        "from_state": null,
        "doc": "One endpoint: its id, operationId or \"METHOD /path\" (POST /checkout); without it, the list."
      },
      {
        "name": "include",
        "type": "string[]",
        "enum": [
          "bindings"
        ],
        "max_items": 1,
        "from_state": null,
        "doc": "\"bindings\": expected statuses, response schemas in short and suggested assertions (with endpoint only)."
      },
      {
        "name": "method",
        "type": "enum",
        "enum": [
          "get",
          "post",
          "put",
          "patch",
          "delete",
          "head",
          "options"
        ],
        "from_state": null,
        "doc": "List only endpoints of this method."
      },
      {
        "name": "query",
        "type": "string",
        "min_length": 1,
        "max_length": 100,
        "from_state": null,
        "doc": "List only endpoints whose path, summary or operationId contains this text (any case)."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 200,
        "default": 50,
        "from_state": null,
        "doc": "How many endpoints of the list to return (1-200)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_import_docs": {
    "name": "project_import_docs",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_import_docs",
    "v1_name": "project_import_docs",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "project:setup",
        "target": null
      },
      "cost": "uploads the document",
      "card": {
        "title": "Import {kind} docs from {source}",
        "fields": [
          {
            "label": "Kind",
            "from": "kind",
            "source": "args"
          },
          {
            "label": "Source",
            "from": "file",
            "source": "args"
          },
          {
            "label": "Active",
            "from": "yes",
            "source": "args"
          },
          {
            "label": "File content",
            "from": "(size and sha256 of the file)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "file",
          "argument": "file",
          "provides": "size and sha256 of the documentation file",
          "protected": false,
          "hash": [
            "size",
            "sha256"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.env_id",
          "arg": "env",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "project_set_active_docs",
          "how": "the previous version",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Import {kind} docs from {source}",
      "result": "{kind} v{version}: {endpoints} endpoints; flows on the previous version: {old_flows}"
    },
    "route": null,
    "description": "Import an OpenAPI document from a file as the active version; replaces the docs of an existing project.",
    "next_steps": [
      "flows_migrate_docs"
    ],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_set_active_docs": {
    "name": "project_set_active_docs",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_set_active_docs",
    "v1_name": "project_set_active_docs",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "project_set_active_docs",
          "how": "the previous version",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{docs_id}",
      "result": "{kind} v{version} active"
    },
    "route": null,
    "description": "Set a stored docs version as the active one.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "kind",
        "type": "enum",
        "enum": [
          "openapi",
          "asyncapi"
        ],
        "default": "openapi",
        "from_state": null,
        "doc": "Which documentation: openapi (default) or asyncapi."
      },
      {
        "name": "docs_id",
        "type": "uuid",
        "from_state": null,
        "required": true,
        "doc": "The stored version to make active (project_get_docs versions=true lists them)."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_analyze_setup": {
    "name": "project_analyze_setup",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_analyze_setup",
    "v1_name": "project_analyze_setup",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "project:setup",
        "target": null
      },
      "cost": "one LLM analysis (several calls)",
      "card": {
        "title": "Analyze the project setup with the LLM",
        "fields": [
          {
            "label": "Inputs",
            "from": "docs, description, evidence files",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "proposes only, nothing is saved"
    },
    "log": {
      "args": "Analyze the project setup with the LLM",
      "result": "{fields} profile fields proposed"
    },
    "route": null,
    "description": "Analyze the project setup with the LLM: imports the docs, then proposes profile fields with confidence.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_apply_setup": {
    "name": "project_apply_setup",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_apply_setup",
    "v1_name": "project_apply_setup",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "project:setup",
        "target": null
      },
      "cost": null,
      "card": {
        "title": "Apply the project profile",
        "fields": [
          {
            "label": "Fields",
            "from": "fields",
            "source": "args"
          },
          {
            "label": "Seed validators and test types",
            "from": "yes",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "seeded validators and test types stay; the profile can be applied again"
    },
    "log": {
      "args": "Apply the project profile",
      "result": "{fields} fields applied; {validators} validators, {test_types} test types seeded"
    },
    "route": null,
    "description": "Apply the reviewed profile, seed default validators and test types, then check conformance of the default environment.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_get_apimap": {
    "name": "project_get_apimap",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_get_apimap",
    "v1_name": "project_get_apimap",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{areas} areas"
    },
    "route": null,
    "description": "Get the API map: areas and operation kinds of the project's API.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_set_apimap": {
    "name": "project_set_apimap",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_set_apimap",
    "v1_name": "project_set_apimap",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "project_set_apimap",
          "how": "the previous prefixes",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{prefixes}",
      "result": "{count} area prefixes"
    },
    "route": null,
    "description": "Set the URL prefixes that define the project's API areas.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "prefixes",
        "type": "string",
        "min_length": 1,
        "max_length": 8000,
        "from_state": null,
        "doc": "Path prefixes of the areas, comma-separated (at most 64); not with detected."
      },
      {
        "name": "detected",
        "type": "boolean",
        "default": false,
        "from_state": null,
        "doc": "true: go back to the areas LoadCraft detects (not with prefixes)."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_connect_telemetry": {
    "name": "project_connect_telemetry",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_connect_telemetry",
    "v1_name": "project_connect_telemetry",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [
        "secret_ref"
      ],
      "target_traffic": null,
      "scope": {
        "group": "project:telemetry",
        "target": null
      },
      "cost": null,
      "card": {
        "title": "Connect log server {name}",
        "fields": [
          {
            "label": "Kind",
            "from": "kind",
            "source": "args"
          },
          {
            "label": "Address",
            "from": "url",
            "source": "args"
          },
          {
            "label": "Credentials from",
            "from": "env_file",
            "source": "args"
          },
          {
            "label": "Env file content",
            "from": "(sha256 of the file; values are never shown)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "file",
          "argument": "env_file",
          "provides": "sha256 of the env file with credentials",
          "protected": false,
          "hash": [
            "size",
            "sha256"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "project_disconnect_telemetry",
          "how": "for a new link",
          "for": "inverse"
        },
        {
          "tool": "project_connect_telemetry",
          "how": "the previous address (credentials read again)",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Connect log server {name}",
      "result": "connected; {tools} tools"
    },
    "route": null,
    "description": "Connect a log server: test it, list its tools and save it as the project's telemetry source.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_disconnect_telemetry": {
    "name": "project_disconnect_telemetry",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_disconnect_telemetry",
    "v1_name": "project_disconnect_telemetry",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "destructive",
    "safety": "destructive",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "delete",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": {
        "title": "Disconnect the log server",
        "fields": [
          {
            "label": "Log server",
            "from": "(from the project)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "get_telemetry_source_api_v1_projects__project_id__telemetry_source_get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/telemetry-source",
          "provides": "the connected log server",
          "protected": false,
          "hash": [
            "telemetry_source"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "project_connect_telemetry",
          "how": "connect again (credentials needed)",
          "for": "inverse"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Disconnect the log server",
      "result": "disconnected"
    },
    "route": null,
    "description": "Disconnect the project's log server.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": [],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_list_notes": {
    "name": "project_list_notes",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_list_notes",
    "v1_name": "project_get_notes",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} notes"
    },
    "route": null,
    "description": "List the notes the agent learned about the project.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_update_note": {
    "name": "project_update_note",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_update_note",
    "v1_name": "project_update_note",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "project_update_note",
          "how": "the previous text and scope",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{id}",
      "result": "note {id} updated"
    },
    "route": null,
    "description": "Update the text or scope of a project note.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "note_id",
        "type": "string",
        "min_length": 32,
        "max_length": 32,
        "from_state": null,
        "required": true,
        "doc": "The note id (32 hex characters) from project_list_notes."
      },
      {
        "name": "text",
        "type": "string",
        "min_length": 1,
        "max_length": 500,
        "from_state": null,
        "doc": "The note's new text."
      },
      {
        "name": "scope",
        "type": "enum",
        "enum": [
          "url_path",
          "plan_step"
        ],
        "from_state": null,
        "doc": "Where the note applies: a page path or a plan step (a step can only become a page)."
      },
      {
        "name": "at",
        "type": "string",
        "min_length": 1,
        "max_length": 500,
        "from_state": null,
        "doc": "The page path (url_path) or words of the step (plan_step); with scope."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_list_team": {
    "name": "project_list_team",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_list_team",
    "v1_name": "project_get_team",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} members"
    },
    "route": null,
    "description": "List project members; me=true returns your own role and permissions.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "me",
        "type": "boolean",
        "default": false,
        "from_state": null,
        "doc": "true: your own role and permissions instead of the list."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_save_member": {
    "name": "project_save_member",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_save_member",
    "v1_name": "project_manage_team",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "project:team",
        "target": null
      },
      "cost": null,
      "card": {
        "title": "Give {user_id} the role {role}",
        "fields": [
          {
            "label": "Member",
            "from": "user_id",
            "source": "args"
          },
          {
            "label": "Role",
            "from": "role",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "project_save_member",
          "how": "the previous role",
          "for": "update"
        },
        {
          "tool": "project_delete",
          "how": "kind=member, for a new one",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Give {user_id} the role {role}",
      "result": "{user_id}: {role}"
    },
    "route": null,
    "description": "Save a project member: add one, or change a member's role.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "user_id",
        "type": "uuid",
        "required": true,
        "from_state": null,
        "doc": "The person to add or whose role changes (their user id, as project_list_team shows)."
      },
      {
        "name": "role",
        "type": "enum",
        "enum": [
          "owner",
          "editor",
          "viewer"
        ],
        "required": true,
        "from_state": null,
        "doc": "The role the person gets."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_get_activity": {
    "name": "project_get_activity",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_get_activity",
    "v1_name": "project_get_activity",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{events} events, {running} runs in progress"
    },
    "route": null,
    "description": "Get recent activity and the runs in progress across all projects.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 50,
        "default": 20,
        "from_state": null,
        "doc": "How many recent events to return (1-50)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_get_http_settings": {
    "name": "project_get_http_settings",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_get_http_settings",
    "v1_name": "project_get_load_settings",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read+secret",
    "safety": "read",
    "secret": true,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "base URL {base_url}"
    },
    "route": null,
    "description": "Get the project's HTTP settings for generated tests: base URL, protocol options, default headers (values masked).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "project_set_http_settings": {
    "name": "project_set_http_settings",
    "module": "project",
    "full_name": "mcp__plugin_loadcraft_lc__project_set_http_settings",
    "v1_name": "project_set_load_settings",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [
        "secret_ref"
      ],
      "target_traffic": null,
      "scope": {
        "group": "project:setup",
        "target": null
      },
      "cost": null,
      "card": {
        "title": "Set the HTTP settings of generated tests",
        "fields": [
          {
            "label": "Base URL",
            "from": "base_url",
            "source": "args"
          },
          {
            "label": "Protocol options",
            "from": "protocol",
            "source": "args"
          },
          {
            "label": "Default headers from",
            "from": "headers_env_file",
            "source": "args"
          },
          {
            "label": "Env file content",
            "from": "(sha256 of the file; values are never shown)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "file",
          "argument": "headers_env_file",
          "provides": "sha256 of the env file with default headers",
          "protected": false,
          "hash": [
            "size",
            "sha256"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "project_set_http_settings",
          "how": "the previous values (header values must be read again)",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Set the HTTP settings of generated tests",
      "result": "HTTP settings saved"
    },
    "route": null,
    "description": "Set the project's HTTP settings for generated tests (created on first use).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "base_url",
        "type": "string",
        "min_length": 1,
        "max_length": 2000,
        "from_state": null,
        "doc": "The base URL of the tested application."
      },
      {
        "name": "protocol",
        "type": "object",
        "from_state": null,
        "doc": "Protocol options to change (no proxy credentials); the rest stays."
      },
      {
        "name": "headers_env_file",
        "type": "string",
        "min_length": 1,
        "max_length": 260,
        "from_state": null,
        "doc": "An env file of the project directory whose KEY=VALUE lines become the default headers."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_suggest_journeys": {
    "name": "flows_suggest_journeys",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_suggest_journeys",
    "v1_name": "flows_suggest_journeys",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": {
        "when": "refine=false (sama darmowa heurystyka)",
        "level": 1,
        "why": null,
        "card": null
      },
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "flows:build",
        "target": null
      },
      "cost": "about one LLM call (refinement)",
      "card": {
        "title": "Suggest journeys from the API docs",
        "fields": [
          {
            "label": "Docs",
            "from": "docs_id",
            "source": "args"
          },
          {
            "label": "LLM refinement",
            "from": "refine",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [
        "flows_generate_from_suggestions"
      ],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.docs_id",
          "arg": "docs_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "proposes only, nothing is saved"
    },
    "log": {
      "args": "Suggest journeys from the API docs",
      "result": "{count} journeys proposed"
    },
    "route": null,
    "description": "Suggest user journeys from the API docs: a free heuristic first, then LLM refinement (refine=false skips the paid part).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_generate_from_suggestions": {
    "name": "flows_generate_from_suggestions",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_generate_from_suggestions",
    "v1_name": "flows_generate_from_suggestions",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "flows:build",
        "target": null
      },
      "cost": "about one LLM generation per journey",
      "card": {
        "title": "Generate {n} flows from journeys",
        "fields": [
          {
            "label": "Journeys",
            "from": "journeys",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.flows.journeys",
          "arg": "journeys",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_delete",
          "how": "the new flows",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Generate {n} flows from journeys",
      "result": "{built} flows saved, {failed} failed"
    },
    "route": null,
    "description": "Generate flows for the approved journey proposals.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": "Implementacja ma argumenty dawnych dróg (suggestions, har = ścieżka pliku, project) zamiast journeys, har_session_id, project_id; brak docs_id i wymaganego split; brak kart zgody poziomu 2 (koszt: LLM). Do dopasowania przy przeglądzie narzędzi generujących flowy i wdrożeniu mechanizmu zgód."
  },
  "flows_generate_from_endpoints": {
    "name": "flows_generate_from_endpoints",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_generate_from_endpoints",
    "v1_name": "flows_generate_from_endpoints",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "flows:build",
        "target": null
      },
      "cost": "about one LLM generation",
      "card": {
        "title": "Generate a flow from {n} endpoints",
        "fields": [
          {
            "label": "Name",
            "from": "name",
            "source": "args"
          },
          {
            "label": "Description",
            "from": "description",
            "source": "args"
          },
          {
            "label": "Endpoints",
            "from": "endpoints",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.docs_id",
          "arg": "docs_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_delete",
          "how": "the new flow",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Generate a flow from {n} endpoints",
      "result": "flow {name} saved"
    },
    "route": null,
    "description": "Generate one flow from a description and chosen endpoints.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": "Implementacja ma argumenty dawnych dróg (suggestions, har = ścieżka pliku, project) zamiast journeys, har_session_id, project_id; brak docs_id i wymaganego split; brak kart zgody poziomu 2 (koszt: LLM). Do dopasowania przy przeglądzie narzędzi generujących flowy i wdrożeniu mechanizmu zgód."
  },
  "flows_generate_from_har": {
    "name": "flows_generate_from_har",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_generate_from_har",
    "v1_name": "flows_generate_from_har",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "flows:build",
        "target": null
      },
      "cost": "about one LLM generation per journey",
      "card": {
        "title": "Generate flows from the HAR session",
        "fields": [
          {
            "label": "Name",
            "from": "name",
            "source": "args"
          },
          {
            "label": "HAR session",
            "from": "har_session_id",
            "source": "args"
          },
          {
            "label": "Split into journeys",
            "from": "split",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.flows.har_split",
          "arg": "split",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.har_session_id",
          "arg": "har_session_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_delete",
          "how": "the new flows",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Generate flows from the HAR session",
      "result": "{built} flows saved"
    },
    "route": null,
    "description": "Generate flows from an analyzed HAR session; split=true lets the backend propose journeys first.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": "Implementacja ma argumenty dawnych dróg (suggestions, har = ścieżka pliku, project) zamiast journeys, har_session_id, project_id; brak docs_id i wymaganego split; brak kart zgody poziomu 2 (koszt: LLM). Do dopasowania przy przeglądzie narzędzi generujących flowy i wdrożeniu mechanizmu zgód."
  },
  "flows_regenerate": {
    "name": "flows_regenerate",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_regenerate",
    "v1_name": "flows_regenerate",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "flows:build",
        "target": null
      },
      "cost": "about one LLM generation",
      "card": {
        "title": "Regenerate flow {name}",
        "fields": [
          {
            "label": "Flow",
            "from": "flow_id",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.flow_ids",
          "arg": "flow_ids",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_restore_version",
          "how": "the previous version",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Regenerate flow {name}",
      "result": "flow {name} v{version}"
    },
    "route": null,
    "description": "Regenerate a flow from its recorded sources; saved as a new version.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.flow_ids",
        "doc": "The flow (id or name); default: the only one of this workspace."
      },
      {
        "name": "description",
        "type": "string",
        "min_length": 1,
        "max_length": 4000,
        "from_state": null,
        "doc": "What the flow should do; default: the description it was generated from."
      },
      {
        "name": "skip_validators",
        "type": "boolean",
        "default": false,
        "from_state": null,
        "doc": "true: do not generate validators for the new version."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_import_har": {
    "name": "flows_import_har",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_import_har",
    "v1_name": "flows_import_har",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "flows:build",
        "target": null
      },
      "cost": "uploads the recording; about one LLM analysis",
      "card": {
        "title": "Import HAR {file}",
        "fields": [
          {
            "label": "File",
            "from": "file",
            "source": "args"
          },
          {
            "label": "Size",
            "from": "(from the file)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "file",
          "argument": "file",
          "provides": "size and sha256 of the HAR file",
          "protected": false,
          "hash": [
            "size",
            "sha256"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [
        "flows_generate_from_har"
      ],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "the uploaded session expires on the backend"
    },
    "log": {
      "args": "Import HAR {file}",
      "result": "{kept} requests kept, {noise} dropped"
    },
    "route": null,
    "description": "Import a HAR recording and analyze it: kept and noise requests, login, groups, values passed between requests.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_describe_journeys": {
    "name": "flows_describe_journeys",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_describe_journeys",
    "v1_name": "flows_describe_journeys",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "traffic",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": "run",
      "scope": null,
      "cost": "LLM agent with a browser session; one sign-in in the target",
      "card": {
        "title": "Open {env} in the backend browser and sign in",
        "fields": [
          {
            "label": "Description",
            "from": "description",
            "source": "args"
          },
          {
            "label": "Environment",
            "from": "env",
            "source": "args"
          },
          {
            "label": "Test account from",
            "from": "account.from_env",
            "source": "args"
          },
          {
            "label": "Account file content",
            "from": "(sha256 of the file; values are never shown)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "file",
          "argument": "account",
          "provides": "sha256 of the test account file",
          "protected": false,
          "hash": [
            "size",
            "sha256"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.flows.account_ref",
          "arg": "account",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.env_id",
          "arg": "env",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "the sign-in already happened in the target"
    },
    "log": {
      "args": "Open {env} in the backend browser and sign in",
      "result": "{paths} paths planned"
    },
    "route": null,
    "description": "Describe journeys in plain words: a backend browser opens the app, signs in with a test account and returns the path plan.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_record_journeys": {
    "name": "flows_record_journeys",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_record_journeys",
    "v1_name": "flows_record_journeys",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "traffic",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": "run",
      "scope": null,
      "cost": "LLM agent per path; real actions in the target",
      "card": {
        "title": "Walk {n} paths in the backend browser",
        "fields": [
          {
            "label": "Walk",
            "from": "walk_id",
            "source": "args"
          },
          {
            "label": "Paths",
            "from": "paths",
            "source": "args"
          },
          {
            "label": "Environment",
            "from": "(from the walk)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "get_scenario_run_api_v1_projects__project_id__scenario_from_description_runs__run_id__get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}",
          "provides": "the walk: its target",
          "protected": false,
          "hash": [
            "run_id",
            "target_url",
            "target_host"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.flows.journeys",
          "arg": "paths",
          "explicit": true
        },
        {
          "path": "ids.walk_id",
          "arg": "walk_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_delete",
          "how": "the new flows; what the walk did in the target stays",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Walk {n} paths in the backend browser",
      "result": "{built} flows saved, {failed} paths failed"
    },
    "route": null,
    "description": "Record the approved plan (all or chosen paths): the backend browser walks it until the flows are saved.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_get_walks": {
    "name": "flows_get_walks",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_get_walks",
    "v1_name": "flows_get_walks",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{walk_id}",
      "result": "{count} walks"
    },
    "route": null,
    "description": "Get description runs (browser walks): the list, or one with its paths and optional review timeline.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "walk_id",
        "type": "string",
        "min_length": 1,
        "max_length": 100,
        "from_state": null,
        "doc": "One walk: its handle or id; without it, the list of your walks."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 50,
        "default": 20,
        "from_state": null,
        "doc": "How many walks of the list to return (1-50)."
      },
      {
        "name": "include",
        "type": "string[]",
        "enum": [
          "timeline"
        ],
        "max_items": 1,
        "from_state": null,
        "doc": "\"timeline\": the review timeline of the walk (with walk_id only)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_retry_walk": {
    "name": "flows_retry_walk",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_retry_walk",
    "v1_name": "flows_retry_walk",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "traffic",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": "run",
      "scope": null,
      "cost": "LLM agent; real actions in the target when part=path",
      "card": {
        "title": "Retry path {path_index} of the walk",
        "fields": [
          {
            "label": "Walk",
            "from": "walk_id",
            "source": "args"
          },
          {
            "label": "Path",
            "from": "path_index",
            "source": "args"
          },
          {
            "label": "Part",
            "from": "part",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.walk_id",
          "arg": "walk_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_delete",
          "how": "the new flow; what the walk did in the target stays",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Retry path {path_index} of the walk",
      "result": "path {path_index}: {status}"
    },
    "route": null,
    "description": "Retry one path of a finished walk: preview and re-drive it in the browser (part=path), or save its flow again as a new flow (part=flow).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_save_walk_note": {
    "name": "flows_save_walk_note",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_save_walk_note",
    "v1_name": "flows_manage_walk_notes",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_save_walk_note",
          "how": "the previous text",
          "for": "update"
        },
        {
          "tool": "flows_delete",
          "how": "kind=walk_note, for a new one",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{walk_id} step {step}",
      "result": "note at step {step}"
    },
    "route": null,
    "description": "Save a note at a step of a walk (new or changed); notes steer the next retry.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "walk_id",
        "type": "string",
        "min_length": 1,
        "max_length": 100,
        "from_state": "ids.walk_id",
        "doc": "The walk: its handle or id; default: the walk of this workspace."
      },
      {
        "name": "step",
        "type": "string",
        "min_length": 1,
        "max_length": 100,
        "from_state": null,
        "required": true,
        "doc": "The step of the walk (from flows_get_walks include timeline)."
      },
      {
        "name": "text",
        "type": "string",
        "min_length": 1,
        "max_length": 500,
        "from_state": null,
        "required": true,
        "doc": "The note."
      },
      {
        "name": "note_id",
        "type": "string",
        "min_length": 1,
        "max_length": 100,
        "from_state": null,
        "doc": "An existing note to change; without it, a new note."
      },
      {
        "name": "remember",
        "type": "boolean",
        "default": false,
        "from_state": null,
        "doc": "true: also keep it as a note of the project for later walks."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_export_walk_image": {
    "name": "flows_export_walk_image",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_export_walk_image",
    "v1_name": "flows_export_walk_image",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{walk_id} {path_index}",
      "result": "{path}"
    },
    "route": null,
    "description": "Export a walk image to a local file and return its path: a live snapshot of a path attempt, or a timeline still.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "walk_id",
        "type": "string",
        "min_length": 1,
        "max_length": 100,
        "from_state": "ids.walk_id",
        "doc": "The walk: its handle or id; default: the walk of this workspace."
      },
      {
        "name": "path_index",
        "type": "integer",
        "min": 0,
        "max": 10000,
        "from_state": null,
        "doc": "The step of the walk to capture live (not with still_id)."
      },
      {
        "name": "attempt",
        "type": "integer",
        "min": 1,
        "max": 100,
        "default": 1,
        "from_state": null,
        "doc": "The attempt of that step (with path_index)."
      },
      {
        "name": "still_id",
        "type": "string",
        "min_length": 1,
        "max_length": 100,
        "from_state": null,
        "doc": "A still of the review timeline (not with path_index)."
      },
      {
        "name": "overwrite",
        "type": "boolean",
        "default": false,
        "from_state": null,
        "doc": "true: replace an image saved earlier under the same name."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": "zapisuje obraz kroku przebiegu lokalnie pod loadcraft/walks/<przebieg>/ (ignorowane przez git); nic w backendzie się nie zmienia"
    },
    "known_debt": null
  },
  "flows_list": {
    "name": "flows_list",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_list",
    "v1_name": "flows_list",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} flows"
    },
    "route": null,
    "description": "List the project's flows: name, type, version, step count.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "query",
        "type": "string",
        "min_length": 1,
        "max_length": 100,
        "from_state": null,
        "doc": "Only flows whose name contains this text (any case)."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 200,
        "default": 50,
        "from_state": null,
        "doc": "How many flows to return (1-200)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_get": {
    "name": "flows_get",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_get",
    "v1_name": "flows_get",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{flow_id}",
      "result": "{name} v{version}: {steps} steps; needs input: {needs_input} ({definite} definite)"
    },
    "route": null,
    "description": "Get one flow as a numbered outline with variables, pauses and open questions.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": [
      {
        "include": "steps",
        "item": "StepView",
        "page": {
          "default": 150,
          "max": 150
        },
        "args": [],
        "ref": null
      }
    ],
    "arguments": [
      {
        "name": "flow_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.flow_ids",
        "doc": "The flow: its id or name; default: the only flow of this workspace."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_get_versions": {
    "name": "flows_get_versions",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_get_versions",
    "v1_name": "flows_get_versions",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{flow_id}",
      "result": "{count} versions"
    },
    "route": null,
    "description": "Get a flow's stored versions: the list, or one version as an outline.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.flow_ids",
        "doc": "The flow: its id or name; default: the only flow of this workspace."
      },
      {
        "name": "version",
        "type": "integer",
        "min": 1,
        "max": 100000,
        "from_state": null,
        "doc": "One version as an outline; without it, the list (newest first)."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 100,
        "default": 20,
        "from_state": null,
        "doc": "How many versions of the list to return (1-100)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_restore_version": {
    "name": "flows_restore_version",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_restore_version",
    "v1_name": "flows_restore_version",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_restore_version",
          "how": "the version that was current",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{flow_id} v{version}",
      "result": "{name}: v{version} restored as v{new}; warnings: {warnings}"
    },
    "route": null,
    "description": "Restore an older flow version as the newest one.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.flow_ids",
        "doc": "The flow: its id or name; default: the only flow of this workspace."
      },
      {
        "name": "version",
        "type": "integer",
        "min": 1,
        "max": 100000,
        "from_state": null,
        "required": true,
        "doc": "The version to make current."
      },
      {
        "name": "reason",
        "type": "string",
        "max_length": 200,
        "from_state": null,
        "doc": "Why, shown in the version history."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_save": {
    "name": "flows_save",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_save",
    "v1_name": "flows_save",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_restore_version",
          "how": "the previous version",
          "for": "update"
        },
        {
          "tool": "flows_save",
          "how": "the previous values",
          "for": "update"
        },
        {
          "tool": "flows_delete",
          "how": "the new flow",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{flow_id}",
      "result": "{name} v{version} saved"
    },
    "route": "direct",
    "description": "Save a flow from blocks (flow_id: new version; none: new flow). Direct edit, only on the user's request; normally use flows_ask_copilot.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": null,
        "doc": "The flow to change (id or name); without it, a new flow is created."
      },
      {
        "name": "name",
        "type": "string",
        "min_length": 1,
        "max_length": 255,
        "from_state": null,
        "doc": "The flow's name; required for a new flow."
      },
      {
        "name": "description",
        "type": "string",
        "max_length": 2000,
        "from_state": null,
        "doc": "The flow's description."
      },
      {
        "name": "graph",
        "type": "object",
        "from_state": null,
        "doc": "The whole graph {blocks, edges, entry_block_id} (no variables); a new flow or a full replacement."
      },
      {
        "name": "drop_steps",
        "type": "string",
        "min_length": 1,
        "max_length": 300,
        "from_state": null,
        "doc": "Step numbers to remove, as flows_get numbers them, comma-separated (at most 50); with flow_id, not with graph."
      },
      {
        "name": "reason",
        "type": "string",
        "min_length": 1,
        "max_length": 300,
        "from_state": null,
        "doc": "Why the graph changes (with graph or drop_steps); kept on the new version."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_delete": {
    "name": "flows_delete",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_delete",
    "v1_name": "flows_delete",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "destructive",
    "safety": "destructive",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "delete",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": {
        "title": "Delete {kind}: {names}",
        "fields": [
          {
            "label": "Kind",
            "from": "kind",
            "source": "args"
          },
          {
            "label": "Items",
            "from": "ids (names resolved by the registry)",
            "source": "labels"
          },
          {
            "label": "Max per card",
            "from": "(20 flows)",
            "source": "derived"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.flow_ids",
          "arg": "flow_ids",
          "explicit": true
        },
        {
          "path": "ids.walk_id",
          "arg": "walk_id",
          "explicit": true
        }
      ],
      "max_items": 20
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "permanent"
    },
    "log": {
      "args": "Delete {kind}: {names}",
      "result": "{count} {kind} deleted"
    },
    "route": null,
    "description": "Delete flows, walk notes, or a walk's review (kind=review: its timeline, stills, notes and browser recordings; flows stay).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_duplicate": {
    "name": "flows_duplicate",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_duplicate",
    "v1_name": "flows_duplicate",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_delete",
          "how": "the copies",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{flow_ids}",
      "result": "{count} copies"
    },
    "route": null,
    "description": "Duplicate flows, or copy one flow onto another docs version (docs_id).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_ids",
        "type": "string",
        "min_length": 1,
        "max_length": 4000,
        "from_state": null,
        "required": true,
        "doc": "The flows to copy, ids or names, comma-separated (1-20; exactly one with docs_id)."
      },
      {
        "name": "docs_id",
        "type": "uuid",
        "from_state": null,
        "doc": "Copy the flow onto this documentation version."
      },
      {
        "name": "name",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": null,
        "doc": "The name of the copy (with docs_id)."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_migrate_docs": {
    "name": "flows_migrate_docs",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_migrate_docs",
    "v1_name": null,
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": {
        "when": "preview=true (niczego nie zapisuje)",
        "level": 1,
        "why": null,
        "card": null
      },
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "flows:migrate",
        "target": null
      },
      "cost": null,
      "card": {
        "title": "Migrate {n} flows to the current docs version",
        "fields": [
          {
            "label": "Flows",
            "from": "flow_ids",
            "source": "args"
          },
          {
            "label": "Target docs version",
            "from": "target_spec_id",
            "source": "args"
          },
          {
            "label": "Adopt example values",
            "from": "adopt_values | adopt_value_ids",
            "source": "args"
          },
          {
            "label": "ALLOW UNMATCHED blocks",
            "from": "allow_unmatched",
            "source": "args"
          },
          {
            "label": "Docs version",
            "from": "(current version of the project)",
            "source": "resolve"
          },
          {
            "label": "Outdated flows",
            "from": "(flows with spec_status outdated)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "list_project_openapi_specs_api_v1_projects__project_id__openapi_specs_get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/openapi-specs",
          "provides": "the current docs version of the project",
          "protected": false,
          "hash": [
            "current_spec_id"
          ],
          "volatile": []
        },
        {
          "card": "main",
          "via": "get",
          "operationId": "list_flows_api_v1_projects__project_id__flows_get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/flows",
          "provides": "the flows and their spec_status (flow_ids omitted = all outdated)",
          "protected": false,
          "hash": [
            "flows"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.flow_ids",
          "arg": "flow_ids",
          "explicit": true
        },
        {
          "path": "ids.docs_id",
          "arg": "target_spec_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_restore_version",
          "how": "the previous version of each flow",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Migrate {n} flows to the current docs version",
      "result": "{count} flows migrated: {matched} matched, {changed} changed, {unmatched} unmatched"
    },
    "route": null,
    "description": "Migrate flows to the current docs version in place; preview=true saves nothing, adopt_values adopts new example values.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": "flows_spec_migration",
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": "Karta zgody poziomu 2 działa wzorcem confirm z tokenem, bo ogólnych kart pending i process_answer jeszcze nie ma; po ich wdrożeniu narzędzie przechodzi na kartę z katalogu."
  },
  "flows_merge": {
    "name": "flows_merge",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_merge",
    "v1_name": "flows_merge",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_delete",
          "how": "the merged flow",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{flow_ids}",
      "result": "{name} created from {count} flows"
    },
    "route": null,
    "description": "Merge several flows into one new flow (the first kept whole, later ones lose their leading reads).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_ids",
        "type": "string",
        "min_length": 1,
        "max_length": 4000,
        "from_state": null,
        "required": true,
        "doc": "The flows to merge, ids or names, comma-separated (2-20)."
      },
      {
        "name": "name",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": null,
        "doc": "The name of the merged flow."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_set_poll_terminals": {
    "name": "flows_set_poll_terminals",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_set_poll_terminals",
    "v1_name": "flows_set_poll_terminals",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_restore_version",
          "how": "the previous version",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{flow_id}",
      "result": "{field} answered as v{version}; {open} open"
    },
    "route": null,
    "description": "Set the success and failure terminal statuses that answer a flow's open poll-loop questions.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.flow_ids",
        "doc": "The flow (id or name); default: the only one of this workspace."
      },
      {
        "name": "field",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "required": true,
        "from_state": null,
        "doc": "The status field of an open poll question: the field of a poll_status item in flows_get."
      },
      {
        "name": "success_terminals",
        "type": "string",
        "min_length": 1,
        "max_length": 1000,
        "required": true,
        "from_state": null,
        "doc": "The statuses that mean the job succeeded, comma-separated (at most 20)."
      },
      {
        "name": "failure_terminals",
        "type": "string",
        "max_length": 1000,
        "from_state": null,
        "doc": "The statuses that mean it failed, comma-separated (at most 20); without it, none."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_ask_copilot": {
    "name": "flows_ask_copilot",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_ask_copilot",
    "v1_name": "flows_ask_copilot",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "flows:copilot",
        "target": "flow_id"
      },
      "cost": "1-2 LLM calls per turn",
      "card": {
        "title": "Ask the flow copilot about {name}",
        "fields": [
          {
            "label": "Flow",
            "from": "flow_id",
            "source": "args"
          },
          {
            "label": "Message",
            "from": "message",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.flow_ids",
          "arg": "flow_ids",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "proposes only, nothing is saved"
    },
    "log": {
      "args": "Ask the flow copilot about {name}",
      "result": "{changes} changes proposed"
    },
    "route": "copilot",
    "description": "Ask the flow copilot for changes to a flow; without a message it runs its standard review. Returns a proposal, changes nothing.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.flow_ids",
        "doc": "The flow (id or name); default: the only one of this workspace."
      },
      {
        "name": "message",
        "type": "string",
        "min_length": 1,
        "max_length": 4000,
        "from_state": null,
        "doc": "What to ask; without it the copilot runs its standard review."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_apply_copilot_changes": {
    "name": "flows_apply_copilot_changes",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_apply_copilot_changes",
    "v1_name": "flows_apply_copilot_changes",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "flows_restore_version",
          "how": "the previous version",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{flow_id}",
      "result": "{applied}/{requested} changes applied as v{version}"
    },
    "route": "copilot",
    "description": "Apply the accepted copilot changes to a flow as one new version and record what was rejected.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.flow_ids",
        "doc": "The flow (id or name); default: the only one of this workspace."
      },
      {
        "name": "message_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "required": true,
        "from_state": null,
        "doc": "The copilot turn the changes come from: message_id of flows_ask_copilot or flows_get_copilot_history."
      },
      {
        "name": "accept",
        "type": "string",
        "max_length": 2000,
        "from_state": null,
        "doc": "Ids of the changes to apply, comma-separated (at most 50)."
      },
      {
        "name": "reject",
        "type": "string",
        "max_length": 2000,
        "from_state": null,
        "doc": "Ids of the changes to record as rejected, comma-separated (at most 50)."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "flows_get_copilot_history": {
    "name": "flows_get_copilot_history",
    "module": "flows",
    "full_name": "mcp__plugin_loadcraft_lc__flows_get_copilot_history",
    "v1_name": "flows_get_copilot_history",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{flow_id}",
      "result": "{turns} turns"
    },
    "route": "copilot",
    "description": "Get a flow's copilot conversation, or its improvement suggestions.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.flow_ids",
        "doc": "The flow: its id or name; default: the only flow of this workspace."
      },
      {
        "name": "suggestions",
        "type": "boolean",
        "default": false,
        "from_state": null,
        "doc": "true: the copilot's open suggestions instead of the conversation."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 50,
        "default": 20,
        "from_state": null,
        "doc": "How many of the latest turns to return (1-50)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_list": {
    "name": "scenario_list",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_list",
    "v1_name": "scenario_list",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} scenarios"
    },
    "route": null,
    "description": "List the project's scenarios: name, source flow, version, self-check state.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 200,
        "default": 50,
        "from_state": null,
        "doc": "How many scenarios to return (1-200)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_get": {
    "name": "scenario_get",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_get",
    "v1_name": "scenario_get",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read+secret",
    "safety": "read",
    "secret": true,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{scenario_id}",
      "result": "{name} v{version}; self-check {self_check}"
    },
    "route": null,
    "description": "Get a scenario: status, self-check, data slots; include adds the variable contract, drift and stored artifact (masked).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "scenario_id",
        "type": "uuid",
        "from_state": "ids.scenario_ids",
        "doc": "The scenario; default: the only one in this workspace."
      },
      {
        "name": "include",
        "type": "string[]",
        "enum": [
          "contract",
          "drift",
          "artifact"
        ],
        "max_items": 3,
        "from_state": null,
        "doc": "contract: the session-variable contract; drift: the drift score; artifact: the stored scenario artifact (literals masked)."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_save": {
    "name": "scenario_save",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_save",
    "v1_name": "scenario_save",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "scenario_save",
          "how": "the previous values",
          "for": "update"
        },
        {
          "tool": "scenario_delete",
          "how": "the new scenario",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{scenario_id}",
      "result": "{name} saved"
    },
    "route": null,
    "description": "Save a scenario's name, tags, active flag or SLO thresholds (no id: create an empty one).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "scenario_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": null,
        "doc": "The scenario to change (id or name); without it, a new empty scenario is created."
      },
      {
        "name": "name",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": null,
        "doc": "The name; required for a new scenario."
      },
      {
        "name": "tags",
        "type": "string",
        "max_length": 1000,
        "from_state": null,
        "doc": "Tags, comma-separated (at most 20); replaces the list, an empty text clears it."
      },
      {
        "name": "is_active",
        "type": "boolean",
        "from_state": null,
        "doc": "Whether the scenario is active."
      },
      {
        "name": "slo_thresholds",
        "type": "object",
        "from_state": null,
        "doc": "SLO thresholds (key: number); {} sets the standard SLO."
      },
      {
        "name": "slo_from_project",
        "type": "boolean",
        "from_state": null,
        "doc": "true: drop the scenario's own SLO thresholds; it inherits the project's."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_delete": {
    "name": "scenario_delete",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_delete",
    "v1_name": "scenario_delete",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "destructive",
    "safety": "destructive",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "delete",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": {
        "title": "Delete {kind}: {names}",
        "fields": [
          {
            "label": "Kind",
            "from": "kind",
            "source": "args"
          },
          {
            "label": "Items",
            "from": "ids (names resolved by the registry)",
            "source": "labels"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.scenario_ids",
          "arg": "scenario_ids",
          "explicit": true
        },
        {
          "path": "ids.composition_id",
          "arg": "composition_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "permanent"
    },
    "log": {
      "args": "Delete {kind}: {names}",
      "result": "{count} {kind} deleted"
    },
    "route": null,
    "description": "Delete a scenario or a composition. Past runs stay.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": [
      {
        "name": "scenario_id",
        "type": "uuid",
        "from_state": null,
        "doc": "The scenario to delete; give this or composition_id."
      },
      {
        "name": "composition_id",
        "type": "uuid",
        "from_state": null,
        "doc": "The composition to delete; give this or scenario_id."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_generate": {
    "name": "scenario_generate",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_generate",
    "v1_name": "scenario_generate",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "traffic",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": "run",
      "scope": null,
      "cost": "about one LLM generation per flow (minutes each); self-check: 1 user, 1 pass per scenario",
      "card": {
        "title": "Generate {n} scenarios and self-check them on the default environment ({env})",
        "fields": [
          {
            "label": "Flows",
            "from": "flow_ids",
            "source": "args"
          },
          {
            "label": "Traffic split",
            "from": "split",
            "source": "args"
          },
          {
            "label": "Data mix",
            "from": "data_mix",
            "source": "args"
          },
          {
            "label": "Composition",
            "from": "composition_name",
            "source": "args"
          },
          {
            "label": "Self-check on",
            "from": "(default environment)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "get_default_environment_api_v1_projects__project_id__environments_default_get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/environments/default",
          "provides": "the default environment of the project",
          "protected": false,
          "hash": [
            "id",
            "base_url",
            "protected"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.scenario.split",
          "arg": "split",
          "explicit": true
        },
        {
          "path": "choices.scenario.data_mix",
          "arg": "data_mix",
          "explicit": true
        },
        {
          "path": "choices.scenario.composition_name",
          "arg": "composition_name",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.flow_ids",
          "arg": "flow_ids",
          "explicit": true
        },
        {
          "path": "ids.scenario_ids",
          "arg": "scenario_ids",
          "explicit": true
        },
        {
          "path": "ids.env_id",
          "arg": "env",
          "explicit": false
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "scenario_delete",
          "how": "the new scenarios and composition",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Generate {n} scenarios and self-check them on the default environment ({env})",
      "result": "{built} scenarios, composition {name}; self-check {passed}/{n}"
    },
    "route": null,
    "description": "Generate scenarios from flows with a traffic split, join them in one composition, and self-check each (sends requests to the target).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_regenerate": {
    "name": "scenario_regenerate",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_regenerate",
    "v1_name": "scenario_regenerate",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "traffic",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": "run",
      "scope": null,
      "cost": "about one LLM generation; self-check: 1 user, 1 pass",
      "card": {
        "title": "Regenerate scenario {name} and self-check it",
        "fields": [
          {
            "label": "Scenario",
            "from": "scenario_id",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.scenario_ids",
          "arg": "scenario_ids",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "scenario_restore_version",
          "how": "the previous version",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Regenerate scenario {name} and self-check it",
      "result": "{name} v{version}; self-check {self_check}"
    },
    "route": null,
    "description": "Regenerate a scenario from its source flow; saved as a new version and self-checked again (sends requests to the target).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_check_self": {
    "name": "scenario_check_self",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_check_self",
    "v1_name": "scenario_check",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "traffic",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": "run",
      "scope": null,
      "cost": "1 user, 1 pass per scenario; a failed request may trigger one LLM repair",
      "card": {
        "title": "Self-check {n} scenarios on the default environment ({env})",
        "fields": [
          {
            "label": "Scenarios",
            "from": "scenario_ids",
            "source": "args"
          },
          {
            "label": "Environment",
            "from": "(default environment)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "get_default_environment_api_v1_projects__project_id__environments_default_get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/environments/default",
          "provides": "the default environment of the project",
          "protected": false,
          "hash": [
            "id",
            "base_url",
            "protected"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.scenario_ids",
          "arg": "scenario_ids",
          "explicit": true
        },
        {
          "path": "ids.env_id",
          "arg": "env",
          "explicit": false
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "the requests were sent"
    },
    "log": {
      "args": "Self-check {n} scenarios on the default environment ({env})",
      "result": "{passed}/{n} passed"
    },
    "route": null,
    "description": "Check scenarios with a one-user self-check on the default environment; returns each request chain. Sends requests to the target.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_check_drift": {
    "name": "scenario_check_drift",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_check_drift",
    "v1_name": "scenario_check_drift",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "scenario:check",
        "target": null
      },
      "cost": "about one LLM comparison",
      "card": {
        "title": "Check drift of scenario {name}",
        "fields": [
          {
            "label": "Scenario",
            "from": "scenario_id",
            "source": "args"
          },
          {
            "label": "Reference",
            "from": "reference_source",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.scenario_ids",
          "arg": "scenario_ids",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "stores a verdict only"
    },
    "log": {
      "args": "Check drift of scenario {name}",
      "result": "staleness {score}"
    },
    "route": null,
    "description": "Check whether a scenario still matches its reference (HAR or API docs); returns a staleness score and a drift report.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "scenario_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.scenario_ids",
        "doc": "The scenario to check (id or name); default: the only one in this workspace."
      },
      {
        "name": "reference_source",
        "type": "enum",
        "enum": [
          "har",
          "openapi"
        ],
        "required": true,
        "from_state": null,
        "doc": "What to compare the scenario with: a recorded HAR session or a documentation version."
      },
      {
        "name": "reference_id",
        "type": "string",
        "min_length": 1,
        "max_length": 128,
        "required": true,
        "from_state": null,
        "doc": "The HAR session id or the documentation version id to compare with."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_export": {
    "name": "scenario_export",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_export",
    "v1_name": "scenario_export",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{scenario_id}",
      "result": "{path}"
    },
    "route": null,
    "description": "Export the scenario's Gatling project as a local ZIP without dataset values; returns its path and what to add to run it.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "scenario_id",
        "type": "uuid",
        "from_state": "ids.scenario_ids",
        "doc": "The scenario; default: the only one in this workspace."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": "zapisuje ZIP projektu Gatlinga lokalnie pod loadcraft/exports/ (ignorowane przez git); nic w backendzie się nie zmienia"
    },
    "known_debt": null
  },
  "scenario_get_versions": {
    "name": "scenario_get_versions",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_get_versions",
    "v1_name": "scenario_get_versions",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read+secret",
    "safety": "read",
    "secret": true,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{scenario_id}",
      "result": "{count} versions"
    },
    "route": null,
    "description": "Get a scenario's versions: the list, or one with its code (literals masked).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "scenario_id",
        "type": "uuid",
        "from_state": "ids.scenario_ids",
        "doc": "The scenario; default: the only one in this workspace."
      },
      {
        "name": "version",
        "type": "integer",
        "min": 1,
        "max": 100000,
        "from_state": null,
        "doc": "One version with its stored artifact (literals masked); without it, the list."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_restore_version": {
    "name": "scenario_restore_version",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_restore_version",
    "v1_name": "scenario_restore_version",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "scenario_restore_version",
          "how": "the version that was current",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{scenario_id} v{version}",
      "result": "{name}: v{version} restored; self-check cleared"
    },
    "route": null,
    "description": "Restore a scenario version as the newest one; its self-check is cleared.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "scenario_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.scenario_ids",
        "doc": "The scenario: its id or name; default: the only one in this workspace."
      },
      {
        "name": "version",
        "type": "integer",
        "min": 1,
        "max": 100000,
        "from_state": null,
        "required": true,
        "doc": "The version to make current."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_suggest_split": {
    "name": "scenario_suggest_split",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_suggest_split",
    "v1_name": "scenario_plan_split",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "scenario:copilot",
        "target": null
      },
      "cost": "1-2 LLM calls per turn",
      "card": {
        "title": "Suggest the traffic split for {n} flows",
        "fields": [
          {
            "label": "Flows",
            "from": "flow_ids",
            "source": "args"
          },
          {
            "label": "Message",
            "from": "message",
            "source": "args"
          },
          {
            "label": "Traffic split",
            "from": "split (from the process choices)",
            "source": "state"
          },
          {
            "label": "Composition name",
            "from": "composition_name (from the process choices)",
            "source": "state"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.scenario.split",
          "arg": "split",
          "explicit": true
        },
        {
          "path": "choices.scenario.composition_name",
          "arg": "composition_name",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.flow_ids",
          "arg": "flow_ids",
          "explicit": true
        },
        {
          "path": "ids.split_draft_id",
          "arg": "split_draft_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "proposes only, nothing is saved"
    },
    "log": {
      "args": "Suggest the traffic split for {n} flows",
      "result": "split proposed: {split}"
    },
    "route": "copilot",
    "description": "Suggest how to split traffic between flows (planner LLM), or review the current plan. Generates nothing.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_ask_copilot": {
    "name": "scenario_ask_copilot",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_ask_copilot",
    "v1_name": "scenario_ask_copilot",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "scenario:copilot",
        "target": "scenario_id"
      },
      "cost": "1-2 LLM calls per turn",
      "card": {
        "title": "Ask the scenario copilot about {name}",
        "fields": [
          {
            "label": "Scenario",
            "from": "scenario_id",
            "source": "args"
          },
          {
            "label": "Message",
            "from": "message",
            "source": "args"
          },
          {
            "label": "Load profile",
            "from": "profile (from the process choices)",
            "source": "state"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.run.profile",
          "arg": "profile",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.scenario_ids",
          "arg": "scenario_ids",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "proposes only, nothing is saved"
    },
    "log": {
      "args": "Ask the scenario copilot about {name}",
      "result": "{actions} actions proposed"
    },
    "route": "copilot",
    "description": "Ask the scenario copilot what to fix, or run its readiness review. Proposes actions, applies none.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "scenario_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.scenario_ids",
        "doc": "The scenario (id or name); default: the only one of this workspace."
      },
      {
        "name": "message",
        "type": "string",
        "min_length": 1,
        "max_length": 4000,
        "from_state": null,
        "doc": "The question for the scenario copilot."
      },
      {
        "name": "review",
        "type": "boolean",
        "from_state": null,
        "doc": "true: the standard readiness review instead of a question (not with message)."
      },
      {
        "name": "profile",
        "type": "object",
        "from_state": "choices.run.profile",
        "doc": "The load profile to discuss; default: the chosen one."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_get_copilot_history": {
    "name": "scenario_get_copilot_history",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_get_copilot_history",
    "v1_name": "scenario_get_copilot_history",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{scenario_id}",
      "result": "{turns} turns"
    },
    "route": "copilot",
    "description": "Get a copilot conversation: the traffic-split planner or a scenario's copilot.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "scenario_id",
        "type": "uuid",
        "from_state": null,
        "doc": "A scenario's copilot conversation (not with draft_id)."
      },
      {
        "name": "draft_id",
        "type": "uuid",
        "from_state": "ids.split_draft_id",
        "doc": "The traffic-split planner draft; default: the draft of this workspace."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 100,
        "default": 20,
        "from_state": null,
        "doc": "How many of the latest messages to return (1-100)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_list_compositions": {
    "name": "scenario_list_compositions",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_list_compositions",
    "v1_name": "scenario_list_compositions",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} compositions"
    },
    "route": null,
    "description": "List the project's compositions: name, status, member count.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "status",
        "type": "string",
        "min_length": 1,
        "max_length": 40,
        "from_state": null,
        "doc": "List only compositions with this status."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 200,
        "default": 50,
        "from_state": null,
        "doc": "How many compositions to return (1-200)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_get_composition": {
    "name": "scenario_get_composition",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_get_composition",
    "v1_name": "scenario_get_composition",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read+secret",
    "safety": "read",
    "secret": true,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{composition_id}",
      "result": "{name}: {members} members, {status}"
    },
    "route": null,
    "description": "Get a composition: members, weights, pinned versions, load profile, status, drift. Header values masked.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "composition_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.composition_id",
        "doc": "The composition: its id or name; default: the one of this workspace."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_save_composition": {
    "name": "scenario_save_composition",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_save_composition",
    "v1_name": "scenario_save_composition",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "scenario:compose",
        "target": null
      },
      "cost": null,
      "card": {
        "title": "Save composition {name}",
        "fields": [
          {
            "label": "Name",
            "from": "name",
            "source": "args"
          },
          {
            "label": "Members and weights",
            "from": "members",
            "source": "args"
          },
          {
            "label": "Load profile",
            "from": "profile",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.scenario.split",
          "arg": "members",
          "explicit": true
        },
        {
          "path": "choices.scenario.composition_name",
          "arg": "name",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.composition_id",
          "arg": "composition_id",
          "explicit": true
        },
        {
          "path": "ids.scenario_ids",
          "arg": "scenario_ids",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "scenario_save_composition",
          "how": "the previous members, weights and profile",
          "for": "update"
        },
        {
          "tool": "scenario_delete",
          "how": "kind=composition, for a new one",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Save composition {name}",
      "result": "composition {name} saved; valid: {valid}"
    },
    "route": "direct",
    "description": "Save a composition (members, weights, load profile; no id: create), validating it. Direct edit, only on request; see scenario_suggest_split.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "composition_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": null,
        "doc": "The composition to change (id or name); without it, a new one is created."
      },
      {
        "name": "name",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": null,
        "doc": "The name; required for a new composition."
      },
      {
        "name": "members",
        "type": "object",
        "from_state": null,
        "doc": "Scenario (id or name) -> its share in percent; replaces the member list."
      },
      {
        "name": "profile",
        "type": "object",
        "from_state": null,
        "doc": "The composition's load profile (users, ramp, duration), as scenario_get_composition shows it."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_check_composition": {
    "name": "scenario_check_composition",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_check_composition",
    "v1_name": "scenario_check_composition",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{composition_id}",
      "result": "valid: {valid}; {issues} issues"
    },
    "route": null,
    "description": "Check a composition: contract issues between members and version drift. Changes no user data (stores the verdict).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "composition_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.composition_id",
        "doc": "The composition: its id or name; default: the one of this workspace."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_compile_composition": {
    "name": "scenario_compile_composition",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_compile_composition",
    "v1_name": "scenario_compile_composition",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "scenario:check",
        "target": null
      },
      "cost": "backend build, up to 2 min; no LLM",
      "card": {
        "title": "Compile composition {name}",
        "fields": [
          {
            "label": "Composition",
            "from": "composition_id",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.composition_id",
          "arg": "composition_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "builds only"
    },
    "log": {
      "args": "Compile composition {name}",
      "result": "compiled: {ok}"
    },
    "route": null,
    "description": "Compile the Gatling project a run would ship, without running it (up to 2 min).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "composition_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.composition_id",
        "doc": "The composition: its id or name; default: the one of this workspace."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_get_composition_code": {
    "name": "scenario_get_composition_code",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_get_composition_code",
    "v1_name": "scenario_get_composition_code",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read+secret",
    "safety": "read",
    "secret": true,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{composition_id} {path}",
      "result": "{files} files"
    },
    "route": null,
    "description": "Get the Gatling project generated for a composition: the file tree, or one file by path (literals masked).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "composition_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.composition_id",
        "doc": "The composition: its id or name; default: the one of this workspace."
      },
      {
        "name": "path",
        "type": "string",
        "min_length": 1,
        "max_length": 300,
        "from_state": null,
        "doc": "One file of the project by its path in the tree (as listed); without it, the file tree."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_update_pins": {
    "name": "scenario_update_pins",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_update_pins",
    "v1_name": "scenario_update_composition_pins",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "scenario_save_composition",
          "how": "the previous pinned versions",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{composition_id}",
      "result": "{count} members moved to current versions"
    },
    "route": null,
    "description": "Update every drifted member of a composition to its scenario's current version.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "composition_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.composition_id",
        "doc": "The composition: its id or name; default: the one of this workspace."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_set_composition_type": {
    "name": "scenario_set_composition_type",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_set_composition_type",
    "v1_name": "scenario_set_composition_test_type",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "scenario_set_composition_type",
          "how": "the previous type",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{composition_id} {type}",
      "result": "type {type}; data re-sized"
    },
    "route": null,
    "description": "Set a composition's load test type; members are re-linked and data re-sized.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "composition_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.composition_id",
        "doc": "The composition: its id or name; default: the one of this workspace."
      },
      {
        "name": "type",
        "type": "enum",
        "enum": [
          "load_test",
          "stress_test",
          "soak_test",
          "spike_test",
          "breakpoint_test",
          "capacity_test"
        ],
        "from_state": null,
        "required": true,
        "doc": "The kind of test the composition runs."
      },
      {
        "name": "spec",
        "type": "object",
        "from_state": null,
        "required": true,
        "doc": "The parameters of that kind (users, durations, ramps, steps…); LoadCraft checks them."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "scenario_get_templates": {
    "name": "scenario_get_templates",
    "module": "scenario",
    "full_name": "mcp__plugin_loadcraft_lc__scenario_get_templates",
    "v1_name": "scenario_get_templates",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{template}",
      "result": "{count} templates"
    },
    "route": null,
    "description": "Get scenario templates; for one, its generic draft (the template's own scenarios and load, not fitted to the project).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "template",
        "type": "string",
        "min_length": 1,
        "max_length": 120,
        "from_state": null,
        "doc": "One template with its scenarios and data files (id or name); without it, the list."
      },
      {
        "name": "include",
        "type": "string[]",
        "enum": [
          "draft"
        ],
        "max_items": 1,
        "from_state": null,
        "doc": "\"draft\": its composition config for this project, nothing saved (with template only)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_suggest_actions": {
    "name": "data_suggest_actions",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_suggest_actions",
    "v1_name": "data_plan",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "data:prepare",
        "target": null
      },
      "cost": "up to 3 LLM calls (none when the data is ready)",
      "card": {
        "title": "Suggest the test data for {target}",
        "fields": [
          {
            "label": "For",
            "from": "scenario_ids | composition_id",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [
        "data_generate_dataset",
        "data_create_dataset"
      ],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.scenario_ids",
          "arg": "scenario_ids",
          "explicit": true
        },
        {
          "path": "ids.composition_id",
          "arg": "composition_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "proposes only, nothing is saved"
    },
    "log": {
      "args": "Suggest the test data for {target}",
      "result": "{actions} actions proposed"
    },
    "route": "copilot",
    "description": "Suggest the test data a scenario or composition needs (data hub LLM): proposed actions and the tool for each. Applies nothing.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_ask_copilot": {
    "name": "data_ask_copilot",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_ask_copilot",
    "v1_name": "data_ask_copilot",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "data:copilot",
        "target": null
      },
      "cost": "1-3 LLM calls per turn",
      "card": {
        "title": "Ask the data hub copilot",
        "fields": [
          {
            "label": "For",
            "from": "scenario_id | composition_id",
            "source": "args"
          },
          {
            "label": "Message",
            "from": "message",
            "source": "args"
          },
          {
            "label": "Load profile",
            "from": "profile (from the process choices)",
            "source": "state"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.run.profile",
          "arg": "profile",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.scenario_ids",
          "arg": "scenario_id",
          "explicit": true
        },
        {
          "path": "ids.composition_id",
          "arg": "composition_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "proposes only, nothing is saved"
    },
    "log": {
      "args": "Ask the data hub copilot",
      "result": "{actions} actions proposed"
    },
    "route": "copilot",
    "description": "Ask the data hub copilot in free form; returns its reply and proposed actions. Applies nothing.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "message",
        "type": "string",
        "min_length": 1,
        "max_length": 4000,
        "required": true,
        "from_state": null,
        "doc": "The question for the data hub copilot."
      },
      {
        "name": "scenario_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.scenario_ids",
        "doc": "The scenario (id or name) the question is about; give this or composition_id."
      },
      {
        "name": "composition_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.composition_id",
        "doc": "The composition (id or name); give this or scenario_id."
      },
      {
        "name": "profile",
        "type": "object",
        "from_state": "choices.run.profile",
        "doc": "The load profile to discuss; default: the chosen one."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_get_copilot_history": {
    "name": "data_get_copilot_history",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_get_copilot_history",
    "v1_name": "data_get_copilot_history",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{turns} turns"
    },
    "route": "copilot",
    "description": "Get the project's data hub conversation.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 100,
        "default": 20,
        "from_state": null,
        "doc": "How many of the latest messages to return (1-100)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_get_slots": {
    "name": "data_get_slots",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_get_slots",
    "v1_name": "data_get_slots",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{target}",
      "result": "{slots} slots, {bound} bound"
    },
    "route": null,
    "description": "Get the data slots of a scenario or composition with compatible datasets and current bindings.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "scenario_id",
        "type": "uuid",
        "from_state": "ids.scenario_ids",
        "doc": "The scenario; default: the only one in this workspace."
      },
      {
        "name": "composition_id",
        "type": "uuid",
        "from_state": "ids.composition_id",
        "doc": "The composition (not with scenario_id)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_set_bindings": {
    "name": "data_set_bindings",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_set_bindings",
    "v1_name": "data_set_bindings",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "data_set_bindings",
          "how": "the previous bindings",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{target}",
      "result": "{count} slots bound"
    },
    "route": null,
    "description": "Set the slot-to-dataset bindings of a scenario or composition (whole map replaced; {} clears).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_set_slot_label": {
    "name": "data_set_slot_label",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_set_slot_label",
    "v1_name": "data_set_slot_label",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "data_set_slot_label",
          "how": "the previous label",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{slot}",
      "result": "slot {slot}: {label}"
    },
    "route": null,
    "description": "Set the display label of a scenario's data slot.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "scenario_id",
        "type": "uuid",
        "from_state": "ids.scenario_ids",
        "doc": "The scenario; default: the only one in this workspace."
      },
      {
        "name": "slot",
        "type": "string",
        "min_length": 1,
        "max_length": 100,
        "from_state": null,
        "required": true,
        "doc": "The data slot."
      },
      {
        "name": "label",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": null,
        "required": true,
        "doc": "The slot's new label."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_check_readiness": {
    "name": "data_check_readiness",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_check_readiness",
    "v1_name": "data_check_readiness",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{target}",
      "result": "ready: {ok}; {short} slots short"
    },
    "route": null,
    "description": "Check whether the datasets cover a run of a scenario or composition under a given load and environment. Creates nothing.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_list_datasets": {
    "name": "data_list_datasets",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_list_datasets",
    "v1_name": "data_list_datasets",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read+secret",
    "safety": "read",
    "secret": true,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} datasets"
    },
    "route": null,
    "description": "List the project's datasets: name, type, columns, row count (no rows).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_get_dataset": {
    "name": "data_get_dataset",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_get_dataset",
    "v1_name": "data_get_dataset",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read+secret",
    "safety": "read",
    "secret": true,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{dataset_id} include={include}",
      "result": "{name}: {rows} rows"
    },
    "route": null,
    "description": "Get a dataset: columns, recipe, row count; include adds rows (secrets masked), consumers, history, feed snippet, Redis status.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "dataset_id",
        "type": "uuid",
        "from_state": "ids.dataset_ids",
        "doc": "The dataset; default: the only one in this workspace."
      },
      {
        "name": "include",
        "type": "string[]",
        "enum": [
          "rows",
          "consumers",
          "history",
          "snippet",
          "redis"
        ],
        "max_items": 5,
        "from_state": null,
        "doc": "rows: a masked preview (secret columns hidden); consumers: who uses it; history: revisions; snippet: the feed snippet; redis: pool status."
      },
      {
        "name": "rows",
        "type": "integer",
        "min": 1,
        "max": 50,
        "default": 10,
        "from_state": null,
        "doc": "With include rows: how many rows (1-50)."
      },
      {
        "name": "offset",
        "type": "integer",
        "min": 0,
        "max": 100000,
        "default": 0,
        "from_state": null,
        "doc": "With include rows: the first row."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_create_dataset": {
    "name": "data_create_dataset",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_create_dataset",
    "v1_name": "data_create_dataset",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": {
        "when": "preview=true (niczego nie zapisuje)",
        "level": 1,
        "why": null,
        "card": null
      },
      "escalate_to_3": [
        "secret_ref"
      ],
      "target_traffic": null,
      "scope": {
        "group": "data:prepare",
        "target": null
      },
      "cost": "uploads the file when the source is a file",
      "card": {
        "title": "Create dataset {name}",
        "fields": [
          {
            "label": "Name",
            "from": "name",
            "source": "args"
          },
          {
            "label": "Source",
            "from": "file | rules | copy_of",
            "source": "args"
          },
          {
            "label": "Rows",
            "from": "rows",
            "source": "args"
          },
          {
            "label": "Preview only",
            "from": "preview",
            "source": "args"
          },
          {
            "label": "File content",
            "from": "(size and sha256 of the file)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "file",
          "argument": "file",
          "provides": "size and sha256 of the dataset file",
          "protected": false,
          "hash": [
            "size",
            "sha256"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "data_delete",
          "how": "the new dataset",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Create dataset {name}",
      "result": "dataset {name}: {rows} rows"
    },
    "route": null,
    "description": "Create a dataset from a local file, from column rules (no AI), or as a copy of another; preview=true returns sample rows and saves nothing.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_update_dataset": {
    "name": "data_update_dataset",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_update_dataset",
    "v1_name": "data_update_dataset",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [
        "secret_ref"
      ],
      "target_traffic": null,
      "scope": {
        "group": "data:prepare",
        "target": null
      },
      "cost": "uploads the file when rows are replaced",
      "card": {
        "title": "Update dataset {name}",
        "fields": [
          {
            "label": "Dataset",
            "from": "dataset_id",
            "source": "args"
          },
          {
            "label": "Definition",
            "from": "definition",
            "source": "args"
          },
          {
            "label": "Rows from",
            "from": "file",
            "source": "args"
          },
          {
            "label": "File content",
            "from": "(size and sha256 of the file)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "file",
          "argument": "file",
          "provides": "size and sha256 of the rows file",
          "protected": false,
          "hash": [
            "size",
            "sha256"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.dataset_ids",
          "arg": "dataset_ids",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "data_restore_dataset",
          "how": "the previous content",
          "for": "update"
        },
        {
          "tool": "data_update_dataset",
          "how": "the previous definition",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Update dataset {name}",
      "result": "dataset {name} updated"
    },
    "route": "direct",
    "description": "Update a dataset's definition or replace its rows from a file. Direct edit, only on the user's request; normally use data_ask_copilot.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "dataset_id",
        "type": "uuid",
        "from_state": "ids.dataset_ids",
        "doc": "The dataset; default: the only one in this workspace."
      },
      {
        "name": "name",
        "type": "string",
        "min_length": 1,
        "max_length": 255,
        "from_state": null,
        "doc": "The new name."
      },
      {
        "name": "description",
        "type": "string",
        "max_length": 500,
        "from_state": null,
        "doc": "The new description; an empty text clears it."
      },
      {
        "name": "file",
        "type": "string",
        "min_length": 1,
        "max_length": 260,
        "from_state": null,
        "doc": "A CSV file of the project directory (relative path, up to 2 MB) whose rows replace the dataset's; the server reads it."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_regenerate_dataset": {
    "name": "data_regenerate_dataset",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_regenerate_dataset",
    "v1_name": null,
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "data:prepare",
        "target": null
      },
      "cost": "recipe generators; AI columns call the LLM",
      "card": {
        "title": "Regenerate rows of dataset {name}",
        "fields": [
          {
            "label": "Dataset",
            "from": "dataset_id",
            "source": "args"
          },
          {
            "label": "Mode",
            "from": "mode",
            "source": "args"
          },
          {
            "label": "Rows",
            "from": "rows",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.dataset_ids",
          "arg": "dataset_ids",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "data_restore_dataset",
          "how": "the previous content",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Regenerate rows of dataset {name}",
      "result": "dataset {name}: {rows} rows"
    },
    "route": null,
    "description": "Regenerate a dataset's rows from its recipe: mode=expand adds rows, mode=reroll replaces all.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "dataset_id",
        "type": "uuid",
        "from_state": "ids.dataset_ids",
        "doc": "The dataset; default: the only one in this workspace."
      },
      {
        "name": "mode",
        "type": "enum",
        "enum": [
          "expand",
          "reroll"
        ],
        "required": true,
        "from_state": null,
        "doc": "expand: add new rows up to `rows`, existing rows stay; reroll: replace all rows with fresh ones."
      },
      {
        "name": "rows",
        "type": "integer",
        "min": 1,
        "max": 100000,
        "from_state": null,
        "doc": "expand: the target row count (required, above the current count); reroll: the new row count (default: the current count)."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_restore_dataset": {
    "name": "data_restore_dataset",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_restore_dataset",
    "v1_name": null,
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "data_restore_dataset",
          "how": "call it again",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{dataset_id}",
      "result": "{name}: previous content restored"
    },
    "route": null,
    "description": "Restore a dataset's previous content (a second call switches back).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "dataset_id",
        "type": "uuid",
        "from_state": "ids.dataset_ids",
        "doc": "The dataset; default: the only one in this workspace."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_delete": {
    "name": "data_delete",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_delete",
    "v1_name": "data_delete",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "destructive",
    "safety": "destructive",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "delete",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": {
        "title": "Delete dataset: {names}",
        "fields": [
          {
            "label": "Item",
            "from": "dataset_id (name resolved by the registry)",
            "source": "labels"
          },
          {
            "label": "Also in use",
            "from": "force",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.dataset_ids",
          "arg": "dataset_ids",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "permanent"
    },
    "log": {
      "args": "Delete dataset: {names}",
      "result": "{count} datasets deleted"
    },
    "route": null,
    "description": "Delete datasets (ids). force=true also deletes ones still in use.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": [
      {
        "name": "dataset_id",
        "type": "uuid",
        "required": true,
        "from_state": null,
        "doc": "The dataset to delete."
      },
      {
        "name": "force",
        "type": "boolean",
        "default": false,
        "from_state": null,
        "doc": "Also delete it when scenarios or compositions still use it."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_generate_dataset": {
    "name": "data_generate_dataset",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_generate_dataset",
    "v1_name": "data_generate_dataset",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "data:prepare",
        "target": null
      },
      "cost": "about one LLM generation per dataset",
      "card": {
        "title": "Generate a dataset with AI for {target}",
        "fields": [
          {
            "label": "For",
            "from": "flow_id | scenario_id | slot",
            "source": "args"
          },
          {
            "label": "Rows",
            "from": "rows",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.flow_ids",
          "arg": "flow_ids",
          "explicit": true
        },
        {
          "path": "ids.scenario_ids",
          "arg": "scenario_ids",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "data_delete",
          "how": "the new dataset",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Generate a dataset with AI for {target}",
      "result": "dataset {name}: {rows} rows"
    },
    "route": null,
    "description": "Generate and save a dataset with AI for a flow, a scenario or one data slot.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.flow_ids",
        "doc": "Generate for a flow: the data its steps need (give this or scenario_id)."
      },
      {
        "name": "scenario_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.scenario_ids",
        "doc": "Generate for a scenario, or (with slot) for one of its data slots."
      },
      {
        "name": "slot",
        "type": "string",
        "min_length": 1,
        "max_length": 100,
        "from_state": null,
        "doc": "One data slot of the scenario (with scenario_id)."
      },
      {
        "name": "rows",
        "type": "integer",
        "min": 1,
        "max": 100000,
        "default": 100,
        "from_state": null,
        "doc": "How many rows to generate."
      },
      {
        "name": "name",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": null,
        "doc": "The name of the new dataset; default: made from the target."
      },
      {
        "name": "feeder_type",
        "type": "enum",
        "enum": [
          "csv",
          "tsv",
          "json"
        ],
        "default": "csv",
        "from_state": null,
        "doc": "The file format of the dataset (not for a slot)."
      },
      {
        "name": "enrich_with_llm",
        "type": "boolean",
        "default": true,
        "from_state": null,
        "doc": "A slot only: let a model enrich the values (a cost)."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_regenerate_column": {
    "name": "data_regenerate_column",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_regenerate_column",
    "v1_name": "data_regenerate_column",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": {
        "when": "preview=true z generatorem (bez LLM, niczego nie zapisuje)",
        "level": 1,
        "why": null,
        "card": null
      },
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "data:prepare",
        "target": null
      },
      "cost": "a generator is free; AI is about one LLM call",
      "card": {
        "title": "Regenerate column {column} of {name}",
        "fields": [
          {
            "label": "Dataset",
            "from": "dataset_id",
            "source": "args"
          },
          {
            "label": "Column",
            "from": "column",
            "source": "args"
          },
          {
            "label": "With",
            "from": "generator | AI",
            "source": "args"
          },
          {
            "label": "Preview only",
            "from": "preview",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.dataset_ids",
          "arg": "dataset_ids",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "data_restore_dataset",
          "how": "the previous content",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Regenerate column {column} of {name}",
      "result": "column {column}: {rows} rows"
    },
    "route": null,
    "description": "Regenerate one column of a dataset with a generator or AI; preview=true saves nothing.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_get_generators": {
    "name": "data_get_generators",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_get_generators",
    "v1_name": "data_get_generators",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} generators"
    },
    "route": null,
    "description": "Get the column generators for dataset rules, or guesses for given column names.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "columns",
        "type": "string",
        "min_length": 1,
        "max_length": 2000,
        "from_state": null,
        "doc": "Column names to guess generators for, comma-separated (at most 50); without it, the list of all generators."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_check_dataset": {
    "name": "data_check_dataset",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_check_dataset",
    "v1_name": "data_check_dataset",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write+secret",
    "safety": "write",
    "secret": true,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [
        "protected_env"
      ],
      "target_traffic": "probe",
      "scope": {
        "group": "data:check",
        "target": null
      },
      "cost": "traffic: one sign-in and a few lookups",
      "card": {
        "title": "Check dataset {name} against {env}",
        "fields": [
          {
            "label": "Dataset",
            "from": "dataset_id",
            "source": "args"
          },
          {
            "label": "Environment",
            "from": "env",
            "source": "args"
          },
          {
            "label": "Signs in as",
            "from": "(role or slot of the dataset, never values)",
            "source": "resolve"
          },
          {
            "label": "Requests",
            "from": "(one sign-in plus up to 3 lookups per id column)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "get_environment_api_v1_projects__project_id__environments__environment_id__get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/environments/{environment_id}",
          "provides": "protected flag of the environment",
          "protected": true,
          "hash": [
            "id",
            "protected"
          ],
          "volatile": []
        },
        {
          "card": "main",
          "via": "get",
          "operationId": "get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}",
          "provides": "columns and their semantics (sign-in role or slot; names only, never values)",
          "protected": false,
          "hash": [
            "columns",
            "column_semantics"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.run.env_id",
          "arg": "env",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.dataset_ids",
          "arg": "dataset_ids",
          "explicit": true
        },
        {
          "path": "ids.env_id",
          "arg": "env",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "read-only probes"
    },
    "log": {
      "args": "Check dataset {name} against {env}",
      "result": "sign-in: {ok}; {found}/{checked} entities found"
    },
    "route": null,
    "description": "Check a dataset against the target: sign in with row 1, look up entities (database: test the connection). Sends requests to the target.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "data_create_accounts": {
    "name": "data_create_accounts",
    "module": "data",
    "full_name": "mcp__plugin_loadcraft_lc__data_create_accounts",
    "v1_name": "data_create_accounts",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly+secret",
    "safety": "costly",
    "secret": true,
    "consent": {
      "level": 3,
      "level3_reason": "traffic",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": "run",
      "scope": null,
      "cost": "{count} register requests to the target",
      "card": {
        "title": "Create {count} test accounts in {env}",
        "fields": [
          {
            "label": "Slot",
            "from": "slot",
            "source": "args"
          },
          {
            "label": "Count",
            "from": "count",
            "source": "args"
          },
          {
            "label": "Environment",
            "from": "env",
            "source": "args"
          },
          {
            "label": "Register request",
            "from": "(from the scenario)",
            "source": "resolve"
          },
          {
            "label": "Append to dataset",
            "from": "dataset_id",
            "source": "args"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "get_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}",
          "provides": "the register request of the scenario (its contract)",
          "protected": false,
          "hash": [
            "scenario_contract_v2"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.run.env_id",
          "arg": "env",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.dataset_ids",
          "arg": "dataset_ids",
          "explicit": true
        },
        {
          "path": "ids.env_id",
          "arg": "env",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "the accounts stay in the target system"
    },
    "log": {
      "args": "Create {count} test accounts in {env}",
      "result": "{created} accounts created, {failed} failed"
    },
    "route": null,
    "description": "Create test accounts in the target system through its register request and append them to a dataset. Passwords are never returned.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "run_plan": {
    "name": "run_plan",
    "module": "run",
    "full_name": "mcp__plugin_loadcraft_lc__run_plan",
    "v1_name": "run_plan",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{target} {vusers} users",
      "result": "{profiles} profiles; peak {sessions} sessions; data ready: {ok}"
    },
    "route": null,
    "description": "Plan a load run (starts nothing): profiles for N users within limits, peak sessions, data readiness; a snapshot gives the production plan.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "run_start": {
    "name": "run_start",
    "module": "run",
    "full_name": "mcp__plugin_loadcraft_lc__run_start",
    "v1_name": "run_start",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "traffic",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": "run",
      "scope": null,
      "cost": "{vusers} virtual users for {duration}",
      "card": {
        "title": "Start a load run of {target} on {env}",
        "fields": [
          {
            "label": "Target",
            "from": "target",
            "source": "args"
          },
          {
            "label": "Environment",
            "from": "env",
            "source": "args"
          },
          {
            "label": "Profile",
            "from": "profile.type",
            "source": "args"
          },
          {
            "label": "Users",
            "from": "profile.vusers",
            "source": "args"
          },
          {
            "label": "Ramp-up",
            "from": "profile.ramp",
            "source": "args"
          },
          {
            "label": "Duration",
            "from": "profile.hold",
            "source": "args"
          },
          {
            "label": "Traffic snapshot",
            "from": "traffic_snapshot_id",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.run.target",
          "arg": "target",
          "explicit": true
        },
        {
          "path": "choices.run.env_id",
          "arg": "env",
          "explicit": true
        },
        {
          "path": "choices.run.profile",
          "arg": "profile",
          "explicit": true
        },
        {
          "path": "choices.run.traffic_snapshot_id",
          "arg": "traffic_snapshot_id",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.env_id",
          "arg": "env",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "process_cancel",
          "how": "stops it; sent traffic stays",
          "for": "inverse"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Start a load run of {target} on {env}",
      "result": "run {run_id}: {status}"
    },
    "route": null,
    "description": "Start a load run of a scenario or composition on a named environment and follow it; returns a handle when the time limit ends first.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "run_start_saved": {
    "name": "run_start_saved",
    "module": "run",
    "full_name": "mcp__plugin_loadcraft_lc__run_start_saved",
    "v1_name": "run_start_saved",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "traffic",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": "run",
      "scope": null,
      "cost": "the load of the saved run",
      "card": {
        "title": "Start saved run {name}",
        "fields": [
          {
            "label": "Saved run",
            "from": "saved_run_id",
            "source": "args"
          },
          {
            "label": "Target, environment, load",
            "from": "(from the saved run)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "get_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/gatling/saved-runs/{saved_run_id}",
          "provides": "target, environment and load of the saved run",
          "protected": false,
          "hash": [
            "scenario_id",
            "composite_id",
            "environment_id",
            "target_base_url",
            "workload",
            "cron_expression",
            "schedule_enabled",
            "paused",
            "feeder_bindings"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "process_cancel",
          "how": "stops it; sent traffic stays",
          "for": "inverse"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Start saved run {name}",
      "result": "run {run_id}: {status}"
    },
    "route": null,
    "description": "Start a saved run now and follow it.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "run_list": {
    "name": "run_list",
    "module": "run",
    "full_name": "mcp__plugin_loadcraft_lc__run_list",
    "v1_name": "run_list",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} runs"
    },
    "route": null,
    "description": "List the project's runs, newest first: status, target, environment; include=results adds headline results.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 200,
        "default": 20,
        "from_state": null,
        "doc": "How many runs to return (1-200)."
      },
      {
        "name": "target",
        "type": "string",
        "min_length": 1,
        "max_length": 120,
        "from_state": null,
        "doc": "Only runs of this scenario or composition (name or id)."
      },
      {
        "name": "include",
        "type": "string[]",
        "enum": [
          "results"
        ],
        "max_items": 1,
        "from_state": null,
        "doc": "\"results\": the headline numbers of each run."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "run_get": {
    "name": "run_get",
    "module": "run",
    "full_name": "mcp__plugin_loadcraft_lc__run_get",
    "v1_name": "run_get",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{run_id}",
      "result": "run {run_id}: {status}"
    },
    "route": null,
    "description": "Get one run: state, configuration, failure stage; include=diagnostics adds the build output.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid|run_handle",
        "from_state": "ids.run_id",
        "doc": "The run, as a handle (e-xxxxxxxx) or UUID; default: the run of this workspace."
      },
      {
        "name": "include",
        "type": "string[]",
        "enum": [
          "diagnostics"
        ],
        "max_items": 1,
        "from_state": null,
        "doc": "\"diagnostics\": why the run stopped or failed, when LoadCraft knows."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "run_delete": {
    "name": "run_delete",
    "module": "run",
    "full_name": "mcp__plugin_loadcraft_lc__run_delete",
    "v1_name": "run_delete",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "destructive",
    "safety": "destructive",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "delete",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": {
        "title": "Delete {kind}: {names}",
        "fields": [
          {
            "label": "Kind",
            "from": "kind",
            "source": "args"
          },
          {
            "label": "Item",
            "from": "item_id (name resolved by the registry)",
            "source": "labels"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.run_id",
          "arg": "run_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "permanent"
    },
    "log": {
      "args": "Delete {kind}: {names}",
      "result": "{count} {kind} deleted"
    },
    "route": null,
    "description": "Delete a run, a load profile or a saved run (kind + item_id). Runs in progress are refused.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": [
      {
        "name": "kind",
        "type": "enum",
        "enum": [
          "run",
          "profile",
          "saved_run"
        ],
        "required": true,
        "from_state": null,
        "doc": "What to delete."
      },
      {
        "name": "item_id",
        "type": "uuid",
        "required": true,
        "from_state": null,
        "doc": "The run, load profile or saved run to delete."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "override_reason": null
    },
    "known_debt": null
  },
  "run_get_profiles": {
    "name": "run_get_profiles",
    "module": "run",
    "full_name": "mcp__plugin_loadcraft_lc__run_get_profiles",
    "v1_name": "run_get_configs",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} profiles"
    },
    "route": null,
    "description": "Get stored load profiles: the list, or one with its injection steps.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "profile",
        "type": "string",
        "min_length": 1,
        "max_length": 120,
        "from_state": null,
        "doc": "One load profile with its injection steps (name or id); without it, the list."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "run_save_profile": {
    "name": "run_save_profile",
    "module": "run",
    "full_name": "mcp__plugin_loadcraft_lc__run_save_profile",
    "v1_name": "run_save_config",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "run_save_profile",
          "how": "the previous values",
          "for": "update"
        },
        {
          "tool": "run_delete",
          "how": "kind=profile, for a new one",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{name}",
      "result": "profile {name} saved"
    },
    "route": null,
    "description": "Save a stored load profile (users, ramp, duration, default flag; no id: create).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "profile",
        "type": "string",
        "min_length": 1,
        "max_length": 120,
        "from_state": null,
        "doc": "The load profile to change (name or id); without it, a new one is created."
      },
      {
        "name": "name",
        "type": "string",
        "min_length": 1,
        "max_length": 120,
        "from_state": null,
        "doc": "The profile name (needed to create; renames on change)."
      },
      {
        "name": "type",
        "type": "enum",
        "enum": [
          "at_once",
          "ramp",
          "constant",
          "stress",
          "spike",
          "soak",
          "ramp_concurrency",
          "constant_concurrency",
          "custom"
        ],
        "from_state": null,
        "doc": "The load shape (needed to create)."
      },
      {
        "name": "users",
        "type": "integer",
        "min": 1,
        "max": 1000000,
        "from_state": null,
        "doc": "Virtual users."
      },
      {
        "name": "duration_seconds",
        "type": "integer",
        "min": 1,
        "max": 86400,
        "from_state": null,
        "doc": "How long the load lasts."
      },
      {
        "name": "ramp_duration_seconds",
        "type": "integer",
        "min": 0,
        "max": 86400,
        "from_state": null,
        "doc": "How long the ramp lasts."
      },
      {
        "name": "description",
        "type": "string",
        "max_length": 500,
        "from_state": null,
        "doc": "A short description."
      },
      {
        "name": "is_default",
        "type": "boolean",
        "from_state": null,
        "doc": "true: make it the default profile of the project."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "run_get_saved": {
    "name": "run_get_saved",
    "module": "run",
    "full_name": "mcp__plugin_loadcraft_lc__run_get_saved",
    "v1_name": "run_get_saved",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} saved runs"
    },
    "route": null,
    "description": "Get saved runs with their schedules: the list, or one.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "saved_run",
        "type": "string",
        "min_length": 1,
        "max_length": 120,
        "from_state": null,
        "doc": "One saved run (name or id); without it, the list."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "run_save": {
    "name": "run_save",
    "module": "run",
    "full_name": "mcp__plugin_loadcraft_lc__run_save",
    "v1_name": "run_save",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": {
        "when": "saved_run_id wskazuje przebieg z włączonym, niewstrzymanym harmonogramem, a zmiana dotyka workload, environment_id albo target_base_url",
        "level": 3,
        "why": "schedule",
        "card": {
          "title": "Change the load of scheduled run {name}: next start {next_run_at}",
          "fields": [
            {
              "label": "Saved run",
              "from": "saved_run_id",
              "source": "args"
            },
            {
              "label": "Load",
              "from": "workload",
              "source": "args"
            },
            {
              "label": "Environment",
              "from": "environment_id",
              "source": "args"
            },
            {
              "label": "Target address",
              "from": "target_base_url",
              "source": "args"
            },
            {
              "label": "Schedule",
              "from": "(from the saved run)",
              "source": "resolve"
            },
            {
              "label": "Next start",
              "from": "(from the saved run)",
              "source": "resolve"
            }
          ],
          "cost": "every following scheduled start sends the new load; no further consent is asked"
        }
      },
      "escalate_to_3": [
        "scheduled_run"
      ],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [
        {
          "card": "alt",
          "via": "get",
          "operationId": "get_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/gatling/saved-runs/{saved_run_id}",
          "provides": "schedule, next start, load and target of the saved run",
          "protected": false,
          "hash": [
            "scenario_id",
            "composite_id",
            "environment_id",
            "target_base_url",
            "workload",
            "cron_expression",
            "schedule_enabled",
            "paused",
            "feeder_bindings"
          ],
          "volatile": [
            "next_run_at"
          ]
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.run.target",
          "arg": "workload",
          "explicit": true
        },
        {
          "path": "choices.run.env_id",
          "arg": "environment_id",
          "explicit": true
        },
        {
          "path": "choices.run.profile",
          "arg": "workload",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.dataset_ids",
          "arg": "feeder_bindings",
          "explicit": true
        },
        {
          "path": "ids.env_id",
          "arg": "environment_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "run_save",
          "how": "the previous values",
          "for": "update"
        },
        {
          "tool": "run_delete",
          "how": "kind=saved, for a new one",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{name}",
      "result": "saved run {name}"
    },
    "route": null,
    "description": "Save a run definition for reuse (target, load, environment, data bindings; id: update).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": [
      {
        "name": "saved_run_id",
        "type": "uuid",
        "from_state": null,
        "doc": "The saved run to change; without it, a new one is created."
      },
      {
        "name": "name",
        "type": "string",
        "min_length": 1,
        "max_length": 120,
        "from_state": null,
        "doc": "The name; required for a new saved run."
      },
      {
        "name": "scenario_id",
        "type": "uuid",
        "from_state": null,
        "doc": "The scenario a new saved run starts (give this or composition_id; new only)."
      },
      {
        "name": "composition_id",
        "type": "uuid",
        "from_state": null,
        "doc": "The composition a new saved run starts (give this or scenario_id; new only)."
      },
      {
        "name": "environment_id",
        "type": "uuid",
        "from_state": "ids.env_id",
        "doc": "The environment; set or change, never clear."
      },
      {
        "name": "target_base_url",
        "type": "string",
        "min_length": 1,
        "max_length": 500,
        "from_state": null,
        "doc": "The target address; set or change, never clear."
      },
      {
        "name": "workload",
        "type": "object",
        "from_state": "choices.run.profile",
        "doc": "The load {type, vusers, ramp, hold, thresholds}; replaced as a whole."
      },
      {
        "name": "feeder_bindings",
        "type": "object",
        "from_state": null,
        "doc": "Slot -> dataset id; replaced as a whole."
      },
      {
        "name": "source_execution_id",
        "type": "uuid",
        "from_state": null,
        "doc": "The run this saved run is made from (new only)."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "run_set_schedule": {
    "name": "run_set_schedule",
    "module": "run",
    "full_name": "mcp__plugin_loadcraft_lc__run_set_schedule",
    "v1_name": "run_set_schedule",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "traffic",
      "by_argument": {
        "when": "cron=null (wyczyszczenie) albo paused=true (wstrzymanie)",
        "level": 1,
        "why": null,
        "card": null
      },
      "escalate_to_3": [],
      "target_traffic": "run",
      "scope": null,
      "cost": "one load run at every cron tick",
      "card": {
        "title": "Schedule saved run {name}: {cron}",
        "fields": [
          {
            "label": "Saved run",
            "from": "saved_run_id",
            "source": "args"
          },
          {
            "label": "Cron",
            "from": "cron",
            "source": "args"
          },
          {
            "label": "Paused",
            "from": "paused",
            "source": "args"
          },
          {
            "label": "Next start",
            "from": "(computed)",
            "source": "derived"
          },
          {
            "label": "Target, environment, load",
            "from": "(from the saved run)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "get_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/gatling/saved-runs/{saved_run_id}",
          "provides": "target, environment and load of the saved run",
          "protected": false,
          "hash": [
            "scenario_id",
            "composite_id",
            "environment_id",
            "target_base_url",
            "workload",
            "cron_expression",
            "schedule_enabled",
            "paused",
            "feeder_bindings"
          ],
          "volatile": [
            "next_run_at"
          ]
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "run_set_schedule",
          "how": "cron=null, or the previous cron",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Schedule saved run {name}: {cron}",
      "result": "schedule: {state}"
    },
    "route": null,
    "description": "Set a saved run's cron schedule (cron=null clears it; paused=true pauses, false resumes).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "run_get_usage": {
    "name": "run_get_usage",
    "module": "run",
    "full_name": "mcp__plugin_loadcraft_lc__run_get_usage",
    "v1_name": "run_get_history",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{period}",
      "result": "{runs} runs, {minutes} compute minutes"
    },
    "route": null,
    "description": "Get finished runs over a period and the compute time they used.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "days",
        "type": "integer",
        "min": 1,
        "max": 365,
        "default": 30,
        "from_state": null,
        "doc": "How many past days of usage to return (1-365)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "results_get_report": {
    "name": "results_get_report",
    "module": "results",
    "full_name": "mcp__plugin_loadcraft_lc__results_get_report",
    "v1_name": "results_get_report",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{run_id}",
      "result": "{verdict}: {requests} requests, {errors} errors, p95 {p95} ms"
    },
    "route": null,
    "description": "Get the short report of a finished run: totals, thresholds, slowest requests, top errors.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid|run_handle",
        "from_state": "ids.run_id",
        "doc": "The run, as a handle (e-xxxxxxxx) or UUID; default: the run of this workspace."
      },
      {
        "name": "compare_to",
        "type": "uuid|run_handle|baseline",
        "from_state": "choices.run.compare_to",
        "doc": "The run to compare with (handle or UUID), or \"baseline\"; default: the choice of this workspace."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "results_get_request": {
    "name": "results_get_request",
    "module": "results",
    "full_name": "mcp__plugin_loadcraft_lc__results_get_request",
    "v1_name": "results_get_endpoint",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{run_id} {request}",
      "result": "{request}: p95 {p95} ms"
    },
    "route": null,
    "description": "Get one request's metrics and latency percentiles in a run.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid|run_handle",
        "from_state": "ids.run_id",
        "doc": "The run, as a handle (e-xxxxxxxx) or UUID; default: the run of this workspace."
      },
      {
        "name": "request",
        "type": "string",
        "from_state": null,
        "required": true,
        "max_length": 300,
        "doc": "The request as the run names it (POST /checkout), as results_get_report lists it."
      },
      {
        "name": "include",
        "type": "string[]",
        "enum": [
          "series"
        ],
        "max_items": 1,
        "from_state": null,
        "doc": "\"series\": the request over time, at the step of the run; without it, totals only."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "results_get_errors": {
    "name": "results_get_errors",
    "module": "results",
    "full_name": "mcp__plugin_loadcraft_lc__results_get_errors",
    "v1_name": "results_get_errors",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{run_id}",
      "result": "{groups} error groups"
    },
    "route": null,
    "description": "Get the error groups of a run, or one group by hash.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid|run_handle",
        "from_state": "ids.run_id",
        "doc": "The run, as a handle (e-xxxxxxxx) or UUID; default: the run of this workspace."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "results_get_traces": {
    "name": "results_get_traces",
    "module": "results",
    "full_name": "mcp__plugin_loadcraft_lc__results_get_traces",
    "v1_name": "results_get_traces",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read+secret",
    "safety": "read",
    "secret": true,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{run_id}",
      "result": "{count} traces"
    },
    "route": null,
    "description": "Get request traces of a run (all or failed only), or one trace by id. Headers and bodies masked.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid|run_handle",
        "from_state": "ids.run_id",
        "doc": "The run, as a handle (e-xxxxxxxx) or UUID; default: the run of this workspace."
      }
    ],
    "shows_content": {
      "what": "treści żądań i odpowiedzi śladów przebiegu (nagłówki: nazwy, ciała po masce)",
      "unrecognized": "hidden_entirely"
    },
    "install_allow": false,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "results_get_logs": {
    "name": "results_get_logs",
    "module": "results",
    "full_name": "mcp__plugin_loadcraft_lc__results_get_logs",
    "v1_name": "results_get_logs",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read+secret",
    "safety": "read",
    "secret": true,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{run_id}",
      "result": "{lines} lines"
    },
    "route": null,
    "description": "Get Gatling log lines of a run (masked, truncated).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid|run_handle",
        "from_state": "ids.run_id",
        "doc": "The run, as a handle (e-xxxxxxxx) or UUID; default: the run of this workspace."
      },
      {
        "name": "level",
        "type": "enum",
        "enum": [
          "error",
          "warn",
          "info",
          "debug"
        ],
        "from_state": null,
        "doc": "Only lines of this level: error, warn, info or debug."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 200,
        "default": 50,
        "from_state": null,
        "doc": "How many lines to return (1-200)."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "results_export_report": {
    "name": "results_export_report",
    "module": "results",
    "full_name": "mcp__plugin_loadcraft_lc__results_export_report",
    "v1_name": "results_export_report",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{run_id}",
      "result": "{path}"
    },
    "route": null,
    "description": "Export the archived Gatling HTML report to a local folder and return its path.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid|run_handle",
        "from_state": "ids.run_id",
        "doc": "The run, as a handle (e-xxxxxxxx) or UUID; default: the run of this workspace."
      },
      {
        "name": "overwrite",
        "type": "boolean",
        "default": false,
        "from_state": null,
        "doc": "true: replace a report of this run exported earlier; without it an existing folder is refused."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": "zapisuje pliki raportu lokalnie pod loadcraft/reports/<uchwyt>/ (ignorowane przez git); nic w backendzie się nie zmienia, więc klasa i poziom 1 zostają"
    },
    "known_debt": null
  },
  "results_check_production": {
    "name": "results_check_production",
    "module": "results",
    "full_name": "mcp__plugin_loadcraft_lc__results_check_production",
    "v1_name": "results_check_production",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{run_id}",
      "result": "load achieved: {achieved}%; think time: {verdict}"
    },
    "route": null,
    "description": "Check a production-replay run: achieved load against the plan, and the think-time verdict.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid|run_handle",
        "from_state": "ids.run_id",
        "doc": "The run, as a handle (e-xxxxxxxx) or UUID; default: the run of this workspace."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "results_compare_runs": {
    "name": "results_compare_runs",
    "module": "results",
    "full_name": "mcp__plugin_loadcraft_lc__results_compare_runs",
    "v1_name": "results_compare_runs",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{run_id} vs {compare_to}",
      "result": "{better} better, {worse} worse"
    },
    "route": null,
    "description": "Compare two runs metric by metric; compare_to=baseline uses the pinned baseline.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid|run_handle",
        "from_state": "ids.run_id",
        "doc": "The run, as a handle (e-xxxxxxxx) or UUID; default: the run of this workspace."
      },
      {
        "name": "include",
        "type": "string[]",
        "enum": [
          "errors"
        ],
        "max_items": 1,
        "from_state": null,
        "doc": "\"errors\": the console errors only in one run and in both."
      },
      {
        "name": "compare_to",
        "type": "uuid|run_handle|baseline",
        "from_state": "choices.run.compare_to",
        "doc": "The run to compare with (handle or UUID), or \"baseline\" for the pinned baseline of this run; default: the choice of this workspace."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "results_set_baseline": {
    "name": "results_set_baseline",
    "module": "results",
    "full_name": "mcp__plugin_loadcraft_lc__results_set_baseline",
    "v1_name": "results_set_baseline",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "results_set_baseline",
          "how": "the previous baseline run",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{run_id}",
      "result": "run {run_id} is the baseline"
    },
    "route": null,
    "description": "Set a run as the baseline for its scenario and environment pair.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid|run_handle",
        "from_state": "ids.run_id",
        "doc": "The run, as a handle (e-xxxxxxxx) or UUID; default: the run of this workspace."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "results_analyze_run": {
    "name": "results_analyze_run",
    "module": "results",
    "full_name": "mcp__plugin_loadcraft_lc__results_analyze_run",
    "v1_name": "results_analyze_run",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": {
        "when": "zapisana analiza już istnieje (wraca bez startu nowej)",
        "level": 1,
        "why": null,
        "card": null
      },
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "results:analyze",
        "target": null
      },
      "cost": "one LLM analysis (a stored analysis is returned free)",
      "card": {
        "title": "Analyze run {run_id} with AI",
        "fields": [
          {
            "label": "Run",
            "from": "run_id",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.run_id",
          "arg": "run_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "proposes only, nothing is saved"
    },
    "log": {
      "args": "Analyze run {run_id} with AI",
      "result": "{findings} findings"
    },
    "route": null,
    "description": "Analyze why a run went as it did: returns the stored AI analysis, or starts one and waits.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid|run_handle",
        "from_state": "ids.run_id",
        "doc": "The run, as a handle (e-xxxxxxxx) or UUID; default: the run of this workspace."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "traffic_list_snapshots": {
    "name": "traffic_list_snapshots",
    "module": "traffic",
    "full_name": "mcp__plugin_loadcraft_lc__traffic_list_snapshots",
    "v1_name": "traffic_list_snapshots",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} snapshots"
    },
    "route": null,
    "description": "List traffic snapshots, newest first, with quality summary and limits; include=format_sample adds the packet format by example.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "include",
        "type": "string[]",
        "enum": [
          "format_sample"
        ],
        "max_items": 1,
        "from_state": null,
        "doc": "\"format_sample\": the field names and shape of a traffic packet (no values)."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 100,
        "default": 20,
        "from_state": null,
        "doc": "How many snapshots to return (1-100)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "traffic_get_snapshot": {
    "name": "traffic_get_snapshot",
    "module": "traffic",
    "full_name": "mcp__plugin_loadcraft_lc__traffic_get_snapshot",
    "v1_name": "traffic_get_snapshot",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{snapshot_id}",
      "result": "{name}: quality {quality}"
    },
    "route": null,
    "description": "Get one snapshot: quality report, excluded windows, per-route series (summarized by default).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "snapshot_id",
        "type": "uuid",
        "from_state": "choices.run.traffic_snapshot_id",
        "doc": "The snapshot; default: the one chosen for runs of this workspace."
      },
      {
        "name": "series",
        "type": "enum",
        "enum": [
          "summary",
          "points"
        ],
        "default": "summary",
        "from_state": null,
        "doc": "summary: per route the count, min, max and sum; points: up to 20 routes of 60 points."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "traffic_import_snapshot": {
    "name": "traffic_import_snapshot",
    "module": "traffic",
    "full_name": "mcp__plugin_loadcraft_lc__traffic_import_snapshot",
    "v1_name": "traffic_import_snapshot",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": {
        "when": "save=false (sama walidacja)",
        "level": 1,
        "why": null,
        "card": null
      },
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "traffic:snapshot",
        "target": null
      },
      "cost": "uploads the file",
      "card": {
        "title": "Import traffic snapshot from {file}",
        "fields": [
          {
            "label": "File",
            "from": "file",
            "source": "args"
          },
          {
            "label": "Save",
            "from": "save",
            "source": "args"
          },
          {
            "label": "File content",
            "from": "(size and sha256 of the file)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "file",
          "argument": "file",
          "provides": "size and sha256 of the snapshot file",
          "protected": false,
          "hash": [
            "size",
            "sha256"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "traffic_delete",
          "how": "kind=snapshot",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Import traffic snapshot from {file}",
      "result": "snapshot {name}: quality {quality}"
    },
    "route": null,
    "description": "Import a production traffic file (JSON or CSV): validate it and, with save=true, store it as a snapshot.",
    "next_steps": [
      "traffic_list_snapshots"
    ],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "traffic_delete": {
    "name": "traffic_delete",
    "module": "traffic",
    "full_name": "mcp__plugin_loadcraft_lc__traffic_delete",
    "v1_name": "traffic_delete",
    "tier": "pipeline",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "destructive",
    "safety": "destructive",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "delete",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": {
        "title": "Delete {kind}: {names}",
        "fields": [
          {
            "label": "Kind",
            "from": "kind",
            "source": "args"
          },
          {
            "label": "Item",
            "from": "item_id (name resolved by the registry)",
            "source": "labels"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.run.traffic_snapshot_id",
          "arg": "item_id",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "permanent"
    },
    "log": {
      "args": "Delete {kind}: {names}",
      "result": "{count} {kind} deleted"
    },
    "route": null,
    "description": "Delete traffic snapshots or revoke push tokens (kind + ids). Runs using a snapshot are not checked.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": [
      {
        "name": "kind",
        "type": "enum",
        "enum": [
          "snapshot",
          "token"
        ],
        "required": true,
        "from_state": null,
        "doc": "What to delete: a traffic snapshot or a push token (revoked)."
      },
      {
        "name": "item_id",
        "type": "uuid",
        "required": true,
        "from_state": null,
        "doc": "The snapshot or token to delete."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "override_reason": null
    },
    "known_debt": null
  },
  "traffic_get_push_setup": {
    "name": "traffic_get_push_setup",
    "module": "traffic",
    "full_name": "mcp__plugin_loadcraft_lc__traffic_get_push_setup",
    "v1_name": "traffic_get_push_setup",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "composite",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{tokens} push tokens"
    },
    "route": null,
    "description": "Get the setup for pushing traffic from production: sender address and recipe, excluded run windows, existing push tokens (no secrets).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "traffic_create_token": {
    "name": "traffic_create_token",
    "module": "traffic",
    "full_name": "mcp__plugin_loadcraft_lc__traffic_create_token",
    "v1_name": "traffic_create_token",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write+secret",
    "safety": "write",
    "secret": true,
    "consent": {
      "level": 3,
      "level3_reason": "secret",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": {
        "title": "Create a traffic push token",
        "fields": [
          {
            "label": "Name",
            "from": "name",
            "source": "args"
          },
          {
            "label": "Secret written to",
            "from": "(local file, mode 0600)",
            "source": "derived"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "traffic_delete",
          "how": "kind=token revokes it",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Create a traffic push token",
      "result": "token {name} created; secret in {path}"
    },
    "route": null,
    "description": "Create a push token; its secret is written to a local file and never returned.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_get_catalog": {
    "name": "functional_get_catalog",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_get_catalog",
    "v1_name": "functional_get_catalog",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{kind} {view}",
      "result": "{count} entries"
    },
    "route": null,
    "description": "Get the global catalog of base test types, base validators or assertion types: list, one item, categories, built-in seed status.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "kind",
        "type": "enum",
        "enum": [
          "test_types",
          "validators",
          "assertion_types"
        ],
        "from_state": null,
        "required": true,
        "doc": "Which catalog: test_types, validators or assertion_types."
      },
      {
        "name": "entry_id",
        "type": "string",
        "min_length": 1,
        "max_length": 120,
        "from_state": null,
        "doc": "One entry: its id (assertion_types also by name); without it, the list."
      },
      {
        "name": "category",
        "type": "string",
        "min_length": 1,
        "max_length": 80,
        "from_state": null,
        "doc": "Only entries of this category."
      },
      {
        "name": "is_active",
        "type": "boolean",
        "from_state": null,
        "doc": "Only active (true) or inactive (false) entries (test_types, validators)."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 200,
        "default": 50,
        "from_state": null,
        "doc": "How many entries of the list to return (1-200)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_save_catalog": {
    "name": "functional_save_catalog",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_save_catalog",
    "v1_name": "functional_manage_catalog",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "functional:catalog",
        "target": null
      },
      "cost": null,
      "card": {
        "title": "Save catalog entry {name} (shared by all projects)",
        "fields": [
          {
            "label": "Kind",
            "from": "kind",
            "source": "args"
          },
          {
            "label": "Name",
            "from": "name",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "functional_save_catalog",
          "how": "the previous values",
          "for": "update"
        },
        {
          "tool": "functional_delete",
          "how": "kind=catalog_*, for a new one",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Save catalog entry {name} (shared by all projects)",
      "result": "{kind} {name} saved"
    },
    "route": null,
    "description": "Save a custom catalog entry (base test type, base validator or assertion type; no id: create). The catalog is shared by all projects.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "kind",
        "type": "enum",
        "enum": [
          "catalog_test_type",
          "catalog_validator",
          "catalog_assertion_type"
        ],
        "required": true,
        "from_state": null,
        "doc": "Which shared catalog: base test type, base validator or assertion type."
      },
      {
        "name": "entry_id",
        "type": "uuid",
        "from_state": null,
        "doc": "The entry to change; without it, a new one is created."
      },
      {
        "name": "name",
        "type": "string",
        "min_length": 1,
        "max_length": 255,
        "from_state": null,
        "doc": "The entry's name; required for a new one."
      },
      {
        "name": "fields",
        "type": "object",
        "from_state": null,
        "doc": "Fields to set: the create or update body of that catalog."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_import_catalog": {
    "name": "functional_import_catalog",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_import_catalog",
    "v1_name": null,
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "destructive",
    "safety": "destructive",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "delete",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": {
        "title": "Import the built-in catalog",
        "fields": [
          {
            "label": "Parts",
            "from": "parts",
            "source": "args"
          },
          {
            "label": "Deletes",
            "from": "built-in validators missing from the catalog",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "deleted built-in entries are gone"
    },
    "log": {
      "args": "Import the built-in catalog",
      "result": "{added} added, {updated} updated, {deleted} deleted"
    },
    "route": null,
    "description": "Import built-in catalog entries (base test types, validators, assertion types); built-in validators missing from the catalog are deleted.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": [
      {
        "name": "parts",
        "type": "string[]",
        "enum": [
          "test_types",
          "validators",
          "assertion_types"
        ],
        "max_items": 3,
        "from_state": null,
        "doc": "Which built-in parts to import; default: all three."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_get_test_types": {
    "name": "functional_get_test_types",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_get_test_types",
    "v1_name": "functional_get_test_types",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} test types"
    },
    "route": null,
    "description": "Get the project's test types: list, one, or expected-outcome candidates.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "test_type",
        "type": "string",
        "min_length": 1,
        "max_length": 120,
        "from_state": null,
        "doc": "One test type (id or name); without it, the list."
      },
      {
        "name": "view",
        "type": "enum",
        "enum": [
          "list",
          "expected_outcomes"
        ],
        "from_state": null,
        "doc": "list (default) or the expected outcomes.",
        "default": "list"
      },
      {
        "name": "is_enabled",
        "type": "boolean",
        "from_state": null,
        "doc": "Only enabled (true) or disabled (false) ones."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_save_test_types": {
    "name": "functional_save_test_types",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_save_test_types",
    "v1_name": "functional_save_test_types",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "functional:setup",
        "target": null
      },
      "cost": null,
      "card": {
        "title": "Save {n} test types in the project",
        "fields": [
          {
            "label": "Source",
            "from": "custom | catalog | suggestions",
            "source": "args"
          },
          {
            "label": "Items",
            "from": "items",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "functional_delete",
          "how": "kind=test_type, for new ones",
          "for": "create"
        },
        {
          "tool": "functional_save_test_types",
          "how": "the previous values of updated ones",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Save {n} test types in the project",
      "result": "{count} test types saved"
    },
    "route": null,
    "description": "Save test types in the project: add custom ones, catalog ones in bulk or accepted AI suggestions, or update one.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "source",
        "type": "enum",
        "enum": [
          "custom",
          "catalog",
          "suggestions"
        ],
        "from_state": null,
        "doc": "custom: new items; catalog: catalog entries to add; suggestions: accepted AI items."
      },
      {
        "name": "items",
        "type": "object",
        "from_state": null,
        "doc": "The items to add (key: name or id; value: its fields, {} for catalog ids); 1-50."
      },
      {
        "name": "test_type_id",
        "type": "uuid",
        "from_state": null,
        "doc": "Change this test type of the project instead (not with source or items)."
      },
      {
        "name": "fields",
        "type": "object",
        "from_state": null,
        "doc": "With test_type_id: the fields to set."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_suggest_test_types": {
    "name": "functional_suggest_test_types",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_suggest_test_types",
    "v1_name": "functional_suggest_test_types",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "functional:setup",
        "target": null
      },
      "cost": "one LLM run",
      "card": {
        "title": "Suggest test types from the API docs",
        "fields": [
          {
            "label": "Docs",
            "from": "docs_id",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.docs_id",
          "arg": "docs_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "proposes only, nothing is saved"
    },
    "log": {
      "args": "Suggest test types from the API docs",
      "result": "{count} test types proposed"
    },
    "route": null,
    "description": "Suggest custom test types from the project's API docs (LLM); nothing is saved until accepted.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "docs_id",
        "type": "uuid",
        "required": true,
        "from_state": null,
        "doc": "The API docs to read (project_get_docs lists them)."
      },
      {
        "name": "focus_areas",
        "type": "string",
        "max_length": 300,
        "from_state": null,
        "doc": "Comma-separated areas to prioritize (e.g. security, limits); default: none."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_generate_test_types": {
    "name": "functional_generate_test_types",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_generate_test_types",
    "v1_name": "functional_generate_test_types",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "functional:setup",
        "target": null
      },
      "cost": "LLM fills expected outcomes of each type",
      "card": {
        "title": "Generate the missing base test types",
        "fields": [
          {
            "label": "Missing",
            "from": "(counted by the registry)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "list_project_test_types_api_v1_projects__project_id__test_types_get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/test-types",
          "provides": "test types the project has",
          "protected": false,
          "hash": [
            "items"
          ],
          "volatile": []
        },
        {
          "card": "main",
          "via": "get",
          "operationId": "list_base_test_types_api_v1_base_test_types_get",
          "method": "GET",
          "path": "/api/v1/base-test-types",
          "provides": "base test types the project should have",
          "protected": false,
          "hash": [
            "test_types"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "functional_delete",
          "how": "kind=test_type",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Generate the missing base test types",
      "result": "{count} test types added"
    },
    "route": null,
    "description": "Generate all missing base test types for the project; the LLM fills their expected outcomes.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "include_categories",
        "type": "string",
        "max_length": 300,
        "from_state": null,
        "doc": "Comma-separated categories to generate (e.g. functional, security); default: all."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_get_validators": {
    "name": "functional_get_validators",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_get_validators",
    "v1_name": "functional_get_validators",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} validators"
    },
    "route": null,
    "description": "Get the project's validators: list, one, applicable catalog validators, or Gatling enforcement levels.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "validator",
        "type": "string",
        "min_length": 1,
        "max_length": 120,
        "from_state": null,
        "doc": "One validator (id or name); without it, the list."
      },
      {
        "name": "view",
        "type": "enum",
        "enum": [
          "list",
          "applicable",
          "gatling_enforcement"
        ],
        "from_state": null,
        "doc": "list (default), the applicable ones, or how load runs enforce them.",
        "default": "list"
      },
      {
        "name": "is_enabled",
        "type": "boolean",
        "from_state": null,
        "doc": "Only enabled (true) or disabled (false) ones."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_save_validators": {
    "name": "functional_save_validators",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_save_validators",
    "v1_name": "functional_save_validators",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "functional:setup",
        "target": null
      },
      "cost": null,
      "card": {
        "title": "Save {n} validators in the project",
        "fields": [
          {
            "label": "Source",
            "from": "custom | catalog | proposals",
            "source": "args"
          },
          {
            "label": "Items",
            "from": "items",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "functional_delete",
          "how": "kind=validator, for new ones",
          "for": "create"
        },
        {
          "tool": "functional_save_validators",
          "how": "the previous values of updated ones",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Save {n} validators in the project",
      "result": "{count} validators saved"
    },
    "route": null,
    "description": "Save validators in the project: add custom ones, catalog ones in bulk or accepted proposals, or update one.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "source",
        "type": "enum",
        "enum": [
          "custom",
          "catalog",
          "proposals"
        ],
        "from_state": null,
        "doc": "custom: new items; catalog: catalog entries to add; proposals: accepted AI items."
      },
      {
        "name": "items",
        "type": "object",
        "from_state": null,
        "doc": "The items to add (key: name or id; value: its fields, {} for catalog ids); 1-50."
      },
      {
        "name": "validator_id",
        "type": "uuid",
        "from_state": null,
        "doc": "Change this validator of the project instead (not with source or items)."
      },
      {
        "name": "fields",
        "type": "object",
        "from_state": null,
        "doc": "With validator_id: the fields to set."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_suggest_validators": {
    "name": "functional_suggest_validators",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_suggest_validators",
    "v1_name": "functional_suggest_validators",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "functional:setup",
        "target": null
      },
      "cost": "one LLM run",
      "card": {
        "title": "Suggest validators from the API docs and recorded runs",
        "fields": [
          {
            "label": "Docs",
            "from": "docs_id",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "proposes only, nothing is saved"
    },
    "log": {
      "args": "Suggest validators from the API docs and recorded runs",
      "result": "{count} validators proposed"
    },
    "route": null,
    "description": "Suggest project-specific validators from the API docs and recorded runs (LLM); nothing is saved.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "docs_id",
        "type": "uuid",
        "required": true,
        "from_state": null,
        "doc": "The API docs to read (project_get_docs lists them)."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_get_analytics": {
    "name": "functional_get_analytics",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_get_analytics",
    "v1_name": "functional_get_analytics",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{view} {days} days",
      "result": "{view}"
    },
    "route": null,
    "description": "Get validator quality over N days: dashboard, flaky validators, failure patterns, accuracy, trend, threshold suggestion (view).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "view",
        "type": "enum",
        "enum": [
          "dashboard",
          "flaky",
          "failure_patterns",
          "accuracy",
          "trend",
          "threshold_suggestion"
        ],
        "from_state": null,
        "doc": "Which analysis; default: dashboard.",
        "default": "dashboard"
      },
      {
        "name": "days",
        "type": "integer",
        "min": 1,
        "max": 365,
        "default": 30,
        "from_state": null,
        "doc": "How many past days (1-365)."
      },
      {
        "name": "validator",
        "type": "string",
        "min_length": 1,
        "max_length": 120,
        "from_state": null,
        "doc": "The validator (id or name); needed for accuracy, trend and threshold_suggestion."
      },
      {
        "name": "threshold_pct",
        "type": "integer",
        "min": 0,
        "max": 100,
        "default": 20,
        "from_state": null,
        "doc": "With view flaky: the flakiness threshold in percent."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_get_flows": {
    "name": "functional_get_flows",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_get_flows",
    "v1_name": "functional_get_flows",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} functional flows"
    },
    "route": null,
    "description": "Get functional test flows (block graphs, per docs version): list, one, or version history.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow",
        "type": "string",
        "min_length": 1,
        "max_length": 120,
        "from_state": null,
        "doc": "One functional flow (id); without it, the list."
      },
      {
        "name": "view",
        "type": "enum",
        "enum": [
          "list",
          "versions"
        ],
        "from_state": null,
        "doc": "list (default) or the versions of one flow.",
        "default": "list"
      },
      {
        "name": "docs_id",
        "type": "uuid",
        "from_state": "ids.docs_id",
        "doc": "Only flows of this documentation version; default: the one of this workspace."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 200,
        "default": 50,
        "from_state": null,
        "doc": "How many flows to return (1-200)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_save_flow": {
    "name": "functional_save_flow",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_save_flow",
    "v1_name": "functional_save_flow",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "functional_restore_flow",
          "how": "the previous version",
          "for": "update"
        },
        {
          "tool": "functional_save_flow",
          "how": "the previous values",
          "for": "update"
        },
        {
          "tool": "functional_delete",
          "how": "kind=flow, for a new one",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{flow_id}",
      "result": "functional flow {name} saved"
    },
    "route": null,
    "description": "Save a functional test flow (blocks and edges; no id: create), or snapshot it as a version.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_id",
        "type": "uuid",
        "from_state": null,
        "doc": "The flow to change; without it, a new flow is created."
      },
      {
        "name": "name",
        "type": "string",
        "min_length": 1,
        "max_length": 255,
        "from_state": null,
        "doc": "The flow's name; required for a new flow."
      },
      {
        "name": "docs_id",
        "type": "uuid",
        "from_state": "ids.docs_id",
        "doc": "The API docs of a new flow; default: the active docs."
      },
      {
        "name": "fields",
        "type": "object",
        "from_state": null,
        "doc": "Fields to set: blocks, edges, entry_block_id, description, tags, variables, timeout_ms, retry_count, retry_delay_ms, is_active."
      },
      {
        "name": "version",
        "type": "string",
        "min_length": 1,
        "max_length": 60,
        "from_state": null,
        "doc": "Save a named snapshot of the current blocks and edges instead (not with name or fields)."
      },
      {
        "name": "reason",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": null,
        "doc": "With version: why the snapshot is taken."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_restore_flow": {
    "name": "functional_restore_flow",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_restore_flow",
    "v1_name": "functional_restore_flow_version",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "functional_restore_flow",
          "how": "the snapshot taken before the restore",
          "for": "update"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{flow_id} {version}",
      "result": "{name}: version {version} restored"
    },
    "route": null,
    "description": "Restore a functional flow to a saved version; the current state is snapshotted first.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_id",
        "type": "uuid",
        "from_state": null,
        "required": true,
        "doc": "The functional flow."
      },
      {
        "name": "version",
        "type": "string",
        "min_length": 1,
        "max_length": 60,
        "from_state": null,
        "required": true,
        "doc": "The label of the stored version to restore."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_get_templates": {
    "name": "functional_get_templates",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_get_templates",
    "v1_name": "functional_get_templates",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} templates"
    },
    "route": null,
    "description": "Get functional test templates: list (by docs version or tags) or one.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "template",
        "type": "string",
        "min_length": 1,
        "max_length": 120,
        "from_state": null,
        "doc": "One template (id or name); without it, the list."
      },
      {
        "name": "docs_id",
        "type": "uuid",
        "from_state": "ids.docs_id",
        "doc": "Only templates of this documentation version; default: the one of this workspace."
      },
      {
        "name": "tags",
        "type": "string",
        "min_length": 1,
        "max_length": 500,
        "from_state": null,
        "doc": "Only templates with these tags, comma-separated (at most 10)."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 200,
        "default": 50,
        "from_state": null,
        "doc": "How many templates to return (1-200)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_save_template": {
    "name": "functional_save_template",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_save_template",
    "v1_name": "functional_save_template",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "functional_save_template",
          "how": "the previous values",
          "for": "update"
        },
        {
          "tool": "functional_delete",
          "how": "kind=template, for a new one",
          "for": "create"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "{name}",
      "result": "template {name} saved"
    },
    "route": null,
    "description": "Save a functional test template (no id: create).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "template_id",
        "type": "uuid",
        "from_state": null,
        "doc": "The template to change; without it, a new template is created."
      },
      {
        "name": "name",
        "type": "string",
        "min_length": 1,
        "max_length": 255,
        "from_state": null,
        "doc": "The template's name; required for a new one."
      },
      {
        "name": "docs_id",
        "type": "uuid",
        "from_state": null,
        "doc": "The API docs the template belongs to, if any."
      },
      {
        "name": "fields",
        "type": "object",
        "from_state": null,
        "doc": "Fields to set: api_description and flow_definition (required for a new one), assertions, endpoint_ids, tags, description, is_active."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_delete": {
    "name": "functional_delete",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_delete",
    "v1_name": "functional_delete",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "destructive",
    "safety": "destructive",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "delete",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": {
        "title": "Delete {kind}: {names}",
        "fields": [
          {
            "label": "Kind",
            "from": "kind",
            "source": "args"
          },
          {
            "label": "Item",
            "from": "item_id (name resolved by the registry)",
            "source": "labels"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.functional_run_id",
          "arg": "retry_of",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "permanent"
    },
    "log": {
      "args": "Delete {kind}: {names}",
      "result": "{count} {kind} deleted"
    },
    "route": null,
    "description": "Delete one functional flow, template, test type, validator, run or catalog entry (kind + item_id).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": [
      {
        "name": "kind",
        "type": "enum",
        "enum": [
          "flow",
          "template",
          "test_type",
          "validator",
          "run",
          "catalog_test_type",
          "catalog_validator",
          "catalog_assertion_type"
        ],
        "required": true,
        "from_state": null,
        "doc": "What to delete."
      },
      {
        "name": "item_id",
        "type": "uuid",
        "required": true,
        "from_state": null,
        "doc": "The item to delete (one per call)."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_start_run": {
    "name": "functional_start_run",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_start_run",
    "v1_name": "functional_start_run",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "traffic",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": "run",
      "scope": null,
      "cost": "real requests: {n} flows x {types} test types",
      "card": {
        "title": "Start a functional run of {n} flows on {env}",
        "fields": [
          {
            "label": "Flows",
            "from": "flow_ids",
            "source": "args"
          },
          {
            "label": "Test types",
            "from": "test_type_ids",
            "source": "args"
          },
          {
            "label": "Environment",
            "from": "env",
            "source": "args"
          },
          {
            "label": "Rerun of",
            "from": "retry_of",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.functional.flow_ids",
          "arg": "flow_ids",
          "explicit": true
        },
        {
          "path": "choices.functional.test_type_ids",
          "arg": "test_type_ids",
          "explicit": true
        },
        {
          "path": "choices.functional.env_id",
          "arg": "env",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.functional_run_id",
          "arg": "retry_of",
          "explicit": true
        },
        {
          "path": "ids.env_id",
          "arg": "env",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "process_cancel",
          "how": "stops it; sent requests stay",
          "for": "inverse"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Start a functional run of {n} flows on {env}",
      "result": "functional run {run_id}: {status}"
    },
    "route": null,
    "description": "Start a functional run of flows with chosen test types on an environment (or rerun with retry_of); returns a handle on timeout.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_get_runs": {
    "name": "functional_get_runs",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_get_runs",
    "v1_name": "functional_get_runs",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{count} functional runs"
    },
    "route": null,
    "description": "Get functional runs: list (filter by status or type), by run template, or one with its status.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid",
        "from_state": null,
        "doc": "One functional run; without it, the list."
      },
      {
        "name": "view",
        "type": "enum",
        "enum": [
          "list",
          "one",
          "by_template"
        ],
        "from_state": null,
        "doc": "list (default), one run, or the runs of a template.",
        "default": "list"
      },
      {
        "name": "template",
        "type": "uuid",
        "from_state": null,
        "doc": "With view by_template: the template."
      },
      {
        "name": "status",
        "type": "enum",
        "enum": [
          "pending",
          "running",
          "completed",
          "failed",
          "cancelled"
        ],
        "from_state": null,
        "doc": "Only runs in this status."
      },
      {
        "name": "type",
        "type": "enum",
        "enum": [
          "adhoc",
          "template"
        ],
        "from_state": null,
        "doc": "Only ad hoc or template runs."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 100,
        "default": 20,
        "from_state": null,
        "doc": "How many runs to return (1-100)."
      },
      {
        "name": "offset",
        "type": "integer",
        "min": 0,
        "max": 100000,
        "default": 0,
        "from_state": null,
        "doc": "The first run of the list."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_get_results": {
    "name": "functional_get_results",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_get_results",
    "v1_name": "functional_get_results",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read+secret",
    "safety": "read",
    "secret": true,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{run_id}",
      "result": "{passed} passed, {failed} failed"
    },
    "route": null,
    "description": "Get the results of a functional run: summary with flow results, one flow result, or the captured HTTP log (secrets masked).",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid",
        "from_state": null,
        "required": true,
        "doc": "The functional run."
      },
      {
        "name": "view",
        "type": "enum",
        "enum": [
          "summary",
          "flows",
          "one",
          "http_log"
        ],
        "from_state": null,
        "doc": "summary (default), per flow, one result, or the HTTP log.",
        "default": "summary"
      },
      {
        "name": "result_id",
        "type": "uuid",
        "from_state": null,
        "doc": "With view one: the result."
      },
      {
        "name": "log_type",
        "type": "enum",
        "enum": [
          "request",
          "response",
          "log"
        ],
        "from_state": null,
        "doc": "With view http_log: which part."
      },
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 200,
        "default": 50,
        "from_state": null,
        "doc": "How many entries to return (1-200)."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_compare_runs": {
    "name": "functional_compare_runs",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_compare_runs",
    "v1_name": "functional_compare_runs",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{run_id} vs {other}",
      "result": "{changed} blocks differ"
    },
    "route": null,
    "description": "Compare two functional runs block by block: status, response shape, timing.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "run_id",
        "type": "uuid",
        "from_state": null,
        "required": true,
        "doc": "The functional run."
      },
      {
        "name": "other",
        "type": "uuid",
        "from_state": null,
        "required": true,
        "doc": "The run to compare with."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "functional_generate_payloads": {
    "name": "functional_generate_payloads",
    "module": "functional",
    "full_name": "mcp__plugin_loadcraft_lc__functional_generate_payloads",
    "v1_name": "functional_generate_payloads",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "process",
    "class": "costly",
    "safety": "costly",
    "secret": false,
    "consent": {
      "level": 2,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": {
        "group": "functional:payloads",
        "target": null
      },
      "cost": "LLM per flow and test type",
      "card": {
        "title": "Generate payloads for {n} flows",
        "fields": [
          {
            "label": "Flows",
            "from": "flow_ids",
            "source": "args"
          },
          {
            "label": "Test types",
            "from": "test_type_ids",
            "source": "args"
          }
        ]
      },
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [
        {
          "path": "choices.functional.flow_ids",
          "arg": "flow_ids",
          "explicit": true
        },
        {
          "path": "choices.functional.test_type_ids",
          "arg": "test_type_ids",
          "explicit": true
        },
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "nothing",
      "ways": [],
      "reason": "writes a local file only"
    },
    "log": {
      "args": "Generate payloads for {n} flows",
      "result": "ZIP saved to {path}"
    },
    "route": null,
    "description": "Generate request payloads for flows and test types; saves the ZIP to a local file and returns its path.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "flow_ids",
        "type": "object",
        "required": true,
        "from_state": null,
        "doc": "The flows to generate for (key: flow id; value: {}); 1-50."
      },
      {
        "name": "test_types",
        "type": "object",
        "required": true,
        "from_state": null,
        "doc": "The test types to use (key: test type id; value: cases per flow, 1-20); 1-50."
      },
      {
        "name": "file",
        "type": "string",
        "min_length": 1,
        "max_length": 260,
        "from_state": null,
        "doc": "Where to save the ZIP: a relative path in the project directory; default under loadcraft/payloads/. Never overwrites."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "github_get_status": {
    "name": "github_get_status",
    "module": "github",
    "full_name": "mcp__plugin_loadcraft_lc__github_get_status",
    "v1_name": "github_get_status",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "linked: {linked}"
    },
    "route": null,
    "description": "Get the project's GitHub link status; include=history adds recent pushes and pulls.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "include",
        "type": "string[]",
        "enum": [
          "history"
        ],
        "max_items": 1,
        "from_state": null,
        "doc": "\"history\": the latest syncs."
      },
      {
        "name": "history_limit",
        "type": "integer",
        "min": 1,
        "max": 50,
        "default": 10,
        "from_state": null,
        "doc": "With include history: how many syncs (1-50)."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "github_connect": {
    "name": "github_connect",
    "module": "github",
    "full_name": "mcp__plugin_loadcraft_lc__github_connect",
    "v1_name": "github_connect",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "secret",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": {
        "title": "Connect the project to {repo}",
        "fields": [
          {
            "label": "Repository",
            "from": "repo",
            "source": "args"
          },
          {
            "label": "Branch",
            "from": "branch",
            "source": "args"
          },
          {
            "label": "Token from",
            "from": "env_file",
            "source": "args"
          },
          {
            "label": "Env file content",
            "from": "(sha256 of the file; values are never shown)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "file",
          "argument": "env_file",
          "provides": "sha256 of the env file with the token",
          "protected": false,
          "hash": [
            "size",
            "sha256"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "github_disconnect",
          "how": "",
          "for": "inverse"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Connect the project to {repo}",
      "result": "linked to {repo}"
    },
    "route": null,
    "description": "Connect the project to a GitHub repository with a personal access token read from an env file.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": null,
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "github_plan_push": {
    "name": "github_plan_push",
    "module": "github",
    "full_name": "mcp__plugin_loadcraft_lc__github_plan_push",
    "v1_name": "github_plan_push",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "{composition_id}",
      "result": "{files} files would change"
    },
    "route": null,
    "description": "Plan a push: the diff a composition's push would produce; writes nothing.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "composition_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.composition_id",
        "doc": "The composition: its id or name; default: the one of this workspace."
      },
      {
        "name": "diffs",
        "type": "boolean",
        "default": false,
        "from_state": null,
        "doc": "true: a short diff per file (up to 10 files, 40 lines each); without it, the file list."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "github_push": {
    "name": "github_push",
    "module": "github",
    "full_name": "mcp__plugin_loadcraft_lc__github_push",
    "v1_name": "github_push",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "write",
    "safety": "write",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "external",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": {
        "title": "Push composition {name} to {repo}",
        "fields": [
          {
            "label": "Composition",
            "from": "composition_id",
            "source": "args"
          },
          {
            "label": "Repository, branch",
            "from": "(from the link)",
            "source": "resolve"
          },
          {
            "label": "Changes",
            "from": "(file count from github_plan_push)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "get_github_status_api_v1_projects__project_id__github_status_get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/github/status",
          "provides": "repository and branch of the link",
          "protected": false,
          "hash": [
            "repo_url",
            "branch"
          ],
          "volatile": []
        },
        {
          "card": "main",
          "via": "get",
          "operationId": "get_diff_preview_api_v1_projects__project_id__github_diff_preview_get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/github/diff-preview",
          "provides": "the files the push would change",
          "protected": false,
          "hash": [
            "files"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        },
        {
          "path": "ids.composition_id",
          "arg": "composition_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "no",
      "ways": [],
      "reason": "the commit stays in the repository (revert it there)"
    },
    "log": {
      "args": "Push composition {name} to {repo}",
      "result": "pushed: {commit}"
    },
    "route": null,
    "description": "Push a composition's generated Gatling project to the linked repository.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": [
      {
        "name": "composition_id",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "from_state": "ids.composition_id",
        "doc": "The composition: its id or name; default: the one of this workspace."
      },
      {
        "name": "message",
        "type": "string",
        "min_length": 1,
        "max_length": 200,
        "required": true,
        "from_state": null,
        "doc": "The commit message."
      },
      {
        "name": "create_pr",
        "type": "boolean",
        "default": false,
        "from_state": null,
        "doc": "true: open a pull request instead of committing to the branch."
      }
    ],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": null
    },
    "known_debt": null
  },
  "github_get_changes": {
    "name": "github_get_changes",
    "module": "github",
    "full_name": "mcp__plugin_loadcraft_lc__github_get_changes",
    "v1_name": "github_pull",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "read",
    "safety": "read",
    "secret": false,
    "consent": {
      "level": 1,
      "level3_reason": null,
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": null,
      "resolve": [],
      "snapshot": false,
      "follow_ups": [],
      "freeze": [],
      "max_items": null
    },
    "undo": {
      "reversible": null,
      "ways": [],
      "reason": null
    },
    "log": {
      "args": "",
      "result": "{files} files changed since the last sync"
    },
    "route": null,
    "description": "Get repository changes since the last sync: the file list only. Moves the sync marker: a second call returns nothing.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": false,
    "views": null,
    "arguments": [
      {
        "name": "limit",
        "type": "integer",
        "min": 1,
        "max": 200,
        "default": 50,
        "from_state": null,
        "doc": "How many changed files to list (1-200); the count is always the whole number."
      }
    ],
    "shows_content": null,
    "install_allow": true,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "override_reason": "pull przesuwa znacznik synchronizacji w backendzie: drugie wywołanie zwraca pustą listę"
    },
    "known_debt": null
  },
  "github_disconnect": {
    "name": "github_disconnect",
    "module": "github",
    "full_name": "mcp__plugin_loadcraft_lc__github_disconnect",
    "v1_name": "github_disconnect",
    "tier": "extended",
    "audience": "model",
    "always_load": false,
    "kind": "atomic",
    "class": "destructive",
    "safety": "destructive",
    "secret": false,
    "consent": {
      "level": 3,
      "level3_reason": "delete",
      "by_argument": null,
      "escalate_to_3": [],
      "target_traffic": null,
      "scope": null,
      "cost": null,
      "card": {
        "title": "Disconnect the project from {repo}",
        "fields": [
          {
            "label": "Repository",
            "from": "(from the link)",
            "source": "resolve"
          }
        ]
      },
      "resolve": [
        {
          "card": "main",
          "via": "get",
          "operationId": "get_github_status_api_v1_projects__project_id__github_status_get",
          "method": "GET",
          "path": "/api/v1/projects/{project_id}/github/status",
          "provides": "repository of the link",
          "protected": false,
          "hash": [
            "repo_url"
          ],
          "volatile": []
        }
      ],
      "snapshot": true,
      "follow_ups": [],
      "freeze": [
        {
          "path": "ids.project_id",
          "arg": "project_id",
          "explicit": true
        }
      ],
      "max_items": null
    },
    "undo": {
      "reversible": "yes",
      "ways": [
        {
          "tool": "github_connect",
          "how": "connect again (token needed)",
          "for": "inverse"
        }
      ],
      "reason": null
    },
    "log": {
      "args": "Disconnect the project from {repo}",
      "result": "disconnected"
    },
    "route": null,
    "description": "Disconnect the project from its GitHub repository.",
    "next_steps": [],
    "pending_operations": null,
    "requires_capability": null,
    "requires_user_interaction": true,
    "views": null,
    "arguments": [],
    "shows_content": null,
    "install_allow": false,
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "override_reason": null
    },
    "known_debt": null
  }
};

export const MODULES: Readonly<Record<ModuleName, CatalogModule>> = {
  "process": {
    "name": "process",
    "tier": "core",
    "subagent": null,
    "skill": "Rdzeń: stan procesu, wznowienie, czekanie, anulowanie, odpowiedź na kartę i zapis decyzji; używa go rozmowa główna (i mod: zapis decyzji).",
    "state_in": "cały process[project_id]",
    "state_out": "step, choices.*, pending[] (decyzje i wyniki), operations[], problems[]",
    "subagent_tools": null,
    "subagent_tools_default_mode": null,
    "subagent_model": null,
    "counts": {
      "tools": 6,
      "operations": 13,
      "atomic": 4,
      "composite": 1,
      "process": 1,
      "level1": 6,
      "level2": 0,
      "level3": 0
    },
    "tools": [
      "process_get_status",
      "process_wait",
      "process_cancel",
      "process_answer",
      "process_set_choices",
      "process_set_decision"
    ]
  },
  "project": {
    "name": "project",
    "tier": "pipeline",
    "subagent": "loadcraft-project",
    "skill": "Zakłada i konfiguruje projekt: środowiska, dokumentacja API, profil z analizy, serwer logów, zespół.",
    "state_in": "ids.project_id (albo brak: nowy projekt)",
    "state_out": "ids.project_id, ids.env_id, ids.docs_id, steps.project.*",
    "subagent_tools": [
      "process_get_status",
      "process_wait",
      "project_list",
      "project_get",
      "project_create",
      "project_update",
      "project_set_profile",
      "project_delete",
      "project_get_envs",
      "project_save_env",
      "project_check_env",
      "project_get_docs",
      "project_get_endpoints",
      "project_import_docs",
      "project_set_active_docs",
      "project_analyze_setup",
      "project_apply_setup",
      "project_get_apimap",
      "project_set_apimap",
      "project_connect_telemetry",
      "project_disconnect_telemetry",
      "project_list_notes",
      "project_update_note",
      "project_list_team",
      "project_save_member",
      "project_get_activity",
      "project_get_http_settings",
      "project_set_http_settings"
    ],
    "subagent_tools_default_mode": [
      "process_get_status",
      "process_wait",
      "project_list",
      "project_get",
      "project_create",
      "project_update",
      "project_set_profile",
      "project_delete",
      "project_get_envs",
      "project_save_env",
      "project_check_env",
      "project_get_docs",
      "project_get_endpoints",
      "project_import_docs",
      "project_set_active_docs",
      "project_analyze_setup",
      "project_apply_setup",
      "project_get_apimap",
      "project_set_apimap",
      "project_connect_telemetry",
      "project_disconnect_telemetry",
      "project_list_notes",
      "project_update_note",
      "project_list_team",
      "project_save_member",
      "project_get_activity",
      "project_get_http_settings",
      "project_set_http_settings"
    ],
    "subagent_model": "tańszy",
    "counts": {
      "tools": 26,
      "operations": 58,
      "atomic": 20,
      "composite": 5,
      "process": 1,
      "level1": 14,
      "level2": 10,
      "level3": 2
    },
    "tools": [
      "project_list",
      "project_get",
      "project_create",
      "project_update",
      "project_set_profile",
      "project_delete",
      "project_get_envs",
      "project_save_env",
      "project_check_env",
      "project_get_docs",
      "project_get_endpoints",
      "project_import_docs",
      "project_set_active_docs",
      "project_analyze_setup",
      "project_apply_setup",
      "project_get_apimap",
      "project_set_apimap",
      "project_connect_telemetry",
      "project_disconnect_telemetry",
      "project_list_notes",
      "project_update_note",
      "project_list_team",
      "project_save_member",
      "project_get_activity",
      "project_get_http_settings",
      "project_set_http_settings"
    ]
  },
  "flows": {
    "name": "flows",
    "tier": "pipeline",
    "subagent": "loadcraft-flows",
    "skill": "Tworzy flowy trzema drogami: z propozycji z dokumentacji API, z nagrania HAR albo z opisu słownego (plan i przejście w przeglądarce backendu); potem je pokazuje i poprawia.",
    "state_in": "ids.project_id, ids.env_id, ids.docs_id, choices.flows.*",
    "state_out": "ids.flow_ids[], ids.har_session_id, ids.walk_id, steps.flows.*",
    "subagent_tools": [
      "process_get_status",
      "process_wait",
      "flows_suggest_journeys",
      "flows_generate_from_suggestions",
      "flows_generate_from_endpoints",
      "flows_generate_from_har",
      "flows_regenerate",
      "flows_import_har",
      "flows_describe_journeys",
      "flows_record_journeys",
      "flows_get_walks",
      "flows_retry_walk",
      "flows_save_walk_note",
      "flows_export_walk_image",
      "flows_list",
      "flows_get",
      "flows_get_versions",
      "flows_restore_version",
      "flows_save",
      "flows_delete",
      "flows_duplicate",
      "flows_migrate_docs",
      "flows_merge",
      "flows_set_poll_terminals",
      "flows_ask_copilot",
      "flows_apply_copilot_changes",
      "flows_get_copilot_history",
      "project_get_docs",
      "project_get_endpoints",
      "project_get_envs"
    ],
    "subagent_tools_default_mode": [
      "process_get_status",
      "process_wait",
      "flows_suggest_journeys",
      "flows_generate_from_suggestions",
      "flows_generate_from_endpoints",
      "flows_generate_from_har",
      "flows_regenerate",
      "flows_import_har",
      "flows_describe_journeys",
      "flows_record_journeys",
      "flows_get_walks",
      "flows_retry_walk",
      "flows_save_walk_note",
      "flows_export_walk_image",
      "flows_list",
      "flows_get",
      "flows_get_versions",
      "flows_restore_version",
      "flows_save",
      "flows_delete",
      "flows_duplicate",
      "flows_migrate_docs",
      "flows_merge",
      "flows_set_poll_terminals",
      "flows_ask_copilot",
      "flows_apply_copilot_changes",
      "flows_get_copilot_history",
      "project_get_docs",
      "project_get_endpoints",
      "project_get_envs"
    ],
    "subagent_model": "mocniejszy",
    "counts": {
      "tools": 25,
      "operations": 44,
      "atomic": 15,
      "composite": 3,
      "process": 7,
      "level1": 13,
      "level2": 8,
      "level3": 4
    },
    "tools": [
      "flows_suggest_journeys",
      "flows_generate_from_suggestions",
      "flows_generate_from_endpoints",
      "flows_generate_from_har",
      "flows_regenerate",
      "flows_import_har",
      "flows_describe_journeys",
      "flows_record_journeys",
      "flows_get_walks",
      "flows_retry_walk",
      "flows_save_walk_note",
      "flows_export_walk_image",
      "flows_list",
      "flows_get",
      "flows_get_versions",
      "flows_restore_version",
      "flows_save",
      "flows_delete",
      "flows_duplicate",
      "flows_migrate_docs",
      "flows_merge",
      "flows_set_poll_terminals",
      "flows_ask_copilot",
      "flows_apply_copilot_changes",
      "flows_get_copilot_history"
    ]
  },
  "scenario": {
    "name": "scenario",
    "tier": "pipeline",
    "subagent": "loadcraft-scenario",
    "skill": "Zamienia flowy i podział ruchu w scenariusze Gatling i kompozycję, sprawdza je (self-check, walidacja, kompilacja, dryf) i pokazuje wygenerowany kod.",
    "state_in": "ids.flow_ids[], choices.scenario.*, steps.flows.flows_built",
    "state_out": "ids.scenario_ids{}, ids.composition_id, steps.scenario.*",
    "subagent_tools": [
      "process_get_status",
      "process_wait",
      "scenario_list",
      "scenario_get",
      "scenario_save",
      "scenario_delete",
      "scenario_generate",
      "scenario_regenerate",
      "scenario_check_self",
      "scenario_check_drift",
      "scenario_export",
      "scenario_get_versions",
      "scenario_restore_version",
      "scenario_suggest_split",
      "scenario_ask_copilot",
      "scenario_get_copilot_history",
      "scenario_list_compositions",
      "scenario_get_composition",
      "scenario_save_composition",
      "scenario_check_composition",
      "scenario_compile_composition",
      "scenario_get_composition_code",
      "scenario_update_pins",
      "scenario_set_composition_type",
      "scenario_get_templates",
      "flows_list",
      "flows_get",
      "data_get_slots"
    ],
    "subagent_tools_default_mode": [
      "process_get_status",
      "process_wait",
      "scenario_list",
      "scenario_get",
      "scenario_save",
      "scenario_delete",
      "scenario_generate",
      "scenario_regenerate",
      "scenario_check_self",
      "scenario_check_drift",
      "scenario_export",
      "scenario_get_versions",
      "scenario_restore_version",
      "scenario_suggest_split",
      "scenario_ask_copilot",
      "scenario_get_copilot_history",
      "scenario_list_compositions",
      "scenario_get_composition",
      "scenario_save_composition",
      "scenario_check_composition",
      "scenario_compile_composition",
      "scenario_get_composition_code",
      "scenario_update_pins",
      "scenario_set_composition_type",
      "scenario_get_templates",
      "flows_list",
      "flows_get",
      "data_get_slots"
    ],
    "subagent_model": "tańszy",
    "counts": {
      "tools": 23,
      "operations": 35,
      "atomic": 19,
      "composite": 0,
      "process": 4,
      "level1": 14,
      "level2": 5,
      "level3": 4
    },
    "tools": [
      "scenario_list",
      "scenario_get",
      "scenario_save",
      "scenario_delete",
      "scenario_generate",
      "scenario_regenerate",
      "scenario_check_self",
      "scenario_check_drift",
      "scenario_export",
      "scenario_get_versions",
      "scenario_restore_version",
      "scenario_suggest_split",
      "scenario_ask_copilot",
      "scenario_get_copilot_history",
      "scenario_list_compositions",
      "scenario_get_composition",
      "scenario_save_composition",
      "scenario_check_composition",
      "scenario_compile_composition",
      "scenario_get_composition_code",
      "scenario_update_pins",
      "scenario_set_composition_type",
      "scenario_get_templates"
    ]
  },
  "data": {
    "name": "data",
    "tier": "pipeline",
    "subagent": "loadcraft-data",
    "skill": "Przygotowuje dane testowe: plan, zbiory danych, powiązania slotów, konta w systemie celu i werdykt, czy dane wystarczą na zadane obciążenie.",
    "state_in": "ids.scenario_ids{}, ids.composition_id, ids.env_id, choices.run.profile",
    "state_out": "ids.dataset_ids[], steps.data.*",
    "subagent_tools": [
      "process_get_status",
      "process_wait",
      "data_suggest_actions",
      "data_ask_copilot",
      "data_get_copilot_history",
      "data_get_slots",
      "data_set_bindings",
      "data_set_slot_label",
      "data_check_readiness",
      "data_list_datasets",
      "data_get_dataset",
      "data_create_dataset",
      "data_update_dataset",
      "data_regenerate_dataset",
      "data_restore_dataset",
      "data_delete",
      "data_generate_dataset",
      "data_regenerate_column",
      "data_get_generators",
      "data_check_dataset",
      "data_create_accounts",
      "scenario_get",
      "scenario_get_composition"
    ],
    "subagent_tools_default_mode": [
      "process_get_status",
      "process_wait",
      "data_suggest_actions",
      "data_ask_copilot",
      "data_get_copilot_history",
      "data_get_slots",
      "data_set_bindings",
      "data_set_slot_label",
      "data_check_readiness",
      "data_list_datasets",
      "data_get_dataset",
      "data_create_dataset",
      "data_update_dataset",
      "data_regenerate_dataset",
      "data_restore_dataset",
      "data_delete",
      "data_generate_dataset",
      "data_regenerate_column",
      "data_get_generators",
      "data_check_dataset",
      "data_create_accounts",
      "scenario_get",
      "scenario_get_composition"
    ],
    "subagent_model": "tańszy",
    "counts": {
      "tools": 19,
      "operations": 39,
      "atomic": 15,
      "composite": 1,
      "process": 3,
      "level1": 9,
      "level2": 8,
      "level3": 2
    },
    "tools": [
      "data_suggest_actions",
      "data_ask_copilot",
      "data_get_copilot_history",
      "data_get_slots",
      "data_set_bindings",
      "data_set_slot_label",
      "data_check_readiness",
      "data_list_datasets",
      "data_get_dataset",
      "data_create_dataset",
      "data_update_dataset",
      "data_regenerate_dataset",
      "data_restore_dataset",
      "data_delete",
      "data_generate_dataset",
      "data_regenerate_column",
      "data_get_generators",
      "data_check_dataset",
      "data_create_accounts"
    ]
  },
  "run": {
    "name": "run",
    "tier": "pipeline",
    "subagent": "loadcraft-run",
    "skill": "Planuje i uruchamia przebiegi obciążeniowe scenariusza lub kompozycji, prowadzi zapisane przebiegi i harmonogramy; korzysta też z narzędzi ruchu produkcyjnego (traffic).",
    "state_in": "ids.scenario_ids{}, ids.composition_id, choices.run.*, steps.scenario.composition_valid, steps.data.datasets_ready",
    "state_out": "ids.run_id, operations[], steps.run.*",
    "subagent_tools": [
      "process_get_status",
      "process_wait",
      "run_plan",
      "run_start",
      "run_start_saved",
      "run_list",
      "run_get",
      "run_delete",
      "run_get_profiles",
      "run_save_profile",
      "run_get_saved",
      "run_save",
      "run_set_schedule",
      "run_get_usage",
      "data_check_readiness",
      "traffic_list_snapshots",
      "traffic_get_snapshot",
      "traffic_import_snapshot"
    ],
    "subagent_tools_default_mode": [
      "process_get_status",
      "process_wait",
      "run_plan",
      "run_start",
      "run_start_saved",
      "run_list",
      "run_get",
      "run_delete",
      "run_get_profiles",
      "run_save_profile",
      "run_get_saved",
      "run_save",
      "run_set_schedule",
      "run_get_usage",
      "data_check_readiness",
      "traffic_list_snapshots",
      "traffic_get_snapshot",
      "traffic_import_snapshot"
    ],
    "subagent_model": "tańszy",
    "counts": {
      "tools": 12,
      "operations": 26,
      "atomic": 8,
      "composite": 2,
      "process": 2,
      "level1": 8,
      "level2": 0,
      "level3": 4
    },
    "tools": [
      "run_plan",
      "run_start",
      "run_start_saved",
      "run_list",
      "run_get",
      "run_delete",
      "run_get_profiles",
      "run_save_profile",
      "run_get_saved",
      "run_save",
      "run_set_schedule",
      "run_get_usage"
    ]
  },
  "results": {
    "name": "results",
    "tier": "pipeline",
    "subagent": "loadcraft-results",
    "skill": "Czyta wyniki przebiegu: raport, żądania, błędy, ślady i logi, porównuje przebiegi i zleca analizę AI przyczyn.",
    "state_in": "ids.run_id, choices.run.compare_to, steps.run.finished",
    "state_out": "steps.results.*",
    "subagent_tools": [
      "process_get_status",
      "process_wait",
      "results_get_report",
      "results_get_request",
      "results_get_errors",
      "results_get_traces",
      "results_get_logs",
      "results_export_report",
      "results_check_production",
      "results_compare_runs",
      "results_set_baseline",
      "results_analyze_run",
      "run_list",
      "run_get"
    ],
    "subagent_tools_default_mode": [
      "process_get_status",
      "process_wait",
      "results_get_report",
      "results_get_request",
      "results_get_errors",
      "results_get_traces",
      "results_get_logs",
      "results_export_report",
      "results_check_production",
      "results_compare_runs",
      "results_set_baseline",
      "results_analyze_run",
      "run_list",
      "run_get"
    ],
    "subagent_model": "mocniejszy",
    "counts": {
      "tools": 10,
      "operations": 19,
      "atomic": 5,
      "composite": 4,
      "process": 1,
      "level1": 9,
      "level2": 1,
      "level3": 0
    },
    "tools": [
      "results_get_report",
      "results_get_request",
      "results_get_errors",
      "results_get_traces",
      "results_get_logs",
      "results_export_report",
      "results_check_production",
      "results_compare_runs",
      "results_set_baseline",
      "results_analyze_run"
    ]
  },
  "traffic": {
    "name": "traffic",
    "tier": "extended",
    "subagent": null,
    "skill": "Migawki ruchu produkcyjnego i tokeny nadawcy; bez własnego subagenta: odczyty i import migawki dostaje subagent run, usuwanie i tokeny wywołuje rozmowa główna.",
    "state_in": "ids.project_id",
    "state_out": "choices.run.traffic_snapshot_id, steps.traffic.snapshot",
    "subagent_tools": null,
    "subagent_tools_default_mode": null,
    "subagent_model": null,
    "counts": {
      "tools": 6,
      "operations": 10,
      "atomic": 4,
      "composite": 2,
      "process": 0,
      "level1": 3,
      "level2": 1,
      "level3": 2
    },
    "tools": [
      "traffic_list_snapshots",
      "traffic_get_snapshot",
      "traffic_import_snapshot",
      "traffic_delete",
      "traffic_get_push_setup",
      "traffic_create_token"
    ]
  },
  "functional": {
    "name": "functional",
    "tier": "extended",
    "subagent": "loadcraft-functional",
    "skill": "Testy funkcjonalne: typy testów, walidatory, flowy i szablony funkcjonalne, przebiegi funkcjonalne, ich wyniki i payloady.",
    "state_in": "ids.project_id, ids.docs_id, choices.functional.*",
    "state_out": "ids.functional_run_id, steps.functional.*",
    "subagent_tools": [
      "process_get_status",
      "process_wait",
      "functional_get_catalog",
      "functional_save_catalog",
      "functional_import_catalog",
      "functional_get_test_types",
      "functional_save_test_types",
      "functional_suggest_test_types",
      "functional_generate_test_types",
      "functional_get_validators",
      "functional_save_validators",
      "functional_suggest_validators",
      "functional_get_analytics",
      "functional_get_flows",
      "functional_save_flow",
      "functional_restore_flow",
      "functional_get_templates",
      "functional_save_template",
      "functional_delete",
      "functional_start_run",
      "functional_get_runs",
      "functional_get_results",
      "functional_compare_runs",
      "functional_generate_payloads",
      "project_get_docs",
      "project_get_endpoints",
      "project_get_envs"
    ],
    "subagent_tools_default_mode": null,
    "subagent_model": "tańszy",
    "counts": {
      "tools": 22,
      "operations": 76,
      "atomic": 18,
      "composite": 0,
      "process": 4,
      "level1": 12,
      "level2": 7,
      "level3": 3
    },
    "tools": [
      "functional_get_catalog",
      "functional_save_catalog",
      "functional_import_catalog",
      "functional_get_test_types",
      "functional_save_test_types",
      "functional_suggest_test_types",
      "functional_generate_test_types",
      "functional_get_validators",
      "functional_save_validators",
      "functional_suggest_validators",
      "functional_get_analytics",
      "functional_get_flows",
      "functional_save_flow",
      "functional_restore_flow",
      "functional_get_templates",
      "functional_save_template",
      "functional_delete",
      "functional_start_run",
      "functional_get_runs",
      "functional_get_results",
      "functional_compare_runs",
      "functional_generate_payloads"
    ]
  },
  "github": {
    "name": "github",
    "tier": "extended",
    "subagent": null,
    "skill": "Wysyła wygenerowany projekt Gatling kompozycji do repozytorium GitHub; bez własnego subagenta, wywołuje rozmowa główna.",
    "state_in": "ids.project_id, ids.composition_id",
    "state_out": "steps.github.*",
    "subagent_tools": null,
    "subagent_tools_default_mode": null,
    "subagent_model": null,
    "counts": {
      "tools": 6,
      "operations": 8,
      "atomic": 6,
      "composite": 0,
      "process": 0,
      "level1": 3,
      "level2": 0,
      "level3": 3
    },
    "tools": [
      "github_get_status",
      "github_connect",
      "github_plan_push",
      "github_push",
      "github_get_changes",
      "github_disconnect"
    ]
  }
};

/** One way to undo a write: the tool, how (in words), what it undoes, and the consent level of the tool. */
export interface LogMetaUndo {
  readonly tool: ToolName;
  readonly how: string;
  readonly for: string;
  readonly level: 1 | 2 | 3;
}

/** The slice of a catalog entry the log of calls reads (module, consent level, class, templates, undo). */
export interface LogMeta {
  readonly module: ModuleName;
  readonly level: 1 | 2 | 3;
  readonly class: CatalogTool['class'];
  readonly log: { readonly args: string; readonly result: string };
  readonly undo: readonly LogMetaUndo[];
}

export const LOG_META: Readonly<Record<ToolName, LogMeta>> = {
  "process_get_status": {
    "module": "process",
    "level": 1,
    "class": "read",
    "log": {
      "args": "detail={detail} view={view}",
      "result": "step {step}; {pending} pending, {running} running, {problems} problems"
    },
    "undo": []
  },
  "process_wait": {
    "module": "process",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{handle}",
      "result": "{handle}: {status}"
    },
    "undo": []
  },
  "process_cancel": {
    "module": "process",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{handle}",
      "result": "{handle}: cancelled"
    },
    "undo": []
  },
  "process_answer": {
    "module": "process",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{id} {answer}",
      "result": "{id}: {answer}; {done} calls done, {failed} failed"
    },
    "undo": []
  },
  "process_set_choices": {
    "module": "process",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{keys}",
      "result": "{changed}"
    },
    "undo": [
      {
        "tool": "process_set_choices",
        "how": "the previous values (kept in the log entry)",
        "for": "update",
        "level": 1
      }
    ]
  },
  "process_set_decision": {
    "module": "process",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{id} {value}",
      "result": "{id}: {value}"
    },
    "undo": []
  },
  "project_list": {
    "module": "project",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{query}",
      "result": "{count} projects"
    },
    "undo": []
  },
  "project_get": {
    "module": "project",
    "level": 1,
    "class": "read",
    "log": {
      "args": "include={include}",
      "result": "{name}"
    },
    "undo": []
  },
  "project_create": {
    "module": "project",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Create project {name}",
      "result": "project {name} {created|adopted}"
    },
    "undo": [
      {
        "tool": "project_delete",
        "how": "kind=project",
        "for": "create",
        "level": 3
      }
    ]
  },
  "project_update": {
    "module": "project",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{name}",
      "result": "{changed}"
    },
    "undo": [
      {
        "tool": "project_update",
        "how": "the previous name and description",
        "for": "update",
        "level": 1
      }
    ]
  },
  "project_set_profile": {
    "module": "project",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Set {n} profile fields of the project",
      "result": "{n} fields set: {fields}"
    },
    "undo": [
      {
        "tool": "project_set_profile",
        "how": "the previous values of the fields (kept in the log entry)",
        "for": "update",
        "level": 2
      }
    ]
  },
  "project_delete": {
    "module": "project",
    "level": 3,
    "class": "destructive",
    "log": {
      "args": "Delete {kind}: {names}",
      "result": "{count} {kind} deleted"
    },
    "undo": []
  },
  "project_get_envs": {
    "module": "project",
    "level": 1,
    "class": "read+secret",
    "log": {
      "args": "{env}",
      "result": "{count} environments"
    },
    "undo": []
  },
  "project_save_env": {
    "module": "project",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Save environment {name}",
      "result": "environment {name} saved"
    },
    "undo": [
      {
        "tool": "project_save_env",
        "how": "the previous values (header values must be read again)",
        "for": "update",
        "level": 2
      },
      {
        "tool": "project_delete",
        "how": "kind=env, for a new one",
        "for": "create",
        "level": 3
      }
    ]
  },
  "project_check_env": {
    "module": "project",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Probe environment {env}",
      "result": "reachable: {ok}; {found}/{documented} endpoints exist"
    },
    "undo": []
  },
  "project_get_docs": {
    "module": "project",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{kind} {docs_id}",
      "result": "{kind} v{version}"
    },
    "undo": []
  },
  "project_get_endpoints": {
    "module": "project",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{endpoint}",
      "result": "{count} endpoints"
    },
    "undo": []
  },
  "project_import_docs": {
    "module": "project",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Import {kind} docs from {source}",
      "result": "{kind} v{version}: {endpoints} endpoints; flows on the previous version: {old_flows}"
    },
    "undo": [
      {
        "tool": "project_set_active_docs",
        "how": "the previous version",
        "for": "update",
        "level": 1
      }
    ]
  },
  "project_set_active_docs": {
    "module": "project",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{docs_id}",
      "result": "{kind} v{version} active"
    },
    "undo": [
      {
        "tool": "project_set_active_docs",
        "how": "the previous version",
        "for": "update",
        "level": 1
      }
    ]
  },
  "project_analyze_setup": {
    "module": "project",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Analyze the project setup with the LLM",
      "result": "{fields} profile fields proposed"
    },
    "undo": []
  },
  "project_apply_setup": {
    "module": "project",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Apply the project profile",
      "result": "{fields} fields applied; {validators} validators, {test_types} test types seeded"
    },
    "undo": []
  },
  "project_get_apimap": {
    "module": "project",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{areas} areas"
    },
    "undo": []
  },
  "project_set_apimap": {
    "module": "project",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{prefixes}",
      "result": "{count} area prefixes"
    },
    "undo": [
      {
        "tool": "project_set_apimap",
        "how": "the previous prefixes",
        "for": "update",
        "level": 1
      }
    ]
  },
  "project_connect_telemetry": {
    "module": "project",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Connect log server {name}",
      "result": "connected; {tools} tools"
    },
    "undo": [
      {
        "tool": "project_disconnect_telemetry",
        "how": "for a new link",
        "for": "inverse",
        "level": 3
      },
      {
        "tool": "project_connect_telemetry",
        "how": "the previous address (credentials read again)",
        "for": "update",
        "level": 2
      }
    ]
  },
  "project_disconnect_telemetry": {
    "module": "project",
    "level": 3,
    "class": "destructive",
    "log": {
      "args": "Disconnect the log server",
      "result": "disconnected"
    },
    "undo": [
      {
        "tool": "project_connect_telemetry",
        "how": "connect again (credentials needed)",
        "for": "inverse",
        "level": 2
      }
    ]
  },
  "project_list_notes": {
    "module": "project",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} notes"
    },
    "undo": []
  },
  "project_update_note": {
    "module": "project",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{id}",
      "result": "note {id} updated"
    },
    "undo": [
      {
        "tool": "project_update_note",
        "how": "the previous text and scope",
        "for": "update",
        "level": 1
      }
    ]
  },
  "project_list_team": {
    "module": "project",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} members"
    },
    "undo": []
  },
  "project_save_member": {
    "module": "project",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Give {user_id} the role {role}",
      "result": "{user_id}: {role}"
    },
    "undo": [
      {
        "tool": "project_save_member",
        "how": "the previous role",
        "for": "update",
        "level": 2
      },
      {
        "tool": "project_delete",
        "how": "kind=member, for a new one",
        "for": "create",
        "level": 3
      }
    ]
  },
  "project_get_activity": {
    "module": "project",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{events} events, {running} runs in progress"
    },
    "undo": []
  },
  "project_get_http_settings": {
    "module": "project",
    "level": 1,
    "class": "read+secret",
    "log": {
      "args": "",
      "result": "base URL {base_url}"
    },
    "undo": []
  },
  "project_set_http_settings": {
    "module": "project",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Set the HTTP settings of generated tests",
      "result": "HTTP settings saved"
    },
    "undo": [
      {
        "tool": "project_set_http_settings",
        "how": "the previous values (header values must be read again)",
        "for": "update",
        "level": 2
      }
    ]
  },
  "flows_suggest_journeys": {
    "module": "flows",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Suggest journeys from the API docs",
      "result": "{count} journeys proposed"
    },
    "undo": []
  },
  "flows_generate_from_suggestions": {
    "module": "flows",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Generate {n} flows from journeys",
      "result": "{built} flows saved, {failed} failed"
    },
    "undo": [
      {
        "tool": "flows_delete",
        "how": "the new flows",
        "for": "create",
        "level": 3
      }
    ]
  },
  "flows_generate_from_endpoints": {
    "module": "flows",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Generate a flow from {n} endpoints",
      "result": "flow {name} saved"
    },
    "undo": [
      {
        "tool": "flows_delete",
        "how": "the new flow",
        "for": "create",
        "level": 3
      }
    ]
  },
  "flows_generate_from_har": {
    "module": "flows",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Generate flows from the HAR session",
      "result": "{built} flows saved"
    },
    "undo": [
      {
        "tool": "flows_delete",
        "how": "the new flows",
        "for": "create",
        "level": 3
      }
    ]
  },
  "flows_regenerate": {
    "module": "flows",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Regenerate flow {name}",
      "result": "flow {name} v{version}"
    },
    "undo": [
      {
        "tool": "flows_restore_version",
        "how": "the previous version",
        "for": "update",
        "level": 1
      }
    ]
  },
  "flows_import_har": {
    "module": "flows",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Import HAR {file}",
      "result": "{kept} requests kept, {noise} dropped"
    },
    "undo": []
  },
  "flows_describe_journeys": {
    "module": "flows",
    "level": 3,
    "class": "costly",
    "log": {
      "args": "Open {env} in the backend browser and sign in",
      "result": "{paths} paths planned"
    },
    "undo": []
  },
  "flows_record_journeys": {
    "module": "flows",
    "level": 3,
    "class": "costly",
    "log": {
      "args": "Walk {n} paths in the backend browser",
      "result": "{built} flows saved, {failed} paths failed"
    },
    "undo": [
      {
        "tool": "flows_delete",
        "how": "the new flows; what the walk did in the target stays",
        "for": "create",
        "level": 3
      }
    ]
  },
  "flows_get_walks": {
    "module": "flows",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{walk_id}",
      "result": "{count} walks"
    },
    "undo": []
  },
  "flows_retry_walk": {
    "module": "flows",
    "level": 3,
    "class": "costly",
    "log": {
      "args": "Retry path {path_index} of the walk",
      "result": "path {path_index}: {status}"
    },
    "undo": [
      {
        "tool": "flows_delete",
        "how": "the new flow; what the walk did in the target stays",
        "for": "create",
        "level": 3
      }
    ]
  },
  "flows_save_walk_note": {
    "module": "flows",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{walk_id} step {step}",
      "result": "note at step {step}"
    },
    "undo": [
      {
        "tool": "flows_save_walk_note",
        "how": "the previous text",
        "for": "update",
        "level": 1
      },
      {
        "tool": "flows_delete",
        "how": "kind=walk_note, for a new one",
        "for": "create",
        "level": 3
      }
    ]
  },
  "flows_export_walk_image": {
    "module": "flows",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{walk_id} {path_index}",
      "result": "{path}"
    },
    "undo": []
  },
  "flows_list": {
    "module": "flows",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} flows"
    },
    "undo": []
  },
  "flows_get": {
    "module": "flows",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{flow_id}",
      "result": "{name} v{version}: {steps} steps; needs input: {needs_input} ({definite} definite)"
    },
    "undo": []
  },
  "flows_get_versions": {
    "module": "flows",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{flow_id}",
      "result": "{count} versions"
    },
    "undo": []
  },
  "flows_restore_version": {
    "module": "flows",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{flow_id} v{version}",
      "result": "{name}: v{version} restored as v{new}; warnings: {warnings}"
    },
    "undo": [
      {
        "tool": "flows_restore_version",
        "how": "the version that was current",
        "for": "update",
        "level": 1
      }
    ]
  },
  "flows_save": {
    "module": "flows",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{flow_id}",
      "result": "{name} v{version} saved"
    },
    "undo": [
      {
        "tool": "flows_restore_version",
        "how": "the previous version",
        "for": "update",
        "level": 1
      },
      {
        "tool": "flows_save",
        "how": "the previous values",
        "for": "update",
        "level": 1
      },
      {
        "tool": "flows_delete",
        "how": "the new flow",
        "for": "create",
        "level": 3
      }
    ]
  },
  "flows_delete": {
    "module": "flows",
    "level": 3,
    "class": "destructive",
    "log": {
      "args": "Delete {kind}: {names}",
      "result": "{count} {kind} deleted"
    },
    "undo": []
  },
  "flows_duplicate": {
    "module": "flows",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{flow_ids}",
      "result": "{count} copies"
    },
    "undo": [
      {
        "tool": "flows_delete",
        "how": "the copies",
        "for": "create",
        "level": 3
      }
    ]
  },
  "flows_migrate_docs": {
    "module": "flows",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Migrate {n} flows to the current docs version",
      "result": "{count} flows migrated: {matched} matched, {changed} changed, {unmatched} unmatched"
    },
    "undo": [
      {
        "tool": "flows_restore_version",
        "how": "the previous version of each flow",
        "for": "update",
        "level": 1
      }
    ]
  },
  "flows_merge": {
    "module": "flows",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{flow_ids}",
      "result": "{name} created from {count} flows"
    },
    "undo": [
      {
        "tool": "flows_delete",
        "how": "the merged flow",
        "for": "create",
        "level": 3
      }
    ]
  },
  "flows_set_poll_terminals": {
    "module": "flows",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{flow_id}",
      "result": "{field} answered as v{version}; {open} open"
    },
    "undo": [
      {
        "tool": "flows_restore_version",
        "how": "the previous version",
        "for": "update",
        "level": 1
      }
    ]
  },
  "flows_ask_copilot": {
    "module": "flows",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Ask the flow copilot about {name}",
      "result": "{changes} changes proposed"
    },
    "undo": []
  },
  "flows_apply_copilot_changes": {
    "module": "flows",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{flow_id}",
      "result": "{applied}/{requested} changes applied as v{version}"
    },
    "undo": [
      {
        "tool": "flows_restore_version",
        "how": "the previous version",
        "for": "update",
        "level": 1
      }
    ]
  },
  "flows_get_copilot_history": {
    "module": "flows",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{flow_id}",
      "result": "{turns} turns"
    },
    "undo": []
  },
  "scenario_list": {
    "module": "scenario",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} scenarios"
    },
    "undo": []
  },
  "scenario_get": {
    "module": "scenario",
    "level": 1,
    "class": "read+secret",
    "log": {
      "args": "{scenario_id}",
      "result": "{name} v{version}; self-check {self_check}"
    },
    "undo": []
  },
  "scenario_save": {
    "module": "scenario",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{scenario_id}",
      "result": "{name} saved"
    },
    "undo": [
      {
        "tool": "scenario_save",
        "how": "the previous values",
        "for": "update",
        "level": 1
      },
      {
        "tool": "scenario_delete",
        "how": "the new scenario",
        "for": "create",
        "level": 3
      }
    ]
  },
  "scenario_delete": {
    "module": "scenario",
    "level": 3,
    "class": "destructive",
    "log": {
      "args": "Delete {kind}: {names}",
      "result": "{count} {kind} deleted"
    },
    "undo": []
  },
  "scenario_generate": {
    "module": "scenario",
    "level": 3,
    "class": "costly",
    "log": {
      "args": "Generate {n} scenarios and self-check them on the default environment ({env})",
      "result": "{built} scenarios, composition {name}; self-check {passed}/{n}"
    },
    "undo": [
      {
        "tool": "scenario_delete",
        "how": "the new scenarios and composition",
        "for": "create",
        "level": 3
      }
    ]
  },
  "scenario_regenerate": {
    "module": "scenario",
    "level": 3,
    "class": "costly",
    "log": {
      "args": "Regenerate scenario {name} and self-check it",
      "result": "{name} v{version}; self-check {self_check}"
    },
    "undo": [
      {
        "tool": "scenario_restore_version",
        "how": "the previous version",
        "for": "update",
        "level": 1
      }
    ]
  },
  "scenario_check_self": {
    "module": "scenario",
    "level": 3,
    "class": "costly",
    "log": {
      "args": "Self-check {n} scenarios on the default environment ({env})",
      "result": "{passed}/{n} passed"
    },
    "undo": []
  },
  "scenario_check_drift": {
    "module": "scenario",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Check drift of scenario {name}",
      "result": "staleness {score}"
    },
    "undo": []
  },
  "scenario_export": {
    "module": "scenario",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{scenario_id}",
      "result": "{path}"
    },
    "undo": []
  },
  "scenario_get_versions": {
    "module": "scenario",
    "level": 1,
    "class": "read+secret",
    "log": {
      "args": "{scenario_id}",
      "result": "{count} versions"
    },
    "undo": []
  },
  "scenario_restore_version": {
    "module": "scenario",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{scenario_id} v{version}",
      "result": "{name}: v{version} restored; self-check cleared"
    },
    "undo": [
      {
        "tool": "scenario_restore_version",
        "how": "the version that was current",
        "for": "update",
        "level": 1
      }
    ]
  },
  "scenario_suggest_split": {
    "module": "scenario",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Suggest the traffic split for {n} flows",
      "result": "split proposed: {split}"
    },
    "undo": []
  },
  "scenario_ask_copilot": {
    "module": "scenario",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Ask the scenario copilot about {name}",
      "result": "{actions} actions proposed"
    },
    "undo": []
  },
  "scenario_get_copilot_history": {
    "module": "scenario",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{scenario_id}",
      "result": "{turns} turns"
    },
    "undo": []
  },
  "scenario_list_compositions": {
    "module": "scenario",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} compositions"
    },
    "undo": []
  },
  "scenario_get_composition": {
    "module": "scenario",
    "level": 1,
    "class": "read+secret",
    "log": {
      "args": "{composition_id}",
      "result": "{name}: {members} members, {status}"
    },
    "undo": []
  },
  "scenario_save_composition": {
    "module": "scenario",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Save composition {name}",
      "result": "composition {name} saved; valid: {valid}"
    },
    "undo": [
      {
        "tool": "scenario_save_composition",
        "how": "the previous members, weights and profile",
        "for": "update",
        "level": 2
      },
      {
        "tool": "scenario_delete",
        "how": "kind=composition, for a new one",
        "for": "create",
        "level": 3
      }
    ]
  },
  "scenario_check_composition": {
    "module": "scenario",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{composition_id}",
      "result": "valid: {valid}; {issues} issues"
    },
    "undo": []
  },
  "scenario_compile_composition": {
    "module": "scenario",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Compile composition {name}",
      "result": "compiled: {ok}"
    },
    "undo": []
  },
  "scenario_get_composition_code": {
    "module": "scenario",
    "level": 1,
    "class": "read+secret",
    "log": {
      "args": "{composition_id} {path}",
      "result": "{files} files"
    },
    "undo": []
  },
  "scenario_update_pins": {
    "module": "scenario",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{composition_id}",
      "result": "{count} members moved to current versions"
    },
    "undo": [
      {
        "tool": "scenario_save_composition",
        "how": "the previous pinned versions",
        "for": "update",
        "level": 2
      }
    ]
  },
  "scenario_set_composition_type": {
    "module": "scenario",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{composition_id} {type}",
      "result": "type {type}; data re-sized"
    },
    "undo": [
      {
        "tool": "scenario_set_composition_type",
        "how": "the previous type",
        "for": "update",
        "level": 1
      }
    ]
  },
  "scenario_get_templates": {
    "module": "scenario",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{template}",
      "result": "{count} templates"
    },
    "undo": []
  },
  "data_suggest_actions": {
    "module": "data",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Suggest the test data for {target}",
      "result": "{actions} actions proposed"
    },
    "undo": []
  },
  "data_ask_copilot": {
    "module": "data",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Ask the data hub copilot",
      "result": "{actions} actions proposed"
    },
    "undo": []
  },
  "data_get_copilot_history": {
    "module": "data",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{turns} turns"
    },
    "undo": []
  },
  "data_get_slots": {
    "module": "data",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{target}",
      "result": "{slots} slots, {bound} bound"
    },
    "undo": []
  },
  "data_set_bindings": {
    "module": "data",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{target}",
      "result": "{count} slots bound"
    },
    "undo": [
      {
        "tool": "data_set_bindings",
        "how": "the previous bindings",
        "for": "update",
        "level": 1
      }
    ]
  },
  "data_set_slot_label": {
    "module": "data",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{slot}",
      "result": "slot {slot}: {label}"
    },
    "undo": [
      {
        "tool": "data_set_slot_label",
        "how": "the previous label",
        "for": "update",
        "level": 1
      }
    ]
  },
  "data_check_readiness": {
    "module": "data",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{target}",
      "result": "ready: {ok}; {short} slots short"
    },
    "undo": []
  },
  "data_list_datasets": {
    "module": "data",
    "level": 1,
    "class": "read+secret",
    "log": {
      "args": "",
      "result": "{count} datasets"
    },
    "undo": []
  },
  "data_get_dataset": {
    "module": "data",
    "level": 1,
    "class": "read+secret",
    "log": {
      "args": "{dataset_id} include={include}",
      "result": "{name}: {rows} rows"
    },
    "undo": []
  },
  "data_create_dataset": {
    "module": "data",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Create dataset {name}",
      "result": "dataset {name}: {rows} rows"
    },
    "undo": [
      {
        "tool": "data_delete",
        "how": "the new dataset",
        "for": "create",
        "level": 3
      }
    ]
  },
  "data_update_dataset": {
    "module": "data",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Update dataset {name}",
      "result": "dataset {name} updated"
    },
    "undo": [
      {
        "tool": "data_restore_dataset",
        "how": "the previous content",
        "for": "update",
        "level": 1
      },
      {
        "tool": "data_update_dataset",
        "how": "the previous definition",
        "for": "update",
        "level": 2
      }
    ]
  },
  "data_regenerate_dataset": {
    "module": "data",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Regenerate rows of dataset {name}",
      "result": "dataset {name}: {rows} rows"
    },
    "undo": [
      {
        "tool": "data_restore_dataset",
        "how": "the previous content",
        "for": "update",
        "level": 1
      }
    ]
  },
  "data_restore_dataset": {
    "module": "data",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{dataset_id}",
      "result": "{name}: previous content restored"
    },
    "undo": [
      {
        "tool": "data_restore_dataset",
        "how": "call it again",
        "for": "update",
        "level": 1
      }
    ]
  },
  "data_delete": {
    "module": "data",
    "level": 3,
    "class": "destructive",
    "log": {
      "args": "Delete dataset: {names}",
      "result": "{count} datasets deleted"
    },
    "undo": []
  },
  "data_generate_dataset": {
    "module": "data",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Generate a dataset with AI for {target}",
      "result": "dataset {name}: {rows} rows"
    },
    "undo": [
      {
        "tool": "data_delete",
        "how": "the new dataset",
        "for": "create",
        "level": 3
      }
    ]
  },
  "data_regenerate_column": {
    "module": "data",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Regenerate column {column} of {name}",
      "result": "column {column}: {rows} rows"
    },
    "undo": [
      {
        "tool": "data_restore_dataset",
        "how": "the previous content",
        "for": "update",
        "level": 1
      }
    ]
  },
  "data_get_generators": {
    "module": "data",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} generators"
    },
    "undo": []
  },
  "data_check_dataset": {
    "module": "data",
    "level": 2,
    "class": "write+secret",
    "log": {
      "args": "Check dataset {name} against {env}",
      "result": "sign-in: {ok}; {found}/{checked} entities found"
    },
    "undo": []
  },
  "data_create_accounts": {
    "module": "data",
    "level": 3,
    "class": "costly+secret",
    "log": {
      "args": "Create {count} test accounts in {env}",
      "result": "{created} accounts created, {failed} failed"
    },
    "undo": []
  },
  "run_plan": {
    "module": "run",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{target} {vusers} users",
      "result": "{profiles} profiles; peak {sessions} sessions; data ready: {ok}"
    },
    "undo": []
  },
  "run_start": {
    "module": "run",
    "level": 3,
    "class": "costly",
    "log": {
      "args": "Start a load run of {target} on {env}",
      "result": "run {run_id}: {status}"
    },
    "undo": [
      {
        "tool": "process_cancel",
        "how": "stops it; sent traffic stays",
        "for": "inverse",
        "level": 1
      }
    ]
  },
  "run_start_saved": {
    "module": "run",
    "level": 3,
    "class": "costly",
    "log": {
      "args": "Start saved run {name}",
      "result": "run {run_id}: {status}"
    },
    "undo": [
      {
        "tool": "process_cancel",
        "how": "stops it; sent traffic stays",
        "for": "inverse",
        "level": 1
      }
    ]
  },
  "run_list": {
    "module": "run",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} runs"
    },
    "undo": []
  },
  "run_get": {
    "module": "run",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{run_id}",
      "result": "run {run_id}: {status}"
    },
    "undo": []
  },
  "run_delete": {
    "module": "run",
    "level": 3,
    "class": "destructive",
    "log": {
      "args": "Delete {kind}: {names}",
      "result": "{count} {kind} deleted"
    },
    "undo": []
  },
  "run_get_profiles": {
    "module": "run",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} profiles"
    },
    "undo": []
  },
  "run_save_profile": {
    "module": "run",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{name}",
      "result": "profile {name} saved"
    },
    "undo": [
      {
        "tool": "run_save_profile",
        "how": "the previous values",
        "for": "update",
        "level": 1
      },
      {
        "tool": "run_delete",
        "how": "kind=profile, for a new one",
        "for": "create",
        "level": 3
      }
    ]
  },
  "run_get_saved": {
    "module": "run",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} saved runs"
    },
    "undo": []
  },
  "run_save": {
    "module": "run",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{name}",
      "result": "saved run {name}"
    },
    "undo": [
      {
        "tool": "run_save",
        "how": "the previous values",
        "for": "update",
        "level": 1
      },
      {
        "tool": "run_delete",
        "how": "kind=saved, for a new one",
        "for": "create",
        "level": 3
      }
    ]
  },
  "run_set_schedule": {
    "module": "run",
    "level": 3,
    "class": "costly",
    "log": {
      "args": "Schedule saved run {name}: {cron}",
      "result": "schedule: {state}"
    },
    "undo": [
      {
        "tool": "run_set_schedule",
        "how": "cron=null, or the previous cron",
        "for": "update",
        "level": 3
      }
    ]
  },
  "run_get_usage": {
    "module": "run",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{period}",
      "result": "{runs} runs, {minutes} compute minutes"
    },
    "undo": []
  },
  "results_get_report": {
    "module": "results",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{run_id}",
      "result": "{verdict}: {requests} requests, {errors} errors, p95 {p95} ms"
    },
    "undo": []
  },
  "results_get_request": {
    "module": "results",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{run_id} {request}",
      "result": "{request}: p95 {p95} ms"
    },
    "undo": []
  },
  "results_get_errors": {
    "module": "results",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{run_id}",
      "result": "{groups} error groups"
    },
    "undo": []
  },
  "results_get_traces": {
    "module": "results",
    "level": 1,
    "class": "read+secret",
    "log": {
      "args": "{run_id}",
      "result": "{count} traces"
    },
    "undo": []
  },
  "results_get_logs": {
    "module": "results",
    "level": 1,
    "class": "read+secret",
    "log": {
      "args": "{run_id}",
      "result": "{lines} lines"
    },
    "undo": []
  },
  "results_export_report": {
    "module": "results",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{run_id}",
      "result": "{path}"
    },
    "undo": []
  },
  "results_check_production": {
    "module": "results",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{run_id}",
      "result": "load achieved: {achieved}%; think time: {verdict}"
    },
    "undo": []
  },
  "results_compare_runs": {
    "module": "results",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{run_id} vs {compare_to}",
      "result": "{better} better, {worse} worse"
    },
    "undo": []
  },
  "results_set_baseline": {
    "module": "results",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{run_id}",
      "result": "run {run_id} is the baseline"
    },
    "undo": [
      {
        "tool": "results_set_baseline",
        "how": "the previous baseline run",
        "for": "update",
        "level": 1
      }
    ]
  },
  "results_analyze_run": {
    "module": "results",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Analyze run {run_id} with AI",
      "result": "{findings} findings"
    },
    "undo": []
  },
  "traffic_list_snapshots": {
    "module": "traffic",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} snapshots"
    },
    "undo": []
  },
  "traffic_get_snapshot": {
    "module": "traffic",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{snapshot_id}",
      "result": "{name}: quality {quality}"
    },
    "undo": []
  },
  "traffic_import_snapshot": {
    "module": "traffic",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Import traffic snapshot from {file}",
      "result": "snapshot {name}: quality {quality}"
    },
    "undo": [
      {
        "tool": "traffic_delete",
        "how": "kind=snapshot",
        "for": "create",
        "level": 3
      }
    ]
  },
  "traffic_delete": {
    "module": "traffic",
    "level": 3,
    "class": "destructive",
    "log": {
      "args": "Delete {kind}: {names}",
      "result": "{count} {kind} deleted"
    },
    "undo": []
  },
  "traffic_get_push_setup": {
    "module": "traffic",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{tokens} push tokens"
    },
    "undo": []
  },
  "traffic_create_token": {
    "module": "traffic",
    "level": 3,
    "class": "write+secret",
    "log": {
      "args": "Create a traffic push token",
      "result": "token {name} created; secret in {path}"
    },
    "undo": [
      {
        "tool": "traffic_delete",
        "how": "kind=token revokes it",
        "for": "create",
        "level": 3
      }
    ]
  },
  "functional_get_catalog": {
    "module": "functional",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{kind} {view}",
      "result": "{count} entries"
    },
    "undo": []
  },
  "functional_save_catalog": {
    "module": "functional",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Save catalog entry {name} (shared by all projects)",
      "result": "{kind} {name} saved"
    },
    "undo": [
      {
        "tool": "functional_save_catalog",
        "how": "the previous values",
        "for": "update",
        "level": 2
      },
      {
        "tool": "functional_delete",
        "how": "kind=catalog_*, for a new one",
        "for": "create",
        "level": 3
      }
    ]
  },
  "functional_import_catalog": {
    "module": "functional",
    "level": 3,
    "class": "destructive",
    "log": {
      "args": "Import the built-in catalog",
      "result": "{added} added, {updated} updated, {deleted} deleted"
    },
    "undo": []
  },
  "functional_get_test_types": {
    "module": "functional",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} test types"
    },
    "undo": []
  },
  "functional_save_test_types": {
    "module": "functional",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Save {n} test types in the project",
      "result": "{count} test types saved"
    },
    "undo": [
      {
        "tool": "functional_delete",
        "how": "kind=test_type, for new ones",
        "for": "create",
        "level": 3
      },
      {
        "tool": "functional_save_test_types",
        "how": "the previous values of updated ones",
        "for": "update",
        "level": 2
      }
    ]
  },
  "functional_suggest_test_types": {
    "module": "functional",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Suggest test types from the API docs",
      "result": "{count} test types proposed"
    },
    "undo": []
  },
  "functional_generate_test_types": {
    "module": "functional",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Generate the missing base test types",
      "result": "{count} test types added"
    },
    "undo": [
      {
        "tool": "functional_delete",
        "how": "kind=test_type",
        "for": "create",
        "level": 3
      }
    ]
  },
  "functional_get_validators": {
    "module": "functional",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} validators"
    },
    "undo": []
  },
  "functional_save_validators": {
    "module": "functional",
    "level": 2,
    "class": "write",
    "log": {
      "args": "Save {n} validators in the project",
      "result": "{count} validators saved"
    },
    "undo": [
      {
        "tool": "functional_delete",
        "how": "kind=validator, for new ones",
        "for": "create",
        "level": 3
      },
      {
        "tool": "functional_save_validators",
        "how": "the previous values of updated ones",
        "for": "update",
        "level": 2
      }
    ]
  },
  "functional_suggest_validators": {
    "module": "functional",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Suggest validators from the API docs and recorded runs",
      "result": "{count} validators proposed"
    },
    "undo": []
  },
  "functional_get_analytics": {
    "module": "functional",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{view} {days} days",
      "result": "{view}"
    },
    "undo": []
  },
  "functional_get_flows": {
    "module": "functional",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} functional flows"
    },
    "undo": []
  },
  "functional_save_flow": {
    "module": "functional",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{flow_id}",
      "result": "functional flow {name} saved"
    },
    "undo": [
      {
        "tool": "functional_restore_flow",
        "how": "the previous version",
        "for": "update",
        "level": 1
      },
      {
        "tool": "functional_save_flow",
        "how": "the previous values",
        "for": "update",
        "level": 1
      },
      {
        "tool": "functional_delete",
        "how": "kind=flow, for a new one",
        "for": "create",
        "level": 3
      }
    ]
  },
  "functional_restore_flow": {
    "module": "functional",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{flow_id} {version}",
      "result": "{name}: version {version} restored"
    },
    "undo": [
      {
        "tool": "functional_restore_flow",
        "how": "the snapshot taken before the restore",
        "for": "update",
        "level": 1
      }
    ]
  },
  "functional_get_templates": {
    "module": "functional",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} templates"
    },
    "undo": []
  },
  "functional_save_template": {
    "module": "functional",
    "level": 1,
    "class": "write",
    "log": {
      "args": "{name}",
      "result": "template {name} saved"
    },
    "undo": [
      {
        "tool": "functional_save_template",
        "how": "the previous values",
        "for": "update",
        "level": 1
      },
      {
        "tool": "functional_delete",
        "how": "kind=template, for a new one",
        "for": "create",
        "level": 3
      }
    ]
  },
  "functional_delete": {
    "module": "functional",
    "level": 3,
    "class": "destructive",
    "log": {
      "args": "Delete {kind}: {names}",
      "result": "{count} {kind} deleted"
    },
    "undo": []
  },
  "functional_start_run": {
    "module": "functional",
    "level": 3,
    "class": "costly",
    "log": {
      "args": "Start a functional run of {n} flows on {env}",
      "result": "functional run {run_id}: {status}"
    },
    "undo": [
      {
        "tool": "process_cancel",
        "how": "stops it; sent requests stay",
        "for": "inverse",
        "level": 1
      }
    ]
  },
  "functional_get_runs": {
    "module": "functional",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{count} functional runs"
    },
    "undo": []
  },
  "functional_get_results": {
    "module": "functional",
    "level": 1,
    "class": "read+secret",
    "log": {
      "args": "{run_id}",
      "result": "{passed} passed, {failed} failed"
    },
    "undo": []
  },
  "functional_compare_runs": {
    "module": "functional",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{run_id} vs {other}",
      "result": "{changed} blocks differ"
    },
    "undo": []
  },
  "functional_generate_payloads": {
    "module": "functional",
    "level": 2,
    "class": "costly",
    "log": {
      "args": "Generate payloads for {n} flows",
      "result": "ZIP saved to {path}"
    },
    "undo": []
  },
  "github_get_status": {
    "module": "github",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "linked: {linked}"
    },
    "undo": []
  },
  "github_connect": {
    "module": "github",
    "level": 3,
    "class": "write",
    "log": {
      "args": "Connect the project to {repo}",
      "result": "linked to {repo}"
    },
    "undo": [
      {
        "tool": "github_disconnect",
        "how": "",
        "for": "inverse",
        "level": 3
      }
    ]
  },
  "github_plan_push": {
    "module": "github",
    "level": 1,
    "class": "read",
    "log": {
      "args": "{composition_id}",
      "result": "{files} files would change"
    },
    "undo": []
  },
  "github_push": {
    "module": "github",
    "level": 3,
    "class": "write",
    "log": {
      "args": "Push composition {name} to {repo}",
      "result": "pushed: {commit}"
    },
    "undo": []
  },
  "github_get_changes": {
    "module": "github",
    "level": 1,
    "class": "read",
    "log": {
      "args": "",
      "result": "{files} files changed since the last sync"
    },
    "undo": []
  },
  "github_disconnect": {
    "module": "github",
    "level": 3,
    "class": "destructive",
    "log": {
      "args": "Disconnect the project from {repo}",
      "result": "disconnected"
    },
    "undo": [
      {
        "tool": "github_connect",
        "how": "connect again (token needed)",
        "for": "inverse",
        "level": 3
      }
    ]
  }
};

export const STATE_INVALIDATIONS: readonly StateInvalidation[] = [
  {
    "event": "zmiana dokumentacji API",
    "triggers": [
      "project_import_docs",
      "project_set_active_docs"
    ],
    "invalidates": [
      "project.env_checked",
      "project.setup_analyzed",
      "flows.journeys_suggested",
      "scenario.drift"
    ]
  },
  {
    "event": "import dokumentacji przez analizę ustawień (adres środowiska się nie zmienia)",
    "triggers": [
      "project_analyze_setup"
    ],
    "invalidates": [
      "flows.journeys_suggested",
      "scenario.drift"
    ]
  },
  {
    "event": "zmiana środowiska (adres, limity, ochrona, domyślne)",
    "triggers": [
      "project_save_env",
      "project_delete"
    ],
    "invalidates": [
      "project.env_checked",
      "scenario.self_check",
      "data.accounts",
      "data.datasets_ready",
      "run.planned"
    ]
  },
  {
    "event": "wybór środowiska dla przebiegu (nie zmienia domyślnego środowiska projektu, więc self-check zostaje)",
    "triggers": [
      "choices.run.env_id"
    ],
    "invalidates": [
      "project.env_checked",
      "data.accounts",
      "data.datasets_ready",
      "run.planned"
    ]
  },
  {
    "event": "zmiana ustawień HTTP projektu albo mapy API (adres bazowy i prefiksy generowanych testów)",
    "triggers": [
      "project_set_http_settings",
      "project_set_apimap"
    ],
    "invalidates": [
      "scenario.self_check",
      "scenario.compiled",
      "run.planned"
    ]
  },
  {
    "event": "zastosowanie albo poprawa profilu projektu (walidatory, typy testów, ustawienia; profil steruje analizą HAR i self-checkiem)",
    "triggers": [
      "project_apply_setup",
      "project_set_profile"
    ],
    "invalidates": [
      "scenario.self_check",
      "scenario.compiled",
      "run.planned",
      "flows.har_analyzed"
    ]
  },
  {
    "event": "zmiana flowu",
    "triggers": [
      "flows_save",
      "flows_apply_copilot_changes",
      "flows_regenerate",
      "flows_migrate_docs",
      "flows_restore_version",
      "flows_set_poll_terminals",
      "flows_merge",
      "flows_delete"
    ],
    "invalidates": [
      "scenario.generated",
      "scenario.self_check",
      "scenario.composition_valid",
      "scenario.compiled",
      "scenario.drift",
      "data.bindings_set",
      "data.datasets_ready",
      "run.planned"
    ]
  },
  {
    "event": "zmiana scenariusza (nowa wersja, zmienione sloty, nowe scenariusze)",
    "triggers": [
      "scenario_generate",
      "scenario_regenerate",
      "scenario_restore_version",
      "scenario_delete"
    ],
    "invalidates": [
      "scenario.self_check",
      "scenario.composition_valid",
      "scenario.compiled",
      "scenario.drift",
      "data.bindings_set",
      "data.datasets_ready",
      "run.planned"
    ]
  },
  {
    "event": "zmiana kompozycji albo podziału ruchu",
    "triggers": [
      "scenario_save_composition",
      "scenario_set_composition_type",
      "scenario_update_pins",
      "choices.scenario.split",
      "choices.scenario.data_mix"
    ],
    "invalidates": [
      "scenario.compiled",
      "data.datasets_ready",
      "run.planned"
    ]
  },
  {
    "event": "zmiana zbioru danych albo powiązań",
    "triggers": [
      "data_set_bindings",
      "data_update_dataset",
      "data_regenerate_dataset",
      "data_restore_dataset",
      "data_regenerate_column",
      "data_delete",
      "data_create_accounts"
    ],
    "invalidates": [
      "data.datasets_ready",
      "run.planned"
    ]
  },
  {
    "event": "zmiana profilu, celu albo migawki przebiegu",
    "triggers": [
      "choices.run.profile",
      "choices.run.target",
      "choices.run.traffic_snapshot_id",
      "traffic_delete"
    ],
    "invalidates": [
      "data.datasets_ready",
      "run.planned"
    ]
  },
  {
    "event": "start nowego przebiegu",
    "triggers": [
      "run_start",
      "run_start_saved"
    ],
    "invalidates": [
      "run.finished",
      "results.report",
      "results.analysis",
      "results.production_verdict"
    ]
  },
  {
    "event": "start nowego przebiegu funkcjonalnego",
    "triggers": [
      "functional_start_run"
    ],
    "invalidates": [
      "functional.run_finished"
    ]
  },
  {
    "event": "rozłączenie repozytorium",
    "triggers": [
      "github_disconnect"
    ],
    "invalidates": [
      "github.pushed"
    ]
  }
];

export const CHECKS: readonly StateCheck[] = [
  {
    "path": "steps.project.created",
    "module": "project",
    "check": "created",
    "type": "Check",
    "description": "projekt istnieje i jest związany z katalogiem",
    "writers": [
      "process_cancel",
      "process_wait",
      "project_create"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": true
  },
  {
    "path": "steps.project.env_saved",
    "module": "project",
    "check": "env_saved",
    "type": "Check",
    "description": "jest co najmniej jedno środowisko",
    "writers": [
      "process_cancel",
      "process_wait",
      "project_save_env"
    ],
    "readers": [
      "process_get_status",
      "project_check_env"
    ],
    "required": true
  },
  {
    "path": "steps.project.env_checked",
    "module": "project",
    "check": "env_checked",
    "type": "Check",
    "description": "adres środowiska odpowiada; zgodność z dokumentacją",
    "writers": [
      "process_cancel",
      "process_wait",
      "project_apply_setup",
      "project_check_env"
    ],
    "readers": [
      "process_get_status",
      "run_start",
      "scenario_generate"
    ],
    "required": true
  },
  {
    "path": "steps.project.docs_imported",
    "module": "project",
    "check": "docs_imported",
    "type": "Check",
    "description": "aktywna dokumentacja API",
    "writers": [
      "process_cancel",
      "process_wait",
      "project_analyze_setup",
      "project_import_docs"
    ],
    "readers": [
      "flows_suggest_journeys",
      "process_get_status"
    ],
    "required": {
      "when": "choices.flows.method",
      "in": [
        "suggestions",
        "endpoints"
      ]
    }
  },
  {
    "path": "steps.project.setup_analyzed",
    "module": "project",
    "check": "setup_analyzed",
    "type": "Check",
    "description": "analiza profilu zakończona, propozycje czekają",
    "writers": [
      "process_cancel",
      "process_wait",
      "project_analyze_setup"
    ],
    "readers": [
      "process_get_status",
      "project_apply_setup"
    ],
    "required": false
  },
  {
    "path": "steps.project.setup_applied",
    "module": "project",
    "check": "setup_applied",
    "type": "Check",
    "description": "profil zastosowany, walidatory i typy testów zasiane",
    "writers": [
      "process_cancel",
      "process_wait",
      "project_apply_setup"
    ],
    "readers": [
      "flows_suggest_journeys",
      "process_get_status"
    ],
    "required": true
  },
  {
    "path": "steps.project.telemetry",
    "module": "project",
    "check": "telemetry",
    "type": "Check",
    "description": "serwer logów podłączony",
    "writers": [
      "process_cancel",
      "process_wait",
      "project_connect_telemetry",
      "project_disconnect_telemetry"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": false
  },
  {
    "path": "steps.flows.journeys_suggested",
    "module": "flows",
    "check": "journeys_suggested",
    "type": "Check",
    "description": "są propozycje ścieżek z dokumentacji",
    "writers": [
      "flows_suggest_journeys",
      "process_cancel",
      "process_wait"
    ],
    "readers": [
      "flows_generate_from_suggestions",
      "process_get_status"
    ],
    "required": {
      "when": "choices.flows.method",
      "in": [
        "suggestions"
      ]
    }
  },
  {
    "path": "steps.flows.har_analyzed",
    "module": "flows",
    "check": "har_analyzed",
    "type": "Check",
    "description": "nagranie HAR przeanalizowane",
    "writers": [
      "flows_import_har",
      "process_cancel",
      "process_wait"
    ],
    "readers": [
      "flows_generate_from_har",
      "process_get_status"
    ],
    "required": {
      "when": "choices.flows.method",
      "in": [
        "har"
      ]
    }
  },
  {
    "path": "steps.flows.plan_described",
    "module": "flows",
    "check": "plan_described",
    "type": "Check",
    "description": "plan ścieżek z opisu gotowy do zatwierdzenia",
    "writers": [
      "flows_describe_journeys",
      "process_cancel",
      "process_wait"
    ],
    "readers": [
      "flows_record_journeys",
      "process_get_status"
    ],
    "required": {
      "when": "choices.flows.method",
      "in": [
        "description"
      ]
    }
  },
  {
    "path": "steps.flows.flows_built",
    "module": "flows",
    "check": "flows_built",
    "type": "Check",
    "description": "flowy zapisane",
    "writers": [
      "flows_apply_copilot_changes",
      "flows_generate_from_endpoints",
      "flows_generate_from_har",
      "flows_generate_from_suggestions",
      "flows_record_journeys",
      "flows_regenerate",
      "flows_restore_version",
      "flows_retry_walk",
      "flows_save",
      "process_cancel",
      "process_wait"
    ],
    "readers": [
      "process_get_status",
      "scenario_generate"
    ],
    "required": true
  },
  {
    "path": "steps.flows.questions_answered",
    "module": "flows",
    "check": "questions_answered",
    "type": "Check",
    "description": "flowy nie mają otwartych pytań generatora (np. stany końcowe pętli)",
    "writers": [
      "flows_get",
      "flows_set_poll_terminals",
      "process_cancel",
      "process_wait"
    ],
    "readers": [
      "flows_set_poll_terminals",
      "process_get_status",
      "scenario_generate"
    ],
    "required": true
  },
  {
    "path": "steps.scenario.generated",
    "module": "scenario",
    "check": "generated",
    "type": "Check",
    "description": "scenariusz dla każdego flowu",
    "writers": [
      "process_cancel",
      "process_wait",
      "scenario_generate",
      "scenario_regenerate"
    ],
    "readers": [
      "data_suggest_actions",
      "process_get_status"
    ],
    "required": true
  },
  {
    "path": "steps.scenario.self_check",
    "module": "scenario",
    "check": "self_check",
    "type": "Check",
    "description": "wynik self-checku scenariuszy",
    "writers": [
      "process_cancel",
      "process_wait",
      "scenario_check_self",
      "scenario_generate",
      "scenario_get",
      "scenario_regenerate",
      "scenario_restore_version"
    ],
    "readers": [
      "process_get_status",
      "run_start"
    ],
    "required": true
  },
  {
    "path": "steps.scenario.composition_valid",
    "module": "scenario",
    "check": "composition_valid",
    "type": "Check",
    "description": "kompozycja przechodzi walidację kontraktu i dryfu wersji",
    "writers": [
      "process_cancel",
      "process_wait",
      "scenario_check_composition",
      "scenario_generate",
      "scenario_save_composition",
      "scenario_set_composition_type",
      "scenario_update_pins"
    ],
    "readers": [
      "process_get_status",
      "run_start"
    ],
    "required": true
  },
  {
    "path": "steps.scenario.compiled",
    "module": "scenario",
    "check": "compiled",
    "type": "Check",
    "description": "projekt Gatling się kompiluje",
    "writers": [
      "process_cancel",
      "process_wait",
      "scenario_compile_composition"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": false
  },
  {
    "path": "steps.scenario.drift",
    "module": "scenario",
    "check": "drift",
    "type": "Check",
    "description": "ostatni wynik sprawdzenia zgodności z referencją",
    "writers": [
      "process_cancel",
      "process_wait",
      "scenario_check_drift"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": false
  },
  {
    "path": "steps.data.planned",
    "module": "data",
    "check": "planned",
    "type": "Check",
    "description": "plan danych odczytany",
    "writers": [
      "data_suggest_actions",
      "process_cancel",
      "process_wait"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": false
  },
  {
    "path": "steps.data.bindings_set",
    "module": "data",
    "check": "bindings_set",
    "type": "Check",
    "description": "sloty mają powiązane zbiory",
    "writers": [
      "data_set_bindings",
      "process_cancel",
      "process_wait"
    ],
    "readers": [
      "data_check_readiness",
      "process_get_status"
    ],
    "required": true
  },
  {
    "path": "steps.data.datasets_ready",
    "module": "data",
    "check": "datasets_ready",
    "type": "Check",
    "description": "dane wystarczą na wybrane obciążenie",
    "writers": [
      "data_check_readiness",
      "data_create_accounts",
      "data_delete",
      "data_regenerate_dataset",
      "data_restore_dataset",
      "data_set_bindings",
      "data_update_dataset",
      "process_cancel",
      "process_wait",
      "scenario_set_composition_type"
    ],
    "readers": [
      "process_get_status",
      "run_start"
    ],
    "required": true
  },
  {
    "path": "steps.data.accounts",
    "module": "data",
    "check": "accounts",
    "type": "Check",
    "description": "konta testowe utworzone w systemie celu",
    "writers": [
      "data_create_accounts",
      "process_cancel",
      "process_wait"
    ],
    "readers": [
      "process_get_status",
      "run_start"
    ],
    "required": {
      "when": "choices.data.needs_accounts",
      "in": [
        true
      ]
    }
  },
  {
    "path": "steps.run.planned",
    "module": "run",
    "check": "planned",
    "type": "Check",
    "description": "profil sprawdzony względem limitów środowiska i danych",
    "writers": [
      "process_cancel",
      "process_wait",
      "run_plan"
    ],
    "readers": [
      "process_get_status",
      "run_start"
    ],
    "required": true
  },
  {
    "path": "steps.run.started",
    "module": "run",
    "check": "started",
    "type": "Check",
    "description": "przebieg wystartował",
    "writers": [
      "process_cancel",
      "process_wait",
      "run_start",
      "run_start_saved"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": true
  },
  {
    "path": "steps.run.finished",
    "module": "run",
    "check": "finished",
    "type": "Check",
    "description": "przebieg zakończony (ok = bez błędu wykonania)",
    "writers": [
      "process_cancel",
      "process_wait",
      "run_get",
      "run_start",
      "run_start_saved"
    ],
    "readers": [
      "process_get_status",
      "results_analyze_run",
      "results_get_report"
    ],
    "required": true
  },
  {
    "path": "steps.results.report",
    "module": "results",
    "check": "report",
    "type": "Check",
    "description": "raport odczytany",
    "writers": [
      "process_cancel",
      "process_wait",
      "results_get_report"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": true
  },
  {
    "path": "steps.results.analysis",
    "module": "results",
    "check": "analysis",
    "type": "Check",
    "description": "analiza AI gotowa",
    "writers": [
      "process_cancel",
      "process_wait",
      "results_analyze_run"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": false
  },
  {
    "path": "steps.results.production_verdict",
    "module": "results",
    "check": "production_verdict",
    "type": "Check",
    "description": "werdykt przebiegu produkcyjnego",
    "writers": [
      "process_cancel",
      "process_wait",
      "results_check_production"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": {
      "when": "choices.run.profile.type",
      "in": [
        "production"
      ]
    }
  },
  {
    "path": "steps.functional.test_types",
    "module": "functional",
    "check": "test_types",
    "type": "Check",
    "description": "projekt ma typy testów",
    "writers": [
      "functional_generate_test_types",
      "functional_save_test_types",
      "process_cancel",
      "process_wait"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": true
  },
  {
    "path": "steps.functional.validators",
    "module": "functional",
    "check": "validators",
    "type": "Check",
    "description": "projekt ma walidatory",
    "writers": [
      "functional_save_validators",
      "process_cancel",
      "process_wait"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": false
  },
  {
    "path": "steps.functional.run_finished",
    "module": "functional",
    "check": "run_finished",
    "type": "Check",
    "description": "ostatni przebieg funkcjonalny zakończony",
    "writers": [
      "functional_get_runs",
      "functional_start_run",
      "process_cancel",
      "process_wait"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": true
  },
  {
    "path": "steps.traffic.snapshot",
    "module": "traffic",
    "check": "snapshot",
    "type": "Check",
    "description": "jest zapisana migawka ruchu",
    "writers": [
      "process_cancel",
      "process_wait",
      "traffic_delete",
      "traffic_import_snapshot"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": false
  },
  {
    "path": "steps.github.connected",
    "module": "github",
    "check": "connected",
    "type": "Check",
    "description": "projekt połączony z repozytorium",
    "writers": [
      "github_connect",
      "github_disconnect",
      "github_get_status",
      "process_cancel",
      "process_wait"
    ],
    "readers": [
      "github_get_changes",
      "github_push",
      "process_get_status"
    ],
    "required": true
  },
  {
    "path": "steps.github.pushed",
    "module": "github",
    "check": "pushed",
    "type": "Check",
    "description": "ostatnie wysłanie kodu",
    "writers": [
      "github_disconnect",
      "github_push",
      "process_cancel",
      "process_wait"
    ],
    "readers": [
      "process_get_status"
    ],
    "required": false
  }
];

export const WS_FRAMES: readonly WsFrame[] = [
  {
    "channel": "batch",
    "frame": "BatchBasketComplete",
    "effect": "`problems`: warning `flows_need_input` z `flow_ids` i `definite_count`, gdy ramka niesie `definite_count` > 0 (flowy z koszyka mają pozycje needs_input, pewne dostaną 401); operacja generacji toczy się dalej",
    "resume": "`flows_get` pokazuje `needs_input` flowu; uzupełnienie danych albo klucza w środowisku (`project_save_env`), regeneracja albo zapis flowu kasuje problem"
  },
  {
    "channel": "describe",
    "frame": "DescribeSplitProposal",
    "effect": "`pending`: kind=review, poziom 1 (wybór, bez kosztu i ruchu), „Split the description into N journeys?”, opcje = proponowane ścieżki; operacja `waiting_user`",
    "resume": "`process_answer` (yes, opcjonalnie poprawione ścieżki) wysyła ramkę DescribeSplitResume"
  },
  {
    "channel": "describe",
    "frame": "DescribeSplitResumeRefused",
    "effect": "`problems`: warning `walk_browsers_busy`; karta podziału wraca do `open`",
    "resume": "ponowne `process_answer`, gdy przeglądarka się zwolni"
  },
  {
    "channel": "describe",
    "frame": "DescribeHelpRequested",
    "effect": "`pending`: kind=needs_user, poziom 3, link do podglądu na żywo w aplikacji, `expires_at` z ramki, treść `agent_says`; operacja `waiting_user`",
    "resume": "użytkownik przejmuje przeglądarkę w aplikacji albo zatrzymuje bieg (`process_cancel`)"
  },
  {
    "channel": "describe",
    "frame": "DescribeControlTaken",
    "effect": "karta needs_user: status `running` (użytkownik steruje); postęp operacji: „user control”",
    "resume": "–"
  },
  {
    "channel": "describe",
    "frame": "DescribeControlReturned",
    "effect": "karta needs_user: `done`; wpis dziennika z `reason`, `choice`, `obstacle_kind`; operacja wraca do `running`",
    "resume": "–"
  },
  {
    "channel": "describe",
    "frame": "DescribeHintRefused, DescribeStopRefused, DescribeMessageDenied",
    "effect": "`problems`: warning `walk_control_refused` (brak roli albo właściciela biegu)",
    "resume": "komunikat w rozmowie"
  },
  {
    "channel": "describe",
    "frame": "DescribeRedriveDiverged",
    "effect": "`pending`: kind=review, poziom 3 („continue” wysyła dalsze żądania do aplikacji celu), tytuł i pola karty z treści ramki (gdzie powtórka zeszła ze ścieżki), opcje continue i stop, `expires_at` z ramki; operacja `waiting_user`",
    "resume": "`process_answer` wysyła ramkę `replay_continue` (continue) albo `stop`; po `expires_at` karta `expired`"
  },
  {
    "channel": "describe",
    "frame": "DescribeRedriveOperatorPart",
    "effect": "`pending`: kind=needs_user, poziom 3 (czynność w aplikacji), link do podglądu na żywo, `expires_at` z ramki (przeszkoda czeka na przejęcie albo zatrzymanie); operacja `waiting_user`",
    "resume": "użytkownik używa „Take control” w aplikacji albo zatrzymuje bieg (`process_cancel`)"
  },
  {
    "channel": "describe",
    "frame": "DescribeReplayContinueRefused",
    "effect": "`problems`: warning `walk_replay_refused` (odpowiedź na `replay_continue`); karta Diverged wraca do `open`",
    "resume": "ponowne `process_answer` albo `flows_retry_walk`"
  },
  {
    "channel": "describe",
    "frame": "DescribeInterrupted",
    "effect": "operacja `failed`; `problems`: blocker `walk_interrupted`; otwarte karty biegu `expired`",
    "resume": "`flows_retry_walk` albo nowy `flows_describe_journeys`"
  },
  {
    "channel": "har",
    "frame": "HarSplitProposal",
    "effect": "`pending`: kind=review, poziom 1 (wybór, bez kosztu i ruchu), opcje = proponowane ścieżki; operacja `waiting_user`",
    "resume": "`process_answer` (yes, opcjonalnie poprawione ścieżki) wysyła ramkę HarSplitResume"
  },
  {
    "channel": "gatlingFeeder",
    "frame": "GatlingFeederBudgetFallback",
    "effect": "`problems`: warning `dataset_budget_fallback` ze wskazaniem zbioru; ostrzeżenia w wyniku narzędzia",
    "resume": "–"
  },
  {
    "channel": "gatlingFeeder",
    "frame": "GatlingFeederValidationFailed",
    "effect": "operacja `failed`; `problems`: blocker `dataset_validation_failed` ze wskazaniem kolumny",
    "resume": "`data_regenerate_column` z innym generatorem albo `data_restore_dataset`"
  },
  {
    "channel": "liveView",
    "frame": "LiveViewBlocked, LiveViewSelectOptions, LiveViewControl*",
    "effect": "brak: kanał poza pluginem, plugin go nie subskrybuje; skutek dociera kanałem describe (DescribeHelpRequested, DescribeControlReturned z `obstacle_kind`)",
    "resume": "czynność w aplikacji (link z karty needs_user)"
  },
  {
    "channel": "REST, każde narzędzie",
    "frame": "odpowiedź z kodem potwierdzenia (dziś `confirm_capped`, `confirm_protected`)",
    "effect": "`pending`: kind=question, poziom 3, opcje z odpowiedzi; wywołanie kończy się bez skutku",
    "resume": "`process_answer` (yes) powtarza zapisane wywołanie z flagą potwierdzenia, którą dokłada rejestr, nie model"
  }
];

export const PROBLEM_CODES: readonly ProblemCode[] = [
  {
    "code": "flows_need_input",
    "severity": "warning",
    "fields": [
      "flow_ids",
      "definite_count"
    ],
    "set_by": [
      "flows_generate_from_suggestions",
      "flows_generate_from_endpoints",
      "flows_generate_from_har",
      "flows_regenerate",
      "flows_get",
      "flows_list",
      "process_get_status"
    ],
    "cleared_by": [
      "flows_regenerate",
      "flows_save",
      "project_save_env",
      "flows_delete"
    ],
    "shown_by": [
      "process_get_status",
      "flows_get",
      "scenario_generate",
      "run_start"
    ]
  },
  {
    "code": "profile_fields_uncertain",
    "severity": "warning",
    "fields": [
      "field_paths"
    ],
    "set_by": [
      "project_analyze_setup"
    ],
    "cleared_by": [
      "project_apply_setup",
      "project_set_profile"
    ],
    "shown_by": [
      "process_get_status",
      "project_get"
    ]
  },
  {
    "code": "flows_on_old_docs",
    "severity": "warning",
    "fields": [
      "flow_ids"
    ],
    "set_by": [
      "project_import_docs",
      "process_get_status",
      "scenario_generate",
      "flows_migrate_docs"
    ],
    "cleared_by": [
      "flows_migrate_docs",
      "flows_regenerate",
      "flows_delete"
    ],
    "shown_by": [
      "scenario_generate",
      "scenario_suggest_split",
      "process_get_status"
    ]
  }
];

/**
 * The name a tool had in the FIRST catalog version, mapped to its name in this catalog. NOT today's
 * shipped tools: those are in CURRENT_TO_TOOLS.
 */
export const V1_NAME_TO_TOOL: Readonly<Record<string, ToolName>> = {
  "process_get_status": "process_get_status",
  "process_wait": "process_wait",
  "process_cancel": "process_cancel",
  "process_answer": "process_answer",
  "process_set_choices": "process_set_choices",
  "project_list": "project_list",
  "project_get": "project_get",
  "project_create": "project_create",
  "project_update": "project_update",
  "project_delete": "project_delete",
  "project_get_envs": "project_get_envs",
  "project_save_env": "project_save_env",
  "project_check_env": "project_check_env",
  "project_get_docs": "project_get_docs",
  "project_get_endpoints": "project_get_endpoints",
  "project_import_docs": "project_import_docs",
  "project_set_active_docs": "project_set_active_docs",
  "project_analyze_setup": "project_analyze_setup",
  "project_apply_setup": "project_apply_setup",
  "project_get_apimap": "project_get_apimap",
  "project_set_apimap": "project_set_apimap",
  "project_connect_telemetry": "project_connect_telemetry",
  "project_disconnect_telemetry": "project_disconnect_telemetry",
  "project_get_notes": "project_list_notes",
  "project_update_note": "project_update_note",
  "project_get_team": "project_list_team",
  "project_manage_team": "project_save_member",
  "project_get_activity": "project_get_activity",
  "project_get_load_settings": "project_get_http_settings",
  "project_set_load_settings": "project_set_http_settings",
  "flows_suggest_journeys": "flows_suggest_journeys",
  "flows_generate_from_suggestions": "flows_generate_from_suggestions",
  "flows_generate_from_endpoints": "flows_generate_from_endpoints",
  "flows_generate_from_har": "flows_generate_from_har",
  "flows_regenerate": "flows_regenerate",
  "flows_import_har": "flows_import_har",
  "flows_describe_journeys": "flows_describe_journeys",
  "flows_record_journeys": "flows_record_journeys",
  "flows_get_walks": "flows_get_walks",
  "flows_retry_walk": "flows_retry_walk",
  "flows_manage_walk_notes": "flows_save_walk_note",
  "flows_export_walk_image": "flows_export_walk_image",
  "flows_list": "flows_list",
  "flows_get": "flows_get",
  "flows_get_versions": "flows_get_versions",
  "flows_restore_version": "flows_restore_version",
  "flows_save": "flows_save",
  "flows_delete": "flows_delete",
  "flows_duplicate": "flows_duplicate",
  "flows_merge": "flows_merge",
  "flows_set_poll_terminals": "flows_set_poll_terminals",
  "flows_ask_copilot": "flows_ask_copilot",
  "flows_apply_copilot_changes": "flows_apply_copilot_changes",
  "flows_get_copilot_history": "flows_get_copilot_history",
  "scenario_list": "scenario_list",
  "scenario_get": "scenario_get",
  "scenario_save": "scenario_save",
  "scenario_delete": "scenario_delete",
  "scenario_generate": "scenario_generate",
  "scenario_regenerate": "scenario_regenerate",
  "scenario_check": "scenario_check_self",
  "scenario_check_drift": "scenario_check_drift",
  "scenario_export": "scenario_export",
  "scenario_get_versions": "scenario_get_versions",
  "scenario_restore_version": "scenario_restore_version",
  "scenario_plan_split": "scenario_suggest_split",
  "scenario_ask_copilot": "scenario_ask_copilot",
  "scenario_get_copilot_history": "scenario_get_copilot_history",
  "scenario_list_compositions": "scenario_list_compositions",
  "scenario_get_composition": "scenario_get_composition",
  "scenario_save_composition": "scenario_save_composition",
  "scenario_check_composition": "scenario_check_composition",
  "scenario_compile_composition": "scenario_compile_composition",
  "scenario_get_composition_code": "scenario_get_composition_code",
  "scenario_update_composition_pins": "scenario_update_pins",
  "scenario_set_composition_test_type": "scenario_set_composition_type",
  "scenario_get_templates": "scenario_get_templates",
  "data_plan": "data_suggest_actions",
  "data_ask_copilot": "data_ask_copilot",
  "data_get_copilot_history": "data_get_copilot_history",
  "data_get_slots": "data_get_slots",
  "data_set_bindings": "data_set_bindings",
  "data_set_slot_label": "data_set_slot_label",
  "data_check_readiness": "data_check_readiness",
  "data_list_datasets": "data_list_datasets",
  "data_get_dataset": "data_get_dataset",
  "data_create_dataset": "data_create_dataset",
  "data_update_dataset": "data_update_dataset",
  "data_delete": "data_delete",
  "data_generate_dataset": "data_generate_dataset",
  "data_regenerate_column": "data_regenerate_column",
  "data_get_generators": "data_get_generators",
  "data_check_dataset": "data_check_dataset",
  "data_create_accounts": "data_create_accounts",
  "run_plan": "run_plan",
  "run_start": "run_start",
  "run_start_saved": "run_start_saved",
  "run_list": "run_list",
  "run_get": "run_get",
  "run_delete": "run_delete",
  "run_get_configs": "run_get_profiles",
  "run_save_config": "run_save_profile",
  "run_get_saved": "run_get_saved",
  "run_save": "run_save",
  "run_set_schedule": "run_set_schedule",
  "run_get_history": "run_get_usage",
  "results_get_report": "results_get_report",
  "results_get_endpoint": "results_get_request",
  "results_get_errors": "results_get_errors",
  "results_get_traces": "results_get_traces",
  "results_get_logs": "results_get_logs",
  "results_export_report": "results_export_report",
  "results_check_production": "results_check_production",
  "results_compare_runs": "results_compare_runs",
  "results_set_baseline": "results_set_baseline",
  "results_analyze_run": "results_analyze_run",
  "traffic_list_snapshots": "traffic_list_snapshots",
  "traffic_get_snapshot": "traffic_get_snapshot",
  "traffic_import_snapshot": "traffic_import_snapshot",
  "traffic_delete": "traffic_delete",
  "traffic_get_push_setup": "traffic_get_push_setup",
  "traffic_create_token": "traffic_create_token",
  "functional_get_catalog": "functional_get_catalog",
  "functional_manage_catalog": "functional_save_catalog",
  "functional_get_test_types": "functional_get_test_types",
  "functional_save_test_types": "functional_save_test_types",
  "functional_suggest_test_types": "functional_suggest_test_types",
  "functional_generate_test_types": "functional_generate_test_types",
  "functional_get_validators": "functional_get_validators",
  "functional_save_validators": "functional_save_validators",
  "functional_suggest_validators": "functional_suggest_validators",
  "functional_get_analytics": "functional_get_analytics",
  "functional_get_flows": "functional_get_flows",
  "functional_save_flow": "functional_save_flow",
  "functional_restore_flow_version": "functional_restore_flow",
  "functional_get_templates": "functional_get_templates",
  "functional_save_template": "functional_save_template",
  "functional_delete": "functional_delete",
  "functional_start_run": "functional_start_run",
  "functional_get_runs": "functional_get_runs",
  "functional_get_results": "functional_get_results",
  "functional_compare_runs": "functional_compare_runs",
  "functional_generate_payloads": "functional_generate_payloads",
  "github_get_status": "github_get_status",
  "github_connect": "github_connect",
  "github_plan_push": "github_plan_push",
  "github_push": "github_push",
  "github_pull": "github_get_changes",
  "github_disconnect": "github_disconnect"
};

/**
 * The names of today's tools and helper files (CURRENT_KIND) that the new catalog replaces. NOT the same as
 * V1_NAME_TO_TOOL: that maps the names of the FIRST catalog version, these are the tools of the
 * plugin as it ships now. Source: the "migration" section of katalog.json.
 */
export const CURRENT_TOOL_NAMES = [
  "init_project",
  "update_openapi",
  "set_telemetry_source",
  "suggest_journeys",
  "build_flows",
  "import_har",
  "describe_flows",
  "record_flows",
  "get_flow",
  "build_scenario",
  "list_profiles",
  "prepare_data",
  "provision_accounts",
  "self_check",
  "run_test",
  "wait",
  "cancel",
  "get_status",
  "get_report",
  "get_diagnosis",
  "recordWalk",
  "operationKinds"
] as const;

export type CurrentToolName = (typeof CURRENT_TOOL_NAMES)[number];

/** How a current name changed: rename, rename_and_role, split, merge or library. */
export type CurrentChange = 'rename' | 'rename_and_role' | 'split' | 'merge' | 'library';

/**
 * Today's name -> the new tools that take it over. The tuple is never empty and element [0] is the
 * main way (for a split, the tool that replaces the old default behaviour). Not V1_NAME_TO_TOOL,
 * which maps names from the first catalog version.
 */
export const CURRENT_TO_TOOLS: Readonly<Record<CurrentToolName, readonly [ToolName, ...ToolName[]]>> = {
  "init_project": [
    "project_create",
    "project_save_env",
    "project_check_env",
    "project_analyze_setup",
    "project_apply_setup"
  ],
  "update_openapi": [
    "project_import_docs"
  ],
  "set_telemetry_source": [
    "project_connect_telemetry"
  ],
  "suggest_journeys": [
    "flows_suggest_journeys"
  ],
  "build_flows": [
    "flows_generate_from_suggestions",
    "flows_generate_from_endpoints",
    "flows_generate_from_har"
  ],
  "import_har": [
    "flows_import_har"
  ],
  "describe_flows": [
    "flows_describe_journeys"
  ],
  "record_flows": [
    "flows_record_journeys"
  ],
  "get_flow": [
    "flows_get"
  ],
  "build_scenario": [
    "scenario_generate",
    "scenario_suggest_split"
  ],
  "list_profiles": [
    "run_plan"
  ],
  "prepare_data": [
    "data_suggest_actions",
    "data_check_readiness",
    "data_set_bindings",
    "data_create_dataset"
  ],
  "provision_accounts": [
    "data_create_accounts"
  ],
  "self_check": [
    "scenario_check_self"
  ],
  "run_test": [
    "run_start",
    "run_plan"
  ],
  "wait": [
    "process_wait"
  ],
  "cancel": [
    "process_cancel"
  ],
  "get_status": [
    "process_get_status"
  ],
  "get_report": [
    "results_get_report"
  ],
  "get_diagnosis": [
    "results_analyze_run"
  ],
  "recordWalk": [
    "flows_record_journeys",
    "flows_retry_walk"
  ],
  "operationKinds": [
    "process_wait",
    "process_cancel"
  ]
};

/** The kind of change per current name, in English tags. */
export const CURRENT_CHANGE: Readonly<Record<CurrentToolName, CurrentChange>> = {
  "init_project": "split",
  "update_openapi": "rename",
  "set_telemetry_source": "rename",
  "suggest_journeys": "rename",
  "build_flows": "split",
  "import_har": "rename",
  "describe_flows": "rename",
  "record_flows": "rename",
  "get_flow": "rename",
  "build_scenario": "split",
  "list_profiles": "merge",
  "prepare_data": "split",
  "provision_accounts": "rename",
  "self_check": "rename",
  "run_test": "split",
  "wait": "rename",
  "cancel": "rename",
  "get_status": "rename_and_role",
  "get_report": "rename",
  "get_diagnosis": "rename",
  "recordWalk": "library",
  "operationKinds": "library"
};

/** What a current name is: a tool of today, or a helper file of the plugin (no tool, no log entry). */
export const CURRENT_KIND: Readonly<Record<CurrentToolName, 'tool' | 'helper'>> = {
  "init_project": "tool",
  "update_openapi": "tool",
  "set_telemetry_source": "tool",
  "suggest_journeys": "tool",
  "build_flows": "tool",
  "import_har": "tool",
  "describe_flows": "tool",
  "record_flows": "tool",
  "get_flow": "tool",
  "build_scenario": "tool",
  "list_profiles": "tool",
  "prepare_data": "tool",
  "provision_accounts": "tool",
  "self_check": "tool",
  "run_test": "tool",
  "wait": "tool",
  "cancel": "tool",
  "get_status": "tool",
  "get_report": "tool",
  "get_diagnosis": "tool",
  "recordWalk": "helper",
  "operationKinds": "helper"
};

/** Tools whose schema the client loads up front. */
export const ALWAYS_LOAD: readonly ToolName[] = [
  "process_get_status",
  "process_wait",
  "process_cancel",
  "process_answer",
  "process_set_choices"
];

/** Tools of the default mode: the core and the process modules. */
export const DEFAULT_MODE: readonly ToolName[] = [
  "process_get_status",
  "process_wait",
  "process_cancel",
  "process_answer",
  "process_set_choices",
  "process_set_decision",
  "project_list",
  "project_get",
  "project_create",
  "project_update",
  "project_set_profile",
  "project_delete",
  "project_get_envs",
  "project_save_env",
  "project_check_env",
  "project_get_docs",
  "project_get_endpoints",
  "project_import_docs",
  "project_set_active_docs",
  "project_analyze_setup",
  "project_apply_setup",
  "project_get_apimap",
  "project_set_apimap",
  "project_connect_telemetry",
  "project_disconnect_telemetry",
  "project_list_notes",
  "project_update_note",
  "project_list_team",
  "project_save_member",
  "project_get_activity",
  "project_get_http_settings",
  "project_set_http_settings",
  "flows_suggest_journeys",
  "flows_generate_from_suggestions",
  "flows_generate_from_endpoints",
  "flows_generate_from_har",
  "flows_regenerate",
  "flows_import_har",
  "flows_describe_journeys",
  "flows_record_journeys",
  "flows_get_walks",
  "flows_retry_walk",
  "flows_save_walk_note",
  "flows_export_walk_image",
  "flows_list",
  "flows_get",
  "flows_get_versions",
  "flows_restore_version",
  "flows_save",
  "flows_delete",
  "flows_duplicate",
  "flows_migrate_docs",
  "flows_merge",
  "flows_set_poll_terminals",
  "flows_ask_copilot",
  "flows_apply_copilot_changes",
  "flows_get_copilot_history",
  "scenario_list",
  "scenario_get",
  "scenario_save",
  "scenario_delete",
  "scenario_generate",
  "scenario_regenerate",
  "scenario_check_self",
  "scenario_check_drift",
  "scenario_export",
  "scenario_get_versions",
  "scenario_restore_version",
  "scenario_suggest_split",
  "scenario_ask_copilot",
  "scenario_get_copilot_history",
  "scenario_list_compositions",
  "scenario_get_composition",
  "scenario_save_composition",
  "scenario_check_composition",
  "scenario_compile_composition",
  "scenario_get_composition_code",
  "scenario_update_pins",
  "scenario_set_composition_type",
  "scenario_get_templates",
  "data_suggest_actions",
  "data_ask_copilot",
  "data_get_copilot_history",
  "data_get_slots",
  "data_set_bindings",
  "data_set_slot_label",
  "data_check_readiness",
  "data_list_datasets",
  "data_get_dataset",
  "data_create_dataset",
  "data_update_dataset",
  "data_regenerate_dataset",
  "data_restore_dataset",
  "data_delete",
  "data_generate_dataset",
  "data_regenerate_column",
  "data_get_generators",
  "data_check_dataset",
  "data_create_accounts",
  "run_plan",
  "run_start",
  "run_start_saved",
  "run_list",
  "run_get",
  "run_delete",
  "run_get_profiles",
  "run_save_profile",
  "run_get_saved",
  "run_save",
  "run_set_schedule",
  "run_get_usage",
  "results_get_report",
  "results_get_request",
  "results_get_errors",
  "results_get_traces",
  "results_get_logs",
  "results_export_report",
  "results_check_production",
  "results_compare_runs",
  "results_set_baseline",
  "results_analyze_run",
  "traffic_list_snapshots",
  "traffic_get_snapshot",
  "traffic_import_snapshot",
  "traffic_delete"
];

/** Tools of the extended modules, off in the default mode. */
export const EXTENDED: readonly ToolName[] = [
  "traffic_get_push_setup",
  "traffic_create_token",
  "functional_get_catalog",
  "functional_save_catalog",
  "functional_import_catalog",
  "functional_get_test_types",
  "functional_save_test_types",
  "functional_suggest_test_types",
  "functional_generate_test_types",
  "functional_get_validators",
  "functional_save_validators",
  "functional_suggest_validators",
  "functional_get_analytics",
  "functional_get_flows",
  "functional_save_flow",
  "functional_restore_flow",
  "functional_get_templates",
  "functional_save_template",
  "functional_delete",
  "functional_start_run",
  "functional_get_runs",
  "functional_get_results",
  "functional_compare_runs",
  "functional_generate_payloads",
  "github_get_status",
  "github_connect",
  "github_plan_push",
  "github_push",
  "github_get_changes",
  "github_disconnect"
];

/**
 * Every backend operation the catalog names (tools and excluded), but those the public snapshot leaves
 * out (scripts/sync-api/excluded.ts). `satisfies` makes the compiler refuse an
 * operationId that is not a key of the generated client's operations.
 */
export const CATALOG_OPERATION_IDS = [
  "accept_suggestion_api_v1_projects__project_id__test_types_suggest_accept_post",
  "activate_asyncapi_spec_api_v1_projects__project_id__asyncapi_specs__spec_id__activate_put",
  "activate_openapi_spec_api_v1_projects__project_id__openapi_specs__spec_id__activate_put",
  "add_step_note_api_v1_projects__project_id__scenario_from_description_runs__run_id__notes_post",
  "add_team_member_api_v1_projects__project_id__team_post",
  "add_test_type_api_v1_projects__project_id__test_types_post",
  "add_validator_api_v1_projects__project_id__validators_post",
  "analyze_execution_api_v1_projects__project_id__gatling_executions__execution_id__analyze_post",
  "analyze_execution_async_api_v1_projects__project_id__gatling_executions__execution_id__analyze_async_post",
  "analyze_har_api_v1_projects__project_id__har__har_session_id__analyze_post",
  "analyze_project_setup_api_v1_project_setup_analyze_post",
  "analyze_project_setup_for_project_api_v1_projects__project_id__setup_analyze_post",
  "apply_copilot_proposal_api_v1_projects__project_id__flows__flow_id__copilot_apply_post",
  "apply_setup_api_v1_projects__project_id__setup_apply_post",
  "auto_plan_data_api_v1_projects__project_id__data_hub_auto_plan_post",
  "auto_provision_api_v1_projects__project_id__setup_auto_provision_post",
  "batch_delete_flows_api_v1_projects__project_id__flows_batch_delete_post",
  "batch_delete_projects_api_v1_projects_batch_delete_post",
  "batch_duplicate_flows_api_v1_projects__project_id__flows_batch_duplicate_post",
  "batch_generate_flows_api_v1_projects__project_id__flow_suggestions_batch_generate_post",
  "bulk_add_test_types_api_v1_projects__project_id__test_types_bulk_post",
  "bulk_add_validators_api_v1_projects__project_id__validators_bulk_post",
  "bulk_delete_executions_api_v1_projects__project_id__gatling_executions_bulk_delete_post",
  "cancel_execution_api_v1_executions__run_id__cancel_post",
  "cancel_execution_api_v1_projects__project_id__executions__execution_id__cancel_post",
  "cancel_execution_api_v1_projects__project_id__gatling_executions__execution_id__cancel_post",
  "cancel_har_session_api_v1_projects__project_id__har__har_session_id__cancel_post",
  "cancel_refine_api_v1_projects__project_id__flow_suggestions_refine__job_id__cancel_post",
  "cancel_scenario_api_v1_projects__project_id__scenario_from_description_runs__run_id__cancel_post",
  "cancel_scenario_generation_api_v1_projects__project_id__gatling_scenarios_generate_async__run_id__cancel_post",
  "cancel_scenario_regenerate_api_v1_projects__project_id__gatling_scenarios__scenario_id__regenerate_async__run_id__cancel_post",
  "change_member_role_api_v1_projects__project_id__team__user_id__put",
  "claim_next_job_api_v1_injector_agents_jobs_next_get",
  "clear_saved_run_schedule_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__schedule_delete",
  "compare_functional_executions_api_v1_projects__project_id__executions_compare_get",
  "compare_gatling_executions_api_v1_projects__project_id__gatling_executions_compare_get",
  "conformance_api_v1_projects__project_id__environments__environment_id__conformance_post",
  "connect_github_api_v1_projects__project_id__github_connect_post",
  "connect_with_token_api_v1_projects__project_id__github_connect_token_post",
  "create_action_api_v1_projects__project_id__actions_post",
  "create_api_token_api_v1_auth_api_tokens_post",
  "create_assertion_type_api_v1_assertion_types_post",
  "create_asyncapi_spec_api_v1_asyncapi_specs_post",
  "create_base_test_type_api_v1_base_test_types_post",
  "create_base_validator_api_v1_base_validators_post",
  "create_batch_run_api_v1_test_templates_batch_runs_post",
  "create_composition_api_v1_projects__project_id__gatling_compositions_post",
  "create_configuration_api_v1_projects__project_id__gatling_configurations_post",
  "create_environment_api_v1_environments_post",
  "create_environment_api_v1_projects__project_id__environments_post",
  "create_environment_api_v1_projects__project_id__gatling_environments_post",
  "create_feeder_api_v1_projects__project_id__gatling_feeders_post",
  "create_flow_api_v1_projects__project_id__flows_post",
  "create_ingest_token_api_v1_projects__project_id__production_traffic_tokens_post",
  "create_openapi_spec_api_v1_openapi_specs_post",
  "create_project_and_generate_api_v1_project_setup_runs__run_id__create_and_generate_post",
  "create_project_api_v1_projects_post",
  "create_saved_run_api_v1_projects__project_id__gatling_saved_runs_post",
  "create_scenario_api_v1_projects__project_id__gatling_scenarios_post",
  "create_scheduled_run_api_v1_projects__project_id__gatling_scheduled_runs_post",
  "create_test_flow_api_v1_test_flows_post",
  "create_test_template_api_v1_test_templates_post",
  "create_version_api_v1_test_flows__flow_id__versions_post",
  "delete_action_api_v1_projects__project_id__actions__action_id__delete",
  "delete_agent_guidance_entry_api_v1_projects__project_id__agent_guidance__entry_id__delete",
  "delete_assertion_type_api_v1_assertion_types__type_id__delete",
  "delete_asyncapi_spec_api_v1_asyncapi_specs__spec_id__delete",
  "delete_base_test_type_api_v1_base_test_types__test_type_id__delete",
  "delete_base_validator_api_v1_base_validators__validator_id__delete",
  "delete_composition_api_v1_projects__project_id__gatling_compositions__composition_id__delete",
  "delete_configuration_api_v1_projects__project_id__gatling_configurations__config_id__delete",
  "delete_environment_api_v1_environments__env_id__delete",
  "delete_environment_api_v1_projects__project_id__environments__environment_id__delete",
  "delete_environment_api_v1_projects__project_id__gatling_environments__env_id__delete",
  "delete_execution_api_v1_projects__project_id__executions__execution_id__delete",
  "delete_execution_api_v1_projects__project_id__gatling_executions__execution_id__delete",
  "delete_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__delete",
  "delete_flow_api_v1_projects__project_id__flows__flow_id__delete",
  "delete_openapi_spec_api_v1_openapi_specs__spec_id__delete",
  "delete_project_api_v1_projects__project_id__delete",
  "delete_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__delete",
  "delete_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__delete",
  "delete_scheduled_run_api_v1_projects__project_id__gatling_scheduled_runs__scheduled_run_id__delete",
  "delete_snapshot_api_v1_projects__project_id__production_traffic_snapshots__snapshot_id__delete",
  "delete_step_note_api_v1_projects__project_id__scenario_from_description_runs__run_id__notes__note_id__delete",
  "delete_telemetry_source_api_v1_projects__project_id__telemetry_source_delete",
  "delete_test_flow_api_v1_test_flows__flow_id__delete",
  "delete_test_template_api_v1_test_templates__template_id__delete",
  "delete_test_type_api_v1_projects__project_id__test_types__test_type_id__delete",
  "delete_validator_api_v1_projects__project_id__validators__validator_id__delete",
  "disconnect_github_api_v1_projects__project_id__github_disconnect_post",
  "discover_validators_api_v1_projects__project_id__validators_discover_post",
  "download_execution_logs_api_v1_projects__project_id__gatling_executions__execution_id__logs_download_get",
  "download_generated_payloads_api_v1_projects__project_id__generate_payloads__run_id__download_get",
  "dry_run_composition_api_v1_projects__project_id__gatling_compositions__composition_id__dry_run_post",
  "duplicate_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__duplicate_post",
  "duplicate_flow_for_spec_api_v1_projects__project_id__flows__flow_id__duplicate_for_spec_post",
  "estimate_session_peak_api_v1_projects__project_id__gatling_session_peak_post",
  "execute_adhoc_api_v1_projects__project_id__execute_post",
  "execute_composition_api_v1_projects__project_id__gatling_compositions__composition_id__execute_post",
  "execute_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__execute_post",
  "expand_feeder_dataset_api_v1_projects__project_id__gatling_feeders__feeder_id__expand_post",
  "export_scenario_project_api_v1_projects__project_id__gatling_scenarios__scenario_id__export_get",
  "feeder_preflight_api_v1_projects__project_id__gatling_executions_preflight_post",
  "fetch_job_bundle_api_v1_injector_agents_jobs__job_id__bundle_get",
  "finish_review_api_v1_projects__project_id__scenario_from_description_runs__run_id__finish_review_post",
  "gatling_feeder_jdbc_preview_api_v1_projects__project_id__gatling_feeders__feeder_id__jdbc_preview_post",
  "gatling_feeder_jdbc_test_connection_api_v1_projects__project_id__gatling_feeders_jdbc_test_connection_post",
  "gatling_feeder_redis_status_api_v1_projects__project_id__gatling_feeders__feeder_id__redis_status_get",
  "generate_feeder_async_api_v1_projects__project_id__gatling_feeders_generate_async_post",
  "generate_feeder_data_api_v1_projects__project_id__gatling_feeders_generate_post",
  "generate_feeder_from_rules_api_v1_projects__project_id__gatling_feeders_generate_from_rules_post",
  "generate_feeder_from_scenario_api_v1_projects__project_id__gatling_feeders_generate_from_scenario_post",
  "generate_flow_api_v1_projects__project_id__flows_generate_post",
  "generate_flow_api_v1_projects__project_id__har__har_session_id__generate_post",
  "generate_flow_async_api_v1_projects__project_id__flows_generate_async_post",
  "generate_multi_flow_api_v1_projects__project_id__har__har_session_id__generate_multi_post",
  "generate_payloads_api_v1_projects__project_id__generate_payloads_post",
  "generate_payloads_async_api_v1_projects__project_id__generate_payloads_async_post",
  "generate_scenario_api_v1_projects__project_id__scenario_from_description_generate_post",
  "generate_scenario_async_api_v1_projects__project_id__gatling_scenarios_generate_async_post",
  "generate_scenario_from_flow_api_v1_projects__project_id__gatling_scenarios_generate_post",
  "generate_slot_feeder_api_v1_projects__project_id__gatling_scenarios__scenario_id__slots__slot__generate_feeder_post",
  "generate_test_types_api_v1_projects__project_id__test_types_generate_post",
  "generate_test_types_async_api_v1_projects__project_id__test_types_generate_async_post",
  "get_action_api_v1_projects__project_id__actions__action_id__get",
  "get_actions_catalog_api_v1_projects__project_id__data_hub_actions_catalog_get",
  "get_active_executions_api_v1_gatling_executions_active_get",
  "get_analytics_dashboard_api_v1_projects__project_id__analytics_validators_dashboard_get",
  "get_assertion_type_api_v1_assertion_types__type_id__get",
  "get_assertion_type_by_name_api_v1_assertion_types_by_name__name__get",
  "get_asyncapi_spec_api_v1_asyncapi_specs__spec_id__get",
  "get_auth_session_api_v1_auth_session_get",
  "get_base_test_type_api_v1_base_test_types__test_type_id__get",
  "get_base_validator_api_v1_base_validators__validator_id__get",
  "get_batch_run_api_v1_test_templates_batch_runs__batch_run_id__get",
  "get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get",
  "get_composition_slot_options_api_v1_projects__project_id__gatling_compositions__composition_id__slots_options_get",
  "get_configuration_api_v1_projects__project_id__gatling_configurations__config_id__get",
  "get_copilot_history_api_v1_projects__project_id__flows__flow_id__copilot_history_get",
  "get_copilot_suggestions_api_v1_projects__project_id__flows__flow_id__copilot_suggestions_get",
  "get_current_principal_api_v1_auth_me_get",
  "get_data_hub_history_api_v1_projects__project_id__data_hub_history_get",
  "get_default_environment_api_v1_projects__project_id__environments_default_get",
  "get_diff_preview_api_v1_projects__project_id__github_diff_preview_get",
  "get_effective_environment_api_v1_projects__project_id__environments__environment_id__effective_get",
  "get_endpoint_binding_metadata_api_v1_openapi_specs__spec_id__endpoints__endpoint_id__binding_metadata_get",
  "get_endpoint_details_api_v1_openapi_specs__spec_id__endpoints__endpoint_id__get",
  "get_environment_api_v1_environments__env_id__get",
  "get_environment_api_v1_projects__project_id__environments__environment_id__get",
  "get_environment_api_v1_projects__project_id__gatling_environments__env_id__get",
  "get_execution_analysis_api_v1_projects__project_id__gatling_executions__execution_id__analysis_get",
  "get_execution_api_logs_api_v1_projects__project_id__executions__execution_id__api_logs_get",
  "get_execution_api_v1_executions__run_id__get",
  "get_execution_api_v1_projects__project_id__executions__execution_id__get",
  "get_execution_api_v1_projects__project_id__gatling_executions__execution_id__get",
  "get_execution_baseline_api_v1_projects__project_id__gatling_executions__execution_id__baseline_get",
  "get_execution_diagnostics_api_v1_projects__project_id__gatling_executions__execution_id__diagnostics_get",
  "get_execution_endpoint_detail_api_v1_projects__project_id__gatling_executions__execution_id__endpoints__name__get",
  "get_execution_endpoint_percentiles_api_v1_projects__project_id__gatling_executions__execution_id__endpoints__name__percentiles_get",
  "get_execution_endpoints_api_v1_projects__project_id__gatling_executions__execution_id__endpoints_get",
  "get_execution_error_detail_api_v1_projects__project_id__gatling_executions__execution_id__errors__error_hash__get",
  "get_execution_error_traces_api_v1_projects__project_id__gatling_executions__execution_id__error_traces_get",
  "get_execution_errors_api_v1_projects__project_id__gatling_executions__execution_id__errors_get",
  "get_execution_history_api_v1_projects__project_id__gatling_ops_history_get",
  "get_execution_logs_api_v1_projects__project_id__gatling_executions__execution_id__logs_get",
  "get_execution_report_asset_api_v1_projects__project_id__gatling_executions__execution_id__report__filepath__get",
  "get_execution_report_index_api_v1_projects__project_id__gatling_executions__execution_id__report_get",
  "get_execution_result_api_v1_projects__project_id__gatling_executions__execution_id__result_get",
  "get_execution_results_api_v1_executions__run_id__results_get",
  "get_execution_trace_detail_api_v1_projects__project_id__gatling_executions__execution_id__traces__trace_id__get",
  "get_execution_traces_api_v1_projects__project_id__gatling_executions__execution_id__traces_get",
  "get_execution_with_results_api_v1_projects__project_id__executions__execution_id__with_results_get",
  "get_expected_outcome_candidates_api_v1_projects__project_id__test_types_expected_outcome_candidates_get",
  "get_failure_patterns_api_v1_projects__project_id__analytics_validators_failure_patterns_get",
  "get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get",
  "get_feeder_audit_api_v1_projects__project_id__gatling_feeders__feeder_id__audit_get",
  "get_feeder_preview_api_v1_projects__project_id__gatling_feeders__feeder_id__preview_get",
  "get_feeder_used_in_api_v1_projects__project_id__gatling_feeders__feeder_id__used_in_get",
  "get_file_content_api_v1_projects__project_id__gatling_compositions__composition_id__file_content_get",
  "get_flaky_validators_api_v1_projects__project_id__analytics_validators_flaky_get",
  "get_flow_api_v1_projects__project_id__flows__flow_id__get",
  "get_flow_generation_status_api_v1_projects__project_id__flows_flow_generation__run_id__status_get",
  "get_flow_result_api_v1_projects__project_id__executions__execution_id__results__result_id__get",
  "get_flow_version_api_v1_projects__project_id__flows__flow_id__versions__version__get",
  "get_gatling_enforcement_api_v1_projects__project_id__validators_gatling_enforcement_get",
  "get_gatling_project_api_v1_projects__project_id__gatling_project_get",
  "get_github_status_api_v1_projects__project_id__github_status_get",
  "get_history_api_v1_projects__project_id__scenario_builder__draft_id__history_get",
  "get_ingest_recipe_api_v1_projects__project_id__production_traffic_recipe_get",
  "get_meta_api_v1_meta_get",
  "get_my_role_api_v1_projects__project_id__team_me_get",
  "get_openapi_spec_api_v1_openapi_specs__spec_id__get",
  "get_production_overlay_api_v1_projects__project_id__gatling_executions__execution_id__production_overlay_get",
  "get_project_api_map_api_v1_projects__project_id__api_map_get",
  "get_project_api_v1_projects__project_id__get",
  "get_project_asyncapi_spec_api_v1_projects__project_id__asyncapi_get",
  "get_project_describe_examples_api_v1_projects__project_id__describe_examples_get",
  "get_project_openapi_spec_api_v1_projects__project_id__openapi_get",
  "get_project_setup_run_api_v1_project_setup_runs__run_id__get",
  "get_project_stats_api_v1_projects__project_id__stats_get",
  "get_project_structure_api_v1_projects__project_id__gatling_compositions__composition_id__project_structure_get",
  "get_recent_activity_api_v1_activity_get",
  "get_resource_usage_api_v1_projects__project_id__gatling_ops_resources_get",
  "get_run_still_api_v1_projects__project_id__scenario_from_description_runs__run_id__stills__still_id__get",
  "get_run_timeline_api_v1_projects__project_id__scenario_from_description_runs__run_id__timeline_get",
  "get_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__get",
  "get_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__get",
  "get_scenario_contract_api_v1_projects__project_id__gatling_scenarios__scenario_id__contract_get",
  "get_scenario_detail_history_api_v1_projects__project_id__gatling_scenarios__scenario_id__copilot_history_get",
  "get_scenario_run_api_v1_projects__project_id__scenario_from_description_runs__run_id__get",
  "get_scenario_slot_options_api_v1_projects__project_id__gatling_scenarios__scenario_id__slots_options_get",
  "get_scenario_version_api_v1_projects__project_id__gatling_scenarios__scenario_id__versions__version__get",
  "get_scheduled_run_api_v1_projects__project_id__gatling_scheduled_runs__scheduled_run_id__get",
  "get_seed_status_api_v1_admin_seed_status_get",
  "get_setup_status_api_v1_projects__project_id__setup_status_get",
  "get_snapshot_api_v1_projects__project_id__production_traffic_snapshots__snapshot_id__get",
  "get_spec_endpoints_api_v1_openapi_specs__spec_id__endpoints_get",
  "get_staleness_api_scenarios__scenario_id__staleness_get",
  "get_suggest_test_types_result_api_v1_projects__project_id__test_types_suggest__run_id__get",
  "get_sync_history_api_v1_projects__project_id__github_history_get",
  "get_telemetry_source_api_v1_projects__project_id__telemetry_source_get",
  "get_template_api_v1_templates__template_id__get",
  "get_test_flow_api_v1_test_flows__flow_id__get",
  "get_test_template_api_v1_test_templates__template_id__get",
  "get_test_type_api_v1_projects__project_id__test_types__test_type_id__get",
  "get_think_time_verdict_api_v1_projects__project_id__gatling_executions__execution_id__think_time_verdict_get",
  "get_threshold_suggestion_api_v1_projects__project_id__analytics_validators_validators__validator_id__threshold_suggestion_get",
  "get_traffic_samples_api_v1_projects__project_id__production_traffic_samples_get",
  "get_validator_accuracy_api_v1_projects__project_id__analytics_validators_validators__validator_id__accuracy_get",
  "get_validator_api_v1_projects__project_id__validators__validator_id__get",
  "get_validator_trend_api_v1_projects__project_id__analytics_validators_validators__validator_id__trend_get",
  "github_webhook_api_v1_projects__project_id__github_webhook_post",
  "global_github_webhook_api_v1_github_webhook_post",
  "guess_recipe_generators_api_v1_projects__project_id__gatling_feeders_generators_guess_post",
  "heartbeat_api_v1_injector_agents_heartbeat_post",
  "ingest_production_traffic_api_v1_ingest_production_traffic_post",
  "instantiate_template_api_v1_projects__project_id__gatling_templates__template_id__instantiate_post",
  "list_actions_api_v1_projects__project_id__actions_get",
  "list_agent_guidance_api_v1_projects__project_id__agent_guidance_get",
  "list_ai_validators_api_v1_base_validators_ai_get",
  "list_api_tokens_api_v1_auth_api_tokens_get",
  "list_applicable_validators_api_v1_projects__project_id__validators_applicable_get",
  "list_assertion_types_api_v1_assertion_types_get",
  "list_asyncapi_specs_api_v1_asyncapi_specs_get",
  "list_base_test_types_api_v1_base_test_types_get",
  "list_base_validators_api_v1_base_validators_get",
  "list_batch_runs_api_v1_test_templates_batch_runs_get",
  "list_compositions_api_v1_projects__project_id__gatling_compositions_get",
  "list_configurations_api_v1_projects__project_id__gatling_configurations_get",
  "list_environments_api_v1_environments_get",
  "list_environments_api_v1_projects__project_id__gatling_environments_get",
  "list_executions_api_v1_executions_get",
  "list_executions_api_v1_projects__project_id__executions_get",
  "list_executions_api_v1_projects__project_id__gatling_executions_get",
  "list_feeders_api_v1_projects__project_id__gatling_feeders_get",
  "list_flow_results_api_v1_projects__project_id__executions__execution_id__results_get",
  "list_flow_versions_api_v1_projects__project_id__flows__flow_id__versions_get",
  "list_flows_api_v1_projects__project_id__flows_get",
  "list_ingest_tokens_api_v1_projects__project_id__production_traffic_tokens_get",
  "list_openapi_specs_api_v1_openapi_specs_get",
  "list_project_asyncapi_specs_api_v1_projects__project_id__asyncapi_specs_get",
  "list_project_environments_api_v1_projects__project_id__environments_get",
  "list_project_openapi_specs_api_v1_projects__project_id__openapi_specs_get",
  "list_project_test_types_api_v1_projects__project_id__test_types_get",
  "list_project_validators_api_v1_projects__project_id__validators_get",
  "list_projects_api_v1_projects_get",
  "list_recipe_generators_api_v1_projects__project_id__gatling_feeders_generators_get",
  "list_results_api_v1_projects__project_id__gatling_results_get",
  "list_saved_runs_api_v1_projects__project_id__gatling_saved_runs_get",
  "list_scenario_runs_api_v1_projects__project_id__scenario_from_description_runs_get",
  "list_scenario_versions_api_v1_projects__project_id__gatling_scenarios__scenario_id__versions_get",
  "list_scenarios_api_v1_projects__project_id__gatling_scenarios_get",
  "list_scheduled_runs_api_v1_projects__project_id__gatling_scheduled_runs_get",
  "list_snapshots_api_v1_projects__project_id__production_traffic_snapshots_get",
  "list_team_members_api_v1_projects__project_id__team_get",
  "list_template_executions_api_v1_projects__project_id__executions_run_templates__template_id__executions_get",
  "list_templates_api_v1_templates_get",
  "list_test_flows_api_v1_test_flows_get",
  "list_test_templates_api_v1_test_templates_get",
  "list_test_type_categories_api_v1_base_test_types_categories_get",
  "list_validator_categories_api_v1_base_validators_categories_get",
  "list_versions_api_v1_test_flows__flow_id__versions_get",
  "liveness_health_get",
  "logout_api_v1_auth_logout_post",
  "merge_flows_route_api_v1_projects__project_id__flows_merge_post",
  "migrate_flows_to_spec_api_v1_projects__project_id__flows_spec_migration_post",
  "pin_execution_as_baseline_api_v1_projects__project_id__gatling_executions__execution_id__baseline_put",
  "preflight_composition_feeders_api_v1_projects__project_id__gatling_compositions__composition_id__feeders_preflight_post",
  "preview_feeder_recipe_api_v1_projects__project_id__gatling_feeders_preview_recipe_post",
  "preview_feeder_snippet_api_v1_projects__project_id__gatling_feeders_preview_snippet_post",
  "preview_flows_spec_migration_api_v1_projects__project_id__flows_spec_migration_preview_post",
  "preview_production_plan_api_v1_projects__project_id__gatling_production_plan_preview_post",
  "preview_redrive_api_v1_projects__project_id__scenario_from_description_runs__run_id__paths__path_index__redrive_preview_get",
  "preview_snapshot_api_v1_projects__project_id__production_traffic_snapshots_preview_post",
  "probe_feeder_against_target_api_v1_projects__project_id__gatling_feeders__feeder_id__probe_post",
  "probe_telemetry_source_api_v1_projects__project_id__telemetry_source_test_post",
  "provision_feeder_accounts_api_v1_projects__project_id__gatling_feeders__feeder_id__provision_post",
  "pull_from_github_api_v1_projects__project_id__github_pull_post",
  "push_to_github_api_v1_projects__project_id__github_push_post",
  "put_telemetry_source_api_v1_projects__project_id__telemetry_source_put",
  "readiness_ready_get",
  "record_change_resolution_api_v1_projects__project_id__flows__flow_id__copilot_changes__change_id__resolution_post",
  "record_change_resolutions_api_v1_projects__project_id__flows__flow_id__copilot_resolutions_post",
  "refine_har_split_api_v1_projects__project_id__har__har_session_id__refine_post",
  "regenerate_feeder_dataset_api_v1_projects__project_id__gatling_feeders__feeder_id__regenerate_post",
  "regenerate_flow_api_v1_projects__project_id__flows__flow_id__regenerate_post",
  "regenerate_scenario_async_api_v1_projects__project_id__gatling_scenarios__scenario_id__regenerate_async_post",
  "regenerate_single_feeder_column_api_v1_projects__project_id__gatling_feeders__feeder_id__regenerate_column_post",
  "relabel_slot_api_v1_projects__project_id__data_hub_scenarios__scenario_id__slots__slot__label_patch",
  "remove_team_member_api_v1_projects__project_id__team__user_id__delete",
  "repin_composition_link_api_v1_projects__project_id__gatling_compositions__composition_id__links__link_id__pin_put",
  "replace_feeder_content_api_v1_projects__project_id__gatling_feeders__feeder_id__content_put",
  "report_job_result_api_v1_injector_agents_jobs__job_id__result_post",
  "resolve_poll_terminals_api_v1_projects__project_id__flows__flow_id__poll_terminals_post",
  "restore_flow_version_api_v1_projects__project_id__flows__flow_id__versions_restore_post",
  "restore_previous_feeder_content_api_v1_projects__project_id__gatling_feeders__feeder_id__restore_previous_post",
  "restore_scenario_version_api_v1_projects__project_id__gatling_scenarios__scenario_id__versions__version__restore_post",
  "restore_version_api_v1_test_flows__flow_id__versions__version__restore_post",
  "retry_execution_api_v1_projects__project_id__executions__execution_id__retry_post",
  "retry_scenario_flow_api_v1_projects__project_id__scenario_from_description_runs__run_id__flows__path_index__retry_post",
  "retry_scenario_path_drive_api_v1_projects__project_id__scenario_from_description_runs__run_id__paths__path_index__retry_drive_post",
  "review_flow_api_v1_projects__project_id__flows__flow_id__copilot_messages_review_post",
  "review_plan_api_v1_projects__project_id__scenario_builder__draft_id__messages_review_post",
  "review_scenario_detail_api_v1_projects__project_id__gatling_scenarios__scenario_id__copilot_messages_review_post",
  "revoke_api_token_api_v1_auth_api_tokens__token_id__delete",
  "revoke_ingest_token_api_v1_projects__project_id__production_traffic_tokens__token_id__delete",
  "save_snapshot_api_v1_projects__project_id__production_traffic_snapshots_post",
  "search_dashboard_api_v1_search_get",
  "seed_builtin_types_api_v1_assertion_types_seed_post",
  "seed_database_api_v1_admin_seed_post",
  "seed_test_types_api_v1_admin_seed_test_types_post",
  "seed_validators_api_v1_admin_seed_validators_post",
  "send_copilot_message_api_v1_projects__project_id__flows__flow_id__copilot_messages_post",
  "send_data_hub_message_api_v1_projects__project_id__data_hub_messages_post",
  "send_message_api_v1_projects__project_id__scenario_builder__draft_id__messages_post",
  "send_scenario_detail_message_api_v1_projects__project_id__gatling_scenarios__scenario_id__copilot_messages_post",
  "set_default_environment_api_v1_environments__env_id__set_default_post",
  "set_default_environment_api_v1_projects__project_id__environments__environment_id__set_default_post",
  "set_project_area_prefixes_api_v1_projects__project_id__api_map_area_prefixes_put",
  "set_saved_run_paused_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__pause_put",
  "set_saved_run_schedule_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__schedule_put",
  "setup_gatling_project_api_v1_projects__project_id__gatling_setup_post",
  "split_har_api_v1_projects__project_id__har__har_session_id__split_post",
  "start_execution_api_v1_executions_post",
  "start_execution_api_v1_projects__project_id__gatling_executions_post",
  "start_self_check_api_v1_projects__project_id__gatling_scenarios__scenario_id__self_check_post",
  "suggest_heuristic_api_v1_projects__project_id__flow_suggestions_heuristic_post",
  "suggest_refined_api_v1_projects__project_id__flow_suggestions_refine_post",
  "suggest_test_types_api_v1_projects__project_id__test_types_suggest_post",
  "suggest_test_types_async_api_v1_projects__project_id__test_types_suggest_async_post",
  "take_run_snapshot_api_v1_projects__project_id__scenario_from_description_runs__run_id__paths__path_index__attempts__attempt__snapshot_get",
  "test_connection_api_v1_projects__project_id__environments__environment_id__test_connection_post",
  "trigger_health_check_api_scenarios__scenario_id__health_check_post",
  "trigger_scheduled_run_api_v1_projects__project_id__gatling_scheduled_runs__scheduled_run_id__run_now_post",
  "update_action_api_v1_projects__project_id__actions__action_id__put",
  "update_agent_guidance_entry_api_v1_projects__project_id__agent_guidance__entry_id__patch",
  "update_assertion_type_api_v1_assertion_types__type_id__put",
  "update_base_test_type_api_v1_base_test_types__test_type_id__put",
  "update_base_validator_api_v1_base_validators__validator_id__put",
  "update_composition_api_v1_projects__project_id__gatling_compositions__composition_id__put",
  "update_composition_slot_bindings_api_v1_projects__project_id__gatling_compositions__composition_id__slot_bindings_put",
  "update_composition_test_type_api_v1_projects__project_id__gatling_compositions__composition_id__test_type_put",
  "update_configuration_api_v1_projects__project_id__gatling_configurations__config_id__put",
  "update_environment_api_v1_environments__env_id__put",
  "update_environment_api_v1_projects__project_id__environments__environment_id__put",
  "update_environment_api_v1_projects__project_id__gatling_environments__env_id__put",
  "update_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__put",
  "update_flow_api_v1_projects__project_id__flows__flow_id__put",
  "update_gatling_project_api_v1_projects__project_id__gatling_project_put",
  "update_project_api_v1_projects__project_id__put",
  "update_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__put",
  "update_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__put",
  "update_scenario_slot_bindings_api_v1_projects__project_id__gatling_scenarios__scenario_id__slot_bindings_put",
  "update_scheduled_run_api_v1_projects__project_id__gatling_scheduled_runs__scheduled_run_id__put",
  "update_step_note_api_v1_projects__project_id__scenario_from_description_runs__run_id__notes__note_id__patch",
  "update_test_flow_api_v1_test_flows__flow_id__put",
  "update_test_template_api_v1_test_templates__template_id__put",
  "update_test_type_api_v1_projects__project_id__test_types__test_type_id__put",
  "update_validator_api_v1_projects__project_id__validators__validator_id__put",
  "upload_asyncapi_spec_api_v1_asyncapi_specs_upload_post",
  "upload_har_api_v1_projects__project_id__har_upload_post",
  "upload_job_results_api_v1_injector_agents_jobs__job_id__results_artifact_post",
  "upload_openapi_spec_api_v1_openapi_specs_upload_post",
  "upload_project_asyncapi_api_v1_projects__project_id__asyncapi_post",
  "upload_project_asyncapi_file_api_v1_projects__project_id__asyncapi_upload_post",
  "upload_project_openapi_api_v1_projects__project_id__openapi_post",
  "upload_project_openapi_file_api_v1_projects__project_id__openapi_upload_post",
  "validate_composition_api_v1_projects__project_id__gatling_compositions__composition_id__validate_post"
] as const satisfies readonly OperationId[];

/** Every WebSocket channel the catalog names (tools and excluded); the compiler checks each against ChannelId. */
export const CATALOG_CHANNEL_IDS = [
  "analysis",
  "batch",
  "describe",
  "execution",
  "flowGeneration",
  "gatlingExecution",
  "gatlingExecutionLive",
  "gatlingFeeder",
  "har",
  "healthCheck",
  "liveView",
  "payloadGen",
  "projectExecution",
  "projectSetup",
  "refine",
  "scenario",
  "testTypes"
] as const satisfies readonly ChannelId[];
