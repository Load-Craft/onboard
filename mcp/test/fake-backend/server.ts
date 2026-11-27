// Fake LoadCraft backend for tool tests: a real `node:http` server on a random port, routes
// registered per test, state in memory, long jobs driven by the test clock, one-shot faults and a
// contract check of every response against contracts/loadcraft-openapi.json.

import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import { onTestFinished } from 'vitest';

import type { paths } from '../../src/http/generated/api.js';
import type { Clock } from '../../src/ops/clock.js';
import type { Channel } from '../../src/ws/frames.js';
import type { ChannelParams } from '../../src/ws/url.js';
import { CANARY } from '../helpers/canary.js';
import { beginWork } from '../helpers/clock.js';
import {
  compileTemplate,
  literalSegments,
  loadContract,
  type ContractOperation,
  type HttpMethod,
} from './contract.js';
import { createJobs, type Jobs } from './jobs.js';
import { createIdSource, createStore, FakeHttpError, type Store } from './store.js';
import { createWsLayer, type ChannelStub } from './ws.js';

export { FakeHttpError } from './store.js';
export type { ErrorBody, Store } from './store.js';
export type { Job, Jobs, JobStep } from './jobs.js';
export type { ChannelStatus, ChannelStub, JobEmission, WireFrame } from './ws.js';

// ---- route typing (from the generated contract types) -------------------------------------

export type RoutePath = Extract<keyof paths, string>;

/** Methods the snapshot declares for a path. */
export type MethodOf<P extends RoutePath> = {
  [M in HttpMethod]: [NonNullable<paths[P][Lowercase<M>]>] extends [never] ? never : M;
}[HttpMethod];

type ParamNames<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | ParamNames<Rest>
  : never;

/** Path parameters of a template, e.g. `{ project_id: string }`. */
export type PathParams<P extends string> = { [K in ParamNames<P>]: string };

type Responses<P extends RoutePath, M extends HttpMethod> =
  NonNullable<paths[P][Lowercase<M>]> extends { responses: infer R } ? R : never;
type JsonBody<R> = R extends { content: { 'application/json': infer B } } ? B : never;

/** JSON body of the operation's success responses. */
export type SuccessBody<P extends RoutePath, M extends HttpMethod> = {
  [S in keyof Responses<P, M>]: S extends 200 | 201 | 202 | 203 | 206
    ? JsonBody<Responses<P, M>[S]>
    : never;
}[keyof Responses<P, M>];

// ---- public API -----------------------------------------------------------------------------

export interface FakeFile {
  readonly field: string;
  readonly filename: string;
  readonly type: string;
  readonly size: number;
  readonly content: Buffer;
}

export interface FakeRequest<Params = Record<string, string>> {
  readonly method: HttpMethod;
  /** Concrete request path, without the query. */
  readonly path: string;
  readonly params: Params;
  readonly query: Readonly<Record<string, string>>;
  /** Every value of every query parameter, in order; `query` keeps only the last of a repeated one. */
  readonly queryAll: Readonly<Record<string, readonly string[]>>;
  /** Parsed JSON, the non-file fields of a multipart form, a Buffer for other bodies, or undefined. */
  readonly body: unknown;
  readonly files: readonly FakeFile[];
  readonly headers: IncomingHttpHeaders;
  /** Principal of a valid token; undefined on routes that do not require one. */
  readonly userId: string | undefined;
}

export interface FakeResponse<B = unknown> {
  status: number;
  /** JSON value, a Buffer sent as is, or undefined for no body. */
  body?: B | Buffer;
  headers?: Record<string, string>;
}

/**
 * Answers a request with a success body of the operation; an error response is thrown as a
 * `FakeHttpError` (typed separately so success bodies keep their literal types).
 */
export type FakeHandler<P extends RoutePath, M extends HttpMethod> = (
  req: FakeRequest<PathParams<P>>,
  store: Store,
  jobs: Jobs,
) => FakeResponse<SuccessBody<P, M>> | Promise<FakeResponse<SuccessBody<P, M>>>;

