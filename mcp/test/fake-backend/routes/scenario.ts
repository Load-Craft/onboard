// Routes of the read tools of module scenario (src/tools/scenario/) that no other route file answers:
// the variable contract of a scenario, the drift score a check cached for it, its versions and the copilot histories (a scenario's and the
// traffic-split planner's). The detail and the
// list of scenarios are answered by `routes/data.ts` and `routes/lookup.ts`. Registration is
// idempotent per fake.

import type { components } from '../../../src/http/generated/api.js';
import type { OpOutput } from '../../../src/http/operation.js';
import { FakeHttpError, type Fake } from '../server.js';
import { HEALTH_CHECKS } from './healthCheck.js';
import { SKLEP_COLLECTIONS, type SklepComposition, type SklepScenario } from '../worlds/sklep.js';

type Staleness = components['schemas']['StalenessResponse'];

/** The drift scores cached per scenario. */
export const STALENESS = 'scenario_staleness';

interface StoredStaleness {
  readonly id: string;
  readonly answer: Staleness;
}

/** Caches a drift score for a scenario; a scenario without one answers 404, as the backend does. */
export function seedStaleness(
  fake: Fake,
  scenarioId: string,
  fields: Partial<Staleness> & Pick<Staleness, 'staleness_score'>,
): void {
  fake.store.collection<StoredStaleness>(STALENESS).insert({
    id: scenarioId,
    answer: { cached: true, checked_at: '2026-11-25T08:00:00Z', ...fields },
  });
}

/** The versions of scenarios; a test seeds them with `seedScenarioVersions`. */
export const SCENARIO_VERSIONS = 'scenario_versions';

export interface SeededVersion {
  readonly version: number;
  readonly change_reason?: string | null;
  readonly created_at?: string | null;
  readonly has_artifact_snapshot?: boolean;
  readonly truncate_after_block_id_snapshot?: string | null;
  /** The artifact as saved, unmasked; null as pre-modular versions have it. */
  readonly artifact?: Record<string, unknown> | null;
}

interface StoredVersion extends SeededVersion {
  readonly id: string;
  readonly scenario_id: string;
}

/** Stores the versions of a scenario, as the backend lists them for it. */
export function seedScenarioVersions(
  fake: Fake,
  scenarioId: string,
  versions: readonly SeededVersion[],
): void {
  const collection = fake.store.collection<StoredVersion>(SCENARIO_VERSIONS);
  for (const entry of versions) {
    const tail = scenarioId.slice(-12);
    collection.insert({
      ...entry,
      id: `${entry.version.toString(16).padStart(8, '0')}-0000-4000-8000-${tail}`,
      scenario_id: scenarioId,
    });
  }
}

/** The saved conversations: of a scenario's copilot (`scenario_id`) or of a planner draft (`draft_id`). */
export const COPILOT_HISTORY = 'copilot_history';

export interface SeededMessage {
  readonly role: string;
  readonly content: string;
  /** Planner messages: the kind and whether a plan was proposed. */
  readonly kind?: string | null;
  readonly chips?: readonly string[];
  readonly proposal?: components['schemas']['GenerationPlanProposal'] | null;
  /** Scenario copilot messages: the actions it proposed. */
  readonly actions?: components['schemas']['backend__api__routes__scenario_detail_copilot__HistoryMessage']['actions'];
}

interface StoredConversation {
  readonly id: string;
  readonly messages: readonly SeededMessage[];
}

/** Stores a conversation under the id of the scenario or of the planner draft it belongs to. */
export function seedCopilotHistory(
  fake: Fake,
  id: string,
  messages: readonly SeededMessage[],
): void {
  fake.store.collection<StoredConversation>(COPILOT_HISTORY).insert({ id, messages });
}

/** The ZIP a scenario exports; without a seeded one the route answers a small archive. */
export const SCENARIO_EXPORTS = 'scenario_exports';

/** The default archive: the magic of a ZIP and a few bytes, enough to be saved and compared. */
export const DEFAULT_EXPORT = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('scenario project'),
]);

/** Sets the bytes the export of a scenario returns. */
export function seedScenarioExport(fake: Fake, scenarioId: string, bytes: Buffer): void {
  fake.store.collection<{ id: string; bytes: Buffer }>(SCENARIO_EXPORTS).insert({
    id: scenarioId,
    bytes,
  });
}

/** The built-in scenario templates the fake holds: one record per template file. */
export const FAKE_TEMPLATES = 'fake_templates';

type TemplateFile = OpOutput<'get_template_api_v1_templates__template_id__get'>;

interface StoredTemplate {
  readonly id: string;
  readonly template: TemplateFile;
}

/** Seeds whole template files, as LoadCraft ships them. */
export function seedTemplates(fake: Fake, templates: readonly TemplateFile[]): void {
  const collection = fake.store.collection<StoredTemplate>(FAKE_TEMPLATES);
  for (const template of templates) collection.insert({ id: template.id ?? '', template });
}

/** The generated Gatling project of compositions: path to text. */
export const COMPOSITION_FILES = 'composition_files';

