// HAR import routes of the fake backend (`har_import.py:842` upload, `:989` analyze, `:1032`
// generate, `:1051` cancel) and the answers of the HAR channel to `har:generate`, `split_resume`
// and `har:cancel` (`har_ws.py:573-680`). The upload
// parses the recording it receives with a miniature of the backend parser, so what a test puts in
// the file decides what the tool sees: static assets are filtered, `/analytics` requests are noise,
// a bearer header is an auth pattern, a response value that a later request sends back is a
// correlation. A test that needs exact numbers passes `fixed` answers instead; the file is still
// received (its size and name are recorded) but its content is not read.
//
// The session store is the `har_sessions` collection; a session is bound to its project as in
// the backend (`har_session_store.py`), and an unknown or foreign one is a 404.
//
// Generation: REST always gives one flow; the channel proposes a split when the world names two
// journeys or more, waits for `split_resume` and saves one flow per path it got back, and a
// recording with one journey ends at once with one flow, as `generate_har_flow_response` does
// (`har_import.py:679-760`). A recording without response bodies is refused with the backend's
// text (`flow_postprocessor.py:244-258`) before anything is generated.

import type { components } from '../../../src/http/generated/api.js';
import type { Clock } from '../../../src/ops/clock.js';
import { FakeHttpError, type ChannelStub, type Fake, type Store } from '../server.js';
import { SKLEP_COLLECTIONS } from '../worlds/sklep.js';
import { idleWhile } from '../../helpers/clock.js';

type UploadResponse = components['schemas']['HARUploadResponse'];
type AnalyzeResponse = components['schemas']['HARAnalyzeResponse'];
type ProjectDetail = components['schemas']['ProjectDetail'];
type FlowDetail = components['schemas']['FlowDetail'];
type GenerateRequest = components['schemas']['HARGenerateRequest'];

export const HAR_SESSIONS = 'har_sessions';
const FLOWS = 'flows';
const CREATED = '2026-11-22T09:00:00Z';

/** The refusal of a recording without response bodies (`flow_postprocessor.py:249-258`). */
export const SANITIZED_REFUSAL =
  "100% of the kept requests declare a response body (content.size > 0) that is not in the file, and no response in this recording carries a body at all. That is the shape of a HAR exported from the browser without 'Allow generating HAR with sensitive data' (response bodies and Cookie/Authorization headers are stripped): a flow generated from it cannot correlate the session token, so every request would fail with 401. Re-export the recording from Chrome DevTools with 'Allow generating HAR with sensitive data' enabled and upload it again.";

/** One journey the split proposes: its name and the `METHOD /path` labels of its requests. */
export interface HarJourney {
  readonly name: string;
  readonly steps: readonly string[];
}

export interface HarGenerateWorld {
  /** Journeys of the recording; fewer than two: no proposal, one flow (as the backend). */
  readonly journeys?: readonly HarJourney[];
  /** Flow saved for a journey name, or for the whole recording under `*`; default: built from the steps. */
  readonly flows?: Readonly<Record<string, FlowDetail>>;
  /** `source` of the pauses of the flows built from the steps; default `recording`. */
  readonly pauseSource?: 'recording' | 'default_human';
  /** Generation fails: `har:error` on the channel, 500 on REST. */
  readonly failure?: { readonly error: string; readonly recoverable?: boolean };
  /**
   * The connection is cut, as by a proxy: before the proposal (LoadCraft never gets an answer), or
   * right after the answer arrived (LoadCraft builds the flows without the connection).
   */
  readonly drop?: 'before_proposal' | 'after_answer';
  /** `har:generate` is never answered. */
  readonly silent?: boolean;
  /** REST generate answers this long after the request (test clock). */
  readonly restAfterMs?: number;
  /** `step_label` of the progress frame sent after `har:generate`. */
  readonly progressLabel?: string;
  /** The channel sends the proposal, and later the result, this long after the message (test clock). */
  readonly channelAfterMs?: number;
  /** Every `har:generate` message and REST generate body, in order. */
  readonly onGenerate?: (body: Readonly<Record<string, unknown>>) => void;
  /** Every cancel, by channel message or REST. */
  readonly onCancel?: (sessionId: string, how: 'channel' | 'rest') => void;
}

