// Sentinel cases of the tools of module flows (test/security/canaryCases.ts finds them here): a
// secret in an answer of the backend never reaches the model, the log or the state file.

import type { components } from '../../../src/http/generated/api.js';
import type { StoredSpec } from '../../fake-backend/routes/setup.js';
import { FLOW_COLLECTIONS } from '../../fake-backend/routes/flows.js';
import {
  seedCopilotTurns,
  seedDroppedChanges,
  seedLenientApply,
} from '../../fake-backend/routes/flowCopilot.js';
import {
  seedCopilotAnswer,
  seedFlowVersion,
  seedWalk,
  seedWalkNote,
} from '../../fake-backend/routes/flowWrites.js';
import { seedWalkSnapshot } from '../../fake-backend/routes/walkImages.js';
import { SKLEP_COLLECTIONS, SKLEP_WORLD_IDS } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import type { Case } from '../../security/canaryCases.js';
import { BACKEND_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';

type FlowDetail = components['schemas']['FlowDetail'];

/** The name and the description of the first flow carry credentials only the mask finds. */
function flowSecrets(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  const flows = fake.store.collection<{ id: string }>(FLOW_COLLECTIONS.flows);
  const [first] = flows.list();
  if (first === undefined) return;
  flows.update(first.id, {
    name: `checkout Authorization: Bearer ${SHAPE_CANARY}`,
    description: `password: ${BACKEND_CANARY}`,
  });
}

/** The flow is at version 2 over a stored version 1; its name and description carry credentials only the mask finds. */
function restorableFlow(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  const flows = fake.store.collection<FlowDetail>(FLOW_COLLECTIONS.flows);
  const flow = flows.require(SKLEP_IDS.flowZakupy, 'flow');
  seedFlowVersion(fake.store, flow, 1, `password: ${BACKEND_CANARY}`);
  flows.update(flow.id, { current_version: 2 });
  flowSecrets(fake);
}

/** The flow carries credentials, and so does the copilot's reply and its proposal. */
function proposalSecrets(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  flowSecrets(fake);
  seedCopilotAnswer(fake.store, SKLEP_IDS.flowZakupy, {
    message_id: 'm1',
    reply: `Use password: ${BACKEND_CANARY} and Authorization: Bearer ${SHAPE_CANARY}`,
    changes: [
      {
        id: 'c1',
        type: 'modify',
        target_block_id: 'b1',
        description: `Set the header Authorization: Bearer ${SHAPE_CANARY}`,
        warnings: [`password=${BACKEND_CANARY}`],
      },
    ],
  });
}

/** The first flow has an open poll question whose text carries credentials only the mask finds. */
function pollQuestion(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  const flows = fake.store.collection<FlowDetail>(FLOW_COLLECTIONS.flows);
  flows.update(SKLEP_IDS.flowZakupy, {
    needs_input: [
      {
        kind: 'poll_status',
        field: 'job.status',
        question: `Which statuses end it? password: ${BACKEND_CANARY}`,
        why: `Authorization: Bearer ${SHAPE_CANARY}`,
        definite: false,
      },
    ] as unknown as NonNullable<FlowDetail['needs_input']>,
  });
}

/** A copilot turn whose changes carry credentials in their text and in their request block. */
function proposedChanges(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  flowSecrets(fake);
  const flows = fake.store.collection<FlowDetail>(FLOW_COLLECTIONS.flows);
  flows.update(SKLEP_IDS.flowZakupy, { current_version: 2 });
  const change = (id: string) => ({
    id,
    type: 'add' as const,
    target_block_id: `b-${id}`,
    description: `Add Authorization: Bearer ${SHAPE_CANARY}`,
    before: null,
    after: null,
    block: { id: `b-${id}`, headers: { Authorization: `Bearer ${BACKEND_CANARY}` } },
  });
  seedCopilotTurns(fake.store, SKLEP_IDS.flowZakupy, [
    {
      role: 'assistant',
      content: 'x',
      message_id: 'turn-1',
      changes: [change('c1'), change('c2')],
    },
  ]);
  seedDroppedChanges(fake.store, SKLEP_IDS.flowZakupy, ['c2']);
  seedLenientApply(fake.store, SKLEP_IDS.flowZakupy);
}

const OLDER_DOCS = '5c2e8a14-7d39-4b60-9f1a-3e6b0d8c4a72';

/** An older docs version whose version carries credentials only the mask finds, and the flow's name too. */
function copyTargets(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  fake.store.collection<StoredSpec>(SKLEP_COLLECTIONS.specs).insert({
    id: OLDER_DOCS,
    title: 'Sklep API',
    version: `2.13.0 password: ${BACKEND_CANARY}`,
    description: null,
    created_at: '2026-10-01T09:00:00Z',
    endpoints_count: 20,
    is_active: false,
    is_current: false,
    source_url: null,
  });
  flowSecrets(fake);
}

const WALK = '4d2b8f1e-7a39-4c60-9e15-3b8a0d6c2f47';
const WALK_NOTE = '3f2a9c0b7d4e4a51b8c6d2e1f09a7b34';

/** A walk with a note whose text carries credentials only the mask finds. */
function walkWithSecretNote(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  seedWalk(fake.store, SKLEP_IDS.project, WALK);
  seedWalkNote(fake.store, WALK, {
    id: WALK_NOTE,
    step_id: 'step-3',
    text: `Use Authorization: Bearer ${SHAPE_CANARY}, password: ${BACKEND_CANARY}`,
  });
}

type Version = components['schemas']['FlowVersionDetail'];

/** A version of `zakupy` whose reason carries a credential and whose auth evidence carries a code. */
function versionSecrets(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  const flows = fake.store.collection<FlowDetail>(FLOW_COLLECTIONS.flows);
  const flow = flows.list().find((item) => item.name === 'zakupy');
  if (flow === undefined) return;
  fake.store.collection<Version>(FLOW_COLLECTIONS.versions).insert({
    id: '00000000-0000-4000-8000-000000000001',
    flow_id: flow.id,
    version: 1,
    blocks_snapshot: flow.blocks,
    edges_snapshot: flow.edges,
    entry_block_id_snapshot: flow.entry_block_id ?? null,
    variables_snapshot: {},
    change_reason: `Authorization: Bearer ${SHAPE_CANARY} password: ${BACKEND_CANARY}`,
    created_at: '2026-11-11T10:00:00Z',
    created_by: null,
    auth_evidence_snapshot: { redirect: `https://idp.example.test/cb?code=${BACKEND_CANARY}` },
  });
}

const READ_WALK = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const WALKS_PATH = `/api/v1/projects/${SKLEP_IDS.project}/scenario-from-description/runs`;

/** The answers of the walk routes carry credentials in the description, the labels, the reasons and the notes. */
function walkSecrets(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  const secret = `Authorization: Bearer ${SHAPE_CANARY} password: ${BACKEND_CANARY}`;
  fake.faults.next('GET', WALKS_PATH, {
    status: 200,
    body: {
      runs: [
        {
          run_id: READ_WALK,
          status: 'running',
          created_at: '2026-11-26T10:00:00Z',
          awaiting_split_approval: false,
          description_excerpt: secret,
          current_step: 'browser_agent',
        },
      ],
    },
  });
  fake.faults.next('GET', `${WALKS_PATH}/${READ_WALK}`, {
    status: 200,
    body: {
      protocol_version: 2,
      run_id: READ_WALK,
      status: 'done',
      title: secret,
      description: secret,
      awaiting_split_approval: false,
      all_paths_failed: false,
      paths: [
        {
          path_index: 0,
          name: secret,
          status: 'failed',
          step_count: 1,
          attempts: [1],
          partial: false,
          not_driven: false,
          failure_reason: secret,
        },
      ],
      flows_saved: [],
    },
  });
  fake.faults.next('GET', `${WALKS_PATH}/${READ_WALK}/timeline`, {
    status: 200,
    body: {
      run_id: READ_WALK,
      events: [
        { type: 'agent_plan', plan: { path_index: 0, attempt: 1, steps: [secret] } },
        {
          type: 'agent_step',
          step: {
            path_index: 0,
            attempt: 1,
            step_number: 1,
            label: secret,
            outcome: 'failed',
            source: 'agent',
            reason: secret,
          },
        },
      ],
      notes: [
        {
          id: 'n1',
          kind: 'text',
          remember: false,
          attempt: 1,
          path_index: 0,
          scope: 'plan_step',
          step_id: 's1',
          step_number: 1,
          text: secret,
        },
      ],
    },
  });
}

const COPILOT = `/api/v1/projects/${SKLEP_IDS.project}/flows/${SKLEP_IDS.flowZakupy}/copilot`;

/** The conversation and the suggestions carry credentials in a message, a change and a suggestion. */
function copilotSecrets(fake: Parameters<NonNullable<Case['setup']>>[0]): void {
  const secret = `Authorization: Bearer ${SHAPE_CANARY} password: ${BACKEND_CANARY}`;
  fake.faults.next('GET', `${COPILOT}/history`, {
    status: 200,
    body: {
      messages: [
        { role: 'user', content: secret },
        {
          role: 'assistant',
          content: secret,
          changes: [
            {
              id: 'c1',
              type: 'modify',
              description: secret,
              status: 'applied',
              target_block_id: 'b1',
              block: { config: { token: BACKEND_CANARY } },
            },
          ],
        },
      ],
    },
  });
  fake.faults.next('GET', `${COPILOT}/suggestions`, {
    status: 200,
    body: { suggestions: [{ target_block_id: 'b1', text: secret }] },
  });
}

export const CANARY_CASES: readonly Case[] = [
  {
    tool: 'flows_save_walk_note',
    label: 'a new note at a step of a walk',
    stage: 'flows',
    args: () => ({ walk_id: WALK, step: 'step-5', text: 'Close the banner.' }),
    setup: walkWithSecretNote,
  },
  {
    tool: 'flows_save_walk_note',
    label: 'a changed note whose previous text carried secrets, format data, names tainted',
    stage: 'flows',
    names: true,
    args: () => ({
      walk_id: WALK,
      step: 'step-3',
      note_id: WALK_NOTE,
      text: 'Clean.',
      format: 'data',
    }),
    setup: walkWithSecretNote,
  },
  {
    tool: 'flows_duplicate',
    label: 'a copy of a flow whose name carries credentials',
    stage: 'flows',
    args: () => ({ flow_ids: SKLEP_IDS.flowZakupy }),
    setup: flowSecrets,
  },
  {
    tool: 'flows_duplicate',
    label: 'a copy onto an older docs version, names tainted, format data',
    stage: 'flows',
    names: true,
    args: () => ({ flow_ids: SKLEP_IDS.flowZakupy, docs_id: OLDER_DOCS, format: 'data' }),
    setup: copyTargets,
  },
  {
    tool: 'flows_merge',
    label: 'two flows, the name of the first carries credentials',
    stage: 'flows',
    args: () => ({ flow_ids: `${SKLEP_IDS.flowZakupy},${SKLEP_WORLD_IDS.flowKonto}` }),
    setup: flowSecrets,
  },
  {
    tool: 'flows_merge',
    label: 'the same, names tainted, format data, a name of the new flow',
    stage: 'flows',
    names: true,
    args: () => ({
      flow_ids: `${SKLEP_IDS.flowZakupy},${SKLEP_WORLD_IDS.flowKonto}`,
      name: 'Merged',
      format: 'data',
    }),
    setup: flowSecrets,
  },
  {
    tool: 'flows_restore_version',
    label: 'an older version of a flow whose name carries credentials',
    stage: 'flows',
    args: () => ({ flow_id: SKLEP_IDS.flowZakupy, version: 1 }),
    setup: restorableFlow,
  },
  {
    tool: 'flows_restore_version',
    label: 'the same, names tainted, format data',
    stage: 'flows',
    names: true,
    args: () => ({ flow_id: SKLEP_IDS.flowZakupy, version: 1, format: 'data' }),
    setup: restorableFlow,
  },
  {
    tool: 'flows_list',
    label: 'the flows of the project',
    stage: 'flows',
    args: () => ({}),
    setup: flowSecrets,
  },
  {
    tool: 'flows_list',
    label: 'the flows, names tainted, format data, a filter',
    stage: 'flows',
    names: true,
    args: () => ({ format: 'data', query: 'a' }),
    setup: flowSecrets,
  },
  {
    tool: 'flows_get',
    label: 'outline of one flow, its name and questions carry credentials',
    stage: 'flows',
    args: () => ({ flow_id: 'zakupy' }),
    setup: (fake) => {
      const flows = fake.store.collection<FlowDetail>(FLOW_COLLECTIONS.flows);
      const zakupy = flows.list().find((flow) => flow.name === 'zakupy');
      if (zakupy === undefined) return;
      flows.update(zakupy.id, {
        needs_input: [
          {
            kind: 'auth',
            field: 'auth.token',
            definite: false,
            question: `Which account? Authorization: Bearer ${SHAPE_CANARY}`,
            why: `password: ${BACKEND_CANARY}`,
          },
        ],
      });
    },
  },
  {
    tool: 'flows_get_versions',
    label: 'the versions of a flow, reasons carry credentials',
    stage: 'flows',
    args: () => ({ flow_id: 'zakupy' }),
    setup: versionSecrets,
  },
  {
    tool: 'flows_get_versions',
    label: 'one version, auth evidence and reason tainted, format data',
    stage: 'flows',
    names: true,
    args: () => ({ flow_id: SKLEP_IDS.flowZakupy, version: 1, format: 'data' }),
    setup: versionSecrets,
  },
  {
    tool: 'flows_get_walks',
    label: 'the list of walks, descriptions carry credentials',
    stage: 'flows',
    args: () => ({}),
    setup: walkSecrets,
  },
  {
    tool: 'flows_get_walks',
    label: 'one walk with its timeline, format data',
    stage: 'flows',
    args: () => ({ walk_id: READ_WALK, include: ['timeline'], format: 'data' }),
    setup: walkSecrets,
  },
  {
    tool: 'flows_get_copilot_history',
    label: 'the conversation of a flow with the copilot',
    stage: 'flows',
    args: () => ({ flow_id: SKLEP_IDS.flowZakupy }),
    setup: copilotSecrets,
  },
  {
    tool: 'flows_get_copilot_history',
    label: 'the suggestions, format data',
    stage: 'flows',
    names: true,
    args: () => ({ flow_id: SKLEP_IDS.flowZakupy, suggestions: true, format: 'data' }),
    setup: copilotSecrets,
  },
  {
    tool: 'flows_ask_copilot',
    label: 'the card of a question over a flow whose texts hold credentials',
    stage: 'flows',
    personSaysYes: true,
    args: () => ({ flow_id: SKLEP_IDS.flowZakupy, message: `why? password=${BACKEND_CANARY}` }),
    setup: proposalSecrets,
  },
  {
    tool: 'flows_ask_copilot',
    label: 'the proposal after the yes of the person',
    stage: 'flows',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('flows_ask_copilot', { flow_id: SKLEP_IDS.flowZakupy });
      return {};
    },
    args: () => ({ flow_id: SKLEP_IDS.flowZakupy }),
    setup: proposalSecrets,
  },
  {
    tool: 'flows_set_poll_terminals',
    label: 'an answer over a flow whose name and open question carry credentials',
    stage: 'flows',
    args: () => ({
      flow_id: SKLEP_IDS.flowZakupy,
      field: 'job.status',
      success_terminals: 'DONE',
    }),
    setup: (fake) => {
      pollQuestion(fake);
      flowSecrets(fake);
    },
  },
  {
    tool: 'flows_set_poll_terminals',
    label: 'the same, names tainted, format data',
    stage: 'flows',
    names: true,
    args: () => ({
      flow_id: SKLEP_IDS.flowZakupy,
      field: 'job.status',
      success_terminals: 'DONE',
      failure_terminals: 'FAILED',
      format: 'data',
    }),
    setup: (fake) => {
      pollQuestion(fake);
      flowSecrets(fake);
    },
  },
  {
    tool: 'flows_apply_copilot_changes',
    label: 'accept and reject over a turn whose changes carry credentials',
    stage: 'flows',
    args: () => ({
      flow_id: SKLEP_IDS.flowZakupy,
      message_id: 'turn-1',
      accept: 'c1,c2',
    }),
    setup: proposedChanges,
  },
  {
    tool: 'flows_apply_copilot_changes',
    label: 'the same, names tainted, format data, one rejected',
    stage: 'flows',
    names: true,
    args: () => ({
      flow_id: SKLEP_IDS.flowZakupy,
      message_id: 'turn-1',
      accept: 'c1',
      reject: 'c2',
      format: 'data',
    }),
    setup: proposedChanges,
  },
  {
    tool: 'flows_save',
    label: 'drop the last steps of a flow whose name and variables carry credentials',
    stage: 'flows',
    args: () => ({ flow_id: SKLEP_IDS.flowZakupy, drop_steps: '6,7', reason: 'cut' }),
    setup: (fake) => {
      flowSecrets(fake);
      fake.store
        .collection<FlowDetail>(FLOW_COLLECTIONS.flows)
        .update(SKLEP_IDS.flowZakupy, { variables: { api_secret: BACKEND_CANARY } });
    },
  },
  {
    tool: 'flows_save',
    label: 'a new flow, names tainted, format data',
    stage: 'flows',
    names: true,
    args: () => ({
      name: 'signup',
      description: 'New account',
      graph: {
        blocks: [
          {
            id: 'a',
            type: 'request',
            name: 'start',
            enabled: true,
            config: { method: 'GET', path: '/x', headers: {} },
          },
        ],
        edges: [],
        entry_block_id: 'a',
      },
      format: 'data',
    }),
  },
  {
    tool: 'flows_export_walk_image',
    label: 'a live snapshot of a step, saved as a file',
    stage: 'flows',
    args: () => ({ walk_id: READ_WALK, path_index: 1 }),
    setup: (fake) => {
      seedWalkSnapshot(fake.store, READ_WALK, 1, 1, Buffer.from('89504e470d0a1a0a00000000', 'hex'));
    },
  },
  {
    tool: 'flows_regenerate',
    label: 'the card of a regeneration over a flow whose texts hold credentials',
    stage: 'flows',
    personSaysYes: true,
    args: () => ({ flow_id: SKLEP_IDS.flowZakupy }),
    setup: flowSecrets,
  },
  {
    tool: 'flows_regenerate',
    label: 'the run after the yes of the person',
    stage: 'flows',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('flows_regenerate', { flow_id: SKLEP_IDS.flowZakupy });
      return {};
    },
    args: () => ({ flow_id: SKLEP_IDS.flowZakupy }),
    setup: flowSecrets,
  },
];