/** The project every composition has until a test seeds its own files. */
export const DEFAULT_PROJECT_FILES: Readonly<Record<string, string>> = {
  'build.gradle': "plugins { id 'io.gatling.gradle' }\n",
  'src/gatling/scala/Simulation.scala': 'class Simulation extends Simulation {}\n',
  'src/gatling/resources/gatling.conf': 'gatling { core { } }\n',
};

/** Sets the files of the generated project of a composition. */
export function seedCompositionFiles(
  fake: Fake,
  compositionId: string,
  files: Readonly<Record<string, string>>,
): void {
  fake.store
    .collection<{ id: string; files: Readonly<Record<string, string>> }>(COMPOSITION_FILES)
    .insert({ id: compositionId, files });
}

type TreeNode = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size_bytes?: number;
  children?: TreeNode[];
};

/** The tree of paths as the backend gives it: directories first, then by name. */
function treeOf(files: Readonly<Record<string, string>>): TreeNode {
  const root: TreeNode = { name: '', path: '', type: 'directory', children: [] };
  for (const [path, text] of Object.entries(files)) {
    let node = root;
    const parts = path.split('/');
    parts.forEach((part, index) => {
      const here = parts.slice(0, index + 1).join('/');
      const last = index === parts.length - 1;
      let child = node.children?.find((candidate) => candidate.name === part);
      if (child === undefined) {
        child = last
          ? { name: part, path: here, type: 'file', size_bytes: Buffer.byteLength(text) }
          : { name: part, path: here, type: 'directory', children: [] };
        node.children = [...(node.children ?? []), child];
      }
      node = child;
    });
  }
  const order = (a: TreeNode, b: TreeNode): number =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1;
  const sort = (node: TreeNode): void => {
    node.children?.sort(order);
    node.children?.forEach(sort);
  };
  sort(root);
  return root;
}

const registered = new WeakSet<Fake>();

