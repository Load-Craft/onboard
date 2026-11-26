// Composition writes of the fake backend: `POST …/gatling/compositions` and `PUT …/{id}`. The
// reads (list, detail) belong to `routes/lookup.ts` and `routes/data.ts`. Rules and texts follow
// loadcraft @ d93e08d80 `api/routes/gatling_compositions.py`: a unique name (409, `:539-543`), at
// least one member (400, `:6569-6573`), members of this project (400 `Scenario not found`,
// `:2054-2058`), a fraction per member that is not summed at write time (K.2 of the contract
// notes), and a PUT whose `scenarios` list replaces the members — a member left out is removed,
// fields left out of a kept member keep their values (`:1880-1898`). Registration is idempotent.

import { FakeHttpError, type Fake, type Store } from '../server.js';
import { createIdSource, createStore } from '../store.js';
import {
  SKLEP_COLLECTIONS,
  seedSklep,
  type SklepComposition,
  type SklepCompositionLink,
  type SklepFeeder,
  type SklepScenario,
} from '../worlds/sklep.js';
import { registerDataRoutes, scenarioReadHooks } from './data.js';

interface LinkBody {
  scenario_id?: string;
  variant_label?: string;
  proportion?: number;
  enabled?: boolean;
}

interface CompositionBody {
  name?: string | null;
  description?: string | null;
  scenarios?: LinkBody[] | null;
}

const registered = new WeakSet<Fake>();

let templateStore: Store | undefined;

/** The composition and a member of the world's `scenario` stage: the shape of every new one. */
function template(): { composition: SklepComposition; link: SklepCompositionLink } {
  if (templateStore === undefined) {
    templateStore = createStore(createIdSource(1));
    seedSklep(templateStore, { stage: 'scenario' });
  }
  const composition = templateStore
    .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
    .list()[0];
  const link = composition?.scenarios[0];
  if (composition === undefined || link === undefined) {
    throw new Error('the sklep world has no composition to copy');
  }
  return { composition: structuredClone(composition), link: structuredClone(link) };
}

function requireProject(store: Store, id: string): void {
  store.collection(SKLEP_COLLECTIONS.projects).require(id, `Project not found: ${id}`);
}

function compositionOf(store: Store, id: string): SklepComposition {
  return store
    .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
    .require(id, 'Composition not found');
}

function nameTaken(store: Store, name: string, except: string | null): void {
  const clash = store
    .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
    .list((composition) => composition.name === name && composition.id !== except);
  if (clash.length > 0) {
    throw new FakeHttpError(409, {
      detail: `Composition name already exists in this project: ${name}`,
    });
  }
}

/** The members of a body, each one kept from `saved` when the same (scenario, variant) is there. */
function linksOf(
  fake: Fake,
  store: Store,
  bodies: readonly LinkBody[],
  saved: readonly SklepCompositionLink[],
): SklepCompositionLink[] {
  scenarioReadHooks.get(fake)?.();
  const seen = new Set<string>();
  return bodies.map((body, index) => {
    const scenarioId = body.scenario_id ?? '';
    const variant = body.variant_label ?? '';
    const key = `${scenarioId}\u0000${variant}`;
    if (seen.has(key)) {
      throw new FakeHttpError(400, {
        detail: `Scenario ${scenarioId} with variant '${variant}' is linked twice.`,
      });
    }
    seen.add(key);
    const scenario = store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios).get(scenarioId);
    if (scenario === undefined) {
      throw new FakeHttpError(400, { detail: `Scenario not found: ${scenarioId}` });
    }
    const kept = saved.find(
      (link) => link.scenario_id === scenarioId && link.variant_label === variant,
    );
    const base = kept ?? {
      ...template().link,
      link_id: store.newId(),
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      simulation_class_name: scenario.simulation_class_name,
      variant_label: variant,
      contract: {
        inputs: scenario.scenario_contract_v2.required_inputs.map((name) => ({ name })),
        outputs: scenario.scenario_contract_v2.exports.map((name) => ({ name })),
        locals: [],
        control_vars: [],
        session_vars: [],
      },
      scenario_artifact: scenario.scenario_artifact,
      scenario_contract_v2: scenario.scenario_contract_v2,
      scenario_version: scenario.current_version,
      pinned_version: scenario.current_version,
      current_version: scenario.current_version,
    };
    return {
      ...base,
      proportion: body.proportion ?? base.proportion,
      enabled: body.enabled ?? base.enabled,
      order_index: index,
    };
  });
}

