/**
 * What a LoadCraft result names, for the data channel of `process_get_status` (`result: { kind, id }`).
 *
 * Since results carry no structured data, the run or the flow comes from the one language-free mark
 * the server puts under a result: its link line, `↗ https://…/gatling/executions/<uuid>…` for a run
 * and `↗ https://…/flows/<uuid>` for a flow. Only a line that starts with `↗ ` is read, and only
 * when there is exactly one: the server makes every quotation from a log one line, so text from a
 * customer can never add a link line of its own. Nothing else of a view is read.
 */

import { shortToolName } from '../state/signal.js';

export type ResultKind = 'report' | 'diagnosis' | 'flow';

export interface ResultSelector {
  readonly kind: ResultKind;
  readonly id: string;
}

/**
 * The tools whose result has data in the channel. The `flows_generate_*` tools and the two scenario tools
 * have none: their text names no id for every flow or composition, and the proposal of a split is stored
 * nowhere the server could read it back.
 */
const KINDS: Readonly<Record<string, ResultKind>> = {
  results_get_report: 'report',
  results_analyze_run: 'diagnosis',
  flows_get: 'flow',
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const LINK_PATHS: Readonly<Record<ResultKind, RegExp>> = {
  report: new RegExp(
    `^↗ https://[^\\s/]+/projects/${UUID}/gatling/executions/(${UUID})(?:[?#]\\S*)?$`,
  ),
  diagnosis: new RegExp(
    `^↗ https://[^\\s/]+/projects/${UUID}/gatling/executions/(${UUID})(?:[?#]\\S*)?$`,
  ),
  flow: new RegExp(`^↗ https://[^\\s/]+/projects/${UUID}/flows/(${UUID})(?:[?#]\\S*)?$`),
};

/** The kind of data a tool's result has, by the tool's short name; `undefined` when it has none. */
export function resultKind(tool: string): ResultKind | undefined {
  return Object.hasOwn(KINDS, tool) ? KINDS[tool] : undefined;
}

/** The kind for the full tool name of a `ui.render` event. */
export function resultKindOfTool(tool: unknown): { tool: string; kind: ResultKind } | undefined {
  const name = shortToolName(tool);
  const kind = name === undefined ? undefined : resultKind(name);
  return name === undefined || kind === undefined ? undefined : { tool: name, kind };
}

/** The text of a tool's output: the string, or the text blocks of a list; nothing else. */
export function outputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (!Array.isArray(output)) return '';
  return output
    .flatMap((block: unknown) =>
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
        ? [(block as { text: string }).text]
        : [],
    )
    .join('\n');
}

/** The selector for the data of a result, from its text; `undefined` without exactly one link line. */
export function resultSelector(kind: ResultKind, text: string): ResultSelector | undefined {
  const links = text.split('\n').filter((line) => line.startsWith('↗ '));
  const [only, ...others] = links;
  if (only === undefined || others.length > 0) return undefined;
  const id = LINK_PATHS[kind].exec(only)?.[1];
  return id === undefined ? undefined : { kind, id };
}