export interface HarSessionRecord {
  readonly id: string;
  readonly project_id: string;
  readonly filename: string;
  readonly size: number;
  readonly analysis: AnalyzeResponse;
}

export interface HarRouteOptions {
  /** Answers sent whatever the file holds; the session id is the fake's. */
  fixed?: { upload: Omit<UploadResponse, 'har_session_id'>; analysis: AnalyzeResponse };
  /** Runs before every analyze answer; it may move the test clock and throw a `FakeHttpError`. */
  beforeAnalyze?: () => Promise<void>;
  /** How generation answers; default: one flow built from the requests of the recording. */
  generate?: HarGenerateWorld;
  /** Clock of `generate.restAfterMs`. */
  clock?: Pick<Clock, 'sleep'>;
  /** Name of the first action group, as a model that copied a value of the recording would give it. */
  firstGroupName?: string;
}

interface HarEntry {
  request?: { method?: string; url?: string; headers?: { name: string; value: string }[] };
  response?: { status?: number; content?: { size?: number; text?: string } };
}

interface Parsed {
  readonly upload: Omit<UploadResponse, 'har_session_id'>;
  readonly analysis: AnalyzeResponse;
}

const STATIC = /\.(?:js|css|png|svg|ico|woff2?)$/u;
const SANITIZED = { code: 'sanitized_har_export', message: 'The export has no response bodies.' };

function header(entry: HarEntry, name: string): string {
  const found = entry.request?.headers?.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? '';
}

function pathOf(entry: HarEntry): string {
  return new URL(entry.request?.url ?? 'http://invalid.example').pathname;
}

/** String fields of a JSON response, the values a later request may send back. */
function produced(entry: HarEntry): [string, string][] {
  const text = entry.response?.content?.text;
  if (text === undefined) return [];
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return [];
    return Object.entries(body).flatMap(([key, value]): [string, string][] =>
      typeof value === 'string' && value.length >= 4 ? [[key, value]] : [],
    );
  } catch {
    return [];
  }
}

function parseRecording(content: Buffer): Parsed {
  let har: unknown;
  try {
    har = JSON.parse(content.toString('utf8'));
  } catch {
    throw new FakeHttpError(400, { detail: 'Uploaded file is not valid JSON' });
  }
  const entries = (har as { log?: { entries?: HarEntry[] } }).log?.entries ?? [];
  const kept = entries.filter((entry) => !STATIC.test(pathOf(entry)));
  const included = kept.filter((entry) => !pathOf(entry).startsWith('/analytics'));

  const withText = included.filter((entry) => (entry.response?.content?.text ?? '') !== '');
  const stripped = included.filter(
    (entry) =>
      (entry.response?.content?.text ?? '') === '' && (entry.response?.content?.size ?? 0) > 0,
  );
  const ratio = (count: number): number => (included.length === 0 ? 0 : count / included.length);
  const sanitized = withText.length === 0 && stripped.length > 0;
  const warnings = sanitized ? [SANITIZED] : [];

  const bearer = included.some((entry) => header(entry, 'Authorization').startsWith('Bearer '));

  const groups: { name: string; indices: number[] }[] = [];
  included.forEach((entry, index) => {
    const name = pathOf(entry).split('/')[1] ?? '';
    const last = groups[groups.length - 1];
    if (last?.name === name) last.indices.push(index);
    else groups.push({ name, indices: [index] });
  });
  const action_groups = groups.map((group) => ({
    name: group.name,
    entry_indices: group.indices,
    start_index: group.indices[0] ?? 0,
    end_index: group.indices[group.indices.length - 1] ?? 0,
    think_time_before_ms: null,
    correlations_produced: [],
    correlations_consumed: [],
    entries_summary: group.indices.map((index) => ({
      method: included[index]?.request?.method ?? 'GET',
      path: pathOf(included[index] ?? {}),
      status: included[index]?.response?.status ?? 0,
    })),
  }));

  const correlations: Record<string, unknown>[] = [];
  included.forEach((source, sourceIndex) => {
    for (const [field, value] of produced(source)) {
      included.forEach((target, targetIndex) => {
        if (targetIndex <= sourceIndex) return;
        const sentInAuth = header(target, 'Authorization').includes(value);
        const sentInUrl = (target.request?.url ?? '').includes(value);
        if (!sentInAuth && !sentInUrl) return;
        correlations.push({
          source_entry_index: sourceIndex,
          target_entry_index: targetIndex,
          value_preview: '[REDACTED]',
          source_json_path: `$.${field}`,
          target_location: sentInAuth ? 'header:Authorization' : 'path:2',
          suggested_session_var: sentInAuth ? 'authToken' : field,
          confidence: sentInAuth ? 0.95 : 0.6,
        });
      });
    }
  });

  return {
    upload: {
      duration_ms: 0,
      total_entries: entries.length,
      filtered_entries: kept.length,
      excluded_count: kept.length - included.length,
      base_url: included[0] === undefined ? '' : new URL(included[0].request?.url ?? '').origin,
      detected_auth_pattern: bearer ? 'bearer_token' : null,
      warnings,
      domain_stats: [],
    },
    analysis: {
      action_groups,
      correlations,
      ambiguous_producers: [],
      auth_flows: [],
      evidence_quality: withText.length === 0 ? 'weak_response' : 'full',
      evidence_coverage: {
        request_body_ratio: 0,
        response_body_ratio: ratio(withText.length),
        stripped_response_body_ratio: ratio(stripped.length),
      },
      info: [],
      warnings,
    },
  };
}

