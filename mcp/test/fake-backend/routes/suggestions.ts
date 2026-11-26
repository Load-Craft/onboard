// Flow-suggestion routes of the fake backend (`api/routes/flow_suggestions.py`): the free heuristic
// answer, the refine call with its two modes (an answer from the backend's cache, or a background
// job followed over the `refine` channel), and the read of the project's OpenAPI document that
// names the operations. The job lives on the test clock; the channel behaves as the real one, so a
// job nobody listens to is cancelled after 45 s (see `ws.ts`).
//
// The proposals name operations of the sklep world by `operationId`. A current document those
// operations are not all in (a customer's own documentation in the stand-alone fake) gets proposals
// built from its own tags and paths instead (`worlds/document.ts`); any other document keeps the
// world's.

import type { components } from '../../../src/http/generated/api.js';
import {
  FakeHttpError,
  type Fake,
  type JobEmission,
  type Store,
  type WireFrame,
} from '../server.js';
import { documentJourneys, isForeignDocument, type DocumentJourney } from '../worlds/document.js';
import { SKLEP_COLLECTIONS, type SklepEndpoint } from '../worlds/sklep.js';
import { currentSpec, operationsOf } from './setup.js';
import { idleWhile } from '../../helpers/clock.js';

type FlowSuggestionsResponse = components['schemas']['FlowSuggestionsResponse'];
type RefineResponse = components['schemas']['RefineResponse'];
type SuggestedBasket = components['schemas']['SuggestedBasket'];
type RefineUnit = components['schemas']['RefineUnit'];
type OpenAPISpecDetailResponse = components['schemas']['OpenAPISpecDetailResponse'];

const registeredOpenapi = new WeakSet<Fake>();
const registeredSuggestions = new WeakMap<Fake, SuggestionHandles>();

/**
 * `GET …/openapi` (`api/routes/projects.py`): the current specification of the project with its
 * operations. 404 while the project has no specification; the sklep world has one from the
 * `project` stage on.
 */
export function registerOpenapiReadRoute(fake: Fake): void {
  if (registeredOpenapi.has(fake)) return;
  registeredOpenapi.add(fake);
  fake.route('GET', '/api/v1/projects/{project_id}/openapi', (req, store) => {
    store
      .collection(SKLEP_COLLECTIONS.projects)
      .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
    const spec = currentSpec(store, req.params.project_id);
    if (spec === undefined) {
      throw new FakeHttpError(404, { detail: 'OpenAPI spec not found' });
    }
    const body: OpenAPISpecDetailResponse = {
      id: spec.id,
      project_id: req.params.project_id,
      title: spec.title,
      version: spec.version,
      uploaded_at: spec.created_at,
      source_url: null,
      spec_content: spec.spec_content ?? { openapi: '3.0.3', paths: {} },
      endpoints: operationsOf(store, spec.id).map((endpoint) => ({
        id: endpoint.id,
        method: endpoint.method,
        path: endpoint.path,
        operation_id: endpoint.operation_id,
        summary: endpoint.summary,
        tags: endpoint.tags,
        parameters: [],
        responses: [],
      })),
    };
    return { status: 200, body };
  });
}

// ---- the world of the suggestions ---------------------------------------------------------

/** A proposal as the fake builds it from operations of the sklep world, by `operationId`. */
export interface BasketSeed {
  readonly name: string;
  readonly description: string;
  readonly operations: readonly string[];
  readonly pattern?: string;
  readonly confidence?: number;
}

export interface RefineProgress {
  /** Milliseconds after the job started. */
  readonly afterMs: number;
  readonly label: string;
  readonly described: number;
  readonly total: number;
  readonly progress: number;
}

export interface SuggestionWorld {
  /** What the free heuristic proposes. */
  readonly heuristic: readonly BasketSeed[];
  /** What a finished refinement proposes (the channel's `complete` frame and the backend's cache). */
  readonly refined: readonly BasketSeed[];
  /** Units the refinement could not finish. */
  readonly failedUnits?: readonly string[];
  /** The refinement is in the backend's cache: `POST …/refine` answers at once and starts nothing. */
  readonly cached?: boolean;
  /** Milliseconds the job needs; default 20 s. */
  readonly durationMs?: number;
  readonly progress?: readonly RefineProgress[];
  /** The job ends with a `cancelled` frame instead of a result. */
  readonly cancelled?: boolean;
  /** A backend that forgot its jobs: every refine POST (without a cached result) starts a new one. */
  readonly forgetsJobs?: boolean;
  /** Called with the number of the refine POST (1-based) before it is answered. */
  readonly onRefinePost?: (count: number) => void;
  /** From the second refine POST on, the answer joins a job of another session with this id. */
  readonly foreignJobId?: string;
  /** Called (and awaited) when a cancel request arrives, before it is answered. */
  readonly onRefineCancel?: () => Promise<void>;
  /** The job ends with an `error` frame instead of a result. */
  readonly failure?: { readonly error: string; readonly recoverable: boolean };
}

