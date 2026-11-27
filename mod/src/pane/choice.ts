/**
 * What the Path tab says to the agent when the user picks something in it: a message the plugin
 * submits as a turn (`$.prompt.submit`). Pure functions, no `$`.
 *
 * The wording is fixed English because the skill matches it (skills/loadcraft-test, step 3): the
 * method as an id, the journeys as a JSON list of the names exactly as `flows_suggest_journeys` returned
 * them (JSON, so that a quote or a line break in a name cannot end the list early). Both say the
 * pick is an answer to a question panel and not consent: consent stays the user's "yes" to the
 * question the server asks for.
 */

import { isRunHandle, isSafeFlowName } from './lists.js';
import type { FlowMethod } from './tabs.js';

const NOT_CONSENT =
  'It is a choice, not consent to anything that writes or costs: ask before such a step as usual.';

/** The message for a method picked in the tab. */
export function methodMessage(method: FlowMethod): string {
  return (
    `The user chose the flow method "${method}" in the LoadCraft Path tab ` +
    '(docs: from the API documentation, describe: from a description walked by the LoadCraft ' +
    'browser, har: from a HAR recording, manual: by hand from chosen endpoints). ' +
    'Treat it as their answer to the panel flow-method: do not ask it again, and read the step 3 ' +
    `file for that method. ${NOT_CONSENT}`
  );
}

/** The message for the journeys marked in the tab. */
export function journeysMessage(names: readonly string[]): string {
  return (
    'The user chose these journeys to build in the LoadCraft Path tab, as a JSON list of names ' +
    `exactly as flows_suggest_journeys returned them: ${JSON.stringify(names)}. ` +
    'Treat it as their answer to the panel path-selection: do not ask it again, and build exactly ' +
    `these with flows_generate_from_suggestions. ${NOT_CONSENT}`
  );
}

/**
 * The flows marked in the Project tab, as a JSON list of the names the status listed them under. Only
 * a name of the shape `isSafeFlowName` allows goes in (the panel marks no other, and this filters again).
 */
const flowList = (names: readonly string[]): string => JSON.stringify(names.filter(isSafeFlowName));

/** The message for the flows marked in the tab: a proposal of a scenario, which generates nothing. */
export function scenarioMessage(names: readonly string[]): string {
  return (
    'The user marked these flows in the LoadCraft Project tab, as a JSON list of flow names exactly ' +
    `as process_get_status listed them: ${flowList(names)}. ` +
    'Treat it as their request for a load scenario from exactly these flows: call scenario_suggest_split ' +
    'with them as flows (that call only proposes a split of the traffic and ' +
    `generates nothing), and show the proposal. ${NOT_CONSENT}`
  );
}

/** The message for the flows marked in the tab: the preview of the docs migration, which saves nothing. */
export function migrationMessage(names: readonly string[]): string {
  return (
    'The user marked these flows in the LoadCraft Project tab, as a JSON list of flow names exactly ' +
    `as process_get_status listed them: ${flowList(names)}. ` +
    'Treat it as their request to see what moving them to the current API documentation would change: ' +
    'call flows_migrate_docs with them as flow_ids and preview: true (a preview saves nothing), and ' +
    `show what it found. The move itself needs the consent card as usual. ${NOT_CONSENT}`
  );
}

/** The message for two runs marked in the Results tab: their comparison, a read of a report. */
export function compareMessage(older: string, newer: string): string {
  const handles = [newer, older].filter(isRunHandle);
  const [report, earlier] = handles.length === 2 ? handles : ['', ''];
  return (
    'The user marked two test runs in the LoadCraft Results tab (handles as process_get_status ' +
    'lists them). Treat it as their request to compare them: call results_get_report with ' +
    `execution "${report}" and compare_to "${earlier}" (the earlier run), and show the comparison. ` +
    `It only reads. ${NOT_CONSENT}`
  );
}

/** The largest step number a question names: a plan holds fewer. */
const MAX_STEP = 999;

/** Whether `run` is a run handle and `step` a step number (from 1) a question about a step may carry. */
export function isStepQuestion(run: string, step: number): boolean {
  return isRunHandle(run) && Number.isInteger(step) && step >= 1 && step <= MAX_STEP;
}

/**
 * The message for the question about one step of a self-check, asked in the Run tab: the run handle and
 * the number of the step in the order of the plan, never a name or a text of the tested system.
 */
export function stepMessage(run: string, step: number): string {
  const [handle, number] = isStepQuestion(run, step) ? [run, String(step)] : ['', ''];
  return (
    'The user asks in the LoadCraft Run tab about one step of a self-check: step ' +
    `${number} (counted from 1 in the order of the plan) of the run "${handle}". Read what that ` +
    `step sent and got back with results_get_traces (execution "${handle}") and explain in plain ` +
    'words what happened at it and why. Do not start a self-check, a repair or a test because of ' +
    `this question. ${NOT_CONSENT}`
  );
}
