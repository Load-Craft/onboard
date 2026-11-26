// WebSocket side of the fake backend: the six channels of contracts/ws-frames.json on the port of
// the HTTP fake, with the behaviour of the real channels (no history on connect, a refine job
// cancelled after 45 s without a watcher, a HAR split abandoned when the socket goes, handshake
// requirements) driven by the test clock. Every frame the fake sends is checked against the frame
// contract; a frame outside it is recorded as a violation and not sent.

import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';

import type { Clock } from '../../src/ops/clock.js';
import { CHANNELS } from '../../src/ws/generated/channels.js';
import type { Channel } from '../../src/ws/frames.js';
import type { ChannelParams } from '../../src/ws/url.js';
import { beginWork } from '../helpers/clock.js';
import type { Job, Jobs } from './jobs.js';

// ---- public types ---------------------------------------------------------------------------

/** A frame as it goes over the wire: `{type, payload}` on enveloped channels, `{type, ...keys}` on flat ones. */
export interface WireFrame {
  readonly type: string;
  readonly [key: string]: unknown;
}

/**
 * - `running`: the task is alive (a HAR run waiting for `split_resume` is still running).
 * - `finished`: a terminal frame was emitted.
 * - `cancelled`: a refine job cancelled after 45 s without a watcher.
 * - `abandoned`: a HAR run dropped because its socket went while a split proposal was open.
 * - `expired`: the finished task was forgotten (600 s after the end) or the backend restarted.
 */
export type ChannelStatus = 'running' | 'finished' | 'cancelled' | 'abandoned' | 'expired';

export interface JobEmission {
  /** Milliseconds after the job started at which the frame is emitted. */
  readonly afterMs: number;
  readonly frame: WireFrame;
}

export interface ChannelStub<C extends Channel = Channel> {
  readonly name: C;
  readonly params: ChannelParams<C>;
  /**
   * Sends a frame as the backend would: to the open sockets, and stored where the real channel
   * stores it (see the behaviour of each channel). The frame is checked against the contract.
   * Once the task is no longer running the frame reaches nobody.
   */
  emit(frame: WireFrame): void;
  /** The backend closes every open socket of this task with `code` (default 1000). */
  close(code?: number): void;
  /** Sockets open now. */
  readonly connections: number;
  /** Sockets accepted so far. */
  readonly opened: number;
  /** Messages the client sent, parsed from JSON (the raw text when it is not JSON). */
  readonly received: readonly unknown[];
  /**
   * Calls `listener` with every later message of the client, after it is recorded: a test answers
   * the client the way the backend does (a split proposal after `har:generate`).
   */
  onMessage(listener: (message: unknown) => void): void;
  /** Path and query of every accepted connection, in order: what the client put in the address. */
  readonly addresses: readonly string[];
  readonly status: ChannelStatus;
  /**
   * Ties frames to a fake job: each one is emitted when the test clock reaches `afterMs` after the
   * job's start, unless the job is gone by then (backend restart) or `active` says no (the work
   * the frames describe was stopped).
   */
  attach(job: Job, emissions: readonly JobEmission[], active?: () => boolean): void;
}

export interface WsLayer {
  channel<C extends Channel>(name: C, params: ChannelParams<C>): ChannelStub<C>;
  /** Handles an HTTP upgrade request of the fake server. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Drops the connections of every task of the channel without a close frame. */
  dropChannel(name: Channel): void;
  /** From now on every upgrade is refused with HTTP 503. */
  blockWebSocket(): void;
  /** From now on every upgrade is left unanswered: the client waits for the handshake. */
  holdWebSocket(): void;
  /** Ends `blockWebSocket` and `holdWebSocket`; a held upgrade is dropped. */
  allowWebSocket(): void;
  /** Backend restart: every task is forgotten and its sockets are closed. */
  restart(): void;
  close(): void;
}

export interface WsLayerOptions {
  readonly clock: Pick<Clock, 'now'> & { sleep?: Clock['sleep'] };
  readonly jobs: Jobs;
  /** Bearer token the identity-protected channels accept. */
  readonly token: string;
  /** Called for every frame outside the contract. */
  readonly onViolation: (operation: string, problems: readonly string[]) => void;
}

// ---- frame contract -------------------------------------------------------------------------

interface KeySpec {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly nullable?: boolean;
  readonly items?: readonly KeySpec[];
}

interface FrameSpec {
  readonly type: string;
  readonly envelope?: 'payload' | 'flat';
  readonly keys: readonly KeySpec[];
}