// ---- generation -------------------------------------------------------------------------------

/** Requests of each `METHOD /path` label with a recorded pause between neighbours. */
function flowFromSteps(
  store: Store,
  projectId: string,
  name: string,
  steps: readonly string[],
  pauseSource: 'recording' | 'default_human' = 'recording',
): FlowDetail {
  const blocks: FlowDetail['blocks'] = [];
  steps.forEach((step, index) => {
    const [method = 'GET', path = '/'] = step.split(' ');
    if (index > 0) {
      blocks.push({
        id: `pause-${String(index)}`,
        type: 'pause',
        name: 'Pause',
        description: 'Recorded think time',
        enabled: true,
        config: {
          delay_min_ms: 2000,
          delay_max_ms: 2000,
          distribution: 'fixed',
          source: pauseSource,
        },
      });
    }
    blocks.push({
      id: `request-${String(index + 1)}`,
      type: 'request',
      name: step,
      description: '',
      enabled: true,
      config: { method, path, headers: {}, request_checks: [], response_checks: [] },
    });
  });
  const ids = blocks.map((block) => String(block['id']));
  return {
    id: store.newId(),
    project_id: projectId,
    name,
    description: '',
    flow_type: 'api',
    blocks,
    edges: ids.slice(0, -1).map((source, index) => ({
      id: `edge-${String(index + 1)}`,
      source,
      target: ids[index + 1],
    })),
    entry_block_id: ids[0] ?? null,
    variables: {},
    timeout_ms: 30_000,
    retry_count: 0,
    retry_delay_ms: 1000,
    generated_by: 'har',
    generation_description: null,
    source_endpoints: [],
    source_operations: [],
    tags: [],
    is_active: true,
    can_regenerate: false,
    current_version: 1,
    created_at: CREATED,
    updated_at: CREATED,
    created_by: 'user@example.com',
  };
}

/** `METHOD /path` of every request of the recording, in order. */
function recordedSteps(session: HarSessionRecord): string[] {
  return (session.analysis.action_groups ?? []).flatMap((group) =>
    (
      (group as { entries_summary?: { method?: string; path?: string }[] }).entries_summary ?? []
    ).map((request) => `${request.method ?? 'GET'} ${request.path ?? '/'}`),
  );
}

