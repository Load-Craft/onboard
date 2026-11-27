// Texts of the tools of module scenario, English: the key set of scenario.pl.ts. A key starts with the
// name of a tool of the module (`scenario_list.`) or with `scenario.` for a text its tools share.

import type { Entry } from './core.js';

export const scenarioEn = {
  'scenario_set_composition_type.done': '"{name}" now runs a {type} (previous: {previous}).',
  'scenario_set_composition_type.done_new': '"{name}" now runs a {type}.',
  'scenario_set_composition_type.unchanged': '"{name}" already runs this {type}; nothing changed.',
  'scenario_set_composition_type.data_ok': 'Every dataset already has the rows the new type needs.',
  'scenario_set_composition_type.grow':
    'Data to grow: {scenario}: {dataset} has {rows} rows, {required} needed.',
  'scenario_set_composition_type.basis_peak':
    'a {strategy} dataset is sized by twice the peak of concurrent sessions, not by the number of users',
  'scenario_set_composition_type.basis_rate':
    'a {strategy} dataset is sized by the arrival rate times the duration times a safety margin, not by the number of users',
  'scenario_set_composition_type.refusal': 'LoadCraft sized no rows for it: {reason}',
  'scenario_set_composition_type.no_previous':
    'The composition had no test type before, so this change cannot be undone from the log.',
  'scenario_set_composition_type.unknown_previous':
    'The previous test type is not one this tool sets, so this change cannot be undone from the log.',
  'error.scenario_composition_spec_refused.message':
    'LoadCraft refused the parameters of the test type: {detail}',
  'error.scenario_composition_spec_refused.hint':
    'Nothing was changed. Every kind needs target_users and duration_seconds (positive whole numbers); optional for all: ramp_up_seconds, think_time_ms, max_duration_seconds. By kind: load_test ramp_down_seconds; stress_test stress_multiplier (above 1); spike_test spike_users (required) and spike_duration_seconds; breakpoint_test step_users, step_duration_seconds, max_steps; capacity_test target_rps. Other fields are refused. Fix the parameters and call again.',
  'scenario_set_composition_type.more': 'showing the first {shown} of {total} datasets',
  'scenario_update_pins.done': {
    one: '{count} member of "{name}" moved to the current version of its scenario:',
    other: '{count} members of "{name}" moved to the current versions of their scenarios:',
  },
  'scenario_update_pins.member': '- {scenario}: {from} -> {to}',
  'scenario_update_pins.more': 'showing the first {shown} of {total} members',
  'scenario_update_pins.still': '{count} members still drift.',
  'scenario_update_pins.unpinned': {
    one: '{count} member is pinned to no version: it follows the current version of its scenario by itself.',
    other:
      '{count} members are pinned to no version: they follow the current versions of their scenarios by themselves.',
  },
  'scenario_update_pins.same_content': {
    one: '{count} member is pinned to an older version number, but its content is the current one: drift is decided by content, not by the number.',
    other:
      '{count} members are pinned to older version numbers, but their content is the current one: drift is decided by content, not by the numbers.',
  },
  'scenario_update_pins.none': 'No member of "{name}" has drifted; nothing changed.',
  'scenario_restore_version.done':
    '{name}: v{version} restored as v{new} (v{previous} was the current one); the self-check is cleared.',
  'scenario_restore_version.nothing_restored': '(nothing restored)',
  'scenario_restore_version.unchanged':
    '{name}: v{version} is already the current version; nothing changed.',
  'scenario.check_state.none': 'never ran',
  'scenario.check_state.stale': '{status} on v{checked}, the scenario is v{current} now',
  'scenario.check_state.pending': 'queued',
  'scenario.check_state.running': 'running',
  'scenario.check_state.passed': 'passed',
  'scenario.check_state.failed': 'failed',
  'scenario.check_state.target_unreachable': 'the target was unreachable',
  'scenario.check_state.waiting_for_data': 'waiting for data',
  'scenario.check_state.not_admitted': 'not admitted',
  'scenario.check_state.skipped_protected_environment': 'skipped, the environment is protected',
  'scenario.check_state.disabled': 'disabled',
  'scenario.check_state.interrupted': 'interrupted',
  'scenario.check_state.goal_step_missing': 'the goal step is missing',
  'scenario.check_state.repairing': 'repairing',
  'scenario.check_state.passed_after_repair': 'passed after a repair',
  'scenario_list.header': { one: '{count} scenario:', other: '{count} scenarios:' },
  'scenario_list.empty': 'This project has no scenarios yet.',
  'scenario_list.from_flow': 'from flow {flow} v{version}',
  'scenario_list.older_generator': 'built with an older generator, rebuild it',
  'scenario_list.no_flow': 'no source flow',
  'scenario_list.check': 'self-check: {state}',
  'scenario_list.more': 'showing the first {shown} of {total} scenarios',
  'scenario_get.none': 'none',
  'scenario_get.inactive': 'inactive',
  'scenario_get.from_flow': 'from flow {flow} v{version}',
  'scenario_get.no_flow': 'no source flow',
  'scenario_get.older_generator': 'built with an older generator',
  'scenario_get.check': 'self-check: {state}',
  'scenario_get.check_old': 'self-check: {state} on v{checked}, the scenario is v{current} now',
  'scenario_get.check.none': 'self-check: never ran',
  'scenario_get.failure': 'failed at {where}: {message}',
  'scenario_get.missing_slots': 'slots without data: {slots}',
  'scenario_get.repairs': { one: '{count} automatic repair', other: '{count} automatic repairs' },
  'scenario_get.slots': { one: '{count} data slot:', other: '{count} data slots:' },
  'scenario_get.no_slots': 'no data slots',
  'scenario_get.binding.bound': 'bound',
  'scenario_get.binding.stale': 'binding is stale',
  'scenario_get.binding.unbound': 'not bound',
  'scenario_get.contract': 'variable contract:',
  'scenario_get.contract.inputs': 'needs: {names}',
  'scenario_get.contract.exports': 'exports: {names}',
  'scenario_get.contract.session': 'session variables: {names}',
  'scenario_get.contract_unavailable': 'variable contract: unavailable',
  'scenario_get.drift': 'drift: {score} (0 fresh, 1 stale), checked {checked}',
  'scenario_get.drift.none': 'drift: not checked yet',
  'scenario_get.drift.unavailable': 'drift: unavailable',
  'scenario_get.artifact': 'stored artifact (secrets masked):',
  'scenario_get.artifact_cut': '… artifact cut',
  'scenario_get.artifact_hidden':
    'stored artifact hidden: its format cannot be masked ({bytes} bytes)',
  'scenario_get.artifact_none': 'no stored artifact',
  'scenario_get_versions.header': {
    one: '{count} version of scenario {id}, newest first:',
    other: '{count} versions of scenario {id}, newest first:',
  },
  'scenario_get_versions.one': 'Scenario {id}: {line}',
  'scenario_get_versions.empty': 'This scenario has no saved versions.',
  'scenario_get_versions.cut': 'variant cut after a block',
  'scenario_get_versions.no_snapshot': 'no artifact snapshot, cannot be restored',
  'scenario_get_versions.more': 'showing the newest {shown} of {total} versions',
  'scenario_get_copilot_history.header.scenario': {
    one: '{count} message of the copilot of scenario {id}:',
    other: '{count} messages of the copilot of scenario {id}:',
  },
  'scenario_get_copilot_history.header.planner': {
    one: '{count} message of the traffic-split planner {id}:',
    other: '{count} messages of the traffic-split planner {id}:',
  },
  'scenario_get_copilot_history.header_cut.scenario':
    'the latest {shown} of {total} messages of the copilot of scenario {id}:',
  'scenario_get_copilot_history.header_cut.planner':
    'the latest {shown} of {total} messages of the traffic-split planner {id}:',
  'scenario_get_copilot_history.empty.scenario':
    'The copilot of this scenario has no saved conversation.',
  'scenario_get_copilot_history.empty.planner': 'This planner draft has no saved conversation.',
  'scenario_get_copilot_history.role.user': 'you',
  'scenario_get_copilot_history.role.other': '{role}',
  'scenario_get_copilot_history.actions': 'proposed: {kinds}',
  'scenario_get_copilot_history.proposal': {
    one: 'proposed a split of {count} flow',
    other: 'proposed a split of {count} flows',
  },
  'scenario_get_copilot_history.chips': {
    one: '{count} quick reply',
    other: '{count} quick replies',
  },
  'scenario_export.saved': 'Exported the Gatling project of scenario {id} as a ZIP ({kb} KB).',
  'scenario_export.omitted':
    'The dataset files are not in it, on purpose: they hold real values and are never put into an export.',
  'scenario_export.conf_unread':
    'Its application.conf could not be read here: add the dataset files that file names and set the environment variables it reads.',
  'scenario_export.add_datasets': {
    one: 'Add {count} dataset file in {folder} (names and columns only; the values are yours):',
    other: 'Add {count} dataset files in {folder} (names and columns only; the values are yours):',
  },
  'scenario_export.folder_unknown': 'the folder of application.conf',
  'scenario_export.role.auth': '(sign-in accounts)',
  'scenario_export.columns': 'columns {names}',
  'scenario_export.columns_unknown': 'columns not known',
  'scenario_export.set_env': {
    one: 'Set {count} environment variable (your own value):',
    other: 'Set {count} environment variables (your own values):',
  },
  'scenario_export.nothing_to_add':
    'The configuration reads no dataset file and no environment variable: nothing to add.',
  'scenario_export.recipe': 'steps to start it: {path}',
  'scenario_export.file_title': 'Running the exported scenario {id}',
  'scenario_export.file_steps': 'Then build and run the project from its folder:',
  'scenario_export.file_readme':
    "The README.txt inside the ZIP is the backend's and says only how to build; this file says what to bring first.",
  'scenario_export.ignored': 'The folder is ignored by git; an earlier export is never replaced.',
  'scenario_export.open': 'open: {path}',
  'scenario_get_templates.header': {
    one: '{count} scenario template:',
    other: '{count} scenario templates:',
  },
  'scenario_get_templates.empty': 'LoadCraft lists no scenario templates.',
  'scenario_get_templates.line': '{name} {id} {category}, {difficulty}, scenarios: {scenarios}',
  'scenario_get_templates.about': 'about: {description}',
  'scenario_get_templates.more': 'showing the first {shown} of {count}',
  'scenario_get_templates.kind': 'template',
  'scenario_get_templates.none': 'none',
  'scenario_get_templates.one.header': 'Template {name} {id}: {category}, {difficulty}',
  'scenario_get_templates.one.tags': 'tags: {tags}',
  'scenario_get_templates.one.scenarios': 'Scenarios ({count}):',
  'scenario_get_templates.one.scenario': '{name} needs: {inputs}; gives: {outputs}',
  'scenario_get_templates.one.files': 'Data files ({count}):',
  'scenario_get_templates.one.file': '{name} columns: {columns}',
  'scenario_get_templates.draft': 'Draft composition',
  'scenario_get_templates.draft.name': 'name: {name}',
  'scenario_get_templates.draft.load': 'load: {type}, {users} users, {seconds} s',
  'scenario_get_templates.draft.sudden':
    'Warning: all {users} users start without a ramp; such a jolt can overload a small or local environment before the test measures anything. Check the load before you save the composition.',
  'scenario_get_templates.draft.mix': 'mix: {mix}',
  'scenario_get_templates.draft.mix_note':
    'The mix weights split the traffic between the scenarios (each virtual user runs one of them, in proportion); they are not an order and pass no value from one scenario to the next: a scenario that needs a value another one produces gets it from its own data.',
  'scenario_get_templates.draft.thresholds': 'thresholds: {thresholds}',
  'scenario.part.none': 'none',
  'scenario.part.unavailable': 'unavailable (LoadCraft answered {status})',
  'scenario_list_compositions.header': {
    one: '{count} composition:',
    other: '{count} compositions:',
  },
  'scenario_list_compositions.header_status': {
    one: '{count} composition with status {status}:',
    other: '{count} compositions with status {status}:',
  },
  'scenario_list_compositions.empty': 'This project has no compositions yet.',
  'scenario_list_compositions.empty_status':
    'This project has no compositions with status {status}.',
  'scenario_list_compositions.members': { one: '{count} member', other: '{count} members' },
  'scenario_list_compositions.enabled': '{count} enabled',
  'scenario_list_compositions.invalid': 'last check failed',
  'scenario_list_compositions.drift': 'members drifted',
  'scenario_list_compositions.more': 'showing the first {shown} of {total} compositions',
  'scenario_get_composition.members': { one: '{count} member:', other: '{count} members:' },
  'scenario_get_composition.share': '{percent}% of the traffic',
  'scenario_get_composition.test_type': 'test type: {type}{params}',
  'scenario_get_composition.no_test_type': 'test type: not set',
  'scenario_get_composition.pinned': 'pinned v{pinned}',
  'scenario_get_composition.drifted':
    'pinned v{pinned}, the scenario changed since (v{current} now)',
  'scenario_get_composition.same_content':
    'pinned v{pinned}, the scenario is v{current} with the same content',
  'scenario_get_composition.off': 'off',
  'scenario_get_composition.own_injection': 'own injection',
  'scenario_get_composition.datasets': { one: '{count} dataset', other: '{count} datasets' },
  'scenario_get_composition.load': 'load profile: {profile}',
  'scenario_get_composition.load_cut': '… load profile cut',
  'scenario_get_composition.load_hidden':
    'load profile hidden: its format cannot be masked ({bytes} bytes)',
  'scenario_get_composition.no_headers': 'default headers: none',
  'scenario_get_composition.headers': 'default headers: {names} (values never shown)',
  'scenario_get_composition.pauses': 'pauses: {distribution}, think time {think}',
  'scenario_get_composition.pauses_members':
    'pauses: {distribution}, think time set by each member',
  'scenario_get_composition.no_check': 'last check: none stored',
  'scenario_get_composition.check_valid': 'last check ({at}): valid',
  'scenario_get_composition.check_valid_nodate': 'last check: valid',
  'scenario_get_composition.check_valid_warnings': 'last check ({at}): valid, {count} warnings',
  'scenario_get_composition.check_valid_warnings_nodate': 'last check: valid, {count} warnings',
  'scenario_get_composition.check_invalid_nodate': 'last check: not valid',
  'scenario_get_composition.check_invalid': 'last check ({at}): not valid',
  'scenario_get_composition.error': 'error (LoadCraft): {text}',
  'scenario_get_composition.warning': 'warning (LoadCraft): {text}',
  'scenario_get_composition.missing_feeders': 'bound datasets missing: {names}',
  'scenario_save.created': 'scenario "{name}" created, empty: no script yet',
  'scenario_save.saved': 'scenario "{name}" saved',
  'scenario_save.unchanged': 'scenario "{name}": the values are the ones it has; nothing changed.',
  'scenario_save.change.name': '  name: "{was}" → "{now}"',
  'scenario_save.change.tags': '  tags: {was} → {now}',
  'scenario_save.change.active': '  active: {was} → {now}',
  'scenario_save.change.slo': '  SLO thresholds: {was} → {now}',
  'scenario_save.slo.inherited': "the project's",
  'scenario_save.slo.stock': 'standard',
  'scenario_save.slo.own': 'own ({list})',
  'scenario_save.tags.none': '(none)',
  'scenario_save.yes': 'yes',
  'scenario_save.no': 'no',
  'scenario_save.undo':
    '→ undo: scenario_save with the previous values (a changed name makes another version)',
  'scenario_save.undo.none':
    'no undo: a previous tag with a comma cannot be written back; set the tags again by hand',
  'scenario_save.undo.created': '→ undo: delete the new scenario {id} (the user decides)',
  'scenario_save.refuse.no_fields':
    'give at least one of name, tags, is_active, slo_thresholds, slo_from_project',
  'scenario_save.refuse.slo_conflict':
    'slo_thresholds and slo_from_project: true exclude each other',
  'scenario_save.refuse.too_many_tags': 'at most 20 tags',
  'scenario_save.refuse.active_on_create':
    'is_active applies to a scenario that exists: give scenario_id',
  'scenario_save.refuse.slo_from_project_on_create':
    'slo_from_project applies to a scenario that exists: give scenario_id',
  'error.scenario_save_refused.message': 'Nothing was saved: {reason}.',
  'error.scenario_save_refused.hint': 'Change the arguments and call again; nothing was sent.',
  // scenario_delete
  'scenario_delete.card.title.scenario': 'Delete scenario "{name}"',
  'scenario_delete.card.title.composition': 'Delete composition "{name}"',
  'scenario_delete.card.item.scenario': 'the scenario {id} with all its versions and baselines',
  'scenario_delete.card.item.composition':
    'the composition {id} with its settings and its member links',
  'scenario_delete.card.versions': {
    one: 'its {count} saved version goes with it',
    other: 'its {count} saved versions go with it',
  },
  'scenario_delete.card.versions_unknown':
    'its saved versions go with it (the number could not be read)',
  'scenario_delete.card.compositions': {
    one: 'it leaves {count} composition (the composition stays): {names}',
    other: 'it leaves {count} compositions (they stay): {names}',
  },
  'scenario_delete.card.compositions_none': 'no composition contains it',
  'scenario_delete.card.compositions_unknown':
    'the compositions that contain it could not be read; it leaves all of them',
  'scenario_delete.card.members': {
    one: 'its {count} member scenario stays: {names}',
    other: 'its {count} member scenarios stay: {names}',
  },
  'scenario_delete.card.members_none': 'it has no member scenarios',
  'scenario_delete.card.stays.scenario':
    'stay: past runs and their results, the datasets, the flow it was made from',
  'scenario_delete.card.stays.composition':
    'stay: the scenarios, past runs and their results, the datasets',
  'scenario_delete.card.undo': 'it is deleted for good; make a new one from its flow',
  'scenario_delete.done.scenario': 'Scenario "{name}" deleted ({count}).',
  'scenario_delete.done.composition': 'Composition "{name}" deleted ({count}).',
  'scenario_delete.stays.scenario':
    'Past runs, the datasets and the flow stay. This cannot be undone.',
  'scenario_delete.stays.composition':
    'The member scenarios, past runs and the datasets stay. This cannot be undone.',
  'scenario_get_composition_code.header': {
    one: 'The generated Gatling project has {count} file:',
    other: 'The generated Gatling project has {count} files:',
  },
  'scenario_get_composition_code.empty': 'The generated Gatling project has no files.',
  'scenario_get_composition_code.more': 'showing the first {shown} of {total} files',
  'scenario_get_composition_code.hint':
    'Pass path to read one of these files; secrets in it are masked.',
  'scenario_get_composition_code.file_header': '{path} ({language}):',
  'scenario_get_composition_code.hidden':
    'file hidden: its format cannot be masked ({bytes} bytes)',
  'scenario_get_composition_code.cut': '… file cut',
  'scenario_check_composition.valid': 'Composition {id} passes its check (checked {at}).',
  'scenario_check_composition.invalid': 'Composition {id} does not pass its check (checked {at}).',
  'scenario_check_composition.authoring': 'It is valid as written.',
  'scenario_check_composition.shares': '{members} members, {percent}% of the traffic in all.',
  'scenario_check_composition.issues': 'issues: {errors} errors, {warnings} warnings',
  'scenario_check_composition.no_issues': 'No issues between the members.',
  'scenario_check_composition.error': 'error (LoadCraft)',
  'scenario_check_composition.warning': 'warning (LoadCraft)',
  'scenario_check_composition.step': 'step {n}',
  'scenario_check_composition.variable': 'variable {name}',
  'scenario_check_composition.suggestion': 'try: {text}',
  'scenario_check_composition.more': '… and {count} more issues',
  'scenario_check_composition.drift': {
    one: '{count} member drifted from its scenario:',
    other: '{count} members drifted from their scenarios:',
  },
  'scenario_check_composition.versions':
    'pinned v{pinned}, the scenario changed since (v{current} now)',
  'scenario_check_composition.missing_feeders': 'bound datasets missing: {names}',
  'scenario_save_composition.card.title': 'Save composition "{name}"',
  'scenario_save_composition.card.create': 'a new composition "{name}"',
  'scenario_save_composition.card.rename': 'rename: "{was}" → "{now}"',
  'scenario_save_composition.card.member.added': 'add {name}: {now}%',
  'scenario_save_composition.card.member.removed': 'remove {name} (was {was}%)',
  'scenario_save_composition.card.member.changed': '{name}: {was}% → {now}%',
  'scenario_save_composition.card.member.same': '{name}: {now}% (as it is)',
  'scenario_save_composition.card.more': '… and {count} more members',
  'scenario_save_composition.card.profile': 'load profile: {was} → {now}',
  'scenario_save_composition.profile.none': '(none)',
  'scenario_save_composition.card.undo.create': 'delete the new composition (the user decides)',
  'scenario_save_composition.card.undo.update':
    'scenario_save_composition puts the previous name, members and profile back; a removed member comes back with default settings',
  'scenario_save_composition.done.created': 'composition "{name}" created with {members} members',
  'scenario_save_composition.done.updated': 'composition "{name}" saved: {parts}',
  'scenario_save_composition.done.unchanged': 'composition "{name}": nothing to change',
  'scenario_save_composition.part.name': 'the name',
  'scenario_save_composition.part.members': 'the members and shares',
  'scenario_save_composition.part.profile': 'the load profile',
  'scenario_save_composition.total': 'the shares add up to {total}%',
  'scenario_save_composition.valid.yes': 'the backend finds it valid',
  'scenario_save_composition.valid.no': 'the backend finds it NOT valid',
  'scenario_save_composition.valid.unknown': 'the backend could not validate it',
  'scenario_save_composition.error': 'error: {text}',
  'scenario_save_composition.warning': 'warning: {text}',
  'scenario_save_composition.undo.previous':
    '→ undo: scenario_save_composition with the previous values (a removed member comes back with default settings)',
  'scenario_save_composition.undo.delete': '→ undo: delete the new composition (the user decides)',
  'scenario_save_composition.undo.withheld':
    'no undo: a previous value holds a secret and is not kept',
  'scenario_compile_composition.card.title': 'Compile composition "{name}"',
  'scenario_compile_composition.card.members':
    'builds the Gatling project a run would ship, from {enabled} enabled members (of {members})',
  'scenario_compile_composition.card.nothing_runs':
    'nothing runs on the target and nothing is stored; the call waits for the build',
  'scenario_compile_composition.card.cost': 'a backend build, up to 2 min; no LLM',
  'scenario_compile_composition.card.undo': 'it only builds',
  'scenario_compile_composition.done.compiled': 'composition "{name}" compiled in {seconds} s',
  'scenario_compile_composition.done.code_failed':
    'composition "{name}" did not compile ({seconds} s)',
  'scenario_compile_composition.done.environment_failed':
    'the build environment failed, not the code of composition "{name}" ({seconds} s): try again later',
  'scenario_compile_composition.done.no_enabled_member':
    'composition "{name}" has no enabled member: there was nothing to build',
  'scenario_compile_composition.error': 'error: {text}',
  'scenario_compile_composition.warning': 'warning: {text}',
  'scenario_compile_composition.more': '… and {count} more',
  'scenario_compile_composition.output': 'the build output has {lines} lines and is not shown',
  'scenario_compile_composition.problem.code_failed':
    'The generated project of composition "{name}" does not compile.',
  'scenario_compile_composition.problem.environment_failed':
    'The build environment failed while compiling composition "{name}".',
  'scenario_compile_composition.problem.no_enabled_member':
    'Composition "{name}" has no enabled member to compile.',
  'scenario_compile_composition.problem.compiled': 'Composition "{name}" compiled.',
  'error.scenario_compile_refused.message': 'The backend would not build composition "{name}".',
  'error.scenario_compile_refused.hint':
    'An enabled member has no build or carries a field the build refuses; regenerate that scenario and try again.',
  'scenario_ask_copilot.card.title': 'Ask the scenario copilot about "{name}"',
  'scenario_ask_copilot.card.message': 'question: "{message}"',
  'scenario_ask_copilot.card.review':
    'the standard readiness review of the scenario (a fixed prompt)',
  'scenario_ask_copilot.card.profile': 'load profile: {profile}',
  'scenario_ask_copilot.profile.none': '(none)',
  'scenario_ask_copilot.card.proposes':
    "it proposes actions and applies none; the exchange is kept in the scenario's copilot history",
  'scenario_ask_copilot.card.cost':
    'one or two LLM calls (the plan is tried once more when it fails)',
  'scenario_ask_copilot.card.undo': 'it only proposes; nothing of the scenario changes',
  'scenario_ask_copilot.done.message': 'the copilot answered the question about "{name}"',
  'scenario_ask_copilot.done.review': 'the copilot reviewed the readiness of "{name}"',
  'scenario_ask_copilot.reply': 'reply: {reply}',
  'scenario_ask_copilot.reply.cut': 'reply (cut): {reply}',
  'scenario_ask_copilot.actions.none': 'no action proposed',
  'scenario_ask_copilot.actions': '{count} actions proposed:',
  'scenario_ask_copilot.action.adjust_and_regenerate': '{index}. rebuild the scenario: {summary}',
  'scenario_ask_copilot.action.generate_slot_feeder':
    '{index}. generate a dataset for slot "{about}" ({summary})',
  'scenario_ask_copilot.action.rewrite_validator':
    '{index}. rewrite validator "{about}": {summary}',
  'scenario_ask_copilot.action.other': '{index}. {summary}',
  'scenario_ask_copilot.more': '… and {count} more',
  'scenario_ask_copilot.applied.none':
    'nothing was applied: each proposal is for the user to decide',
  'scenario_check_drift.card.title': 'Check drift of scenario {name}',
  'scenario_check_drift.card.scenario': 'Scenario: {name} ({id})',
  'scenario_check_drift.card.reference.har': 'Compared with the recorded HAR session {id}',
  'scenario_check_drift.card.reference.openapi': 'Compared with the documentation version {id}',
  'scenario_check_drift.card.cost': 'about one LLM comparison',
  'scenario_check_drift.card.undo': 'nothing to undo: it only stores a verdict',
  'scenario_check_drift.progress.start': 'Starting the drift check',
  'scenario_check_drift.progress.step': 'Drift check: {step} ({percent}%)',
  'scenario_check_drift.node.extract_endpoints': 'reading the endpoints of the reference',
  'scenario_check_drift.node.compare': 'comparing with the scenario',
  'scenario_check_drift.node.recommend': 'writing recommendations',
  'scenario_check_drift.result':
    'Scenario {name}: staleness {score} (0 current, 1 stale), checked {at}',
  'scenario_check_drift.reference': 'Compared with {kind} {id}',
  'scenario_check_drift.source.har': 'the HAR session',
  'scenario_check_drift.source.openapi': 'the documentation version',
  'scenario_check_drift.no_report':
    'Only the score was read: the report of this check was not received.',
  'scenario_check_drift.summary':
    '{current} endpoints unchanged, {drifted} changed or gone, {parameters} parameter drifts, {uncovered} of the reference not called',
  'scenario_check_drift.status.modified': 'changed',
  'scenario_check_drift.status.removed': 'gone from the reference',
  'scenario_check_drift.location.query': 'query',
  'scenario_check_drift.location.header': 'header',
  'scenario_check_drift.location.body': 'body',
  'scenario_check_drift.more_endpoints': '… and {count} more changed endpoints',
  'scenario_check_drift.recommendations': 'recommendations (LoadCraft):',
  'scenario_check_drift.uncovered':
    'endpoints of the reference the scenario does not call ({count}):',
  'error.scenario_drift_failed.message': 'LoadCraft could not finish the drift check: {cause}',
  'error.scenario_drift_failed.hint':
    'Check that the reference id is a HAR session or documentation version of this project (scenario_list, project_get_docs), then run the check again.',
  'error.scenario_drift_cancelled.message': 'The drift check was cancelled before it finished.',
  'error.scenario_drift_cancelled.hint':
    'Run scenario_check_drift again when the user wants the check.',
  // slot collisions (scenario_save_composition, scenario_check_composition)
  'scenario.slot_collision':
    'Warning: the members {members} declare the slot "{slot}" differently ({differs}); one dataset cannot fit them all.',
  'scenario.slot_collision.columns': 'other columns',
  'scenario.slot_collision.role': 'other role',
  'scenario.slot_collision.identity': 'new accounts against existing ones',
} as const satisfies Readonly<Record<string, Entry>>;
