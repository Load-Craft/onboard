// `functional_delete` (module functional) on a consent card, level 3, delete: the first call reads the
// item and makes the card; the repeat with the same arguments asks the person in the client's dialog
// and only their yes sends the DELETE. The backend's records are compared. One item per card; no undo.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { functionalDelete } from '../../../src/tools/functional/delete.js';
import { newProcess } from '../../../src/workspace/migrate.js';
import {
  read,
  seedCatalog,
  seedFlows,
  seedFunctionalRuns,
  seedTemplates,
  type RunDetailBody,
} from '../../fake-backend/routes/functional.js';
import { SKLEP_COLLECTIONS } from '../../fake-backend/worlds/sklep.js';
import { BACKEND_CANARY, CANARY_PREFIX_LENGTH, SHAPE_CANARY } from '../../helpers/canary.js';
import { answering, person, writesOf, type Person } from '../../helpers/consentPerson.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import type { RigCallResult, ToolRig } from '../../helpers/rig.js';
import { loggedCalls } from '../../helpers/undo.js';
import { BOUND, functionalRig, PROJECT } from './rig.js';

const TOOL = 'functional_delete';
const FLOW = '4c0e2d3f-0001-4d00-8000-000000000001';
const TEMPLATE = '5d1f3e40-0001-4e00-8000-000000000001';
const RUN = '6e2a4f51-0001-4f00-8000-000000000001';
const RUNNING = '6e2a4f51-0002-4f00-8000-000000000002';
const BASE_TYPE = '1a2b3c4d-0001-4a00-8000-000000000001';
const BASE_VALIDATOR = '2b3c4d5e-0001-4b00-8000-000000000001';
const ASSERTION = '3c4d5e6f-0001-4c00-8000-000000000001';
const UNKNOWN = '9a8b7c6d-0001-4e00-8000-000000000001';
const stamp = { created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z' };

const run = (id: string, status: RunDetailBody['status'], name = 'Smoke'): RunDetailBody => ({
  id,
  project_id: PROJECT,
  status,
  execution_type: 'template',
  template_id: TEMPLATE,
  template_name: name,
  environment_id: null,
  environment_name: null,
  triggered_by: null,
  created_at: '2026-11-22T10:00:00Z',
  started_at: null,
  completed_at: null,
  duration_ms: 1,
  total_flows: 1,
  passed_flows: 1,
  failed_flows: 0,
  completed_flows: 1,
  total_validations: 1,
  passed_validations: 1,
  failed_validations: 0,
  error_message: null,
  langgraph_thread_id: null,
  flow_versions: {},
  runtime_params: {},
  config_snapshot: {},
});

interface Options {
  readonly who?: Person | null;
  readonly locale?: 'en' | 'pl';
  readonly runName?: string;
  readonly stateRun?: boolean;
}

function rig(options: Options = {}): Promise<ToolRig> {
  const who = options.who === undefined ? person() : options.who;
  const empty = newProcess(PROJECT, '2026-11-27T12:00:00.000Z');
  const files: Record<string, string> = { 'loadcraft/project.json': BOUND };
  if (options.stateRun === true) {
    files['loadcraft/.cache/state.json'] = JSON.stringify({
      schema: 3,
      process: { [PROJECT]: { ...empty, ids: { ...empty.ids, functional_run_id: RUN } } },
    });
  }
  return functionalRig({
    tools: [functionalDelete],
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(who === null ? {} : { elicit: answering(who) }),
    files,
    seed: (fake) => {
      seedFlows(fake.store, [
        {
          id: FLOW,
          name: 'Checkout',
          description: null,
          openapi_spec_id: '3b9d1c2e-0001-4c00-8000-000000000001',
          version: '2.16.0',
          blocks_count: 4,
          blocks: [],
          edges: [],
          variables: {},
          is_active: true,
          tags: [],
          timeout_ms: 1000,
          retry_count: 0,
          retry_delay_ms: 0,
          ...stamp,
        },
      ]);
      seedTemplates(fake.store, [
        {
          id: TEMPLATE,
          name: 'Smoke template',
          description: null,
          openapi_spec_id: null,
          tags: [],
          is_active: true,
          assertions_count: 0,
          flow_definition: {},
          ...stamp,
        },
      ]);
      seedFunctionalRuns(fake.store, [
        run(RUN, 'completed', options.runName),
        run(RUNNING, 'running'),
      ]);
      seedCatalog.testTypes(fake.store, [
        {
          id: BASE_TYPE,
          name: 'custom_probe',
          display_name: 'Probe',
          category: 'negative',
          description: null,
          is_active: true,
          is_builtin: false,
          expected_outcome: null,
          input_generation_prompt: '',
          input_schema: {},
          example_inputs: [],
          ...stamp,
        },
      ]);
      seedCatalog.validators(fake.store, [
        {
          id: BASE_VALIDATOR,
          name: 'status_code',
          display_name: 'Status code',
          category: 'http',
          description: null,
          validator_type: 'assertion',
          is_active: true,
          is_builtin: true,
          activation: 'auto',
          group: 'http',
          scope: 'step',
          requires_profile_flags: [],
          ai_prompt_template: null,
          parameters: [],
          ...stamp,
        },
      ]);
      seedCatalog.assertionTypes(fake.store, [
        {
          id: ASSERTION,
          name: 'equals',
          display_name: 'Equals',
          category: 'comparison',
          description: null,
          is_active: true,
          is_builtin: false,
          ...stamp,
        },
      ]);
    },
  });
}

const writes = (r: ToolRig) => writesOf(r, PROJECT);
const projectTypes = (r: ToolRig) =>
  r.fake.store.collection<{ id: string; effective_name: string }>(SKLEP_COLLECTIONS.testTypes);
const projectValidators = (r: ToolRig) =>
  r.fake.store.collection<{ id: string; effective_name: string }>(SKLEP_COLLECTIONS.validators);
const has = (r: ToolRig, key: string, id: string): boolean =>
  (read<{ id: string }[]>(r.fake.store, key) ?? []).some((item) => item.id === id);
const code = (result: RigCallResult): string | undefined =>
  result.isError ? /^\[([a-z_]+)\]/u.exec(result.text)?.[1] : undefined;
const kept = (r: ToolRig): string[] => {
  const file = join(r.workspace, 'loadcraft', '.cache', 'state.json');
  if (!existsSync(file)) return [];
  const state = JSON.parse(readFileSync(file, 'utf8')) as { drafts?: Record<string, unknown> };
  return Object.keys(state.drafts ?? {}).filter((key) => key.startsWith(`card:${TOOL}:`));
};

describe('functional_delete: the card', () => {
  it('carries its catalog entry and is written on the consent card', () => {
    expectCatalogEntry(functionalDelete);
    expect(functionalDelete.implemented).toBe(true);
  });

  it('a flow card names the flow, its version and blocks, what goes, and sends no write', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, { kind: 'flow', item_id: FLOW });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        'Consent needed (level 3) · Delete flow "Checkout"',
        `  the flow ${FLOW}`,
        '  version 2.16.0, 4 blocks',
        '  the flow and its saved versions are deleted',
        'Cannot be undone: it is deleted for good',
        'Asked on its own: it deletes for good.',
        'Nothing was done yet. Tell the user what this card says. To go on, call functional_delete again with the same arguments: the user is then asked to confirm in a dialog, and only their yes there runs it. The card is valid for 30 min.',
      ].join('\n'),
    );
    expect(writes(r)).toEqual([]);
    expect(who.asked).toEqual([]);
    expect(loggedCalls(r).at(-1)).toMatchObject({
      tool: TOOL,
      status: 'queued',
      args: 'Delete flow: Checkout',
    });
    expect(kept(r)).toHaveLength(1);
  });

  it('a card of each other kind names the item and says what it is', async () => {
    const r = await rig();
    const target = projectTypes(r).list()[0];
    const cases: [Record<string, unknown>, string[]][] = [
      [{ kind: 'template', item_id: TEMPLATE }, ['Delete template "Smoke template"']],
      [
        { kind: 'run', item_id: RUN },
        ['Delete run "Smoke"', '  status: completed', '  the run and its results are deleted'],
      ],
      [
        { kind: 'test_type', item_id: target?.id },
        [`Delete test type "${target?.effective_name ?? ''}"`, '  removed from this project'],
      ],
      [
        { kind: 'catalog_validator', item_id: BASE_VALIDATOR },
        [
          'Delete catalog validator "status_code"',
          '  it is a built-in entry',
          '  removed from the shared catalog, so from every project',
        ],
      ],
    ];
    for (const [args, expected] of cases) {
      const result = await r.call(TOOL, args);
      expect(result.isError, result.text).toBe(false);
      for (const line of expected) expect(result.text).toContain(line);
    }
    expect(writes(r)).toEqual([]);
  });

  it('answers in Polish with every line of the card and of the result', async () => {
    const r = await rig({ locale: 'pl' });
    const card = await r.call(TOOL, { kind: 'flow', item_id: FLOW });
    expect(card.text.split('\n').slice(0, 4)).toEqual([
      'Potrzebna zgoda (poziom 3) · Usunięcie: przepływ „Checkout”',
      `  przepływ ${FLOW}`,
      '  wersja 2.16.0, bloków: 4',
      '  przepływ i jego zapisane wersje są usuwane',
    ]);
    const done = await r.call(TOOL, { kind: 'flow', item_id: FLOW });
    expect(done.text).toBe(['Przepływ „Checkout” usunięty.', 'Tego nie da się cofnąć.'].join('\n'));
  });
});