/** The proposals of the sklep world: four journeys, refined with progress, 20 s of work. */
export const SKLEP_SUGGESTIONS: SuggestionWorld = {
  heuristic: [
    {
      name: 'cart and orders',
      description: 'Everything around the cart and the orders of the shop.',
      operations: ['get_cart', 'checkout'],
      pattern: 'tag_group',
      confidence: 0.7,
    },
  ],
  refined: [
    {
      name: 'zakupy',
      description: 'Log in, search for a product, add it to the cart and place the order.',
      operations: ['login', 'search_products', 'add_cart_item', 'checkout'],
    },
    {
      name: 'przeglądanie',
      description: 'Browse the categories and open a product page.',
      operations: ['list_categories', 'get_product'],
    },
    {
      name: 'konto',
      description: 'Log in and look at the orders of the account.',
      operations: ['login', 'list_orders'],
    },
    {
      name: 'status zamówienia',
      description: 'Place an order and poll its status until it is done.',
      operations: ['checkout', 'get_order_status'],
      pattern: 'async_polling',
    },
  ],
  progress: [
    { afterMs: 5000, label: 'Describing journeys', described: 4, total: 10, progress: 40 },
    { afterMs: 12000, label: 'Describing journeys', described: 9, total: 10, progress: 90 },
  ],
};

/** Every operation the proposals of `world` name. */
function operationsOfWorld(world: SuggestionWorld): string[] {
  return [...world.heuristic, ...world.refined].flatMap((seed) => seed.operations);
}

/**
 * The project's current document is not one the `sklep` world's journeys can be built from: the
 * fake builds the world from the document instead (`worlds/document.ts`).
 */
export function documentIsForeign(store: Store): boolean {
  return isForeignDocument(store, operationsOfWorld(SKLEP_SUGGESTIONS));
}

export interface SuggestionHandles {
  /** Ids of the refine jobs started so far, oldest first. */
  readonly jobs: readonly string[];
}

const DEFAULT_DURATION_MS = 20_000;
const HASH = 'a41f9c2e';

function endpointIdOf(endpoints: readonly SklepEndpoint[], operationId: string): string {
  const found = endpoints.find((endpoint) => endpoint.operation_id === operationId);
  if (found === undefined) throw new Error(`suggestions world: no operation "${operationId}"`);
  return found.id;
}

function baskets(
  endpoints: readonly SklepEndpoint[],
  seeds: readonly BasketSeed[],
  prefix: string,
): SuggestedBasket[] {
  return seeds.map((seed, index) => ({
    basket_id: `${prefix}-${String(index + 1)}`,
    name: seed.name,
    description: seed.description,
    endpoint_ids: seed.operations.map((operationId) => endpointIdOf(endpoints, operationId)),
    tags: ['sklep'],
    confidence: seed.confidence ?? 0.8,
    pattern_type: seed.pattern ?? 'semantic',
    reasoning: `${seed.name}: one user goal`,
    chain_areas: [],
  }));
}

function documentBaskets(journeys: readonly DocumentJourney[], prefix: string): SuggestedBasket[] {
  return journeys.map((journey, index) => ({
    basket_id: `${prefix}-${String(index + 1)}`,
    name: journey.name,
    description: journey.description,
    endpoint_ids: [...journey.endpointIds],
    tags: [journey.area],
    confidence: journey.confidence,
    pattern_type: journey.pattern,
    reasoning: `${journey.name}: one user goal`,
    chain_areas: [],
  }));
}

function documentCoverage(
  endpoints: readonly SklepEndpoint[],
  journeys: readonly DocumentJourney[],
): Pick<FlowSuggestionsResponse, 'total_endpoints_covered' | 'uncovered_endpoint_ids'> {
  const used = new Set(journeys.flatMap((journey) => journey.endpointIds));
  return {
    total_endpoints_covered: used.size,
    uncovered_endpoint_ids: endpoints
      .filter((endpoint) => !used.has(endpoint.id))
      .map((endpoint) => endpoint.id),
  };
}

