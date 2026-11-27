// Read routes of the module functional (src/tools/functional/) that no other set answers: one test
// type and the expected-outcome candidates of a project. The list of the project's test types is
// `registerTestTypeRoutes` (routes/scenarios.ts); the records are those of the sklep world. Each route
// reads its own collection, filled by a seeding function of this file; an error a test wants is seeded
// as `{ error: { status, detail } }`. Registration is idempotent per fake.

import type { components } from '../../../src/http/generated/api.js';
import type { Fake, Store } from '../server.js';
import { FakeHttpError } from '../server.js';
import { SKLEP_COLLECTIONS } from '../worlds/sklep.js';
import { registerTestTypeRoutes } from './scenarios.js';

const registered = new WeakSet<Fake>();

export type TestTypeBody = components['schemas']['TestTypeResponse'];
export type ValidatorBody = components['schemas']['ValidatorResponse'];
export type ApplicableBody = components['schemas']['ApplicableValidatorsResponse'];
export type EnforcementBody = components['schemas']['GatlingEnforcementResponse'];
export type FlowDetailBody = components['schemas']['TestFlowDetail'];
export type FlowVersionBody = components['schemas']['TestFlowVersionSummary'];
export type TemplateDetailBody = components['schemas']['TestTemplateDetail'];
export type RunDetailBody = components['schemas']['ExecutionDetail'];
export type FlowResultBody = components['schemas']['FlowResultDetail'];
export type ApiLogBody = components['schemas']['ApiLogEntry'];
export type CompareBody = components['schemas']['FunctionalCompareResponse'];
export type DashboardBody = components['schemas']['ValidationAnalyticsDashboard'];
export type FailurePatternBody = components['schemas']['FailurePattern'];
export type FlakyBody = components['schemas']['FlakyValidatorReport'];
export type AccuracyBody = components['schemas']['ValidatorAccuracyReport'];
export type TrendBody = components['schemas']['ValidatorTrend'];
export type ThresholdBody = components['schemas']['ThresholdSuggestion'];
export type BaseTestTypeBody = components['schemas']['BaseTestTypeResponse'];
export type BaseValidatorBody = components['schemas']['BaseValidatorResponse'];
export type AssertionTypeBody = components['schemas']['AssertionTypeDetail'];
export type OutcomeCandidatesBody = components['schemas']['ExpectedOutcomeCandidatesResponse'];

/** An error answer a test seeds in place of a body. */
export interface SeededError {
  readonly error: { readonly status: number; readonly detail: unknown };
}
export type Seeded<T> = T | SeededError;

export const FUNCTIONAL_MODULE_COLLECTION = 'functional_module_reads';

interface Stored {
  readonly id: string;
  readonly value: unknown;
}

export function put(store: Store, key: string, value: unknown): void {
  const records = store.collection<Stored>(FUNCTIONAL_MODULE_COLLECTION);
  records.delete(key);
  records.insert({ id: key, value });
}

export function read<T>(store: Store, key: string): T | undefined {
  return store.collection<Stored>(FUNCTIONAL_MODULE_COLLECTION).get(key)?.value as T | undefined;
}

export function isSeededError(value: unknown): value is SeededError {
  return typeof value === 'object' && value !== null && 'error' in value;
}

export function answered<T>(value: Seeded<T>): T {
  if (isSeededError(value)) {
    throw new FakeHttpError(value.error.status, { detail: value.error.detail });
  }
  return value;
}

export function requireProject(store: Store, id: string): void {
  store.collection(SKLEP_COLLECTIONS.projects).require(id, `Project not found: ${id}`);
}

/** The values that count as success, as the backend names them. */
export function seedOutcomeCandidates(store: Store, body: Seeded<OutcomeCandidatesBody>): void {
  put(store, 'outcomes', body);
}

/** The catalog validators that fit the project, grouped as the backend groups them. */
export function seedApplicable(store: Store, body: Seeded<ApplicableBody>): void {
  put(store, 'applicable', body);
}

