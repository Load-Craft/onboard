// Flows the generator left open items on (`needs_input`): a question it could not answer, a step
// whose token may not fit its security scheme, a key of the application under test nothing supplies.
// An item is `definite` when the documentation proves the steps fail (they are answered 401 as
// built). The list of flows counts the items of each flow (`needs_input_count`,
// `needs_input_definite_count`) and the detail of a flow lists them.
//
// The warning `flows_need_input` of the process state follows from those readings: one warning with
// the flows that have items and how many items are definite. It is a warning, also when items are
// definite: nothing is refused for it, the backend decides what it accepts. A reading of the whole
// list replaces the warning; a reading of some flows (one flow, the flows just built, a list cut
// short) changes only the flows it read. Its severity and its fields are the catalog's.

import { PROBLEM_CODES } from '../catalog.generated.js';
import type { Process } from '../workspace/processState.js';
import type { ProcessUpdateInput } from '../workspace/reducer.js';

export const NEEDS_INPUT_CODE = 'flows_need_input';

/** The catalog's rule of the warning; the generated catalog always carries it. */
const RULE = PROBLEM_CODES.find((entry) => entry.code === NEEDS_INPUT_CODE);

/** The open items of one flow as a reading found them. */
export interface FlowNeeds {
  readonly id: string;
  /** Open items of the flow. */
  readonly count: number;
  /** Of them, the definite ones: their steps get 401 as built. */
  readonly definite: number;
}

/**
 * What a reading saw: `all` the whole list of the project's flows; `some` only the flows it names
 * (one flow, the flows just built, a list cut short), the others keep what the warning says.
 */
export type NeedsScope = 'all' | 'some';

/** Flow ids the state accepts on one problem. */
const MAX_FLOW_IDS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sameIds = (a: readonly string[], b: readonly string[]): boolean => {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
};

function message(flows: number, definite: number): string {
  const subject = `${String(flows)} flow${flows === 1 ? ' has' : 's have'} open generator questions`;
  const proved =
    definite === 0
      ? ''
      : ` (${String(definite)} definite: ${definite === 1 ? 'its' : 'their'} steps get 401 as built)`;
  return (
    `${subject}${proved}. flows_get shows them; supply the data or the key of the environment ` +
    '(project_save_env), or rebuild the flow.'
  ).slice(0, 300);
}

/**
 * The change of the warning for what a reading of flows found: undefined when the state already says
 * exactly that (no write, no new rev), else the earlier warning closed and, when flows have items, a
 * new one opened with them. `process` is the process as the state file holds it (absent before the
 * first write). With `some`, the flows the warning names that were not read stay in it, and its
 * definite count does not fall below the earlier one (their items are not known from this reading).
 */
export function needsInputUpdate(
  process: Pick<Process, 'problems'> | undefined,
  read: readonly FlowNeeds[],
  tool: string,
  scope: NeedsScope,
): ProcessUpdateInput | undefined {
  const open = (process?.problems ?? []).filter((problem) => problem.code === NEEDS_INPUT_CODE);
  const readIds = new Set(read.map((flow) => flow.id));
  const found = read.filter((flow) => flow.count > 0 && UUID.test(flow.id));
  const kept =
    scope === 'all'
      ? []
      : open.flatMap((problem) => problem.flow_ids ?? []).filter((id) => !readIds.has(id));
  const ids = [...new Set([...kept, ...found.map((flow) => flow.id)])].slice(0, MAX_FLOW_IDS);
  if (ids.length === 0) {
    return open.length === 0 ? undefined : { problems: { close: [{ code: NEEDS_INPUT_CODE }] } };
  }
  const shown = new Set(ids);
  const counted = found
    .filter((flow) => shown.has(flow.id))
    .reduce((sum, flow) => sum + flow.definite, 0);
  const earlier = open.reduce((most, problem) => Math.max(most, problem.definite_count ?? 0), 0);
  const definite = kept.length === 0 ? counted : Math.max(counted, earlier);
  const [only] = open;
  if (
    open.length === 1 &&
    only !== undefined &&
    sameIds(only.flow_ids ?? [], ids) &&
    only.definite_count === definite
  ) {
    return undefined;
  }
  return {
    problems: {
      close: [{ code: NEEDS_INPUT_CODE }],
      open: [
        {
          module: 'flows',
          tool,
          code: NEEDS_INPUT_CODE,
          severity: RULE?.severity ?? 'warning',
          flow_ids: ids,
          definite_count: definite,
          message: message(ids.length, definite),
        },
      ],
    },
  };
}

/**
 * The warning closed after the fixed headers of an environment were set (a missing key of the
 * application is supplied that way); undefined when none is open. The items stay on the flows in
 * LoadCraft, so the next reading of the flows opens the warning again for those still open.
 */
export function needsInputCleared(
  process: Pick<Process, 'problems'> | undefined,
): ProcessUpdateInput | undefined {
  const open = (process?.problems ?? []).some((problem) => problem.code === NEEDS_INPUT_CODE);
  return open ? { problems: { close: [{ code: NEEDS_INPUT_CODE }] } } : undefined;
}

/** The open warning: how many flows it names and how many definite items; undefined when none. */
export function openNeedsInput(
  process: Pick<Process, 'problems'> | undefined,
): { readonly flows: number; readonly definite: number } | undefined {
  const found = process?.problems.find((problem) => problem.code === NEEDS_INPUT_CODE);
  if (found === undefined) return undefined;
  return { flows: found.flow_ids?.length ?? 0, definite: found.definite_count ?? 0 };
}
