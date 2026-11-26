// Batch flow generation of the fake backend (`api/routes/flow_suggestions.py`, `batch-generate`):
// the POST answers with a run id at once, the run generates the baskets on the test clock and tells
// about each over the `batch` channel (`api/websocket/batch_generation_ws.py`). A flow that a basket
// produces is saved with the tags of the basket, so `GET …/flows?tags=<tag>` finds it as it does on
// the real backend. The run lives in memory only: the channel forgets it 600 s after the end.

import type { components } from '../../../src/http/generated/api.js';
import type { Clock } from '../../../src/ops/clock.js';
import {
  FakeHttpError,
  type Fake,
  type JobEmission,
  type Store,
  type WireFrame,
} from '../server.js';
import { SKLEP_COLLECTIONS, type SklepEndpoint } from '../worlds/sklep.js';

type ApprovedBasket = components['schemas']['ApprovedBasket'];
type FlowDetail = components['schemas']['FlowDetail'];

const FLOWS = 'flows';
const MAX_BASKETS = 50;

/**
 * The docs pin of a generated flow: the backend pins a flow built from the documentation to the
 * project's current version, so a template pinned to the world's version moves to it. A template
 * without a pin (a recording) stays without one.
 */
export function pinOf(
  store: Store,
  projectId: string,
  templatePin: string | null | undefined,
): string | null {
  if (templatePin === null || templatePin === undefined) return null;
  const current = store
    .collection<{ id: string; openapi_spec_id?: string | null }>(SKLEP_COLLECTIONS.projects)
    .get(projectId)?.openapi_spec_id;
  return current ?? templatePin;
}
const CREATED = '2026-11-22T10:05:00Z';

/** What the generator does with the basket of this name; baskets without a plan just succeed. */
export interface BatchBasketPlan {
  readonly name: string;
  /** Milliseconds after the start at which the basket is done; default 3 s per position. */
  readonly afterMs?: number;
  /** The flow to save (its tags are replaced by the basket's); default: built from the endpoints. */
  readonly flow?: FlowDetail;
  /** The basket fails with this error and saves nothing. */
  readonly error?: { readonly message: string; readonly retryable: boolean };
  /** Questions the generator leaves on the flow (`needs_input` of the frame). */
  readonly needsInput?: readonly Record<string, unknown>[];
}

export interface BatchWorld {
  readonly plans: readonly BatchBasketPlan[];
  /** The run ends with an `error` frame instead of `complete`, after the baskets. */
  readonly runFailure?: {
    readonly error: string;
    readonly recoverable: boolean;
    /** Milliseconds after the start; default: after the last basket. */
    readonly afterMs?: number;
  };
  /** Called with the request body of every POST before it is answered. */
  readonly onPost?: (baskets: readonly ApprovedBasket[]) => void;
}

export const DEFAULT_BATCH_WORLD: BatchWorld = { plans: [] };

export interface BatchHandles {
  /** Ids of the runs started so far, oldest first. */
  readonly runs: readonly string[];
}

const registered = new WeakMap<Fake, BatchHandles>();

/** A pause the generator adds before an API call (flow_generation/service.py:592). */
const PAUSE_DESCRIPTION = 'Assumed default think time before an API call (not measured)';

/** One request per endpoint with a pause between neighbours, in a chain. */
export function synthesize(
  store: Store,
  projectId: string,
  basket: ApprovedBasket,
  endpoints: readonly SklepEndpoint[],
): FlowDetail {
  const key = basket.basket_id ?? 'basket';
  const blocks: FlowDetail['blocks'] = [];
  endpoints.forEach((endpoint, index) => {
    if (index > 0) {
      blocks.push({
        id: `${key}-pause-${String(index)}`,
        type: 'pause',
        name: 'Pause',
        description: PAUSE_DESCRIPTION,
        enabled: true,
        config: {
          delay_min_ms: 3000,
          delay_max_ms: 8000,
          distribution: 'uniform',
          source: 'default_human',
        },
      });
    }
    blocks.push({
      id: `${key}-request-${String(index + 1)}`,
      type: 'request',
      name: endpoint.summary ?? `${endpoint.method} ${endpoint.path}`,
      description: '',
      enabled: true,
      config: {
        endpoint_id: endpoint.id,
        method: endpoint.method,
        path: endpoint.path,
        headers: {},
        query_params: {},
        path_params: {},
        body: null,
        expected_statuses: null,
        request_checks: [],
        response_checks: [],
        save_variables: {},
      },
    });
  });
  const ids = blocks.map((block) => String(block['id']));
  return {
    id: store.newId(),
    project_id: projectId,
    name: basket.name,
    description: basket.description,
    flow_type: 'api',
    blocks,
    edges: ids.slice(0, -1).map((source, index) => ({
      id: `${key}-edge-${String(index + 1)}`,
      source,
      target: ids[index + 1],
    })),
    entry_block_id: ids[0] ?? null,
    variables: {},
    timeout_ms: 30_000,
    retry_count: 0,
    retry_delay_ms: 1000,
    generated_by: 'ai',
    generation_description: basket.description,
    source_endpoints: endpoints.map((endpoint) => `${endpoint.method}:${endpoint.path}`),
    source_operations: [],
    tags: [],
    is_active: true,
    can_regenerate: true,
    current_version: 1,
    created_at: CREATED,
    updated_at: CREATED,
    created_by: 'user@example.com',
  };
}

