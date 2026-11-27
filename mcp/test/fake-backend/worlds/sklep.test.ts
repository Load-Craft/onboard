import { describe, expect, it } from 'vitest';

import { SKLEP_IDS } from '../../golden/index.js';
import { loadContract } from '../contract.js';
import { createIdSource, createStore, type Store } from '../store.js';
import {
  SKLEP_COLLECTIONS,
  SKLEP_STAGES,
  SKLEP_WORLD_IDS,
  seedSklep,
  type SklepComposition,
  type SklepEndpoint,
  type SklepExecution,
  type SklepExecutionAnalysis,
  type SklepExecutionResult,
  type SklepFeeder,
  type SklepScenario,
  type SklepSelfCheck,
  type SklepStage,
  type SklepTelemetrySource,
} from './sklep.js';
import type { components } from '../../../src/http/generated/api.js';

type FlowDetail = components['schemas']['FlowDetail'];
type EnvironmentResponse = components['schemas']['EnvironmentResponse'];
type ValidatorResponse = components['schemas']['ValidatorResponse'];
type TestTypeResponse = components['schemas']['TestTypeResponse'];
type ProjectDetail = components['schemas']['ProjectDetail'];
type OpenAPISpecSummary = components['schemas']['OpenAPISpecSummary'];

const PROJECT = SKLEP_IDS.project;
/** Values the flows take from test data, so no earlier block produces them. */
const DATA_VARIABLES = new Set(['q', 'email', 'password', 'quantity', 'cardNumber']);
const NAMES = SKLEP_COLLECTIONS;

function seeded(stage: SklepStage, storeSeed = 1): Store {
  const store = createStore(createIdSource(storeSeed));
  seedSklep(store, { stage });
  return store;
}

function all<T extends { id: string }>(store: Store, name: string): T[] {
  return store.collection<T>(name).list();
}

function sizes(store: Store): Record<string, number> {
  return Object.fromEntries(
    Object.values(NAMES).map((name) => [name, store.collection(name).size]),
  );
}

/** Flow outline reduced to what the tests compare: request `METHOD path` and pause ranges. */
function outline(flow: FlowDetail): string[] {
  return flow.blocks.map((block) => {
    const config = block['config'] as Record<string, unknown>;
    if (block['type'] === 'pause') {
      return `PAUSE ${String(config['delay_min_ms'])}-${String(config['delay_max_ms'])}`;
    }
    return `${String(config['method'])} ${String(config['path'])}`;
  });
}

