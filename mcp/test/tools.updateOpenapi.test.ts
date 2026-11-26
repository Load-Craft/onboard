import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import { renderUpdateOpenapi, type UpdateOpenapiData } from '../src/render/views/updateOpenapi.js';
import { probeBudgetMs, projectImportDocs } from '../src/tools/projectImportDocs.js';
import { goldenText, SKLEP_IDS } from './golden/index.js';
import { registerAllRoutes } from './fake-backend/routes/index.js';
import type { StoredSpec } from './fake-backend/routes/setup.js';
import { withoutSpecStatus } from './fake-backend/routes/flows.js';
import type { Fake } from './fake-backend/server.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepEndpoint,
} from './fake-backend/worlds/sklep.js';
import { assertNoCanary, FILE_CANARY } from './helpers/canary.js';
import { CANARY, toolRig, type ToolRig } from './helpers/rig.js';

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};
const OLD_COMMIT = 'a41f9c2d83b05e17c6a94f0b2d38e5a1c7f09b46';
const NEW_COMMIT = '7be03d1a95c24f68b0e7d3a1c59f82e460ab1d37';
const THIRD_COMMIT = 'c3d94e1a07b25f68a1e0d3b7c95f82e460ab1d99';
const UPLOAD = `/api/v1/projects/${SKLEP_IDS.project}/openapi/upload`;
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

type Paths = Record<string, Record<string, { operationId: string }>>;

/** The OpenAPI document of the operations the fake world serves, plus one new GET operation. */
function documentOf(
  endpoints: readonly SklepEndpoint[],
  commit: string,
  extra: boolean,
  description?: string,
): string {
  const paths: Paths = {};
  for (const endpoint of endpoints) {
    const item = (paths[endpoint.path] ??= {});
    item[endpoint.method.toLowerCase()] = { operationId: endpoint.operation_id ?? endpoint.id };
  }
  if (extra) paths['/status'] = { get: { operationId: 'get_status_page' } };
  return JSON.stringify({
    openapi: '3.0.3',
    info: {
      title: 'Sklep API',
      version: '2.15.0',
      ...(description === undefined ? {} : { description }),
      'x-loadcraft-source': { commit, branch: 'qa' },
    },
    paths,
  });
}

const worldEndpoints = (fake: Fake): SklepEndpoint[] =>
  fake.store.collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints).list();

interface Options {
  /** Flows of the world stay pinned to the documentation the project had. */
  readonly pinned?: boolean;
  /** The qa environment keeps its protection. */
  readonly protectedQa?: boolean;
  /** Test types were generated from the documentation the project had. */
  readonly staleTypes?: boolean;
}

function world(options: Options) {
  return (fake: Fake): void => {
    registerAllRoutes(fake);
    seedSklep(fake.store, { stage: 'flows' });
    const store = fake.store;
    // The documentation the project has: the same operations, from an earlier commit.
    store.collection<StoredSpec>(SKLEP_COLLECTIONS.specs).update(SKLEP_WORLD_IDS.spec, {
      spec_content: JSON.parse(documentOf(worldEndpoints(fake), OLD_COMMIT, false)) as Record<
        string,
        unknown
      >,
    });
    if (options.pinned !== true) {
      const flows = store.collection<{ id: string }>(SKLEP_COLLECTIONS.flows);
      for (const flow of flows.list()) flows.update(flow.id, { openapi_spec_id: null });
    }
    if (options.protectedQa !== true) {
      store
        .collection(SKLEP_COLLECTIONS.environments)
        .update(SKLEP_WORLD_IDS.environments.qa, { protected: false });
    }
    if (options.staleTypes === true) {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .update(SKLEP_IDS.project, { test_types_generated_from_spec_id: SKLEP_WORLD_IDS.spec });
    }
  };
}

async function rig(
  locale: 'en' | 'pl' = 'pl',
  options: Options = {},
  files: Record<string, string> = BOUND,
): Promise<ToolRig> {
  return toolRig({
    tools: [projectImportDocs],
    world: world(options),
    env: { LOADCRAFT_LOCALE: locale },
    files,
  });
}

/** A git repository in the workspace and a second working tree of it next to it. */
function withWorktree(r: ToolRig, document: string): string {
  const run = (cwd: string, ...args: string[]): void => {
    execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'ignore' });
  };
  run(r.workspace, 'init', '-q');
  run(r.workspace, 'commit', '-q', '--allow-empty', '-m', 'init');
  const tree = join(mkdtempSync(join(tmpdir(), 'lc-wt-')), 'sklep-qa');
  run(r.workspace, 'worktree', 'add', '-q', '-b', 'qa', tree);
  const root = realpathSync(tree);
  mkdirSync(join(root, 'loadcraft'), { recursive: true });
  writeFileSync(join(root, 'loadcraft', 'openapi.json'), document);
  onTestFinished(() => rmSync(dirname(root), { recursive: true, force: true }));
  return root;
}

