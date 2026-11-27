// What both scenario tools say about the flows they were given, before anything else: the flows
// pinned to an older docs version (a scenario reads the docs of its flow, not the current ones) and
// the flows the generator left open items on. The change of the state's warning about old docs goes
// along, so it stays in step with the project's flows.

import { flowsOnOldDocs, listFlowsWithTotal } from '../../api/flows.js';
import type { ToolContext } from '../../context.js';
import { oldDocsUpdate } from '../../flow/oldDocs.js';
import type { NeedsInputView } from '../../render/views/needsInput.js';
import type { ProcessUpdateInput } from '../../workspace/reducer.js';

export interface FlowWarnings {
  /** Names of the chosen flows on an older docs version, in the order of `chosen`. */
  readonly names: string[];
  /** The change of the warning for every such flow of the project; `tool` is the one that found it. */
  readonly update: ProcessUpdateInput | undefined;
  /** The chosen flows the generator left open items on (a warning only: the scenario is built as is). */
  readonly needsInput: NeedsInputView | undefined;
}

export async function flowWarnings(
  ctx: ToolContext,
  projectId: string,
  chosen: readonly { readonly id: string }[],
  tool: string,
): Promise<FlowWarnings> {
  const listed = await listFlowsWithTotal(ctx, projectId);
  const old = await flowsOnOldDocs(ctx, projectId, listed);
  const byId = new Map(old.flows.map((flow) => [flow.id, flow.name]));
  const names = chosen.flatMap((flow) => {
    const name = byId.get(flow.id);
    return name === undefined ? [] : [name];
  });
  const listedById = new Map(listed.flows.map((flow) => [flow.id, flow]));
  const needing = chosen.flatMap((flow) => {
    const found = listedById.get(flow.id);
    return found === undefined || (found.needs_input_count ?? 0) === 0 ? [] : [found];
  });
  return {
    names,
    update: oldDocsUpdate(ctx.state.process(), old.flows, tool, old.partial),
    needsInput:
      needing.length === 0
        ? undefined
        : {
            flows: needing.map((flow) => flow.name),
            definite: needing.reduce(
              (sum, flow) => sum + (flow.needs_input_definite_count ?? 0),
              0,
            ),
          },
  };
}
