// Write routes of scenarios for the tools of module scenario that change a scenario or a composition
// (src/tools/scenario/), the deletion of one of them among them (a scenario goes with its versions and
// its links in the compositions; a composition goes alone). The versions are the `scenario_versions` collection of `routes/scenario.ts`
// (a test seeds them with `seedScenarioVersions`). Registration is idempotent per fake.

import { FakeHttpError, type Fake } from '../server.js';
import { SKLEP_COLLECTIONS, type SklepComposition, type SklepScenario } from '../worlds/sklep.js';
import { SCENARIO_VERSIONS } from './scenario.js';

interface StoredVersion {
  readonly id: string;
  readonly scenario_id: string;
  readonly version: number;
  readonly change_reason?: string | null;
  readonly artifact?: Record<string, unknown> | null;
  readonly has_artifact_snapshot?: boolean;
}

/** The artifact with its self-check cleared, as a restore leaves it. */
function withoutSelfCheck(
  artifact: SklepScenario['scenario_artifact'],
): SklepScenario['scenario_artifact'] {
  const copy = structuredClone(artifact);
  copy.generation_metadata.self_check = null;
  return copy;
}

const registered = new WeakSet<Fake>();

export function registerScenarioWriteRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  // Restoring a version makes its artifact the newest version of the scenario and clears the
  // self-check. A version with no artifact snapshot is a 409 while the scenario has an artifact.
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/versions/{version}/restore',
    (req, store) => {
      const { project_id: projectId, scenario_id: scenarioId, version } = req.params;
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(projectId, `Project not found: ${projectId}`);
      const scenarios = store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
      const scenario = scenarios.require(scenarioId, 'Scenario not found');
      const versions = store.collection<StoredVersion>(SCENARIO_VERSIONS);
      const source = versions.list(
        (item) => item.scenario_id === scenarioId && String(item.version) === version,
      )[0];
      if (source === undefined) {
        throw new FakeHttpError(404, { detail: `Version ${version} not found` });
      }
      if (source.artifact === undefined || source.artifact === null) {
        throw new FakeHttpError(409, { detail: 'The version has no artifact snapshot' });
      }
      const next = scenario.current_version + 1;
      const artifact = withoutSelfCheck(source.artifact as SklepScenario['scenario_artifact']);
      const restored = scenarios.update(scenarioId, {
        scenario_artifact: artifact,
        current_version: next,
        updated_at: '2026-11-27T12:00:00Z',
      });
      versions.insert({
        id: `${next.toString(16).padStart(8, '0')}-0000-4000-8000-${scenarioId.slice(-12)}`,
        scenario_id: scenarioId,
        version: next,
        change_reason: `Restored from version ${version}`,
        artifact: structuredClone(artifact),
        has_artifact_snapshot: true,
      });
      return { status: 200, body: restored };
    },
  );

  // Moving one member of a composition to the current version of its scenario: the pin follows, the
  // drift of that member is gone. An unknown member is a 404.
  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/links/{link_id}/pin',
    (req, store) => {
      const { project_id: projectId, composition_id: compositionId, link_id: linkId } = req.params;
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(projectId, `Project not found: ${projectId}`);
      const compositions = store.collection<SklepComposition>(SKLEP_COLLECTIONS.compositions);
      const composition = compositions.require(compositionId, 'Composition not found');
      const link = composition.scenarios.find((item) => item.link_id === linkId);
      if (link === undefined) {
        throw new FakeHttpError(404, { detail: `Scenario link not found: ${linkId}` });
      }
      const scenario = store
        .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
        .require(link.scenario_id, `Scenario not found: ${link.scenario_id}`);
      const updated = compositions.update(compositionId, {
        scenarios: composition.scenarios.map((item) =>
          item.link_id === linkId
            ? {
                ...item,
                pinned_version: scenario.current_version,
                current_version: scenario.current_version,
                scenario_version: scenario.current_version,
                has_drift: false,
                drift_fields: [],
              }
            : item,
        ),
      });
      return { status: 200, body: updated };
    },
  );

  // Setting the load test type: the spec is checked as the backend does (a known type, positive users
  // and duration, else a 422 `Invalid test_type_spec`), the members are linked again under new ids and
  // `feeder_advice` names, per member before the save, its datasets with the rows the new type needs.
  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}/test-type',
    (req, store) => {
      const { project_id: projectId, composition_id: compositionId } = req.params;
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(projectId, `Project not found: ${projectId}`);
      const compositions = store.collection<SklepComposition>(SKLEP_COLLECTIONS.compositions);
      const composition = compositions.require(compositionId, 'Composition not found');
      const spec = (req.body as { test_type_spec: Record<string, unknown> }).test_type_spec;
      const types = [
        'load_test',
        'stress_test',
        'soak_test',
        'spike_test',
        'breakpoint_test',
        'capacity_test',
      ];
      const positive = (value: unknown): boolean => typeof value === 'number' && value > 0;
      if (
        typeof spec['type'] !== 'string' ||
        !types.includes(spec['type']) ||
        !positive(spec['target_users']) ||
        !positive(spec['duration_seconds'])
      ) {
        throw new FakeHttpError(422, {
          detail: 'Invalid test_type_spec: users and duration must be positive',
        });
      }
      const users = spec['target_users'] as number;
      const advice = composition.scenarios.map((link) => ({
        link_id: link.link_id,
        scenario_id: link.scenario_id,
        variant_label: link.variant_label,
        feeder_bindings: link.feeder_bindings.map((binding) => ({
          ...binding,
          required_row_count: users,
        })),
      }));
      const updated = compositions.update(compositionId, {
        test_type_spec: structuredClone(spec),
        scenarios: composition.scenarios.map((link) => ({
          ...link,
          link_id: store.newId(),
          feeder_bindings: link.feeder_bindings.map((binding) => ({
            ...binding,
            required_row_count: users,
          })),
        })),
      });
      return { status: 200, body: { ...updated, feeder_advice: advice } };
    },
  );

  // Deleting a scenario cascades its versions and its links in the compositions.
  fake.route(
    'DELETE',
    '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      const scenarios = store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
      scenarios.require(req.params.scenario_id, 'Scenario not found');
      scenarios.delete(req.params.scenario_id);
      const versions = store.collection<StoredVersion>(SCENARIO_VERSIONS);
      for (const version of versions.list((row) => row.scenario_id === req.params.scenario_id)) {
        versions.delete(version.id);
      }
      const compositions = store.collection<SklepComposition>(SKLEP_COLLECTIONS.compositions);
      for (const composition of compositions.list()) {
        compositions.update(composition.id, {
          scenarios: composition.scenarios.filter(
            (link) => link.scenario_id !== req.params.scenario_id,
          ),
        });
      }
      return { status: 200, body: { message: 'Scenario deleted' } };
    },
  );

  fake.route(
    'DELETE',
    '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      const compositions = store.collection<SklepComposition>(SKLEP_COLLECTIONS.compositions);
      compositions.require(req.params.composition_id, 'Composition not found');
      compositions.delete(req.params.composition_id);
      return { status: 204 };
    },
  );
}
