// World built from the uploaded API documentation, for a document that is not the `sklep` world's
// (the stand-alone fake run against a customer's own `loadcraft/openapi.json`). Everything here is
// derived, deterministically, from the operations of the project's current specification and from
// the flows built over them: the same document always gives the same journeys, scenarios, checks
// and run records. No model, no network. Records take the shape of the `sklep` world's (cloned from
// its stages and rewritten), so the routes answer in the contract's shapes.
//
// `isForeignDocument` tells the two worlds apart: a document is foreign when the operations the
// `sklep` world's journeys name are not all in it. That is the case in which the `sklep` answers
// cannot be built, so a document the `sklep` world works with keeps its behaviour.

import type { components } from '../../../src/http/generated/api.js';
import { currentSpec, operationsOf } from '../routes/setup.js';
import { createIdSource, createStore, type Store } from '../store.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepAnalysisDocument,
  type SklepEndpoint,
  type SklepEndpointRow,
  type SklepExecution,
  type SklepExecutionAnalysis,
  type SklepExecutionResult,
  type SklepScenario,
  type SklepSelfCheck,
  type SklepSlot,
  type SklepTimePoint,
} from './sklep.js';

type FlowDetail = components['schemas']['FlowDetail'];
type EnvironmentResponse = components['schemas']['EnvironmentResponse'];

// ---- which world ---------------------------------------------------------------------------

/** Operations of the current specification of the store's project (none without one). */
export function currentOperations(store: Store): SklepEndpoint[] {
  const [project] = store.collection<{ id: string }>(SKLEP_COLLECTIONS.projects).list();
  const spec = project === undefined ? undefined : currentSpec(store, project.id);
  return spec === undefined ? [] : operationsOf(store, spec.id);
}

/**
 * The project's current document has operations and lacks one of `operationIds` (the operations
 * the `sklep` world's journeys are made of).
 */
export function isForeignDocument(store: Store, operationIds: readonly string[]): boolean {
  const operations = currentOperations(store);
  if (operations.length === 0) return false;
  const known = new Set(operations.map((operation) => operation.operation_id));
  return operationIds.some((id) => !known.has(id));
}

// ---- reading operations and flows ----------------------------------------------------------

const PREFIX_SEGMENT = /^(api|rest|public|v\d+(\.\d+)*)$/iu;
const LOGIN_TAIL =
  /(^|[/_-])(login|log-in|signin|sign-in|token|tokens|session|sessions|authenticate)$/iu;
const NOT_LOGIN = /(logout|log-out|refresh|register|reset|verify|revoke)/iu;
const ACCOUNT_AREA = /(account|customer|profile|^users?$|^me$|^members?$)/iu;
const ORDER_AREA = /(cart|basket|order|checkout|booking|reservation|loan|payment|purchase)/iu;
const AUTH_AREA = /^(auth|authentication|security|sessions?|login|tokens?)$/iu;

/** The area of an operation: its first tag, else the first meaningful segment of its path. */
export function areaOf(operation: Pick<SklepEndpoint, 'tags' | 'path'>): string {
  const tag = operation.tags.find((candidate) => candidate.trim() !== '');
  if (tag !== undefined) return tag;
  const segment = operation.path
    .split('/')
    .find((part) => part !== '' && !part.startsWith('{') && !PREFIX_SEGMENT.test(part));
  return segment ?? 'api';
}

/** A POST that hands out a session or a token (`/auth/login`, `/members/token`, …). */
export function isLoginRequest(method: string, path: string): boolean {
  const trimmed = path.replace(/\/+$/u, '');
  return method.toUpperCase() === 'POST' && LOGIN_TAIL.test(trimmed) && !NOT_LOGIN.test(trimmed);
}

const REGISTER_PATH = /(register|registration|sign-?up)(\/|$)/iu;
const ACCOUNT_COLLECTION = /\/(customers|users|members|accounts)\/?$/iu;

/**
 * The operation that creates an account, as `METHOD:/path`: a POST on a register or sign-up path,
 * else a POST on a collection of customers, users, members or accounts; the public side first.
 */
export function registerOperationOf(operations: readonly SklepEndpoint[]): string | undefined {
  const posts = publicFirst(operations.filter((op) => op.method === 'POST'));
  const found =
    posts.find((op) => REGISTER_PATH.test(op.path)) ??
    posts.find((op) => ACCOUNT_COLLECTION.test(op.path));
  return found === undefined ? undefined : `POST:${found.path}`;
}

/** POST operations that could create an account, as the backend offers them when none is known. */
export function registerCandidatesOf(operations: readonly SklepEndpoint[]): string[] {
  return publicFirst(operations.filter((op) => op.method === 'POST'))
    .filter((op) => !isLoginRequest(op.method, op.path))
    .slice(0, 5)
    .map((op) => `POST:${op.path}`);
}

const endsWithParameter = (path: string): boolean => /\}\/?$/u.test(path);
const isAdminPath = (path: string): boolean => /(^|\/)admin(\/|$)/iu.test(path);

