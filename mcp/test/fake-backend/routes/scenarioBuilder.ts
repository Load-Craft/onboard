// Scenario-builder route of the fake backend: one turn of the traffic-split chat. The fake plays the
// language model from a script a test sets with `scriptBuilderModel`; without a script the model
// answers in prose and proposes nothing. Answer shape and 404 texts follow the backend's
// route (send message, flow ownership) and its proposal model. Registration is idempotent
// per fake, so every test that needs the route can call it.

import type { components } from '../../../src/http/generated/api.js';
import { FakeHttpError, type Fake } from '../server.js';
import { SKLEP_COLLECTIONS } from '../worlds/sklep.js';

type Proposal = components['schemas']['GenerationPlanProposal'];

export const BUILDER_COLLECTIONS = {
  script: 'scenario_builder_script',
  messages: 'scenario_builder_messages',
} as const;

/** What the played model proposes: percent per flow name, several rows for one name allowed. */
export interface BuilderScript {
  readonly id: 'model';
  readonly shares: readonly { readonly flow: string; readonly proportion: number }[];
}

interface FlowRow {
  readonly id: string;
  readonly name: string;
  readonly project_id: string;
}

export interface BuilderMessage {
  readonly id: string;
  readonly draft_id: string;
  readonly message: string;
  readonly selected_flow_ids: readonly string[];
}

/** The next turns of every draft propose these shares (the fake's model is stateless). */
export function scriptBuilderModel(fake: Fake, shares: BuilderScript['shares']): void {
  const scripts = fake.store.collection<BuilderScript>(BUILDER_COLLECTIONS.script);
  scripts.delete('model');
  scripts.insert({ id: 'model', shares });
}

const registered = new WeakSet<Fake>();

export function registerScenarioBuilderRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/scenario-builder/{draft_id}/messages',
    (req, store) => {
      const projectId = req.params.project_id;
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(projectId, `Project not found: ${projectId}`);
      const body = (req.body ?? {}) as { message?: string; selected_flow_ids?: string[] };
      const selected = body.selected_flow_ids ?? [];
      const flows = store.collection<FlowRow>(SKLEP_COLLECTIONS.flows);
      const owned = selected.map((id) => {
        const flow = flows.require(id, `Flow not found: ${id}`);
        if (flow.project_id !== projectId) {
          throw new FakeHttpError(404, { detail: `Flow ${id} not found in project ${projectId}` });
        }
        return flow;
      });
      store.collection<BuilderMessage>(BUILDER_COLLECTIONS.messages).insert({
        id: store.newId(),
        draft_id: req.params.draft_id,
        message: body.message ?? '',
        selected_flow_ids: selected,
      });
      const script = store.collection<BuilderScript>(BUILDER_COLLECTIONS.script).get('model');
      const proposal: Proposal | null =
        script === undefined
          ? null
          : {
              mode: 'parallel',
              comp_name: '',
              entries: script.shares.map((share) => ({
                flow_id: owned.find((flow) => flow.name === share.flow)?.id ?? 'unknown-flow',
                variant_label: share.flow,
                truncate_after_block_id: null,
                proportion: share.proportion,
              })),
            };
      return {
        status: 200,
        body: {
          reply: proposal === null ? 'Tell me which journeys matter most.' : 'Here is a split.',
          message_id: store.newId(),
          proposal,
          chips: [],
        },
      };
    },
  );
}