export interface RouteOptions {
  /**
   * `required` (default): no token → 401 `Authentication required`; a bad one → 401.
   * `optional`: no token passes, a bad one → 401 (as the backend's optional principal).
   * `none`: the header is not looked at.
   */
  auth?: 'required' | 'optional' | 'none';
}

export interface FakeCall {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  /** Request body; a file is replaced by `{ file: <name>, size: <bytes> }`, a raw body by `{ size }`. */
  readonly body: unknown;
}

export interface FaultResponse {
  status: number;
  body?: unknown;
}

export interface Faults {
  /**
   * The next request matching method and path (concrete or template) gets this response, once.
   * The response is contract-checked like any other; `outsideContract: true` skips the check for an
   * answer the contract forbids on purpose (a body of the wrong shape), to see how a reader copes.
   */
  next(
    method: HttpMethod,
    path: string,
    response: FaultResponse,
    options?: { readonly outsideContract?: boolean },
  ): void;
  /** Simulated backend restart: every job in memory is forgotten (stored records stay). */
  restart(): void;
  /** Cuts the connections of every task of the channel without a close frame. */
  dropChannel(name: Channel): void;
  /** Until `allowWebSocket()`, every WebSocket upgrade is refused with HTTP 503. */
  blockWebSocket(): void;
  /** Until `allowWebSocket()`, every WebSocket upgrade is left unanswered (a stalled handshake). */
  holdWebSocket(): void;
  allowWebSocket(): void;
}

export interface ContractViolation {
  readonly operation: string;
  readonly status: number;
  readonly problems: readonly string[];
  readonly message: string;
}

export interface Fake {
  readonly url: string;
  /** Bearer token the fake accepts. */
  readonly token: string;
  readonly store: Store;
  readonly jobs: Jobs;
  readonly calls: readonly FakeCall[];
  readonly faults: Faults;
  /**
   * A task of one of the ten WebSocket channels, behaving as the real channel does (see ws.ts);
   * the same name and parameters give the same task. Needs a clock with `sleep`.
   */
  channel<C extends Channel>(name: C, params: ChannelParams<C>): ChannelStub<C>;
  readonly violations: readonly ContractViolation[];
  /** Errors thrown by handlers (other than FakeHttpError); each one fails `close()`. */
  readonly errors: readonly Error[];
  /** Returns the contract violations seen so far and forgets them (for tests that cause them). */
  takeViolations(): ContractViolation[];
  /** Returns the handler errors seen so far and forgets them (for tests that cause them). */
  takeErrors(): Error[];
  /**
   * Registers a route; throws when the snapshot does not have the operation. The handler's success
   * body is typed from the snapshot. TypeScript checks a literal returned straight from the
   * handler against every operation's body while it infers the route, so an enum value written
   * inline needs `as const` (`status: 'queued' as const`); values from typed records do not.
   */
  route<P extends RoutePath, M extends MethodOf<P>>(
    method: M,
    path: P,
    handler: FakeHandler<P, M>,
    options?: RouteOptions,
  ): void;
  /**
   * Stops the server; rejects with every contract violation and handler error not taken. Runs
   * by itself when the test ends (scope `test`); calling it earlier is allowed and idempotent.
   */
  close(): Promise<void>;
}

export interface StartFakeOptions {
  clock: Pick<Clock, 'now'> & { sleep?: Clock['sleep'] };
  /** Seed of the deterministic identifiers (default 1). */
  seed?: number;
  /** Accepted bearer token (default: the canary, so leak checks cover every test). */
  token?: string;
  /** Principal returned for the token (default `user@example.com`). */
  userId?: string;
  /** What `GET /api/v1/meta` reports (defaults: revision 1, capability `meta`, no public address). */
  meta?: {
    version?: string;
    api_revision?: number;
    capabilities?: readonly string[];
    public_base_url?: string | null;
  };
  /** Port to listen on (default: a random free port). */
  port?: number;
  /**
   * `test` (default): must start inside a test or `beforeEach`; when that test ends the fake is
   * closed and the test fails on any violation or handler error left. `manual`: for a fake that
   * outlives one test (beforeAll, demo mode); the owner calls `close()`.
   */
  scope?: 'test' | 'manual';
}