/** Operations of the public side first, the admin ones after, each in document order. */
function publicFirst(ops: readonly SklepEndpoint[]): SklepEndpoint[] {
  return [
    ...ops.filter((op) => !isAdminPath(op.path)),
    ...ops.filter((op) => isAdminPath(op.path)),
  ];
}
const isWrite = (method: string): boolean => ['POST', 'PUT', 'PATCH'].includes(method);

/** A request step of a flow, as the run records name it. */
export interface FlowRequest {
  readonly name: string;
  readonly method: string;
  readonly path: string;
}

export function requestsOf(flow: Pick<FlowDetail, 'blocks'>): FlowRequest[] {
  return flow.blocks.flatMap((block) => {
    if (block['type'] !== 'request') return [];
    const config = (block['config'] ?? {}) as { method?: unknown; path?: unknown };
    const method = typeof config.method === 'string' ? config.method.toUpperCase() : 'GET';
    const path = typeof config.path === 'string' ? config.path : '/';
    const name = typeof block['name'] === 'string' ? block['name'] : `${method} ${path}`;
    return [{ name, method, path }];
  });
}

// ---- journeys -------------------------------------------------------------------------------

export interface DocumentJourney {
  readonly name: string;
  readonly description: string;
  readonly endpointIds: readonly string[];
  readonly area: string;
  readonly pattern: string;
  readonly confidence: number;
}

export interface DocumentSuggestions {
  /** What the free heuristic proposes: the operations of the largest areas. */
  readonly heuristic: readonly DocumentJourney[];
  /** What the refinement proposes: browsing, changing (cart or order), the account. */
  readonly refined: readonly DocumentJourney[];
  /** Areas the refinement walked through, with their number of operations. */
  readonly areas: readonly { readonly name: string; readonly operations: number }[];
}

const MAX_REFINED = 5;
const HEURISTIC_AREAS = 2;
const HEURISTIC_OPERATIONS = 6;

function commonPrefix(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  let count = 0;
  while (count < left.length && left[count] === right[count]) count += 1;
  return count;
}

