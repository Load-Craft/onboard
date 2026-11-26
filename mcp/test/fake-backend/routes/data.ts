// Data routes of the fake backend, over the scenarios, composition and datasets of the sklep world:
// the scenario and composition detail, the dataset list (which, like the backend's, carries the
// content of every dataset), the two read-only pre-flights and the data-hub auto-plan. Several
// tools read the same routes, so registration is idempotent per fake.
//
// Slot verdicts follow the feasibility engine in the shape the plugin depends on: a slot with a
// binding is `bound`, a data slot without one is `auto` when its rows ride in the artifact
// (`generated`) and `missing` when they do not, a slot that needs existing accounts without one is
// `missing`. A composition reads its own pins and, for a slot that would otherwise be missing, the
// dataset whose file is `<slot>.csv`. A test forces any other status for a slot by inserting
// `{ id: <slot>, status }` into the `FAKE_SLOT_STATUS` collection.
//
// The auto-plan is a turn of a model at the backend; the fake's model proposes a dataset for a
// missing slot of accounts and refuses a missing slot of plain data (its `email` reads to it as a
// credential), the way the hub answered on a composition built from an OpenAPI flow.

import type { components } from '../../../src/http/generated/api.js';
import { FakeHttpError, type Fake, type Store } from '../server.js';
import type { SelfCheckDocument } from './selfCheck.js';
import { documentIsForeign } from './suggestions.js';
import {
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepComposition,
  type SklepFeeder,
  type SklepScenario,
  type SklepSlot,
} from '../worlds/sklep.js';

type SlotVerdict = components['schemas']['SlotVerdict'];
type SlotStatus = SlotVerdict['status'];
type AutoPlanResponse = components['schemas']['AutoPlanResponse'];

/** Collection of `{ id: <slot>, status }` records that force the status of a slot. */
export const FAKE_SLOT_STATUS = 'fake_slot_status';

/** A forced status of one slot. */
export interface ForcedSlotStatus {
  id: string;
  status: SlotStatus;
}

/** Written into the recipe sample rows of the auto-plan and into the content of a dataset. */
export const DATA_SENTINEL = 'PW-SENTINEL-6c1e9b';

/** Collection with one record (id `plan`): the actions the auto-plan answers with instead of its own. */
export const FAKE_PLAN_ACTIONS = 'fake_plan_actions';

/** Makes the auto-plan answer with these raw actions (a test steers what `apply` meets). */
export function setFakePlanActions(
  store: Store,
  actions: readonly Record<string, unknown>[],
): void {
  const collection = store.collection<{ id: string; actions: Record<string, unknown>[] }>(
    FAKE_PLAN_ACTIONS,
  );
  if (collection.get('plan') === undefined) collection.insert({ id: 'plan', actions: [] });
  collection.update('plan', { actions: [...actions] });
}

const registered = new WeakSet<Fake>();

function requireProject(store: Store, id: string): void {
  store.collection(SKLEP_COLLECTIONS.projects).require(id, `Project not found: ${id}`);
}

function scenarioOf(store: Store, id: string): SklepScenario {
  return store
    .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
    .require(id, 'Scenario not found');
}

function compositionOf(store: Store, id: string): SklepComposition {
  return store
    .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
    .require(id, 'Composition not found');
}

/** A slot of plain data (role `data`, no account verdict) whose rows do not ride in the artifact. */
export const isContentlessDataSlot = (slot: SklepSlot): boolean =>
  slot.role === 'data' && slot.identity_kind === null && !slot.generated;

/** The verdict of a slot nothing is bound to. */
export const unboundStatus = (slot: SklepSlot): SlotStatus =>
  slot.identity_kind === 'existing' || isContentlessDataSlot(slot) ? 'missing' : 'auto';

function statusOf(
  store: Store,
  slot: SklepSlot,
  bindings: Readonly<Record<string, string>>,
): SlotStatus {
  const forced = store.collection<ForcedSlotStatus>(FAKE_SLOT_STATUS).get(slot.slot);
  if (forced !== undefined) return forced.status;
  if (bindings[slot.slot] !== undefined) return 'bound';
  return unboundStatus(slot);
}

