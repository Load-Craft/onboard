// Texts of the tools of module flows, English: the key set of flows.pl.ts. A key starts with the
// name of a tool of the module (`flows_list.`) or with `flows.` for a text its tools share.

import type { Entry } from './core.js';

export const flowsEn = {
  'flows_export_walk_image.snapshot':
    'Saved the live image of step {step}, attempt {attempt} of walk {handle}: {size}.',
  'flows_export_walk_image.still': 'Saved the still {still} of walk {handle}: {size}.',
  'flows_export_walk_image.ignored':
    'The folder is ignored by git: the image shows what the application displayed.',
  'error.flows_walk_image_exists.message': 'An image of this name is already saved at {path}.',
  'error.flows_walk_image_exists.hint':
    'Open that image, or call again with overwrite: true to replace it.',
  'error.flows_walk_image_not_an_image.message':
    'The backend answered with something that is not a PNG, a JPEG or a WebP image; nothing was saved.',
  'error.flows_walk_image_not_an_image.hint':
    'Do not retry the same call. Tell the user; the walk may have ended or the page is gone.',
  'flows_save.why.unknown_step': 'the flow has no such step in its outline',
  'flows_save.why.nested_step': 'it is inside a group or a condition',
  'flows_save.why.container': 'it is a group, a loop or a condition itself',
  'flows_save.why.branching': 'it leads on in two ways',
  'flows_save.why.would_empty': 'the flow would be left with no step',
  'flows_save.created': 'Flow "{name}" created: v{version}, {steps}.',
  'flows_save.unchanged': 'Flow "{name}" already says that; nothing changed.',
  'flows_save.saved': 'Flow "{name}" saved as v{version} (was v{previous}): {what}.',
  'flows_save.dropped': 'dropped step {steps}',
  'flows_save.graph_replaced': 'graph replaced',
  'flows_save.reason': 'Reason: {reason}',
  'flows_save.renamed': 'Flow "{name}" renamed (was "{from}").',
  'flows_save.described': 'Flow "{name}" described.',
  'flows_save.description_changed': 'Description changed.',
  'flows_save.steps': { one: '{count} step', other: '{count} steps' },
  'error.flows_save_step_not_droppable.message': 'Step {step} cannot be dropped: {why}.',
  'error.flows_save_step_not_droppable.hint':
    'Drop only the top-level steps of the outline of flows_get (a request or a pause), one chain at a time; for a step inside a group or a condition, or a flow that would be left empty, ask the user.',
  'error.flows_save_secret_in_graph.message':
    'The graph carries a literal secret at {path}; nothing was sent.',
  'error.flows_save_secret_in_graph.hint':
    'A value of a header, a body field or a variable named like a token, a password or a key is not written by this tool: refer to it with a variable reference and keep its value in the environment or the test data. Never ask the user for the value to put here.',
  'flows_get_copilot_history.header': {
    one: 'Copilot conversation about "{name}" ({count} turn):',
    other: 'Copilot conversation about "{name}" ({count} turns):',
  },
  'flows_get_copilot_history.empty': 'The copilot has not talked about "{name}" yet.',
  'flows_get_copilot_history.more': 'showing the latest {shown} of {count} turns',
  'flows_get_copilot_history.proposed': 'proposed: {type} — {description}',
  'flows_get_copilot_history.suggestions': 'Copilot suggestions for "{name}" ({count}):',
  'flows_get_copilot_history.suggestion': '{text} (block {block})',
  'flows_get_copilot_history.no_suggestions': 'The copilot has no suggestions for "{name}".',
  'flows_get_walks.header': { one: '{count} walk:', other: '{count} walks:' },
  'flows_get_walks.empty': 'You have no walks in this project.',
  'flows_get_walks.more': 'showing the first {shown} of {count} walks',
  'flows_get_walks.awaits_approval': 'waits for the split to be approved',
  'flows_get_walks.at_step': 'step {step}',
  'flows_get_walks.selected': 'selected',
  'flows_get_walks.walk_header': 'Walk {handle} ({status}): {title}',
  'flows_get_walks.error': 'error: {text}',
  'flows_get_walks.all_failed': 'every path failed',
  'flows_get_walks.paths': 'paths:',
  'flows_get_walks.steps': { one: '{count} step', other: '{count} steps' },
  'flows_get_walks.partial': 'partial',
  'flows_get_walks.flow': 'flow {id}',
  'flows_get_walks.saved': 'flows saved:',
  'flows_get_walks.timeline': 'timeline:',
  'flows_get_walks.timeline_unavailable':
    'timeline: unavailable (the review session is closed, or the walk is not yours)',
  'flows_get_walks.review_until': 'review open until {at}',
  'flows_get_walks.plan': 'plan of path {path}, attempt {attempt}: {steps}',
  'flows_get_walks.step_line': 'path {path} attempt {attempt} step {step}: {label}',
  'flows_get_walks.note': 'note at step {step} (path {path}): {text}',
  'flows_get_walks.other_events': 'other events: {events}',
  'flows_get_versions.header': {
    one: '{count} version of "{name}":',
    other: '{count} versions of "{name}":',
  },
  'flows_get_versions.empty': 'The flow "{name}" has no stored versions.',
  'flows_get_versions.more': 'showing the newest {shown} of {count} versions',
  'flows_get_versions.version_header': 'Version {version} of "{name}" ({day})',
  'flows_restore_version.warning.source_endpoints_not_restored':
    'Warning: the restore moved the flow back to another docs version; these endpoints are no longer source endpoints of the flow: {endpoints}',
  'flows_restore_version.warning.spec_version_missing':
    'Warning: the restored steps are bound to a docs version that no longer exists; the flow keeps its docs version.',
  'flows_restore_version.warning.spec_versions_mixed':
    'Warning: the restored steps are bound to more than one docs version; the flow keeps its docs version, migrate it to bring the steps onto one (flows_migrate_docs).',
  'flows_save_walk_note.added': 'Note added at step {step}: "{text}"',
  'flows_save_walk_note.changed': 'Note {id} changed at step {step}: "{text}"',
  'flows_save_walk_note.unchanged': 'Note {id} already says that; nothing changed.',
  'flows_save_walk_note.remembered': 'It is also kept as a note of the project for later walks.',
  'flows_save_walk_note.no_undo_new':
    'A new note cannot be undone from the log: delete it in the app if it is not wanted.',
  'flows_save_walk_note.withheld':
    'The previous text held a secret and is not kept, so this change cannot be undone from the log.',
  'flows_duplicate.made': {
    one: '{count} copy made: {names}.',
    other: '{count} copies made: {names}.',
  },
  'flows_duplicate.onto_docs':
    '1 copy made: {name} on docs v{version} (steps: {matched} matched, {changed} changed, {unmatched} not rebound, of {steps}).',
  'flows_duplicate.none': 'No copy was made.',
  'flows_duplicate.failed': 'Not copied: {ids}',
  'flows_merge.done': '{name} created from {count} flows.',
  'flows_merge.warning': 'Warning: {warning}',
  'flows_restore_version.warning.other': 'Warning: the restore reported "{code}".',
  'flows_restore_version.done':
    '{name}: v{version} restored as v{new} (v{previous} was the current one).',
  'flows_restore_version.nothing_restored': '(nothing restored)',
  'flows_restore_version.unchanged':
    '{name}: v{version} is already the current version; nothing changed.',
  'flows_list.header': { one: '{count} flow:', other: '{count} flows:' },
  'flows_list.steps': { one: '{count} step', other: '{count} steps' },
  'flows_list.open': 'open questions: {count} ({definite} definite)',
  'flows_list.inactive': 'inactive',
  'flows_list.outdated': 'docs outdated',
  'flows_list.empty': 'This project has no flows yet.',
  'flows_list.no_match': 'No flow name contains "{query}"; {fetched} flows were read.',
  'flows_list.more': 'showing the first {shown} of {count} flows',
  'flows_list.cut': 'the project has {total} flows; the {fetched} most recently updated were read',
  // flows_ask_copilot
  'flows_ask_copilot.card.title': 'Ask the flow copilot about "{name}"',
  'flows_ask_copilot.card.flow': 'the flow {id}, read by the copilot',
  'flows_ask_copilot.card.review': 'no question: the copilot runs its standard review of the flow',
  'flows_ask_copilot.card.message': 'asks: "{message}"',
  'flows_ask_copilot.card.proposes': 'it proposes changes; none is applied or saved',
  'flows_ask_copilot.card.cost': 'one or two model calls (LLM) for this turn',
  'flows_ask_copilot.card.undo': 'the flow stays as it is',
  'flows_ask_copilot.header': 'Flow copilot on "{name}":',
  'flows_ask_copilot.header_review': 'Flow copilot, standard review of "{name}":',
  'flows_ask_copilot.reply': 'reply: {reply}',
  'flows_ask_copilot.no_changes': 'It proposes no changes.',
  'flows_ask_copilot.changes': {
    one: '{count} change proposed (nothing is applied):',
    other: '{count} changes proposed (nothing is applied):',
  },
  'flows_ask_copilot.type.add': 'add',
  'flows_ask_copilot.type.modify': 'modify',
  'flows_ask_copilot.type.remove': 'remove',
  'flows_ask_copilot.warnings': { one: '({count} warning)', other: '({count} warnings)' },
  'flows_ask_copilot.more': 'showing the first {shown} of {total} changes',
  'flows_ask_copilot.proposal': 'Proposal {id}: the backend keeps it; nothing was applied.',
  // flows_set_poll_terminals
  'flows_set_poll_terminals.done':
    'Poll loop "{field}" of "{name}" answered: v{version} saved (v{previous} before).',
  'flows_set_poll_terminals.success': 'success statuses: {statuses}',
  'flows_set_poll_terminals.failure': 'failure statuses: {statuses}',
  'flows_set_poll_terminals.no_failure': 'no failure statuses',
  'flows_set_poll_terminals.none_open': 'No question is left open on the flow.',
  'flows_set_poll_terminals.open': {
    one: '{count} question is still open on the flow.',
    other: '{count} questions are still open on the flow.',
  },
  'flows_set_poll_terminals.undo':
    'To undo: flows_restore_version with version {previous}; it brings back the blocks and the open question.',
  // flows_apply_copilot_changes
  'flows_apply_copilot_changes.applied':
    '{applied} of {requested} copilot changes applied to "{name}": v{version} saved (v{previous} before).',
  'flows_apply_copilot_changes.not_applied':
    'None of the {requested} copilot changes was applied to "{name}": the backend dropped them all, no version was saved.',
  'flows_apply_copilot_changes.only_rejected': 'No change applied to "{name}".',
  'flows_apply_copilot_changes.warning': 'warning on change {change}: {message}',
  'flows_apply_copilot_changes.rejected': {
    one: 'Recorded as rejected: {ids}.',
    other: 'Recorded as rejected: {ids}.',
  },
  'flows_apply_copilot_changes.not_recorded':
    'The flow was saved, but recording what was accepted or rejected failed: the history may show the changes without an outcome.',
  'flows_apply_copilot_changes.undo':
    'To undo: flows_restore_version with version {previous}. It brings the flow back; the outcomes stay recorded in the history.',
  'flows_apply_copilot_changes.no_undo': 'No version was saved, so there is nothing to undo.',
  'error.flows_copilot_turn_unknown.message': 'The flow\'s copilot history has no turn "{id}".',
  'error.flows_copilot_turn_unknown.hint':
    'Nothing was changed. Use the message_id that flows_ask_copilot returned or flows_get_copilot_history shows for the turn with the changes.',
  'error.flows_copilot_change_unknown.message': 'The copilot turn has no change with the id {ids}.',
  'error.flows_copilot_change_unknown.hint':
    'Nothing was changed. The changes of this turn have the ids: {known}.',
  'error.flows_apply_version_conflict.message':
    'The flow is no longer at version {version}: it changed after the proposal was read, so nothing was applied.',
  'error.flows_apply_version_conflict.hint':
    'Read the flow again (flows_get) and ask the copilot again for a proposal that fits its present state.',
  'flows_regenerate.card.title': 'Regenerate flow "{name}"',
  'flows_regenerate.card.rewrites':
    'a run of the model re-derives the flow from its recorded sources and writes a new version over v{version} ({blocks} blocks)',
  'flows_regenerate.card.description': 'regenerated from this description: "{description}"',
  'flows_regenerate.card.skip_validators': 'no validators are generated for the new version',
  'flows_regenerate.card.failed_run':
    'a run that fails or finds a source it cannot map leaves the flow as it is',
  'flows_regenerate.card.cost': 'about one LLM generation',
  'flows_regenerate.card.undo': 'flows_restore_version puts v{version} back',
  'flows_regenerate.running': 'Regenerating "{name}"…',
  'flows_regenerate.progress': 'Regenerating "{name}": {step}…',
  'flows_regenerate.done': 'flow "{name}" regenerated: v{previous} → v{version}',
  'flows_regenerate.undo': 'undo: flows_restore_version with version {previous}',
  'error.flows_regenerate_unavailable.message':
    'Flow "{name}" cannot be regenerated: it has no recorded source endpoints or operations.',
  'error.flows_regenerate_unavailable.hint':
    'A flow made by hand or from a recording has nothing to regenerate from; build a new one with a flows_generate_* tool.',
  'error.flows_regenerate_changed.message': 'Flow "{name}" changed after the card was made.',
  'error.flows_regenerate_changed.hint':
    'Nothing was started. Call flows_regenerate again: the card shows the flow as it is now.',
  'error.flows_regenerate_failed.message': 'The regeneration of flow "{name}" failed: {detail}',
  'error.flows_regenerate_failed.hint':
    'The flow is as it was. A source LoadCraft cannot map, a missing specification or a failed check ends a run: fix that and call again.',
} as const satisfies Readonly<Record<string, Entry>>;
