// Account provisioning routes of the fake backend: the project's probe consent, a new dataset, the
// provision call of a dataset and the saving of a scenario's slot bindings; also the two ways a
// dataset is made without a model (from per-column rules, and from the columns of a scenario's
// slot). They work over the scenarios and datasets of the sklep world; the datasets list route is
// the one of `data.ts`.
//
// A test steers the answers through one record of the `FAKE_PROVISION` collection (id `config`):
// consent, the register request (found in the flow, or only as a candidate of the spec), accounts
// that fail, a failure streak that stops the series, rows that carry a sentinel. Accounts the fake
// creates are appended to the dataset, so the dataset's `record_count` is the number of accounts.

import { FakeHttpError, type Fake, type Store } from '../server.js';
import {
  defaultProtocolConfig,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepFeeder,
  type SklepFeederStrategy,
  type SklepScenario,
  type SklepSlot,
} from '../worlds/sklep.js';
import {
  currentOperations,
  registerCandidatesOf,
  registerOperationOf,
} from '../worlds/document.js';
import { DATA_SENTINEL, registerDataRoutes } from './data.js';
import { documentIsForeign } from './suggestions.js';
import { idleWhile } from '../../helpers/clock.js';

export const FAKE_PROVISION = 'fake_provision';

const HTTP_SETTINGS = 'fake_http_settings';

type GatlingProjectBody = ReturnType<typeof gatlingProjectBody>;

interface StoredHttpSettings {
  readonly id: string;
  readonly missing: boolean;
  readonly fields: Partial<GatlingProjectBody>;
}

/**
 * The HTTP settings of a project's Gatling project as a test wants them: fields that replace the
 * defaults of the world, or none at all (`missing`: the GET and the PUT answer 404 until the setup).
 */
export function seedHttpSettings(
  store: Store,
  projectId: string,
  fields: Partial<GatlingProjectBody>,
  options: { readonly missing?: boolean } = {},
): void {
  const settings = store.collection<StoredHttpSettings>(HTTP_SETTINGS);
  settings.delete(projectId);
  settings.insert({ id: projectId, missing: options.missing === true, fields: { ...fields } });
}

/** The settings the fake holds for a project (the stored fields only). */
export function httpSettingsOf(store: Store, projectId: string): Partial<GatlingProjectBody> {
  return { ...store.collection<StoredHttpSettings>(HTTP_SETTINGS).get(projectId)?.fields };
}

/** How the fake answers; every field has a default (see `configOf`). */
export interface FakeProvisionConfig {
  id: 'config';
  /** `probes_enabled` of the project's Gatling settings. */
  probes: boolean;
  /** The backend answers the PUT of the project settings 200 but keeps `probes_enabled` as it was. */
  ignoreProbesPut: boolean;
  /** The flow or scenario holds its own register request; otherwise the call must name an operation. */
  registerRequest: boolean;
  /** Operations offered as candidates when nothing names a register request. */
  candidates: string[];
  /** Number of accounts of every batch that fail (the rest register). */
  failPerBatch: number;
  /** The batch number (from 1) after which the target is declared broken: that batch aborts. */
  abortAtBatch: number | null;
  /** Rows of the answer carry the sentinel instead of the masked password. */
  leakRows: boolean;
  /** Detail of every failure. */
  failureDetail: string;
  /** Names the report carries in place of the ones of the call (what a body of a 502 can say). */
  reportEnvironment: string | null;
  reportOperation: string | null;
  /** The backend refuses a protected environment unless `confirm_protected` is true (a backend with the capability). */
  protectedConfirmation: boolean;
}

const DEFAULTS: Omit<FakeProvisionConfig, 'id'> = {
  protectedConfirmation: true,
  probes: true,
  ignoreProbesPut: false,
  registerRequest: true,
  candidates: ['POST:/auth/register'],
  failPerBatch: 0,
  abortAtBatch: null,
  leakRows: false,
  failureDetail: 'HTTP 409: the e-mail is taken',
  reportEnvironment: null,
  reportOperation: null,
};

const registered = new WeakSet<Fake>();

/** A pause a test puts before every provision batch (a sleep on the test clock, a refusal). */
export type ProvisionHold = (batch: number) => Promise<void>;