/** How strictly a load run enforces the validators of each kind. */
export function seedEnforcement(store: Store, body: Seeded<EnforcementBody>): void {
  put(store, 'enforcement', body);
}

/** The functional test flows of the backend (the list holds their summaries). */
export function seedFlows(store: Store, flows: Seeded<readonly FlowDetailBody[]>): void {
  put(store, 'flows', flows);
}

/** The stored versions of one flow, newest first. */
export function seedFlowVersions(
  store: Store,
  flowId: string,
  versions: Seeded<readonly FlowVersionBody[]>,
): void {
  put(store, `flow-versions:${flowId}`, versions);
}

/** The functional test templates of the backend (the list holds their summaries). */
export function seedTemplates(
  store: Store,
  templates: Seeded<readonly TemplateDetailBody[]>,
): void {
  put(store, 'templates', templates);
}

/** The functional runs of the project (the list holds their summaries). */
export function seedFunctionalRuns(store: Store, runs: Seeded<readonly RunDetailBody[]>): void {
  put(store, 'runs', runs);
}

/**
 * The page of functional runs `GET …/executions` answers (also the one of a run template), with the
 * filters the backend has: status, type, limit, offset. Used by routes/deletion.ts, which answers the
 * same path for the tools that delete.
 */
export function functionalRunPage(
  store: Store,
  query: Readonly<Record<string, string | undefined>>,
  template?: string,
): { executions: Record<string, unknown>[]; total: number } {
  const runs = answered(read<Seeded<readonly RunDetailBody[]>>(store, 'runs') ?? []);
  const matching = runs
    .filter((run) => template === undefined || run.template_id === template)
    .filter((run) => query['status'] === undefined || run.status === query['status'])
    .filter(
      (run) =>
        query['execution_type'] === undefined || run.execution_type === query['execution_type'],
    );
  const offset = Number(query['offset'] ?? 0);
  const limit = Number(query['limit'] ?? 20);
  const executions = matching.slice(offset, offset + limit).map((run) => {
    const summary: Record<string, unknown> = { ...run };
    for (const key of [
      'config_snapshot',
      'flow_versions',
      'runtime_params',
      'error_message',
      'langgraph_thread_id',
      'environment_name',
    ]) {
      delete summary[key];
    }
    return summary;
  });
  return { executions, total: matching.length };
}

/** The flow results of one functional run (each with its block results and validations). */
export function seedFlowResults(
  store: Store,
  runId: string,
  results: Seeded<readonly FlowResultBody[]>,
): void {
  put(store, `flow-results:${runId}`, results);
}

/** The captured HTTP log of one functional run. */
export function seedApiLogs(
  store: Store,
  runId: string,
  logs: Seeded<readonly ApiLogBody[]>,
): void {
  put(store, `api-logs:${runId}`, logs);
}

/** What the comparison of two functional runs answers (the runs must exist: a, then b). */
export function seedFunctionalCompare(store: Store, body: Seeded<CompareBody>): void {
  put(store, 'compare', body);
}

/** The analytics of the validators; the per-validator views are keyed by the validator id. */
export const seedAnalytics = {
  dashboard: (store: Store, body: Seeded<DashboardBody>): void => put(store, 'an-dashboard', body),
  patterns: (store: Store, body: Seeded<readonly FailurePatternBody[]>): void =>
    put(store, 'an-patterns', body),
  flaky: (store: Store, body: Seeded<readonly FlakyBody[]>): void => put(store, 'an-flaky', body),
  accuracy: (store: Store, validatorId: string, body: Seeded<AccuracyBody>): void =>
    put(store, `an-accuracy:${validatorId}`, body),
  trend: (store: Store, validatorId: string, body: Seeded<TrendBody>): void =>
    put(store, `an-trend:${validatorId}`, body),
  threshold: (store: Store, validatorId: string, body: Seeded<ThresholdBody>): void =>
    put(store, `an-threshold:${validatorId}`, body),
};

