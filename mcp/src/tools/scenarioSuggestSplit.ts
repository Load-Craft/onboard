// `scenario_suggest_split`: a proposal of how to split the traffic between the flows the user named.
// It asks LoadCraft's scenario-builder chat once and generates nothing, so it is cheap and
// repeatable; `scenario_generate` takes the split from there. It names the flows that are pinned to
// an older docs version (a scenario reads the docs of its flow, not the current ones) and keeps the
// warning `flows_on_old_docs` of the state in step with the project's flows.

import { randomUUID } from 'node:crypto';

import * as z from 'zod';

import { askForSplit } from '../api/scenarioBuilder.js';
import { getCompat } from '../api/status.js';
import { withUpdate } from '../outcome.js';
import { defineTool } from '../registry.js';
import {
  renderBuildScenarioResult,
  type BuildScenarioData,
  type ProposalData,
  type SplitSource,
} from '../render/views/buildScenario.js';
import { createResolver } from '../resolve/handles.js';
import { flowWarnings } from './scenario/flowWarnings.js';
import { MAX_SCENARIO_FLOWS } from './scenario/limits.js';
import { equalShares, sharesFromProposal } from './scenario/propose.js';

/** The request put to the scenario-builder chat; the flows themselves go in `selected_flow_ids`. */
const SPLIT_REQUEST =
  'Propose how to split the virtual users between the selected flows, as a whole percentage for ' +
  'each flow. Give one plan entry per flow, with proportions that add up to 100.';

// Strict like the other tools: a field of the generation is refused, not dropped.
const input = z.strictObject({
  name: z.string().min(1).max(100).describe('Name of the composition this scenario will become.'),
  flows: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_SCENARIO_FLOWS)
    .describe('Names of the flows to combine (1-20).'),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
});

export const scenarioSuggestSplit = defineTool({
  name: 'scenario_suggest_split',
  title: 'Suggest the traffic split',
  description:
    'Suggest how to split the traffic between the flows (percent per flow) and show the proposal ' +
    'to the user; step 04, before scenario_generate. Generates nothing and sends no traffic: it ' +
    'asks the scenario builder of LoadCraft once (a language model call), and a single flow gets ' +
    '100% without asking. Pass the split the user approves to scenario_generate as `proportions`.',
  input,
  annotations: { openWorldHint: true },
  async run(ctx, args) {
    await getCompat(ctx);
    const resolver = createResolver(ctx);
    const project = await resolver.project(args.project ?? '');
    const resolved = await Promise.all(args.flows.map((name) => resolver.flow(project.id, name)));
    const flows = resolved.filter(
      (flow, index) => resolved.findIndex((other) => other.id === flow.id) === index,
    );
    const draftId = randomUUID();

    let shares: number[];
    let source: SplitSource;
    if (flows.length === 1) {
      shares = [100];
      source = 'single_flow';
    } else {
      const ids = flows.map((flow) => flow.id);
      const asked = await askForSplit(ctx, project.id, draftId, ids, SPLIT_REQUEST);
      const proposed = sharesFromProposal(ids, asked);
      shares = proposed ?? equalShares(flows.length);
      source = proposed === null ? 'equal_fallback' : 'model';
    }

    const old = await flowWarnings(ctx, project.id, flows, 'scenario_suggest_split');
    const proposal = flows.map((flow, index) => ({ flow: flow.name, percent: shares[index] ?? 0 }));
    await ctx.state.set('drafts', args.name, {
      projectId: project.id,
      draftId,
      flows: flows.map((flow) => ({ id: flow.id, name: flow.name })),
      proposed: Object.fromEntries(proposal.map((row) => [row.flow, row.percent])),
    });
    const data: BuildScenarioData = {
      name: args.name,
      proposal,
      source,
      ...(old.names.length === 0 ? {} : { oldDocs: old.names }),
      ...(old.needsInput === undefined ? {} : { needsInput: old.needsInput }),
    } satisfies ProposalData;
    return withUpdate({ status: 'done', data }, old.update);
  },
  render: renderBuildScenarioResult,
});