/** Ranks entries by `score` (higher first), the earlier in the document on a tie. */
function ranked<T>(items: readonly T[], score: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

/** Journeys of a document, from its tags and paths. Empty for a document without operations. */
export function documentJourneys(operations: readonly SklepEndpoint[]): DocumentSuggestions {
  const logins = operations.filter((op) => isLoginRequest(op.method, op.path));
  const loginIds = new Set(logins.map((op) => op.id));
  const groups = new Map<string, SklepEndpoint[]>();
  for (const op of operations) {
    const area = areaOf(op);
    groups.set(area, [...(groups.get(area) ?? []), op]);
  }
  const areas = [...groups.entries()]
    .map(([name, ops]) => ({ name, ops: ops.filter((op) => !loginIds.has(op.id)) }))
    .filter((area) => area.ops.length > 0 && !AUTH_AREA.test(area.name));

  /** The login closest to `path` (longest shared path prefix), the first one on a tie. */
  const loginFor = (path: string): SklepEndpoint | undefined =>
    ranked(logins, (login) => commonPrefix(login.path, path))[0];

  const journeys: DocumentJourney[] = [];
  const used = new Set<string>();
  /** Adds a journey; a name taken already gets a number. */
  const add = (journey: DocumentJourney): void => {
    let name = journey.name;
    for (let suffix = 2; journeys.some((other) => other.name === name); suffix += 1) {
      name = `${journey.name} ${String(suffix)}`;
    }
    journeys.push({ ...journey, name });
    used.add(journey.area);
  };

  /** A list and its item (`/things`, `/things/{id}`), the public side before the admin one. */
  const browseSteps = (ops: readonly SklepEndpoint[]): SklepEndpoint[] => {
    const gets = publicFirst(ops.filter((op) => op.method === 'GET'));
    for (const list of gets.filter((op) => !op.path.includes('{'))) {
      const item = gets.find(
        (op) =>
          endsWithParameter(op.path) &&
          op.path.startsWith(`${list.path}/`) &&
          !op.path.slice(list.path.length + 1).includes('/'),
      );
      if (item !== undefined) return [list, item];
    }
    return [];
  };
  const browse = (area: { name: string; ops: SklepEndpoint[] }): void => {
    const steps = browseSteps(area.ops);
    add({
      name: `browse ${area.name}`,
      description: `Browse ${area.name}: open the list and one of its items.`,
      endpointIds: steps.map((op) => op.id),
      area: area.name,
      pattern: 'semantic',
      confidence: 0.8,
    });
  };

  // Browsing: the area with the most reads that has a list and an item.
  const browsable = areas.filter((area) => browseSteps(area.ops).length >= 2);
  const [firstBrowse] = ranked(
    browsable.filter((area) => !ACCOUNT_AREA.test(area.name)),
    (area) => area.ops.filter((op) => op.method === 'GET').length,
  );
  if (firstBrowse !== undefined) browse(firstBrowse);

  // Changing: the area with the most writes, an order-like name first; an order area's write
  // follows when it is another area.
  const writable = areas.filter(
    (area) => area.ops.some((op) => isWrite(op.method)) && !ACCOUNT_AREA.test(area.name),
  );
  const [writeArea] = ranked(
    writable,
    (area) =>
      (ORDER_AREA.test(area.name) ? 1000 : 0) + area.ops.filter((op) => isWrite(op.method)).length,
  );
  if (writeArea !== undefined) {
    const ops = publicFirst(writeArea.ops);
    const post = ops.find((op) => op.method === 'POST');
    const update = ops.find((op) => op.method === 'PUT' || op.method === 'PATCH');
    const first = post ?? update;
    const login = first === undefined ? undefined : loginFor(first.path);
    const list = ops.find((op) => op.method === 'GET' && !endsWithParameter(op.path));
    const follow = ranked(
      writable.filter((area) => area !== writeArea && ORDER_AREA.test(area.name)),
      (area) => area.ops.filter((op) => isWrite(op.method)).length,
    )[0]?.ops.find((op) => op.method === 'POST');
    const steps = [login, list, post, update, follow].filter(
      (op): op is SklepEndpoint => op !== undefined,
    );
    add({
      name: `${post === undefined ? 'update' : 'create'} ${writeArea.name}`,
      description:
        `${login === undefined ? '' : 'Log in, '}look at ${writeArea.name} and change them.`.replace(
          /^./u,
          (letter) => letter.toUpperCase(),
        ),
      endpointIds: steps.map((op) => op.id),
      area: writeArea.name,
      pattern: 'semantic',
      confidence: 0.8,
    });
  }

  // The account: an account-like area, after a login.
  const [accountArea] = areas.filter(
    (area) => ACCOUNT_AREA.test(area.name) && area.ops.some((op) => op.method === 'GET'),
  );
  const accountRead = publicFirst(accountArea?.ops ?? []).find((op) => op.method === 'GET');
  const accountLogin = accountRead === undefined ? undefined : loginFor(accountRead.path);
  if (accountArea !== undefined && accountRead !== undefined && accountLogin !== undefined) {
    // The change of what was read: the same address, written.
    const update = accountArea.ops.find(
      (op) => (op.method === 'PUT' || op.method === 'PATCH') && op.path === accountRead.path,
    );
    const steps = [accountLogin, accountRead, update].filter(
      (op): op is SklepEndpoint => op !== undefined,
    );
    add({
      name: /^accounts?$/iu.test(accountArea.name) ? 'account' : `account ${accountArea.name}`,
      description: `Log in and look at the ${accountArea.name} of the user.`,
      endpointIds: steps.map((op) => op.id),
      area: accountArea.name,
      pattern: 'semantic',
      confidence: 0.8,
    });
  }

  // More browsing, area by area, while there is room.
  for (const area of ranked(
    browsable,
    (candidate) => candidate.ops.filter((op) => op.method === 'GET').length,
  )) {
    if (journeys.length >= MAX_REFINED) break;
    if (!used.has(area.name)) browse(area);
  }

  // A document none of the above fits still gets one journey: its first operations.
  const first = operations.slice(0, 3);
  if (journeys.length === 0 && first[0] !== undefined) {
    const area = areaOf(first[0]);
    add({
      name: area,
      description: `The first operations of ${area}.`,
      endpointIds: first.map((op) => op.id),
      area,
      pattern: 'semantic',
      confidence: 0.6,
    });
  }

  const heuristic = ranked(areas, (area) => area.ops.length)
    .slice(0, HEURISTIC_AREAS)
    .map((area): DocumentJourney => ({
      name: `${area.name} operations`,
      description: `Every operation of ${area.name}.`,
      endpointIds: area.ops.slice(0, HEURISTIC_OPERATIONS).map((op) => op.id),
      area: area.name,
      pattern: 'tag_group',
      confidence: 0.7,
    }));

  return {
    heuristic,
    refined: journeys,
    areas: journeys.map((journey) => ({
      name: journey.area,
      operations: groups.get(journey.area)?.length ?? 0,
    })),
  };
}

// ---- templates ------------------------------------------------------------------------------

let templateStore: Store | undefined;

/** The `sklep` world after its last stage: the records every derived record is cloned from. */
function templates(): Store {
  if (templateStore === undefined) {
    templateStore = createStore(createIdSource(1));
    seedSklep(templateStore, { stage: 'executed' });
  }
  return templateStore;
}

function template<T extends { id: string }>(collection: string, id: string): T {
  return structuredClone(templates().collection<T>(collection).require(id));
}

// ---- scenarios ------------------------------------------------------------------------------

/** The slot of the accounts a scenario that logs in reads its credentials from. */
export const ACCOUNTS_SLOT = 'accounts';

function accountsSlot(): SklepSlot {
  return {
    slot: ACCOUNTS_SLOT,
    label: 'User accounts',
    columns: ['email', 'password'],
    strategy: 'queue',
    column_specs: [
      { name: 'email', type: 'email', example: 'user-1@example.com' },
      { name: 'password', type: 'password' },
    ],
    identity_kind: 'existing',
    default_file: 'accounts.csv',
    role: 'auth',
    generated: false,
    generated_rows: null,
  };
}

/** Pauses of a flow: their mean lengths in milliseconds. */
function pauseMeans(flow: Pick<FlowDetail, 'blocks'>): number[] {
  return flow.blocks.flatMap((block) => {
    if (block['type'] !== 'pause') return [];
    const config = (block['config'] ?? {}) as { delay_min_ms?: number; delay_max_ms?: number };
    return [((config.delay_min_ms ?? 0) + (config.delay_max_ms ?? 0)) / 2];
  });
}

/** A self-check document that waits for the given slots. */
export function waitingCheck(scenarioVersion: number, slots: readonly string[]): SklepSelfCheck {
  return {
    status: 'waiting_for_data',
    scenario_version: scenarioVersion,
    execution_ids: [],
    failure: null,
    notes: [],
    missing_slots: [...slots],
    repairs: [],
    max_repair_rounds: 2,
    runs: [],
    started_at: null,
    finished_at: null,
  };
}

/** A passed self-check document over one run. */
export function passedCheck(
  scenarioVersion: number,
  runId: string,
  window: { start: string; end: string },
): SklepSelfCheck {
  return {
    status: 'passed',
    scenario_version: scenarioVersion,
    execution_ids: [runId],
    failure: null,
    notes: [],
    missing_slots: [],
    repairs: [],
    max_repair_rounds: 2,
    runs: [],
    started_at: window.start,
    finished_at: window.end,
  };
}

export interface DocumentScenarioInput {
  readonly id: string;
  readonly name: string;
  readonly className: string;
  readonly flow: FlowDetail;
  readonly mix: Record<string, number>;
  /** ISO moment the generation ended. */
  readonly at: string;
}

/**
 * The scenario of a flow of the document: a scenario that logs in reads accounts from the
 * `accounts` slot and its check waits for them; any other one carries no slot. The check
 * document is set by the caller (`withCheck`) once it knows whether a run was made.
 */
export function documentScenario(input: DocumentScenarioInput): SklepScenario {
  const base = template<SklepScenario>(
    SKLEP_COLLECTIONS.scenarios,
    SKLEP_WORLD_IDS.scenarios.przegladanie,
  );
  const requests = requestsOf(input.flow);
  const logsIn = requests.some((request) => isLoginRequest(request.method, request.path));
  const slots = logsIn ? [accountsSlot()] : [];
  const pauses = pauseMeans(input.flow);
  const sessionMs = pauses.reduce((sum, ms) => sum + ms, 0) + requests.length * 200;
  const check = logsIn ? waitingCheck(1, [ACCOUNTS_SLOT]) : null;
  return {
    ...base,
    id: input.id,
    name: input.name,
    description: input.flow.description ?? '',
    simulation_class_name: input.className,
    source_flow_id: input.flow.id,
    source_flow_version: input.flow.current_version,
    scenario_artifact: {
      ...base.scenario_artifact,
      feeders: slots.map((slot) => ({
        feeder_type: 'csv',
        file: slot.default_file,
        strategy: slot.strategy,
        columns: slot.columns,
      })),
      generation_metadata: {
        ...base.scenario_artifact.generation_metadata,
        source_flow_id: input.flow.id,
        source_flow_version: input.flow.current_version,
        resolved_class_mix: input.mix,
        self_check: check,
      },
    },
    feeder_slots: slots,
    slot_bindings: {},
    slot_binding_states: [],
    scenario_contract_v2: {
      required_inputs: logsIn ? ['email', 'password'] : [],
      exports: [],
      locals: [],
      control_vars: [],
      session_vars: [],
    },
    self_check: check,
    session_seconds: sessionMs / 1000,
    pause_source_mix: {
      ...base.pause_source_mix,
      default_human: {
        count: pauses.length,
        mean_ms:
          pauses.length === 0
            ? null
            : Math.round(pauses.reduce((sum, ms) => sum + ms, 0) / pauses.length),
      },
    },
    created_at: input.at,
    updated_at: input.at,
  };
}

/** The scenario with this check document in both places the backend keeps it. */
export function withCheck(scenario: SklepScenario, check: SklepSelfCheck): SklepScenario {
  return {
    ...scenario,
    self_check: check,
    scenario_artifact: {
      ...scenario.scenario_artifact,
      generation_metadata: { ...scenario.scenario_artifact.generation_metadata, self_check: check },
    },
  };
}

/** A class name from a flow name: `create loans` → `CreateLoansSimulation`. */
export function simulationClassName(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '');
  const joined = words.map((word) => word[0]?.toUpperCase() + word.slice(1)).join('');
  return `${/^[A-Za-z]/u.test(joined) ? joined : `S${joined}`}Simulation`;
}