/** Saves the flow of `key` (a journey name or `*`) under `name`; the answer's row for it. */
function saveFlow(
  store: Store,
  world: HarGenerateWorld,
  session: HarSessionRecord,
  key: string,
  name: string,
  steps: readonly string[],
): { flow_id: string; flow_name: string; block_count: number; edge_count: number } {
  const given = world.flows?.[key];
  const flow =
    given === undefined
      ? flowFromSteps(store, session.project_id, name, steps, world.pauseSource)
      : // a flow from a recording is not pinned to a docs version
        { ...given, project_id: session.project_id, name, openapi_spec_id: null };
  store.collection<FlowDetail>(FLOWS).insert(flow);
  return {
    flow_id: flow.id,
    flow_name: name,
    block_count: flow.blocks.length,
    edge_count: flow.edges.length,
  };
}

function isSanitized(session: HarSessionRecord): boolean {
  const coverage = session.analysis.evidence_coverage as
    { response_body_ratio?: number; stripped_response_body_ratio?: number } | undefined;
  return (
    (coverage?.stripped_response_body_ratio ?? 0) > 0 && (coverage?.response_body_ratio ?? 0) === 0
  );
}

function ownedSession(store: Store, projectId: string, sessionId: string): HarSessionRecord {
  const session = store.collection<HarSessionRecord>(HAR_SESSIONS).get(sessionId);
  if (session?.project_id !== projectId) {
    throw new FakeHttpError(404, {
      detail: `HAR session not found: ${sessionId}. Upload a HAR file first.`,
    });
  }
  return session;
}

/** The backend's side of the channel of one session: answers to the client's messages. */
function answerChannel(
  fake: Fake,
  world: HarGenerateWorld,
  session: HarSessionRecord,
  stub: ChannelStub<'har'>,
  clock: Pick<Clock, 'sleep'> | undefined,
): void {
  /** Runs `answer` after `channelAfterMs` of test time, or at once. */
  const later = (answer: () => void): void => {
    const delay = world.channelAfterMs;
    if (delay === undefined || clock === undefined) {
      answer();
      return;
    }
    clock.sleep(delay, new AbortController().signal).then(answer, () => undefined);
  };
  const record = (message: unknown): Record<string, unknown> =>
    typeof message === 'object' && message !== null ? (message as Record<string, unknown>) : {};
  const complete = (flows: ReturnType<typeof saveFlow>[], split: boolean): void => {
    const [first] = flows;
    if (first === undefined) return;
    stub.emit({
      type: 'har:complete',
      payload: {
        session_id: session.id,
        status: 'completed',
        ...first,
        warning: null,
        flows: split ? flows : null,
      },
    });
  };
  stub.onMessage((raw) => {
    const message = record(raw);
    switch (message['type']) {
      case 'har:generate': {
        world.onGenerate?.(message);
        if (world.silent === true) return;
        if (isSanitized(session)) {
          stub.emit({
            type: 'har:error',
            payload: { error: SANITIZED_REFUSAL, recoverable: false },
          });
          return;
        }
        stub.emit({
          type: 'har:progress',
          payload: {
            status: 'running',
            progress: 40,
            current_step: 'assemble',
            step_label: world.progressLabel ?? 'Assembling the flow',
          },
        });
        if (world.failure !== undefined) {
          stub.emit({
            type: 'har:error',
            payload: {
              error: world.failure.error,
              recoverable: world.failure.recoverable ?? false,
            },
          });
          return;
        }
        const journeys = world.journeys ?? [];
        if (journeys.length < 2) {
          const given = message['flow_name'];
          const name = typeof given === 'string' ? given : '';
          const steps = journeys[0]?.steps ?? recordedSteps(session);
          later(() => complete([saveFlow(fake.store, world, session, '*', name, steps)], false));
          return;
        }
        if (world.drop === 'before_proposal') {
          setImmediate(() => fake.faults.dropChannel('har'));
          return;
        }
        later(() => {
          stub.emit({
            type: 'split_proposal',
            proposed_paths: journeys.map((journey) => ({
              name: journey.name,
              steps: [...journey.steps],
              depends_on_prior: false,
              rationale: `The recording shows ${journey.name} as its own journey.`,
            })),
          });
        });
        return;
      }
      case 'split_resume': {
        const paths = Array.isArray(message['paths']) ? message['paths'] : [];
        if (world.drop === 'after_answer') setImmediate(() => fake.faults.dropChannel('har'));
        later(() => {
          // A run the backend dropped (its connection went away) saves nothing.
          if (stub.status !== 'running') return;
          const flows = paths.map((path) => {
            const { name = '', steps = [] } = record(path) as { name?: string; steps?: string[] };
            return saveFlow(fake.store, world, session, name, name, steps);
          });
          complete(flows, true);
        });
        return;
      }
      case 'har:cancel':
        world.onCancel?.(session.id, 'channel');
        stub.emit({ type: 'har:cancelled', payload: { session_id: session.id } });
        return;
    }
  });
}

