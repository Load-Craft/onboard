// Flows on an older version of the documentation: a flow pinned to a docs version other than the
// project's current one. The list and the detail of flows say it in `spec_status` (`current`,
// `outdated`, `unpinned`); a server from before that field answers null, and then the pin is
// compared with the current version here, by the same rule: no pin is `unpinned`, the current
// version (or a project without one) is `current`, anything else `outdated`.
//
// The warning `flows_on_old_docs` of the process state follows from the list: the tools that read
// the flows (the import of the documentation, the status, the scenario) hand the reducer one update
// that closes the earlier warning and opens one with the flows found, and none when the state
// already says the same. Its severity and its fields are the catalog's (`PROBLEM_CODES`).

import { PROBLEM_CODES } from '../catalog.generated.js';
import type { Process } from '../workspace/processState.js';
import type { ProcessUpdateInput } from '../workspace/reducer.js';

export type SpecStatus = 'current' | 'outdated' | 'unpinned';

/** What a flow of the list says about its docs version. */
export interface FlowPin {
  readonly id: string;
  readonly name: string;
  readonly openapi_spec_id?: string | null | undefined;
  readonly spec_status?: SpecStatus | null | undefined;
}

export const OLD_DOCS_CODE = 'flows_on_old_docs';

/** The catalog's rule of the warning; the generated catalog always carries it. */
const RULE = PROBLEM_CODES.find((entry) => entry.code === OLD_DOCS_CODE);

/** Flow ids the state accepts on one problem. */
const MAX_FLOW_IDS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether the list needs the project's current docs version: a pinned flow without `spec_status`. */
export function needsCurrentDocs(flows: readonly FlowPin[]): boolean {
  return flows.some(
    (flow) =>
      (flow.spec_status ?? null) === null &&
      flow.openapi_spec_id !== null &&
      flow.openapi_spec_id !== undefined,
  );
}

/** `spec_status` of a flow, or the same rule applied to its pin when the server gave none. */
export function specStatusOf(flow: FlowPin, currentDocs: string | null): SpecStatus {
  if (flow.spec_status !== null && flow.spec_status !== undefined) return flow.spec_status;
  const pin = flow.openapi_spec_id ?? null;
  if (pin === null) return 'unpinned';
  return currentDocs === null || pin === currentDocs ? 'current' : 'outdated';
}

/** The flows on an older docs version, sorted by name. */
export function outdatedFlows<F extends FlowPin>(
  flows: readonly F[],
  currentDocs: string | null,
): F[] {
  return flows
    .filter((flow) => specStatusOf(flow, currentDocs) === 'outdated')
    .sort((a, b) => a.name.localeCompare(b.name));
}

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);

/**
 * The change of the warning for the flows found on an older version: undefined when the state already
 * says exactly that (no write, no new rev), else the earlier warning closed and, when there are such
 * flows, a new one opened with them (one warning; its flow_ids are replaced, not added to). `process`
 * is the process as the state file holds it (absent before the first write). `partial`: the list was
 * cut short, so a flow the warning names may simply not have been read; the warning then only grows
 * and is never closed.
 */
export function oldDocsUpdate(
  process: Pick<Process, 'problems'> | undefined,
  outdated: readonly Pick<FlowPin, 'id'>[],
  tool: string,
  partial = false,
): ProcessUpdateInput | undefined {
  const open = (process?.problems ?? []).filter((problem) => problem.code === OLD_DOCS_CODE);
  const kept = partial ? open.flatMap((problem) => problem.flow_ids ?? []) : [];
  const ids = [
    ...new Set([...kept, ...outdated.map((flow) => flow.id)].filter((id) => UUID.test(id))),
  ].slice(0, MAX_FLOW_IDS);
  if (ids.length === 0) {
    return open.length === 0 ? undefined : { problems: { close: [{ code: OLD_DOCS_CODE }] } };
  }
  const [only] = open;
  if (open.length === 1 && only !== undefined && sameIds(only.flow_ids ?? [], ids)) {
    return undefined;
  }
  const count = ids.length;
  return {
    problems: {
      close: [{ code: OLD_DOCS_CODE }],
      open: [
        {
          module: 'flows',
          tool,
          code: OLD_DOCS_CODE,
          severity: RULE?.severity ?? 'warning',
          flow_ids: ids,
          message:
            `${String(count)} flow${count === 1 ? ' is' : 's are'} pinned to an older docs version; ` +
            'scenarios built from them read that version. flows_migrate_docs moves them to the current one.',
        },
      ],
    },
  };
}
