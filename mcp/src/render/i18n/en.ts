// English dictionary: the reference for the key set. `pl` must have exactly these keys.
// Product names (load profiles, Normal / Realistic / Custom, SLA FAILED) are never translated.

import { operationEn } from './operation.js';

/** Plural categories as returned by `Intl.PluralRules`; `other` is the required fallback. */
export interface PluralForms {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

import { stepsEn } from './steps.js';
import { resultsEn } from './results.js';
import { paneEn } from './pane.js';
import { cardEn } from './card.js';
import { profileEn } from './profile.js';
import { deletionEn } from './deletion.js';
import { consentEn } from './consent.js';
import { failuresEn } from './failures.js';

export type Entry = string | PluralForms;

export const en = {
  ...operationEn,
  // The eight steps of a test session, as the mod's band above the prompt names them.
  ...stepsEn,
  ...resultsEn,
  ...paneEn,
  ...cardEn,
  ...profileEn,
  ...deletionEn,
  ...consentEn,
  ...failuresEn,

  'demo.notice': 'demo mode — sample data',

  'link.projectProfile': 'Application profile',
  'link.flow': 'Flow',
  'link.describeRun': 'live preview',
  'link.harImport': 'HAR import',
  'link.composition': 'Composition',
  'link.scenario': 'Scenario',
  'link.feeders': 'Datasets',
  'link.executionLive': 'Live run',
  'link.executionResults': 'Results',
  'link.compare': 'Comparison',
  'link.projects': 'Projects',
  'link.flows': 'Flows',

  'operation.channelUnavailable': 'The live channel is unavailable; checking the result every 5 s.',
  'operation.progressNote': '{message} {note}',
  'operation.running.state': 'The operation is still running in LoadCraft: {operation}.',
  'operation.running.next':
    'Call process_wait with operation "{operation}" to keep waiting; LoadCraft keeps working meanwhile.',
  'operation.needs_user.state': 'The operation is waiting for the user: {operation}.',
  'operation.needs_user.next':
    'Show the user the message above; once they have done it, call process_wait with operation "{operation}".',

  'error.unauthorized.message':
    'LoadCraft did not accept the API token: it is invalid or has been revoked.',
  'error.unauthorized.hint':
    'Create a new API token in LoadCraft, put it in the plugin options, then run /loadcraft:doctor.',
  'error.unauthorized.noToken.message':
    'No LoadCraft API token is configured, so nothing was sent.',
  'error.unauthorized.noToken.hint':
    'Set the API token in the plugin options, then run /loadcraft:doctor.',
  'error.forbidden.message': 'LoadCraft refused this action for the current API token.',
  'error.forbidden.hint':
    'Tell the user: the token owner lacks access to this project or action. Do not retry.',
  'error.not_found.message':
    'LoadCraft does not know this item: it was never created, was deleted, or belongs to another project.',
  'error.not_found.hint':
    'Check the identifier, or list the items first and pick one from the list.{available}',
  'error.ambiguous.message': 'More than one {kind} matches "{name}".',
  'error.ambiguous.hint':
    'Ask the user which one is meant, or use the identifier. Candidates: {candidates}.',
  'error.no_project.message':
    'No project is selected: this directory is not bound to a LoadCraft project and none was named.',
  'error.no_project.hint': 'Run project_create, or name the project.',
  'error.not_implemented.message': 'This tool is registered but not written yet: it did nothing.',
  'error.not_implemented.hint':
    'Do not retry it; tell the user that this step is not available in this version of the plugin.',
  'error.missing_argument.message':
    'The argument {name} is needed: it was not given and the process state holds none.',
  'error.missing_argument.hint':
    'Pass {name}, or run process_get_status to see what the state holds, then call the tool again.',
  'error.missing_argument.hint.scenario_id':
    'Pass scenario_id: scenario_list shows the scenarios of the project with their ids (for the traffic-split planner pass draft_id instead), then call the tool again.',
  'error.missing_argument.hint.docs_id':
    'Pass docs_id: project_get_docs with versions=true lists the ids of the stored documentation (project_get_docs alone gives the active one), then call the tool again.',
  'error.missing_argument.hint.composition_id':
    'Pass composition_id, its id or name: scenario_list_compositions lists the compositions of the project (scenario_generate makes one when it has none), then call the tool again.',
  'error.missing_argument.hint.environment_id':
    'Pass environment_id, the environment the saved run uses: project_get_envs lists them. A saved run takes the environment it is given, never one this workspace picked, then call the tool again.',
  'error.missing_argument.hint.workload':
    'Pass workload, the load of the saved run as {type, vusers, ramp, hold}: run_plan gives ready profiles. It replaces the stored load as a whole, then call the tool again.',
  'error.missing_argument.hint.profile':
    'Pass profile, the load profile to use (type, vusers, ramp, hold): run_get_profiles lists the stored profiles; this workspace has chosen none yet, then call the tool again.',
  'error.missing_argument.hint.snapshot_id':
    "Pass snapshot_id: traffic_list_snapshots lists the project's production traffic snapshots with their ids (an empty list means none has been pushed yet), then call the tool again.",
  'error.missing_argument.hint.run_id':
    "Pass run_id: run_list lists the project's runs, newest first, with their handles (e-xxxxxxxx), then call the tool again.",
  'error.missing_argument.hint.compare_to':
    'Pass compare_to: a run handle or UUID from run_list, or "baseline" for the pinned reference; then call the tool again.',
  'error.missing_argument.hint.flow_id':
    "Pass flow_id: flows_list lists the project's flows with their ids, then call the tool again.",
  'error.missing_argument.hint.dataset_id':
    "Pass dataset_id: data_list_datasets lists the project's datasets with their ids, then call the tool again.",
  'error.missing_argument.hint.walk_id':
    'Pass walk_id: no tool lists the walks. The id is printed by the call that recorded the walk (flows_record_journeys) and the process state keeps the last one; this workspace has none, so ask the user which walk is meant.',
  'error.missing_argument.hint.draft_id':
    'Pass draft_id: the id of the traffic-split draft that scenario_suggest_split returned. No tool lists the drafts, and this workspace holds none: propose a split first.',
  'resolve.kind.project': 'project',
  'resolve.kind.environment': 'environment',
  'resolve.kind.flow': 'flow',
  'resolve.kind.scenario': 'scenario',
  'resolve.kind.composition': 'composition',
  'resolve.kind.execution': 'execution',
  'resolve.kind.target': 'composition or scenario',
  'resolve.notFound': 'No {kind} matches "{name}"; available: {names}.',
  'resolve.notFound.empty': 'No {kind} matches "{name}"; the list is empty.',
  'resolve.more': '{names} and {count} more',

  'verdict.state.sla_passed': 'SLA PASSED',
  'verdict.state.sla_failed': 'SLA FAILED',
  'verdict.state.sla_not_judged': 'no SLA verdict',
  'verdict.state.invariants_violated': 'invariants violated',
  'verdict.state.completed_with_errors': 'completed with errors',
  'verdict.state.run_failed': 'run failed',
  'verdict.state.cancelled': 'cancelled',
  'verdict.state.in_progress': 'in progress',

  'status.identity': 'signed in as {user} · LoadCraft {version} · API {revision} ✓',
  'status.project': 'Project “{name}”',
  'status.setup.complete': 'setup complete ✓',
  'status.setup.incomplete': 'setup incomplete · missing: {missing}',
  'status.setup.incompleteUnknown': 'setup incomplete',
  'status.env.default': 'default',
  'status.env.protected': 'protected',
  'status.env.caps': 'limit {caps}',
  'status.env.capUsers': { one: '{count} user', other: '{count} users' },
  'status.env.capRps': { one: '{count} request/s', other: '{count} requests/s' },
  'status.env.noCaps': 'no limit',
  'status.env.protectedNoCaps': 'no load limits, so runs are refused',
  'status.env.inactive': 'inactive',
  'status.count.flows': { one: '{count} flow', other: '{count} flows' },
  'status.count.scenarios': { one: '{count} scenario', other: '{count} scenarios' },
  'status.count.compositions': { one: '{count} composition', other: '{count} compositions' },
  'status.runs.title': 'recent runs',
  'status.runs.none': 'no test has run yet',
  'status.ops.title': 'operations in progress (collect the result with process_wait)',
  'status.ops.started': 'started {ago}',
  'status.ago.now': 'just now',
  'status.ago.minutes': { one: '{count} min ago', other: '{count} min ago' },
  'status.ago.hours': { one: '{count} h ago', other: '{count} h ago' },
  'status.ago.days': { one: '{count} day ago', other: '{count} days ago' },
  'flow.list.ready': { one: '{count} flow ready', other: '{count} flows ready' },
  'flow.get.version': 'version {version}',
  'slot.ref': '{label} (slot: {key})',
  'status.section.flows': 'flows',
  'status.section.scenarios': 'scenarios',
  'status.section.compositions': 'compositions: {names}',
  'status.section.data': 'data slots',
  'status.scenario.flow': 'flow {flow}',
  'status.scenario.version': 'v{version}',
  'status.selfCheck.passed': 'self-check ✓',
  'status.selfCheck.waiting_for_data': 'self-check waits for data',
  'status.selfCheck.other': 'self-check: {status}',
  'status.selfCheck.none': 'no self-check yet',
  'status.data.none': 'no scenario needs test data',
  'status.data.legend': '✓ dataset pinned · ✕ missing, the self-check waits for it',
  'status.next.unbound': 'This repository is not bound to a project — start with project_create.',
  'status.next.setup_incomplete':
    'next: project_analyze_setup, then project_apply_setup — they complete the setup',
  'status.next.analysis_done':
    'next: project_apply_setup with analysis "{subject}" — the analysis is done, its proposals wait to be applied; do not analyse again',
  'status.next.no_flows':
    'next: flows_suggest_journeys — proposes user journeys; flows also come from flows_generate_from_endpoints, flows_describe_journeys or flows_import_har',
  'status.next.no_compositions':
    'next: scenario_suggest_split — proposes how to split the traffic between the flows; scenario_generate then builds the scenario',
  'status.next.needs_data': 'next: data_check_readiness — the scenarios wait for data: {subject}',
  'status.next.no_runs':
    'next: choose the environment and the profile, then run_start — everything is ready for the first test',
  'status.next.no_analysis': 'next: results_get_report for {subject}, then results_analyze_run',
  'status.next.passed_no_diagnosis':
    'next: results_get_report for {subject} to read the result — the thresholds held, so nothing else is owed; a diagnosis only if you ask',
  'status.next.all_done':
    'next: choose the environment and the profile, then run_start — the last run has an analysis; run another after a fix',
  'data.title': { one: 'data plan · {count} slot', other: 'data plan · {count} slots' },
  'data.title.none': 'data plan · no slots',
  'data.label.more': '+{count} more',
  'data.cause': '{label}: {counts}{message}{kind}',
  'data.cause.have': '{have} rows in the dataset · ',
  'data.cause.both': '{have} rows in the dataset, {need} needed · ',
  'data.cause.fresh':
    ' · {identity}: a new dataset (data_create_dataset with scenario and slot) starts the count of used values over',
  'data.cause.spent': '{have} rows in the dataset, {free} free{by} · ',
  'data.cause.spentNeed': '{have} rows in the dataset, {free} free{by}, {need} needed · ',
  'data.cause.by': ' (spent by {runs})',
  'data.cause.byEarlier': ' (spent by earlier runs)',
  'data.cause.rereads':
    'its "{strategy}" strategy reads the file from the top on every run, so this run would hand out the spent values first',
  'data.cause.backend': 'backend: "{message}"',
  'data.cause.identity': ' · {identity}',
  'data.cause.regenerate':
    ' · regenerate dataset "{dataset}" (id {id}): data_create_dataset with scenario and slot makes new rows, or load a CSV file of unused values with file and slot',
  'data.identity.fresh': 'new identities for sign-up, each used once',
  'data.exclusive': 'exclusive',
  'data.state.bound': 'pinned',
  'data.state.auto': 'auto',
  'data.state.missing': 'missing',
  'data.state.column_mismatch': 'wrong columns',
  'data.state.short_rows': 'too few rows',
  'data.state.stale_pin': 'stale binding',
  'data.state.empty_column': 'empty column',
  'data.state.parse_error': 'unreadable file',
  'data.fix.accounts_must_exist': '{dataset} must exist on {environment}',
  'data.fix.dataset_missing': 'waiting for data: {label}',
  'data.fix.data_missing': '{label}: no data yet, a call of the suggestion fills it',
  'data.fix.data_generate':
    "{label}: no data yet, data_create_dataset makes its rows from the slot's columns",
  'data.fix.data_generate.fresh':
    "{label}: no data yet, data_create_dataset makes new identities from the slot's columns; make them again after every run that reached the target, the used ones are registered",
  'data.fix.slot_mixed':
    '{label}: one slot serves a sign-in and a sign-up: split it, a separate slot for the sign-up',
  'data.fix.data_from_file':
    '{label}: no data, and no tool can make it ({reason}){hub} · give a CSV file with the columns {columns} to data_create_dataset with file and slot',
  'data.fix.data_from_file.hub': ' · the data hub: {reply}',
  'data.fix.data_from_file.no_source': 'no scenario of the target declares all its columns',
  'data.fix.data_from_file.secret_columns': 'it has a secret column, which LoadCraft never invents',
  'data.fix.data_from_file.refused': 'LoadCraft refused: {detail}',
  'data.fix.column_mismatch': '{label}: the dataset has the wrong columns',
  'data.fix.stale_pin': '{label}: the binding is stale',
  'data.fix.empty_column': '{label}: the dataset has an empty column',
  'data.fix.parse_error': '{label}: the dataset cannot be read',
  'data.fixes': {
    one: '{count} fix before the test: {fixes}',
    other: '{count} fixes before the test: {fixes}',
  },
  'data.ready':
    'every slot is bound and filled · whether the rows suffice for a profile, run_plan with a profile checks',
  'data.ready.noSlots': 'the scenario needs no test data · the test can start',
  'data.provision.progress': '{done} / {total} accounts',
  'data.provision.created': { one: '{count} created', other: '{count} created' },
  'data.provision.through': ' through {operation}',
  'data.provision.batches.exact': ' ({batches} × {size})',
  'data.provision.batches': {
    one: ' ({batches} batch of up to {size})',
    other: ' ({batches} batches of up to {size})',
  },
  'data.provision.nothing': 'nothing to create · the dataset already has {count} accounts',
  'data.provision.earlier': 'an earlier call had created {count}',
  'data.provision.on': ' on {environment}',
  'data.provision.failed': 'failed: {count}',
  'data.provision.failure': 'target answered {status}: {count}×',
  'data.provision.aborted': 'LoadCraft stopped the series after a run of failures',
  'data.provision.next':
    '→ read the status: 400 or 422, the registration request does not fit the target (check the flow, or give register_operation); 401 or 403, the target needs a key or a header (project_save_env with headers) or does not allow registration; 409, such accounts exist (give them in a file: data_create_dataset with file and slot); 429 or a server error, the target is overloaded (repeat once with a smaller count).',
  'data.provision.masked': 'passwords masked',
  'data.provision.incomplete':
    '{done} of {total} accounts exist · the test is not ready; repeat the call to add the rest',
  'data.provision.confirm':
    "Creating {count} accounts for {target} on the protected environment {environment} needs the user's consent; nothing was sent. Ask the user, and only after a yes repeat the call with confirm_protected: true.",
  'data.provision.noCandidates': 'none found in the API spec',
  'data.provision.running':
    'Accounts for slot {slot}: the plugin server goes on creating them after this call. Call process_wait with operation "{operation}" to follow it; do not call data_create_accounts again for it.',
  'data.provision.running.joined':
    'Accounts for slot {slot} were already being created: this call joined that work instead of starting a second one. Call process_wait with operation "{operation}" to follow it.',
  'data.provision.stopped.cancelled':
    '{done} of {total} accounts exist · stopped by process_cancel',
  'data.provision.stopped.restart':
    '{done} of {total} accounts exist · the plugin server stopped before the creation ended',
  'data.provision.stopped.complete':
    'every account asked for exists and the dataset is pinned to the slot · data_check_readiness shows the plan',
  'data.provision.stopped.next':
    'the test is not ready · data_create_accounts for slot {slot} with count {count} adds only the missing accounts',
  'data.file.rows': {
    one: '{count} row from {file}',
    other: '{count} rows from {file}',
  },
  'data.file.revision': 'new revision of the dataset',
  'data.steps': {
    one: 'the call that fills it:',
    other: 'the calls that fill them, in this order:',
  },
  'data.steps.suggested': {
    one: 'the call that applies the suggestion:',
    other: 'the calls that apply the suggestion, in this order:',
  },
  'data.steps.next': '→ next: {call}',
  'data.suggest.none': 'the data hub proposes no actions',
  'data.skipped': 'left out {count}:',
  'data.skip.separate_call': 'creating accounts needs a tool of its own (data_create_accounts)',
  'data.skip.secret_columns':
    'dataset "{name}" has password columns · accounts from a file (data_create_dataset with file and slot) or data_create_accounts',
  'data.skip.no_rules': 'dataset "{name}": the suggestion gives no column rules',
  'data.skip.exists': 'dataset "{name}" already exists in the project',
  'data.skip.dataset_gone': 'slot {slot}: the dataset is not in the project',
  'data.skip.slot_gone': 'slot {slot}: no scenario of the target reads it',
  'data.skip.not_applied': '{kind}: no data tool applies it',
  'data.skip.over_limit':
    '{count} more actions of the data hub: at most 40 become calls; call data_suggest_actions again once these are done',
  'data.card.suggest': 'consent card · suggest the test data for {target}',
  'data.card.create': 'consent card · create dataset "{name}"',
  'data.card.for': 'For: {target}',
  'data.card.cost': 'Cost: up to 3 LLM calls of the data hub · nothing is saved',
  'data.card.source.file': 'Source: the file {file} · {size} bytes · sha256 {sha}',
  'data.card.source.rules': 'Source: the column rules {handle}',
  'data.card.source.slot': 'Source: the columns of slot {slot}',
  'data.card.slot': 'For slot: {slot} of {target}',
  'data.card.rows': 'Rows: {rows}',
  'data.card.revision': 'The dataset exists: the file becomes its new revision.',
  'data.card.regenerate':
    'The dataset exists: its rows are made again, with new values (a new count of used values).',
  'data.card.cost.fresh':
    "Cost: LoadCraft may use its model and the project's daily dataset budget for the rows; nothing is sent to the target · new identities for sign-up, each used once: after a run that reached the target, make them again",
  'data.card.next':
    '→ ask the user; only after their yes call {tool} again with the same arguments and confirm: "{confirm}"',
  'data.card.cost.slot':
    "Cost: LoadCraft may use its model for the rows and the project's budget for datasets",
  'data.card.renewed.missing':
    'Nothing was done: there is no card for this confirm. This is a new card.',
  'data.card.renewed.expired':
    'Nothing was done: the card had expired (30 minutes). This is a new card.',
  'data.card.renewed.token':
    'Nothing was done: the token is not the one of the current card. This is a new card.',
  'data.card.renewed.changed':
    'Nothing was done: the call carried other arguments than its card, or the file changed. This is a new card for them.',
  'data.created.rules': 'dataset "{name}" made from rules · rows: {rows}',
  'data.created.slot': 'slot {slot}: dataset "{name}" made from its columns · rows: {rows}',
  'data.bindings.title': {
    one: 'picks of {target} · {count} slot',
    other: 'picks of {target} · {count} slots',
  },
  'data.bindings.none': 'picks of {target} · none',
  'data.bindings.scenarios': ' · pinned in member scenarios: {count}',
  'data.bindings.cleared': 'cleared: {slots}',
  'data.bindings.unchanged': 'the target already has these picks · nothing was sent',
  'error.probes_disabled.message':
    'The project does not allow LoadCraft to send requests to its target, so no accounts can be created.',
  'error.probes_disabled.hint':
    'Ask the user to enable target probes in the project settings ({url}); this tool does not change that consent.',
  'error.slot_unknown.message': 'The scenario has no data slot "{slot}". Slots: {available}.',
  'error.slot_unknown.hint':
    'Call data_check_readiness with the scenario to see the slots, then pick one.',
  'error.slot_new_identities.message':
    'The slot "{slot}" holds new identities for a sign-up (each used once), so no account is created for it beforehand.',
  'error.slot_new_identities.hint':
    'Fill it with data_create_dataset with the scenario and the slot: LoadCraft makes new rows, and after every run that reached the target they are made again. Nothing was sent to the target.',
  'error.slot_mixed_identities.message':
    'The slot "{slot}" serves a sign-in in one scenario and a sign-up in another, so no single dataset fits it.',
  'error.slot_mixed_identities.hint':
    'Split the slot: a separate slot for the sign-up, so the sign-in keeps real accounts and the sign-up gets new identities. Nothing was sent to the target.',
  'error.slot_not_accounts.message':
    'The slot "{slot}" holds plain data, not accounts, so no account can be created for it.',
  'error.slot_not_accounts.hint': '{next} Nothing was sent to the target.',
  'error.slot_not_accounts.next.generate':
    "Fill it with data_create_dataset with the scenario and the slot: it makes the rows from the slot's columns.",
  'error.slot_not_accounts.next.file':
    'It cannot be generated: give a CSV file with the columns {columns} to data_create_dataset with file and slot.',
  'error.slot_not_accounts.next.filled': 'It needs nothing: data_check_readiness shows it filled.',
  'error.accounts_file_columns_missing.message':
    'The file {file} has no column {missing}. The slot reads: {columns}.',
  'error.accounts_file_columns_missing.hint':
    'Add the columns to the file header (case does not matter) or pass another file. Nothing was sent.',
  'error.accounts_file_empty.message': 'The file {file} has no rows below its header.',
  'error.accounts_file_empty.hint': 'Pass a file with at least one account. Nothing was sent.',
  'error.accounts_file_row_short.message': 'Line {line} of {file} has fewer cells than the header.',
  'error.accounts_file_row_short.hint':
    'Fix that line of the file and repeat the call. Nothing was sent.',
  'error.register_operation_required.message':
    'No flow of the scenario holds a request that creates an account. Candidates from the API spec: {candidates}.',
  'error.register_operation_required.hint':
    'Ask the user which operation creates an account, then repeat the call with register_operation set to it. Nothing was sent.',
  'error.register_operation_not_in_spec.message':
    'The API spec of the project has no such operation. Backend said: "{detail}"',
  'error.register_operation_not_in_spec.hint':
    'Use METHOD:/path or the operation id exactly as the candidates list gives it.',
  'error.register_operation_method_not_allowed.message':
    'The operation is not a POST, and accounts are created only through a POST. Backend said: "{detail}"',
  'error.register_operation_method_not_allowed.hint':
    'Choose a POST operation from the candidates list.',
  'error.register_operation_unfillable.message':
    'The operation needs values the plugin cannot make up. Backend said: "{detail}"',
  'error.register_operation_unfillable.hint':
    'Tell the user which fields it names; load the accounts from a file (data_create_dataset with file and slot) or record the registration in a flow so its real request is used.',
  'error.register_operation_dataset_mismatch.message':
    'The dataset has sign-in columns the operation does not send. Backend said: "{detail}"',
  'error.register_operation_dataset_mismatch.hint':
    'Choose the operation that sends the e-mail or login and the password, or fix the slot columns.',
  'error.provision_already_running.message':
    'Accounts for slot {slot} are already being created with other settings ({operation}).',
  'error.provision_already_running.hint':
    'Call process_wait with operation "{operation}" until it ends, or stop it with process_cancel; then call data_create_accounts with the new settings.',
  'error.dataset_source.message':
    "data_create_dataset takes one source: file (with scenario and slot), rules (a handle data_suggest_actions printed) or scenario and slot alone (rows from the slot's columns).",
  'error.dataset_source.hint': 'Repeat the call with one source. Nothing was sent.',
  'error.suggestion_unknown.message':
    'No rule set {handle} is kept: it is from an older suggestion, or none was made.',
  'error.suggestion_unknown.hint':
    'Call data_suggest_actions again and use a handle of its latest result. Nothing was sent.',
  'error.suggestion_rules_unusable.message':
    'The rule set {handle} cannot become a dataset: {reason}.',
  'error.suggestion_rules_unusable.hint':
    'Load such data from a CSV file (data_create_dataset with file and slot) or create accounts with data_create_accounts. Nothing was sent.',
  'error.suggestion_rules_unusable.reason.no_rules': 'it gives no column rules',
  'error.suggestion_rules_unusable.reason.secret_columns':
    'it has password columns, which are never generated',
  'error.dataset_name_taken.message': 'The project already has a dataset "{name}".',
  'error.dataset_name_taken.hint':
    'Pin it with data_set_bindings, or repeat the call with another name. Nothing was sent.',
  'error.slot_data_unavailable.message':
    'The rows of slot {slot} cannot be made from its columns: {reason}.',
  'error.slot_data_unavailable.hint':
    'Give a CSV file with the columns {columns} to data_create_dataset with file and slot (accounts: data_create_accounts after the user agrees). Nothing was sent.',
  'error.slot_data_unavailable.reason.accounts': 'it holds accounts',
  'error.never_fabricated_columns.message':
    'LoadCraft never makes up the values of {columns} for slot {slot}: they must be real (a login, a secret, a value naming something that exists on the target).',
  'error.never_fabricated_columns.hint':
    'Give a CSV file with real values of the columns {all} to data_create_dataset with file, scenario and slot; the data tools do not offer the generation for this slot again.',
  'error.slot_data_refused.message': 'LoadCraft refused to make the rows of slot {slot}: {detail}',
  'error.slot_data_refused.hint':
    'Give a CSV file with the columns {columns} to data_create_dataset with file and slot; the data tools do not offer the generation for this slot again.',
  'error.dataset_unknown.message': 'The project has no dataset "{dataset}". Datasets: {available}.',
  'error.dataset_unknown.hint':
    'Name a dataset by its name or id as a data result shows it. Nothing was sent.',
  'error.dataset_ambiguous.message': 'More than one dataset of the project is called "{dataset}".',
  'error.dataset_ambiguous.hint': 'Name it by its id. Nothing was sent.',
  'error.data_refused.message': 'LoadCraft refuses the data of this composition: {reason}',
  'error.data_refused.hint':
    'Fix what it names, or plan the scenarios of the composition one at a time.',
  'error.environment_needs_caps.message':
    '{environment} is protected and has no load limits, so LoadCraft refuses every run on it.',
  'error.environment_needs_caps.hint':
    'Set the limits (max users, max new users per second) of {environment} on the project page in LoadCraft, step Environments, or choose another environment.',
  'error.environment_caps_unreadable.message':
    'The load limits of {environment} cannot be read, so no test is started on it.',
  'error.environment_caps_unreadable.hint':
    'Check max_vu and max_rps of {environment} in LoadCraft (whole numbers, at least 1).',
  'error.spike_not_possible.message':
    'A spike cannot run on {environment}: its limit of {limit} fits no spike (the second burst is twice the first).',
  'error.spike_not_possible.hint':
    'Choose another profile (run_plan shows what fits), or raise the limit of the environment.',
  'error.stress_over_limit.message':
    'Stress stairs always climb to at least {floor} new/s, above the limit of {limit} new/s on {environment}.',
  'error.stress_over_limit.hint':
    'Choose a constant rate profile within the limit, or raise the limit of the environment.',
  'error.data_not_ready.message': 'Not started: the data is not enough for this load. {rows}.',
  'error.data_not_ready.hint':
    'Prepare the data (data_check_readiness names what is missing on {environment}), then call run_start again.',
  'error.run_needs_rebuild.message':
    'A scenario of this test must be generated again before it can run (it has no modular build).',
  'error.run_needs_rebuild.hint':
    'Generate the scenario again with scenario_generate, then call run_start.',
  'error.setup_incomplete.message': 'The project setup is incomplete. Missing: {missing}.',
  'error.setup_incomplete.hint':
    'Run project_analyze_setup, then project_apply_setup; they complete the configuration.',
  'error.setup_incomplete.unknown': 'some setup steps',
  'error.setup_incomplete.part.environments': 'environments',
  'error.setup_incomplete.part.evidence': 'evidence (OpenAPI, HAR or another source)',
  'error.setup_incomplete.part.analysis': 'analysis',
  'error.setup_incomplete.part.profile': 'application profile',
  'error.setup_incomplete.part.validators': 'validators',
  'error.setup_incomplete.part.test_types': 'test types',
  'error.agent_browsers_busy.message': 'Both agent browsers are busy with other runs.',
  'error.agent_browsers_busy.hint': 'Try again in a few minutes, or use a HAR recording instead.',
  'error.protected_environment_requires_caps.message':
    'This environment is protected and needs load limits (caps) before a run.',
  'error.protected_environment_requires_caps.hint':
    'Pass load limits within the environment caps, or choose another environment.',
  'error.protected_environment_requires_confirmation.message':
    'The server asked for consent to create accounts on the protected environment {environment}, although the plugin sent it. This is unexpected; nothing was created.',
  'error.protected_environment_requires_confirmation.hint':
    'Do not retry. Tell the user what happened and check that the environment and the plugin version are the ones intended.',
  'error.protected_environment_requires_acknowledgement.message':
    'This environment is protected: a run needs the explicit consent of the user.',
  'error.protected_environment_requires_acknowledgement.hint':
    'Ask the user whether to run against this environment; only after a yes, repeat the call with confirm_capped: true.',
  'error.workload_exceeds_environment_caps.message':
    'The environment limits do not allow this load. Backend said: "{detail}"',
  'error.workload_exceeds_environment_caps.hint':
    'The limits of the environment do not fit this profile or composition. Change the profile (run_plan) or the environment; do not repeat the same call.',
  'error.spike_exceeds_environment_caps.message':
    'The environment limits do not allow a spike. Backend said: "{detail}"',
  'error.spike_exceeds_environment_caps.hint':
    'The limits of the environment do not fit this profile. Change the profile (run_plan) or the environment; do not repeat the same call.',
  'error.no_default_environment.message':
    'The project has no default environment, and none was chosen.',
  'error.no_default_environment.hint':
    'Pass the environment explicitly, or ask the user to mark one as the default in LoadCraft.',
  'error.llm_generation_failed.message':
    'LoadCraft could not generate the result with the language model.',
  'error.llm_generation_failed.hint':
    'Show the user the reason; repeating the same call will not help.',
  'error.llm_generation_failed.hintRetryable':
    'This failure is temporary: repeat the same call once more.',
  'error.llm_not_configured.message':
    'No language model is configured in LoadCraft, so this step cannot generate anything.',
  'error.llm_not_configured.hint':
    'Tell the user to configure a model provider in the LoadCraft settings, then retry.',
  'error.prompt_over_budget.message': 'The input is too large for the language model budget.',
  'error.prompt_over_budget.hint':
    'Narrow the scope (fewer endpoints, a smaller file or a shorter description) and retry.',
  'error.timeout.message': 'LoadCraft did not answer in time.',
  'error.timeout.hint': 'Retry once; if it happens again, run /loadcraft:doctor.',
  'error.network_error.message': 'LoadCraft cannot be reached over the network.',
  'error.network_error.hint':
    'Try again in a moment; if it keeps happening, run /loadcraft:doctor.',
  'error.unexpected_redirect.message':
    'LoadCraft answered {request} with a redirect (HTTP {status}) to {host}. The plugin does not follow redirects, so the request was not repeated there.',
  'error.unexpected_redirect.hint':
    'Check the LoadCraft address in the plugin options: http instead of https, or a missing or extra trailing slash, then run /loadcraft:doctor.',
  'error.response_too_large.message': 'LoadCraft sent an answer larger than the limit of {limit}.',
  'error.response_too_large.hint':
    'Narrow the request (a filter, a smaller page or a single item) and retry.',
  'error.bad_gateway.message':
    'Something between the plugin and LoadCraft (a proxy or the server itself) answered with an error page instead of the API.',
  'error.bad_gateway.hint': 'Wait a moment and retry; if it persists, run /loadcraft:doctor.',
  'error.backend_too_old.message':
    'This LoadCraft server is older than the plugin supports ({reason}).',
  'error.backend_too_old.reason.revision': 'API revision {have}, the plugin needs {need}',
  'error.backend_too_old.reason.capability': 'the server lacks the "{capability}" feature',
  'error.backend_too_old.reason.noMeta': 'the server does not report its version',
  'error.backend_too_old.hint':
    'Tell the user to update the LoadCraft server, or install an older plugin version.{advice}',
  'error.invalid_arguments.message': 'The arguments do not fit together: {reason}.',
  'error.invalid_arguments.hint': 'Change the arguments and call again; nothing was sent.',
  'error.invalid_arguments.rule.generate_one_target': 'give flow_id or scenario_id, not both',
  'error.invalid_arguments.rule.generate_slot_needs_scenario':
    'slot is a slot of a scenario: pass scenario_id with it, not flow_id',
  'error.invalid_arguments.rule.generate_slot_name':
    'the dataset of a slot is named by LoadCraft after the slot: leave name out',
  'error.invalid_arguments.rule.update_without_fields':
    'send the new name, the new description, or both',
  'error.invalid_arguments.rule.apimap_one_of':
    'pass prefixes (paths separated by commas) or detected: true, not both and not neither',
  'error.invalid_arguments.rule.apimap_prefix_limits':
    'at most 64 prefixes, each at most 512 characters, and none of them empty',
  'error.invalid_arguments.rule.note_nothing_to_change':
    'send the new text, the new scope, or both',
  'error.invalid_arguments.rule.note_at_without_scope':
    'at names the page or the step of a scope, pass scope with it',
  'error.invalid_arguments.rule.choices_empty':
    'send at least one field of choices, for example flows.method',
  'error.invalid_arguments.rule.choices_secret':
    '{path} looks like a secret; choices are saved in the workspace state, name a file instead',
  'error.invalid_arguments.rule.flows_merge_count':
    'flow_ids must hold 2 to 20 flows, comma-separated',
  'error.invalid_arguments.rule.flows_duplicate_count':
    'flow_ids must hold 1 to 20 flows, comma-separated',
  'error.invalid_arguments.rule.flows_duplicate_docs_one':
    'docs_id copies one flow: pass exactly one flow in flow_ids',
  'error.invalid_arguments.rule.flows_duplicate_name_needs_docs':
    'name is for the copy onto a docs version: pass docs_id with it',
  'error.invalid_arguments.rule.walk_note_remember_new':
    'remember applies to a new note: do not pass it with note_id',
  'error.invalid_arguments.rule.composition_save_at_least_one':
    'send a name, members or a profile to change',
  'error.invalid_arguments.rule.composition_save_create_needs_members':
    'a new composition needs members: scenario -> share in percent',
  'error.invalid_arguments.rule.composition_save_duplicate_member':
    'members names a scenario twice (by id and by name, or twice by name)',
  'error.invalid_arguments.rule.composition_save_variants':
    'the composition has several members of one scenario (variants): members cannot say which; change them in the app',
  'error.invalid_arguments.rule.copilot_ask_one_of': 'send exactly one of message and review: true',
  'error.invalid_arguments.rule.composition_spec_type':
    'the kind of test goes in type: leave type out of spec',
  'error.invalid_arguments.rule.functional_template_new_needs':
    'a new template needs name and, in fields, api_description and flow_definition',
  'error.invalid_arguments.rule.functional_template_nothing':
    'send a name or at least one field to change',
  'error.invalid_arguments.rule.functional_template_docs_new_only':
    'docs_id applies to a new template: do not pass it with template_id',
  'error.invalid_arguments.rule.functional_flow_new_needs': 'a new flow needs name',
  'error.invalid_arguments.rule.functional_flow_new_only':
    'is_active applies to a change: leave it out of a new flow',
  'error.invalid_arguments.rule.functional_flow_change_only':
    'docs_id applies to a new flow: do not pass it with flow_id',
  'error.invalid_arguments.rule.functional_flow_snapshot_alone':
    'a version snapshot takes flow_id, version and reason only',
  'error.invalid_arguments.rule.functional_flow_reason_needs_version':
    'reason belongs to a version snapshot: pass version with it',
  'error.invalid_arguments.rule.functional_flow_nothing':
    'send a name or at least one field to change',
  'error.invalid_arguments.rule.effective_without_env':
    'effective needs env (an environment id or "default")',
  'error.invalid_arguments.rule.versions_with_docs_id':
    'versions lists the stored versions, do not pass docs_id with it',
  'error.invalid_arguments.rule.include_without_endpoint':
    'include applies to one endpoint, pass endpoint with it',
  'error.invalid_arguments.rule.save_profile_create_needs_name_and_type':
    'a new profile needs a name and a type',
  'error.invalid_arguments.rule.save_profile_without_fields': 'send at least one field to change',
  'error.invalid_arguments.rule.versions_without_flow':
    'versions lists the history of one flow, pass flow with it',
  'error.invalid_arguments.rule.templates_too_many_tags': 'at most 10 tags can narrow the list',
  'error.invalid_arguments.rule.runs_one_without_run':
    'view one reads one run, pass run_id with it',
  'error.invalid_arguments.rule.runs_by_template_without_template':
    'by_template lists the runs of one template, pass template with it',
  'error.invalid_arguments.rule.results_one_without_result':
    'view one reads one flow result, pass result_id with it',
  'error.invalid_arguments.rule.compare_same_functional_run':
    'a run compared with itself has nothing to show, pass two different runs',
  'error.invalid_arguments.rule.analytics_without_validator':
    'accuracy, trend and threshold_suggestion are about one validator, pass validator with them',
  'error.invalid_arguments.rule.catalog_assertion_types_active':
    'is_active does not narrow assertion types, leave it out',
  'error.invalid_arguments.rule.list_active_with_query':
    'is_active narrows the list of projects, not a search: leave one of them out',
  'error.invalid_arguments.rule.filter_with_endpoint':
    'method and query filter the list, do not pass them with endpoint',
  'log.foreignWriter':
    'Another version of the LoadCraft plugin writes the same state file (a session started earlier is still open): close the old session or reconnect the plugin; entries of this one it dropped were put back.',
  'log.entryNotSaved':
    'The call succeeded, but its entry in the log of the workspace was not saved ({code}).',
  'log.entryNotSaved.refused':
    'The call succeeded, but its entry in the log of the workspace was not saved ({code}; the state schema refused: {fields}).',
  'error.invalid_arguments.rule.get_templates_only_with': 'include works only with template',
  'error.invalid_arguments.rule.catalog_field_not_of_kind':
    'a field in fields does not belong to that kind (test type: category, display_name, description, expected_outcome, input_generation_prompt, input_schema, example_inputs, is_active; validator: category, display_name, description, validator_type, activation, group, scope, requires_profile_flags, ai_prompt_template, parameters, is_active; assertion type: category, display_name, description, prompt_template, parameters, is_active)',
  'error.invalid_arguments.rule.catalog_new_needs':
    'a new entry needs name and the required fields of its kind (test type: category, display_name, input_generation_prompt; validator: activation, category, display_name, group, scope, validator_type; assertion type: category, display_name)',
  'error.invalid_arguments.rule.catalog_name_new_only':
    'name is for a new entry; the name of an existing one cannot change',
  'error.invalid_arguments.rule.catalog_nothing': 'give at least one field to change in fields',
  'error.invalid_arguments.rule.test_types_one_mode':
    'give source with items (an addition), or test_type_id with fields (a change of one), not both and not neither',
  'error.invalid_arguments.rule.test_types_field_unknown':
    'a field does not fit here (add: category, display_name, description, input_prompt, example_inputs, expected_outcome, default_count, priority, poll_completion_values, poll_timeout_ms; suggestions: the same without the two poll fields; a change also takes name and is_enabled)',
  'error.invalid_arguments.rule.test_types_items_count': 'items takes 1 to 50 entries',
  'error.invalid_arguments.rule.test_types_catalog_ids':
    'with source catalog, each key of items is the id of a catalog test type and its value is {}',
  'error.invalid_arguments.rule.test_types_suggestion_needs':
    'an accepted suggestion needs category, display_name, description and input_prompt',
  'error.invalid_arguments.rule.test_types_nothing': 'give at least one field to change in fields',
  'error.invalid_arguments.rule.validators_one_mode':
    'give source with items (an addition), or validator_id with fields (a change of one), not both and not neither',
  'error.invalid_arguments.rule.validators_field_unknown':
    'a field does not fit here (add: display_name, description, ai_prompt, parameters, validator_type, default_params, scope, template, priority; proposals: display_name, description, template, default_params, rationale, scope, priority; a change: name, display_name, description, ai_prompt, parameters, validator_type, default_params, priority, is_enabled, needs_review)',
  'error.invalid_arguments.rule.validators_items_count': 'items takes 1 to 50 entries',
  'error.invalid_arguments.rule.validators_catalog_ids':
    'with source catalog, each key of items is the id of a catalog validator and its value is {}',
  'error.invalid_arguments.rule.validators_proposal_needs':
    'an accepted proposal needs display_name, description and template',
  'error.invalid_arguments.rule.validators_nothing': 'give at least one field to change in fields',
  'error.invalid_arguments.rule.suggest_docs_not_active':
    'docs_id is not the active docs of the project; the suggestion reads the active docs (project_get_docs lists them)',
  'error.invalid_arguments.rule.payloads_items_count':
    'flow_ids and test_types take 1 to 50 entries each',
  'error.invalid_arguments.rule.payloads_ids':
    'every key of flow_ids and test_types is an id (a UUID)',
  'error.invalid_arguments.rule.data_copilot_one_of':
    'pass scenario_id or composition_id, not both',
  'error.invalid_arguments.rule.poll_terminals_success_needed':
    'give at least one success status in success_terminals',
  'error.invalid_arguments.rule.poll_terminals_too_many':
    'give at most 20 statuses in each of success_terminals and failure_terminals',
  'error.invalid_arguments.rule.copilot_apply_nothing':
    'give at least one change id in accept or in reject',
  'error.invalid_arguments.rule.copilot_apply_too_many':
    'give at most 50 change ids in each of accept and reject',
  'error.invalid_arguments.rule.copilot_apply_overlap':
    'a change id cannot be in both accept and reject',
  'error.invalid_arguments.rule.delete_at_least_one': 'pass scenario_id or composition_id',
  'error.invalid_arguments.rule.delete_one_of': 'pass scenario_id or composition_id, not both',
  'error.invalid_arguments.rule.regenerate_expand_needs_rows':
    'mode=expand needs rows, the row count to expand to',
  'error.invalid_arguments.rule.regenerate_expand_above_current':
    'for mode=expand, rows must be above the current row count of the dataset',
  'error.invalid_arguments.rule.update_dataset_at_least_one':
    'pass at least one of: name, description, file',
  'error.invalid_arguments.rule.http_settings_at_least_one':
    'pass at least one of: base_url, protocol, headers_env_file',
  'error.invalid_arguments.rule.http_settings_base_url':
    'base_url is an http or https address without a user name or password',
  'error.invalid_arguments.rule.http_settings_headers_empty':
    'headers_env_file holds no KEY=VALUE line with a value',
  'error.invalid_arguments.rule.http_settings_headers_count':
    'headers_env_file holds more than 20 headers',
  'error.invalid_arguments.rule.http_settings_header_name':
    'a header name in headers_env_file is letters, digits and hyphens, and not host, content-length, transfer-encoding, connection or authorization',
  'error.invalid_arguments.rule.http_settings_header_value':
    'a header value in headers_env_file has no control character and is at most 8192 characters',
  'error.invalid_arguments.rule.run_save_name_required': 'a new saved run needs a name',
  'error.invalid_arguments.rule.run_save_target_one_of':
    'a new saved run needs exactly one of scenario_id and composition_id',
  'error.invalid_arguments.rule.run_save_target_fixed':
    'scenario_id, composition_id and source_execution_id are for a new saved run; a saved run keeps its target',
  'error.invalid_arguments.rule.run_save_at_least_one':
    'pass at least one of: name, environment_id, target_base_url, workload, feeder_bindings',
  'error.invalid_arguments.rule.run_save_production_only':
    'a workload of type production takes a production plan and ramp and hold 0; no other type takes one',
  'error.invalid.message': 'LoadCraft rejected the input as invalid. Backend said: "{detail}"',
  'error.invalid.hint':
    'Fix the input named in the message and repeat the call; if the data is missing (for example too few rows), prepare it first.',
  'error.conflict.message':
    'The request conflicts with the current state in LoadCraft. Backend said: "{detail}"',
  'error.conflict.hint':
    'Check the current state (process_get_status) and repeat the step only if it still makes sense.',
  'error.rate_limited.message':
    'LoadCraft is limiting requests or the AI budget is used up. Backend said: "{detail}"',
  'error.rate_limited.hint':
    'Wait a while before repeating; if the daily AI budget is exhausted, tell the user instead of retrying.',
  'error.server_error.message': 'LoadCraft failed while handling the request (HTTP {status}).',
  'error.server_error.hint':
    'Retry once; if it fails again, show the user the message and run /loadcraft:doctor.',
  'error.unavailable.message': 'LoadCraft is temporarily unavailable (HTTP {status}).',
  'error.unavailable.hint': 'Wait a moment and retry; if it persists, run /loadcraft:doctor.',
  'error.gateway_timeout.message':
    'A server between the plugin and LoadCraft timed out (HTTP {status}).',
  'error.gateway_timeout.hint':
    'The step may still be running in LoadCraft: check process_get_status before repeating it.',
  'error.unknown.message':
    'LoadCraft refused the request (HTTP {status}, {code}). Backend said: "{detail}"',
  'error.unknown.withheld':
    'LoadCraft refused the request (HTTP {status}, {code}). The backend text is not shown for this status.',
  'error.detail.withheld': 'not shown for this status',
  'error.jobText.withheld': 'the text of LoadCraft is not shown to you',
  'error.unknown.hint':
    'Show the user this message; change the input if it names a problem with it, otherwise do not repeat the call.',
  'error.internal_error.message': 'The step failed for a reason the plugin does not describe.',
  'error.internal_error.hint': 'Retry once; if it happens again, run /loadcraft:doctor.',
  'error.plugin_not_configured.message': 'The LoadCraft plugin is not configured correctly:',
  'error.plugin_not_configured.hint':
    'Fix the plugin options, then run /loadcraft:doctor to check the setup.',

  'error.internal_secret_in_state.message':
    'A registered secret value cannot be written to the state file.',
  'error.state_unreadable.message': 'The state file is unreadable.',
  'error.state_unreadable.hint': 'Remove loadcraft/.cache/state.json by hand.',
  'error.env_missing.message':
    'No environment is chosen: the call names none, and neither the process nor the project has one.',
  'error.env_missing.hint':
    'Name the environment (env) or set one for the project, then call again.',
  'error.new_project_pending.message':
    'A card to create a project already waits for a decision in this folder.',
  'error.new_project_pending.hint':
    'Answer that card (yes or no) before you create another project.',
  'error.state_schema_unsupported.message':
    'The state file uses schema {schema}, which this plugin version does not know.',
  'error.state_schema_unsupported.hint': 'Update the LoadCraft plugin.',
  'error.secret_not_storable.message': 'A secret value cannot be written to the state file.',
  'error.state_update_invalid.message':
    'The state change does not match the state schema: {fields}.',
  'error.pending_full.message': 'More than {limit} cards wait for a decision; no new card fits.',
  'error.pending_full.hint': 'Answer or cancel the open cards first, then call again.',
  'error.rebind_cards_dropped.message':
    '{count} cards from before the project was created were dropped: the project holds too many cards.',
  'error.rebind_cards_dropped.hint':
    'Re-propose what is missing, after answering or cancelling the open cards.',
  'error.state_conflict.message':
    'The state file kept changing during the write; nothing was saved.',
  'error.state_conflict.hint':
    'Call again. If it repeats, check that no other program edits loadcraft/.cache/state.json.',
  'error.state_locked.message': 'Another LoadCraft process holds the lock of the state file.',
  'error.state_locked.hint':
    'Call again in a moment. If it repeats and no other session runs in this repository, remove loadcraft/.cache/state.json.lock.',
  'error.binding_invalid.message':
    'loadcraft/project.json is not valid or does not have the expected structure.',
  'error.binding_invalid.hint': 'Fix or remove the file, then run project_create again.',
  'error.binding_schema_unsupported.message':
    'loadcraft/project.json uses schema {schema}, which this plugin version does not know.',
  'error.binding_schema_unsupported.hint': 'Update the LoadCraft plugin.',
  'error.binding_other_instance.message':
    'This repository is bound to a project on another LoadCraft instance.',
  'error.binding_other_instance.hint':
    'Point the plugin at that instance, or remove loadcraft/project.json to bind again.',
  'error.path_outside_workspace.message': 'The path is outside the project directory.',
  'error.path_outside_workspace.hint': 'Use a file inside the project directory.',
  'error.workspace_not_found.message': 'The project directory does not exist.',
  'error.file_not_found.message': 'File not found or cannot be read: {file}',
  'error.file_not_found.hint': 'Check the path relative to the project directory.',
  'error.env_file_not_allowed.message':
    '{file} is not an env file; accounts are read only from .env, .env.* or *.env files.',
  'error.env_file_not_allowed.hint': 'Point to the env file that holds the test account keys.',
  'error.file_changed.message': '{file} changed after it was checked.',
  'error.file_changed.hint': 'Retry with the file in its final place.',
  'error.file_too_large.message': 'File {file} exceeds the limit of {limit}.',
  'error.file_too_large.hint': 'Use a smaller file.',
  'error.file_changed_while_sending.message': '{file} changed while it was being sent.',
  'error.file_changed_while_sending.hint': 'Retry with the file in its final place.',
  'error.not_a_file.message': '{file} is not a regular file.',
  'error.not_a_file.hint': 'Point to a file, not a directory or a special file.',
  'error.file_encoding_invalid.message': '{file} is not valid UTF-8.',
  'error.env_key_invalid.message':
    'The env key name is not valid; use letters, digits and underscores.',
  'error.env_key_missing.message': 'Missing or empty in {file}: {names}.',
  'error.env_key_missing.hint':
    'Add {names} to {file}, or pass the names of the keys that hold the account.',
  'error.unsupported_file_type.message':
    '{file} cannot be used as {kind}: only {extension} files are accepted.',
  'error.file_not_allowed.message': 'The file was not opened through the allow-list.',
  'error.invalid_operation.message': '"{value}" is not a valid operation handle.',
  'error.invalid_operation.hint':
    'Pass the operation handle exactly as a tool returned it (<kind>:<id>, e.g. "test_run:0b5c77aa-…"), or run process_get_status to see the operations in progress.',
  'error.operation_lost.message':
    'LoadCraft no longer knows operation "{value}", and its result was not found.',
  'error.operation_lost.hint':
    'LoadCraft was restarted; check process_get_status and run the step again.',
  'error.operation_unknown.message':
    'This workspace has no record of operation "{value}": it was started in another directory, or the cache was cleared.',
  'error.operation_unknown.hint':
    'Run process_get_status to see the operations in progress, or start the step again.',
  'error.operation_kind_unsupported.message':
    'Operations of kind "{kind}" cannot be awaited in this version of the plugin.',
  'error.operation_kind_unsupported.hint':
    'Run process_get_status to see the state of the project; if a newer plugin version started the operation, update the plugin.',
  'error.not_cancellable.message': 'Operations of kind "{kind}" cannot be stopped.',
  'error.not_cancellable.hint':
    'Only {kinds} can be stopped. Use process_wait with the handle to see how this operation ends.',
  'cancel.stopped': 'Stopped {operation} in LoadCraft; it will not run to its end.',
  'cancel.stopping':
    'LoadCraft is stopping {operation}: the path in progress ends and the paths built so far are saved.',
  'cancel.stopping.next': 'Call process_wait with {operation} to see the saved flows.',
  'cancel.notRunning':
    '{operation} is not running (it has ended, or LoadCraft no longer has it), so there was nothing to stop.',
  'cancel.notRunning.next': 'Call process_wait with {operation} to see how it ended.',
  'cancel.ended': '{operation} has already ended ({status}), so there was nothing to stop.',
  'cancel.ended.next': 'Call results_get_report with {handle} to see how it ended.',
  'cancel.planEnded':
    'The run of {operation} has already ended ({status}), so there was nothing to stop.',
  'cancel.planEnded.next':
    'Nothing is left running in LoadCraft for it. Call process_wait with {operation} to see how it ended, or flows_describe_journeys to plan again.',
  'cancel.noneRunning': 'No test is running in project {project}, so there is nothing to stop.',
  'cancel.running.item': '{handle} ({status})',
  'cancel.running.local': '{handle}',
  'cancel.running.none': 'none',
  'cancel.running.unavailable': 'the list could not be read',
  'cancel.status.interrupted': 'interrupted',
  'cancel.status.needs_input': 'needs input',
  'cancel.status.pending': 'waiting to start',
  'cancel.status.building': 'building',
  'cancel.status.running': 'running',
  'cancel.status.completed': 'completed',
  'cancel.status.failed': 'failed',
  'cancel.status.cancelled': 'cancelled',
  'error.cancel_target_unknown.message':
    'LoadCraft has no running test or operation "{value}" in this project.',
  'error.cancel_target_unknown.hint':
    'Running operations that can be stopped: {running}. Pass one of them as shown.',
  'error.cancel_which.message':
    'No single test started from this repository to stop. Tests running in this project: {running}.',
  'error.cancel_which.hint':
    "Ask the user which test to stop and call process_cancel with its e-… handle; stop none of them on your own, it may be someone else's.",

  // scenario_suggest_split and scenario_generate
  'buildScenario.created': {
    one: '{count} scenario + composition "{name}"',
    other: '{count} scenarios + composition "{name}"',
  },
  'buildScenario.updated': {
    one: '{count} scenario + composition "{name}" (updated)',
    other: '{count} scenarios + composition "{name}" (updated)',
  },
  'buildScenario.weightsOnly': 'composition "{name}" · new weights, nothing generated',
  'buildScenario.compiled': 'code compiled ✓',
  'buildScenario.notCompiled': 'code not compiled ✕',
  'buildScenario.dataMix': 'data: {shares}',
  'buildScenario.data.typical': 'typical',
  'buildScenario.data.invalid': 'invalid',
  'buildScenario.data.edge': 'edge cases',
  'buildScenario.none': 'none',
  'buildScenario.failure.retried': '{reason} (also after one retry)',
  'buildScenario.failure.repeated': '{reason} (the same cause as an earlier flow; not retried)',
  'buildScenario.failure.error': 'LoadCraft reported an error; the text of it is not shown',
  'buildScenario.failure.cancelled': 'the generation was cancelled',
  'buildScenario.failure.notProduced':
    'cause unknown (the live channel was unavailable) — try again',
  'buildScenario.progress.start': 'scenario {index}/{total} · {flow}: generation started',
  'buildScenario.progress.step': 'scenario {index}/{total} · {flow}: {step} ({percent}%)',
  'buildScenario.generationDone':
    'The scenario for "{flow}" is ready. Call scenario_generate again with the same arguments to finish the composition.',
  'buildScenario.generationFailed': 'No scenario was generated for "{flow}": {reason}',
  'error.proportions_sum.message':
    'The proportions add up to {sum}%; they must add up to 100 (± 0.5).',
  'error.proportions_sum.hint': 'Fix `proportions` so that they add up to 100 and call again.',
  'error.proportions_not_positive.message':
    'Every flow needs a share above zero; these have none: {flows}.',
  'error.proportions_not_positive.hint':
    'Give each flow a positive percent, or leave the flow out of `flows`.',
  'error.proportions_missing.message': 'The proportions leave out these flows: {flows}.',
  'error.proportions_missing.hint': 'Give a percent for every flow of the composition: {expected}.',
  'error.proportions_unknown.message':
    'The proportions name flows that are not part of this composition: {keys}.',
  'error.proportions_unknown.hint':
    'Use the names of the flows being combined ({expected}), or pass them in `flows`.',
  'error.data_mix_invalid.message':
    'The weights of `data_mix` must be zero or more and add up to more than zero.',
  'error.data_mix_invalid.hint': 'Pass "normal", "realistic" or weights by test type name.',
  'error.data_mix_unknown_type.message':
    'The data mix names test types this project has not enabled: {types}. Enabled: {available}.',
  'error.data_mix_unknown_type.hint':
    'Use the names of enabled test types (and happy_path for typical data), or enable the type in LoadCraft first.',
  'error.data_mix_realistic_unavailable.message':
    'The realistic mix needs enabled test types based on negative_testing and edge_cases; missing: {missing}. Enabled: {available}.',
  'error.data_mix_realistic_unavailable.hint':
    'If the project has no test types yet, call `project_apply_setup`: it adds the defaults. Otherwise pass `data_mix` as weights by the names of enabled test types, or use "normal".',
  'error.composition_flows_differ.message':
    'Composition "{name}" already exists and combines other flows: {saved}. Asked for: {requested}. Nothing was changed.',
  'error.composition_flows_differ.hint':
    'Call again with another composition name, or ask the user what to do with the existing composition.',
  'error.scenario_generation_failed.message':
    'Composition "{name}" was not created: no scenario for {failed} of {total} flows.\n{failures}\nReady: {ready}.',
  'error.scenario_generation_failed.hint':
    'Call scenario_generate again with the same arguments: ready scenarios are reused and only the missing ones are generated.',
  'error.scenario_generation_refused.message':
    'Composition "{name}" was not created: no scenario for {failed} of {total} flows.\n{failures}\nReady: {ready}.',
  'error.scenario_generation_refused.hint':
    'LoadCraft refused these flows, or the failure came back with the same cause; a call with unchanged input ends the same way. Read the reason of each flow and change what it names (the data in a step of the flow, the flow, or the API documentation the flow was built from), then call scenario_generate again. When the reason is not shown, tell the user which flows failed instead of calling again.',
  // project_connect_telemetry
  'telemetry.connected': {
    one: 'connected ✓ · {count} tool: {names}',
    other: 'connected ✓ · {count} tools: {names}',
  },
  'telemetry.connectedNone': 'connected ✓ · no tool the backend can call on its own',
  'telemetry.window': 'called after the test · window: whole test ±2 min',
  'telemetry.extraInput': 'never called, it needs more than start and end: {names}',
  'telemetry.notOffered': 'not offered by the server: {names}',
  'telemetry.idle': 'available but not enabled: {names}',
  'error.telemetry_url_credentials.message': 'The address must not contain sign-in details.',
  'error.telemetry_url_credentials.hint':
    'LoadCraft keeps no credentials for the log server. Use an address without user and password.',
  'error.telemetry_url_query.message':
    'The address must not carry a query (?…) or a fragment (#…).',
  'error.telemetry_url_query.hint':
    'Remove the parameters from the address; credentials are not passed in the address.',
  'error.telemetry_url_scheme.message': 'The address must use https.',
  'error.telemetry_url_scheme.hint': 'Give the https address of the log server.',
  'error.telemetry_url_invalid.message': 'The text is not a valid address.',
  'error.telemetry_url_invalid.hint':
    'Give the full https address of the log server, for example https://logs.example.com/mcp.',
  'error.telemetry_unreachable.message':
    'LoadCraft could not use this log server. Backend said: "{detail}"',
  'error.telemetry_unreachable.hint':
    'The log server must be publicly reachable over HTTP from the LoadCraft server; a local stdio server will not work. Tell the user, and do not retry with the same address.',
  // ---- results_analyze_run -------------------------------------------------------------------
  'diagnosis.progress.start': 'AI analysis is running…',
  'diagnosis.progress.step': 'AI analysis: {step} ({percent}%)',
  'error.analysis_failed.message':
    'The AI analysis failed in LoadCraft; the text of its error is not shown.',
  'error.analysis_failed.hint':
    'Run results_analyze_run again with force: true; if it fails again, run /loadcraft:doctor.',
  'error.analysis_refused.message':
    'LoadCraft refused the AI analysis; the text of its refusal is not shown.',
  'error.analysis_refused.hint':
    'Do not retry: LoadCraft says another attempt fails the same way. Tell the user.',
  'error.analysis_series_expired.message':
    'The AI analysis cannot be made: the metric series of this test have expired.',
  'error.analysis_series_expired.hint':
    'Do not retry. results_get_report still shows the results stored after the test.',
  'error.analysis_not_produced.message':
    'The AI analysis was not produced within 5 minutes; the cause is unknown.',
  'error.analysis_not_produced.hint': 'Run results_analyze_run again with force: true.',
  'report.compare.with': 'with {previous}',
  'report.compare.incomparable': 'not comparable with {previous}: {reasons}',
  'report.compare.noFigures':
    'no figures side by side: the difference would measure the conditions, not the code',
  'report.compare.diff.profile': 'different load (was {was}, now {is})',
  'report.compare.diff.workload': 'different load',
  'report.compare.diff.environment': 'different environment',
  'report.compare.diff.scope': 'different scenario or composition',
  'report.compare.diff.unspecified': 'LoadCraft reports the runs as not comparable',
  'report.compare.diff.cancelled.previous': 'the earlier run was cancelled',
  'report.compare.diff.cancelled.current': 'this run was cancelled',
  'report.compare.diff.run_failed.previous': 'the earlier run failed',
  'report.compare.diff.run_failed.current': 'this run failed',
  'report.compare.note.unverified':
    'it is not known whether the conditions were the same: LoadCraft recorded too little about one of the runs (load, target or build)',
  'report.compare.note.capped.previous':
    'the earlier run was limited by the environment ({to} of {from})',
  'report.compare.note.capped.current': 'this run was limited by the environment ({to} of {from})',
  'report.compare.note.capped.unknown.previous': 'the earlier run was limited by the environment',
  'report.compare.note.capped.unknown.current': 'this run was limited by the environment',
  'report.compare.note.durations': 'the runs lasted differently ({was} and {is})',
  'report.compare.note.p95Sources':
    'the p95 of the two runs comes from different (or unknown) estimators: shown as ≈ and not assessed',
  'report.compare.row.p95': 'p95',
  'report.compare.row.errors': 'errors',
  'report.compare.row.perSecond': 'requests/s',
  'report.compare.better': 'improvement',
  'report.compare.worse': 'regression',
  'report.compare.same': 'no significant change',
  'report.compare.changed': 'changed',
  'report.compare.unknown': 'not measured in one of the runs',
  'report.compare.threshold':
    'p95 of the whole test; a change under {pct}% is noise (errors: also one under {points} percentage points)',
  'report.compare.composition': 'composition: the figures and their change, no assessment of it',
  'error.compare_same_run.message': 'compare_to names the test being reported ({execution}).',
  'error.compare_same_run.hint':
    'Give the earlier run to compare with: its handle from process_get_status or an earlier run_start.',
  'error.compare_no_result.message':
    'LoadCraft holds no result for {execution}, so it cannot be compared.',
  'error.compare_no_result.hint':
    'Compare with a run that finished and left a result; process_get_status lists the recent ones.',
  'error.result_needs_data.message': 'The data of a result is only given in the data format.',
  'error.result_needs_data.hint':
    'This is for a client that draws results. To read a result, call its own tool (results_get_report, results_analyze_run, flows_get).',
  'error.result_not_available.message': 'LoadCraft holds no {kind} for {id}.',
  'error.result_not_available.hint':
    'Call the tool of that result (results_analyze_run starts an analysis when the user wants one) instead of asking process_get_status for it.',
  'error.run_in_progress.message':
    'The test {execution} is still running, so there is no report yet.',
  'error.run_in_progress.hint':
    'Call process_wait with operation "{operation}", then call results_get_report again.',
  'suggest.title': {
    one: '{count} journey proposal from the API documentation:',
    other: '{count} journey proposals from the API documentation:',
  },
  'suggest.none': 'The API documentation gave no journey proposals.',
  'suggest.type.semantic': 'journey',
  'suggest.type.tag_group': 'feature',
  'suggest.type.crud': 'CRUD',
  'suggest.type.auth_rejection': 'expects 401',
  'suggest.type.async_polling': 'polling',
  'suggest.type.journey_slice': 'rung',
  'suggest.unordered':
    'Steps joined by · are a set: the generator sets the order of steps when it builds.',
  'suggest.ladder': {
    one: 'ladder: {count} rung, {first} ({firstSteps}) to {last} ({lastSteps})',
    other: 'ladder: {count} rungs, {first} ({firstSteps}) to {last} ({lastSteps})',
  },
  'suggest.ladderSteps': { one: '{count} step', other: '{count} steps' },
  'suggest.ladderRungs': 'rungs:',
  'suggest.more': '… and {count} more, saved for the build but not listed here',
  'suggest.coverage': '{covered} of {total} operations · {outside} outside the journeys',
  'suggest.uncovered': 'outside the journeys: {names}',
  'suggest.failed': 'not refined: {names}; call again with force: true to retry them',
  'suggest.heuristicOnly': 'heuristic proposals, not refined by the model (refine: false)',
  'suggest.progress.start': 'Looking for user journeys in the API documentation…',
  'suggest.progress.step': '{label}: {described} of {total}',
  'suggest.progress.label': '{label}',
  'suggest.advice.retry': 'Run flows_suggest_journeys again.',
  'suggest.advice.noRefine': 'Use refine: false for proposals without the model.',
  'error.no_openapi_spec.message':
    'The project has no OpenAPI documentation to propose journeys from.',
  'error.no_openapi_spec.hint':
    'Add the documentation (project_import_docs, or project_analyze_setup with the document), or build flows another way: flows_describe_journeys or flows_import_har.',
  'error.websocket_unavailable.message':
    'The WebSocket channel to LoadCraft cannot be opened from this network, and LoadCraft cancels a refinement that nobody watches.',
  'error.websocket_unavailable.hint': '{advice}',
  'error.refine_failed.message':
    'LoadCraft could not refine the journey proposals; the text of its error is not shown.',
  'error.refine_failed.hint': '{advice}',
  'error.refine_cancelled.message': 'LoadCraft cancelled the refinement of the proposals.',
  'error.refine_cancelled.hint':
    'Run flows_suggest_journeys again and keep the call open: LoadCraft stops a refinement that nobody watches after 45 s.',
  'error.refine_expired.message':
    'The refinement of the proposals expired: LoadCraft stops a refinement that nobody watches after 45 s, or it forgot the job.',
  'error.refine_expired.hint':
    'Call flows_suggest_journeys again to start a new refinement and keep the call open.',
  // ---- flows_import_har --------------------------------------------------------------------------
  'importHar.progress.upload': 'uploading… {seconds} s',
  'importHar.progress.analyze': 'analysing… {seconds} s',
  'importHar.size.mb': '{count} MB',
  'importHar.size.kb': '{count} KB',
  'importHar.filtered': {
    one: '{count} filtered out as noise',
    other: '{count} filtered out as noise',
  },
  'importHar.summary.sent': 'sent {size} · {requests} · {filtered}',
  'importHar.summary.reused': 'already sent {size} · {requests} · {filtered}',
  'importHar.login': 'login: {auth} · address: {address}',
  'importHar.address.default': '{environment} (default)',
  'importHar.auth.none': 'not detected',
  'importHar.auth.bearer_token': 'token',
  'importHar.auth.cookie_session': 'session cookie',
  'importHar.auth.basic_auth': 'Basic credentials',
  'importHar.auth.other': '{kind}',
  'importHar.auth.from': '{kind} from {endpoint}',
  'importHar.paths': {
    one: '{count} action group in the recording',
    other: '{count} action groups in the recording',
  },
  'importHar.paths.none': 'no action groups found in the recording',
  'importHar.more': '… and {count} more',
  'importHar.corr.title': 'correlations: {parts}',
  'importHar.corr.none': 'correlations: none found',
  'importHar.corr.accepted': {
    one: '{count} accepted automatically',
    other: '{count} accepted automatically',
  },
  'importHar.corr.uncertain': { one: '{count} uncertain', other: '{count} uncertain' },
  'importHar.corr.ambiguous': { one: '{count} ambiguous', other: '{count} ambiguous' },
  'importHar.warning.sanitized_export':
    'The recording has no response bodies (and no cookies), so no flow can be generated from it. Record it again in Chrome DevTools with "Allow generating HAR with sensitive data" enabled, save it as HAR and send it again.',
  'importHar.warning.different_host':
    'The address in the recording ({host}) is not the default environment ({environment}). Check which environment you want to test.',
  'importHar.warning.empty_har': 'The recording has no requests.',
  'importHar.warning.all_static':
    'Every request in the recording is a static file. Record a session that uses the application.',
  'importHar.warning.weak_response_har':
    'The recording has little response content; correlations will be conservative.',
  'importHar.warning.llm_fallback':
    'The language model was unavailable, so noise was scored by a heuristic.',
  'importHar.warning.backend': 'LoadCraft also reported: {code}.',
  'error.har_proxy_timeout.message':
    'The call failed after about a minute (HTTP {status}): a server between the plugin and LoadCraft cut it. This deployment is probably behind a proxy with the default time limit.',
  'error.har_proxy_timeout.hint':
    'Ask whoever runs this LoadCraft to raise the proxy time limit for the HAR routes to 300 s, then send the recording again.',
  // project setup: project_create, project_save_env, project_check_env, project_analyze_setup, project_apply_setup
  'initProject.header.project': 'Project “{name}”',
  'initProject.header.reused': 'existing',
  'initProject.header.noDocs': 'no API documentation',
  'initProject.header.operations': { one: '{count} operation', other: '{count} operations' },
  'initProject.analysis.label': 'project analysis',
  'initProject.analysis.none':
    'project analysis: no material · the HAR recording will fill the profile',
  'initProject.analysis.queued': 'project analysis: queued',
  'initProject.analysis.running': 'project analysis in progress',
  'initProject.analysis.progress': 'project analysis: {label}',
  'initProject.analysis.step.input_to_messages': 'preparing the material',
  'initProject.analysis.step.parse_uploaded_evidence': 'reading the uploaded material',
  'initProject.analysis.step.fetch_docs_evidence': 'fetching the documentation',
  'initProject.analysis.step.fetch_repo_evidence': 'reading the repository',
  'initProject.analysis.step.aggregate_evidence': 'putting the material together',
  'initProject.analysis.step.enrich_profile': 'inferring the profile (model)',
  'initProject.analysis.step.enrich_modules': 'naming the modules (model)',
  'initProject.analysis.step.enrich_summary': 'summarizing the application (model)',
  'initProject.analysis.step.finalize_response': 'finishing the analysis',
  'initProject.profile.line': 'profile: {fields}',
  'initProject.profile.fields': { one: '{count} field', other: '{count} fields' },
  'initProject.profile.toReview': { one: '{count} to check', other: '{count} to check' },
  'initProject.profile.applied': 'profile applied ✓',
  'initProject.profile.notApplied': 'profile not applied',
  'projectSetup.analysis.proposed': 'proposed profile: {fields}',
  'projectSetup.analysis.next':
    '→ next: project_apply_setup with analysis "{operation}"; it applies the proposed profile and adds the default validators and test types',
  'projectSetup.analysis.nextWithout':
    '→ next: project_apply_setup without analysis; it adds the default validators and test types',
  'error.setup_analysis_running.message':
    'The project analysis {operation} is still running; its proposals are not ready.',
  'error.setup_analysis_running.hint':
    'Continue with process_wait and that handle, then call project_apply_setup again.',
  'error.setup_analysis_other_project.message':
    'The project analysis {operation} belongs to another project; its proposals are not applied to this one.',
  'error.setup_analysis_other_project.hint':
    'Run project_analyze_setup for the bound project and pass the handle its result names.',
  'initProject.provision.validators': 'validators {count}',
  'initProject.provision.testTypes': 'test types {count}',
  'initProject.provision.toReview': '(to review)',
  'initProject.auth.label': 'login: {login}',
  'initProject.auth.tokenFrom': 'token from {endpoint}',
  'initProject.auth.methodAt': '{method} ({endpoint})',
  'initProject.auth.bearer_jwt': 'JWT token',
  'initProject.auth.session_cookie': 'session cookie',
  'initProject.auth.oauth2_code': 'OAuth2 (code)',
  'initProject.auth.oauth2_pkce': 'OAuth2 (PKCE)',
  'initProject.auth.api_key': 'API key',
  'initProject.auth.basic': 'Basic',
  'initProject.auth.saml': 'SAML',
  'initProject.auth.none': 'no login',
  'error.setup_analysis_failed.message':
    'LoadCraft could not finish the project analysis ({phase}): {message}',
  'error.setup_analysis_failed.hint':
    'Remove the cause (fix the documentation or the description) and run project_analyze_setup again; it repeats the analysis, and project_apply_setup finishes the setup.',
  'initProject.connection.ok': 'connection ok: {names}',
  'initProject.connection.both': '(API and frontend)',
  'initProject.connection.apiOnly': '(API)',
  'initProject.connection.problem': 'connection {name}: {parts}',
  'initProject.probe.api': 'API {status}',
  'initProject.probe.frontend': 'frontend {status}',
  'initProject.status.ok': 'ok',
  'initProject.status.blocked': 'blocked: a private address LoadCraft cannot reach',
  'initProject.status.unreachable': 'unreachable',
  'initProject.status.tls_error': 'TLS error',
  'initProject.status.too_many_redirects': 'too many redirects',
  'initProject.status.not_checked': 'not checked',
  'initProject.connection.next':
    '→ LoadCraft could not reach the address above: check it with the user and correct it (a blocked address is a private one, which LoadCraft cannot reach), then correct it in the environment settings in LoadCraft (project_save_env adds environments, it never changes the address of one) and call project_check_env again; run no test and create no accounts on that environment until it answers.',
  'initProject.status.other': '{status}',
  'initProject.env.differs':
    'warning: environment {name} has another {field} than requested: {current} (requested {requested}) — unchanged',
  'initProject.env.none': 'none',
  'initProject.env.protectionSet': '{name}: protection set ({limit})',
  'initProject.env.protectionKept':
    'warning: environment {name} stays protected: {current}. The looser part of the request ({parts}) was not applied; protection is loosened or removed only in the LoadCraft interface, by a person.',
  'initProject.env.protectionKeptNoLimit':
    'warning: environment {name} stays protected: {current}. The request has no limit for it, so nothing was loosened; protection is removed only in the LoadCraft interface, by a person.',
  'initProject.header.areas': { one: '{count} area', other: '{count} areas' },
  'initProject.conformance.label': 'conformance: {parts}',
  'initProject.conformance.exists': '{count} GET ✓',
  'initProject.conformance.missing': 'missing {count}: {paths}',
  'initProject.conformance.more': 'and {count} more',
  'initProject.conformance.inconclusive': 'inconclusive {count}',
  'initProject.conformance.inconclusiveStatuses': 'inconclusive {count} (HTTP {statuses})',
  'initProject.conformance.reportStatus': 'report {status}',
  'initProject.conformance.headersHint':
    'Most probes got 400, 401 or 403: check the fixed headers and the authentication of the environment; project_save_env sets the headers',
  'initProject.conformance.unchecked': '{count} unchecked ({reasons})',
  'initProject.conformance.reason.methods': 'non-GET',
  'initProject.conformance.reason.params': 'path parameters',
  'initProject.conformance.reason.offHost': 'another host',
  'initProject.conformance.headersSent': 'headers sent: {names}',
  'initProject.conformance.headersHintSent':
    'Most probes got 400, 401 or 403 although headers {names} were sent: check their values and the authentication of the environment; project_save_env sets the headers',
  'initProject.conformance.headersHintNone':
    'Most probes got 400, 401 or 403 and no fixed header was sent: the target may need a header (such as an API key); project_save_env sets the headers of the environment',
  'initProject.conformance.skipped': 'conformance: skipped — environment is protected',
  'initProject.conformance.failed': 'conformance: check failed',
  'initProject.review.heading': 'to check, ask the user:',
  'initProject.review.model': 'model',
  'initProject.field.api': 'API address',
  'initProject.field.frontend': 'frontend address',
  'initProject.field.limit': 'limit',
  'error.project_name_taken.message':
    'The project name "{name}" is already taken in LoadCraft by a project this API token cannot see.',
  'error.project_name_taken.hint':
    'Ask the user for another project name, or for access to the existing project, then repeat project_create.',
  'error.init_project_default_repeated.message':
    'More than one environment is marked as the default: {names}.',
  'error.init_project_default_repeated.hint':
    'Mark exactly one environment with default: true (with none marked, the first one is the default).',
  'error.init_project_environment_repeated.message':
    'The environment name "{name}" is used more than once.',
  'error.init_project_environment_repeated.hint': 'Give every environment a name of its own.',
  'error.init_project_environment_not_protected.message':
    'The requested limit and protection were not set on environment "{environment}": the write failed or LoadCraft does not report it. The environment may be unprotected.',
  'error.init_project_environment_not_protected.hint':
    'Do not run tests on it. Set the limit in the environment settings in LoadCraft (or ask the user to), then call process_get_status to check that the environment shows as protected.',
  'error.init_project_address_invalid.message':
    'The {field} address of environment "{environment}" is not a valid http(s) address.',
  'error.init_project_address_invalid.hint':
    'Pass a host (api.example.com) or an http(s) address without a user name or password.',
  'error.init_project_header_name_invalid.message':
    'The header name "{name}" of environment "{environment}" cannot be used.',
  'error.init_project_header_name_invalid.hint':
    'A header name is letters, digits and hyphens and starts with a letter (x-api-key). Host, Content-Length, Transfer-Encoding, Connection and Authorization are not accepted. Correct the name and repeat the call.',
  'error.init_project_header_repeated.message':
    'The header "{name}" is listed more than once for environment "{environment}".',
  'error.init_project_header_repeated.hint':
    'List each header once; names are compared without regard to case.',
  'error.init_project_header_variable_missing.message':
    'The variable {variable} (header "{name}" of environment "{environment}") is missing or empty in {file}.',
  'error.init_project_header_variable_missing.hint':
    'Ask the user to add {variable} to {file}, or for the name of the variable that holds the value (or the file that does), then repeat the call. Never ask for the value and never read the file yourself.',
  'error.init_project_header_value_invalid.message':
    'The value of {variable} in {file} cannot be sent as a header: it holds a line break or another control character.',
  'error.init_project_header_value_invalid.hint':
    'Ask the user to correct the variable in the file (one line, no control characters), then repeat the call.',
  'error.init_project_headers_unpreservable.message':
    'Environment "{environment}" has headers that LoadCraft masks ({names}); the update replaces the whole set and a masked value cannot be sent back, so they would be lost.',
  'error.init_project_headers_unpreservable.hint':
    'The headers of that environment were not changed. List every header of that environment in the call (each from a variable in the env file), or ask the user to set the headers in the environment settings in LoadCraft, then repeat the call.',
  'error.init_project_headers_not_set.message':
    'The headers of environment "{environment}" were not stored: LoadCraft does not report them after the write.',
  'error.init_project_headers_not_set.hint':
    'Run no test on it. Repeat the call, or ask the user to set the headers in the environment settings in LoadCraft.',
  'initProject.headers': 'headers: {list}',
  'initProject.headers.item': '{name} from {variable}',
  'error.init_project_description_too_long.message':
    '{source} has {length} characters; a project description holds at most {limit}.',
  'error.init_project_description_too_long.hint':
    'Shorten it to {limit} characters and repeat the call.',
  'error.full_rebuild_required.message':
    'The self-check cannot run: this scenario has no modular build.',
  'error.full_rebuild_required.hint':
    'Regenerate the scenario with scenario_generate, then run scenario_check_self again.',
  'selfCheck.header': 'self-check · {environment} (default) · 1 user · one pass',
  'selfCheck.headerNoEnvironment': 'self-check · 1 user · one pass',
  'selfCheck.phase.pending': 'queued',
  'selfCheck.phase.running': 'checking',
  'selfCheck.phase.repairing': 'AI repair',
  'selfCheck.pending': 'queued',
  'selfCheck.running': 'checking',
  'selfCheck.repairing': 'AI repair in progress',
  'selfCheck.passedNoChain': '✓ passed · request chain unavailable',
  'selfCheck.repairCount': { one: 'after {count} repair', other: 'after {count} repairs' },
  'selfCheck.run': 'attempt {n} · version {version}',
  'selfCheck.runBare': 'attempt {n}',
  'selfCheck.stepsOmitted': {
    one: '… {count} step not listed',
    other: '… {count} steps not listed',
  },
  'selfCheck.attemptsOmitted': {
    one: '… {count} attempt not shown',
    other: '… {count} attempts not shown',
  },
  'selfCheck.failed': '✕ failed',
  'selfCheck.repair': 'AI repair: {changes}',
  'selfCheck.repairBare': 'AI repair',
  'selfCheck.repairVersion': 'version {version}',
  'selfCheck.repairRefused': 'AI repair refused: {reason}',
  'selfCheck.waiting_for_data': 'waiting for data: {slots}',
  'selfCheck.waiting_for_dataBare': 'waiting for data',
  'selfCheck.next.waiting_for_data':
    '→ read data_check_readiness: it names what fills each slot (data_create_dataset for plain data or a CSV file, data_create_accounts for accounts after the user agrees); then run scenario_check_self again.',
  'selfCheck.target_unreachable': 'target unreachable',
  'selfCheck.not_admitted': 'not admitted to run: {reason}',
  'selfCheck.reason.no_default_environment': 'the project has no default environment',
  'selfCheck.reason.protected_environment_requires_caps':
    'the default environment is protected and has no load limits',
  'selfCheck.skipped_protected_environment': 'skipped: the default environment is protected',
  'selfCheck.interrupted': 'interrupted (LoadCraft restarted) — run it again',
  'selfCheck.disabled': 'switched off in the project profile',
  'selfCheck.goal_step_missing': 'the flow has no step that ends the journey',
  'selfCheck.goal_step_missingAt': 'the flow has no step that ends the journey: {goal}',
  'selfCheck.other': 'status: {status}',
  'selfCheck.next.failed':
    '→ read the failing step and its response above, then act on the cause: 401 or 403 is the login or the accounts; 400 that names a key or a header is a fixed header of the environment (project_save_env with headers); for any other cause tell the user what the response shows. Do not run the test.',
  'selfCheck.next.goal_step_missing':
    '→ the flow never reaches its goal: build it again (flows_generate_from_endpoints under another name, flows_describe_journeys or flows_generate_from_har) and tell the user; do not run the test.',
  'selfCheck.next.target_unreachable':
    '→ the default environment did not answer: ask the user whether the application runs there and whether LoadCraft can reach its address; run no test until it answers.',
  'selfCheck.next.not_admitted':
    '→ LoadCraft did not let the check start, for the reason above: tell the user and do not work around it.',
  'selfCheck.next.skipped_protected_environment':
    '→ nothing was checked: the scenario is unchecked, so say so; the user decides whether to go on.',
  // run_plan
  'profiles.title': {
    one: 'Load profiles for {count} user on {environment}',
    other: 'Load profiles for {count} users on {environment}',
  },
  'profiles.limit.caps': 'Limit of {environment}: {caps}.',
  'profiles.limit.none': '{environment} has no load limits.',
  'profiles.limit.protectedNoCaps':
    '{environment} is protected and has no load limits, so run_start will refuse to start there.',
  'profiles.cap.users': { one: '{count} user', other: '{count} users' },
  'profiles.cap.rate': '{value} new/s',
  'profiles.default': '(default)',
  'profiles.desc.ramp': '{users} spread over {ramp}',
  'profiles.desc.constant': '{rate} new/s for {hold}',
  'profiles.desc.ramp_hold': '{users} in {ramp}, then {rate} new/s for {hold}',
  'profiles.desc.stress': '5 steps of {step}, up to {peak} new/s',
  'profiles.desc.constant_concurrency': '{users} concurrent for {hold}',
  'profiles.desc.ramp_concurrency': '0 → {users} concurrent over {ramp}',
  'profiles.desc.spike': '{users} at once, {hold} pause, then {peak}',
  'profiles.desc.soak': '{users} concurrent for {hold}',
  'profiles.marker.clamped': '→ clamped to {to}',
  'profiles.marker.spike':
    '→ clamped to {to} (limit {limit} ÷ 2: the second burst is twice the first)',
  'profiles.marker.refused':
    '→ not available: a limit of {limit} fits no spike (the second burst is twice the first)',
  'profiles.marker.stressFloor': '(the steps always climb to at least {peak} new/s)',
  'profiles.data.ready': 'data ✓',
  'profiles.data.short': 'data ✕ {slots}',
  'profiles.data.slot': '{label}: {have} of {need} rows',
  'profiles.data.refused': 'data ✕ {reason}',
  'profiles.data.slotNone': '{label}: no dataset',
  'profiles.json.title': 'The "profile" argument of run_start, per number above:',
  'profiles.next':
    'Next: run_start with the profile you pick, passing its line above as "profile".',
  // ---- flows_generate_* -------------------------------------------------------------------
  'build.progress': '{done}/{total} · {name}…',
  'build.progress.done': '{done}/{total}',
  'build.flows.partial': {
    one: '{count} of {total} flows ready',
    other: '{count} of {total} flows ready',
  },
  'build.flows.single': 'flow "{name}" ready · {steps} ({requests} · {pauses})',
  'build.manual.running': 'Generating "{name}"…',
  'build.manual.progress': 'Generating "{name}": {step}…',
  'build.manual.noDetail': 'LoadCraft gave no reason',
  'build.manual.unknownIds': {
    one: 'the endpoint {ids}',
    other: 'the endpoints {ids}',
  },
  'build.manual.closest': ' Closest known: {items}.',
  'error.unknown_endpoints.message': 'LoadCraft does not know {what}.{closest}',
  'error.unknown_endpoints.hint':
    'Pass endpoints as "METHOD /path" (for example "POST /auth/login"), a UUID or an operationId that the API documentation lists.',
  'error.flow_exists.message':
    'A flow named "{name}" already exists; {tool} does not overwrite it.',
  'error.flow_exists.hint': 'Call {tool} again with another name.',
  'error.flow_generation_failed.message': 'The flow "{name}" was not built: {detail}',
  'error.flow_generation_failed.hint':
    'Check the arguments of the call, then call {tool} again; a second try can succeed.',
  'error.flow_generation_cancelled.message':
    'The generation of the flow "{name}" was cancelled in LoadCraft.',
  'error.flow_generation_cancelled.hint': 'Call {tool} again if the flow is still wanted.',
  'build.har.generating': 'Generating the flow from the recording… {seconds} s',
  'build.har.progress': 'Generating from the recording: {step}…',
  'build.har.accepted': {
    one: 'Split accepted: {count} journey, building its flow…',
    other: 'Split accepted: {count} journeys, building their flows…',
  },
  'build.har.building': 'Building the flows: {step}…',
  'build.har.advice.retry':
    'A second try can succeed: call flows_generate_from_har again with the same arguments.',
  'build.har.advice.fix':
    'Record the journey again, or build the flow another way (flows_describe_journeys, or by hand).',
  'build.har.advice.noSplit':
    'To build without a split, call flows_generate_from_har with split: false and a name: one flow from the whole recording.',
  'build.har.splitting': 'LoadCraft is splitting the recording into journeys…',
  'error.har_split_abandoned.message':
    'The split of the recording ended with the server process that held its connection; LoadCraft drops such a run, and no flow from it was found.',
  'error.har_split_abandoned.hint':
    'Start again: call flows_generate_from_har with the same har and split: true (not process_wait).',
  'build.har.where.channel': 'error on the HAR channel',
  'build.har.where.http': 'HTTP {status}',
  'build.flows.note.single_journey':
    'The recording holds one journey, so LoadCraft built one flow without a split.',
  'error.har_path_excluded.message':
    '{file} is in a hidden directory, in node_modules or is a hidden file; recordings are not sent from there.',
  'error.har_path_excluded.hint':
    'Ask the user to save the recording in the project (e.g. recordings/session.har) and pass that path. Nothing was sent.',
  'error.har_split_missing.message':
    'Building from a recording needs split: whether to split it into journeys or build one flow.',
  'error.har_split_missing.hint':
    'Ask the user whether to split the recording (one flow per journey) or build one flow, then call flows_generate_from_har again with split: true or split: false.',
  'error.har_name_required.message':
    'One flow from the whole recording (split: false) needs a name.',
  'error.har_name_required.hint':
    'Ask the user for the name of the flow and call flows_generate_from_har again with name.',
  'error.har_paths_without_split.message':
    'paths picks journeys of a split, and this call has split: false.',
  'error.har_paths_without_split.hint': 'Pass split: true with paths, or leave paths out.',
  'error.har_split_unknown_paths.message':
    'LoadCraft proposed no journey named {names}; it proposed: {available}. The run was cancelled and nothing was built.',
  'error.har_split_unknown_paths.hint':
    'Call flows_generate_from_har again with paths from this list, or without paths to build them all.',
  'error.har_split_interrupted.message':
    'The connection to LoadCraft broke while it was splitting the recording; LoadCraft drops such a run, and no flow was built.',
  'error.har_split_interrupted.hint':
    'Call flows_generate_from_har again with the same arguments: the whole split runs again. If the connection keeps breaking, use split: false.',
  'error.har_split_timeout.message':
    'LoadCraft did not finish splitting the recording within {minutes} minutes; the run was cancelled.',
  'error.har_split_timeout.hint':
    'Call flows_generate_from_har again later, or use split: false to build one flow from the whole recording.',
  'error.har_split_cancelled.message': 'The split of the recording was cancelled in LoadCraft.',
  'error.har_split_cancelled.hint':
    'Call flows_generate_from_har again if the flows are still wanted.',
  'error.har_split_unavailable.message':
    'The WebSocket channel LoadCraft splits recordings on cannot be opened from this network.',
  'error.har_split_unavailable.hint':
    'Use split: false (one flow from the whole recording over plain HTTP), or run /loadcraft:doctor.',
  'error.har_generation_failed.message':
    'LoadCraft could not build flows from the recording ({where}); its own text is not shown, as it can quote the recording.',
  'error.har_generation_failed.hint': '{advice}',
  'error.har_recording_incomplete.message':
    'The recording was saved without response bodies and session headers, so a flow built from it could not log in.',
  'error.har_recording_incomplete.hint':
    'Ask the user to record again with "Allow generating HAR with sensitive data" turned on in the browser developer tools before saving the HAR, then call the same tool again with the new file.',
  'error.har_session_expired.message':
    'LoadCraft no longer holds the recording (it was restarted, or the session expired); no flow was built.',
  'error.har_session_expired.hint':
    'Call flows_generate_from_har again with the same arguments: the recording is sent again first.',
  'build.flows.unchecked':
    'The name was not checked for uniqueness among all {total} flows of the project.',
  'build.flows.item': '{name} {steps}',
  'build.flows.failed': '✕ {name}: error',
  'build.flows.failedRetry': '✕ {name}: error (can be retried)',
  'build.flows.warning': '⚠ Not ready to run: {flows} gets 401 on some steps (details below).',
  'build.flows.credential.definite':
    '✕ {flow}: {steps} will get 401: they carry a token issued for another security scheme.',
  'build.flows.credential.doubt':
    '? {flow}: {steps} may carry a token the documentation does not accept for them.',
  'build.flows.static':
    '! {flow}: no value for the API key of the application under test in header "{header}"{where}.',
  'build.flows.static.anyEnv': ' in the environment you run against',
  'build.flows.next.definite':
    'Add the login operation of that security scheme to the flow and rebuild the flow with flows_generate_from_endpoints; until then these steps fail with 401.',
  'build.flows.next.doubt':
    'Ask the user which token those steps should carry; do not answer it yourself and do not run the flow before.',
  'build.flows.next.static':
    'Set the header {headers} in the environment with project_save_env (from_env, so the value stays out of the chat): it is the API key of the target application, not your LoadCraft token; ask the user for it.',
  'build.flows.question': 'question · {flow}: {question}',
  'build.flows.retry':
    'To retry, call flows_generate_from_suggestions again with suggestions: {names}.',
  'build.flows.reason.not_created':
    'the flow was not created, cause unknown (the live channel was unavailable)',
  'build.flows.reason.no_result': 'the run ended without a result for it',
  'build.flows.reason.unreadable': 'the flow was created but LoadCraft did not return it',
  'build.flows.reason.too_large':
    'LoadCraft refused it: the journey covers too many operations, or schemas too large, for the model; a second try fails the same way',
  'build.flows.reason.refused': 'LoadCraft refused it; a second try fails the same way',
  'build.flows.reason.validation':
    'the flow LoadCraft generated failed its own checks; a second try can fail the same way',
  'build.flows.reason.validation_auth':
    'The flow LoadCraft generated failed its checks on authorization: the journey needs a login, but no step calls the token endpoint; a second try can fail the same way',
  'build.advice.too_large':
    'Split the journey into smaller ones: pick a proposal with fewer of those operations, or build the flow from a HAR recording or a description (flows_import_har, flows_describe_journeys).',
  'build.advice.retry':
    'Call flows_generate_from_suggestions again with the failed names; a second try can succeed.',
  'build.advice.auth':
    'If the journey is a login or an account one, check that the documentation describes the token endpoint (LoadCraft cannot add a login step without it); otherwise pick another proposal from flows_suggest_journeys, describe the journey in your own words (flows_describe_journeys), or build the flow from a recording (flows_import_har).',
  'build.advice.fix':
    'LoadCraft refused this journey and the reason is not shown here. Pick another proposal from flows_suggest_journeys, describe the journey in your own words (flows_describe_journeys), or build the flow from a recording (flows_import_har). If it is a login or an account journey, check that the documentation describes the token endpoint.',
  'error.no_suggestions.message': 'No journey proposals are saved for this project.',
  'error.no_suggestions.hint':
    'Call flows_suggest_journeys first, then flows_generate_from_suggestions with names from its list.',
  'error.unknown_suggestions.message':
    'No saved proposal is named {names}; the saved ones are: {available}.',
  'error.unknown_suggestions.hint':
    'Use names from this list, or call flows_suggest_journeys again for fresh proposals.',
  'error.suggestions_stale.message':
    'The saved proposals are out of date: the API documentation changed after they were made.',
  'error.suggestions_stale.hint':
    'Call flows_suggest_journeys again, then flows_generate_from_suggestions with names from the new list.',
  'error.build_flows_failed.message': 'No flow could be built: {detail}',
  'error.build_flows_failed.hint': '{advice}',

  'runStart.clamped': 'load clamped to {to} (limit of environment {environment})',
  'runStart.clamped.spike':
    'load clamped to {to} (limit of environment {environment} ÷ 2: the second burst is twice the first)',
  'runStart.data.ok': 'data check for the profile ✓',
  'runStart.data.slot': '{name} {have} ≥ needed ~{need}',
  'runStart.data.slotShort': '{label}: {have} of {need} rows',
  'runStart.data.slotNone': '{label}: no usable dataset ({status})',
  'runStart.data.notReady': 'the data check did not pass',
  'runStart.started': 'test started · {label} · {shape}',
  'runStart.confirm.head': 'Test of {target} not started: {reason}; nothing was sent.',
  'runStart.confirm.numbers':
    'Asked for: {profile}, {requested} · would run with: {effective} · limit of {environment}: {limit}',
  'runStart.confirm.next':
    'Ask the user, and only after a yes repeat the call with the same arguments and confirm_capped: true.',
  'runStart.confirm.protected': '{environment} is protected',
  'runStart.confirm.clamped':
    'the profile is above the limits of {environment} and will be clamped',
  'runStart.confirm.both':
    '{environment} is protected and the profile is above its limits, so it will be clamped',
  'migrateDocs.capabilityAdvice':
    ' Until then a scenario built from these flows reads the docs version they are pinned to.',
  'migrateDocs.nothing':
    'No flow is on an older docs version: every pinned flow is on {target}. Nothing to migrate.',
  'migrateDocs.flows': { one: '{count} flow', other: '{count} flows' },
  'migrateDocs.steps': { one: '{count} step', other: '{count} steps' },
  'migrateDocs.counts': '{steps}: {matched} matched, {changed} changed, {unmatched} unmatched',
  'migrateDocs.more': '… and {count} more',
  'migrateDocs.preview.head': 'Preview, nothing was saved: {flows} → docs version {target}',
  'migrateDocs.preview.next':
    'Show this to the user and ask which value differences to adopt. Then call flows_migrate_docs without preview, with the same flow_ids and adopt_value_ids (or adopt_values: "all"): it returns the consent card.',
  'migrateDocs.preview.allowUnmatched':
    'A flow marked "moves only with allow_unmatched" stays where it is unless the user agrees to allow_unmatched: true; its steps without an endpoint keep their request but lose the link to the docs.',
  'migrateDocs.preview.nothing': 'No flow can move: read the refusals with the user.',
  'migrateDocs.needsAllowUnmatched': 'moves only with allow_unmatched: a step lost its endpoint',
  'migrateDocs.refused': 'refused: {reason}',
  'migrateDocs.refusal.flow_not_found': 'no such flow in the project',
  'migrateDocs.refusal.not_pinned':
    'the flow has no docs pin; it already reads the current version',
  'migrateDocs.refusal.already_on_target': 'already on the target version',
  'migrateDocs.refusal.source_spec_missing': 'the docs version it is pinned to no longer exists',
  'migrateDocs.refusal.unmatched_steps':
    'steps lost their endpoint in the target version (allow_unmatched was not set)',
  'migrateDocs.refusal.lint_failed': "the flow would not pass LoadCraft's check after the move",
  'migrateDocs.refusal.unknown': 'not migrated',
  'migrateDocs.unmatched': 'step',
  'migrateDocs.reason.endpoint_removed': 'endpoint removed',
  'migrateDocs.reason.unbound': 'no endpoint, left as it is',
  'migrateDocs.value': 'value',
  'migrateDocs.value.removed': '(removed)',
  'migrateDocs.value.id': 'id',
  'migrateDocs.value.notAdoptable': 'reported only: a required field the target gives no value for',
  'migrateDocs.kind.example_changed': 'example changed',
  'migrateDocs.kind.example_removed': 'example removed',
  'migrateDocs.kind.not_in_enum': 'not allowed by the target',
  'migrateDocs.kind.param_removed': 'parameter removed',
  'migrateDocs.kind.required_added': 'newly required',
  'migrateDocs.check':
    'check  {step} · {selector} (saves {variable}) no longer matches the response the target documents',
  'migrateDocs.dropped': 'endpoints dropped from the flow: {endpoints}',
  'migrateDocs.staleIf': 'scenarios that go stale: {names}',
  'migrateDocs.stale': 'scenarios now stale: {names}',
  'migrateDocs.card.renewed.missing':
    'Nothing was migrated: there is no card for this confirm. This is a new card.',
  'migrateDocs.card.renewed.expired':
    'Nothing was migrated: the card had expired (30 minutes). This is a new card.',
  'migrateDocs.card.renewed.token':
    'Nothing was migrated: the token is not the one of the current card. This is a new card.',
  'migrateDocs.card.renewed.changed':
    'Nothing was migrated: the confirm carried other arguments than its card. This is a new card for them.',
  'migrateDocs.migrated.notRefreshed':
    'The list of flows could not be read after the migration; the warning about older docs follows the results above.',
  'migrateDocs.card.title': {
    one: 'Migrate {count} flow to the current docs version',
    other: 'Migrate {count} flows to the current docs version',
  },
  'migrateDocs.card.flows': 'Flows',
  'migrateDocs.card.target': 'Target docs version',
  'migrateDocs.card.adopt': 'Adopt example values',
  'migrateDocs.card.adopt.none': 'none',
  'migrateDocs.card.adopt.all': 'all',
  'migrateDocs.card.picked': { one: '{count} picked', other: '{count} picked' },
  'migrateDocs.card.allowUnmatched': 'ALLOW UNMATCHED steps',
  'migrateDocs.card.yes': 'YES',
  'migrateDocs.card.no': 'no',
  'migrateDocs.card.docs': 'Docs version',
  'migrateDocs.card.outdated': 'Outdated flows',
  'migrateDocs.card.effect':
    'Nothing was migrated yet; ask the user. Each flow keeps its id and gets a new version; its scenarios stay attached and go stale.',
  'migrateDocs.card.next': 'Only after a yes: the same call with confirm: "{token}".',
  'migrateDocs.migrated.head':
    'Migrated {count} of {flows} to docs version {target}: {matched} matched, {changed} changed, {unmatched} unmatched',
  'migrateDocs.adopted': { one: '{count} value adopted', other: '{count} values adopted' },
  'migrateDocs.undo': 'undo: restore v{version}',
  'migrateDocs.migrated.undo':
    'To undo a migration, restore the version named after "undo" in the history of the flow in LoadCraft; it moves the docs pin back too.',
  'migrateDocs.migrated.rebuild':
    'The stale scenarios still run the code built from the older docs: build them again with scenario_generate (same name and flows) before a test.',
  'migrateDocs.migrated.refused':
    'Tell the user which flows stayed and why; repeat only what the refusal allows (for example allow_unmatched: true after a yes).',
  'error.flows_migration_stale.message':
    'Nothing was migrated: {flows} changed since the preview or the card the user saw.',
  'error.flows_migration_stale.hint':
    'Call flows_migrate_docs with preview: true again, show the new preview, and ask again before you confirm.',
  'error.flows_migration_conflict.message':
    'Nothing was migrated: {flows} changed while LoadCraft was writing, so the whole migration was rolled back.',
  'error.flows_migration_conflict.hint':
    'Call flows_migrate_docs with preview: true again, show the new preview, and ask again before you confirm.',
  'error.flows_migration_values_unknown.message':
    'Nothing was migrated: these value ids are not adoptable differences of these flows: {ids}.',
  'error.flows_migration_values_unknown.hint':
    'Take the ids from a new flows_migrate_docs call with preview: true (or use adopt_values: "all"), then ask again.',
  'error.flows_migration_target_unknown.message':
    'The project has no docs version {target}; nothing was sent.',
  'error.flows_migration_target_unknown.hint':
    'Leave target_spec_id out to move the flows to the current version.',
  'oldDocs.list': {
    one: '{count} flow on an older docs version: {names}',
    other: '{count} flows on an older docs version: {names}',
  },
  'oldDocs.scenario': {
    one: '{names} is on an older docs version: the scenario will read that version, not the current one',
    other:
      '{names} are on an older docs version: the scenarios will read that version, not the current one',
  },
  'oldDocs.more': '{names} and {count} more',
  'needsInput.list': {
    one: '{count} flow with open generator questions{definite}: {names}',
    other: '{count} flows with open generator questions{definite}: {names}',
  },
  'needsInput.scenario': {
    one: '{names} has open generator questions{definite}; the scenario is built from the flow as it is',
    other:
      '{names} have open generator questions{definite}; the scenarios are built from the flows as they are',
  },
  'needsInput.run': {
    one: '{count} flow of the project has open generator questions{definite}: the results may show its failures',
    other:
      '{count} flows of the project have open generator questions{definite}: the results may show their failures',
  },
  'needsInput.definite': {
    one: ' ({count} definite: its steps get 401)',
    other: ' ({count} definite: their steps get 401)',
  },
  'needsInput.next':
    '→ flows_get shows the questions; supply the data or the key of the environment (project_save_env), or rebuild the flow; nothing is blocked',
  'oldDocs.next':
    '→ flows_migrate_docs preview: true shows what moves to the current version; the migration itself asks for consent',
  'updateOpenapi.operations': { one: '{count} operation', other: '{count} operations' },
  'updateOpenapi.version': 'version {version}',
  'updateOpenapi.current': 'new current version of the documentation',
  'updateOpenapi.currentWith': 'new current version of the documentation · {operations}',
  'updateOpenapi.previous':
    'previous ({previous}) stays in the history · flows to migrate: {flows}',
  'updateOpenapi.previousUnnamed': 'previous stays in the history · flows to migrate: {flows}',
  'updateOpenapi.flows': '{count}',
  'updateOpenapi.flows.atLeast': 'at least {count}',
  'updateOpenapi.unchanged': 'documentation unchanged, nothing was sent',
  'updateOpenapi.unchangedWith': 'documentation unchanged, nothing was sent · {operations}',
  'updateOpenapi.sameAs': 'the file has the same content as the current version ({previous})',
  'updateOpenapi.note.profile_and_test_types_not_refreshed':
    'the profile and the test types are not refreshed automatically: they were made from the previous version',
  'error.file_not_in_worktree.message':
    'The file is neither in the project directory nor in another working tree of this repository.',
  'error.file_not_in_worktree.hint':
    'Use a file inside the project directory, or inside a working tree listed by "git worktree list".',
  'error.openapi_not_json.message': '{file} is not valid JSON.',
  'error.openapi_not_openapi.message':
    '{file} is JSON, but not an OpenAPI document: it has no "openapi" or "swagger" version and no "paths".',
  'error.openapi_not_openapi.hint':
    'Check the path: send the OpenAPI document of the API (openapi.json), not another JSON file. Nothing was sent.',
  'error.openapi_not_json.hint':
    'Send the documentation as an OpenAPI .json file (convert a YAML document first).',
  'error.document_path_excluded.message':
    '{file} is in a hidden directory, in node_modules or is a hidden file; documentation is not read from there.',
  'error.document_path_excluded.hint':
    'Point to the API document in the project (e.g. openapi.json), not to a file in a hidden or dependency directory. Nothing was sent.',
  'error.document_path_ignored.message':
    '{file} is ignored by git; documentation is not read from ignored paths.',
  'error.document_path_ignored.hint':
    'Point to the committed API document, not to build output or a local file. Nothing was sent.',
  'error.asyncapi_not_asyncapi.message':
    '{file} is JSON, but not an AsyncAPI document: it has no "asyncapi" version or no "info" and "channels".',
  'error.asyncapi_not_asyncapi.hint':
    'Check the path: send the AsyncAPI document of the API, not another JSON file. Nothing was sent.',
  'status.preflight.head': 'Check before a test, nothing was started: {target} on {environment}',
  'status.preflight.protected': 'protected',
  'status.preflight.limit': 'limit {caps}',
  'status.preflight.noLimit': 'no limit',
  'status.preflight.load': '{label} {requested}',
  'status.preflight.loadClamped': '{label} {requested} → {effective} (clamped)',
  'status.preflight.consent': 'consent needed before a real test',
  'status.preflight.noConsent': 'no consent needed',
  'status.preflight.dataReady': 'data ready',
  'status.preflight.dataShort': 'data short: {rows}',
  'status.preflight.planned': 'planned {time}',
  'status.preflight.free': 'environment free',
  'status.preflight.busy': 'environment busy ({handle})',
  'status.operation.head': 'Operation {handle}',
  'status.operation.since': 'since start {time}',
  'status.operation.phase.pending': 'waiting to start',
  'status.operation.phase.building': 'building',
  'status.operation.phase.running': 'running',
  'status.operation.phase.completed': 'finished',
  'status.operation.phase.failed': 'failed',
  'status.operation.phase.cancelled': 'stopped',
  'status.operation.phase.abandoned': 'no sign of life',
  'runStart.progress.seconds': '{n} s',
  'runStart.done.build': 'build ✓ {time}',
  'runStart.done.clamped': 'clamped to {to}: this result says nothing about the full load',
  'runStart.done.completed': 'test finished · run {handle} · next: results_get_report',
  'runStart.done.cancelled': 'test stopped early · run {handle} · next: results_get_report',
  'runStart.joined':
    'A test of {target} on {environment} is already running ({handle}); no second test was started, this call follows it.',
  'error.run_already_running.message':
    'A test of {target} on {environment} is already running ({handle}); a second load on the same environment was not started.',
  'error.run_already_running.hint':
    'Call process_wait with {handle} to follow it, or start the new test after it ends.',
  'error.run_environment_busy.message':
    'Another test is already running on {environment} ({handle}, {link}); a second load on it was not started.',
  'error.run_environment_busy.hint':
    'Wait for it to end (follow it on the live page), then call run_start again, or ask the user whether to stop it.',
  'error.run_build_elsewhere.message':
    'A test of this project is being built ({handle}, {link}); its environment is not known yet, so it may be {environment}. A second load was not started.',
  'error.run_build_elsewhere.hint':
    'Wait for the build to finish (follow it on the live page), then call run_start again; ask the user if it is not their test.',
  'error.run_occupancy_unknown.message':
    'Whether the environment is free could not be established: the list of tests of this project is unreadable or incomplete ({reason}). No load was started.',
  'error.run_occupancy_unknown.hint':
    'Retry in a moment; if it persists, run /loadcraft:doctor. If the reason is page_too_recent, the last 100 tests do not reach back far enough to rule out a running one: check process_get_status or wait for the running tests to end. Do not treat the environment as free; call run_start again only after that.',
  'runStart.failed.noDetail': 'LoadCraft gave no reason',
  'error.run_failed.message': 'The test failed in LoadCraft: {detail}',
  'error.run_failed.hint':
    'Fix the cause named above, then call run_start again; the run {handle} stays in LoadCraft with its log.',
  'error.run_abandoned.message': 'The test was abandoned on the LoadCraft side (a restart?).',
  'error.run_abandoned.hint':
    'Check the state with process_get_status, then call run_start again; the run {handle} will not finish.',
  'describe.plan': 'plan {plan}',
  'describe.paths': { one: '{count} path', other: '{count} paths' },
  'describe.sharedSignIn.all': 'shared sign-in for all',
  'describe.sharedSignIn.some': 'shared sign-in for: {names}',
  'describe.dependsOnPrior': 'after the previous path',
  'describe.ownIdentity': 'own account, no shared sign-in: {names}',
  'describe.more': '+{count}',
  'describe.started.single':
    'One path: LoadCraft does not ask about a split and is already walking the application.',
  'describe.started.approved':
    'The paths were already approved in LoadCraft; the walk is under way.',
  'describe.next': 'next: flows_record_journeys with plan {plan}',
  'describe.progress.queued': 'LoadCraft is starting its browser…',
  'describe.progress.planning': 'LoadCraft is splitting the description into paths…',
  'describe.state.awaiting': 'waits for the approval of the paths',
  'describe.state.planning': 'is still planning',
  'describe.state.other': 'is {status}',
  'describe.failed.noDetail': 'LoadCraft gave no reason',
  'describe.refusal.unauthorized':
    'authentication_required: the API token was not accepted on the channel',
  'describe.refusal.not_found': 'run_not_found: the run is unknown or was started by someone else',
  'describe.refusal.forbidden':
    'HTTP 403: origin_not_allowed, project_access_denied, authentication_required or run_not_found; LoadCraft does not say which',
  'describe.unreachable.private': 'it is a private or local address',
  'describe.unreachable.blocked': 'the last connection test of the environment was blocked',
  'describe.unreachable.link_local':
    'it is a link-local address (cloud metadata range), which is never opened',
  'describe.unreachable.blocked_local':
    'the LoadCraft backend on this machine blocked it in the last connection test; its administrator can allow private targets in the backend settings',
  'error.environment_without_frontend.message':
    'Environment {environment} has no frontend address, and the LoadCraft browser opens the application there.',
  'error.environment_without_frontend.hint':
    'Ask the user for the frontend address of {environment}, add it to the environment in LoadCraft and call flows_describe_journeys again; or record the journeys in a browser and use flows_import_har.',
  'error.target_unreachable.message': 'The LoadCraft browser will not reach {url}: {reason}.',
  'error.target_unreachable.hint':
    'Use a HAR recording: the user clicks through the application in their own browser, saves a HAR file, and you pass it to flows_import_har.',
  'error.describe_run_failed.message':
    'LoadCraft could not plan the paths (run {status}): {detail}',
  'error.describe_run_failed.hint':
    'Check the address, the description and the account (the text of the failure is in the plugin log, not shown here) and call flows_describe_journeys again; nothing was saved.',
  'error.plan_not_received.message':
    'The plan of the paths did not arrive within {seconds} s; the run {state}.',
  'error.plan_not_received.hint':
    'Call flows_describe_journeys again with the same arguments: it continues this run and starts no second one. The run in LoadCraft: {link}',
  'error.describe_channel_refused.message':
    'LoadCraft refused the connection to the channel of the run ({reason}).',
  'error.describe_channel_refused.hint':
    'The run waits in LoadCraft ({link}). LOADCRAFT_API_URL must be the address LoadCraft is reached at, and a proxy in front of it must pass the Host header on; run /loadcraft:doctor.',
  'error.describe_channel_unavailable.message':
    'The WebSocket channel to LoadCraft cannot be opened from this network, and the plan of the paths and its approval go only through it.',
  'error.describe_channel_unavailable.hint':
    'The run waits in LoadCraft, where the user can approve the paths ({link}); or record the journeys in a browser and use flows_import_har.',
  'record.browser': 'Playwright · Chromium · {host}',
  'record.browser.noHost': 'Playwright · Chromium',
  'record.takeOver': 'there you take over the browser if the agent gets stuck',
  'record.path.saved': 'flow ready ✓ · {steps}',
  'record.path.partial': 'partial · {reason}',
  'record.path.failed': 'failed {attempts}',
  'record.path.failedReason': 'failed {attempts} · {reason}',
  'record.path.failedPlain': 'failed',
  'record.path.failedPlainReason': 'failed · {reason}',
  'record.path.notDriven': 'not walked: the path it continues did not reach its goal',
  'record.path.notDrivenReason': 'not walked · {reason}',
  'record.path.stopped': 'stopped',
  'record.path.stoppedReason': 'stopped · {reason}',
  'record.path.unfinished': 'not walked: the run ended first',
  'record.attempts': { one: 'after {count} attempt', other: 'after {count} attempts' },
  'record.obstacle':
    '⚠ {name}: {obstacles} — a load test will not pass this step; turn it off in the test environment',
  'record.obstacle.captcha': 'CAPTCHA',
  'record.obstacle.second_factor': 'two-factor sign-in',
  'record.obstacle.one_time_code': 'one-time code',
  'record.obstacle.payment': 'payment with 3-D Secure',
  'record.partialHelp':
    'Before trying a partial path again, open the live preview: the agent asks there for help with an obstacle only while someone watches.',
  'record.ended': 'the run ended ({status}): {detail}',
  'record.saved': { one: '{count} flow saved', other: '{count} flows saved' },
  'record.savedNone': 'no flow was saved',
  'record.progress.step': '{step}/{steps} · {label}…',
  'record.progress.label': '{label}…',
  'record.progress.driving': 'walking…',
  'record.progress.queued': 'waiting…',
  'record.progress.building': 'building the flow…',
  'record.progress.built': 'built · saved at the end',
  'record.progress.retrying': 'attempt {attempt} failed, trying again…',
  'record.progress.failed': 'failed',
  'record.progress.stopped': 'stopped',
  'record.progress.help': 'waits for help: {reason}',
  'record.progress.setup': 'shared sign-in…',
  'record.progress.awaiting': 'LoadCraft resumes the run after the approval of the paths…',
  'record.progress.start': 'LoadCraft starts walking the paths…',
  'record.progress.stopping':
    'LoadCraft is stopping the walk: the path in progress ends, built paths are saved.',
  'record.help.reason.captcha': 'a CAPTCHA',
  'record.help.reason.second_factor': 'a one-time code',
  'record.help.reason.unknown_blocker': 'an obstacle it does not know',
  'record.help.ask': 'The LoadCraft agent asks for help on the path {name}: {reason}.',
  'record.help.says': 'The agent says: "{text}"',
  'record.help.how':
    'Only the user who started the run can take over the browser, in the LoadCraft app: open the live preview and take control there.',
  'record.approvalPending':
    'The plan {plan} is waiting for approval; nothing was approved from here.',
  'record.approvalPending.paths': 'Paths of the plan: {names}.',
  'record.approvalPending.next':
    'Show the user these paths; once they approve, call flows_record_journeys with plan "{plan}". They can also approve them in the LoadCraft app (link below); flows_record_journeys with the same plan then follows the walk.',
  'record.unknownPaths.more': '{names} and {count} more',
  'error.record_approval_denied.message':
    'LoadCraft did not accept the approval of the paths ({code}).',
  'error.record_approval_denied.hint':
    'Only the user who started the run, with the editor role in the project, approves its paths: ask the project owner for the role, or approve them in the app ({link}).',
  'error.record_unknown_paths.message': 'Plan {plan} has no path named {names}.',
  'error.record_unknown_paths.hint':
    'Use the names of the plan as flows_describe_journeys showed them ({available}), or paths: "all".',
  'error.plan_not_ready.message':
    'Plan {plan} is not ready: LoadCraft is still splitting the description into paths.',
  'error.plan_not_ready.hint':
    'Call process_wait with operation "{operation}"; once it shows the plan, call flows_record_journeys with its handle.',
  'error.record_run_failed.message':
    'The walk of the paths ended without a saved flow (run {status}): {detail}',
  'error.record_run_failed.hint':
    'Nothing was saved. The text of the failure is in the plugin log, not shown here: check the address, the description and the account, then start again with flows_describe_journeys, or record the journeys in a browser and use flows_import_har.',
  'error.record_stop_refused.message': 'LoadCraft did not stop the walk ({code}).',
  'error.record_stop_refused.hint':
    'The user steers the browser in the app now: they stop the walk there or hand the browser back first ({link}).',
  'error.report_not_archived.message': 'LoadCraft keeps no Gatling report of run {run}.',
  'error.report_not_archived.hint':
    'A report is archived when a run finishes; a run that failed to start has none.',
  'error.not_a_production_run.message': 'Run {run} did not replay production traffic.',
  'error.not_a_production_run.hint': 'results_get_report reports any run.',
  'error.no_baseline.message': 'No baseline is pinned for the scenario and load of run {run}.',
  'error.no_baseline.hint': 'Pass compare_to with a run handle instead.',
  'error.report_exists.message': 'A report of run {run} was exported before: {path}.',
  'error.report_exists.hint': 'Pass overwrite: true only when the user wants it replaced.',
} as const satisfies Readonly<Record<string, Entry>>;

export type DictionaryKey = keyof typeof en;
export type Dictionary = Readonly<Record<DictionaryKey, Entry>>;