/** The members and the counts of the verdict that depend on them (timestamps stay the template's). */
function withValidation(
  composition: SklepComposition,
  links: SklepCompositionLink[],
): SklepComposition {
  return {
    ...composition,
    scenarios: links,
    validation: {
      ...composition.validation,
      scenario_count: links.length,
      total_proportion: links.reduce((sum, link) => sum + link.proportion, 0),
    },
  };
}

export function registerCompositionRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  registerDataRoutes(fake);

  fake.route('POST', '/api/v1/projects/{project_id}/gatling/compositions', (req, store) => {
    requireProject(store, req.params.project_id);
    const body = (req.body ?? {}) as CompositionBody;
    const name = body.name ?? '';
    nameTaken(store, name, null);
    const members = body.scenarios ?? [];
    if (members.length === 0) {
      throw new FakeHttpError(400, { detail: 'Parallel composition requires at least 1 scenario' });
    }
    const links = linksOf(fake, store, members, []);
    const { composition } = template();
    const compositions = store.collection<SklepComposition>(SKLEP_COLLECTIONS.compositions);
    const id = compositions.get(composition.id) === undefined ? composition.id : store.newId();
    const created = withValidation(
      { ...composition, id, name, description: body.description ?? '' },
      links,
    );
    compositions.insert(created);
    return { status: 201, body: { ...created } };
  });

  // The composition's own pins (loadcraft @ 47a52b419 api/routes/gatling_compositions.py:7007): the
  // whole map is replaced; a slot no member declares and a dataset not in the project are refused.
  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/slot-bindings',
    (req, store) => {
      requireProject(store, req.params.project_id);
      const saved = compositionOf(store, req.params.composition_id);
      const { bindings } = req.body as { bindings: Record<string, string> };
      const slots = new Set(
        saved.scenarios.flatMap((link) =>
          store
            .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
            .require(link.scenario_id, 'Scenario not found')
            .feeder_slots.map((slot) => slot.slot),
        ),
      );
      const feeders = store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
      for (const [slot, feeder] of Object.entries(bindings)) {
        if (!slots.has(slot)) throw new FakeHttpError(400, { detail: `Unknown slot '${slot}'.` });
        if (feeders.get(feeder) === undefined) {
          throw new FakeHttpError(400, { detail: `Unknown feeder '${feeder}'.` });
        }
      }
      const states = Object.entries(bindings).map(([slot, feeder]) => ({
        slot,
        feeder_id: feeder,
        state: 'pinned' as const,
      }));
      store
        .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
        .update(saved.id, { slot_bindings: { ...bindings }, slot_binding_states: states });
      return { status: 200, body: { slot_bindings: { ...bindings }, slot_binding_states: [] } };
    },
  );

  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}',
    (req, store) => {
      requireProject(store, req.params.project_id);
      const saved = compositionOf(store, req.params.composition_id);
      const body = (req.body ?? {}) as CompositionBody;
      if (body.name !== undefined && body.name !== null) nameTaken(store, body.name, saved.id);
      const links =
        body.scenarios === undefined || body.scenarios === null
          ? saved.scenarios
          : linksOf(fake, store, body.scenarios, saved.scenarios);
      const updated = withValidation(
        {
          ...saved,
          name: body.name ?? saved.name,
          description: body.description ?? saved.description,
        },
        links,
      );
      store.collection<SklepComposition>(SKLEP_COLLECTIONS.compositions).update(saved.id, updated);
      return { status: 200, body: { ...updated } };
    },
  );
}