interface ChannelSpec {
  readonly path: string;
  readonly envelope: 'payload' | 'flat';
  readonly server: readonly FrameSpec[];
}

interface FrameContract {
  readonly channels: Readonly<Record<Channel, ChannelSpec>>;
}

const FRAMES_PATH = fileURLToPath(new URL('../../../contracts/ws-frames.json', import.meta.url));

function loadFrameContract(): FrameContract {
  return JSON.parse(readFileSync(FRAMES_PATH, 'utf8')) as FrameContract;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
    default:
      return false;
  }
}

function checkKeys(
  specs: readonly KeySpec[],
  body: Record<string, unknown>,
  at: string,
  problems: string[],
): void {
  for (const spec of specs) {
    const where = at === '' ? spec.name : `${at}.${spec.name}`;
    const value = body[spec.name];
    if (value === undefined) {
      if (spec.required) problems.push(`${where}: required key is missing`);
      continue;
    }
    if (value === null) {
      if (spec.nullable !== true) problems.push(`${where}: null is not accepted`);
      continue;
    }
    if (!matchesType(spec.type, value)) {
      problems.push(`${where}: expected ${spec.type}`);
      continue;
    }
    if (spec.items === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((element, index) => {
        if (isRecord(element))
          checkKeys(spec.items ?? [], element, `${where}[${String(index)}]`, problems);
      });
    } else if (isRecord(value)) {
      checkKeys(spec.items, value, where, problems);
    }
  }
}

/** Problems of a server frame against the contract of its channel; empty when it conforms. */
function frameProblems(contract: FrameContract, channel: Channel, frame: unknown): string[] {
  if (!isRecord(frame) || typeof frame['type'] !== 'string' || frame['type'] === '') {
    return ['a frame must be an object with a string "type"'];
  }
  const type = frame['type'];
  const spec = contract.channels[channel].server.find((candidate) => candidate.type === type);
  if (spec === undefined) {
    return [`frame type "${type}" is not in the contract of the "${channel}" channel`];
  }
  const envelope = spec.envelope ?? contract.channels[channel].envelope;
  const problems: string[] = [];
  let body: Record<string, unknown>;
  if (envelope === 'payload') {
    const payload = frame['payload'];
    if (!isRecord(payload))
      return [`payload: missing or not an object (enveloped frame "${type}")`];
    body = payload;
  } else {
    if ('payload' in frame) problems.push('payload: flat frame must not have a payload wrapper');
    body = Object.fromEntries(Object.entries(frame).filter(([key]) => key !== 'type'));
  }
  checkKeys(spec.keys, body, envelope === 'payload' ? 'payload' : '', problems);
  return problems;
}

// ---- tasks ----------------------------------------------------------------------------------

const REFINE_UNWATCHED_GRACE_MS = 45_000;
const FINISHED_RETENTION_MS = 600_000;

interface Task {
  readonly name: Channel;
  readonly params: Readonly<Record<string, string>>;
  readonly key: string;
  readonly sockets: Set<WebSocket>;
  readonly received: unknown[];
  readonly listeners: ((message: unknown) => void)[];
  readonly addresses: string[];
  opened: number;
  status: ChannelStatus;
  gone: boolean;
  /** refine: the state sent to a new socket. */
  current?: WireFrame;
  /** refine: stops the 45 s countdown. */
  watchTimer?: AbortController;
  /** batch: the last event of every basket, in order of first appearance. */
  baskets: Map<string, WireFrame>;
  /** batch: the end of the run. */
  runEnd?: WireFrame;
  /** scenario: the last terminal frame, handed to the first socket after the end. */
  lastTerminal?: WireFrame;
  /** describe and har: a split proposal waits for `split_resume`. */
  proposal?: WireFrame;
  /** describe: the drive state sent to a new socket. */
  snapshot?: WireFrame;
}

const TERMINAL_TYPES: Record<Channel, ReadonlySet<string>> = {
  refine: new Set([
    'flow-suggestions-refine:complete',
    'flow-suggestions-refine:error',
    'flow-suggestions-refine:cancelled',
  ]),
  batch: new Set(['batch-generation:complete', 'batch-generation:error']),
  scenario: new Set([
    'gatling-scenario:complete',
    'gatling-scenario:error',
    'gatling-scenario:cancelled',
  ]),
  analysis: new Set(['gatling-analysis:complete', 'gatling-analysis:error']),
  har: new Set(['har:complete', 'har:error', 'har:cancelled']),
  describe: new Set(['complete', 'error', 'cancelled', 'interrupted']),
};

