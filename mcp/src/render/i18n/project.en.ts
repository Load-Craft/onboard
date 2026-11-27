// Texts of the tools of module project, English: the key set of project.pl.ts. A key starts with the
// name of a tool of the module (`project_list.`) or with `project.` for a text its tools share.

import type { Entry } from './core.js';

export const projectEn = {
  'project_update_note.header': 'Note {id} updated: {fields}.',
  'project_update_note.unchanged': 'Note {id}: nothing to change, it is already as given.',
  'project_update_note.field.text': 'text',
  'project_update_note.field.scope': 'scope',
  'project_update_note.text': 'text: "{text}"',
  'project_update_note.scope': 'applies to: {scope}',
  'project_update_note.undo.text_only':
    'The undo restores the text only: a note does not go back from a page to a step.',
  'project_update_note.undo.scope':
    'This change cannot be undone from the log: a note does not go back from a page to a step.',
  'project_update_note.undo.withheld':
    'The previous text held a secret and is not kept, so this change cannot be undone from the log.',
  'project_set_apimap.manual': 'API areas set by hand: {prefixes}.',
  'project_set_apimap.counts': 'Prefixes: {count}, areas in the map: {areas}.',
  'project_set_apimap.detected':
    'API areas are the ones LoadCraft detects again; areas in the map: {areas}.',
  'project_set_apimap.empty': 'Prefixes with no operation: {prefixes}',
  'project_set_apimap.unchanged': 'The API areas are already these prefixes; nothing changed.',
  'project_set_apimap.unchanged_detected':
    'The API areas are already the detected ones; nothing changed.',
  'project_set_apimap.not_undoable':
    'The previous prefixes are not kept (one has a comma in it, or holds a secret), so this change cannot be undone from the log.',
  'project_set_active_docs.kind.openapi': 'OpenAPI',
  'project_set_active_docs.kind.asyncapi': 'AsyncAPI',
  'project_set_active_docs.done':
    '{kind} documentation v{version} "{title}" is now the active one.',
  'project_set_active_docs.done.name_less':
    '{kind} documentation v{version} is now the active one.',
  'project_set_active_docs.already':
    '{kind} documentation v{version} "{title}" is already the active one; nothing changed.',
  'project_set_active_docs.already.name_less':
    '{kind} documentation v{version} is already the active one; nothing changed.',
  'project_set_active_docs.not_undoable':
    'No version was active before, so this change cannot be undone from the log.',
  'project_update.not_undoable':
    'The previous value held a secret and is not kept, so this change cannot be undone from the log.',
  'project_update.header': 'Project "{name}" updated: {fields}.',
  'project_update.unchanged':
    'Project "{name}": nothing to change, the name and the description are already as given.',
  'project_update.field.name': 'name',
  'project_update.field.description': 'description',
  'project_update.name': 'name: "{was}" -> "{now}"',
  'project_update.description': 'description: "{now}"',
  'project_list_team.header': { one: '{count} member:', other: '{count} members:' },
  'project_list_team.empty': 'This project has no members.',
  'project_list_team.since': 'since {day}',
  'project_list_team.added_by': 'added by {id}',
  'project_list_team.more': 'showing the first {shown} of {total} members',
  'project_list_team.me': 'Your role in this project: {role} ({id}); you can {can}.',
  'project_list_team.can_admin': 'administer',
  'project_list_team.can_edit': 'edit',
  'project_list_team.can_execute': 'run tests',
  'project_list_team.can_read': 'only read',
  'project_get_http_settings.header': 'HTTP settings of the project',
  'project_get_http_settings.base_url': 'base URL: {url}',
  'project_get_http_settings.no_base_url': 'base URL: not set',
  'project_get_http_settings.headers':
    'default headers ({count}): {names} (values are never shown)',
  'project_get_http_settings.no_headers':
    'default headers of the project: none (headers of the environments: project_get_envs)',
  'project_get_http_settings.protocol': 'protocol: {parts}',
  'project_get_http_settings.request_timeout': 'request timeout {ms} ms',
  'project_get_http_settings.connection_timeout': 'connection timeout {ms} ms',
  'project_get_http_settings.max_connections': 'max connections per host {count}',
  'project_get_http_settings.user_agent': 'user agent "{value}"',
  'project_get_http_settings.warm_up': 'warm-up {url}',
  'project_get_http_settings.proxy': 'proxy {type}:{port}',
  'project_get_http_settings.options_on': 'options on: {names}',
  'project_get_http_settings.pauses':
    'pauses: {distribution}, think time {think} ms, deviation {deviation}%; polls up to {polls} times',
  'project_get_http_settings.capture':
    'probes: {probes}; request bodies captured: {bodies} (sample {sample}%)',
  'project_get_http_settings.limits':
    'throttle steps: {throttle}, global assertions: {assertions}, SLO tier: {tier}',
  'project_get_http_settings.counts':
    'scenarios: {scenarios}, configurations: {configurations}, feeders: {feeders}',
  'project_get_http_settings.on': 'on',
  'project_get_http_settings.off': 'off',
  'project_get_apimap.header': {
    one: 'API map "{title}" ({rule}): {count} area, operations: {operations}',
    other: 'API map "{title}" ({rule}): {count} areas, operations: {operations}',
  },
  'project_get_apimap.rule.detected': 'areas detected',
  'project_get_apimap.rule.manual': 'areas set by hand',
  'project_get_apimap.operations': { one: '{count} operation', other: '{count} operations' },
  'project_get_apimap.more_operations': '(+{count} more)',
  'project_get_apimap.sign_in': '(sign-in)',
  'project_get_apimap.no_prefix': '(no prefix)',
  'project_get_apimap.more': 'showing the first {shown} of {total} areas',
  'project_get_apimap.outside': {
    one: '{count} operation is under no area.',
    other: '{count} operations are under no area.',
  },
  'project_get_apimap.empty_prefixes': 'Saved prefixes with no operation: {prefixes}',
  'project_get_endpoints.header': { one: '{count} endpoint:', other: '{count} endpoints:' },
  'project_get_endpoints.header_filtered': '{count} of {total} endpoints match:',
  'project_get_endpoints.none': 'This documentation has no endpoints.',
  'project_get_endpoints.no_match': 'No endpoint matches; the documentation has {total}.',
  'project_get_endpoints.more': 'showing the first {shown} of {count} endpoints',
  'project_get_endpoints.kind': 'endpoint',
  'project_get_endpoints.operation_id': 'operationId: {value}',
  'project_get_endpoints.tags': 'tags: {names}',
  'project_get_endpoints.deprecated': 'deprecated',
  'project_get_endpoints.parameters': 'parameters ({count}):',
  'project_get_endpoints.required': 'required',
  'project_get_endpoints.body': 'body:',
  'project_get_endpoints.responses': 'responses:',
  'project_get_endpoints.security': 'security: {names}',
  'project_get_endpoints.array_of': 'array of {type}',
  'project_get_endpoints.bindings': 'bindings:',
  'project_get_endpoints.bindings_unavailable': 'bindings: unavailable',
  'project_get_endpoints.success_statuses': 'success statuses: {statuses}',
  'project_get_endpoints.error_statuses': 'declared error statuses: {statuses}',
  'project_get_endpoints.response_schemas': 'response schemas: {shapes}',
  'project_get_endpoints.assertions': 'assertions:',
  'project_get_docs.header': '{kind} documentation "{title}" v{version}{flags}',
  'project_get_docs.none': 'This project has no {kind} documentation.',
  'project_get_docs.versions': {
    one: '{count} {kind} version:',
    other: '{count} {kind} versions:',
  },
  'project_get_docs.endpoints': { one: '{count} endpoint', other: '{count} endpoints' },
  'project_get_docs.channels': { one: '{count} channel', other: '{count} channels' },
  'project_get_docs.operations': { one: '{count} operation', other: '{count} operations' },
  'project_get_docs.uploaded': 'uploaded {day}',
  'project_get_docs.protocols': 'protocols: {names}',
  'project_get_docs.source': 'source: {url}',
  'project_get_docs.flag.active': 'active',
  'project_get_docs.flag.current': 'current',
  'project_get_docs.flag.selected': 'selected',
  'project_get_docs.more': 'showing the first {shown} of {total} versions',
  'project_get_envs.header': {
    one: '{count} environment:',
    other: '{count} environments:',
  },
  'project_get_envs.empty': 'This project has no environments yet.',
  'project_get_envs.one': 'Environment {name}:',
  'project_get_envs.one_effective': 'Environment {name}, inherited values resolved:',
  'project_get_envs.flag.default': 'default',
  'project_get_envs.flag.current': 'current',
  'project_get_envs.flag.inactive': 'inactive',
  'project_get_envs.flag.protected': 'protected',
  'project_get_envs.flag.protected_caps': 'protected: {vu} users, {rps} req/s',
  'project_get_envs.frontend': 'frontend: {url}',
  'project_get_envs.headers': 'headers: {names}',
  'project_get_envs.variables': 'variables: {names}',
  'project_get_envs.auth': 'auth: {type}',
  'project_get_envs.auth_none': 'auth: none',
  'project_get_envs.auth_set': 'configured',
  'project_get_envs.auth_keys': 'auth: {type} ({keys})',
  'project_get_envs.inherited': 'inherited: {fields}',
  'project_get_envs.inherited_mark': '(inherited)',
  'project_get_envs.names_more': '(+{count} more)',
  'project_get_envs.parent': 'inherits from {id}',
  'project_get_envs.more': 'showing the first {shown} of {total} environments',
  'project_get_envs.footer':
    'Values of headers, variables and authentication are never shown, only their names.',
  'project_list_notes.header': {
    one: '{count} note about the project:',
    other: '{count} notes about the project:',
  },
  'project_list_notes.empty':
    'No notes about this project yet: the agent saves them while it walks the application.',
  'project_list_notes.scope.url_path': 'page {at}',
  'project_list_notes.scope.plan_step': 'step "{at}"',
  'project_list_notes.scope.project': 'project',
  'project_list_notes.more': 'showing the first {shown} of {total} notes',
  // project_get_activity
  'project_get_activity.running': {
    one: '{count} run in progress:',
    other: '{count} runs in progress:',
  },
  'project_get_activity.running.none': 'No run in progress.',
  'project_get_activity.abandoned': '  {run} is not driven by the server any more (abandoned).',
  'project_get_activity.events': { one: '{count} recent event:', other: '{count} recent events:' },
  'project_get_activity.events.none': 'No recent activity.',
  'project_get_activity.type.project_created': 'project created',
  'project_get_activity.type.scenario_created': 'flow created',
  'project_get_activity.type.execution_started': 'run started',
  'project_get_activity.type.execution_completed': 'run completed',
  'project_get_activity.type.execution_failed': 'run failed',
  'project_get_activity.type.other': 'event',
  'project_get_activity.sla.passed': 'met',
  'project_get_activity.sla.failed': 'NOT met',
  'project_get_activity.sla.refused': 'not judged',
  // project_list
  'project_list.header': { one: '{count} project:', other: '{count} projects:' },
  'project_list.none': 'No project matches.',
  'project_list.more': '  … {shown} of {total} projects listed; raise limit to see more',
  'project_list.current': '* the project this workspace is bound to',
  'project_list.counts': '{flows} flows, {types} test types, {validators} validators',
  'project_list.active': 'active',
  'project_list.inactive': 'inactive',
  'project_list.type.api': 'API',
  'project_list.type.frontend': 'frontend',
  'project_list.type.both': 'API and frontend',
  'project_list.search': {
    one: '{count} hit for "{query}":',
    other: '{count} hits for "{query}":',
  },
  'project_list.search.none': 'Nothing found for "{query}".',
  'project_list.search.limit':
    '  the limit of {limit} hits was reached: more may exist, raise limit or narrow the text',
  'project_list.hit.page': 'page',
  'project_list.hit.project': 'project',
  'project_list.hit.scenario': 'flow or scenario',
  'project_list.hit.execution': 'run',
  'project_list.hit.other': 'other',
  // project_save_member
  'project_save_member.card.title': 'Give {user_id} the role {role}',
  'project_save_member.card.add': 'adds the person {user_id} to this project as {role}',
  'project_save_member.card.change': 'changes the role of {user_id} from {from} to {role}',
  'project_save_member.card.role.owner': 'owner: full control of the project, its team included',
  'project_save_member.card.role.editor':
    'editor: changes the project and runs tests; no control of the team',
  'project_save_member.card.role.viewer': 'viewer: reads only',
  'project_save_member.card.undo.added': 'project_delete with kind member removes the person again',
  'project_save_member.card.undo.changed': 'project_save_member with the previous role {previous}',
  'project_save_member.unchanged': '{user_id} already has the role {role}; nothing to change.',
  'project_save_member.added': 'Added {user_id} to the project as {role}.',
  'project_save_member.changed': 'The role of {user_id} is now {role} (was {previous}).',
  'project_save_member.undo.removal':
    'To undo: project_delete with kind member removes them (it asks for consent).',
  'project_save_member.undo.role':
    'To undo: project_save_member with the role {previous} (it asks for consent again).',
  'project_save_member.undo.withheld':
    'No undo is kept: the previous role is not one of the three.',
  'project_save_member.undo.none': 'Nothing to undo.',
  // project_set_http_settings
  'error.project_file_changed.message':
    'The file {file} changed after the card was made, so nothing was sent.',
  'error.project_file_changed.hint': 'Call the tool again to get a card for the file as it is now.',
  'project_set_http_settings.none': 'none',
  'project_set_http_settings.card.title': 'Set the HTTP settings of generated tests',
  'project_set_http_settings.card.created':
    'the project has no HTTP settings yet: they are created with the defaults of LoadCraft and the values below',
  'project_set_http_settings.card.base_url': 'base URL: {from} -> {to}',
  'project_set_http_settings.card.protocol': '{key}: {from} -> {to}',
  'project_set_http_settings.card.headers':
    'default headers: {count} from {file} ({size} bytes, sha256 {sha}): {names}; the values are never shown',
  'project_set_http_settings.card.headers_replace':
    'they replace the default headers now set ({current})',
  'project_set_http_settings.card.headers_replace_unknown':
    'they replace the default headers now set',
  'project_set_http_settings.card.stays': 'the rest of the settings stays as it is',
  'project_set_http_settings.card.undo.values':
    'project_set_http_settings with the previous base URL and options (header values are not kept: put them in the env file again)',
  'project_set_http_settings.card.undo.created':
    'the settings stay once created; change them with project_set_http_settings',
  'project_set_http_settings.unchanged':
    'The HTTP settings are already as given; nothing to change.',
  'project_set_http_settings.done': 'HTTP settings saved: {parts}.',
  'project_set_http_settings.part.base_url': 'base URL',
  'project_set_http_settings.part.protocol': 'protocol options',
  'project_set_http_settings.part.headers': 'default headers',
  'project_set_http_settings.base_url_now': 'base URL now: {url}',
  'project_set_http_settings.protocol_now': 'options now: {options}',
  'project_set_http_settings.headers_now': 'default headers set: {count} ({names})',
  'project_set_http_settings.undo.values':
    'To undo: project_set_http_settings with the previous values (it asks for consent again).',
  'project_set_http_settings.undo.withheld':
    'No undo is kept: a previous value would carry a secret.',
  'project_set_http_settings.undo.none': 'No undo is kept for this change.',
  // project_disconnect_telemetry
  'project_disconnect_telemetry.no_host': 'no address',
  'project_disconnect_telemetry.card.title': 'Disconnect the log server',
  'project_disconnect_telemetry.card.server':
    'removes the connection of the project to the log server "{label}" ({host})',
  'project_disconnect_telemetry.card.tools': {
    one: '{count} tool of the server is enabled for the project; it stops being available',
    other: '{count} tools of the server are enabled for the project; they stop being available',
  },
  'project_disconnect_telemetry.card.stays': 'the server itself and the data on it are not touched',
  'project_disconnect_telemetry.card.undo':
    'project_connect_telemetry connects it again; its credentials are needed, none are kept',
  'project_disconnect_telemetry.none':
    'No log server is connected to the project; nothing to disconnect.',
  'project_disconnect_telemetry.done': 'Disconnected the log server "{label}" ({host}).',
  'project_disconnect_telemetry.again':
    'To connect it again: project_connect_telemetry (its credentials are needed; none are kept).',
} as const satisfies Readonly<Record<string, Entry>>;