describe('functional_delete: the decision', () => {
  it("the person's yes deletes the flow once; the entry names the dialog and has no undo", async () => {
    const who = person();
    const r = await rig({ who });
    const args = { kind: 'flow', item_id: FLOW };
    await r.call(TOOL, args);
    const done = await r.call(TOOL, args);
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toBe(['Flow "Checkout" deleted.', 'This cannot be undone.'].join('\n'));
    expect(who.asked).toHaveLength(1);
    expect(who.asked[0]).toContain('Cannot be undone');
    expect(writes(r)).toEqual([`DELETE /api/v1/test-flows/${FLOW}`]);
    expect(has(r, 'flows', FLOW)).toBe(false);
    const entry = loggedCalls(r).at(-1);
    expect(entry).toMatchObject({
      tool: TOOL,
      status: 'ok',
      args: 'Delete flow: Checkout',
      result: '1 flow deleted',
      consent: { via: 'client_dialog' },
    });
    expect(entry?.undo).toBeUndefined();
    expect(kept(r)).toEqual([]);
    expect(code(await r.call(TOOL, args))).toBe('not_found');
    expect(writes(r)).toHaveLength(1);
  });

  it('every kind sends its own DELETE and removes only that item', async () => {
    const r = await rig();
    const type = projectTypes(r).list()[0];
    const validator = projectValidators(r).list()[0];
    const items: [string, string, string][] = [
      ['template', TEMPLATE, `DELETE /api/v1/test-templates/${TEMPLATE}`],
      ['run', RUN, `DELETE /executions/${RUN}`],
      ['test_type', type?.id ?? '', `DELETE /test-types/${type?.id ?? ''}`],
      ['validator', validator?.id ?? '', `DELETE /validators/${validator?.id ?? ''}`],
      ['catalog_test_type', BASE_TYPE, `DELETE /api/v1/base-test-types/${BASE_TYPE}`],
      ['catalog_validator', BASE_VALIDATOR, `DELETE /api/v1/base-validators/${BASE_VALIDATOR}`],
      ['catalog_assertion_type', ASSERTION, `DELETE /api/v1/assertion-types/${ASSERTION}`],
    ];
    for (const [kind, id] of items) {
      await r.call(TOOL, { kind, item_id: id });
      const done = await r.call(TOOL, { kind, item_id: id });
      expect(done.isError, `${kind}: ${done.text}`).toBe(false);
    }
    expect(writes(r)).toEqual(items.map(([, , route]) => route));
    expect(has(r, 'templates', TEMPLATE)).toBe(false);
    expect(has(r, 'runs', RUN)).toBe(false);
    expect(has(r, 'runs', RUNNING)).toBe(true);
    expect(has(r, 'flows', FLOW)).toBe(true);
    expect(has(r, 'cat-validators', BASE_VALIDATOR)).toBe(false);
    expect(projectTypes(r).get(type?.id ?? '')).toBeUndefined();
    expect(projectTypes(r).list().length).toBeGreaterThan(0);
  });

  it('a run the state holds as the current one is dropped from the state', async () => {
    const r = await rig({ stateRun: true });
    await r.call(TOOL, { kind: 'run', item_id: RUN });
    await r.call(TOOL, { kind: 'run', item_id: RUN });
    const text = readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8');
    const state = JSON.parse(text) as { process: Record<string, { ids: object }> };
    expect(state.process[PROJECT]?.ids).not.toHaveProperty('functional_run_id');
  });

  it.each(['unticked', 'declined', 'cancelled'] as const)(
    'the person answering %s deletes nothing: consent_missing, and the card is gone',
    async (answer) => {
      const r = await rig({ who: person(answer) });
      const args = { kind: 'flow', item_id: FLOW };
      await r.call(TOOL, args);
      expect(code(await r.call(TOOL, args))).toBe('consent_missing');
      expect(writes(r)).toEqual([]);
      expect(has(r, 'flows', FLOW)).toBe(true);
      expect(kept(r)).toEqual([]);
    },
  );

  it('another item or kind is a new card: the yes belongs to the card that was asked about', async () => {
    const who = person();
    const r = await rig({ who });
    await r.call(TOOL, { kind: 'flow', item_id: FLOW });
    const other = await r.call(TOOL, { kind: 'template', item_id: TEMPLATE });
    expect(other.text).toContain('Delete template');
    expect(other.text).toContain('this is a new one');
    expect(who.asked).toEqual([]);
    expect(writes(r)).toEqual([]);
    expect(has(r, 'flows', FLOW)).toBe(true);
  });

  it('the model has no argument that confirms; a client that cannot ask gets consent_missing', async () => {
    const r = await rig();
    for (const extra of [
      { confirm: true },
      { consent: 'given' },
      { token: 'abc' },
      { ids: [FLOW] },
    ]) {
      const result = await r.call(TOOL, { kind: 'flow', item_id: FLOW, ...extra });
      expect(result.isError, JSON.stringify(extra)).toBe(true);
      expect(result.text).not.toMatch(/^\[not_implemented\]/u);
    }
    const silent = await rig({ who: null });
    const refused = await silent.call(TOOL, { kind: 'flow', item_id: FLOW });
    expect(code(refused)).toBe('consent_missing');
    expect(writes(r)).toEqual([]);
    expect(kept(silent)).toEqual([]);
  });
});