function taskKey(name: Channel, params: Readonly<Record<string, string>>): string {
  return `${name}|${JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)))}`;
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function bearerOf(header: string | undefined): string | undefined {
  const match = /^Bearer (.+)$/i.exec(header?.trim() ?? '');
  return match?.[1]?.trim();
}

/** The backend's `Origin` check: present, http(s), and the same host and port as the `Host` header. */
function originProblem(origin: string | undefined, host: string | undefined): string | undefined {
  if (origin === undefined || origin === '') return 'origin_missing';
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return 'origin_not_allowed';
  }
  const sameHost = host !== undefined && parsed.host.toLowerCase() === host.toLowerCase();
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && sameHost
    ? undefined
    : 'origin_not_allowed';
}

function compilePath(template: string): { regex: RegExp; names: string[] } {
  const names: string[] = [];
  const source = template
    .split(/(\{[a-z_]+\})/)
    .map((part) => {
      const name = /^\{([a-z_]+)\}$/.exec(part)?.[1];
      if (name === undefined) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(name);
      return '([^/]+)';
    })
    .join('');
  return { regex: new RegExp(`^${source}$`), names };
}

export function createWsLayer(options: WsLayerOptions): WsLayer {
  const { clock, jobs, token, onViolation } = options;
  const contract = loadFrameContract();
  const channels = (Object.keys(contract.channels) as Channel[]).map((name) => ({
    name,
    ...compilePath(CHANNELS[name].address),
  }));
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const tasks = new Map<string, Task>();
  const lifetime = new AbortController();
  let blocked = false;
  let held = false;
  const waiting = new Set<Duplex>();

  // ---- time ----

  /** Runs `action` once the test clock has moved `ms` on, unless the returned controller aborts first. */
  const later = (ms: number, action: () => void): AbortController => {
    if (clock.sleep === undefined) {
      throw new Error(
        'fake.channel() needs a clock with sleep(): pass the test clock to startFake.',
      );
    }
    const timer = new AbortController();
    const signal = AbortSignal.any([timer.signal, lifetime.signal]);
    clock.sleep(ms, signal).then(
      () => {
        if (!signal.aborted) action();
      },
      () => undefined,
    );
    return timer;
  };

  // ---- sending ----

  const checkedFrame = (name: Channel, frame: unknown): frame is WireFrame => {
    const problems = frameProblems(contract, name, frame);
    if (problems.length === 0) return true;
    const type = isRecord(frame) && typeof frame['type'] === 'string' ? frame['type'] : '?';
    onViolation(`ws ${name} ${type}`, problems);
    return false;
  };

  const sendTo = (ws: WebSocket, frame: WireFrame): void => {
    ws.send(JSON.stringify(frame));
  };

  const broadcast = (task: Task, frame: WireFrame): void => {
    for (const ws of task.sockets) sendTo(ws, frame);
  };

  // ---- task life ----

  const forget = (task: Task): void => {
    task.watchTimer?.abort();
    task.gone = true;
    task.status = 'expired';
    if (tasks.get(task.key) === task) tasks.delete(task.key);
  };

  const retain = (task: Task): void => {
    later(FINISHED_RETENTION_MS, () => forget(task));
  };

  const watch = (task: Task): void => {
    task.watchTimer?.abort();
    task.watchTimer = later(REFINE_UNWATCHED_GRACE_MS, () => {
      if (task.status !== 'running' || task.sockets.size > 0) return;
      task.status = 'cancelled';
      task.current = {
        type: 'flow-suggestions-refine:cancelled',
        payload: { job_id: task.params['job_id'] ?? '', status: 'cancelled' },
      };
      retain(task);
    });
  };

  const finish = (task: Task): void => {
    task.status = 'finished';
    task.watchTimer?.abort();
    if (task.name === 'refine' || task.name === 'batch') retain(task);
  };

  const emit = (task: Task, frame: WireFrame): void => {
    if (!checkedFrame(task.name, frame)) return;
    if (task.gone || task.status !== 'running') return;
    const terminal = TERMINAL_TYPES[task.name].has(frame.type);
    switch (task.name) {
      case 'refine':
        task.current = frame;
        broadcast(task, frame);
        if (terminal) finish(task);
        return;
      case 'batch': {
        const payload = frame['payload'];
        const basket = isRecord(payload) ? payload['basket_id'] : undefined;
        if (typeof basket === 'string') task.baskets.set(basket, frame);
        else task.runEnd = frame;
        broadcast(task, frame);
        if (terminal) finish(task);
        return;
      }
      case 'scenario':
        if (terminal) task.lastTerminal = frame;
        broadcast(task, frame);
        if (terminal) finish(task);
        return;
      case 'analysis':
        broadcast(task, frame);
        if (terminal) finish(task);
        return;
      case 'har':
        if (frame.type === 'split_proposal') task.proposal = frame;
        broadcast(task, frame);
        if (terminal) finish(task);
        return;
      case 'describe':
        if (frame.type === 'drive_snapshot') {
          // Only a socket that connects later is told the drive state.
          task.snapshot = frame;
          return;
        }
        if (frame.type === 'split_proposal') task.proposal = frame;
        if (terminal) {
          task.lastTerminal = frame;
          delete task.proposal;
        }
        broadcast(task, frame);
        return;
    }
  };

  const createTask = (name: Channel, params: Readonly<Record<string, string>>): Task => {
    const task: Task = {
      name,
      params,
      key: taskKey(name, params),
      sockets: new Set(),
      received: [],
      listeners: [],
      addresses: [],
      opened: 0,
      status: 'running',
      gone: false,
      baskets: new Map(),
    };
    if (name === 'refine') {
      task.current = {
        type: 'flow-suggestions-refine:progress',
        payload: { job_id: params['job_id'] ?? '', status: 'running', progress: 0 },
      };
      watch(task);
    }
    tasks.set(task.key, task);
    return task;
  };

  // ---- connections ----

  /**
   * Why the handshake is refused, or undefined. The backend refuses before it accepts, so the
   * client sees HTTP 403 and no close code. Order as in the backend: Origin, identity, run.
   */
  const handshakeRefusal = (
    name: Channel,
    req: IncomingMessage,
    params: Readonly<Record<string, string>>,
  ): string | undefined => {
    if (name !== 'har' && name !== 'describe') return undefined;
    if (name === 'describe') {
      const problem = originProblem(req.headers.origin, req.headers.host);
      if (problem !== undefined) return problem;
    }
    if (bearerOf(req.headers.authorization) !== token) return 'authentication_required';
    if (name === 'describe' && !tasks.has(taskKey(name, params))) return 'run_not_found';
    return undefined;
  };

  const sendOnConnect = (task: Task, ws: WebSocket): void => {
    switch (task.name) {
      case 'refine':
        if (task.current !== undefined) sendTo(ws, task.current);
        return;
      case 'batch':
        for (const frame of task.baskets.values()) sendTo(ws, frame);
        if (task.runEnd !== undefined) sendTo(ws, task.runEnd);
        return;
      case 'scenario':
        if (task.lastTerminal !== undefined) {
          sendTo(ws, task.lastTerminal);
          delete task.lastTerminal;
        }
        return;
      case 'describe':
        if (task.proposal !== undefined) sendTo(ws, task.proposal);
        if (task.snapshot !== undefined) sendTo(ws, task.snapshot);
        if (task.lastTerminal !== undefined) sendTo(ws, task.lastTerminal);
        return;
      case 'analysis':
      case 'har':
        return;
    }
  };

  const onDisconnect = (task: Task): void => {
    if (task.gone || task.sockets.size > 0) return;
    if (task.name === 'refine' && task.status === 'running') watch(task);
    if (task.name === 'har' && task.status === 'running' && task.proposal !== undefined) {
      task.status = 'abandoned';
    }
  };

  const onMessage = (task: Task, data: RawData): void => {
    const text = rawText(data);
    let message: unknown = text;
    try {
      message = JSON.parse(text);
    } catch {
      // kept as text
    }
    task.received.push(message);
    const type = isRecord(message) ? message['type'] : undefined;
    if (type === 'split_resume') delete task.proposal;
    for (const listener of task.listeners) listener(message);
  };

  const admit = (
    ws: WebSocket,
    req: IncomingMessage,
    name: Channel,
    params: Record<string, string>,
  ): void => {
    ws.on('error', () => undefined);
    const key = taskKey(name, params);
    let task = tasks.get(key);
    if (task === undefined) {
      if (name === 'scenario' || name === 'analysis' || name === 'har') {
        task = createTask(name, params);
      } else {
        if (name === 'refine') {
          const frame: WireFrame = {
            type: 'flow-suggestions-refine:error',
            payload: {
              job_id: params['job_id'] ?? '',
              status: 'failed',
              error: 'Job not found',
              recoverable: false,
              reason: 'job_not_found',
            },
          };
          if (checkedFrame(name, frame)) sendTo(ws, frame);
        } else if (name === 'batch') {
          const frame: WireFrame = {
            type: 'batch-generation:error',
            payload: {
              status: 'failed',
              error: 'Run not found',
              recoverable: false,
              reason: 'run_not_found',
            },
          };
          if (checkedFrame(name, frame)) sendTo(ws, frame);
        }
        ws.close(4404, 'not found');
        return;
      }
    }
    const live = task;
    live.sockets.add(ws);
    live.opened += 1;
    live.addresses.push(req.url ?? '');
    live.watchTimer?.abort();
    ws.on('message', (data: RawData) => onMessage(live, data));
    ws.on('close', () => {
      live.sockets.delete(ws);
      onDisconnect(live);
    });
    sendOnConnect(live, ws);
  };

  // ---- the layer ----

  const stubOf = <C extends Channel>(task: Task, params: ChannelParams<C>): ChannelStub<C> => ({
    name: task.name as C,
    params,
    emit: (frame) => emit(task, frame),
    close(code = 1000) {
      for (const ws of task.sockets) ws.close(code);
    },
    get connections() {
      return task.sockets.size;
    },
    get opened() {
      return task.opened;
    },
    get received() {
      return task.received;
    },
    onMessage(listener) {
      task.listeners.push(listener);
    },
    get addresses() {
      return task.addresses;
    },
    get status() {
      return task.status;
    },
    attach(job, emissions, active) {
      // One walk through the frames in the order of their times, not one timer per frame: timers of
      // a clock that runs fast on the real one (the demo, the gate) round to whole milliseconds, and
      // on a busy machine two frames a millisecond apart could swap, the end before a last result.
      const ordered = [...emissions].sort((a, b) => a.afterMs - b.afterMs);
      const next = (index: number): void => {
        const emission = ordered[index];
        if (emission === undefined) return;
        later(job.startedAt + emission.afterMs - clock.now(), () => {
          if (jobs.find(job.id) !== undefined && (active?.() ?? true)) emit(task, emission.frame);
          next(index + 1);
        });
      };
      next(0);
    },
  });

  return {
    channel<C extends Channel>(name: C, params: ChannelParams<C>): ChannelStub<C> {
      const given: Record<string, string> = { ...params };
      const expected = compilePath(CHANNELS[name].address).names;
      const missing = expected.filter((param) => typeof given[param] !== 'string');
      if (missing.length > 0 || Object.keys(given).length !== expected.length) {
        throw new Error(
          `channel "${name}" takes the path parameters ${expected.join(', ')}; got ${Object.keys(given).join(', ')}`,
        );
      }
      const existing = tasks.get(taskKey(name, given));
      return stubOf<C>(existing ?? createTask(name, given), params);
    },

    upgrade(req, socket, head) {
      if (held) {
        waiting.add(socket);
        socket.once('close', () => waiting.delete(socket));
        return;
      }
      if (blocked) {
        socket.end(
          'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
        );
        return;
      }
      const path = new URL(req.url ?? '/', 'http://fake.invalid').pathname;
      for (const channel of channels) {
        const match = channel.regex.exec(path);
        if (match === null) continue;
        const params: Record<string, string> = {};
        channel.names.forEach((name, index) => {
          params[name] = decodeURIComponent(match[index + 1] ?? '');
        });
        if (handshakeRefusal(channel.name, req, params) !== undefined) {
          socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
          return;
        }
        // A handshake in progress holds the test clock (see `beginWork`) until the socket is admitted.
        const work = beginWork(`fake backend: WebSocket handshake ${path}`);
        socket.once('close', () => work.done());
        wss.handleUpgrade(req, socket, head, (ws) => {
          work.done();
          admit(ws, req, channel.name, params);
        });
        return;
      }
      socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    },

    dropChannel(name) {
      for (const task of tasks.values()) {
        if (task.name !== name) continue;
        for (const ws of task.sockets) ws.terminate();
      }
    },

    blockWebSocket() {
      blocked = true;
    },

    holdWebSocket() {
      held = true;
    },

    allowWebSocket() {
      blocked = false;
      held = false;
      for (const socket of waiting) socket.destroy();
      waiting.clear();
    },

    restart() {
      for (const task of [...tasks.values()]) {
        forget(task);
        for (const ws of task.sockets) ws.close(1012, 'service restart');
      }
    },

    close() {
      lifetime.abort();
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