function isBasketList(body: unknown): body is { baskets: ApprovedBasket[] } {
  return (
    typeof body === 'object' && body !== null && 'baskets' in body && Array.isArray(body.baskets)
  );
}

/**
 * Registers `POST …/flow-suggestions/batch-generate` over the sklep world. With a `clock` the flows
 * appear when their baskets are done; without one (the stand-alone fake) they exist at once.
 */
export function registerBatchGenerateRoute(
  fake: Fake,
  world: BatchWorld = DEFAULT_BATCH_WORLD,
  clock?: Pick<Clock, 'now'> & { sleep?: Clock['sleep'] },
): BatchHandles {
  const known = registered.get(fake);
  if (known !== undefined) return known;
  const runs: string[] = [];

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/flow-suggestions/batch-generate',
    (req, store, jobs) => {
      const projectId = req.params.project_id;
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(projectId, `Project not found: ${projectId}`);
      if (!isBasketList(req.body) || req.body.baskets.length < 1) {
        throw new FakeHttpError(422, {
          detail: [
            {
              type: 'too_short',
              loc: ['body', 'baskets'],
              msg: 'List should have at least 1 item',
            },
          ],
        });
      }
      const baskets = req.body.baskets;
      if (baskets.length > MAX_BASKETS) {
        throw new FakeHttpError(422, {
          detail: [
            {
              type: 'too_long',
              loc: ['body', 'baskets'],
              msg: 'List should have at most 50 items',
            },
          ],
        });
      }
      world.onPost?.(baskets);

      const endpoints = store.collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints);
      const flows = store.collection<FlowDetail>(FLOWS);
      const emissions: JobEmission[] = [];
      let succeeded = 0;
      let failed = 0;
      baskets.forEach((basket, index) => {
        const plan = world.plans.find((candidate) => candidate.name === basket.name);
        const doneAt = plan?.afterMs ?? 3000 * (index + 1);
        const basketId = basket.basket_id ?? '';
        const matched = (basket.endpoint_ids ?? [])
          .map((id) => endpoints.get(id))
          .filter((endpoint): endpoint is SklepEndpoint => endpoint !== undefined);
        const failure =
          plan?.error ??
          (matched.length === 0
            ? { message: 'No matching endpoints found', retryable: false }
            : undefined);
        emissions.push({
          afterMs: Math.max(0, doneAt - 1000),
          frame: {
            type: 'batch-generation:basket-progress',
            payload: { basket_id: basketId, step_label: 'Generating', progress: 50 },
          },
        });
        if (failure !== undefined) {
          failed += 1;
          emissions.push({
            afterMs: doneAt,
            frame: {
              type: 'batch-generation:basket-error',
              payload: {
                basket_id: basketId,
                error: failure.message,
                retryable: failure.retryable,
              },
            },
          });
          return;
        }
        succeeded += 1;
        const template = plan?.flow ?? synthesize(store, projectId, basket, matched);
        const flow: FlowDetail = {
          ...template,
          project_id: projectId,
          openapi_spec_id: pinOf(store, projectId, template.openapi_spec_id),
          tags: [...(basket.tags ?? [])],
          generation_description: basket.description,
          // the row keeps the items as the generator wrote them; GET types them
          ...(plan?.needsInput === undefined
            ? {}
            : {
                needs_input: plan.needsInput as unknown as NonNullable<FlowDetail['needs_input']>,
              }),
        };
        const save = (): void => {
          flows.insert(flow);
        };
        if (clock?.sleep === undefined) save();
        else
          void clock
            .sleep(doneAt, new AbortController().signal)
            .then(save)
            .catch(() => undefined);
        emissions.push({
          afterMs: doneAt,
          frame: {
            type: 'batch-generation:basket-complete',
            payload: {
              basket_id: basketId,
              flow_id: flow.id,
              flow_name: flow.name,
              needs_input: plan?.needsInput === undefined ? [] : [...plan.needsInput],
              definite_count: (plan?.needsInput ?? []).filter((item) => item['definite'] === true)
                .length,
            },
          },
        });
      });
      const endAt = Math.max(0, ...emissions.map((emission) => emission.afterMs)) + 1000;
      const end: WireFrame =
        world.runFailure === undefined
          ? {
              type: 'batch-generation:complete',
              payload: { success_count: succeeded, failed_count: failed },
            }
          : {
              type: 'batch-generation:error',
              payload: {
                error: world.runFailure.error,
                recoverable: world.runFailure.recoverable,
                success_count: succeeded,
                failed_count: failed,
              },
            };
      emissions.push({ afterMs: world.runFailure?.afterMs ?? endAt, frame: end });
      const job = jobs.start('batch', {
        steps: [
          { afterMs: 0, state: 'running' },
          { afterMs: endAt, state: 'ended' },
        ],
      });
      runs.push(job.id);
      fake.channel('batch', { run_id: job.id }).attach(job, emissions);
      return { status: 200, body: { run_id: job.id, status: 'started' } };
    },
  );

  const handles: BatchHandles = { runs };
  registered.set(fake, handles);
  return handles;
}