const holds = new WeakMap<Store, ProvisionHold>();

/**
 * Makes each provision call of the fake wait for `hold` (called with the number of the batch, from
 * 1) before it creates anything; `undefined` removes it. What `hold` throws is the answer.
 */
export function holdProvision(store: Store, hold: ProvisionHold | undefined): void {
  if (hold === undefined) holds.delete(store);
  else holds.set(store, hold);
}

function configOf(store: Store): FakeProvisionConfig {
  const found = store.collection<FakeProvisionConfig>(FAKE_PROVISION).get('config');
  return { ...DEFAULTS, id: 'config', ...found };
}

/** Sets the fake's provisioning behaviour for a test. */
export function setFakeProvision(store: Store, patch: Partial<Omit<FakeProvisionConfig, 'id'>>) {
  const collection = store.collection<FakeProvisionConfig>(FAKE_PROVISION);
  if (collection.get('config') === undefined) collection.insert({ ...DEFAULTS, id: 'config' });
  collection.update('config', patch);
}

/** Bodies of the provision calls the fake has answered, in order. */
export const PROVISION_BATCHES = 'fake_provision_batches';

export interface RecordedBatch {
  id: string;
  feeder_id: string;
  count: number;
  environment_id: string | null;
  register_operation: string | null;
  scenario_id: string | null;
  confirm_protected: boolean | null;
}

/** Earlier contents the fake keeps when a dataset's content is replaced (one record per replacement). */
export const FEEDER_REVISIONS = 'fake_feeder_revisions';

export interface FeederRevision {
  id: string;
  feeder_id: string;
  rows: number;
}

/** Data rows of a CSV text: every non-empty line after the header. */
function dataRows(content: string): number {
  return Math.max(0, content.split(/\r?\n/u).filter((line) => line.trim() !== '').length - 1);
}

/** Bodies of the rule-based generation calls the fake has answered, in order. */
export const RULE_GENERATIONS = 'fake_rule_generations';

export interface RecordedGeneration {
  id: string;
  name: string;
  columns: string[];
  row_count: number;
}

/** Bodies of the slot generation calls (`…/slots/{slot}/generate-feeder`) the fake has answered. */
export const SLOT_GENERATIONS = 'fake_slot_generations';

export interface RecordedSlotGeneration {
  id: string;
  scenario_id: string;
  slot: string;
  row_count: number;
  enrich_with_llm: boolean;
}

const SECRET_NAME = /pass(word|wd)?|pwd|secret|token|api_?key|otp|cvv|pin\b/iu;
const TRUE_SECRET_NAME = /secret|token|api_?key|otp|cvv|pin\b/iu;
const LOGIN_NAME = /e-?mail|user(name)?|login/iu;

/**
 * Whether the generation may not invent a column of the slot: a secret never, a login identity
 * unless the slot is plain data, any column of a slot that signs in with existing accounts. The
 * fake's short form of `_is_never_fabricated` .
 */
function neverFabricated(column: string, slot: SklepSlot): boolean {
  // A slot of new identities (`fresh`) invents the e-mail, the login and the password of the account
  // its flow creates; a token, a key or a card number it never invents.
  if (slot.identity_kind === 'fresh') return TRUE_SECRET_NAME.test(column);
  if (SECRET_NAME.test(column)) return true;
  if (slot.identity_kind === 'existing') return true;
  return LOGIN_NAME.test(column) && slot.role !== 'data' && slot.identity_kind !== 'fresh';
}

/** CSV content of `rows` generated rows of the columns; an e-mail column gets addresses. */
export function generatedContent(columns: readonly string[], rows: number): string {
  const cell = (column: string, row: number): string =>
    LOGIN_NAME.test(column)
      ? `user-${String(row)}@example.com`
      : /pass(word|wd)?/iu.test(column)
        ? `${DATA_SENTINEL}-${String(row)}`
        : `${column}-${String(row)}`;
  const lines = Array.from({ length: rows }, (_, row) =>
    columns.map((column) => cell(column, row + 1)).join(','),
  );
  return `${[columns.join(','), ...lines].join('\n')}\n`;
}