interface StateProblem {
  readonly code: string;
  readonly severity: string;
  readonly flow_ids?: readonly string[];
}

function processOf(r: ToolRig): { problems: StateProblem[] } {
  const state = JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as { process: Record<string, { problems: StateProblem[] }> };
  const found = state.process[SKLEP_IDS.project];
  if (found === undefined) throw new Error('no process of the project');
  return found;
}

const uploads = (r: ToolRig): string[] =>
  r.fake.calls.filter((c) => c.method === 'POST' && c.path === UPLOAD).map((c) => c.path);
const conformanceCalls = (r: ToolRig): string[] =>
  r.fake.calls.filter((c) => c.path.endsWith('/conformance')).map((c) => c.path);

async function ok(
  r: ToolRig,
  args: Record<string, unknown>,
): Promise<{ text: string; data: UpdateOpenapiData }> {
  const result = await r.call('project_import_docs', args);
  if (result.isError) throw new Error(`project_import_docs failed: ${result.text}`);
  const structured = result.outcome as { status: string; data: UpdateOpenapiData };
  expect(structured.status).toBe('done');
  return { text: result.text, data: structured.data };
}

const goldenView = (): UpdateOpenapiData =>
  JSON.parse(
    readFileSync(
      new URL('./golden/run5/03-project_import_docs.view.json', import.meta.url),
      'utf8',
    ),
  ) as UpdateOpenapiData;