function feederOf(store: Store, id: string | undefined): SklepFeeder | undefined {
  return id === undefined
    ? undefined
    : store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).get(id);
}

function verdict(
  store: Store,
  slot: SklepSlot,
  bindings: Readonly<Record<string, string>>,
): SlotVerdict {
  const status = statusOf(store, slot, bindings);
  const feeder = feederOf(store, bindings[slot.slot]);
  return {
    slot: slot.slot,
    label: slot.label,
    status,
    message: status,
    dataset_id: feeder?.id ?? null,
    dataset_name: feeder?.name ?? null,
    have_rows: feeder?.record_count ?? null,
    required_columns: slot.columns,
    identity_kind: slot.identity_kind,
    fixes: [],
    blocking: !['bound', 'auto', 'short_rows'].includes(status),
  };
}

type CheckStatus = components['schemas']['CompositionFeederPreflightCheck']['status'];

/** The composition pre-flight knows five statuses; the rest of the engine's collapse into `missing`. */
function checkStatus(status: SlotStatus): CheckStatus {
  switch (status) {
    case 'bound':
      return 'ok';
    case 'auto':
    case 'missing':
    case 'column_mismatch':
    case 'short_rows':
      return status;
    case 'stale_pin':
    case 'empty_column':
    case 'parse_error':
      return 'missing';
  }
}

/** Slots of a composition in the order its members declare them, each once. */
function compositionSlots(store: Store, composition: SklepComposition): SklepSlot[] {
  const seen = new Map<string, SklepSlot>();
  for (const link of composition.scenarios) {
    for (const slot of scenarioOf(store, link.scenario_id).feeder_slots) {
      if (!seen.has(slot.slot)) seen.set(slot.slot, slot);
    }
  }
  return [...seen.values()];
}

/** The columns a composition's slot requires: those of every member that declares it. */
function compositionColumns(store: Store, composition: SklepComposition, key: string): string[] {
  const columns = new Set<string>();
  for (const link of composition.scenarios) {
    for (const slot of scenarioOf(store, link.scenario_id).feeder_slots) {
      if (slot.slot === key) for (const column of slot.columns) columns.add(column);
    }
  }
  return [...columns];
}

function compositionBindings(store: Store, composition: SklepComposition): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const link of composition.scenarios) {
    Object.assign(merged, scenarioOf(store, link.scenario_id).slot_bindings);
  }
  const bound: Record<string, string> = { ...merged, ...composition.slot_bindings };
  // The file-name rule of a composition's run (loadcraft @ 47a52b419
  // api/routes/gatling_compositions.py:3243-3283): a slot no pin fills reads the dataset whose
  // file is `<slot>.csv`. The fake applies it only where the slot would otherwise be missing; a
  // slot whose rows ride in the artifact stays `auto`.
  const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).list();
  for (const slot of compositionSlots(store, composition)) {
    if (bound[slot.slot] !== undefined || unboundStatus(slot) !== 'missing') continue;
    const named = feeders.find((feeder) => feeder.file_name === `${slot.slot}.csv`);
    if (named !== undefined) bound[slot.slot] = named.id;
  }
  return bound;
}

/** The accounts dataset a proposal would create: the sklep world names it `konta`. */
const PROPOSED_NAME = 'konta';
/** The same for a foreign document (`worlds/document.ts`): the slot's own key. */
const proposedName = (store: Store, slot: string): string =>
  documentIsForeign(store) ? slot : PROPOSED_NAME;

