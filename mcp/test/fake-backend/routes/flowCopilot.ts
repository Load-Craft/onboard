// The flow copilot's turns and what applies them (src/tools/flows/applyCopilotChanges.ts): the
// history of a flow (`GET …/copilot/history`, the turns a test plants with `seedCopilotTurn`), the
// apply of the accepted changes (`POST …/copilot/apply`: the version must be the current one, the
// copilot changes must be those the turn recorded, the changes are applied in order as one new version,
// the accepted ones are recorded), and the resolutions (`POST …/copilot/resolutions`, 204). A test
// names the changes the apply drops with `seedDroppedChanges`. Registration is idempotent per fake.

import type { components } from '../../../src/http/generated/api.js';
import { FakeHttpError, type Fake, type Store } from '../server.js';
import { FLOW_COLLECTIONS } from './flows.js';
import { seedFlowVersion } from './flowWrites.js';

type FlowDetail = components['schemas']['FlowDetail'];
type HistoryMessage = components['schemas']['backend__api__routes__flow_copilot__HistoryMessage'];
type HistoryChange = components['schemas']['HistoryChange'];
type ApplyBody = components['schemas']['ApplyProposalRequest'];

const registered = new WeakSet<Fake>();

const TURNS = 'flow_copilot_turns_stored';
const DROPPED = 'flow_copilot_dropped';
const STATUSES = 'flow_copilot_statuses';
const LENIENT = 'flow_copilot_lenient';

interface Stored<T> {
  readonly id: string;
  readonly value: T;
}

function put<T>(store: Store, collection: string, id: string, value: T): void {
  const records = store.collection<Stored<T>>(collection);
  records.delete(id);
  records.insert({ id, value });
}

function read<T>(store: Store, collection: string, id: string): T | undefined {
  return store.collection<Stored<T>>(collection).get(id)?.value;
}

/** The copilot turns the flow's history holds: a user turn is `{role: 'user', content}`. */
export function seedCopilotTurns(
  store: Store,
  flowId: string,
  turns: readonly HistoryMessage[],
): void {
  put(store, TURNS, flowId, [...turns]);
}

/** The changes of the flow the apply drops (the backend's validation can drop some). */
export function seedDroppedChanges(store: Store, flowId: string, ids: readonly string[]): void {
  put(store, DROPPED, flowId, [...ids]);
}

/**
 * The apply of the flow compares a change with the turn by its identity only (id, type, target block).
 * For the sentinel runs, whose proxy taints every text the tool reads and so every text it sends back.
 */
export function seedLenientApply(store: Store, flowId: string): void {
  put(store, LENIENT, flowId, true);
}

/** The outcomes recorded for the changes of the flow: change id -> `accepted` or `rejected`. */
export function recordedStatuses(store: Store, flowId: string): Record<string, string> {
  return read<Record<string, string>>(store, STATUSES, flowId) ?? {};
}

function turnsOf(store: Store, flowId: string): HistoryMessage[] {
  const turns = read<HistoryMessage[]>(store, TURNS, flowId) ?? [];
  const statuses = recordedStatuses(store, flowId);
  return turns.map((turn) => ({
    ...turn,
    ...(turn.changes == null
      ? {}
      : {
          changes: turn.changes.map((change) => {
            const status = statuses[change.id];
            return status === undefined ? change : { ...change, status };
          }),
        }),
  }));
}

function flowOf(store: Store, projectId: string, flowId: string): FlowDetail {
  const flow = store
    .collection<FlowDetail>(FLOW_COLLECTIONS.flows)
    .require(flowId, `Flow not found: ${flowId}`);
  if (flow.project_id !== projectId) {
    throw new FakeHttpError(404, { detail: `Flow ${flowId} not found in project ${projectId}` });
  }
  return flow;
}

const MODEL_FIELDS = [
  'id',
  'type',
  'target_block_id',
  'description',
  'before',
  'after',
  'block',
] as const;

export function registerFlowCopilotRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/flows/{flow_id}/copilot/history',
    (req, store) => {
      flowOf(store, req.params.project_id, req.params.flow_id);
      return { status: 200, body: { messages: turnsOf(store, req.params.flow_id) } };
    },
  );

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/flows/{flow_id}/copilot/apply',
    (req, store) => {
      const flow = flowOf(store, req.params.project_id, req.params.flow_id);
      const body = req.body as ApplyBody;
      if (body.expected_version !== flow.current_version) {
        throw new FakeHttpError(409, {
          detail: `version_conflict: the flow is at version ${String(flow.current_version)}`,
        });
      }
      const changes = body.changes ?? [];
      if (changes.length === 0) throw new FakeHttpError(400, { detail: 'No changes to apply' });
      const turn = turnsOf(store, flow.id).find((one) => one.message_id === body.message_id);
      if (body.message_id == null || turn === undefined) {
        throw new FakeHttpError(422, { detail: 'Unknown copilot turn' });
      }
      for (const change of changes) {
        const recorded = (turn.changes ?? []).find((one) => one.id === change.id);
        const lenient = read<boolean>(store, LENIENT, flow.id) === true;
        const same =
          recorded !== undefined &&
          (lenient ? (['id', 'type', 'target_block_id'] as const) : MODEL_FIELDS).every(
            (field) =>
              JSON.stringify((recorded as Record<string, unknown>)[field] ?? null) ===
              JSON.stringify((change as Record<string, unknown>)[field] ?? null),
          );
        if (!same) {
          throw new FakeHttpError(422, {
            detail: `Change ${change.id} differs from the recorded proposal`,
          });
        }
      }
      const dropped = new Set(read<string[]>(store, DROPPED, flow.id) ?? []);
      const kept = changes.filter((change) => !dropped.has(change.id));
      let blocks = structuredClone(flow.blocks);
      for (const change of kept) {
        const block = (change.block ?? {}) as Record<string, unknown>;
        if (change.type === 'add') blocks = [...blocks, block];
        else if (change.type === 'remove') {
          blocks = blocks.filter((one) => one['id'] !== change.target_block_id);
        } else {
          blocks = blocks.map((one) => (one['id'] === change.target_block_id ? block : one));
        }
      }
      const next = flow.current_version + 1;
      const saved = store.collection<FlowDetail>(FLOW_COLLECTIONS.flows).update(flow.id, {
        blocks,
        current_version: next,
        updated_at: '2026-11-27T12:00:00Z',
      });
      seedFlowVersion(store, saved, next, 'Loadcrafter copilot apply');
      put(store, STATUSES, flow.id, {
        ...recordedStatuses(store, flow.id),
        ...Object.fromEntries(kept.map((change) => [change.id, 'accepted'])),
      });
      return {
        status: 200,
        body: {
          changes_requested: changes.length,
          changes_applied: kept.length,
          flow: saved,
          resolution_recorded: true,
          warnings:
            dropped.size === 0
              ? []
              : [...dropped].map((id) => ({
                  change_id: id,
                  severity: 'warning',
                  message: `Change ${id} was dropped by the validation`,
                })),
        },
      };
    },
  );

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/flows/{flow_id}/copilot/resolutions',
    (req, store) => {
      flowOf(store, req.params.project_id, req.params.flow_id);
      const body = req.body as { resolutions: { change_id: string; status: string }[] };
      put(store, STATUSES, req.params.flow_id, {
        ...recordedStatuses(store, req.params.flow_id),
        ...Object.fromEntries(body.resolutions.map((item) => [item.change_id, item.status])),
      });
      return { status: 204 };
    },
  );
}

export type { HistoryChange };