function documentUnits(areas: readonly { name: string; operations: number }[]): RefineUnit[] {
  return areas
    .filter((area, index) => areas.findIndex((other) => other.name === area.name) === index)
    .map((area) => ({
      key: `area:${area.name}`,
      kind: 'area',
      name: area.name,
      area: area.name,
      status: 'done',
      reason: null,
      reason_code: null,
      recoverable: false,
      operation_count: area.operations,
    }));
}

function coverage(
  endpoints: readonly SklepEndpoint[],
  seeds: readonly BasketSeed[],
): Pick<FlowSuggestionsResponse, 'total_endpoints_covered' | 'uncovered_endpoint_ids'> {
  const used = new Set(seeds.flatMap((seed) => seed.operations));
  return {
    total_endpoints_covered: used.size,
    uncovered_endpoint_ids: endpoints
      .filter((endpoint) => !used.has(endpoint.operation_id ?? ''))
      .map((endpoint) => endpoint.id),
  };
}

function units(world: SuggestionWorld): RefineUnit[] {
  const failed = (world.failedUnits ?? []).map((name): RefineUnit => ({
    key: `area:${name}`,
    kind: 'area',
    name,
    area: name,
    status: 'failed',
    reason: 'The model answered with something unusable.',
    reason_code: 'answer_unusable',
    recoverable: true,
    operation_count: 4,
  }));
  const done: RefineUnit = {
    key: 'area:shop',
    kind: 'area',
    name: 'shop',
    area: 'shop',
    status: 'done',
    reason: null,
    reason_code: null,
    recoverable: false,
    operation_count: 12,
  };
  return [done, ...failed];
}

/**
 * Registers `POST …/flow-suggestions/heuristic` and `…/refine` over the sklep world, and the
 * OpenAPI read they depend on. Returns the ids of the jobs it starts.
 */