// ---- run records ----------------------------------------------------------------------------

/** Mean response time of a request in the fake: reads are quick, writes slower, later ones more. */
function baseMs(request: FlowRequest, index: number): number {
  return (request.method === 'GET' ? 60 : 140) + index * 25;
}

function row(
  name: string,
  count: number,
  ko: number,
  p50: number,
  durationS: number,
): SklepEndpointRow {
  const p95 = Math.round(p50 * 2.2);
  const p99 = Math.round(p50 * 4);
  const ok = count - ko;
  return {
    name,
    group: '',
    count,
    ok_count: ok,
    ko_count: ko,
    mean_response_time: Math.round(p50 * 1.3),
    min_response_time: Math.max(5, Math.round(p50 / 6)),
    max_response_time: p99 * 2,
    min_source: 'bucket-estimate',
    max_source: 'bucket-estimate',
    p50_histogram: p50,
    p75_histogram: Math.round((p50 + p95) / 2),
    p90_histogram: Math.round(p50 + (p95 - p50) * 0.75),
    p95_histogram: p95,
    p99_histogram: p99,
    rps: Math.round((count / Math.max(1, durationS)) * 100) / 100,
    error_count: ko,
    error_rate: count === 0 ? 0 : ko / count,
    http_status_counts: ko > 0 ? { '200': ok, '503': ko } : { '200': ok },
  };
}