/** The global catalogs: base test types, base validators and assertion types. */
export const seedCatalog = {
  testTypes: (store: Store, items: Seeded<readonly BaseTestTypeBody[]>): void =>
    put(store, 'cat-test-types', items),
  validators: (store: Store, items: Seeded<readonly BaseValidatorBody[]>): void =>
    put(store, 'cat-validators', items),
  assertionTypes: (store: Store, items: Seeded<readonly AssertionTypeBody[]>): void =>
    put(store, 'cat-assertion-types', items),
};

export function registerFunctionalModuleRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  registerTestTypeRoutes(fake);

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/test-types/expected-outcome-candidates',
    (req, store) => {
      requireProject(store, req.params.project_id);
      const body = answered(
        read<Seeded<OutcomeCandidatesBody>>(store, 'outcomes') ?? {
          candidates: [],
          status_field: null,
        },
      );
      return { status: 200, body };
    },
  );

  fake.route('GET', '/api/v1/projects/{project_id}/test-types/{test_type_id}', (req, store) => {
    requireProject(store, req.params.project_id);
    const found = store
      .collection<TestTypeBody>(SKLEP_COLLECTIONS.testTypes)
      .get(req.params.test_type_id);
    if (found === undefined) throw new FakeHttpError(404, { detail: 'Test type not found' });
    if (found.project_id !== req.params.project_id) {
      throw new FakeHttpError(400, { detail: 'Test type belongs to another project' });
    }
    return { status: 200, body: { ...found } };
  });

  fake.route('GET', '/api/v1/projects/{project_id}/validators', (req, store) => {
    requireProject(store, req.params.project_id);
    const enabled = req.query['is_enabled'];
    const items = store
      .collection<ValidatorBody>(SKLEP_COLLECTIONS.validators)
      .list(
        (item) =>
          item.project_id === req.params.project_id &&
          (enabled === undefined || String(item.is_enabled) === enabled),
      );
    return { status: 200, body: { items, total: items.length } };
  });

  fake.route('GET', '/api/v1/projects/{project_id}/validators/applicable', (req, store) => {
    requireProject(store, req.params.project_id);
    const body = answered(
      read<Seeded<ApplicableBody>>(store, 'applicable') ?? {
        applicable_total: 0,
        groups: {},
        total: 0,
      },
    );
    return { status: 200, body };
  });

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/validators/gatling-enforcement',
    (req, store) => {
      requireProject(store, req.params.project_id);
      const body = answered(
        read<Seeded<EnforcementBody>>(store, 'enforcement') ?? {
          default_level: 'warn',
          levels: {},
        },
      );
      return { status: 200, body };
    },
  );

  fake.route('GET', '/api/v1/projects/{project_id}/validators/{validator_id}', (req, store) => {
    requireProject(store, req.params.project_id);
    const found = store
      .collection<ValidatorBody>(SKLEP_COLLECTIONS.validators)
      .get(req.params.validator_id);
    if (found === undefined) throw new FakeHttpError(404, { detail: 'Validator not found' });
    if (found.project_id !== req.params.project_id) {
      throw new FakeHttpError(400, { detail: 'Validator belongs to another project' });
    }
    return { status: 200, body: { ...found } };
  });

  const flows = (store: Store): readonly FlowDetailBody[] =>
    answered(read<Seeded<readonly FlowDetailBody[]>>(store, 'flows') ?? []);

  fake.route('GET', '/api/v1/test-flows', (req, store) => {
    const spec = req.query['spec_id'];
    const limit = Number(req.query['limit'] ?? 50);
    const items = flows(store)
      .filter((flow) => spec === undefined || flow.openapi_spec_id === spec)
      .slice(0, limit)
      .map((flow) => {
        const summary: Record<string, unknown> = { ...flow };
        delete summary['blocks'];
        delete summary['edges'];
        return summary as Omit<FlowDetailBody, 'blocks' | 'edges'>;
      });
    return { status: 200, body: items };
  });

  fake.route('GET', '/api/v1/test-flows/{flow_id}/versions', (req, store) => {
    const found = flows(store).find((flow) => flow.id === req.params.flow_id);
    if (found === undefined) throw new FakeHttpError(404, { detail: 'Test flow not found' });
    const versions = answered(
      read<Seeded<readonly FlowVersionBody[]>>(store, `flow-versions:${found.id}`) ?? [],
    );
    return { status: 200, body: [...versions] };
  });

  fake.route('GET', '/api/v1/test-flows/{flow_id}', (req, store) => {
    const found = flows(store).find((flow) => flow.id === req.params.flow_id);
    if (found === undefined) throw new FakeHttpError(404, { detail: 'Test flow not found' });
    return { status: 200, body: { ...found } };
  });

  const templates = (store: Store): readonly TemplateDetailBody[] =>
    answered(read<Seeded<readonly TemplateDetailBody[]>>(store, 'templates') ?? []);

  fake.route('GET', '/api/v1/test-templates', (req, store) => {
    const spec = req.query['spec_id'];
    const wanted = (req.query['tags'] ?? '').split(',').filter((tag) => tag !== '');
    const limit = Number(req.query['limit'] ?? 50);
    const items = templates(store)
      .filter((template) => spec === undefined || template.openapi_spec_id === spec)
      .filter((template) => wanted.every((tag) => (template.tags ?? []).includes(tag)))
      .slice(0, limit)
      .map((template) => {
        const summary: Record<string, unknown> = { ...template };
        for (const key of ['flow_definition', 'assertions', 'runtime_parameters', 'endpoint_ids']) {
          delete summary[key];
        }
        return summary as Omit<
          TemplateDetailBody,
          'flow_definition' | 'assertions' | 'runtime_parameters' | 'endpoint_ids'
        >;
      });
    return { status: 200, body: items };
  });

  fake.route('GET', '/api/v1/test-templates/{template_id}', (req, store) => {
    const found = templates(store).find((template) => template.id === req.params.template_id);
    if (found === undefined) throw new FakeHttpError(404, { detail: 'Test template not found' });
    return { status: 200, body: { ...found } };
  });

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/executions/run-templates/{template_id}/executions',
    (req, store) => {
      requireProject(store, req.params.project_id);
      return {
        status: 200,
        body: functionalRunPage(store, req.query, req.params.template_id) as never,
      };
    },
  );

  fake.route('GET', '/api/v1/projects/{project_id}/executions/{execution_id}', (req, store) => {
    requireProject(store, req.params.project_id);
    const runs = answered(read<Seeded<readonly RunDetailBody[]>>(store, 'runs') ?? []);
    const found = runs.find((run) => run.id === req.params.execution_id);
    if (found === undefined) throw new FakeHttpError(404, { detail: 'Execution not found' });
    return { status: 200, body: { ...found } };
  });

  const requireRun = (store: Store, projectId: string, runId: string): RunDetailBody => {
    requireProject(store, projectId);
    const runs = answered(read<Seeded<readonly RunDetailBody[]>>(store, 'runs') ?? []);
    const found = runs.find((run) => run.id === runId);
    if (found === undefined) throw new FakeHttpError(404, { detail: 'Execution not found' });
    return found;
  };
  const resultsOf = (store: Store, runId: string): readonly FlowResultBody[] =>
    answered(read<Seeded<readonly FlowResultBody[]>>(store, `flow-results:${runId}`) ?? []);

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/executions/{execution_id}/with-results',
    (req, store) => {
      const run = requireRun(store, req.params.project_id, req.params.execution_id);
      const flow_results = resultsOf(store, run.id).map((result) => ({
        id: result.id,
        flow_id: result.flow_id,
        flow_version: result.flow_version,
        test_type_id: result.test_type_id,
        test_type_name: result.test_type_name,
        status: result.status,
        duration_ms: result.duration_ms,
        error_message: result.error_message,
        total_validations: result.total_validations,
        passed_validations: result.passed_validations,
        failed_validations: result.failed_validations,
      }));
      return { status: 200, body: { ...run, flow_results } };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/executions/{execution_id}/results/{result_id}',
    (req, store) => {
      const run = requireRun(store, req.params.project_id, req.params.execution_id);
      const found = resultsOf(store, run.id).find((result) => result.id === req.params.result_id);
      if (found === undefined) throw new FakeHttpError(404, { detail: 'Flow result not found' });
      return { status: 200, body: { ...found } };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/executions/{execution_id}/results',
    (req, store) => {
      const run = requireRun(store, req.params.project_id, req.params.execution_id);
      const results = resultsOf(store, run.id);
      return { status: 200, body: { results: [...results], total: results.length } };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/executions/{execution_id}/api-logs',
    (req, store) => {
      const run = requireRun(store, req.params.project_id, req.params.execution_id);
      const type = req.query['log_type'];
      const logs = answered(read<Seeded<readonly ApiLogBody[]>>(store, `api-logs:${run.id}`) ?? []);
      const shown = logs.filter((entry) => type === undefined || entry.log_type === type);
      return { status: 200, body: { execution_id: run.id, logs: [...shown], total: shown.length } };
    },
  );

  fake.route('GET', '/api/v1/projects/{project_id}/executions/compare', (req, store) => {
    requireProject(store, req.params.project_id);
    const runs = answered(read<Seeded<readonly RunDetailBody[]>>(store, 'runs') ?? []);
    for (const id of [req.query['a'], req.query['b']]) {
      if (!runs.some((run) => run.id === id)) {
        throw new FakeHttpError(404, { detail: `Execution not found: ${String(id)}` });
      }
    }
    const body = answered(
      read<Seeded<CompareBody>>(store, 'compare') ?? {
        execution_a_id: String(req.query['a']),
        execution_b_id: String(req.query['b']),
        same_flow_versions: true,
        blocks: [],
      },
    );
    return { status: 200, body };
  });

  const analytics = '/api/v1/projects/{project_id}/analytics/validators';
  const seeded = <T>(store: Store, key: string): T => {
    const found = read<Seeded<T>>(store, key);
    if (found === undefined) throw new FakeHttpError(404, { detail: 'Nothing measured' });
    return answered(found);
  };

  fake.route('GET', `${analytics}/dashboard`, (req, store) => {
    requireProject(store, req.params.project_id);
    return { status: 200, body: seeded<DashboardBody>(store, 'an-dashboard') };
  });
  fake.route('GET', `${analytics}/failure-patterns`, (req, store) => {
    requireProject(store, req.params.project_id);
    return { status: 200, body: [...seeded<readonly FailurePatternBody[]>(store, 'an-patterns')] };
  });
  fake.route('GET', `${analytics}/flaky`, (req, store) => {
    requireProject(store, req.params.project_id);
    const threshold = Number(req.query['threshold'] ?? 0.2);
    const items = seeded<readonly FlakyBody[]>(store, 'an-flaky').filter(
      (item) => item.flakiness_score >= threshold,
    );
    return { status: 200, body: items };
  });
  for (const [path, key] of [
    ['accuracy', 'an-accuracy'],
    ['trend', 'an-trend'],
    ['threshold-suggestion', 'an-threshold'],
  ] as const) {
    fake.route('GET', `${analytics}/validators/{validator_id}/${path}`, (req, store) => {
      requireProject(store, req.params.project_id);
      return { status: 200, body: seeded<never>(store, `${key}:${req.params.validator_id}`) };
    });
  }

  fake.route('POST', '/api/v1/test-flows/{flow_id}/versions/{version}/restore', (req, store) => {
    const all = [...flows(store)];
    const index = all.findIndex((flow) => flow.id === req.params.flow_id);
    const current = all[index];
    if (current === undefined) throw new FakeHttpError(404, { detail: 'Test flow not found' });
    const key = `flow-versions:${current.id}`;
    const versions = [...answered(read<Seeded<readonly FlowVersionBody[]>>(store, key) ?? [])];
    const target = versions.find((entry) => entry.version === req.params.version);
    const snapshots =
      read<Record<string, FlowDetailBody>>(store, `flow-snapshots:${current.id}`) ?? {};
    const snapshotted = snapshots[req.params.version];
    if (target === undefined && snapshotted === undefined) {
      throw new FakeHttpError(404, {
        detail: `Unknown label for this flow: ${req.params.version}`,
      });
    }
    // the current state is snapshotted first, as a new saved version
    const label = `before-restore-${String(versions.length + 1)}`;
    versions.unshift({
      id: store.newId(),
      flow_id: current.id,
      version: label,
      created_at: '2026-11-27T12:00:00Z',
      change_reason: `Before restoring ${req.params.version}`,
    });
    put(store, key, versions);
    put(store, `flow-snapshots:${current.id}`, { ...snapshots, [label]: { ...current } });
    // restoring a version puts that version's content back: here its label stands for the content
    all[index] = snapshotted ?? { ...current, version: req.params.version };
    put(store, 'flows', all);
    return { status: 200, body: { ...all[index] } };
  });

  const catalog = <T extends { id: string; category: string; is_active: boolean }>(
    store: Store,
    key: string,
  ): readonly T[] => answered(read<Seeded<readonly T[]>>(store, key) ?? []);
  const narrowed = <T extends { category: string; is_active: boolean }>(
    items: readonly T[],
    query: Readonly<Record<string, string | undefined>>,
  ): T[] =>
    items
      .filter((item) => query['category'] === undefined || item.category === query['category'])
      .filter(
        (item) => query['is_active'] === undefined || String(item.is_active) === query['is_active'],
      )
      .slice(0, Number(query['limit'] ?? 100));
  const categoriesOf = (items: readonly { category: string }[]): string[] => [
    ...new Set(items.map((item) => item.category)),
  ];
  const one = <T extends { id: string }>(items: readonly T[], id: string): T => {
    const found = items.find((item) => item.id === id);
    if (found === undefined) throw new FakeHttpError(404, { detail: 'Not found' });
    return found;
  };

  fake.route('GET', '/api/v1/base-test-types', (req, store) => {
    const all = catalog<BaseTestTypeBody>(store, 'cat-test-types');
    const test_types = narrowed(all, req.query);
    return {
      status: 200,
      body: { test_types, total: test_types.length, categories: categoriesOf(all) },
    };
  });
  fake.route('GET', '/api/v1/base-test-types/{test_type_id}', (req, store) => ({
    status: 200,
    body: { ...one(catalog<BaseTestTypeBody>(store, 'cat-test-types'), req.params.test_type_id) },
  }));
  fake.route('GET', '/api/v1/base-validators', (req, store) => {
    const all = catalog<BaseValidatorBody>(store, 'cat-validators');
    const validators = narrowed(all, req.query);
    return {
      status: 200,
      body: { validators, total: validators.length, categories: categoriesOf(all) },
    };
  });
  fake.route('GET', '/api/v1/base-validators/{validator_id}', (req, store) => ({
    status: 200,
    body: { ...one(catalog<BaseValidatorBody>(store, 'cat-validators'), req.params.validator_id) },
  }));
  fake.route('GET', '/api/v1/assertion-types', (req, store) => {
    const items = catalog<AssertionTypeBody>(store, 'cat-assertion-types').filter(
      (item) => req.query['category'] === undefined || item.category === req.query['category'],
    );
    return { status: 200, body: items.map((item) => ({ ...item })) };
  });
  fake.route('GET', '/api/v1/assertion-types/by-name/{name}', (req, store) => {
    const found = catalog<AssertionTypeBody>(store, 'cat-assertion-types').find(
      (item) => item.name === req.params.name,
    );
    if (found === undefined) throw new FakeHttpError(404, { detail: 'Assertion type not found' });
    return { status: 200, body: { ...found } };
  });
  fake.route('GET', '/api/v1/assertion-types/{type_id}', (req, store) => ({
    status: 200,
    body: { ...one(catalog<AssertionTypeBody>(store, 'cat-assertion-types'), req.params.type_id) },
  }));
}
