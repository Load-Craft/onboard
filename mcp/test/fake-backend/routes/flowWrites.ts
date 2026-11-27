// Write routes of flows for the tools of module flows that change a flow (src/tools/flows/): the
// restore of a version, and the others the tools need. They work over the `flows` and
// `flow_versions` collections of `routes/flows.ts`. A test plants the versions it restores with
// `seedFlowVersion`. Registration is idempotent per fake.

import type { components } from '../../../src/http/generated/api.js';
import { FakeHttpError, type Fake, type Store } from '../server.js';
import { FLOW_COLLECTIONS } from './flows.js';

type FlowDetail = components['schemas']['FlowDetail'];
type FlowVersionDetail = components['schemas']['FlowVersionDetail'];
type RestoreWarning = components['schemas']['FlowRestoreWarning'];

type CopilotAnswer =
  components['schemas']['backend__api__routes__flow_copilot__SendMessageResponse'];

const COPILOT_ANSWERS = 'flow_copilot_answers';
const COPILOT_TURNS = 'flow_copilot_turns';

/** The next copilot answers for the flow (a question or the review) carry this proposal. */
export function seedCopilotAnswer(store: Store, flowId: string, answer: CopilotAnswer): void {
  const collection = store.collection<{ id: string; answer: CopilotAnswer }>(COPILOT_ANSWERS);
  collection.delete(flowId);
  collection.insert({ id: flowId, answer });
}

/** How many turns of the model the copilot of the flow was asked for. */
export function copilotTurns(store: Store, flowId: string): number {
  return store
    .collection<{ id: string; flow_id: string }>(COPILOT_TURNS)
    .list((turn) => turn.flow_id === flowId).length;
}

/** What the restore of a flow reports it could not bring back (a test plants it). */
export const RESTORE_WARNINGS = 'flow_restore_warnings';