interface Totals {
  readonly total: number;
  readonly ko: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly mean: number;
}

function totalsOf(rows: readonly SklepEndpointRow[]): Totals {
  const total = rows.reduce((sum, item) => sum + item.count, 0);
  const weighted = (pick: (item: SklepEndpointRow) => number): number =>
    total === 0
      ? 0
      : Math.round(rows.reduce((sum, item) => sum + pick(item) * item.count, 0) / total);
  return {
    total,
    ko: rows.reduce((sum, item) => sum + item.ko_count, 0),
    p50: weighted((item) => item.p50_histogram),
    p95: Math.max(0, ...rows.map((item) => item.p95_histogram)),
    p99: Math.max(0, ...rows.map((item) => item.p99_histogram)),
    mean: weighted((item) => item.mean_response_time),
  };
}

function resultOf(
  id: string,
  rows: readonly SklepEndpointRow[],
  durationS: number,
  errors: SklepExecutionResult['errors'],
  series: SklepTimePoint[],
): SklepExecutionResult {
  const base = template<SklepExecutionResult>(
    SKLEP_COLLECTIONS.results,
    SKLEP_WORLD_IDS.executionPerf,
  );
  const totals = totalsOf(rows);
  const ok = totals.total - totals.ko;
  const rps = totals.total / Math.max(1, durationS);
  return {
    ...base,
    id,
    total_requests: totals.total,
    ok_requests: ok,
    ko_requests: totals.ko,
    ok_count: ok,
    ko_count: totals.ko,
    error_rate: totals.total === 0 ? 0 : totals.ko / totals.total,
    mean_response_time: totals.mean,
    min_response_time:
      rows.length === 0 ? 0 : Math.min(...rows.map((item) => item.min_response_time)),
    max_response_time: Math.max(0, ...rows.map((item) => item.max_response_time)),
    p50: totals.p50,
    p75: Math.round((totals.p50 + totals.p95) / 2),
    p90: null,
    p95: totals.p95,
    p99: totals.p99,
    requests_per_second: rps,
    throughput: rps,
    duration_seconds: durationS,
    error_summary: errors.map((error) => ({ message: error.message, count: error.count })),
    p50_histogram: totals.p50,
    p75_histogram: Math.round((totals.p50 + totals.p95) / 2),
    p90_histogram: Math.round(totals.p50 + (totals.p95 - totals.p50) * 0.75),
    p95_histogram: totals.p95,
    p99_histogram: totals.p99,
    per_request: rows.map((item) => ({
      request_name: item.name,
      total_requests: item.count,
      ok_requests: item.ok_count,
      ko_requests: item.ko_count,
      error_rate: item.error_rate,
      p50_histogram: item.p50_histogram,
      p95_histogram: item.p95_histogram,
      p99_histogram: item.p99_histogram,
    })),
    endpoints: [...rows],
    errors,
    time_series_data: series,
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export interface SelfCheckRunInput {
  readonly id: string;
  readonly scenario: SklepScenario;
  readonly requests: readonly FlowRequest[];
  readonly environment: EnvironmentResponse | undefined;
  /** Clock time the check started. */
  readonly startMs: number;
}

/** The run of a passed self-check: one user, one pass, every request answered. */
export function selfCheckRun(input: SelfCheckRunInput): {
  execution: SklepExecution;
  result: SklepExecutionResult;
  window: { start: string; end: string };
} {
  const base = template<SklepExecution>(
    SKLEP_COLLECTIONS.executions,
    SKLEP_WORLD_IDS.selfCheckExecution,
  );
  const rows = input.requests.map((request, index) => {
    const ms = baseMs(request, index);
    return {
      ...row(request.name, 1, 0, ms, 1),
      mean_response_time: ms,
      p95_histogram: ms,
      p99_histogram: ms,
    };
  });
  const durationS = rows.reduce((sum, item) => sum + item.mean_response_time, 0) / 1000;
  const window = {
    start: iso(input.startMs),
    end: iso(input.startMs + Math.ceil(durationS) * 1000),
  };
  const execution: SklepExecution = {
    ...base,
    id: input.id,
    scenario_id: input.scenario.id,
    started_at: window.start,
    completed_at: window.end,
    created_at: window.start,
    duration_seconds: durationS,
    total_requests: rows.length,
    ok_count: rows.length,
    ko_count: 0,
    run_manifest: {
      ...base.run_manifest,
      proportions: {
        source: 'single_scenario',
        weights: [{ scenario_id: input.scenario.id, variant_label: '', proportion: 1 }],
      },
      target_base_url: input.environment?.base_url ?? base.run_manifest.target_base_url,
      target_environment_id: input.environment?.id ?? base.run_manifest.target_environment_id,
      target_environment_name: input.environment?.name ?? base.run_manifest.target_environment_name,
      members: [
        {
          scenario_id: input.scenario.id,
          variant_label: '',
          scenario_version: input.scenario.current_version,
          artifact_digest_at_run: `${input.scenario.id}:artifact`,
        },
      ],
      feeders: [],
    },
  };
  return { execution, result: resultOf(input.id, rows, durationS, [], []), window };
}

export interface LoadRunInput {
  readonly id: string;
  readonly kind: 'composition' | 'scenario';
  readonly targetId: string;
  /** Scenario id → share of the traffic (0..1), with the requests of its flow. */
  readonly members: readonly {
    readonly scenario: SklepScenario;
    readonly share: number;
    readonly requests: readonly FlowRequest[];
  }[];
  readonly environment: EnvironmentResponse | undefined;
  readonly workload: Record<string, unknown> | null;
  /** Clock times of the start of the load and of its end. */
  readonly startMs: number;
  readonly endMs: number;
  readonly createdMs: number;
  /** Requests per second at the end of the ramp. */
  readonly rps: number;
  /**
   * The verdict the numbers are made to give against the thresholds of the workload: `pass` keeps
   * every request under them and error-free, `fail` puts the slowest request and the error rate
   * over them. Without it the numbers are the world's own and the thresholds decide. A forced
   * verdict on a workload without thresholds is judged against FORCED_THRESHOLDS.
   */
  readonly verdict?: 'pass' | 'fail';
  /** The telemetry source of the project, when it has one. */
  readonly telemetry: {
    readonly kind: string;
    readonly label: string;
    readonly url: string;
  } | null;
}

/** The thresholds a forced verdict is judged against when the run was started without any. */
export const FORCED_THRESHOLDS: readonly Record<string, unknown>[] = [
  { type: 'responseTime', percentile: 95, max_ms: 500 },
  { type: 'failedRequests', max_percent: 1 },
];

interface Threshold {
  readonly type?: unknown;
  readonly max_ms?: unknown;
  readonly max_percent?: unknown;
}

/** The finished record of a load test of the document: its run, its result and its analysis. */
export function loadRun(input: LoadRunInput): {
  execution: SklepExecution;
  result: SklepExecutionResult;
  analysis: SklepExecutionAnalysis;
} {
  const base = template<SklepExecution>(
    SKLEP_COLLECTIONS.executions,
    SKLEP_WORLD_IDS.executionPerf,
  );
  const durationS = Math.max(1, Math.round((input.endMs - input.startMs) / 1000));
  const total = Math.max(1, Math.round(input.rps * durationS * 0.6));

  // Every request of every member, the share of its scenario split over its requests.
  const weights = new Map<string, { request: FlowRequest; weight: number; index: number }>();
  for (const member of input.members) {
    member.requests.forEach((request, index) => {
      const key = `${request.method} ${request.path}`;
      const known = weights.get(key);
      const weight = member.share / Math.max(1, member.requests.length);
      weights.set(key, {
        request,
        weight: (known?.weight ?? 0) + weight,
        index: Math.max(known?.index ?? 0, index),
      });
    });
  }
  const given = (
    Array.isArray(input.workload?.['thresholds']) ? input.workload['thresholds'] : []
  ) as Threshold[];
  const thresholds = given.length === 0 && input.verdict !== undefined ? FORCED_THRESHOLDS : given;
  const limitMs = Math.min(
    Infinity,
    ...thresholds.flatMap((t) =>
      t.type === 'responseTime' && typeof t.max_ms === 'number' ? [t.max_ms] : [],
    ),
  );
  const limitPct = Math.min(
    Infinity,
    ...thresholds.flatMap((t) =>
      t.type === 'failedRequests' && typeof t.max_percent === 'number' ? [t.max_percent] : [],
    ),
  );
  const entries = [...weights.entries()];
  const weightSum = entries.reduce((sum, [, entry]) => sum + entry.weight, 0) || 1;
  // The slowest request is the last write of the longest flow: it carries the errors of the run.
  const slowest = ranked(entries, ([, entry]) => baseMs(entry.request, entry.index))[0]?.[0] ?? '';
  const p50Of = (key: string, entry: { request: FlowRequest; index: number }): number =>
    baseMs(entry.request, entry.index) * (key === slowest ? 3 : 1);
  const countOf = (entry: { weight: number }): number =>
    Math.max(1, Math.round((total * entry.weight) / weightSum));
  // A forced verdict moves the latencies (and the errors) to the side of the thresholds it needs:
  // the slowest request's p95 is 2.2 times its p50.
  const naturalP95 = Math.max(0, ...entries.map(([key, entry]) => p50Of(key, entry) * 2.2));
  const slowCount = countOf(weights.get(slowest) ?? { weight: 0 });
  let scale = 1;
  let koRate = 0.02;
  if (input.verdict === 'pass') {
    if (Number.isFinite(limitMs) && naturalP95 > 0)
      scale = Math.min(1, (0.7 * limitMs) / naturalP95);
    koRate = 0;
  } else if (input.verdict === 'fail') {
    if (Number.isFinite(limitMs) && naturalP95 > 0)
      scale = Math.max(1, (1.5 * limitMs) / naturalP95);
    if (Number.isFinite(limitPct)) {
      const share = slowCount / Math.max(1, total);
      koRate = Math.min(1, Math.max(koRate, (1.5 * limitPct) / 100 / Math.max(0.01, share)));
    }
  }
  const rows = entries.map(([key, entry]) => {
    const count = countOf(entry);
    const slow = key === slowest;
    const p50 = Math.max(1, Math.round(p50Of(key, entry) * scale));
    return row(key, count, slow ? Math.round(count * koRate) : 0, p50, durationS);
  });
  const totals = totalsOf(rows);
  const slowRow = rows.find((item) => item.name === slowest);
  const errorHash = 'http-503';
  const errors: SklepExecutionResult['errors'] =
    slowRow === undefined || slowRow.ko_count === 0
      ? []
      : [
          {
            error_hash: errorHash,
            message: 'HTTP 503',
            http_status: 503,
            ko_limb: 'http_status',
            source: 'gatling-log',
            in_ko_count: true,
            count: slowRow.ko_count,
            percentage: 100,
            affected_endpoints: [slowest],
            first_seen: iso(input.startMs + durationS * 600),
            last_seen: iso(input.endMs),
          },
        ];

  // Five-second points of the ramp: the slowest request slows down in the last third.
  const series: SklepTimePoint[] = [];
  for (let elapsed = 0; elapsed < durationS; elapsed += 5) {
    const rps = Math.round((elapsed / durationS) * input.rps * 100) / 100;
    const late = elapsed >= durationS * 0.6;
    const ko = late ? Math.round(rps * 0.01 * 100) / 100 : 0;
    series.push({
      elapsed_seconds: elapsed,
      requests_per_second: rps,
      ok_per_second: Math.round((rps - ko) * 100) / 100,
      ko_per_second: ko,
      mean_response_time: late ? totals.mean * 2 : totals.mean,
      p50_histogram: totals.p50,
      p95_histogram: late ? totals.p95 : Math.round(totals.p95 / 4),
      p99_histogram: totals.p99,
      max_response_time: totals.p99 * 2,
    });
  }

  const errorPct = Math.round((totals.ko / totals.total) * 10000) / 100;
  const baseAssertions = base.sla_verdict?.assertions ?? [];
  const assertions = thresholds.flatMap((threshold) => {
    if (threshold.type === 'responseTime' && typeof threshold.max_ms === 'number') {
      const [shape] = baseAssertions;
      if (shape === undefined) return [];
      return [
        {
          ...shape,
          threshold: [threshold.max_ms],
          threshold_label: threshold.max_ms.toFixed(1),
          actual: totals.p95,
          passed: totals.p95 < threshold.max_ms,
          samples: totals.total,
          message: `Global: 95th percentile of response time is less than ${threshold.max_ms.toFixed(1)}`,
        },
      ];
    }
    if (threshold.type === 'failedRequests' && typeof threshold.max_percent === 'number') {
      const shape = baseAssertions[1];
      if (shape === undefined) return [];
      return [
        {
          ...shape,
          threshold: [threshold.max_percent],
          threshold_label: threshold.max_percent.toFixed(1),
          actual: errorPct,
          passed: errorPct < threshold.max_percent,
          samples: totals.total,
          message: `Global: percentage of failed events is less than ${threshold.max_percent.toFixed(1)}`,
        },
      ];
    }
    return [];
  });
  const failed = assertions.some((assertion) => !assertion.passed);
  const workload = input.workload;
  const execution: SklepExecution = {
    ...base,
    id: input.id,
    scenario_id: input.kind === 'scenario' ? input.targetId : null,
    composite_id: input.kind === 'composition' ? input.targetId : null,
    started_at: iso(input.startMs),
    completed_at: iso(input.endMs),
    created_at: iso(input.createdMs),
    duration_seconds: durationS,
    run_exit_code: failed ? 2 : 0,
    sla_verdict:
      base.sla_verdict === null || assertions.length === 0
        ? null
        : {
            ...base.sla_verdict,
            status: failed ? 'failed' : 'passed',
            window_s: durationS,
            assertions,
            gatling_exit_code: failed ? 2 : 0,
            gatling_status: failed ? 'failed' : 'passed',
          },
    result_has_errors: totals.ko > 0,
    total_requests: totals.total,
    ok_count: totals.total - totals.ko,
    ko_count: totals.ko,
    run_manifest: {
      ...base.run_manifest,
      workload:
        workload === null
          ? null
          : {
              kind: 'adr005',
              value: {
                type: typeof workload['type'] === 'string' ? workload['type'] : 'ramp_concurrency',
                vusers: numberOrNull(workload['vusers']) ?? 1,
                ramp: numberOrNull(workload['ramp']) ?? 0,
                ...(typeof workload['hold'] === 'number' ? { hold: workload['hold'] } : {}),
              },
            },
      proportions: {
        source: input.kind === 'composition' ? 'composition_links' : 'single_scenario',
        weights: input.members.map((member) => ({
          scenario_id: member.scenario.id,
          variant_label: '',
          proportion: member.share,
        })),
      },
      target_base_url: input.environment?.base_url ?? base.run_manifest.target_base_url,
      target_environment_id: input.environment?.id ?? base.run_manifest.target_environment_id,
      target_environment_name: input.environment?.name ?? base.run_manifest.target_environment_name,
      members: input.members.map((member) => ({
        scenario_id: member.scenario.id,
        variant_label: '',
        scenario_version: member.scenario.current_version,
        artifact_digest_at_run: `${member.scenario.id}:artifact`,
      })),
      feeders: [],
    },
  };

  const analysisBase = template<SklepExecutionAnalysis>(
    SKLEP_COLLECTIONS.analyses,
    SKLEP_WORLD_IDS.analysis,
  );
  const slowP95 = slowRow?.p95_histogram ?? totals.p95;
  const offset = (fraction: number): string => {
    const seconds = Math.round(durationS * fraction);
    return `T+${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const summary =
    `The slowest request is ${slowest}: its p95 is ${String(slowP95)} ms and ` +
    `${String(slowRow?.ko_count ?? 0)} of its requests end with 503 in the last third of the ramp.`;
  const document: Omit<SklepAnalysisDocument, 'external_evidence'> & {
    external_evidence: SklepAnalysisDocument['external_evidence'] | null;
  } = {
    ...analysisBase.analysis,
    verdict: failed ? 'fail' : 'pass',
    summary,
    confidence: 'medium',
    error_analyses: errors.map((error) => ({
      error_hash: error.error_hash,
      http_status: error.http_status,
      probable_cause: `${slowest}: the service answers 503 once the load passes 60% of the ramp`,
      confidence: 'medium',
      evidence: [`${String(error.count)} responses 503 on ${slowest}`],
      evidence_sources: ['run:errors'],
      suggested_fixes: [`look at what ${slowest} waits for under load`],
    })),
    performance_concerns: [
      {
        endpoint: slowest,
        metric: 'latency_step',
        observed: slowP95,
        summary: `The p95 of ${slowest} doubles from ${offset(0.6)}.`,
        severity: 'medium',
        window_start_offset: offset(0.6),
        window_end_offset: offset(1),
        before_ms: Math.round(slowP95 / 2),
        after_ms: null,
      },
    ],
    step_hypotheses: [
      {
        kind: 'isolated',
        endpoints: [slowest],
        hypothesis: `${slowest} holds a shared resource while it answers.`,
        checks: [`Does ${slowest} wait on a lock or a pool under load?`],
      },
    ],
    recommendations: [`look at what ${slowest} waits for under load`],
    latency_steps: null,
    latency_steps_reason: 'no_step_found',
    external_evidence:
      input.telemetry === null
        ? null
        : {
            source: input.telemetry,
            window: { start: iso(input.startMs), end: iso(input.endMs) },
            calls: [],
            skipped: [],
            error: null,
          },
  };
  const analysis = {
    ...analysisBase,
    id: `analysis-${input.id}`,
    execution_id: input.id,
    verdict: document.verdict,
    summary,
    analysis: document,
    generated_at: iso(input.endMs + 60_000),
  } as SklepExecutionAnalysis;

  const vusers = workload === null ? null : numberOrNull(workload['vusers']);
  return {
    execution,
    result: { ...resultOf(input.id, rows, durationS, errors, series), peak_active_users: vusers },
    analysis,
  };
}