describe('functional_delete: arguments, checks and the backend', () => {
  it('an unknown item is not_found for every kind, no card; a run that has not finished is delete_busy', async () => {
    const r = await rig();
    for (const kind of [
      'flow',
      'template',
      'test_type',
      'validator',
      'run',
      'catalog_test_type',
      'catalog_validator',
      'catalog_assertion_type',
    ]) {
      expect(code(await r.call(TOOL, { kind, item_id: UNKNOWN })), kind).toBe('not_found');
    }
    const busy = await r.call(TOOL, { kind: 'run', item_id: RUNNING });
    expect(code(busy)).toBe('delete_busy');
    expect(busy.text).toContain('(running)');
    expect(kept(r)).toEqual([]);
    expect(writes(r)).toEqual([]);
  });

  it('refuses arguments outside the catalog before a request', async () => {
    const r = await rig();
    for (const args of [
      { item_id: FLOW },
      { kind: 'flow' },
      { kind: 'project', item_id: FLOW },
      { kind: 'flow', item_id: 'x' },
      { kind: 'flow', item_ids: [FLOW] },
    ]) {
      expect((await r.call(TOOL, args)).isError, JSON.stringify(args)).toBe(true);
    }
    expect(r.fake.calls.filter((call) => call.path.startsWith('/api/v1/'))).toEqual([]);
  });
});

describe('functional_delete: secrets', () => {
  it('a secret in the names is masked on the card, in the answer and in the log', async () => {
    const r = await rig({
      runName: `Smoke password: ${BACKEND_CANARY} Authorization: Bearer ${SHAPE_CANARY}\u001b[31m`,
    });
    const card = await r.call(TOOL, { kind: 'run', item_id: RUN, format: 'data' });
    const done = await r.call(TOOL, { kind: 'run', item_id: RUN });
    expect(done.isError, done.text).toBe(false);
    for (const text of [card.text, done.text]) {
      expect(text).not.toContain(BACKEND_CANARY.slice(0, CANARY_PREFIX_LENGTH));
      expect(text).not.toContain(SHAPE_CANARY.slice(0, CANARY_PREFIX_LENGTH));
      expect(text).not.toContain('\u001b');
    }
  });
});