function autoPlan(
  store: Store,
  body: { scenario_ids?: string[]; composition_id?: string | null },
): AutoPlanResponse {
  const scenarioIds = body.scenario_ids ?? [];
  const composition =
    body.composition_id == null ? undefined : compositionOf(store, body.composition_id);
  const scenarios = scenarioIds.map((id) => scenarioOf(store, id));
  const slots =
    composition === undefined
      ? scenarios.flatMap((scenario) => scenario.feeder_slots)
      : compositionSlots(store, composition);
  const bindings: Record<string, string> =
    composition === undefined
      ? scenarios.reduce(
          (merged, scenario) => ({ ...merged, ...scenario.slot_bindings }),
          {} as Record<string, string>,
        )
      : compositionBindings(store, composition);
  const planned = slots.map((slot) => ({ slot, status: statusOf(store, slot, bindings) }));
  const missing = planned.filter((entry) => entry.status === 'missing');
  const plainData = (slot: SklepSlot): boolean =>
    slot.role === 'data' && slot.identity_kind === null;
  const refused = missing.filter(({ slot }) => plainData(slot));
  const steered = store
    .collection<{ id: string; actions: AutoPlanResponse['actions'] }>(FAKE_PLAN_ACTIONS)
    .get('plan');
  const reply =
    refused.length > 0
      ? `I cannot create a synthetic dataset for ${refused.map(({ slot }) => slot.slot).join(', ')}: ` +
        '`email` is a credential field that cannot be fabricated.'
      : missing.length === 0
        ? 'Nothing to prepare.'
        : 'Accounts must be created.';
  return {
    reply,
    all_clear: planned.every((entry) => entry.status !== 'missing'),
    chips: [],
    issues: [],
    slots: planned.map(({ slot, status }) => ({
      slot: slot.slot,
      label: slot.label,
      status,
      identity_kind: slot.identity_kind,
    })),
    actions:
      steered?.actions ??
      missing
        .filter(({ slot }) => !plainData(slot))
        .map(({ slot }) => ({
          kind: 'create_dataset' as const,
          name: proposedName(store, slot.slot),
          bind_to_slot: slot.slot,
          row_count: 2000,
          recipe: {
            columns: [],
            sample_rows: [{ email: 'user-1@example.com', password: DATA_SENTINEL }],
          },
        })),
  };
}

/** Auto-linked datasets of the generation (search phrases, order details), as the backend adds them. */
export function seedAutoDatasets(store: Store): void {
  const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
  const base = {
    gatling_project_id: SKLEP_WORLD_IDS.gatlingProject,
    description: null,
    feeder_type: 'csv' as const,
    separator: ',',
    content: null,
    transform_expression: null,
    feed_records_count: null,
    feed_records_count_expression: null,
    dsl: null,
    jdbc_config: null,
    redis_config: null,
    feeder_options: null,
    consumption: 'shared' as const,
    has_recipe: true,
    manually_edited: false,
    created_by: 'user@example.com',
    auto_linked_scenario_id: SKLEP_WORLD_IDS.scenarios.zakupy,
    provenance: 'auto' as const,
    audit_metadata: null,
    created_at: '2026-11-22T10:18:00Z',
    updated_at: '2026-11-22T10:18:00Z',
    strategy: 'random' as const,
  };
  const seeds: SklepFeeder[] = [
    {
      ...base,
      id: SKLEP_WORLD_IDS.feeders.frazy,
      name: 'frazy wyszukiwania',
      file_name: 'search_phrases.csv',
      record_count: 500,
      columns: ['q'],
      column_semantics: { q: 'synthetic' },
      recipe_summary: [{ column_name: 'q', generator: 'Samples a model wrote' }],
      content_hash: 'frazy',
    },
    {
      ...base,
      id: SKLEP_WORLD_IDS.feeders.zamowienia,
      name: 'zamówienia',
      file_name: 'order_details.csv',
      record_count: 2000,
      columns: ['quantity', 'cardNumber'],
      column_semantics: { quantity: 'synthetic', cardNumber: 'credential' },
      recipe_summary: [
        { column_name: 'quantity', generator: 'Integer 1–5' },
        { column_name: 'cardNumber', generator: 'Card number (Visa, Mastercard)' },
      ],
      content_hash: 'zamowienia',
    },
  ];
  for (const seed of seeds) if (feeders.get(seed.id) === undefined) feeders.insert(seed);
}

/**
 * What a route set may change in the scenario detail before it is sent (the self-check routes put
 * the state of a check in progress there); one hook per fake.
 */