describe('sklep world', () => {
  describe('stages', () => {
    it('lists the stages in session order', () => {
      expect(SKLEP_STAGES).toEqual(['empty', 'project', 'flows', 'scenario', 'data', 'executed']);
    });

    it('empty seeds nothing', () => {
      const counts = sizes(seeded('empty'));
      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    });

    it('each stage keeps every record of the previous one', () => {
      let previous = new Set<string>();
      for (const stage of SKLEP_STAGES) {
        const store = seeded(stage);
        const ids = new Set(
          Object.values(NAMES).flatMap((name) => all(store, name).map((r) => `${name}/${r.id}`)),
        );
        for (const id of previous) expect(ids.has(id), `${stage} lost ${id}`).toBe(true);
        previous = ids;
      }
    });

    it('is deterministic: same stage, same records, whatever the store seed', () => {
      const dump = (store: Store): unknown => Object.values(NAMES).map((name) => all(store, name));
      expect(dump(seeded('executed', 1))).toEqual(dump(seeded('executed', 99)));
    });

    it('uses well-formed, unique identifiers', () => {
      const store = seeded('executed');
      // The telemetry source and a run's result are keyed by their owner (project, execution).
      const keyedByOwner: string[] = [NAMES.telemetry, NAMES.results];
      const own = Object.values(NAMES).filter((name) => !keyedByOwner.includes(name));
      const ids = own.flatMap((name) => all(store, name).map((r) => r.id));
      for (const id of [...ids, PROJECT, SKLEP_IDS.executionPerf]) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
      expect(new Set(ids).size).toBe(ids.length);
      expect(all(store, NAMES.telemetry).map((r) => r.id)).toEqual([PROJECT]);
      expect(
        all(store, NAMES.results)
          .map((r) => r.id)
          .sort(),
      ).toEqual(
        all(store, NAMES.executions)
          .map((r) => r.id)
          .sort(),
      );
    });

    it('takes the identifiers pinned by the golden texts from SKLEP_IDS', () => {
      const store = seeded('executed');
      expect(store.collection(NAMES.projects).get(SKLEP_IDS.project)).toBeDefined();
      expect(store.collection(NAMES.flows).get(SKLEP_IDS.flowZakupy)).toBeDefined();
      expect(store.collection(NAMES.executions).get(SKLEP_IDS.selfCheckExecution)).toBeDefined();
      expect(store.collection(NAMES.executions).get(SKLEP_IDS.executionPerf)).toBeDefined();
    });

    it('uses only example.com hosts and addresses', () => {
      const text = JSON.stringify(
        Object.values(NAMES).map((name) => all(seeded('executed'), name)),
      );
      const hosts = [...text.matchAll(/https?:\/\/([^/"\\\s]+)/g)].map((m) => m[1] ?? '');
      expect(hosts.length).toBeGreaterThan(0);
      for (const host of hosts) expect(host).toMatch(/(^|\.)example\.com$/);
      const mails = [...text.matchAll(/[\w.+-]+@([\w.-]+)/g)].map((m) => m[1] ?? '');
      for (const domain of mails) expect(domain).toBe('example.com');
    });
  });

  describe('project stage', () => {
    const store = seeded('project');

    it('creates project "sklep" with its login', () => {
      const projects = all<ProjectDetail>(store, NAMES.projects);
      expect(projects).toHaveLength(1);
      const [project] = projects;
      expect(project?.id).toBe(PROJECT);
      expect(project?.name).toBe('sklep');
      expect(project?.description).toBe('Sklep API');
      expect(project?.openapi_spec_id).toBe(SKLEP_WORLD_IDS.spec);
      expect(JSON.stringify(project?.auth_config)).toContain('/auth/login');
    });

    it('has 42 operations in 6 areas, none of them duplicated', () => {
      const endpoints = all<SklepEndpoint>(store, NAMES.endpoints);
      expect(endpoints).toHaveLength(42);
      expect(new Set(endpoints.map((e) => `${e.method} ${e.path}`)).size).toBe(42);
      expect(new Set(endpoints.map((e) => e.tags[0])).size).toBe(6);
      expect(endpoints.every((e) => e.tags.length === 1)).toBe(true);
      expect(endpoints.every((e) => e.spec_id === SKLEP_WORLD_IDS.spec)).toBe(true);
      expect(endpoints.find((e) => e.method === 'POST' && e.path === '/auth/login')).toBeDefined();
    });

    it('describes the spec with the same operation count', () => {
      const [spec] = all<OpenAPISpecSummary>(store, NAMES.specs);
      expect(all(store, NAMES.specs)).toHaveLength(1);
      expect(spec?.title).toBe('Sklep API');
      expect(spec?.endpoints_count).toBe(42);
      expect(spec?.is_current).toBe(true);
    });

    it('has four environments with perf as the default', () => {
      const envs = all<EnvironmentResponse>(store, NAMES.environments);
      const byName = new Map(envs.map((env) => [env.name, env]));
      expect([...byName.keys()]).toEqual(['perf', 'qa', 'dev', 'prod']);
      expect(envs.filter((env) => env.is_default).map((env) => env.name)).toEqual(['perf']);
      expect(envs.every((env) => env.project_id === PROJECT)).toBe(true);

      expect(byName.get('perf')?.base_url).toBe('https://api.perf.example.com');
      expect(byName.get('perf')?.frontend_url).toBe('https://perf.example.com');
      expect(byName.get('qa')?.base_url).toBe('https://api.qa.example.com');
      expect(byName.get('dev')?.base_url).toBe('https://api.dev.example.com');
      expect(byName.get('prod')?.base_url).toBe('https://api.example.com');
      expect(byName.get('prod')?.frontend_url).toBe('https://example.com');
    });

    it('protects qa and prod with their workload caps', () => {
      const env = (name: string): EnvironmentResponse | undefined =>
        all<EnvironmentResponse>(store, NAMES.environments).find((e) => e.name === name);
      expect(env('qa')?.protected).toBe(true);
      expect(env('qa')?.workload_caps).toEqual({ max_vu: 100, max_rps: 20 });
      expect(env('prod')?.protected).toBe(true);
      expect(env('prod')?.workload_caps).toEqual({ max_vu: 20, max_rps: 5 });
      for (const name of ['perf', 'dev']) {
        expect(env(name)?.protected).toBe(false);
        expect(env(name)?.workload_caps ?? null).toBeNull();
      }
    });

    it('records the conformance of perf: 18 GET checked, 24 non-GET left unchecked', () => {
      const perf = all<EnvironmentResponse>(store, NAMES.environments).find(
        (e) => e.name === 'perf',
      );
      expect(perf?.last_conformance).toMatchObject({ checked_get: 18, ok: 18, unchecked: 24 });
      const endpoints = all<SklepEndpoint>(store, NAMES.endpoints);
      expect(endpoints.filter((e) => e.method === 'GET')).toHaveLength(18);
      expect(endpoints.filter((e) => e.method !== 'GET')).toHaveLength(24);
    });

    it('attaches the log source of the diagnosis', () => {
      const sources = all<SklepTelemetrySource>(store, NAMES.telemetry);
      expect(sources).toHaveLength(1);
      expect(sources[0]?.id).toBe(PROJECT);
      expect(sources[0]?.label).toBe('sklep-logs');
      expect(sources[0]?.url).toBe('https://logs-mcp.perf.example.com/mcp');
      expect(sources[0]?.enabled_tools).toEqual(['logs_summary', 'container_events']);
    });

    it('has the 5 validators and 3 test types project_apply_setup reports', () => {
      expect(all<ValidatorResponse>(store, NAMES.validators)).toHaveLength(5);
      expect(all<TestTypeResponse>(store, NAMES.testTypes)).toHaveLength(3);
      for (const record of [
        ...all<ValidatorResponse>(store, NAMES.validators),
        ...all<TestTypeResponse>(store, NAMES.testTypes),
      ]) {
        expect(record.project_id).toBe(PROJECT);
      }
    });

    it('has no flows yet', () => {
      expect(store.collection(NAMES.flows).size).toBe(0);
      expect(store.collection(NAMES.scenarios).size).toBe(0);
    });
  });

  describe('flows stage', () => {
    const store = seeded('flows');
    const flows = all<FlowDetail>(store, NAMES.flows);
    const flow = (name: string): FlowDetail => {
      const found = flows.find((f) => f.name === name);
      if (found === undefined) throw new Error(`no flow ${name}`);
      return found;
    };

    it('has the three flows of the mock-up', () => {
      expect(flows.map((f) => f.name)).toEqual(['zakupy', 'przeglądanie', 'konto']);
      expect(flow('zakupy').id).toBe(SKLEP_IDS.flowZakupy);
      expect(flows.every((f) => f.project_id === PROJECT)).toBe(true);
      expect(flows.every((f) => f.openapi_spec_id === SKLEP_WORLD_IDS.spec)).toBe(true);
    });

    it('zakupy: 7 steps, 4 requests and 3 pauses chosen for the customer action', () => {
      const zakupy = flow('zakupy');
      expect(zakupy.blocks).toHaveLength(7);
      expect(outline(zakupy)).toEqual([
        'POST /auth/login',
        'PAUSE 3000-8000',
        'GET /products',
        'PAUSE 10000-30000',
        'POST /cart/items',
        'PAUSE 20000-45000',
        'POST /checkout',
      ]);
      const types = zakupy.blocks.map((b) => b['type']);
      expect(types.filter((t) => t === 'request')).toHaveLength(4);
      expect(types.filter((t) => t === 'pause')).toHaveLength(3);
    });

    it('przeglądanie has 3 steps and konto has 3 steps', () => {
      expect(flow('przeglądanie').blocks).toHaveLength(3);
      expect(flow('konto').blocks).toHaveLength(3);
      expect(outline(flow('konto'))[0]).toBe('POST /auth/login');
    });

    it('pause blocks carry their source and a distribution', () => {
      for (const f of flows) {
        for (const block of f.blocks.filter((b) => b['type'] === 'pause')) {
          const config = block['config'] as Record<string, unknown>;
          expect(config['source']).toBe('default_human');
          expect(config['distribution']).toBe('uniform');
        }
      }
    });

    it('request blocks keep the backend shape: expected statuses and saved variables', () => {
      const requests = flow('zakupy').blocks.filter((b) => b['type'] === 'request');
      const configs = requests.map((b) => b['config'] as Record<string, unknown>);
      expect(configs[3]?.['expected_statuses']).toEqual([201, 409]);
      const saved = configs.flatMap((config) =>
        (config['request_checks'] as { save_as: string }[]).map((check) => check.save_as),
      );
      expect(saved).toEqual(['token', 'productId', 'cartId']);
      expect(configs[0]?.['method']).toBe('POST');
      expect(configs[1]?.['query_params']).toEqual({ q: '#{q}' });
    });

    it('flow edges form one chain from the entry block', () => {
      for (const f of flows) {
        const ids = f.blocks.map((b) => b['id'] as string);
        expect(f.entry_block_id).toBe(ids[0]);
        expect(f.edges.map((e) => [e['source'], e['target']])).toEqual(
          ids.slice(0, -1).map((id, i) => [id, ids[i + 1]]),
        );
      }
    });

    it('every request points at an existing operation of the spec', () => {
      const endpoints = new Map(all<SklepEndpoint>(store, NAMES.endpoints).map((e) => [e.id, e]));
      for (const f of flows) {
        const requests = f.blocks.filter((b) => b['type'] === 'request');
        expect(requests.length).toBeGreaterThan(0);
        for (const block of requests) {
          const config = block['config'] as Record<string, string>;
          const endpoint = endpoints.get(config['endpoint_id'] ?? '');
          expect(endpoint, `${f.name}: ${config['method']} ${config['path']}`).toBeDefined();
          expect(`${endpoint?.method} ${endpoint?.path}`).toBe(
            `${config['method']} ${config['path']}`,
          );
        }
        expect(f.source_endpoints).toEqual(
          requests.map((b) => {
            const config = b['config'] as Record<string, string>;
            return `${config['method']}:${config['path']}`;
          }),
        );
      }
    });

    it('does not use a variable before an earlier block saved it, except data variables', () => {
      for (const f of flows) {
        const saved = new Set<string>();
        for (const block of f.blocks) {
          const config = block['config'] as Record<string, unknown>;
          const used = [...JSON.stringify(config).matchAll(/#\{(\w+)\}/g)].map((m) => m[1] ?? '');
          for (const name of used) {
            if (!DATA_VARIABLES.has(name))
              expect(saved.has(name), `${f.name}: #{${name}}`).toBe(true);
          }
          for (const check of (config['request_checks'] as { save_as: string }[] | undefined) ??
            []) {
            saved.add(check.save_as);
          }
        }
      }
    });
  });

  describe('scenario stage', () => {
    const store = seeded('scenario');

    it('has a scenario per flow, each on its own flow', () => {
      const scenarios = all<SklepScenario>(store, NAMES.scenarios);
      expect(scenarios.map((s) => s.name)).toEqual(['przeglądanie', 'zakupy', 'konto']);
      const flows = new Map(all<FlowDetail>(store, NAMES.flows).map((f) => [f.id, f]));
      for (const scenario of scenarios) {
        const flow = flows.get(scenario.source_flow_id);
        expect(flow?.name).toBe(scenario.name);
        expect(scenario.source_flow_version).toBe(flow?.current_version);
      }
      expect(new Set(scenarios.map((s) => s.source_flow_id)).size).toBe(3);
    });

    it('composes "checkout" 40 / 50 / 10 from existing scenarios, summing to 1', () => {
      const [composition, ...rest] = all<SklepComposition>(store, NAMES.compositions);
      expect(rest).toHaveLength(0);
      expect(composition?.name).toBe('checkout');
      expect(composition?.project_id).toBe(SKLEP_WORLD_IDS.gatlingProject);
      const scenarios = new Map(all<SklepScenario>(store, NAMES.scenarios).map((s) => [s.id, s]));
      const shares = Object.fromEntries(
        (composition?.scenarios ?? []).map((link) => [link.scenario_name, link.proportion]),
      );
      expect(shares).toEqual({ przeglądanie: 0.4, zakupy: 0.5, konto: 0.1 });
      for (const link of composition?.scenarios ?? []) {
        expect(scenarios.get(link.scenario_id)?.name).toBe(link.scenario_name);
        expect(link.simulation_class_name).toBe(
          scenarios.get(link.scenario_id)?.simulation_class_name,
        );
      }
      const total = (composition?.scenarios ?? []).reduce((sum, link) => sum + link.proportion, 0);
      expect(total).toBeCloseTo(1, 10);
      expect(composition?.validation.total_proportion).toBeCloseTo(1, 10);
      expect(composition?.status).toBe('ready');
    });

    it('records the data mix 95 / 4 / 1 in the artifact, as the backend keeps it', () => {
      for (const scenario of all<SklepScenario>(store, NAMES.scenarios)) {
        expect(scenario.scenario_artifact.generation_metadata.resolved_class_mix).toEqual({
          happy_path: 95,
          invalid_input: 4,
          boundary_values: 1,
        });
      }
    });

    it('declares the three data slots on the scenarios that need them', () => {
      const slotsOf = (name: string): string[] =>
        (
          all<SklepScenario>(store, NAMES.scenarios).find((s) => s.name === name)?.feeder_slots ??
          []
        ).map((slot) => slot.label);
      expect(slotsOf('zakupy')).toEqual(['Search terms', 'Quantity & cardnumber', 'User accounts']);
      expect(slotsOf('konto')).toEqual(['User accounts']);
      expect(slotsOf('przeglądanie')).toEqual([]);
    });

    it('accounts are exclusive existing accounts; the other slots are generated data', () => {
      const zakupy = all<SklepScenario>(store, NAMES.scenarios).find((s) => s.name === 'zakupy');
      const slot = (name: string): SklepScenario['feeder_slots'][number] | undefined =>
        zakupy?.feeder_slots.find((s) => s.label === name);
      expect(slot('User accounts')).toMatchObject({
        identity_kind: 'existing',
        role: 'auth',
        strategy: 'queue',
      });
      expect(slot('Search terms')).toMatchObject({ identity_kind: null, role: 'data' });
    });

    it('has no datasets yet: the accounts are missing', () => {
      expect(store.collection(NAMES.feeders).size).toBe(0);
      for (const scenario of all<SklepScenario>(store, NAMES.scenarios)) {
        expect(scenario.slot_bindings).toEqual({});
        expect(scenario.slot_binding_states).toEqual([]);
      }
    });

    it('self-check: browsing passed on perf, the login flows wait for the accounts slot', () => {
      const scenarios = all<SklepScenario>(store, NAMES.scenarios);
      const check = (name: string): SklepSelfCheck | null =>
        scenarios.find((s) => s.name === name)?.self_check ?? null;
      expect(check('przeglądanie')).toMatchObject({
        status: 'passed',
        scenario_version: 1,
        execution_ids: [SKLEP_IDS.selfCheckExecution],
        missing_slots: [],
      });
      for (const name of ['zakupy', 'konto']) {
        expect(check(name)).toMatchObject({
          status: 'waiting_for_data',
          execution_ids: [],
          missing_slots: ['accounts'],
        });
      }
    });

    it('the self-check of browsing is a run of that scenario, 2 requests in 0.3 s on perf', () => {
      const executions = store.collection<SklepExecution>(NAMES.executions);
      const run = executions.require(SKLEP_IDS.selfCheckExecution);
      expect(run).toMatchObject({
        scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie,
        composite_id: null,
        status: 'completed',
        total_requests: 2,
        ko_count: 0,
        duration_seconds: 0.3,
      });
      expect(run.run_manifest.target_environment_id).toBe(SKLEP_WORLD_IDS.environments.perf);
      expect(run.run_manifest.target_base_url).toBe('https://api.perf.example.com');
      const result = store.collection<SklepExecutionResult>(NAMES.results).require(run.id);
      expect(result.per_request.map((r) => r.request_name)).toEqual([
        'GET /categories',
        'GET /products',
      ]);
    });

    it('has no load test yet and only the one self-check run', () => {
      const runs = all<SklepExecution>(store, NAMES.executions);
      expect(runs.map((r) => r.id)).toEqual([SKLEP_IDS.selfCheckExecution]);
    });
  });

  describe('data stage', () => {
    const store = seeded('data');

    it('provisions 2 000 accounts and generates the two automatic datasets', () => {
      const feeders = all<SklepFeeder>(store, NAMES.feeders);
      const byName = new Map(feeders.map((f) => [f.name, f]));
      expect([...byName.keys()]).toEqual(['frazy wyszukiwania', 'zamówienia', 'konta']);
      expect(byName.get('konta')).toMatchObject({
        columns: ['email', 'password'],
        record_count: 2000,
        consumption: 'exclusive',
        feeder_type: 'csv',
      });
      expect(byName.get('frazy wyszukiwania')?.columns).toEqual(['q']);
      expect(byName.get('zamówienia')?.columns).toEqual(['quantity', 'cardNumber']);
      expect(feeders.every((f) => f.gatling_project_id === SKLEP_WORLD_IDS.gatlingProject)).toBe(
        true,
      );
    });

    it('never stores rows: no content, no password, no card number', () => {
      const feeders = all<SklepFeeder>(store, NAMES.feeders);
      expect(feeders.every((f) => f.content === null)).toBe(true);
      expect(JSON.stringify(feeders)).not.toMatch(/\d{13,19}/);
    });

    it('binds every slot of every scenario to a dataset of the same file', () => {
      const feeders = new Map(all<SklepFeeder>(store, NAMES.feeders).map((f) => [f.id, f]));
      for (const scenario of all<SklepScenario>(store, NAMES.scenarios)) {
        expect(Object.keys(scenario.slot_bindings).sort()).toEqual(
          scenario.feeder_slots.map((slot) => slot.slot).sort(),
        );
        for (const slot of scenario.feeder_slots) {
          const feeder = feeders.get(scenario.slot_bindings[slot.slot] ?? '');
          expect(feeder?.file_name).toBe(slot.default_file);
          expect(feeder?.columns).toEqual(slot.columns);
        }
        expect(scenario.slot_binding_states.map((state) => state.state)).toEqual(
          scenario.feeder_slots.map(() => 'pinned'),
        );
      }
    });

    it('re-runs the self-check of zakupy (4 requests, 1.2 s) and konto (2 requests, 0.4 s)', () => {
      const scenarios = all<SklepScenario>(store, NAMES.scenarios);
      const executions = store.collection<SklepExecution>(NAMES.executions);
      const results = store.collection<SklepExecutionResult>(NAMES.results);
      const expected: Record<string, [number, number]> = { zakupy: [4, 1.2], konto: [2, 0.4] };
      for (const [name, [requests, seconds]] of Object.entries(expected)) {
        const scenario = scenarios.find((s) => s.name === name);
        expect(scenario?.self_check).toMatchObject({ status: 'passed', missing_slots: [] });
        const id = scenario?.self_check?.execution_ids[0] ?? '';
        const run = executions.require(id);
        expect(run).toMatchObject({
          scenario_id: scenario?.id,
          total_requests: requests,
          ko_count: 0,
        });
        expect(run.duration_seconds).toBeCloseTo(seconds, 10);
        expect(results.require(id).per_request).toHaveLength(requests);
      }
    });

    it('the chain of a self-check is the requests of the flow, in its order', () => {
      const flows = new Map(all<FlowDetail>(store, NAMES.flows).map((f) => [f.id, f]));
      const results = store.collection<SklepExecutionResult>(NAMES.results);
      for (const scenario of all<SklepScenario>(store, NAMES.scenarios)) {
        const flow = flows.get(scenario.source_flow_id);
        const requests = (flow?.blocks ?? [])
          .filter((b) => b['type'] === 'request')
          .map((b) => {
            const config = b['config'] as { method: string; path: string };
            return `${config.method} ${config.path}`;
          });
        const id = scenario.self_check?.execution_ids[0] ?? '';
        expect(results.require(id).per_request.map((r) => r.request_name)).toEqual(requests);
      }
    });

    it('the run manifest of a self-check names the datasets its scenario uses', () => {
      const run = store
        .collection<SklepExecution>(NAMES.executions)
        .require(SKLEP_WORLD_IDS.selfCheckZakupy);
      expect(run.run_manifest.feeders.map((f) => f.slot)).toEqual([
        'search_phrases',
        'order_details',
        'accounts',
      ]);
      const feederIds = new Set(all<SklepFeeder>(store, NAMES.feeders).map((f) => f.id));
      for (const entry of run.run_manifest.feeders)
        expect(feederIds.has(entry.feeder_id)).toBe(true);
    });

    it('has no load test yet', () => {
      expect(
        all<SklepExecution>(store, NAMES.executions).every((e) => e.scenario_id !== null),
      ).toBe(true);
    });
  });

  describe('executed stage', () => {
    const store = seeded('executed');
    const execution = store
      .collection<SklepExecution>(NAMES.executions)
      .require(SKLEP_IDS.executionPerf);
    const result = store
      .collection<SklepExecutionResult>(NAMES.results)
      .require(SKLEP_IDS.executionPerf);

    it('is the ramp-load run on perf over the checkout composition', () => {
      expect(execution).toMatchObject({
        scenario_id: null,
        composite_id: SKLEP_WORLD_IDS.composition,
        status: 'completed',
        run_manifest_state: 'captured',
      });
      expect(execution.run_manifest.workload).toEqual({
        kind: 'adr005',
        value: { type: 'ramp_concurrency', vusers: 2000, ramp: 600 },
      });
      expect(execution.run_manifest.target_environment_id).toBe(SKLEP_WORLD_IDS.environments.perf);
      expect(execution.run_manifest.target_environment_name).toBe('perf');
      expect(store.collection(NAMES.compositions).get(execution.composite_id ?? '')).toBeDefined();
    });

    it('the manifest records the mix and the members of the composition', () => {
      const composition = all<SklepComposition>(store, NAMES.compositions)[0];
      expect(execution.run_manifest.proportions.source).toBe('composition_links');
      expect(execution.run_manifest.proportions.weights).toEqual(
        composition?.scenarios.map((link) => ({
          scenario_id: link.scenario_id,
          variant_label: '',
          proportion: link.proportion,
        })),
      );
      expect(execution.run_manifest.members.map((m) => m.scenario_id)).toEqual(
        composition?.scenarios.map((link) => link.scenario_id),
      );
      expect(execution.run_manifest.feeders.find((f) => f.slot === 'accounts')?.demand_values).toBe(
        1200,
      );
    });

    it('the SLA verdict is FAILED on p95 1 120 ms > 400 ms, errors 0.6% < 1% passed', () => {
      const verdict = execution.sla_verdict;
      expect(verdict).toMatchObject({
        status: 'failed',
        gatling_exit_code: 2,
        gatling_disagrees: false,
      });
      expect(execution.run_exit_code).toBe(2);
      const [p95, errors] = verdict?.assertions ?? [];
      expect(p95).toMatchObject({ actual: 1120, threshold: [400], passed: false, unit: 'ms' });
      expect(p95?.metric).toMatchObject({
        kind: 'response_time',
        stat: 'percentile',
        percentile: 95,
      });
      expect(errors).toMatchObject({ actual: 0.6, threshold: [1], passed: true, unit: 'percent' });
      expect(errors?.metric).toMatchObject({ kind: 'request_percentage', requests: 'failed' });
    });

    it('the run row carries the counts and the measured window', () => {
      expect(execution).toMatchObject({
        total_requests: 412_300,
        ko_count: 2480,
        ok_count: 412_300 - 2480,
        result_has_errors: true,
        load_window_state: 'measured',
        duration_seconds: 597.5,
      });
    });

    it('measured 412 300 requests, p95 1 120 ms and 2 480 × 504', () => {
      expect(result.total_requests).toBe(412_300);
      expect(result.ko_count).toBe(2480);
      expect(result.ok_count).toBe(412_300 - 2480);
      expect(result.p50).toBe(180);
      expect(result.p95).toBe(1120);
      expect(result.p99).toBe(2900);
      expect(Math.round(result.requests_per_second)).toBe(690);
      expect(Math.round(result.total_requests / result.duration_seconds)).toBe(690);
      expect(result.error_rate).toBeCloseTo(2480 / 412_300, 8); // a fraction: 0.6%
      expect(result.error_summary).toEqual([{ message: '504 Gateway Timeout', count: 2480 }]);
      expect(result.min_source).toBe('gatling-report');
      expect(result.max_source).toBe('gatling-report');
    });

    it('breaks the p95 down per request, slowest on POST /checkout', () => {
      const p95 = Object.fromEntries(
        result.per_request.map((r) => [r.request_name, r.p95_histogram]),
      );
      expect(p95).toEqual({
        'POST /checkout': 1840,
        'POST /cart/items': 620,
        'GET /products': 290,
        'GET /categories': 110,
        'POST /auth/login': 140,
        'GET /orders': 210,
      });
    });

    it('per-request counts add up to the totals, all errors on POST /checkout', () => {
      const sum = (key: 'total_requests' | 'ok_requests' | 'ko_requests'): number =>
        result.per_request.reduce((total, r) => total + r[key], 0);
      expect(sum('total_requests')).toBe(result.total_requests);
      expect(sum('ko_requests')).toBe(result.ko_count);
      expect(sum('ok_requests')).toBe(result.ok_count);
      const failing = result.per_request.filter((r) => r.ko_requests > 0);
      expect(failing.map((r) => r.request_name)).toEqual(['POST /checkout']);
      for (const r of result.per_request) {
        expect(r.ok_requests + r.ko_requests).toBe(r.total_requests);
      }
    });

    it('endpoint rows repeat the per-request counts and name the 504s', () => {
      expect(result.endpoints.map((e) => [e.name, e.count, e.ko_count])).toEqual(
        result.per_request.map((r) => [r.request_name, r.total_requests, r.ko_requests]),
      );
      const checkout = result.endpoints.find((e) => e.name === 'POST /checkout');
      expect(checkout?.http_status_counts['504']).toBe(2480);
      expect(checkout?.p95_histogram).toBe(1840);
      expect(result.errors.map((e) => [e.error_hash, e.count, e.affected_endpoints])).toEqual([
        ['http-504', 2480, ['POST /checkout']],
      ]);
    });

    it('the time series spans the ramp: p95 over 400 ms from T+6:10', () => {
      const series = result.time_series_data;
      expect(series[0]?.elapsed_seconds).toBe(0);
      expect(series.at(-1)?.elapsed_seconds).toBe(595);
      const firstOver = series.find((point) => point.p95_histogram > 400);
      expect(firstOver?.elapsed_seconds).toBe(370);
    });

    it('requests belong to operations of the spec', () => {
      const known = new Set(
        all<SklepEndpoint>(store, NAMES.endpoints).map((e) => `${e.method} ${e.path}`),
      );
      for (const r of result.per_request) expect(known.has(r.request_name)).toBe(true);
    });

    it('has the AI analysis of step 08', () => {
      const analyses = all<SklepExecutionAnalysis>(store, NAMES.analyses);
      expect(analyses).toHaveLength(1);
      const [analysis] = analyses;
      expect(analysis?.execution_id).toBe(SKLEP_IDS.executionPerf);
      expect(analysis?.verdict).toBe('fail');
      expect(analysis?.analysis.confidence).toBe('high');
      expect(analysis?.analysis.error_analyses[0]).toMatchObject({
        error_hash: 'http-504',
        http_status: 504,
        evidence: ['Lock wait timeout exceeded; try restarting transaction'],
        evidence_sources: ['mcp:logs_summary'],
      });
      expect(analysis?.analysis.latency_steps?.[0]).toMatchObject({
        endpoint: 'POST /checkout',
        window_start_offset: 'T+6:10',
        before_ms: 240,
        during_ms: 1310,
      });
      expect(analysis?.analysis.recommendations).toEqual([
        'zapis zamówienia poza transakcją płatności',
      ]);
    });

    it('the evidence of the analysis comes from the log source of the project', () => {
      const [analysis] = all<SklepExecutionAnalysis>(store, NAMES.analyses);
      const [source] = all<SklepTelemetrySource>(store, NAMES.telemetry);
      const bundle = analysis?.analysis.external_evidence;
      expect(bundle?.source).toEqual({ kind: 'mcp', label: source?.label, url: source?.url });
      expect(source?.enabled_tools).toContain(bundle?.calls[0]?.['tool']);
      expect(String(bundle?.calls[0]?.['content'])).toContain(
        analysis?.analysis.error_analyses[0]?.evidence[0] ?? '?',
      );
    });

    it('the error group of the analysis exists in the result', () => {
      expect(result.errors.map((e) => e.error_hash)).toContain('http-504');
    });
  });

  describe('shapes of the contract snapshot', () => {
    const contract = loadContract();
    const store = seeded('executed');

    it('project, environments, spec, telemetry and flows pass the contract check', () => {
      const project = all<ProjectDetail>(store, NAMES.projects)[0];
      const envs = all<EnvironmentResponse>(store, NAMES.environments);
      const flows = all<FlowDetail>(store, NAMES.flows);
      const specs = all<OpenAPISpecSummary>(store, NAMES.specs);
      const endpoints = all<SklepEndpoint>(store, NAMES.endpoints);
      const telemetry = all<SklepTelemetrySource>(store, NAMES.telemetry)[0];
      const validators = all<ValidatorResponse>(store, NAMES.validators);
      const testTypes = all<TestTypeResponse>(store, NAMES.testTypes);

      const checks: [string, string, unknown][] = [
        ['GET', '/api/v1/projects/{project_id}', project],
        ['GET', '/api/v1/projects/{project_id}/environments', { items: envs, total: envs.length }],
        ['GET', '/api/v1/projects/{project_id}/environments/{environment_id}', envs[0]],
        ...flows.map((flow): [string, string, unknown] => [
          'GET',
          '/api/v1/projects/{project_id}/flows/{flow_id}',
          flow,
        ]),
        [
          'GET',
          '/api/v1/projects/{project_id}/openapi-specs',
          { specs, total: specs.length, current_spec_id: specs[0]?.id ?? null },
        ],
        [
          'GET',
          '/api/v1/openapi-specs/{spec_id}/endpoints',
          {
            endpoints: endpoints.map((endpoint) => without(endpoint, 'spec_id')),
            total: endpoints.length,
          },
        ],
        [
          'GET',
          '/api/v1/projects/{project_id}/validators',
          { items: validators, total: validators.length },
        ],
        [
          'GET',
          '/api/v1/projects/{project_id}/test-types',
          { items: testTypes, total: testTypes.length },
        ],
        [
          'GET',
          '/api/v1/projects/{project_id}/telemetry-source',
          { telemetry_source: telemetry === undefined ? null : without(telemetry, 'id') },
        ],
      ];
      for (const [method, path, body] of checks) {
        expect(contract.operation(method, path).check(200, body), `${method} ${path}`).toEqual([]);
      }
    });
  });
});

/**
 * Key sets of the Gatling documents, copied from the backend (the backend's own response builders).
 * The snapshot leaves these responses untyped, so nothing else keeps the world in the shape of the
 * real answers: when a builder gains or loses a key, change the list AND the world together.
 */
const BACKEND_KEYS = {
  // `list_executions`, `get_execution` (adds `logs`)
  execution: [
    'id',
    'scenario_id',
    'composite_id',
    'configuration_id',
    'status',
    'supervised',
    'started_at',
    'completed_at',
    'duration_seconds',
    'load_window_state',
    'run_exit_code',
    'sla_verdict',
    'invariant_summary',
    'error_message',
    'has_result',
    'result_has_errors',
    'total_requests',
    'ok_count',
    'ko_count',
    'created_at',
    'source',
    'saved_run_id',
    'saved_run_name',
    'warnings',
    'run_manifest_state',
    'run_manifest',
    'logs',
  ],
  // `_run_manifest_payload`
  runManifest: [
    'workload',
    'proportions',
    'target_base_url',
    'target_environment_id',
    'target_environment_name',
    'members',
    'feeders',
  ],
  // `FeederManifestEntry.to_json`
  feederManifestEntry: [
    'slot',
    'source_kind',
    'feeder_id',
    'dataset_name',
    'content_hash',
    'resolution_state',
    'resolution_state_unavailable',
    'comparable',
    'demand_values',
    'binding_source',
  ],
  // `RunManifestMember.to_json`
  manifestMember: ['scenario_id', 'variant_label', 'scenario_version', 'artifact_digest_at_run'],
  // `SlaVerdictV1.to_json`
  slaVerdict: [
    'format_version',
    'source',
    'status',
    'reason',
    'detail',
    'shards',
    'window_s',
    'semantics',
    'assertions',
    'gatling_exit_code',
    'gatling_status',
    'gatling_disagrees',
    'warnings',
  ],
  // `AssertionOutcome.to_json`
  assertion: [
    'subject',
    'metric',
    'unit',
    'condition',
    'threshold',
    'inclusive',
    'actual',
    'passed',
    'samples',
    'reason',
    'subject_label',
    'target_label',
    'condition_label',
    'threshold_label',
    'message',
  ],
  // `_scenario_detail_payload`
  scenario: [
    'id',
    'name',
    'description',
    'simulation_class_name',
    'source_flow_id',
    'source_flow_version',
    'truncate_after_block_id',
    'flow_overlay_version',
    'current_version',
    'artifact_version',
    'scenario_artifact',
    'feeder_slots',
    'sensitive_headers_missing_registration',
    'auth_credentials_without_consumer',
    'slot_bindings',
    'slot_binding_states',
    'assertion_thresholds',
    'project_assertion_thresholds',
    'assertion_threshold_view',
    'scenario_contract_v2',
    'self_check',
    'generator_state',
    'session_seconds',
    'session_seconds_kind',
    'pause_source_mix',
    'requests_per_session',
    'is_active',
    'tags',
    'created_at',
    'updated_at',
  ],
  // `SelfCheckState`, model_dump
  selfCheck: [
    'status',
    'scenario_version',
    'execution_ids',
    'failure',
    'notes',
    'missing_slots',
    'repairs',
    'max_repair_rounds',
    'runs',
    'started_at',
    'finished_at',
  ],
  // `_derive_feeder_slots` + `_detail_feeder_slots`
  slot: [
    'slot',
    'label',
    'columns',
    'strategy',
    'column_specs',
    'identity_kind',
    'default_file',
    'role',
    'generated',
    'generated_rows',
  ],
  // `PauseSourceMix`
  pauseSources: ['recording', 'default_human', 'manual', 'machine_wait', 'unknown'],
  // `_format_composition`
  composition: [
    'id',
    'name',
    'description',
    'project_id',
    'injection_config',
    'global_headers',
    'global_think_time_ms',
    'protocol_config',
    'throttle_steps',
    'pause_distribution',
    'normal_pause_std_dev_percent',
    'status',
    'composition_mode',
    'sequence_config',
    'test_type_spec',
    'assertion_inference',
    'slot_bindings',
    'slot_binding_states',
    'created_at',
    'updated_at',
    'validation',
    'scenarios',
  ],
  // link of `_format_composition`
  compositionLink: [
    'link_id',
    'scenario_id',
    'scenario_name',
    'simulation_class_name',
    'variant_label',
    'proportion',
    'order_index',
    'injection_override',
    'load_profile',
    'feeder_bindings',
    'think_time_ms',
    'enabled',
    'contract',
    'scenario_artifact',
    'scenario_contract_v2',
    'scenario_version',
    'scenario_created_at',
    'artifact_digest',
    'live_digest',
    'has_drift',
    'drift_fields',
    'pinned_version',
    'current_version',
  ],
  // validation block
  compositionValidation: [
    'is_valid',
    'authoring_valid',
    'errors',
    'warnings',
    'error_details',
    'warning_details',
    'issue_details',
    'scenario_count',
    'total_proportion',
    'last_validated_at',
    'validated_against_digest',
    'effective_status',
    'has_drift',
    'drifted_members',
    'missing_bound_feeders',
  ],
  // `_serialize_feeder_model`, list shape: no `recipe`
  feeder: [
    'id',
    'gatling_project_id',
    'name',
    'description',
    'feeder_type',
    'strategy',
    'file_name',
    'content',
    'record_count',
    'columns',
    'separator',
    'transform_expression',
    'feed_records_count',
    'feed_records_count_expression',
    'dsl',
    'jdbc_config',
    'redis_config',
    'feeder_options',
    'consumption',
    'column_semantics',
    'has_recipe',
    'recipe_summary',
    'content_hash',
    'manually_edited',
    'created_by',
    'auto_linked_scenario_id',
    'provenance',
    'audit_metadata',
    'created_at',
    'updated_at',
  ],
  // the result row (`result_row_aggregate_fields`, `result_row_latency_fields`) over
  // `get_full_results`;
  // `id` is the record key (the execution id), not a key of the document
  result: [
    'aggregates_source',
    'total_requests',
    'ok_requests',
    'ko_requests',
    'ok_count',
    'ko_count',
    'error_rate',
    'mean_response_time',
    'min_response_time',
    'max_response_time',
    'min_source',
    'max_source',
    'p50',
    'p75',
    'p90',
    'p95',
    'p99',
    'percentile_source',
    'requests_per_second',
    'throughput',
    'duration_seconds',
    'error_summary',
    'series_source',
    'series_retention',
    'p50_histogram',
    'p75_histogram',
    'p90_histogram',
    'p95_histogram',
    'p99_histogram',
    'per_request',
    'endpoints',
    'errors',
    'error_traces',
    'time_series_data',
  ],
  // `_query_per_request`
  perRequest: [
    'request_name',
    'total_requests',
    'ok_requests',
    'ko_requests',
    'error_rate',
    'p50_histogram',
    'p95_histogram',
    'p99_histogram',
  ],
  // `get_endpoints_summary`
  endpointRow: [
    'name',
    'group',
    'count',
    'ok_count',
    'ko_count',
    'mean_response_time',
    'min_response_time',
    'max_response_time',
    'min_source',
    'max_source',
    'p50_histogram',
    'p75_histogram',
    'p90_histogram',
    'p95_histogram',
    'p99_histogram',
    'rps',
    'error_count',
    'error_rate',
    'http_status_counts',
  ],
  // `get_errors`: error group from Prometheus
  errorGroup: [
    'error_hash',
    'message',
    'http_status',
    'ko_limb',
    'source',
    'in_ko_count',
    'count',
    'affected_endpoints',
    'first_seen',
    'last_seen',
    'percentage',
  ],
  // `get_global_time_series`
  timePoint: [
    'elapsed_seconds',
    'requests_per_second',
    'ok_per_second',
    'ko_per_second',
    'mean_response_time',
    'p50_histogram',
    'p95_histogram',
    'p99_histogram',
    'max_response_time',
  ],
  // GET …/analysis
  analysis: [
    'id',
    'execution_id',
    'verdict',
    'summary',
    'analysis',
    'model',
    'input_tokens',
    'output_tokens',
    'cost_usd',
    'duration_ms',
    'initiated_by',
    'generated_at',
  ],
  // `collect_external_evidence`
  externalEvidence: ['source', 'window', 'calls', 'skipped', 'error'],
} as const;

function keysOf(value: object): string[] {
  return Object.keys(value).sort();
}

function sorted(keys: readonly string[]): string[] {
  return [...keys].sort();
}

describe('sklep world: key sets of the backend documents', () => {
  const store = seeded('executed');
  const scenarios = all<SklepScenario>(store, NAMES.scenarios);
  const [composition] = all<SklepComposition>(store, NAMES.compositions);
  const executions = all<SklepExecution>(store, NAMES.executions);
  const results = all<SklepExecutionResult>(store, NAMES.results);
  const loadResult = store
    .collection<SklepExecutionResult>(NAMES.results)
    .require(SKLEP_IDS.executionPerf);
  const [analysis] = all<SklepExecutionAnalysis>(store, NAMES.analyses);

  it('runs (self-checks and the load test)', () => {
    expect(executions).toHaveLength(4);
    for (const run of executions) {
      expect(keysOf(run), run.id).toEqual(sorted(BACKEND_KEYS.execution));
      expect(keysOf(run.run_manifest)).toEqual(sorted(BACKEND_KEYS.runManifest));
      for (const member of run.run_manifest.members) {
        expect(keysOf(member)).toEqual(sorted(BACKEND_KEYS.manifestMember));
      }
      for (const entry of run.run_manifest.feeders) {
        expect(keysOf(entry)).toEqual(sorted(BACKEND_KEYS.feederManifestEntry));
      }
    }
  });

  it('the SLA verdict and its assertions', () => {
    const verdict = executions.find((run) => run.id === SKLEP_IDS.executionPerf)?.sla_verdict;
    expect(keysOf(verdict ?? {})).toEqual(sorted(BACKEND_KEYS.slaVerdict));
    for (const assertion of verdict?.assertions ?? []) {
      expect(keysOf(assertion)).toEqual(sorted(BACKEND_KEYS.assertion));
    }
  });

  it('scenarios, their self-checks and slots', () => {
    for (const scenario of scenarios) {
      expect(keysOf(scenario), scenario.name).toEqual(sorted(BACKEND_KEYS.scenario));
      expect(keysOf(scenario.self_check ?? {})).toEqual(sorted(BACKEND_KEYS.selfCheck));
      expect(keysOf(scenario.scenario_artifact.generation_metadata.self_check ?? {})).toEqual(
        sorted(BACKEND_KEYS.selfCheck),
      );
      expect(keysOf(scenario.pause_source_mix)).toEqual(sorted(BACKEND_KEYS.pauseSources));
      for (const slot of scenario.feeder_slots) {
        expect(keysOf(slot)).toEqual(sorted(BACKEND_KEYS.slot));
      }
    }
  });

  it('the composition, its validation and its links', () => {
    expect(keysOf(composition ?? {})).toEqual(sorted(BACKEND_KEYS.composition));
    expect(keysOf(composition?.validation ?? {})).toEqual(
      sorted(BACKEND_KEYS.compositionValidation),
    );
    for (const link of composition?.scenarios ?? []) {
      expect(keysOf(link)).toEqual(sorted(BACKEND_KEYS.compositionLink));
    }
  });

  it('datasets', () => {
    const data = seeded('data');
    for (const feeder of all<SklepFeeder>(data, NAMES.feeders)) {
      expect(keysOf(feeder), feeder.name).toEqual(sorted(BACKEND_KEYS.feeder));
    }
  });

  it('results and the rows inside them', () => {
    for (const result of results) {
      expect(
        keysOf(result).filter((key) => key !== 'id'),
        result.id,
      ).toEqual(sorted(BACKEND_KEYS.result));
      for (const row of result.per_request)
        expect(keysOf(row)).toEqual(sorted(BACKEND_KEYS.perRequest));
      for (const row of result.endpoints)
        expect(keysOf(row)).toEqual(sorted(BACKEND_KEYS.endpointRow));
      for (const group of result.errors)
        expect(keysOf(group)).toEqual(sorted(BACKEND_KEYS.errorGroup));
    }
    for (const point of loadResult.time_series_data) {
      expect(keysOf(point)).toEqual(sorted(BACKEND_KEYS.timePoint));
    }
  });

  it('the stored analysis and the evidence bundle', () => {
    expect(keysOf(analysis ?? {})).toEqual(sorted(BACKEND_KEYS.analysis));
    expect(keysOf(analysis?.analysis.external_evidence ?? {})).toEqual(
      sorted(BACKEND_KEYS.externalEvidence),
    );
  });
});

function without(record: object, key: string): unknown {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}