export function registerSuggestionRoutes(
  fake: Fake,
  world: SuggestionWorld = SKLEP_SUGGESTIONS,
): SuggestionHandles {
  const known = registeredSuggestions.get(fake);
  if (known !== undefined) return known;
  registerOpenapiReadRoute(fake);
  const jobs: string[] = [];
  let posts = 0;
  const durationMs = world.durationMs ?? DEFAULT_DURATION_MS;

  // The operations of the current specification: after a new revision of the documentation the
  // proposals name the operations of that revision, not of the one it replaced.
  const endpointsOf = (store: Store): SklepEndpoint[] => {
    const [project] = store.collection<{ id: string }>(SKLEP_COLLECTIONS.projects).list();
    const spec = project === undefined ? undefined : currentSpec(store, project.id);
    return spec === undefined
      ? store.collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints).list()
      : operationsOf(store, spec.id);
  };

  /** `Project not found` / `Project has no OpenAPI spec`, as the router checks them first. */
  const checkProject = (store: Store, projectId: string): void => {
    store
      .collection(SKLEP_COLLECTIONS.projects)
      .require(projectId, `Project not found: ${projectId}`);
    if (store.collection(SKLEP_COLLECTIONS.specs).size === 0) {
      throw new FakeHttpError(400, { detail: 'Project has no OpenAPI spec' });
    }
  };

  // A document the world's proposals cannot be built from gets proposals of its own.
  const documentOf = (endpoints: readonly SklepEndpoint[]) => {
    const known = new Set(endpoints.map((endpoint) => endpoint.operation_id));
    const resolves = operationsOfWorld(world).every((id) => known.has(id));
    return resolves || endpoints.length === 0 ? undefined : documentJourneys(endpoints);
  };

  const refinedAnswer = (store: Store, fromCache: boolean): RefineResponse => {
    const endpoints = endpointsOf(store);
    const document = documentOf(endpoints);
    return {
      ...(document === undefined
        ? {
            baskets: baskets(endpoints, world.refined, 'refined'),
            ...coverage(endpoints, world.refined),
            units: units(world),
          }
        : {
            baskets: documentBaskets(document.refined, 'refined'),
            ...documentCoverage(endpoints, document.refined),
            units: documentUnits(document.areas),
          }),
      omitted_journey_slices: [],
      from_cache: fromCache,
      cached_at: fromCache ? '2026-11-22T09:00:00Z' : null,
      openapi_hash: HASH,
      job_id: null,
      joined: false,
    };
  };

  fake.route('POST', '/api/v1/projects/{project_id}/flow-suggestions/heuristic', (req, store) => {
    checkProject(store, req.params.project_id);
    const endpoints = endpointsOf(store);
    const document = documentOf(endpoints);
    return {
      status: 200,
      body: {
        ...(document === undefined
          ? {
              baskets: baskets(endpoints, world.heuristic, 'heuristic'),
              ...coverage(endpoints, world.heuristic),
            }
          : {
              baskets: documentBaskets(document.heuristic, 'heuristic'),
              ...documentCoverage(endpoints, document.heuristic),
            }),
        omitted_journey_slices: [],
        units: [],
        from_cache: false,
        cached_at: null,
        openapi_hash: HASH,
      },
    };
  });

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/flow-suggestions/refine',
    (req, store, fakeJobs) => {
      checkProject(store, req.params.project_id);
      posts += 1;
      world.onRefinePost?.(posts);
      const force = isForce(req.body);
      if (!isForce(req.body) && world.foreignJobId !== undefined && posts > 1) {
        return { status: 200, body: bareJob(world.foreignJobId, true) };
      }
      const last = jobs[jobs.length - 1];
      const stub = last === undefined ? undefined : fake.channel('refine', { job_id: last });
      if (!force && stub?.status === 'running' && world.forgetsJobs !== true) {
        return { status: 200, body: bareJob(last ?? '', true) };
      }
      if (
        !force &&
        (world.cached === true || (world.failure === undefined && stub?.status === 'finished'))
      ) {
        return { status: 200, body: refinedAnswer(store, true) };
      }

      const job = fakeJobs.start('refine', {
        steps: [
          { afterMs: 0, state: 'running' },
          { afterMs: durationMs, state: 'ended' },
        ],
      });
      jobs.push(job.id);
      const frames: JobEmission[] = [
        ...(world.progress ?? []).map((step) => ({
          afterMs: step.afterMs,
          frame: progressFrame(job.id, step),
        })),
        { afterMs: durationMs, frame: endFrame(job.id, world, () => refinedAnswer(store, false)) },
      ];
      fake.channel('refine', { job_id: job.id }).attach(job, frames);
      return { status: 200, body: bareJob(job.id, false) };
    },
  );

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/flow-suggestions/refine/{job_id}/cancel',
    async (req, store, fakeJobs) => {
      checkProject(store, req.params.project_id);
      // A hook of the test: the clock may move while the fake waits for it.
      await idleWhile(Promise.resolve(world.onRefineCancel?.()));
      const jobId = req.params.job_id;
      const job = fakeJobs.find(jobId);
      if (job === undefined || job.finished) {
        throw new FakeHttpError(404, { detail: 'Refine job not found' });
      }
      fake.channel('refine', { job_id: jobId }).emit({
        type: 'flow-suggestions-refine:cancelled',
        payload: { job_id: jobId, status: 'cancelled' },
      });
      return {
        status: 200,
        body: { job_id: jobId, cancelled: true, status: 'cancelled', reason: 'user' },
      };
    },
  );

  const handles: SuggestionHandles = { jobs };
  registeredSuggestions.set(fake, handles);
  return handles;
}

function isForce(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'force' in body && body.force === true;
}

/** The answer that starts or joins a job: the identifier and nothing else. */
function bareJob(jobId: string, joined: boolean): RefineResponse {
  return { baskets: [], job_id: jobId, joined, from_cache: false, total_endpoints_covered: 0 };
}

function progressFrame(jobId: string, step: RefineProgress): WireFrame {
  return {
    type: 'flow-suggestions-refine:progress',
    payload: {
      job_id: jobId,
      status: 'running',
      progress: step.progress,
      current_step: 'describe',
      step_label: step.label,
      described: step.described,
      total: step.total,
    },
  };
}

function endFrame(jobId: string, world: SuggestionWorld, result: () => RefineResponse): WireFrame {
  if (world.cancelled === true) {
    return {
      type: 'flow-suggestions-refine:cancelled',
      payload: { job_id: jobId, status: 'cancelled' },
    };
  }
  if (world.failure !== undefined) {
    return {
      type: 'flow-suggestions-refine:error',
      payload: {
        job_id: jobId,
        status: 'failed',
        error: world.failure.error,
        recoverable: world.failure.recoverable,
        reason: null,
      },
    };
  }
  return {
    type: 'flow-suggestions-refine:complete',
    payload: { job_id: jobId, status: 'complete', result: { ...result(), job_id: jobId } },
  };
}