/** The next restores of the flow answer with these warnings. */
export function seedRestoreWarnings(
  store: Store,
  flowId: string,
  warnings: readonly RestoreWarning[],
): void {
  const collection = store.collection<{ id: string; warnings: readonly RestoreWarning[] }>(
    RESTORE_WARNINGS,
  );
  collection.delete(flowId);
  collection.insert({ id: flowId, warnings });
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

/** Stores the state of a flow as one of its versions (what a test restores later). */
export function seedFlowVersion(
  store: Store,
  flow: FlowDetail,
  version: number,
  reason: string | null = null,
): void {
  store.collection<FlowVersionDetail>(FLOW_COLLECTIONS.versions).insert({
    id: store.newId(),
    flow_id: flow.id,
    version,
    blocks_snapshot: structuredClone(flow.blocks),
    edges_snapshot: structuredClone(flow.edges),
    entry_block_id_snapshot: flow.entry_block_id,
    variables_snapshot: structuredClone(flow.variables),
    needs_input_snapshot: structuredClone(flow.needs_input ?? []),
    change_reason: reason,
    created_at: '2026-11-20T10:00:00Z',
    created_by: null,
  });
}

/** The versions a flow holds, oldest first. */
export function versionsOf(store: Store, flowId: string): FlowVersionDetail[] {
  return store
    .collection<FlowVersionDetail>(FLOW_COLLECTIONS.versions)
    .list((item) => item.flow_id === flowId)
    .sort((a, b) => a.version - b.version);
}

/** What the merge of flows answers beside the flow (a test plants it). */
export const MERGE_WARNINGS = 'flow_merge_warnings';

/** The next merges of the project answer with these warnings. */
export function seedMergeWarnings(
  store: Store,
  projectId: string,
  warnings: readonly string[],
): void {
  const collection = store.collection<{ id: string; warnings: readonly string[] }>(MERGE_WARNINGS);
  collection.delete(projectId);
  collection.insert({ id: projectId, warnings });
}

type FlowSummary = components['schemas']['FlowSummary'];
type SessionNote = components['schemas']['SessionNote'];

/** The walks (runs from a description) a test plants, by project; the notes are kept per walk. */
export const WALKS = 'flow_walks';
export const WALK_NOTES = 'flow_walk_notes';

interface StoredWalk {
  readonly id: string;
  readonly project_id: string;
}
interface StoredNote {
  readonly id: string;
  readonly run_id: string;
  readonly note: SessionNote;
}

/** Plants a walk the note routes accept (and the timeline answers for, with its notes). */
export function seedWalk(store: Store, projectId: string, runId: string): void {
  store.collection<StoredWalk>(WALKS).insert({ id: runId, project_id: projectId });
}

/** Plants a note of a walk, as the backend keeps it. */
export function seedWalkNote(
  store: Store,
  runId: string,
  note: Partial<SessionNote> & Pick<SessionNote, 'id' | 'step_id' | 'text'>,
): void {
  store.collection<StoredNote>(WALK_NOTES).insert({
    id: note.id ?? '',
    run_id: runId,
    note: {
      kind: 'text',
      remember: false,
      attempt: 1,
      path_index: 0,
      scope: 'plan_step',
      step_number: 1,
      ...note,
    },
  });
}

/** The notes of a walk, as the timeline carries them. */
export function notesOfWalk(store: Store, runId: string): SessionNote[] {
  return store
    .collection<StoredNote>(WALK_NOTES)
    .list((item) => item.run_id === runId)
    .map((item) => item.note);
}

/** Whether a test planted this walk (a run the describe routes do not hold). */
export function isPlantedWalk(store: Store, runId: string): boolean {
  return store.collection<StoredWalk>(WALKS).get(runId) !== undefined;
}

function summaryOf(flow: FlowDetail): FlowSummary {
  return {
    id: flow.id,
    name: flow.name,
    description: flow.description,
    flow_type: flow.flow_type,
    generated_by: flow.generated_by,
    current_version: flow.current_version,
    is_active: flow.is_active,
    tags: flow.tags,
    blocks_count: flow.blocks.length,
    step_count: flow.blocks.length,
    needs_input_count: 0,
    needs_input_definite_count: 0,
    created_at: flow.created_at,
    updated_at: flow.updated_at,
  };
}

/** A copy of a flow: a new id, version 1, and the name given or `<name> (copy)`. */
function copyOf(store: Store, flow: FlowDetail, name: string | null | undefined): FlowDetail {
  const copy: FlowDetail = {
    ...structuredClone(flow),
    id: store.newId(),
    name: name ?? `${flow.name} (copy)`,
    current_version: 1,
    created_at: '2026-11-27T12:00:00Z',
    updated_at: '2026-11-27T12:00:00Z',
  };
  store.collection<FlowDetail>(FLOW_COLLECTIONS.flows).insert(copy);
  seedFlowVersion(store, copy, 1, 'Duplicated');
  return copy;
}

const registered = new WeakSet<Fake>();

export function registerFlowWriteRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  // Restoring an older version makes its content the newest version of the flow.
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/flows/{flow_id}/versions/restore',
    (req, store) => {
      const flow = flowOf(store, req.params.project_id, req.params.flow_id);
      const body = req.body as { version: number; change_reason?: string | null };
      const source = versionsOf(store, flow.id).find((item) => item.version === body.version);
      if (source === undefined) {
        throw new FakeHttpError(404, {
          detail: `Version ${String(body.version)} not found for flow ${flow.id}`,
        });
      }
      const next = flow.current_version + 1;
      const restored = store.collection<FlowDetail>(FLOW_COLLECTIONS.flows).update(flow.id, {
        blocks: structuredClone(source.blocks_snapshot),
        edges: structuredClone(source.edges_snapshot),
        entry_block_id: source.entry_block_id_snapshot ?? null,
        variables: structuredClone(source.variables_snapshot),
        needs_input: structuredClone(source.needs_input_snapshot ?? []) as unknown as NonNullable<
          FlowDetail['needs_input']
        >,
        current_version: next,
        updated_at: '2026-11-27T12:00:00Z',
      });
      seedFlowVersion(
        store,
        restored,
        next,
        body.change_reason ?? `Restored from version ${String(body.version)}`,
      );
      const warnings = store
        .collection<{ id: string; warnings: RestoreWarning[] }>(RESTORE_WARNINGS)
        .get(flow.id)?.warnings;
      return { status: 200, body: warnings === undefined ? restored : { ...restored, warnings } };
    },
  );

  // Merging: the first flow whole, the later ones without their leading block (a read); 2 to 20
  // distinct flows of the project, else a 422 (count) or a 400 (a flow twice).
  fake.route('POST', '/api/v1/projects/{project_id}/flows/merge', (req, store) => {
    const projectId = req.params.project_id;
    const body = req.body as { flow_ids: string[]; name?: string | null };
    if (body.flow_ids.length < 2 || body.flow_ids.length > 20) {
      throw new FakeHttpError(422, { detail: 'flow_ids must hold 2 to 20 ids' });
    }
    if (new Set(body.flow_ids).size !== body.flow_ids.length) {
      throw new FakeHttpError(400, { detail: 'flow_ids has a flow twice' });
    }
    const sources = body.flow_ids.map((id) => flowOf(store, projectId, id));
    const blocks = sources.flatMap((flow, index) =>
      structuredClone(index === 0 ? flow.blocks : flow.blocks.slice(1)),
    );
    const ids = blocks.map((block) => String(block['id']));
    const [first] = sources;
    if (first === undefined) throw new FakeHttpError(422, { detail: 'no flows' });
    const merged: FlowDetail = {
      ...structuredClone(first),
      id: store.newId(),
      name: body.name ?? sources.map((flow) => flow.name).join(' + '),
      blocks,
      edges: ids.slice(0, -1).map((source, index) => ({
        id: `merged-edge-${String(index + 1)}`,
        source,
        target: ids[index + 1],
      })),
      entry_block_id: ids[0] ?? null,
      current_version: 1,
      created_at: '2026-11-27T12:00:00Z',
      updated_at: '2026-11-27T12:00:00Z',
    };
    store.collection<FlowDetail>(FLOW_COLLECTIONS.flows).insert(merged);
    seedFlowVersion(store, merged, 1, 'Merged');
    const warnings = store
      .collection<{ id: string; warnings: string[] }>(MERGE_WARNINGS)
      .get(projectId)?.warnings;
    return { status: 200, body: { flow: merged, ...(warnings === undefined ? {} : { warnings }) } };
  });

  // Duplicating flows: the flows the project does not have come back in `failed_ids`.
  fake.route('POST', '/api/v1/projects/{project_id}/flows/batch-duplicate', (req, store) => {
    const projectId = req.params.project_id;
    const body = req.body as { flow_ids: string[] };
    const flows = store.collection<FlowDetail>(FLOW_COLLECTIONS.flows);
    const created: FlowDetail[] = [];
    const failed: string[] = [];
    for (const id of body.flow_ids) {
      const found = flows.get(id);
      if (found === undefined || found.project_id !== projectId) failed.push(id);
      else created.push(copyOf(store, found, null));
    }
    return {
      status: 200,
      body: {
        created_flows: created.map(summaryOf),
        ...(failed.length > 0 ? { failed_ids: failed } : {}),
      },
    };
  });

  // The copy of one flow onto another docs version: an unknown version is a 404.
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/flows/{flow_id}/duplicate-for-spec',
    (req, store) => {
      const flow = flowOf(store, req.params.project_id, req.params.flow_id);
      const body = req.body as { target_spec_id: string; new_name?: string | null };
      const target = store
        .collection<{ id: string; version: string }>('openapi_specs')
        .require(body.target_spec_id, `OpenAPI spec not found: ${body.target_spec_id}`);
      const source = store
        .collection<{ id: string; version: string }>('openapi_specs')
        .get(flow.openapi_spec_id ?? '');
      const copy = store
        .collection<FlowDetail>(FLOW_COLLECTIONS.flows)
        .update(copyOf(store, flow, body.new_name).id, { openapi_spec_id: target.id });
      const requests = flow.blocks.filter((block) => block['type'] === 'request').length;
      return {
        status: 200,
        body: {
          flow: copy,
          migration_report: {
            source_spec_version: source?.version ?? '',
            target_spec_version: target.version,
            total_request_blocks: requests,
            matched_count: requests,
            changed_count: 0,
            unmatched_count: 0,
            entries: [],
          },
        },
      };
    },
  );

  const walkOf = (store: Store, projectId: string, runId: string): void => {
    const walk = store.collection<StoredWalk>(WALKS).get(runId);
    if (walk === undefined || walk.project_id !== projectId) {
      throw new FakeHttpError(404, { detail: `Scenario run not found: ${runId}` });
    }
  };
  const checkedText = (text: string): string => {
    const trimmed = text.trim();
    const refuse = (code: string, message: string): never => {
      throw new FakeHttpError(400, { detail: { code, message } });
    };
    if (trimmed === '') return refuse('note_empty', 'The note is empty');
    if (trimmed.length > 500) return refuse('note_too_long', 'The note is too long');
    return trimmed;
  };

  // A note at a step of a walk (new), and the change of its text.
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}/notes',
    (req, store) => {
      const { project_id: projectId, run_id: runId } = req.params;
      walkOf(store, projectId, runId);
      const body = req.body as {
        step_id: string;
        text?: string;
        kind?: 'text' | 'skip';
        remember?: boolean;
      };
      const text = checkedText(body.text ?? '');
      const note: SessionNote = {
        id: store.newId().replace(/-/gu, ''),
        step_id: body.step_id,
        text,
        kind: body.kind ?? 'text',
        remember: body.remember ?? false,
        attempt: 1,
        path_index: 0,
        scope: 'plan_step',
        step_number: 1,
        created_at: '2026-11-27T12:00:00Z',
      };
      store.collection<StoredNote>(WALK_NOTES).insert({ id: note.id ?? '', run_id: runId, note });
      return { status: 201, body: note };
    },
  );

  fake.route(
    'PATCH',
    '/api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}/notes/{note_id}',
    (req, store) => {
      const { project_id: projectId, run_id: runId, note_id: noteId } = req.params;
      walkOf(store, projectId, runId);
      const notes = store.collection<StoredNote>(WALK_NOTES);
      const found = notes.get(noteId);
      if (found === undefined || found.run_id !== runId) {
        throw new FakeHttpError(404, { detail: `Note not found: ${noteId}` });
      }
      const body = req.body as { text: string };
      const note: SessionNote = { ...found.note, text: checkedText(body.text) };
      notes.update(noteId, { note });
      return { status: 200, body: note };
    },
  );

  // The flow copilot: a question and the standard review answer with the proposal a test planted
  // for the flow (`seedCopilotAnswer`), else with one change; every answer counts as a turn of the
  // model (`copilotTurns`). A flow that does not exist is a 404, as for the backend.
  const answer = (store: Store, projectId: string, flowId: string, review: boolean) => {
    flowOf(store, projectId, flowId);
    const turns = store.collection<{ id: string; flow_id: string }>(COPILOT_TURNS);
    turns.insert({ id: store.newId(), flow_id: flowId });
    const planted = store
      .collection<{ id: string; answer: CopilotAnswer }>(COPILOT_ANSWERS)
      .get(flowId);
    return (
      planted?.answer ?? {
        message_id: store.newId(),
        reply: review ? 'The flow looks ready.' : 'Rename the first block.',
        changes: [
          {
            id: 'c1',
            type: 'modify' as const,
            target_block_id: 'b1',
            description: 'Give the first block a clearer name',
          },
        ],
      }
    );
  };
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/flows/{flow_id}/copilot/messages',
    (req, store) => ({
      status: 200,
      body: answer(store, req.params.project_id, req.params.flow_id, false),
    }),
  );
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/flows/{flow_id}/copilot/messages/review',
    (req, store) => ({
      status: 200,
      body: answer(store, req.params.project_id, req.params.flow_id, true),
    }),
  );

  // Answering the poll-loop questions: the stored `poll_status` items whose `field` was answered
  // are removed and one version is saved, also when the statuses are the ones already set. A field
  // no open poll item names is the backend's 422; all or nothing.
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/flows/{flow_id}/poll-terminals',
    (req, store) => {
      const flow = flowOf(store, req.params.project_id, req.params.flow_id);
      const body = req.body as {
        answers: { field: string; success_terminals: string[]; failure_terminals?: string[] }[];
      };
      const stored = (flow.needs_input ?? []) as unknown as Record<string, unknown>[];
      const isPoll = (item: Record<string, unknown>, field: string): boolean =>
        item['kind'] === 'poll_status' && item['field'] === field;
      for (const answer of body.answers) {
        if (!stored.some((item) => isPoll(item, answer.field))) {
          throw new FakeHttpError(422, {
            detail: `No poll loop found for status field '${answer.field}' in flow ${flow.id}.`,
          });
        }
      }
      const answered = body.answers.map((answer) => answer.field);
      const left = stored.filter((item) => !answered.some((field) => isPoll(item, field)));
      const next = flow.current_version + 1;
      const saved = store.collection<FlowDetail>(FLOW_COLLECTIONS.flows).update(flow.id, {
        needs_input: left as unknown as NonNullable<FlowDetail['needs_input']>,
        current_version: next,
        updated_at: '2026-11-27T12:00:00Z',
      });
      seedFlowVersion(store, saved, next, 'Resolved poll-loop terminals via needs_input');
      return {
        status: 200,
        body: {
          flow_id: flow.id,
          applied_fields: answered,
          current_version: next,
          needs_input: left,
        },
      };
    },
  );
}