describe('project_import_docs', () => {
  it('sends a document from another working tree and matches the golden view', async () => {
    // The golden run is the one on the protected qa: its probe is skipped.
    const r = await rig('pl', { protectedQa: true });
    const root = withWorktree(r, documentOf(worldEndpoints(r.fake), NEW_COMMIT, true));
    const { text, data } = await ok(r, {
      openapi: join(root, 'loadcraft', 'openapi.json'),
      environment: 'qa',
    });
    expect(data).toEqual(goldenView());
    expect(`${text}\n`).toBe(goldenText('run5', '03-project_import_docs'));
    expect(uploads(r)).toHaveLength(1);
    // The project now points at the new document, the old one stays in the history.
    const specs = r.fake.store.collection<StoredSpec>(SKLEP_COLLECTIONS.specs).list();
    expect(specs).toHaveLength(2);
    expect(specs.filter((spec) => spec.is_current)).toHaveLength(1);
    r.assertClean();
  });

  it('accepts a path relative to the project directory that leads to the other tree', async () => {
    const r = await rig('en');
    const root = withWorktree(r, documentOf(worldEndpoints(r.fake), NEW_COMMIT, true));
    const relative = join('..', ...root.split('/').slice(-2), 'loadcraft', 'openapi.json');
    const before = worldEndpoints(r.fake).length;
    const { data } = await ok(r, { openapi: relative });
    expect(data.changed).toBe(true);
    expect(data.operations).toBe(before + 1);
    expect(uploads(r)).toHaveLength(1);
  });

  it('accepts a file inside the project directory without asking git', async () => {
    const r = await rig(
      'en',
      {},
      {
        ...BOUND,
        'loadcraft/openapi.json': documentOf([], NEW_COMMIT, true),
      },
    );
    const before = worldEndpoints(r.fake).length;
    const { data } = await ok(r, { openapi: 'loadcraft/openapi.json' });
    expect(data.changed).toBe(true);
    expect(data.operations).toBe(1);
    expect(data.delta).toBe(1 - before);
    expect(uploads(r)).toHaveLength(1);
  });

  it('does not send the same document twice and says so', async () => {
    const same = documentOf([], OLD_COMMIT, false);
    const r = await rig('en', {}, { ...BOUND, 'loadcraft/openapi.json': same });
    r.fake.store
      .collection<StoredSpec>(SKLEP_COLLECTIONS.specs)
      .update(SKLEP_WORLD_IDS.spec, { spec_content: JSON.parse(same) as Record<string, unknown> });
    const { text, data } = await ok(r, { openapi: 'loadcraft/openapi.json', environment: 'qa' });
    expect(data.changed).toBe(false);
    expect(data.previousCommit).toBe(OLD_COMMIT);
    expect(uploads(r)).toEqual([]);
    expect(conformanceCalls(r)).toEqual([]);
    await expect(text).toMatchFileSnapshot('__snapshots__/updateOpenapi.unchanged.en.txt');
  });

  it('sends a document with the same commit but another content', async () => {
    const edited = JSON.parse(documentOf([], OLD_COMMIT, true)) as Record<string, unknown>;
    const r = await rig('en', {}, { ...BOUND, 'loadcraft/openapi.json': JSON.stringify(edited) });
    r.fake.store.collection<StoredSpec>(SKLEP_COLLECTIONS.specs).update(SKLEP_WORLD_IDS.spec, {
      spec_content: JSON.parse(documentOf([], OLD_COMMIT, false)) as Record<string, unknown>,
    });
    const { data } = await ok(r, { openapi: 'loadcraft/openapi.json' });
    expect(data.changed).toBe(true);
    expect(uploads(r)).toHaveLength(1);
  });

  it('skips the conformance check on a protected environment', async () => {
    const r = await rig('en', { protectedQa: true });
    const root = withWorktree(r, documentOf(worldEndpoints(r.fake), NEW_COMMIT, true));
    const { text, data } = await ok(r, {
      openapi: join(root, 'loadcraft', 'openapi.json'),
      environment: 'qa',
    });
    expect(data.conformance).toEqual({ environment: 'qa', result: { state: 'skipped' } });
    expect(conformanceCalls(r)).toEqual([]);
    expect(text).toContain('skipped');
  });

  it('counts the flows pinned to the previous documentation and warns that the profile is not refreshed', async () => {
    const r = await rig('en', { pinned: true, staleTypes: true });
    const root = withWorktree(r, documentOf(worldEndpoints(r.fake), NEW_COMMIT, true));
    const pinned = r.fake.store
      .collection<{ id: string; openapi_spec_id?: string | null }>(SKLEP_COLLECTIONS.flows)
      .list()
      .filter((flow) => flow.openapi_spec_id === SKLEP_WORLD_IDS.spec).length;
    expect(pinned).toBeGreaterThan(0);
    const { text, data } = await ok(r, { openapi: join(root, 'loadcraft', 'openapi.json') });
    expect(data.flowsOnPrevious).toBe(pinned);
    expect(data.notes).toEqual(['profile_and_test_types_not_refreshed']);
    await expect(text).toMatchFileSnapshot('__snapshots__/updateOpenapi.stale.en.txt');
    const pl = await rig('pl', { pinned: true, staleTypes: true });
    const plRoot = withWorktree(pl, documentOf(worldEndpoints(pl.fake), NEW_COMMIT, true));
    const polish = await ok(pl, { openapi: join(plRoot, 'loadcraft', 'openapi.json') });
    expect(polish.text).toContain('profil i typy testów nie są odświeżane automatycznie');
  });

  it('two imports in a row: the flows still on the first version are named after the second, with the next step and a warning in the state', async () => {
    const r = await rig('en', { pinned: true });
    const flows = r.fake.store.collection<{ id: string; name: string }>(SKLEP_COLLECTIONS.flows);
    // one flow has no pin (it reads the current version), two stay on the version the project had
    flows.update(SKLEP_WORLD_IDS.flowPrzegladanie, { openapi_spec_id: null } as never);
    const first = withWorktree(r, documentOf(worldEndpoints(r.fake), NEW_COMMIT, true));
    await ok(r, { openapi: join(first, 'loadcraft', 'openapi.json') });
    writeFileSync(
      join(first, 'loadcraft', 'openapi.json'),
      documentOf(worldEndpoints(r.fake), THIRD_COMMIT, false),
    );
    const { text, data } = await ok(r, { openapi: join(first, 'loadcraft', 'openapi.json') });
    expect(data.flowsOnPrevious).toBe(2);
    expect(data.oldFlows).toEqual(['konto', 'zakupy']);
    expect(text).toContain('konto, zakupy');
    expect(text).toMatch(/→ [^\n]*flows_migrate_docs[^\n]*preview: true/u);
    const problems = processOf(r).problems.filter((p) => p.code === 'flows_on_old_docs');
    expect(problems).toHaveLength(1);
    expect(problems[0]?.severity).toBe('warning');
    expect([...(problems[0]?.flow_ids ?? [])].sort()).toEqual(
      [SKLEP_WORLD_IDS.flowKonto, SKLEP_IDS.flowZakupy].sort(),
    );
  });

  it('reads the pin of the flows when the server reports no spec_status (an older server)', async () => {
    const r = await rig('en', { pinned: true });
    withoutSpecStatus(r.fake);
    const root = withWorktree(r, documentOf(worldEndpoints(r.fake), NEW_COMMIT, true));
    const { data } = await ok(r, { openapi: join(root, 'loadcraft', 'openapi.json') });
    expect(data.flowsOnPrevious).toBe(3);
    expect(data.oldFlows).toEqual(['konto', 'przeglądanie', 'zakupy']);
  });

  it('a third import that leaves no flow on an older version clears the warning', async () => {
    const r = await rig('en', { pinned: true });
    const root = withWorktree(r, documentOf(worldEndpoints(r.fake), NEW_COMMIT, true));
    await ok(r, { openapi: join(root, 'loadcraft', 'openapi.json') });
    expect(processOf(r).problems.map((p) => p.code)).toContain('flows_on_old_docs');
    const flows = r.fake.store.collection<{ id: string }>(SKLEP_COLLECTIONS.flows);
    for (const flow of flows.list()) flows.update(flow.id, { openapi_spec_id: null });
    writeFileSync(
      join(root, 'loadcraft', 'openapi.json'),
      documentOf(worldEndpoints(r.fake), THIRD_COMMIT, false),
    );
    const { text, data } = await ok(r, { openapi: join(root, 'loadcraft', 'openapi.json') });
    expect(data.flowsOnPrevious).toBe(0);
    expect(data.oldFlows).toBeUndefined();
    expect(text).not.toContain('flows_migrate_docs');
    expect(processOf(r).problems.map((p) => p.code)).not.toContain('flows_on_old_docs');
  });

  it('refuses a file outside the project directory and every working tree', async () => {
    const r = await rig('en');
    withWorktree(r, documentOf(worldEndpoints(r.fake), NEW_COMMIT, true));
    const elsewhere = mkdtempSync(join(tmpdir(), 'lc-else-'));
    onTestFinished(() => rmSync(elsewhere, { recursive: true, force: true }));
    writeFileSync(join(elsewhere, 'openapi.json'), documentOf([], NEW_COMMIT, true));
    const result = await r.call('project_import_docs', {
      openapi: join(elsewhere, 'openapi.json'),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('working tree');
    expect(result.text).toContain('→');
    expect(uploads(r)).toEqual([]);
    expect(result.text).not.toContain(elsewhere);
  });

  it('refuses a path outside the project directory when there is no git repository', async () => {
    const r = await rig('en');
    const elsewhere = mkdtempSync(join(tmpdir(), 'lc-else-'));
    onTestFinished(() => rmSync(elsewhere, { recursive: true, force: true }));
    writeFileSync(join(elsewhere, 'openapi.json'), documentOf([], NEW_COMMIT, true));
    const result = await r.call('project_import_docs', {
      openapi: join(elsewhere, 'openapi.json'),
    });
    expect(result.isError).toBe(true);
    expect(uploads(r)).toEqual([]);
  });

  it('names a file that is not JSON and sends nothing', async () => {
    const r = await rig('en', {}, { ...BOUND, 'loadcraft/openapi.json': 'openapi: 3.0.3\n' });
    const result = await r.call('project_import_docs', { openapi: 'loadcraft/openapi.json' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('not valid JSON');
    expect(result.text).toContain('→');
    expect(uploads(r)).toEqual([]);
  });

  it('renders the golden file from the golden data alone', () => {
    expect(`${renderUpdateOpenapi(goldenView(), createTranslator('pl'))}\n`).toBe(
      goldenText('run5', '03-project_import_docs'),
    );
  });

  it('turns 401 into the invalid-token error with its hint', async () => {
    const r = await rig(
      'en',
      {},
      { ...BOUND, 'loadcraft/openapi.json': documentOf([], NEW_COMMIT, true) },
    );
    r.fake.faults.next('POST', UPLOAD, { status: 401, body: { detail: 'Invalid token' } });
    const result = await r.call('project_import_docs', { openapi: 'loadcraft/openapi.json' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft did not accept the API token');
  });

  it('refuses a backend without /meta as too old', async () => {
    const r = await rig(
      'en',
      {},
      { ...BOUND, 'loadcraft/openapi.json': documentOf([], NEW_COMMIT, true) },
    );
    r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const result = await r.call('project_import_docs', { openapi: 'loadcraft/openapi.json' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('older than the plugin supports');
    expect(uploads(r)).toEqual([]);
  });

  it('asks for project_create when the directory is not bound and sends nothing', async () => {
    const r = await rig('en', {}, { 'loadcraft/openapi.json': documentOf([], NEW_COMMIT, true) });
    const result = await r.call('project_import_docs', { openapi: 'loadcraft/openapi.json' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('project_create');
    expect(uploads(r)).toEqual([]);
  });

  it.each([
    ['in the project directory', false],
    ['in another working tree', true],
  ])('refuses JSON that is not an OpenAPI document %s and sends nothing', async (_where, tree) => {
    const r = await rig('en', {}, { ...BOUND, 'loadcraft/other.json': '{"a":1}' });
    let path = 'loadcraft/other.json';
    if (tree) {
      const root = withWorktree(r, '{"a":1}');
      path = join(root, 'loadcraft', 'openapi.json');
    }
    const result = await r.call('project_import_docs', { openapi: path });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('not an OpenAPI document');
    expect(result.text).toContain('→');
    expect(uploads(r)).toEqual([]);
  });

  it('refuses a document with a version but no body, and in Polish', async () => {
    const r = await rig('pl', {}, { ...BOUND, 'loadcraft/o.json': '{"openapi":"3.0.3"}' });
    const result = await r.call('project_import_docs', { openapi: 'loadcraft/o.json' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('nie dokument OpenAPI');
    expect(uploads(r)).toEqual([]);
  });

  it("does not take a forged working tree for the repository's own", async () => {
    const r = await rig('en');
    withWorktree(r, documentOf([], NEW_COMMIT, true));
    const victim = mkdtempSync(join(tmpdir(), 'lc-victim-'));
    onTestFinished(() => rmSync(victim, { recursive: true, force: true }));
    writeFileSync(join(victim, 'credentials.json'), '{"openapi":"3.0.3","paths":{}}');
    const meta = join(r.workspace, '.git', 'worktrees', 'evil');
    mkdirSync(meta, { recursive: true });
    writeFileSync(join(meta, 'gitdir'), `${join(victim, '.git')}\n`);
    writeFileSync(join(meta, 'HEAD'), 'ref: refs/heads/qa\n');
    writeFileSync(join(meta, 'commondir'), '../..\n');
    const result = await r.call('project_import_docs', {
      openapi: join(victim, 'credentials.json'),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('working tree');
    expect(uploads(r)).toEqual([]);
  });

  it('reports a probe that failed and keeps the upload', async () => {
    const r = await rig('en');
    const root = withWorktree(r, documentOf(worldEndpoints(r.fake), NEW_COMMIT, true));
    r.fake.faults.next(
      'POST',
      `/api/v1/projects/${SKLEP_IDS.project}/environments/${SKLEP_WORLD_IDS.environments.qa}/conformance`,
      { status: 502, body: { detail: 'target unreachable' } },
    );
    const { text, data } = await ok(r, {
      openapi: join(root, 'loadcraft', 'openapi.json'),
      environment: 'qa',
    });
    expect(data.changed).toBe(true);
    expect(data.conformance).toEqual({ environment: 'qa', result: { state: 'failed' } });
    expect(uploads(r)).toHaveLength(1);
    expect(text).toContain('check failed');
  });

  it.each([
    [0, 100_000],
    [30_000, 70_000],
    [99_000, 5_000],
    [250_000, 5_000],
  ])('gives the probe what is left of the 100 s call budget (%i ms used)', (used, left) => {
    expect(probeBudgetMs(used)).toBe(left);
  });

  it('keeps the canary in the document out of the result, the log and the workspace', async () => {
    const r = await rig('en');
    const root = withWorktree(
      r,
      documentOf(worldEndpoints(r.fake), NEW_COMMIT, true, `token ${CANARY}`),
    );
    await ok(r, { openapi: join(root, 'loadcraft', 'openapi.json') });
    r.assertClean();
  });

  describe('refuses what is not an API document, sending nothing', () => {
    const KEY = JSON.stringify({
      type: 'service_account',
      private_key: `-----BEGIN PRIVATE KEY-----\n${FILE_CANARY}\n-----END PRIVATE KEY-----\n`,
    });

    it('a JSON file that is not an OpenAPI document', async () => {
      const r = await rig('en', {}, { ...BOUND, 'deploy/key.json': KEY });
      const result = await r.call('project_import_docs', { openapi: 'deploy/key.json' });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('[openapi_not_openapi]');
      expect(uploads(r)).toEqual([]);
      assertNoCanary(result.text);
    });

    it('a valid document in a hidden directory', async () => {
      const r = await rig(
        'en',
        {},
        { ...BOUND, '.cache/openapi.json': documentOf([], NEW_COMMIT, true) },
      );
      const result = await r.call('project_import_docs', { openapi: '.cache/openapi.json' });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('[document_path_excluded]');
      expect(uploads(r)).toEqual([]);
    });
  });
});
