// Routes of the module data (src/tools/data/) for the writes with an undo: the label of a data slot
// (with the slot options a tool reads it from), the restore of a dataset's previous content, and the
// read and the update of one dataset (its definition in place; the cells stay as they are sent), and
// the generation of rows from the saved recipe (expand and regenerate, each keeping the rows that were
// as the previous content).
// The scenarios and the datasets are those of the sklep world; the labels and the previous contents
// are seeded by a test. Registration is idempotent per fake.

import type { components } from '../../../src/http/generated/api.js';
import type { Fake, Store } from '../server.js';
import { FakeHttpError } from '../server.js';
import { plantedSlotOptions } from './data.js';
import { SKLEP_COLLECTIONS, type SklepFeeder } from '../worlds/sklep.js';

const registered = new WeakSet<Fake>();

const LABELS = 'data_write_slot_labels';
const PREVIOUS = 'data_write_previous_feeders';
const USERS = 'data_write_feeder_users';
const HUB_ANSWERS = 'data_write_hub_answers';
const HUB_TURNS = 'data_write_hub_turns';

type HubAnswer = components['schemas']['DataHubMessageResponse'];

/** The next messages to the data hub copilot of the project answer with this proposal. */
export function seedDataHubAnswer(store: Store, projectId: string, answer: HubAnswer): void {
  put(store, HUB_ANSWERS, projectId, answer);
}

/** How many turns of the model the data hub copilot of the project was asked for. */
export function dataHubTurns(store: Store, projectId: string): number {
  return store
    .collection<{ id: string; project_id: string }>(HUB_TURNS)
    .list((turn) => turn.project_id === projectId).length;
}

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

/** The labels of the data slots of a scenario (`null`: the slot has none); the slots are these keys. */
export function seedSlotLabels(
  store: Store,
  scenarioId: string,
  labels: Readonly<Record<string, string | null>>,
): void {
  put(store, LABELS, scenarioId, { ...labels });
}

export function slotLabels(store: Store, scenarioId: string): Record<string, string | null> {
  return { ...(read<Record<string, string | null>>(store, LABELS, scenarioId) ?? {}) };
}

/** What a dataset held before its last change: the fields a restore swaps with the current ones. */
export type PreviousContent = Partial<
  Pick<SklepFeeder, 'content' | 'record_count' | 'content_hash' | 'columns'>
>;

export function seedPreviousContent(
  store: Store,
  feederId: string,
  previous: PreviousContent,
): void {
  put(store, PREVIOUS, feederId, previous);
}

export interface FeederUser {
  readonly id: string;
  readonly kind: 'scenario' | 'composition';
  readonly name: string;
}

/** Who reads a dataset: the scenarios and compositions its `used-in` lists (and the 409 of a delete without force). */
export function seedFeederUsers(
  store: Store,
  feederId: string,
  users: readonly FeederUser[],
): void {
  put(store, USERS, feederId, [...users]);
}

function requireProject(store: Store, id: string): void {
  store.collection(SKLEP_COLLECTIONS.projects).require(id, `Project not found: ${id}`);
}

type SlotOptions = components['schemas']['SlotOptions'];