export function registerScenarioReadRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/contract',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      const scenario = store
        .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
        .require(req.params.scenario_id, 'Scenario not found');
      return {
        status: 200,
        body: {
          artifact_version: scenario.artifact_version,
          contract_v2: { ...scenario.scenario_contract_v2 },
          input_variables: [],
          output_variables: [],
          scenario_id: scenario.id,
          scenario_name: scenario.name,
        },
      };
    },
  );

  fake.route('GET', '/api/scenarios/{scenario_id}/staleness', (req, store, jobs) => {
    const stored = store
      .collection<StoredStaleness>(STALENESS)
      .list((entry) => entry.id === req.params.scenario_id)[0];
    if (stored !== undefined) return { status: 200, body: { ...stored.answer } };
    // the score of the latest check of the scenario that ran to its end (the backend caches it in memory)
    const finished = store
      .collection<{
        id: string;
        scenario_id: string;
        job: string;
        score: number | null;
        checked_at: string;
      }>(HEALTH_CHECKS)
      .list(
        (check) =>
          check.scenario_id === req.params.scenario_id &&
          check.score !== null &&
          jobs.find<string>(check.job)?.state === 'done',
      )
      .at(-1);
    if (finished?.score == null) throw new FakeHttpError(404, { detail: 'No staleness result' });
    return {
      status: 200,
      body: { cached: true, checked_at: finished.checked_at, staleness_score: finished.score },
    };
  });

  const BASE = '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/versions';

  const stored = (store: Fake['store'], scenarioId: string): StoredVersion[] =>
    store
      .collection<StoredVersion>(SCENARIO_VERSIONS)
      .list((entry) => entry.scenario_id === scenarioId);

  const guard = (store: Fake['store'], params: Readonly<Record<string, string>>): void => {
    store
      .collection(SKLEP_COLLECTIONS.projects)
      .require(params['project_id'] ?? '', `Project not found: ${params['project_id'] ?? ''}`);
    store
      .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
      .require(params['scenario_id'] ?? '', 'Scenario not found');
  };

  fake.route('GET', BASE, (req, store) => {
    guard(store, req.params);
    return {
      status: 200,
      body: {
        versions: stored(store, req.params.scenario_id).map((entry) => ({
          change_reason: entry.change_reason ?? null,
          created_at: entry.created_at ?? '2026-11-20T10:00:00Z',
          has_artifact_snapshot: entry.has_artifact_snapshot ?? true,
          id: entry.id,
          scenario_id: entry.scenario_id,
          truncate_after_block_id_snapshot: entry.truncate_after_block_id_snapshot ?? null,
          version: entry.version,
        })),
      },
    };
  });

  fake.route('GET', `${BASE}/{version}`, (req, store) => {
    guard(store, req.params);
    const entry = stored(store, req.params.scenario_id).find(
      (candidate) => String(candidate.version) === req.params.version,
    );
    if (entry === undefined) throw new FakeHttpError(404, { detail: 'Version not found' });
    return {
      status: 200,
      body: {
        change_reason: entry.change_reason ?? null,
        created_at: entry.created_at ?? '2026-11-20T10:00:00Z',
        id: entry.id,
        scenario_artifact_snapshot: entry.artifact ?? null,
        scenario_id: entry.scenario_id,
        truncate_after_block_id_snapshot: entry.truncate_after_block_id_snapshot ?? null,
        version: entry.version,
      },
    };
  });

  const conversation = (store: Fake['store'], id: string): readonly SeededMessage[] =>
    store.collection<StoredConversation>(COPILOT_HISTORY).get(id)?.messages ?? [];

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/copilot/history',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      store
        .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
        .require(req.params.scenario_id, 'Scenario not found');
      return {
        status: 200,
        body: {
          messages: conversation(store, req.params.scenario_id).map((message) => ({
            role: message.role,
            content: message.content,
            actions: message.actions ?? null,
          })),
        },
      };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/scenario-builder/{draft_id}/history',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      return {
        status: 200,
        body: {
          messages: conversation(store, req.params.draft_id).map((message) => ({
            role: message.role,
            content: message.content,
            kind: message.kind ?? null,
            chips: [...(message.chips ?? [])],
            proposal: message.proposal ?? null,
          })),
        },
      };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/export',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      store
        .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
        .require(req.params.scenario_id, 'Scenario not found');
      const seeded = store
        .collection<{ id: string; bytes: Buffer }>(SCENARIO_EXPORTS)
        .get(req.params.scenario_id);
      return {
        status: 200,
        body: seeded?.bytes ?? DEFAULT_EXPORT,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="scenario-${req.params.scenario_id.slice(0, 8)}-export.zip"`,
        },
      };
    },
  );

  fake.route('GET', '/api/v1/templates', (_req, store) => {
    const templates = store
      .collection<StoredTemplate>(FAKE_TEMPLATES)
      .list()
      .map(({ template }) => ({
        id: template.id ?? '',
        name: template.name ?? '',
        description: template.description ?? '',
        category: template.category ?? '',
        difficulty: template.difficulty ?? '',
        scenario_count: (template.scenarios ?? []).length,
        tags: template.tags ?? [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const distinct = (values: readonly string[]): string[] =>
      [...new Set(values.filter((value) => value !== ''))].sort();
    return {
      status: 200,
      body: {
        templates,
        total: templates.length,
        available_categories: distinct(templates.map((item) => item.category)),
        available_difficulties: distinct(templates.map((item) => item.difficulty)),
      },
    };
  });

  fake.route('GET', '/api/v1/templates/{template_id}', (req, store) => {
    const stored = store
      .collection<StoredTemplate>(FAKE_TEMPLATES)
      .require(req.params.template_id, 'Template not found');
    return { status: 200, body: stored.template };
  });

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/templates/{template_id}/instantiate',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, 'Project not found');
      const { template } = store
        .collection<StoredTemplate>(FAKE_TEMPLATES)
        .require(req.params.template_id, 'Template not found');
      return {
        status: 201,
        body: {
          template_id: req.params.template_id,
          template_name: template.name ?? '',
          composition: { ...template.default_composition, project_id: req.params.project_id },
          scenarios: (template.scenarios ?? []).map((one) => ({
            name: one.name ?? '',
            description: one.description ?? '',
            stub_scala: one.stub_scala ?? '',
            inputs: one.inputs ?? [],
            outputs: one.outputs ?? [],
          })),
          feeder_schemas: template.feeder_schemas ?? [],
        },
      };
    },
  );

  const COMPOSITION = '/api/v1/projects/{project_id}/gatling/compositions/{composition_id}';

  const filesOf = (
    store: Fake['store'],
    params: Readonly<Record<string, string>>,
  ): Readonly<Record<string, string>> => {
    store
      .collection(SKLEP_COLLECTIONS.projects)
      .require(params['project_id'] ?? '', `Project not found: ${params['project_id'] ?? ''}`);
    store
      .collection(SKLEP_COLLECTIONS.compositions)
      .require(params['composition_id'] ?? '', 'Composition not found');
    return (
      store
        .collection<{ id: string; files: Readonly<Record<string, string>> }>(COMPOSITION_FILES)
        .get(params['composition_id'] ?? '')?.files ?? DEFAULT_PROJECT_FILES
    );
  };

  fake.route('GET', `${COMPOSITION}/project-structure`, (req, store) => ({
    status: 200,
    body: { root: treeOf(filesOf(store, req.params)) },
  }));

  fake.route('GET', `${COMPOSITION}/file-content`, (req, store) => {
    const files = filesOf(store, req.params);
    const path = req.query['path'] ?? '';
    const text = files[path];
    if (text === undefined) throw new FakeHttpError(404, { detail: `File not found: ${path}` });
    const language = path.endsWith('.scala')
      ? ('scala' as const)
      : path.endsWith('.conf')
        ? ('hocon' as const)
        : path.endsWith('.json')
          ? ('json' as const)
          : ('text' as const);
    return { status: 200, body: { content: text, language, path } };
  });

  // The check answers the validation the composition stores; a test sets the verdict it wants by
  // editing the composition in the store.
  fake.route('POST', `${COMPOSITION}/validate`, (req, store) => {
    store
      .collection(SKLEP_COLLECTIONS.projects)
      .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
    const composition = store
      .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
      .require(req.params.composition_id, 'Composition not found');
    return { status: 200, body: { ...composition.validation } };
  });
}