/** A dataset record with the defaults of a dataset someone created; `fields` override them. */
export function newFeeder(id: string, fields: Partial<SklepFeeder>): SklepFeeder {
  return {
    id,
    gatling_project_id: SKLEP_WORLD_IDS.gatlingProject,
    name: 'dataset',
    description: null,
    feeder_type: 'csv',
    strategy: 'circular',
    file_name: 'dataset.csv',
    content: null,
    record_count: 0,
    columns: [],
    separator: ',',
    transform_expression: null,
    feed_records_count: null,
    feed_records_count_expression: null,
    dsl: null,
    jdbc_config: null,
    redis_config: null,
    feeder_options: null,
    consumption: 'shared',
    column_semantics: {},
    has_recipe: false,
    recipe_summary: [],
    content_hash: 'created',
    manually_edited: false,
    created_by: 'user@example.com',
    auto_linked_scenario_id: null,
    provenance: 'uploaded',
    audit_metadata: null,
    created_at: '2026-11-22T11:00:00Z',
    updated_at: '2026-11-22T11:00:00Z',
    ...fields,
  };
}

function feederOf(store: Store, id: string): SklepFeeder {
  return store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).require(id, 'Feeder not found');
}

function environmentName(store: Store, id: string | null | undefined): string {
  const environments = store.collection<{ id: string; name: string; is_default: boolean }>(
    SKLEP_COLLECTIONS.environments,
  );
  if (id == null) {
    const found = environments.list().find((item) => item.is_default);
    if (found === undefined) {
      throw new FakeHttpError(409, {
        detail: { code: 'no_default_environment', message: 'No default environment.' },
      });
    }
    return found.name;
  }
  const found = environments.get(id);
  if (found === undefined) {
    throw new FakeHttpError(409, {
      detail: { code: 'environment_not_found', message: 'No such environment.' },
    });
  }
  return found.name;
}

/** The project settings of the Gatling project, with the defaults of a project nobody tuned. */
export function gatlingProjectBody(
  projectId: string,
  probesEnabled: boolean,
  overrides: Partial<Omit<ReturnType<typeof baseGatlingProject>, 'base_url'>> & {
    base_url?: string | null;
  } = {},
) {
  return { ...baseGatlingProject(projectId, probesEnabled), ...overrides };
}

function baseGatlingProject(projectId: string, probesEnabled: boolean) {
  return {
    id: SKLEP_WORLD_IDS.gatlingProject,
    project_id: projectId,
    base_url: 'https://api.perf.example.com',
    default_headers: {},
    protocol_config: defaultProtocolConfig(),
    throttle_steps: [],
    pause_distribution: 'uniform' as const,
    normal_pause_std_dev_percent: 20,
    think_time_ms: 0,
    default_poll_max_iterations: 30,
    global_assertions: [],
    probes_enabled: probesEnabled,
    capture_request_bodies: false,
    capture_request_bodies_sample_percent: 100,
    assertion_thresholds: null,
    assertion_threshold_view: {
      effective_tier: 'default' as const,
      declared_at: { project: false, scenario: false as const },
      thresholds: {},
      declared_not_consumed: [],
    },
    scenarios_count: 0,
    configurations_count: 0,
    feeders_count: 0,
    created_at: null,
    updated_at: null,
  };
}

