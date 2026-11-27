// Texts of the tools of module data, English: the key set of data.pl.ts. A key starts with the
// name of a tool of the module (`data_list.`) or with `data.` for a text its tools share.

import type { Entry } from './core.js';

export const dataEn = {
  'data.semantics.identity': 'identity',
  'data.semantics.secret': 'secret',
  'data.consumption.shared': 'shared',
  'data.consumption.exclusive': 'exclusive',
  'data.semantics.entity-ref': 'reference',
  'data.semantics.synthetic': 'plain',
  'data.semantics.derived': 'derived',
  'data_get_dataset.header':
    'Dataset "{name}" [{id}]: {type}, {rows}, {consumption}, strategy {strategy}; {origin}',
  'data_get_dataset.rows': { one: '{count} row', other: '{count} rows' },
  'data_get_dataset.uploaded': 'uploaded',
  'data_get_dataset.generated': 'generated{edited}',
  'data_get_dataset.generated_for': 'generated for scenario {scenario}{edited}',
  'data_get_dataset.edited': ', edited by hand',
  'data_get_dataset.columns': 'columns: {columns}',
  'data_get_dataset.more_columns': '+{count} more',
  'data_get_dataset.recipe': 'recipe: {recipe}',
  'data_get_dataset.description': 'description: {text}',
  'data_get_dataset.rows_range': 'rows {from}-{to} of {total}',
  'data_get_dataset.rows_none': 'rows: none to show ({total} in the dataset)',
  'data_get_dataset.rows_unavailable': 'rows: unavailable',
  'data_get_dataset.hidden': '(hidden columns: {columns})',
  'data_get_dataset.consumers': 'used by ({count}): {items}',
  'data_get_dataset.consumers_none': 'used by: nothing',
  'data_get_dataset.consumers_unavailable': 'used by: unavailable',
  'data_get_dataset.history': 'revisions ({count}): {items}',
  'data_get_dataset.history_none': 'revisions: none',
  'data_get_dataset.history_unavailable': 'revisions: unavailable',
  'data_get_dataset.by': 'by {who}',
  'data_get_dataset.snippet': 'feed snippet:',
  'data_get_dataset.snippet_unavailable': 'feed snippet: unavailable',
  'data_get_dataset.redis_ok': 'redis pool: {remaining} remaining',
  'data_get_dataset.redis_error': 'redis pool: not readable ({detail})',
  'data_get_dataset.redis_unavailable': 'redis pool: unavailable',
  'data_get_generators.refused': 'not generated: {reason}',
  'data_get_generators.refused_declarable':
    'not generated: {reason}; can be declared as data you supply',
  'data_get_generators.more_choices': '+{count} more',
  'data_get_slots.kind.scenario': 'scenario',
  'data_get_slots.kind.composition': 'composition',
  'data_get_slots.slots': { one: '{count} slot', other: '{count} slots' },
  'data_get_slots.header': 'Data slots of {kind} {id}: {slots}, {bound} bound',
  'data_get_slots.header_unknown':
    'Data slots of {kind} {id}: {slots} (bindings unknown: the {kind} could not be read)',
  'data_get_slots.empty.scenario': 'This scenario has no data slots.',
  'data_get_slots.empty.composition': 'This composition has no data slots.',
  'data_get_slots.identity.existing': 'existing logins',
  'data_get_slots.identity.fresh': 'new sign-ups',
  'data_get_slots.columns': 'columns {columns}',
  'data_get_slots.more': '+{count} more',
  'data_get_slots.bound': 'bound to "{name}"',
  'data_get_slots.bound_id': 'bound to dataset {id}',
  'data_get_slots.stale': 'stale binding (the dataset no longer fits)',
  'data_get_slots.unbound': 'not bound',
  'data_get_slots.never': 'never generated: {columns}',
  'data_get_slots.generated_rows': {
    one: '{count} generated row rides in the scenario',
    other: '{count} generated rows ride in the scenario',
  },
  'data_get_slots.options': 'compatible datasets ({count}): {items}',
  'data_get_slots.options_none': 'compatible datasets: none',
  'data_get_slots.option_rows': { one: '{count} row', other: '{count} rows' },
  'data_get_generators.header': { one: '{count} generator:', other: '{count} generators:' },
  'data_get_generators.header_columns': { one: '{count} column:', other: '{count} columns:' },
  'data_get_generators.empty': 'The backend lists no generators.',
  'data_get_generators.choices': 'choices: {choices}',
  'data_get_generators.default_choice': '{value} (default)',
  'data_get_generators.generator': 'generator {rule}',
  'data_get_generators.no_generator': 'no generator named',
  'data_get_generators.min': 'from {value}',
  'data_get_generators.max': 'up to {value}',
  'data_get_generators.values': { one: 'of {count} value', other: 'of {count} values' },
  'data_get_generators.ref': 'refers to {column}',
  'data_get_copilot_history.header': {
    one: '{count} message of the data hub conversation:',
    other: '{count} messages of the data hub conversation:',
  },
  'data_get_copilot_history.header_cut':
    'the latest {shown} of {total} messages of the data hub conversation:',
  'data_get_copilot_history.empty': 'The data hub has no saved conversation for this project.',
  'data_get_copilot_history.role.user': 'you',
  'data_get_copilot_history.role.other': '{role}',
  'data_get_copilot_history.actions': 'proposed: {kinds}',
  'data_get_copilot_history.chips': { one: '{count} quick reply', other: '{count} quick replies' },
  'data_list_datasets.header': { one: '{count} dataset:', other: '{count} datasets:' },
  'data_list_datasets.empty': 'This project has no datasets.',
  'data_list_datasets.rows': { one: '{count} row', other: '{count} rows' },
  'data_list_datasets.facts':
    '{type}, {rows}, {consumption}, strategy {strategy}; {origin}; columns: {columns}',
  'data_list_datasets.uploaded': 'uploaded',
  'data_list_datasets.generated': 'generated{edited}',
  'data_list_datasets.generated_for': 'generated for scenario {scenario}{edited}',
  'data_list_datasets.edited': ', edited by hand',
  'data_list_datasets.more_columns': '+{count} more',
  'data_list_datasets.more': 'showing the first {shown} of {total} datasets',
  // data_set_slot_label
  'data_set_slot_label.done': 'Slot "{slot}" is now labelled "{label}".',
  'data_set_slot_label.was': 'label was: "{previous}"',
  'data_set_slot_label.was_none': 'the slot had no label',
  'data_set_slot_label.unchanged':
    'Slot "{slot}": nothing to change, the label is already "{label}".',
  'data_set_slot_label.not_undoable.no_previous':
    'The slot had no label and a label cannot be cleared, so this change cannot be undone from the log.',
  'data_set_slot_label.not_undoable.secret':
    'The previous label held a secret, so it is not kept: this change cannot be undone from the log.',
  // data_restore_dataset
  'data_restore_dataset.done':
    'Dataset "{name}" is back to its previous content: {rows} rows, {columns} columns.',
  'data_restore_dataset.undo': 'Call it again to switch back to the content that was replaced.',
  // data_update_dataset
  'data_update_dataset.card.title': 'Update dataset "{name}"',
  'data_update_dataset.card.name': 'rename: "{from}" -> "{to}"',
  'data_update_dataset.card.description': 'new description: "{to}"',
  'data_update_dataset.card.description_clear': 'clear the description',
  'data_update_dataset.card.file':
    'replace the rows with the file {file}: {rows} rows, {size} bytes, sha256 {sha}…; columns: {columns}',
  'data_update_dataset.card.cost.none': 'nothing is uploaded; only the definition changes',
  'data_update_dataset.card.cost.upload': 'uploads the file ({size} bytes) to LoadCraft',
  'data_update_dataset.card.undo.definition':
    'data_update_dataset with the previous name and description',
  'data_update_dataset.card.undo.rows':
    'data_restore_dataset puts the previous rows back (a name or a description changed in the same call is not undone)',
  'data_update_dataset.unchanged':
    'Dataset "{name}": nothing to change, the values are already as given.',
  'data_update_dataset.done': 'Dataset "{name}" updated: {parts}.',
  'data_update_dataset.part.name': 'name',
  'data_update_dataset.part.description': 'description',
  'data_update_dataset.part.rows': 'rows',
  'data_update_dataset.was_name': 'name was: "{previous}"',
  'data_update_dataset.was_description': 'description was: "{previous}"',
  'data_update_dataset.was_description_none': 'the dataset had no description',
  'data_update_dataset.rows_now': 'now {rows} rows, {columns} columns',
  'data_update_dataset.undo.definition':
    'To undo: data_update_dataset with the previous values (it asks for consent again).',
  'data_update_dataset.undo.rows':
    'To undo the rows: data_restore_dataset. A second call of it switches back.',
  'data_update_dataset.undo.withheld':
    'This change cannot be undone from the log: a previous value holds a secret.',
  'data_update_dataset.undo.none': 'Nothing to undo.',
  // data_regenerate_dataset
  'data_regenerate_dataset.card.title': 'Regenerate rows of dataset "{name}"',
  'data_regenerate_dataset.card.mode.expand':
    'add new rows up to {after} (now {now}); the existing rows stay',
  'data_regenerate_dataset.card.mode.reroll':
    'replace all {now} rows with {after} fresh ones from the recipe',
  'data_regenerate_dataset.card.recipe': 'recipe: {recipe}',
  'data_regenerate_dataset.card.cost':
    'runs the recipe generators for {rows} rows; a column made by a model calls the LLM',
  'data_regenerate_dataset.card.undo': 'data_restore_dataset puts the previous rows back',
  'data_regenerate_dataset.done.expand':
    'Dataset "{name}" expanded from {before} to {rows} rows ({columns} columns).',
  'data_regenerate_dataset.done.reroll':
    'Dataset "{name}" rerolled: {rows} fresh rows instead of {before} ({columns} columns).',
  'data_regenerate_dataset.undo':
    'To undo: data_restore_dataset with the dataset. A second call of it switches back.',
  'error.data_update_kind.message':
    'Dataset "{name}" is of type {type}: only datasets made of rows (csv, tsv, ssv, json) can be edited here.',
  'error.data_update_kind.hint': 'Nothing was changed. The user edits this dataset in the app.',
  'error.data_file_changed.message':
    'The file {file} changed after the card was made, so nothing was uploaded.',
  'error.data_file_changed.hint': 'Call the tool again to get a card for the file as it is now.',
  'error.data_regenerate_no_recipe.message':
    'Dataset "{name}" has no saved recipe, so LoadCraft cannot generate rows for it.',
  'error.data_regenerate_no_recipe.hint':
    'Nothing was changed. Load rows from a file with data_update_dataset, or ask the user.',
  // data_delete
  'data_delete.card.title': 'Delete dataset "{name}"',
  'data_delete.card.item': {
    one: 'the dataset {id} with its {rows} row',
    other: 'the dataset {id} with its {rows} rows',
  },
  'data_delete.card.users_none': 'no scenario or composition reads it',
  'data_delete.card.users_unknown':
    'who reads it could not be checked (the backend refuses the delete when something does, unless forced)',
  'data_delete.card.users': {
    one: 'read by {count} scenario or composition, which keeps running without it: {names}',
    other: 'read by {count} scenarios and compositions, which keep running without it: {names}',
  },
  'data_delete.card.forced': 'forced: it goes although they still use it',
  'data_delete.card.stays': 'stay: the scenarios, the compositions, past runs and their results',
  'data_delete.card.undo': 'it is deleted for good; generate or load the data again',
  'data_delete.done': 'Dataset "{name}" deleted ({count}).',
  'error.data_dataset_in_use.message':
    'Dataset "{name}" is still read by {count} scenarios or compositions: {users}.',
  'error.data_dataset_in_use.hint':
    'Nothing was changed. Tell the user who still uses it. Only if they want it gone anyway, call data_delete again with force: true.',
  'data_delete.stays': 'The scenarios, the compositions and past runs stay. This cannot be undone.',
  // data_ask_copilot
  'data_ask_copilot.card.title': 'Ask the data hub copilot',
  'data_ask_copilot.card.for.scenario': 'about the scenario "{name}" ({id})',
  'data_ask_copilot.card.for.composition': 'about the composition "{name}" ({id})',
  'data_ask_copilot.card.message': 'asks: "{message}"',
  'data_ask_copilot.card.profile': 'with the load profile: {profile}',
  'data_ask_copilot.card.no_profile': 'with no load profile (none is chosen)',
  'data_ask_copilot.card.proposes': 'it proposes actions; none is applied or saved',
  'data_ask_copilot.card.cost': 'one to three model calls (LLM) for this turn',
  'data_ask_copilot.card.undo': 'the data stays as it is',
  'data_ask_copilot.header.scenario': 'Data hub copilot on the scenario "{name}":',
  'data_ask_copilot.header.composition': 'Data hub copilot on the composition "{name}":',
  'data_ask_copilot.reply': 'reply: {reply}',
  'data_ask_copilot.no_actions': 'It proposes no actions.',
  'data_ask_copilot.actions': {
    one: '{count} action proposed (nothing is applied): {kinds}',
    other: '{count} actions proposed (nothing is applied): {kinds}',
  },
  'data_ask_copilot.issues': 'issues: {issues}',
  'data_ask_copilot.chips': 'it suggests asking: {chips}',
  'data_generate_dataset.card.title.flow': 'Generate a dataset with AI for the flow {target}',
  'data_generate_dataset.card.title.scenario':
    'Generate a dataset with AI for the scenario {target}',
  'data_generate_dataset.card.title.slot':
    'Generate a dataset with AI for the slot {slot} of the scenario {target}',
  'data_generate_dataset.card.for.flow': 'For: the data the steps of the flow {target} need',
  'data_generate_dataset.card.for.scenario': 'For: the data of the scenario {target}',
  'data_generate_dataset.card.for.slot': 'For: the slot {slot} of the scenario {target}',
  'data_generate_dataset.card.rows': 'Rows: {rows}, file type {type}',
  'data_generate_dataset.card.name': 'The new dataset is named {name}',
  'data_generate_dataset.card.enrich.on':
    'A model enriches the values; the dataset is named by LoadCraft after the slot',
  'data_generate_dataset.card.enrich.off':
    'No model enriches the values; the dataset is named by LoadCraft after the slot',
  'data_generate_dataset.card.cost': 'about one LLM generation per dataset',
  'data_generate_dataset.card.undo': 'data_delete removes the new dataset (it asks the user too)',
  'data_generate_dataset.progress.start': 'Starting the dataset generation',
  'data_generate_dataset.progress.step': 'Dataset generation: {step} ({percent}%)',
  'data_generate_dataset.step.prepare': 'preparing',
  'data_generate_dataset.step.generate': 'generating the rows',
  'data_generate_dataset.step.format': 'formatting',
  'data_generate_dataset.step.save': 'saving',
  'data_generate_dataset.done.created':
    'Generated the dataset {name}: {rows} rows, {columns} columns.',
  'data_generate_dataset.done.refreshed':
    'Refreshed the dataset {name} of the slot: {rows} rows, {columns} columns.',
  'data_generate_dataset.fewer': 'You asked for {asked} rows; LoadCraft made {rows}.',
  'data_generate_dataset.columns': 'Columns: {names}{more}',
  'data_generate_dataset.undo': 'To remove it: data_delete with this dataset (it asks the user).',
  'error.data_generate_failed.message': 'LoadCraft could not generate the dataset: {cause}',
  'error.data_generate_failed.hint':
    'Nothing was saved. Run it again when the user wants to, or generate for a scenario or a slot instead.',
} as const satisfies Readonly<Record<string, Entry>>;
