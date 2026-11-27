// Write routes of module functional for the tools on a consent card (src/tools/functional/): the
// shared catalogs (base test types, base validators, assertion types), the test types and validators of
// the project, the discovery of validators, the seed of the built-in catalog and the deletions. They work
// over the records the seeding functions of `routes/functional.ts` fill, so a test reads back what a tool
// wrote with the read routes. An update is partial (omitted or null fields stay); an unknown id is a 404.
// Registration is idempotent per fake.

import type { components } from '../../../src/http/generated/api.js';
import type { Fake, Store } from '../server.js';
import { FakeHttpError } from '../server.js';
import { SKLEP_COLLECTIONS } from '../worlds/sklep.js';
import {
  answered,
  put,
  read,
  type AssertionTypeBody,
  type BaseTestTypeBody,
  type BaseValidatorBody,
  type FlowDetailBody,
  type RunDetailBody,
  type TemplateDetailBody,
  type TestTypeBody,
  type ValidatorBody,
  type Seeded,
} from './functional.js';

const registered = new WeakSet<Fake>();

export type DiscoverBody = components['schemas']['DiscoverResponse'];

/** What the next discovery of validators answers (a test seeds it); without one it finds nothing. */
export function seedDiscovery(store: Store, body: Seeded<DiscoverBody>): void {
  put(store, 'discovery', body);
}
const STAMP = '2026-11-27T12:00:00Z';

type CatalogKey = 'cat-test-types' | 'cat-validators' | 'cat-assertion-types';

const catalog = <T extends { id: string }>(store: Store, key: CatalogKey): T[] => [
  ...answered(read<Seeded<readonly T[]>>(store, key) ?? []),
];

/** The fields of an update that are given (not omitted, not null). */
function given<T extends object>(body: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined && value !== null),
  ) as Partial<T>;
}

export function registerFunctionalConsentWriteRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  const create = <T extends { id: string }>(store: Store, key: CatalogKey, record: T): T => {
    put(store, key, [...catalog<T>(store, key), record]);
    return record;
  };
  const change = <T extends { id: string }>(
    store: Store,
    key: CatalogKey,
    id: string,
    patch: Partial<T>,
  ): T => {
    const all = catalog<T>(store, key);
    const index = all.findIndex((item) => item.id === id);
    const current = all[index];
    if (current === undefined) throw new FakeHttpError(404, { detail: 'Not found' });
    const updated = { ...current, ...patch, updated_at: STAMP };
    all[index] = updated;
    put(store, key, all);
    return updated;
  };

  fake.route('POST', '/api/v1/base-test-types', (req, store) => {
    const body = req.body as components['schemas']['CreateBaseTestTypeRequest'];
    const record: BaseTestTypeBody = {
      id: store.newId(),
      name: body.name,
      display_name: body.display_name,
      category: body.category,
      description: body.description ?? null,
      expected_outcome: body.expected_outcome ?? null,
      input_generation_prompt: body.input_generation_prompt,
      input_schema: body.input_schema ?? {},
      example_inputs: body.example_inputs ?? [],
      is_active: true,
      is_builtin: false,
      created_at: STAMP,
      updated_at: STAMP,
    };
    return { status: 200, body: create(store, 'cat-test-types', record) };
  });
  fake.route('PUT', '/api/v1/base-test-types/{test_type_id}', (req, store) => ({
    status: 200,
    body: change<BaseTestTypeBody>(
      store,
      'cat-test-types',
      req.params.test_type_id,
      given(
        req.body as components['schemas']['UpdateBaseTestTypeRequest'],
      ) as Partial<BaseTestTypeBody>,
    ),
  }));

  fake.route('POST', '/api/v1/base-validators', (req, store) => {
    const body = req.body as components['schemas']['CreateBaseValidatorRequest'];
    const record: BaseValidatorBody = {
      id: store.newId(),
      name: body.name,
      display_name: body.display_name,
      category: body.category,
      description: body.description ?? null,
      validator_type: body.validator_type,
      activation: body.activation,
      group: body.group,
      scope: body.scope,
      requires_profile_flags: body.requires_profile_flags ?? [],
      ai_prompt_template: body.ai_prompt_template ?? null,
      parameters: body.parameters ?? [],
      is_active: true,
      is_builtin: false,
      created_at: STAMP,
      updated_at: STAMP,
    };
    return { status: 200, body: create(store, 'cat-validators', record) };
  });
  fake.route('PUT', '/api/v1/base-validators/{validator_id}', (req, store) => ({
    status: 200,
    body: change<BaseValidatorBody>(
      store,
      'cat-validators',
      req.params.validator_id,
      given(
        req.body as components['schemas']['UpdateBaseValidatorRequest'],
      ) as Partial<BaseValidatorBody>,
    ),
  }));

  fake.route('POST', '/api/v1/assertion-types', (req, store) => {
    const body = req.body as components['schemas']['AssertionTypeCreate'];
    const record: AssertionTypeBody = {
      id: store.newId(),
      name: body.name,
      display_name: body.display_name,
      category: body.category,
      description: body.description ?? null,
      prompt_template: body.prompt_template ?? null,
      parameters: body.parameters ?? [],
      is_active: true,
      is_builtin: false,
      created_at: STAMP,
      updated_at: STAMP,
    };
    return { status: 201, body: create(store, 'cat-assertion-types', record) };
  });
  fake.route('PUT', '/api/v1/assertion-types/{type_id}', (req, store) => ({
    status: 200,
    body: change<AssertionTypeBody>(
      store,
      'cat-assertion-types',
      req.params.type_id,
      given(req.body as components['schemas']['AssertionTypeUpdate']) as Partial<AssertionTypeBody>,
    ),
  }));

  // ---- the test types of the project ----------------------------------------------------------

  const project = (store: Store, id: string): void => {
    store.collection(SKLEP_COLLECTIONS.projects).require(id, `Project not found: ${id}`);
  };
  const testTypes = (store: Store) => store.collection<TestTypeBody>(SKLEP_COLLECTIONS.testTypes);
  const baseTypes = (store: Store): BaseTestTypeBody[] =>
    catalog<BaseTestTypeBody>(store, 'cat-test-types');
  const newTestType = (
    store: Store,
    projectId: string,
    fields: Partial<TestTypeBody> & { name: string; category: string | null; display: string },
  ): TestTypeBody => {
    const { display, name, category, ...rest } = fields;
    return testTypes(store).insert({
      id: store.newId(),
      project_id: projectId,
      default_count: 3,
      is_enabled: true,
      priority: 1,
      effective_name: name,
      effective_display_name: display,
      effective_category: category,
      ...rest,
    });
  };

  fake.route('POST', '/api/v1/projects/{project_id}/test-types', (req, store) => {
    project(store, req.params.project_id);
    const body = req.body as components['schemas']['CreateTestTypeRequest'];
    const base = baseTypes(store).find((item) => item.id === body.base_type_id);
    const created = newTestType(store, req.params.project_id, {
      name: body.custom_name ?? base?.name ?? 'unnamed',
      display: body.custom_display_name ?? base?.display_name ?? body.custom_name ?? 'unnamed',
      category: body.custom_category ?? base?.category ?? null,
      ...given(body),
    });
    return { status: 200, body: { ...created } };
  });

  fake.route('POST', '/api/v1/projects/{project_id}/test-types/bulk', (req, store) => {
    project(store, req.params.project_id);
    const ids = (
      req.body as components['schemas']['backend__api__routes__project_test_types__BulkAddRequest']
    ).base_type_ids;
    const have = new Set(
      testTypes(store)
        .list((item) => item.project_id === req.params.project_id)
        .map((item) => item.base_type_id),
    );
    const added: string[] = [];
    let skipped = 0;
    for (const id of ids) {
      const base = baseTypes(store).find((item) => item.id === id);
      if (base === undefined || have.has(id)) {
        skipped += 1;
        continue;
      }
      added.push(
        newTestType(store, req.params.project_id, {
          name: base.name,
          display: base.display_name,
          category: base.category,
          base_type_id: base.id,
        }).id,
      );
    }
    return {
      status: 200,
      body: { added_count: added.length, added_ids: added, skipped_count: skipped },
    };
  });

  fake.route('POST', '/api/v1/projects/{project_id}/test-types/suggest/accept', (req, store) => {
    project(store, req.params.project_id);
    const body = req.body as components['schemas']['AcceptSuggestionRequest'];
    const created = newTestType(store, req.params.project_id, {
      name: body.name,
      display: body.display_name,
      category: body.category,
      default_count: body.default_count,
      priority: body.priority,
      custom_name: body.name,
      custom_description: body.description,
      custom_input_prompt: body.input_generation_prompt,
    });
    return { status: 200, body: { ...created } };
  });

  fake.route('PUT', '/api/v1/projects/{project_id}/test-types/{test_type_id}', (req, store) => {
    project(store, req.params.project_id);
    const current = testTypes(store).get(req.params.test_type_id);
    if (current === undefined) throw new FakeHttpError(404, { detail: 'Test type not found' });
    const changes = given(req.body as components['schemas']['UpdateTestTypeRequest']);
    const updated = testTypes(store).update(current.id, {
      ...changes,
      ...(changes.custom_name === undefined ? {} : { effective_name: changes.custom_name }),
      ...(changes.custom_display_name === undefined
        ? {}
        : { effective_display_name: changes.custom_display_name }),
    } as Partial<TestTypeBody>);
    return { status: 200, body: { ...updated } };
  });

  // ---- the validators of the project ----------------------------------------------------------

  const validators = (store: Store) =>
    store.collection<ValidatorBody>(SKLEP_COLLECTIONS.validators);
  const baseValidators = (store: Store): BaseValidatorBody[] =>
    catalog<BaseValidatorBody>(store, 'cat-validators');

  fake.route('POST', '/api/v1/projects/{project_id}/validators', (req, store) => {
    project(store, req.params.project_id);
    const body = req.body as components['schemas']['CreateValidatorRequest'];
    const base = baseValidators(store).find((item) => item.id === body.base_validator_id);
    const created = validators(store).insert({
      id: store.newId(),
      project_id: req.params.project_id,
      default_params: {},
      is_enabled: true,
      evaluated_after_run: false,
      effective_name: body.custom_name ?? base?.name ?? 'unnamed',
      effective_display_name:
        body.custom_display_name ?? base?.display_name ?? body.custom_name ?? 'unnamed',
      effective_validator_type: body.custom_validator_type ?? base?.validator_type ?? 'assertion',
      effective_category: base?.category ?? null,
      ...given(body),
    } as ValidatorBody);
    return { status: 200, body: { ...created } };
  });

  fake.route('POST', '/api/v1/projects/{project_id}/validators/bulk', (req, store) => {
    project(store, req.params.project_id);
    const ids = (
      req.body as components['schemas']['backend__api__routes__project_validators__BulkAddRequest']
    ).base_validator_ids;
    const have = new Set(
      validators(store)
        .list((item) => item.project_id === req.params.project_id)
        .map((item) => item.base_validator_id),
    );
    const added: string[] = [];
    let skipped = 0;
    for (const id of ids) {
      const base = baseValidators(store).find((item) => item.id === id);
      if (base === undefined || have.has(id)) {
        skipped += 1;
        continue;
      }
      added.push(
        validators(store).insert({
          id: store.newId(),
          project_id: req.params.project_id,
          default_params: {},
          is_enabled: true,
          priority: 1,
          evaluated_after_run: false,
          base_validator_id: base.id,
          effective_name: base.name,
          effective_display_name: base.display_name,
          effective_validator_type: base.validator_type,
          effective_category: base.category,
        }).id,
      );
    }
    return {
      status: 200,
      body: { added_count: added.length, added_ids: added, skipped_count: skipped },
    };
  });

  fake.route('PUT', '/api/v1/projects/{project_id}/validators/{validator_id}', (req, store) => {
    project(store, req.params.project_id);
    const current = validators(store).get(req.params.validator_id);
    if (current === undefined) throw new FakeHttpError(404, { detail: 'Validator not found' });
    const changes = given(req.body as components['schemas']['UpdateValidatorRequest']);
    const updated = validators(store).update(current.id, {
      ...changes,
      ...(changes.custom_name === undefined ? {} : { effective_name: changes.custom_name }),
      ...(changes.custom_display_name === undefined
        ? {}
        : { effective_display_name: changes.custom_display_name }),
    } as Partial<ValidatorBody>);
    return { status: 200, body: { ...updated } };
  });

  fake.route('POST', '/api/v1/projects/{project_id}/validators/discover', (req, store) => {
    project(store, req.params.project_id);
    const body = answered(
      read<Seeded<DiscoverBody>>(store, 'discovery') ??
        ({
          already_in_project: 0,
          considered_count: 0,
          rejected_count: 0,
          proposals: [],
          evidence_summary: {
            basis: 'no_operations' as const,
            has_app_description: 0,
            openapi_schemas: 0,
            operations: 0,
            operations_not_shown: 0,
            response_samples: 0,
            sampled_operations: 0,
          },
        } satisfies DiscoverBody),
    );
    return { status: 200, body };
  });

  // ---- deletions ------------------------------------------------------------------------------

  const removeFrom = <T extends { id: string }>(
    store: Store,
    key: string,
    id: string,
    what: string,
  ): void => {
    const all = [...answered(read<Seeded<readonly T[]>>(store, key) ?? [])];
    if (!all.some((item) => item.id === id))
      throw new FakeHttpError(404, { detail: `${what} not found` });
    put(
      store,
      key,
      all.filter((item) => item.id !== id),
    );
  };

  fake.route('DELETE', '/api/v1/test-flows/{flow_id}', (req, store) => {
    removeFrom<FlowDetailBody>(store, 'flows', req.params.flow_id, 'Flow');
    return { status: 200, body: { deleted: true } };
  });
  fake.route('DELETE', '/api/v1/test-templates/{template_id}', (req, store) => {
    removeFrom<TemplateDetailBody>(store, 'templates', req.params.template_id, 'Template');
    return { status: 200, body: { deleted: true } };
  });
  fake.route('DELETE', '/api/v1/projects/{project_id}/executions/{execution_id}', (req, store) => {
    project(store, req.params.project_id);
    removeFrom<RunDetailBody>(store, 'runs', req.params.execution_id, 'Execution');
    return { status: 200, body: { deleted: true } };
  });
  fake.route('DELETE', '/api/v1/projects/{project_id}/test-types/{test_type_id}', (req, store) => {
    project(store, req.params.project_id);
    if (!testTypes(store).delete(req.params.test_type_id)) {
      throw new FakeHttpError(404, { detail: 'Test type not found' });
    }
    return { status: 200, body: { success: true, message: 'Test type deleted' } };
  });
  fake.route('DELETE', '/api/v1/projects/{project_id}/validators/{validator_id}', (req, store) => {
    project(store, req.params.project_id);
    if (!validators(store).delete(req.params.validator_id)) {
      throw new FakeHttpError(404, { detail: 'Validator not found' });
    }
    return { status: 200, body: { success: true, message: 'Validator deleted' } };
  });
  fake.route('DELETE', '/api/v1/base-test-types/{test_type_id}', (req, store) => {
    removeFrom<BaseTestTypeBody>(store, 'cat-test-types', req.params.test_type_id, 'Test type');
    return { status: 200, body: { deleted: true } };
  });
  fake.route('DELETE', '/api/v1/base-validators/{validator_id}', (req, store) => {
    removeFrom<BaseValidatorBody>(store, 'cat-validators', req.params.validator_id, 'Validator');
    return { status: 200, body: { deleted: true } };
  });
  fake.route('DELETE', '/api/v1/assertion-types/{type_id}', (req, store) => {
    removeFrom<AssertionTypeBody>(
      store,
      'cat-assertion-types',
      req.params.type_id,
      'Assertion type',
    );
    return { status: 200, body: { deleted: true } };
  });
}