export const scenarioDetailHooks = new WeakMap<
  Fake,
  (scenario: SklepScenario) => Omit<SklepScenario, 'self_check'> & {
    self_check: SelfCheckDocument | null;
  }
>();

/**
 * Called before every read of the scenarios, the list and the detail: a route set that creates
 * scenarios in the background (`routes/scenarios.ts`) stores the finished ones then; one per fake.
 */
export const scenarioReadHooks = new WeakMap<Fake, () => void>();

/** Registers the data routes once per fake. */
export function registerDataRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}',
    (req, store) => {
      requireProject(store, req.params.project_id);
      scenarioReadHooks.get(fake)?.();
      const scenario = scenarioOf(store, req.params.scenario_id);
      const hook = scenarioDetailHooks.get(fake);
      return { status: 200, body: { ...(hook === undefined ? scenario : hook(scenario)) } };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}',
    (req, store) => {
      requireProject(store, req.params.project_id);
      return { status: 200, body: { ...compositionOf(store, req.params.composition_id) } };
    },
  );

  fake.route('GET', '/api/v1/projects/{project_id}/gatling/feeders', (req, store) => {
    requireProject(store, req.params.project_id);
    const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).list();
    return { status: 200, body: { feeders, total: feeders.length } };
  });

  fake.route('POST', '/api/v1/projects/{project_id}/gatling/executions/preflight', (req, store) => {
    requireProject(store, req.params.project_id);
    const body = req.body as { scenario_id: string };
    const scenario = scenarioOf(store, body.scenario_id);
    const verdicts = scenario.feeder_slots.map((slot) =>
      verdict(store, slot, scenario.slot_bindings),
    );
    return {
      status: 200,
      body: {
        ready: verdicts.every((entry) => ['bound', 'auto'].includes(entry.status)),
        checks: [],
        verdicts,
      },
    };
  });

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/feeders/preflight',
    (req, store) => {
      requireProject(store, req.params.project_id);
      const composition = compositionOf(store, req.params.composition_id);
      const bindings = compositionBindings(store, composition);
      const vusers = (req.body as { workload?: { vusers?: number } } | null)?.workload?.vusers;
      const checks = compositionSlots(store, composition).map((slot) => {
        const status = statusOf(store, slot, bindings);
        const feeder = feederOf(store, bindings[slot.slot]);
        // The fake's own demand model, used when a profile is sent: a dataset consumed row by
        // row (`exclusive`) needs `vusers` rows for the share of the traffic that uses its slot
        // (2 000 users, 60% of them with an account: 1 200 rows); a shared dataset needs none.
        const share = composition.scenarios
          .filter((link) =>
            scenarioOf(store, link.scenario_id).feeder_slots.some((s) => s.slot === slot.slot),
          )
          .reduce((sum, link) => sum + link.proportion, 0);
        const need =
          vusers !== undefined && feeder?.consumption === 'exclusive'
            ? Math.ceil(vusers * share)
            : null;
        const short = need !== null && (feeder?.record_count ?? 0) < need;
        return {
          slot: slot.slot,
          label: slot.label,
          required_columns: compositionColumns(store, composition, slot.slot),
          status: short ? ('short_rows' as const) : checkStatus(status),
          ...(feeder === undefined || vusers === undefined
            ? {}
            : { feeder_name: feeder.name, rows: feeder.record_count }),
          ...(need === null ? {} : { recommended_row_count: need }),
          feeder_id: feeder?.id ?? null,
        };
      });
      return {
        status: 200,
        body: { ready: checks.every((check) => ['ok', 'auto'].includes(check.status)), checks },
      };
    },
  );

  fake.route('POST', '/api/v1/projects/{project_id}/data-hub/auto-plan', (req, store) => {
    requireProject(store, req.params.project_id);
    const body = req.body as { scenario_ids?: string[]; composition_id?: string | null };
    if ((body.scenario_ids ?? []).length === 0 && body.composition_id == null) {
      throw new FakeHttpError(422, {
        detail: 'Name at least one scenario or composition to prepare data for.',
      });
    }
    return { status: 200, body: autoPlan(store, body) };
  });
}