/** Registers the provisioning routes once per fake. */
export function registerProvisionRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  registerDataRoutes(fake);

  const settingsOf = (store: Store, projectId: string): StoredHttpSettings =>
    store.collection<StoredHttpSettings>(HTTP_SETTINGS).get(projectId) ?? {
      id: projectId,
      missing: false,
      fields: {},
    };
  const requireSettings = (store: Store, projectId: string): StoredHttpSettings => {
    store.collection(SKLEP_COLLECTIONS.projects).require(projectId);
    const found = settingsOf(store, projectId);
    if (found.missing) throw new FakeHttpError(404, { detail: 'Gatling project not found' });
    return found;
  };

  // the backend answers the values of the default headers masked
  const masked = (body: GatlingProjectBody): GatlingProjectBody => ({
    ...body,
    default_headers: Object.fromEntries(
      Object.keys(body.default_headers).map((name) => [name, '«masked»']),
    ),
  });

  fake.route('GET', '/api/v1/projects/{project_id}/gatling/project', (req, store) => {
    const found = requireSettings(store, req.params.project_id);
    return {
      status: 200,
      body: masked({
        ...gatlingProjectBody(req.params.project_id, configOf(store).probes),
        ...found.fields,
      }),
    };
  });

  // The first use of the settings: the fields of the body become the settings of the project.
  fake.route('POST', '/api/v1/projects/{project_id}/gatling/setup', (req, store) => {
    store.collection(SKLEP_COLLECTIONS.projects).require(req.params.project_id);
    const settings = store.collection<StoredHttpSettings>(HTTP_SETTINGS);
    const existing = settingsOf(store, req.params.project_id);
    if (!existing.missing && settings.get(req.params.project_id) !== undefined) {
      return {
        status: 200,
        body: { id: SKLEP_WORLD_IDS.gatlingProject, message: 'Gatling project already exists' },
      };
    }
    settings.delete(req.params.project_id);
    settings.insert({
      id: req.params.project_id,
      missing: false,
      fields: { ...(req.body as Partial<GatlingProjectBody>) },
    });
    return {
      status: 200,
      body: { id: SKLEP_WORLD_IDS.gatlingProject, message: 'Gatling project created' },
    };
  });

  // The project settings a user saves in the frontend: a PATCH-like PUT, a field left out stays.
  fake.route('PUT', '/api/v1/projects/{project_id}/gatling/project', (req, store) => {
    const found = requireSettings(store, req.params.project_id);
    const body = req.body as { probes_enabled?: boolean | null } & Record<string, unknown>;
    if (typeof body.probes_enabled === 'boolean' && !configOf(store).ignoreProbesPut) {
      setFakeProvision(store, { probes: body.probes_enabled });
    }
    // a field left out or null stays; the others replace what the project has
    const changed = Object.fromEntries(
      Object.entries(body).filter(
        ([key, value]) => key !== 'probes_enabled' && value !== null && value !== undefined,
      ),
    ) as Partial<GatlingProjectBody>;
    const settings = store.collection<StoredHttpSettings>(HTTP_SETTINGS);
    settings.delete(req.params.project_id);
    settings.insert({
      id: req.params.project_id,
      missing: false,
      fields: { ...found.fields, ...changed },
    });
    return {
      status: 200,
      body: masked({
        ...gatlingProjectBody(req.params.project_id, configOf(store).probes),
        ...found.fields,
        ...changed,
      }),
    };
  });

  fake.route('POST', '/api/v1/projects/{project_id}/gatling/feeders', (req, store) => {
    store.collection(SKLEP_COLLECTIONS.projects).require(req.params.project_id);
    const body = req.body as {
      name: string;
      columns?: string[] | null;
      strategy?: SklepFeederStrategy;
      file_name?: string | null;
      content?: string;
    };
    const content = body.content ?? '';
    const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
    const created = feeders.insert(
      newFeeder(`created-feeder-${String(feeders.list().length + 1)}`, {
        name: body.name,
        strategy: body.strategy ?? 'circular',
        file_name: body.file_name ?? 'dataset.csv',
        content: content === '' ? null : content,
        record_count: dataRows(content),
        columns: body.columns ?? [],
        consumption: body.strategy === 'queue' ? 'exclusive' : 'shared',
        provenance: 'uploaded',
      }),
    );
    return { status: 200, body: { ...created } };
  });

  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/content',
    (req, store) => {
      store.collection(SKLEP_COLLECTIONS.projects).require(req.params.project_id);
      const feeder = feederOf(store, req.params.feeder_id);
      const body = req.body as { content: string; file_name?: string | null };
      const revisions = store.collection<FeederRevision>(FEEDER_REVISIONS);
      revisions.insert({
        id: `revision-${String(revisions.list().length + 1)}`,
        feeder_id: feeder.id,
        rows: feeder.record_count,
      });
      const replaced = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).update(feeder.id, {
        content: body.content,
        record_count: dataRows(body.content),
        manually_edited: true,
        ...(body.file_name == null ? {} : { file_name: body.file_name }),
      });
      return { status: 200, body: { ...replaced } };
    },
  );

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/feeders/generate-from-rules',
    (req, store) => {
      store.collection(SKLEP_COLLECTIONS.projects).require(req.params.project_id);
      const body = req.body as {
        name: string;
        columns: { column_name: string }[];
        row_count?: number;
      };
      const secret = body.columns.find((column) =>
        /pass(word)?|secret|token/iu.test(column.column_name),
      );
      if (secret !== undefined) {
        throw new FakeHttpError(422, {
          detail: `Column "${secret.column_name}" looks like a secret; rules cannot generate it.`,
        });
      }
      const generations = store.collection<RecordedGeneration>(RULE_GENERATIONS);
      generations.insert({
        id: `generation-${String(generations.list().length + 1)}`,
        name: body.name,
        columns: body.columns.map((column) => column.column_name),
        row_count: body.row_count ?? 100,
      });
      const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
      const created = feeders.insert(
        newFeeder(`generated-feeder-${String(generations.list().length)}`, {
          name: body.name,
          file_name: 'generated.csv',
          record_count: body.row_count ?? 100,
          columns: body.columns.map((column) => column.column_name),
          provenance: 'uploaded',
        }),
      );
      return { status: 200, body: { ...created } };
    },
  );

  // `generate_slot_feeder` (the backend's route): rows for the
  // columns of one scenario's slot, saved as `<slot> data` with the file `<slot>.csv`; a repeat for
  // the same slot refreshes that dataset. It writes a dataset and sends nothing to the target.
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/slots/{slot}/generate-feeder',
    (req, store) => {
      store.collection(SKLEP_COLLECTIONS.projects).require(req.params.project_id);
      const scenario = store
        .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
        .require(req.params.scenario_id, 'Scenario not found');
      const key = req.params.slot;
      const slot = scenario.feeder_slots.find((candidate) => candidate.slot === key);
      if (slot === undefined) {
        const known = scenario.feeder_slots.map((candidate) => `'${candidate.slot}'`).join(', ');
        throw new FakeHttpError(404, {
          detail: `Scenario has no feeder slot '${key}'. Known slots: [${known}]`,
        });
      }
      if (slot.columns.length === 0) {
        throw new FakeHttpError(400, { detail: `Slot '${key}' declares no columns to generate.` });
      }
      const guarded = slot.columns.filter((column) => neverFabricated(column, slot));
      if (guarded.length > 0) {
        // The backend's refusal names the columns twice: in its sentence and as a list (`columns`)
        // a client reads without parsing the sentence (`NeverFabricatedHttpError`).
        throw new FakeHttpError(422, {
          detail: {
            error: 'never_fabricated_columns',
            message: `Slot '${key}' carries column(s) [${guarded.join(', ')}] that must not be fabricated.`,
            columns: guarded,
          },
        });
      }
      const body = (req.body ?? {}) as { row_count?: number; enrich_with_llm?: boolean };
      const rows = body.row_count ?? 100;
      const generations = store.collection<RecordedSlotGeneration>(SLOT_GENERATIONS);
      generations.insert({
        id: `slot-generation-${String(generations.list().length + 1)}`,
        scenario_id: scenario.id,
        slot: key,
        row_count: rows,
        enrich_with_llm: body.enrich_with_llm ?? false,
      });
      const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
      const name = `${key} data`;
      const fields: Partial<SklepFeeder> = {
        name,
        file_name: `${key}.csv`,
        content: generatedContent(slot.columns, rows),
        record_count: rows,
        columns: [...slot.columns],
        strategy: 'circular',
        consumption: 'shared',
        provenance: 'auto',
      };
      const existing = feeders.list().find((feeder) => feeder.name === name);
      const saved =
        existing === undefined
          ? feeders.insert(newFeeder(`slot-feeder-${String(generations.list().length)}`, fields))
          : feeders.update(existing.id, fields);
      return { status: 200, body: { ...saved, created: existing === undefined } };
    },
  );

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/feeders/{feeder_id}/provision',
    async (req, store) => {
      store.collection(SKLEP_COLLECTIONS.projects).require(req.params.project_id);
      const hold = holds.get(store);
      if (hold !== undefined) {
        // The hold is the test's own gate: the clock may move while the fake waits for it.
        await idleWhile(hold(store.collection<RecordedBatch>(PROVISION_BATCHES).list().length + 1));
      }
      const feeder = feederOf(store, req.params.feeder_id);
      const body = req.body as {
        count: number;
        environment_id?: string | null;
        register_operation?: string | null;
        scenario_id?: string | null;
        confirm_protected?: boolean | null;
      };
      const config = configOf(store);
      if (!config.probes) {
        throw new FakeHttpError(403, { detail: 'Provisioning is not enabled for this project.' });
      }
      const environment = environmentName(store, body.environment_id);
      const target = store
        .collection<{ id: string; name: string; protected?: boolean }>(
          SKLEP_COLLECTIONS.environments,
        )
        .list()
        .find((item) => item.name === environment);
      if (
        config.protectedConfirmation &&
        target?.protected === true &&
        body.confirm_protected !== true
      ) {
        throw new FakeHttpError(409, {
          detail: {
            code: 'protected_environment_requires_confirmation',
            message: 'The environment is protected.',
            environment_name: environment,
          },
        });
      }
      // A foreign document registers with its own operation; without one the backend asks for it.
      const foreign = documentIsForeign(store);
      const operations = foreign ? currentOperations(store) : [];
      const documentRegister = foreign ? registerOperationOf(operations) : undefined;
      const registerRequest = foreign ? documentRegister !== undefined : config.registerRequest;
      const candidates = foreign ? registerCandidatesOf(operations) : config.candidates;
      if (!registerRequest && !body.register_operation) {
        throw new FakeHttpError(400, {
          detail: {
            code: 'register_operation_required',
            message: 'No register request in this flow/scenario.',
            candidates: candidates.map((operation) => ({
              register_operation: operation,
              operation_id: null,
              summary: 'Create an account',
            })),
          },
        });
      }
      const batches = store.collection<RecordedBatch>(PROVISION_BATCHES);
      batches.insert({
        id: `batch-${String(batches.list().length + 1)}`,
        feeder_id: feeder.id,
        count: body.count,
        environment_id: body.environment_id ?? null,
        register_operation: body.register_operation ?? null,
        scenario_id: body.scenario_id ?? null,
        confirm_protected: body.confirm_protected ?? null,
      });
      const number = batches.list().length;
      const aborted = config.abortAtBatch === number;
      const failed = aborted ? body.count : Math.min(config.failPerBatch, body.count);
      const created = body.count - failed;
      const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
      if (created > 0) feeders.update(feeder.id, { record_count: feeder.record_count + created });
      const report = {
        requested: body.count,
        created,
        failed,
        rows: Array.from({ length: Math.min(created, 3) }, (_, index) => ({
          email: `user-${String(index)}@example.com`,
          password: config.leakRows ? DATA_SENTINEL : '[redacted]',
        })),
        failures: Array.from({ length: Math.min(failed, 20) }, (_, index) => ({
          identity_masked: `u***${String(index)}@example.com`,
          status: 409,
          detail: config.failureDetail,
        })),
        aborted,
        environment_name: config.reportEnvironment ?? environment,
        register_operation:
          config.reportOperation ??
          body.register_operation ??
          documentRegister ??
          'POST:/auth/register',
        register_operation_source: body.register_operation
          ? ('request' as const)
          : ('scenario' as const),
      };
      if (created === 0) throw new FakeHttpError(502, { detail: report });
      return { status: 200, body: report };
    },
  );

  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/slot-bindings',
    (req, store) => {
      store.collection(SKLEP_COLLECTIONS.projects).require(req.params.project_id);
      const scenarios = store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
      const scenario = scenarios.require(req.params.scenario_id, 'Scenario not found');
      const { bindings } = req.body as { bindings: Record<string, string> };
      scenarios.update(scenario.id, {
        slot_bindings: bindings,
        slot_binding_states: Object.entries(bindings).map(([slot, feeder]) => ({
          slot,
          feeder_id: feeder,
          state: 'pinned' as const,
        })),
      });
      return {
        status: 200,
        body: { slot_bindings: bindings, slot_binding_states: [] },
      };
    },
  );
}