// ---- implementation -------------------------------------------------------------------------

interface Route {
  readonly operation: ContractOperation;
  readonly regex: RegExp;
  readonly names: readonly string[];
  readonly auth: NonNullable<RouteOptions['auth']>;
  readonly handler: (
    req: FakeRequest,
    store: Store,
    jobs: Jobs,
  ) => FakeResponse<unknown> | Promise<FakeResponse<unknown>>;
}

interface PendingFault {
  readonly method: string;
  readonly path: string;
  readonly response: FaultResponse;
  readonly outsideContract: boolean;
}

interface ParsedBody {
  readonly body: unknown;
  readonly files: FakeFile[];
  readonly recorded: unknown;
}

class BadJson extends Error {}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function parseBody(raw: Buffer, contentType: string, url: URL): Promise<ParsedBody> {
  if (raw.length === 0) return { body: undefined, files: [], recorded: undefined };
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mediaType === 'application/json' || mediaType.endsWith('+json')) {
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new BadJson();
    }
    return { body, files: [], recorded: body };
  }
  if (mediaType === 'multipart/form-data') {
    const form = await new Request(url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: raw,
    }).formData();
    const fields: Record<string, unknown> = {};
    const recorded: Record<string, unknown> = {};
    const files: FakeFile[] = [];
    for (const [field, value] of form) {
      if (typeof value === 'string') {
        fields[field] = value;
        recorded[field] = value;
      } else {
        const content = Buffer.from(await value.arrayBuffer());
        files.push({
          field,
          filename: value.name,
          type: value.type,
          size: content.length,
          content,
        });
        recorded[field] = { file: value.name, size: content.length };
      }
    }
    return { body: fields, files, recorded };
  }
  return { body: raw, files: [], recorded: { size: raw.length } };
}

/** 401 detail for a request, or undefined when it may pass (mirrors the backend's messages). */
function authProblem(
  header: string | undefined,
  token: string,
  mode: NonNullable<RouteOptions['auth']>,
): string | undefined {
  if (mode === 'none') return undefined;
  if (header === undefined) return mode === 'required' ? 'Authentication required' : undefined;
  const match = /^Bearer (.*)$/i.exec(header.trim());
  const presented = match?.[1]?.trim() ?? '';
  if (presented === '') return 'Invalid Authorization header';
  if (presented === token) return undefined;
  return presented.includes('.')
    ? 'Invalid principal token signature'
    : 'Malformed principal token';
}