const registered = new WeakSet<Fake>();

/** Registers the HAR upload and analyze routes; idempotent per fake, the first options win. */
export function registerHarRoutes(fake: Fake, options: HarRouteOptions = {}): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  const world = options.generate ?? {};

  fake.route('POST', '/api/v1/projects/{project_id}/har/upload', (req, store) => {
    store
      .collection<ProjectDetail>(SKLEP_COLLECTIONS.projects)
      .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
    const file = req.files.find((item) => item.field === 'file');
    if (file === undefined) throw new FakeHttpError(422, { detail: 'file is required' });
    if (!file.filename.toLowerCase().endsWith('.har')) {
      throw new FakeHttpError(400, { detail: 'Invalid file extension. Only .har files accepted' });
    }
    const parsed = options.fixed ?? parseRecording(file.content);
    const [firstGroup] = parsed.analysis.action_groups ?? [];
    if (options.firstGroupName !== undefined && firstGroup !== undefined) {
      firstGroup.name = options.firstGroupName;
    }
    const id = store.newId();
    const session = store.collection<HarSessionRecord>(HAR_SESSIONS).insert({
      id,
      project_id: req.params.project_id,
      filename: file.filename,
      size: file.size,
      analysis: parsed.analysis,
    });
    answerChannel(
      fake,
      world,
      session,
      fake.channel('har', { project_id: session.project_id, session_id: id }),
      options.clock,
    );
    return { status: 200, body: { har_session_id: id, ...parsed.upload } };
  });

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/har/{har_session_id}/analyze',
    async (req, store) => {
      const session = store
        .collection<HarSessionRecord>(HAR_SESSIONS)
        .get(req.params.har_session_id);
      if (session?.project_id !== req.params.project_id) {
        throw new FakeHttpError(404, {
          detail: `HAR session not found: ${req.params.har_session_id}. Upload a HAR file first.`,
        });
      }
      // A hook of the test: the clock may move while the fake waits for it.
      await idleWhile(Promise.resolve(options.beforeAnalyze?.()));
      return { status: 200, body: session.analysis };
    },
  );

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/har/{har_session_id}/generate',
    async (req, store) => {
      const session = ownedSession(store, req.params.project_id, req.params.har_session_id);
      const body = req.body as GenerateRequest;
      world.onGenerate?.({ ...body });
      if (isSanitized(session)) throw new FakeHttpError(422, { detail: SANITIZED_REFUSAL });
      if (world.restAfterMs !== undefined)
        await options.clock?.sleep(world.restAfterMs, new AbortController().signal);
      if (world.failure !== undefined) {
        throw new FakeHttpError(500, { detail: `Flow generation failed: ${world.failure.error}` });
      }
      const flow = saveFlow(store, world, session, '*', body.flow_name, recordedSteps(session));
      return { status: 200, body: { ...flow, warning: null, flows: null } };
    },
  );

  fake.route('POST', '/api/v1/projects/{project_id}/har/{har_session_id}/cancel', (req, store) => {
    const session = ownedSession(store, req.params.project_id, req.params.har_session_id);
    world.onCancel?.(session.id, 'rest');
    return { status: 200, body: { session_id: session.id, cancelled: true } };
  });
}