export function registerDataWriteRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  const requireScenario = (store: Store, projectId: string, scenarioId: string): void => {
    requireProject(store, projectId);
    store.collection(SKLEP_COLLECTIONS.scenarios).require(scenarioId, 'Scenario not found');
  };

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/slots/options',
    (req, store) => {
      requireScenario(store, req.params.project_id, req.params.scenario_id);
      const slots = Object.entries(slotLabels(store, req.params.scenario_id)).map(
        ([slot, label]): SlotOptions => ({
          slot,
          label,
          role: 'data',
          columns: [],
          column_specs: [],
          bind_withheld_columns: [],
          never_fabricated_columns: [],
          generated: null,
          generated_rows: null,
          identity_kind: null,
          options: [],
        }),
      );
      return {
        status: 200,
        body: { slots: plantedSlotOptions(store, req.params.scenario_id) ?? slots },
      };
    },
  );

  fake.route(
    'PATCH',
    '/api/v1/projects/{project_id}/data-hub/scenarios/{scenario_id}/slots/{slot}/label',
    (req, store) => {
      requireScenario(store, req.params.project_id, req.params.scenario_id);
      const labels = slotLabels(store, req.params.scenario_id);
      if (!(req.params.slot in labels)) {
        throw new FakeHttpError(404, {
          detail: `Slot '${req.params.slot}' not found in scenario`,
        });
      }
      const raw = (req.body as { label?: unknown }).label;
      const label = typeof raw === 'string' ? raw : '';
      if (label.length < 1 || label.length > 200) {
        throw new FakeHttpError(422, {
          detail: [{ loc: ['body', 'label'], msg: 'label 1-200 chars', type: 'value_error' }],
        });
      }
      labels[req.params.slot] = label;
      put(store, LABELS, req.params.scenario_id, labels);
      return { status: 200, body: { slot: req.params.slot, label } };
    },
  );

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/restore-previous',
    (req, store) => {
      requireProject(store, req.params.project_id);
      const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
      const feeder = feeders.require(req.params.feeder_id, 'Feeder not found');
      const previous = read<PreviousContent>(store, PREVIOUS, feeder.id);
      if (previous === undefined) {
        throw new FakeHttpError(409, { detail: 'No previous feeder revision available' });
      }
      // a second call switches back: the content swapped out becomes the previous one
      const leaving: PreviousContent = {
        content: feeder.content,
        record_count: feeder.record_count,
        content_hash: feeder.content_hash,
        columns: feeder.columns,
      };
      const restored = feeders.update(feeder.id, { ...previous });
      put(store, PREVIOUS, feeder.id, leaving);
      return { status: 200, body: { ...restored } };
    },
  );

  // One dataset with its cells (the list carries none).
  fake.route('GET', '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}', (req, store) => {
    requireProject(store, req.params.project_id);
    const feeder = store
      .collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders)
      .require(req.params.feeder_id, 'Feeder not found');
    return { status: 200, body: { ...feeder } };
  });

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/used-in',
    (req, store) => {
      requireProject(store, req.params.project_id);
      store
        .collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders)
        .require(req.params.feeder_id, 'Feeder not found');
      const users = read<FeederUser[]>(store, USERS, req.params.feeder_id) ?? [];
      return {
        status: 200,
        body: {
          feeder_id: req.params.feeder_id,
          consumers: users.map((user) => ({
            id: user.id,
            kind: user.kind,
            name: user.name,
            rows_note: 'all rows',
            usage: 'all' as const,
          })),
          scenarios: users
            .filter((user) => user.kind === 'scenario')
            .map((user) => ({ id: user.id, name: user.name })),
        },
      };
    },
  );

  // The data hub copilot: answers with the proposal a test planted, else with one resize of the first
  // dataset; every message counts as a turn of the model.
  fake.route('POST', '/api/v1/projects/{project_id}/data-hub/messages', (req, store) => {
    requireProject(store, req.params.project_id);
    store
      .collection<{ id: string; project_id: string }>(HUB_TURNS)
      .insert({ id: store.newId(), project_id: req.params.project_id });
    const planted = read<HubAnswer>(store, HUB_ANSWERS, req.params.project_id);
    const [first] = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).list();
    return {
      status: 200,
      body: planted ?? {
        reply: 'Resize the first dataset.',
        actions:
          first === undefined
            ? []
            : [{ kind: 'resize' as const, dataset_id: first.id, rows: 1000 }],
        chips: ['How many rows does the run need?'],
        issues: [],
      },
    };
  });

  // A dataset still read by a scenario or a composition is refused (409 with its consumers) unless `force`.
  fake.route(
    'DELETE',
    '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}',
    (req, store) => {
      requireProject(store, req.params.project_id);
      const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
      feeders.require(req.params.feeder_id, 'Feeder not found');
      const users = read<FeederUser[]>(store, USERS, req.params.feeder_id) ?? [];
      if (users.length > 0 && req.query['force'] !== 'true') {
        throw new FakeHttpError(409, {
          detail: {
            message: 'Dataset is still used',
            consumers: users.map(({ id, kind, name }) => ({ id, kind, name })),
          },
        });
      }
      feeders.delete(req.params.feeder_id);
      return { status: 200, body: { message: 'Feeder deleted' } };
    },
  );

  // The update of a dataset is its whole document, in place: a field left out goes back to its
  // default, as the backend does (the cells too: `content` left out empties the dataset).
  fake.route('PUT', '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}', (req, store) => {
    requireProject(store, req.params.project_id);
    const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
    const feeder = feeders.require(req.params.feeder_id, 'Feeder not found');
    const body = req.body as components['schemas']['UpdateFeederBody'];
    const content = body.content ?? '';
    const updated = feeders.update(feeder.id, {
      name: body.name,
      description: body.description ?? null,
      content: content === '' ? null : content,
      record_count: body.record_count ?? 0,
      columns: [...(body.columns ?? [])],
      ...(body.file_name == null ? {} : { file_name: body.file_name }),
      manually_edited: true,
    });
    return { status: 200, body: { ...updated } };
  });

  // The rows a recipe makes: one synthetic line per row; the rows that were become the previous
  // content, so `restore-previous` brings them back.
  const generate = (store: Store, feeder: SklepFeeder, rows: number): SklepFeeder => {
    if (!feeder.has_recipe) {
      throw new FakeHttpError(400, { detail: 'Feeder has no stored recipe' });
    }
    put(store, PREVIOUS, feeder.id, {
      content: feeder.content,
      record_count: feeder.record_count,
      content_hash: feeder.content_hash,
      columns: feeder.columns,
    } satisfies PreviousContent);
    const header = feeder.columns.join(',');
    const line = feeder.columns.map(() => 'generated').join(',');
    return store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).update(feeder.id, {
      content: [header, ...Array.from({ length: rows }, () => line)].join('\n'),
      record_count: rows,
      content_hash: `generated-${String(rows)}`,
      manually_edited: false,
    });
  };

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/expand',
    (req, store) => {
      requireProject(store, req.params.project_id);
      const feeder = store
        .collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders)
        .require(req.params.feeder_id, 'Feeder not found');
      const body = req.body as components['schemas']['ExpandFeederBody'];
      if (body.target_rows <= feeder.record_count) {
        throw new FakeHttpError(400, { detail: 'target_rows must exceed the current row count' });
      }
      return { status: 200, body: { ...generate(store, feeder, body.target_rows) } };
    },
  );

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/regenerate',
    (req, store) => {
      requireProject(store, req.params.project_id);
      const feeder = store
        .collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders)
        .require(req.params.feeder_id, 'Feeder not found');
      const body = req.body as components['schemas']['RegenerateFeederBody'];
      return {
        status: 200,
        body: { ...generate(store, feeder, body.rows ?? feeder.record_count) },
      };
    },
  );
}