export async function startFake(options: StartFakeOptions): Promise<Fake> {
  // Filled once the server listens; the end-of-test hook closes whatever was started.
  const started: { fake?: Fake } = {};
  if (options.scope !== 'manual') {
    try {
      onTestFinished(() => started.fake?.close());
    } catch (cause) {
      throw new Error(
        "startFake() must run inside a test or beforeEach: the contract check fails the test when it ends. For a fake that outlives a test, pass scope: 'manual' and call close() yourself.",
        { cause },
      );
    }
  }
  const contract = loadContract();
  const token = options.token ?? CANARY;
  const userId = options.userId ?? 'user@example.com';
  const newId = createIdSource(options.seed ?? 1);
  const store = createStore(newId);
  const jobs = createJobs(options.clock, newId);
  const calls: FakeCall[] = [];
  const violations: ContractViolation[] = [];
  const errors: Error[] = [];
  const routes: Route[] = [];
  const ws = createWsLayer({
    clock: options.clock,
    jobs,
    token,
    onViolation(operation, problems) {
      const message = `contract violation: ${operation}: ${problems.join('; ')}`;
      violations.push({ operation, status: 0, problems, message });
    },
  });
  let faults: PendingFault[] = [];

  const takeFault = (method: string, path: string, template: string | undefined) => {
    const index = faults.findIndex(
      (fault) => fault.method === method && (fault.path === path || fault.path === template),
    );
    if (index < 0) return undefined;
    const [fault] = faults.splice(index, 1);
    return fault;
  };

  const findRoute = (method: string, path: string) => {
    let best: { route: Route; params: Record<string, string> } | undefined;
    for (const route of routes) {
      if (route.operation.method !== method) continue;
      const match = route.regex.exec(path);
      if (match === null) continue;
      if (
        best !== undefined &&
        literalSegments(best.route.operation.path) >= literalSegments(route.operation.path)
      ) {
        continue;
      }
      const params: Record<string, string> = {};
      route.names.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1] ?? '');
      });
      best = { route, params };
    }
    return best;
  };

  /** Contract-checks a response; on a violation records it and answers 500 instead. */
  const checked = (
    operation: ContractOperation | undefined,
    response: FakeResponse<unknown>,
  ): FakeResponse<unknown> => {
    if (operation === undefined) return response;
    const body = Buffer.isBuffer(response.body)
      ? response.body
      : response.body === undefined
        ? undefined
        : (JSON.parse(JSON.stringify(response.body)) as unknown);
    const problems = operation.check(response.status, body);
    if (problems.length === 0) return response;
    const message = `contract violation: ${operation.label} → ${String(response.status)}: ${problems.join('; ')}`;
    violations.push({ operation: operation.label, status: response.status, problems, message });
    return { status: 500, body: { detail: `fake backend ${message}` } };
  };

  const handle = async (req: IncomingMessage): Promise<FakeResponse<unknown>> => {
    const url = new URL(req.url ?? '/', 'http://fake.invalid');
    const method = (req.method ?? 'GET').toUpperCase();
    const path = url.pathname;
    const query = Object.fromEntries(url.searchParams);
    const queryAll: Record<string, string[]> = {};
    for (const [key, value] of url.searchParams) (queryAll[key] ??= []).push(value);
    const raw = await readBody(req);
    let parsed: ParsedBody;
    try {
      parsed = await parseBody(raw, req.headers['content-type'] ?? '', url);
    } catch (error) {
      if (!(error instanceof BadJson)) throw error;
      calls.push({ method, path, query, body: { size: raw.length } });
      return {
        status: 422,
        body: { detail: [{ type: 'json_invalid', loc: ['body'], msg: 'JSON decode error' }] },
      };
    }
    calls.push({ method, path, query, body: parsed.recorded });

    const found = findRoute(method, path);
    const operation = found?.route.operation ?? contract.match(method, path);
    const fault = takeFault(method, path, operation?.path);
    if (fault !== undefined) {
      return fault.outsideContract ? fault.response : checked(operation, fault.response);
    }

    if (found === undefined) {
      // FastAPI answers a path that differs only by its trailing slash with a 307 to the other form
      // (Location is absolute), whatever the method; anything else it does not serve is a 404.
      const swapped = path.endsWith('/') ? path.slice(0, -1) : `${path}/`;
      if (swapped !== '' && routes.some((route) => route.regex.test(swapped))) {
        const target = new URL(
          swapped + url.search,
          `http://${req.headers.host ?? 'fake.invalid'}`,
        );
        return { status: 307, headers: { location: target.href } };
      }
      const otherMethod = routes.some((route) => route.regex.test(path));
      return otherMethod
        ? { status: 405, body: { detail: 'Method Not Allowed' } }
        : { status: 404, body: { detail: 'Not Found' } };
    }

    const { route, params } = found;
    const problem = authProblem(req.headers.authorization, token, route.auth);
    if (problem !== undefined) {
      return checked(route.operation, { status: 401, body: { detail: problem } });
    }
    const authenticated = route.auth !== 'none' && req.headers.authorization !== undefined;

    let response: FakeResponse<unknown>;
    try {
      response = await route.handler(
        {
          method: route.operation.method,
          path,
          params,
          query,
          queryAll,
          body: parsed.body,
          files: parsed.files,
          headers: req.headers,
          userId: authenticated ? userId : undefined,
        },
        store,
        jobs,
      );
    } catch (error) {
      if (error instanceof FakeHttpError) {
        response = { status: error.status, body: error.body };
      } else {
        const failure = error instanceof Error ? error : new Error(String(error));
        errors.push(failure);
        return {
          status: 500,
          body: {
            detail: `fake backend handler for ${route.operation.label} threw: ${failure.message}`,
          },
        };
      }
    }
    return checked(route.operation, response);
  };

  const server = createServer((req, res) => {
    // From the moment the request is taken until its answer is sent, `settleClock` does not move the
    // test clock (except while the handler itself sleeps on it).
    const work = beginWork(`fake backend: ${req.method ?? 'GET'} ${req.url ?? '/'}`);
    res.once('close', () => work.done());
    void work.run(() => serve(req, res));
  });

  const serve = (req: IncomingMessage, res: ServerResponse): Promise<void> =>
    handle(req)
      .catch((error: unknown): FakeResponse<unknown> => {
        const failure = error instanceof Error ? error : new Error(String(error));
        errors.push(failure);
        return { status: 500, body: { detail: `fake backend failed: ${failure.message}` } };
      })
      .then((response) => {
        const headers: Record<string, string> = { ...response.headers };
        let payload: Buffer | undefined;
        if (Buffer.isBuffer(response.body)) {
          payload = response.body;
          headers['content-type'] ??= 'application/octet-stream';
        } else if (response.body !== undefined) {
          payload = Buffer.from(JSON.stringify(response.body));
          headers['content-type'] ??= 'application/json';
        }
        res.writeHead(response.status, headers);
        res.end(payload);
      })
      .catch((error: unknown) => {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      });

  server.on('upgrade', (req, socket, head) => ws.upgrade(req, socket, head));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;

  let closing: Promise<void> | undefined;

  const fake: Fake = {
    url: `http://127.0.0.1:${String(port)}`,
    token,
    store,
    jobs,
    calls,
    violations,
    errors,
    takeViolations: () => violations.splice(0),
    takeErrors: () => errors.splice(0),
    channel: (name, params) => ws.channel(name, params),
    faults: {
      dropChannel: (name) => ws.dropChannel(name),
      blockWebSocket: () => ws.blockWebSocket(),
      holdWebSocket: () => ws.holdWebSocket(),
      allowWebSocket: () => ws.allowWebSocket(),
      next(method, path, response, options = {}) {
        const known = contract.has(method, path) || contract.match(method, path) !== undefined;
        if (!known) {
          throw new Error(`fault for ${method} ${path}: not an operation of the contract`);
        }
        faults.push({ method, path, response, outsideContract: options.outsideContract === true });
      },
      restart() {
        jobs.clear();
        ws.restart();
        faults = [];
      },
    },
    route(method, path, handler, routeOptions = {}) {
      const operation = contract.operation(method, path);
      if (routes.some((route) => route.operation === operation)) {
        throw new Error(`${operation.label} is already registered`);
      }
      const { regex, names } = compileTemplate(path);
      routes.push({
        operation,
        regex,
        names,
        auth: routeOptions.auth ?? 'required',
        // The typed handler only narrows params and the body; the server passes both as declared.
        handler: handler as unknown as Route['handler'],
      });
    },
    close() {
      closing ??= new Promise<void>((resolve) => {
        ws.close();
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }).then(() => {
        const problems = [
          ...violations.map((violation) => violation.message),
          ...errors.map((error) => error.message),
        ];
        if (problems.length > 0) {
          throw new Error(
            `fake backend saw ${String(problems.length)} problem(s):\n- ${problems.join('\n- ')}`,
          );
        }
      });
      return closing;
    },
  };

  fake.route('GET', '/api/v1/auth/me', (req) => ({
    status: 200,
    body: { authenticated: true, user_id: req.userId ?? userId },
  }));

  fake.route(
    'GET',
    '/api/v1/meta',
    () => ({
      status: 200,
      body: {
        version: options.meta?.version ?? '0.0.0-fake',
        api_revision: options.meta?.api_revision ?? 1,
        capabilities: [...(options.meta?.capabilities ?? ['meta'])],
        public_base_url: options.meta?.public_base_url ?? null,
      },
    }),
    { auth: 'none' },
  );

  started.fake = fake;
  return fake;
}
