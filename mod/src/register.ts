/**
 * Entry point of the LoadCraft mod, built into mod/register.js by `npm run build:mod` (from mcp/).
 *
 * The only file that may touch `$`. Claude Code reads the built file with a static analysis that
 * `claude plugin validate` repeats, so: every event name in `on(...)` is a string literal, `$` is
 * never stored, destructured or passed to a function from another file (except the `read` and
 * `update` helpers of `claude-code`), and the module uses no Node API or timer global.
 *
 * The mod keeps the session state in `$.state` (see state/reduce.ts). It changes nothing the model
 * sees: each hook returns what `next` returned.
 */

import { atom, read, update } from 'claude-code';

import { createPoller, POLL_MS } from './poll.js';
import { createGate, type Gate } from './state/reader.js';
import { runStartCall, withProgress, type ProgressEvent } from './series.js';
import { reduce } from './state/reduce.js';
import {
  isFromThisMod,
  parseDataBlock,
  resultText,
  shortToolName,
  toolSignal,
} from './state/signal.js';
import { hasBars, parseBars, parseEnded, withBars, type BarEnds } from './bars.js';
import { INITIAL_BARS, INITIAL_PROGRESS, INITIAL_STATE, type ModState } from './state/types.js';
import { isTerminal, type Notice } from './view/status.js';
import { supports } from './capabilities.js';
import { toLocale, type Locale } from './i18n.js';
import { bandRow, bandTree, statusLine, type Tree } from './view/band.js';
import {
  askMessage,
  cardOfEnd,
  cardOfSnapshot,
  checkCards,
  docsCard,
  profileCard,
} from './card/make.js';
import {
  checkEntryKeys,
  isCheckList,
  parseSelfCheck,
  withSelfCheck,
  type SelfCheckFacts,
} from './pane/selfCheck.js';
import {
  EMPTY_CARDS,
  actionOf,
  dismiss,
  enqueue,
  expire,
  head,
  mergeKeys,
  syncKind,
  waiting,
  withClosed,
  type Card,
  type CardsState,
} from './card/queue.js';
import { cardTexts } from './card/texts.js';
import { cardElements, cardTree } from './view/card.js';
import {
  outputText,
  resultKindOfTool,
  resultSelector,
  type ResultSelector,
} from './view/resultId.js';
import { barLine, barsBand, plainOf } from './view/bars.js';
import { progressRow, progressTree } from './view/progress.js';
import { drawResult, toolRow } from './view/results.js';
import { toElements } from './view/tree.js';

import { consentPlan, decide, readFacts, settle, type Outcome } from './consent/decide.js';
import { EMPTY_LEDGER, consume, grant } from './consent/ledger.js';
import { QUESTION_HEADER } from './consent/texts.js';

import { CANCEL_TOOL, cancelQuestion } from './pane/cancel.js';
import {
  AUTO_OPEN_KEY,
  EMPTY_PANEL,
  PANE_ID,
  runLink,
  withPreview,
  markedJourneys,
  withJourneysSent,
  withNoJourneys,
  withJourneyMarks,
  withJourneysAdded,
  withListView,
  listView,
  withMethod,
  withProject,
  withReport,
  withSnapshot,
  type PaneTab,
  type PanelData,
} from './pane/tabs.js';
import {
  compareMessage,
  isStepQuestion,
  journeysMessage,
  methodMessage,
  migrationMessage,
  scenarioMessage,
  stepMessage,
} from './pane/choice.js';
import {
  FLOW_LIST,
  RUN_LIST,
  STEP_LIST,
  comparePair,
  flowsLoaded,
  listKeysOf,
  markedFlows,
  markedOldDocs,
  drawnKeys,
  outlineLoaded,
  runsLoaded,
  wantedReads,
  withFailed,
  readFailure,
  withFlows,
  withMarksAdded,
  withMarksCleared,
  withMarksToggled,
  withOutline,
  withRuns,
  withoutLoaded,
  type WantedRead,
} from './pane/lists.js';
import { paneTexts } from './pane/texts.js';
import {
  JOURNEY_LIST,
  paneElements,
  paneTree,
  type PaneAction,
  type PaneElements,
} from './view/pane.js';
import {
  EMPTY_VIEW,
  entryOfElement,
  filterKey,
  rowKeyOf,
  withBack,
  withGroupToggled,
  withOpen,
  withQuery,
  isListAction,
  type ListAction,
  type ListView,
} from './view/list.js';

/** The server as `/mcp` lists it; `$.mcp.call` takes this name, not the bare `loadcraft`. */
const SERVER = 'plugin:loadcraft:lc';

const session = atom({ plugin: 'loadcraft', key: 'session' }, INITIAL_STATE);
/** The live line of a running `run_start` call (series.ts): the call, its snapshot, its series. */
const progress = atom({ plugin: 'loadcraft', key: 'progress' }, INITIAL_PROGRESS);
/** The bars of the long operations in progress (bars.ts): what the band, the call rows and the panel draw. */
const bars = atom({ plugin: 'loadcraft', key: 'bars' }, INITIAL_BARS);
/** The cards above the prompt: the queue and the keys the user closed (card/queue.ts). */
const cards = atom({ plugin: 'loadcraft', key: 'cards' }, EMPTY_CARDS);
/** `$.store` key of the closed cards, so that a card the user closed does not come back next session. */
const CARDS_CLOSED_KEY = 'cardsClosed';
/** `$.store` key of the cards whose title went to a toast, so that it is not told again every session. */
const CARDS_TOLD_KEY = 'cardsTold';

/**
 * The parts of the mods API this module uses. The full declarations are the ones Claude Code
 * writes into the mod's `.claude-plugin/types/` when it loads the mod from a local folder.
 */
interface SessionStartInput {
  readonly cwd: string;
  readonly surface: string | null;
  readonly isInteractive: boolean;
}

interface ToolCallInput {
  readonly tool: string;
  /** The id of this call; the progress row of the call carries the same one. */
  readonly tool_use_id?: string;
}

/** The `ui.render` input of the band above the prompt (`RenderInputOf<'AbovePrompt', …>`). */
interface AbovePromptInput {
  readonly surface: string;
  readonly props: {
    readonly bodyColumns: number;
    readonly hasSurvey: boolean;
    readonly isCollapsed: boolean;
  };
}

interface Mods {
  readonly clock: {
    now(): Promise<number>;
    after(ms: number, run: () => Promise<void>): unknown;
    every(ms: number, run: () => Promise<void>): unknown;
  };
  readonly ui: {
    status(text: string | undefined): void;
    toast(text: string): void;
    notify(text: string): Promise<{ readonly isSent: boolean; readonly channel?: string }>;
    resolve(
      e: ToolUseRender | ToolResultRender | ToolProgressRender | PaneRender | AbovePromptInput,
    ): PaneElements;
    invalidate(event: 'ui.render'): Promise<unknown>;
    ask(
      question: string,
      options: { readonly options: readonly string[]; readonly header: string },
    ): Promise<string>;
    open(pane: {
      readonly id: string;
      readonly title: string;
      readonly focus?: true;
      readonly closeOnEscape?: true;
    }): Promise<{ readonly isPlaced: boolean; readonly reason?: string }>;
    /** Moves the focus ring of a pane onto one of its elements (the row a preview came from). */
    focus(args: { readonly requestId: string; readonly key: string }): Promise<unknown>;
  };
  readonly command: {
    register(spec: {
      readonly name: string;
      readonly description: string;
      readonly immediate?: true;
    }): Promise<unknown>;
  };
  readonly store: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<unknown>;
  };
  readonly mcp: {
    call(server: string, tool: string, args?: Record<string, unknown>): Promise<unknown>;
  };
  readonly prompt: {
    /** A prompt the model reads as a turn of its own, once the session is idle. */
    submit(input: { readonly text: string }): Promise<unknown>;
  };
}

// ---- Result drawing (MOD-07): types ---------------------------------------------------------------

/** The `ui.render` event of a tool call's row, with the props the row reads. */
interface ToolUseRender {
  readonly component: 'ToolUse';
  readonly surface: string;
  readonly props: {
    readonly tool: string;
    readonly isRunning: boolean;
    readonly isErrored: boolean;
    readonly isExpanded?: boolean;
  };
}

/** The `ui.render` event of the block under a tool row: the result as the model read it. */
interface ToolResultRender {
  readonly component: 'ToolResult';
  readonly surface: string;
  readonly viewport?: { readonly columns: number };
  readonly props: {
    readonly tool_use_id: string;
    readonly tool: string;
    readonly output: unknown;
    readonly isErrored: boolean;
    readonly isExpanded?: boolean;
    /** The rows of the block the viewport shows; `null` while it is drawn outside the viewport. */
    readonly onScreen?: unknown;
  };
}

/**
 * The `ui.render` event of the live row under a running tool call (the terminal only). Its `kind`
 * is today `background_hint`, the run-in-background pill; `tool_use_id` is the call it belongs to.
 */
interface ToolProgressRender {
  readonly component: 'ToolProgress';
  readonly surface: string;
  readonly viewport?: { readonly columns: number };
  readonly props: {
    readonly tool_use_id: string;
    readonly kind: string;
    readonly hint?: string;
  };
}

// ---- Side panel (MOD-09): types ---------------------------------------------------------------

/** The `ui.render` input of a pane; the mod answers only for its own (`requestId` is the id). */
interface PaneRender {
  readonly component: 'Pane';
  readonly requestId: string;
  readonly surface: string;
  readonly props: { readonly bodyColumns: number };
}

/** The `ui.focus` input of the pane: the element the focus ring lands on (absent: an engine stop). */
interface FocusInput {
  readonly requestId: string;
  readonly element?: string;
}

/** What the panel remembers while the session runs: the tab shown, the preference, the last opening. */
interface PaneView {
  tab: PaneTab;
  /** The stored preference "open when a test starts"; `undefined` until it is read. */
  auto: boolean | undefined;
  /** The narrow-terminal hint was shown already. */
  told: boolean;
  /** The test the panel opened for last, so one test opens it once. */
  opened: string | undefined;
  /** The element of the pane under the cursor, as `ui.focus` told it last (for `x` on a row). */
  focused?: string;
  /** The keys of each list as the last drawing held them (`x` resolves the row against these). */
  drawn: Readonly<Record<string, readonly string[]>>;
  /** The reads of the lists that run now (`readKey`), so that a draw does not start one twice. */
  readonly reading: Set<string>;
  /** When each list was read last (epoch ms), so that a state that cannot be written is not read in a loop. */
  readonly readAt: Map<string, number>;
}

/** What the panel keeps in `$.state` beside the session. */
const panel = atom({ plugin: 'loadcraft', key: 'panel' }, EMPTY_PANEL);

/** What the mod knows about the data of one result block, by `tool_use_id`. */
type ResultEntry =
  | { readonly state: 'pending' }
  | { readonly state: 'none' }
  | { readonly state: 'ready'; readonly data: unknown };

/** The data reads of result blocks: what is known, and what waits for the gate. */
interface ResultReads {
  readonly entries: Map<string, ResultEntry>;
  readonly jobs: {
    readonly key: string;
    readonly selector: ResultSelector;
    readonly href?: string;
  }[];
  /** A retry is already set for the reads that found the gate busy. */
  retrying: boolean;
  /** Retries made since a read last got the gate. */
  attempts: number;
}

/** Result blocks remembered at most; the oldest is forgotten first. */
const MAX_RESULTS = 200;
/**
 * A read that found the gate busy tries again after this long, at most `RESULT_RETRIES` times (the
 * gate offers no way to be told when it frees, apart from the status read it queues); then the
 * blocks that wait keep Claude Code's own drawing.
 */
const RESULT_RETRY_MS = 500;
const RESULT_RETRIES = 20;
/**
 * Result blocks waiting for their read at most. Blocks that come faster than the reads (a resumed
 * session draws many at once where the surface does not say what is on screen) push the oldest out,
 * and a block pushed out keeps Claude Code's own drawing: a burst costs the server a few reads.
 */
const MAX_PENDING_READS = 8;
const DEFAULT_WIDTH = 77;

/** `origin` is who raised the dispatch (`{ plugin, tier }`); the engine for a call of the model. */
type Next<E> = ((e: E) => Promise<unknown>) & { readonly origin?: unknown };
type Hook<E> = ($: Mods, e: E, next: Next<E>) => Promise<unknown>;

interface On {
  (event: 'session.start', hook: Hook<SessionStartInput>): unknown;
  (
    event: 'tool.call',
    matcher: { readonly tool: RegExp },
    hook: Hook<ToolCallInput>,
  ): { catch(handler: Hook<ToolCallInput>): unknown };
  (
    event: 'ui.render',
    matcher: { readonly component: 'AbovePrompt' },
    hook: Hook<AbovePromptInput>,
  ): unknown;
  (
    event: 'ui.render',
    matcher: { readonly component: 'ToolUse' },
    hook: Hook<ToolUseRender>,
  ): unknown;
  (
    event: 'ui.render',
    matcher: { readonly component: 'ToolResult' },
    hook: Hook<ToolResultRender>,
  ): unknown;
  (
    event: 'ui.render',
    matcher: { readonly component: 'ToolProgress' },
    hook: Hook<ToolProgressRender>,
  ): unknown;
  (event: 'ui.render', matcher: { readonly component: 'Pane' }, hook: Hook<PaneRender>): unknown;
  (event: 'ui.focus', matcher: { readonly requestId: string }, hook: Hook<FocusInput>): unknown;
  (event: 'command.run', matcher: { readonly command: string }, hook: Hook<object>): unknown;
}

/** What the status line of VS Code needs to remember between two state writes. */
interface StatusMemory {
  /** The line last given to `$.ui.status`, so that an unchanged state does not set it again. */
  shown: string | undefined;
}

/**
 * VS Code has no band: there the step goes to the status line, set when the line changed. The gate
 * (`gate.onStateChange`) hands it every state that was written; the listener is registered in
 * `session.start` on VS Code only. Declared at the top of the file because Claude Code's analysis
 * lets `$` go only to such a function.
 */
function showStatus($: Mods, state: ModState, locale: Locale, memory: StatusMemory): void {
  try {
    const line = statusLine(state, locale);
    if (line === memory.shown) return;
    memory.shown = line;
    $.ui.status(line);
  } catch {
    // The status line stays as it was; the state is written either way.
  }
}

// ---- Consent: the types of the consent hook (the decision itself is in consent/) --------------

/** A call of a guarded tool: its name and its arguments, which the hook never changes. */
interface ConsentCall {
  readonly tool: string;
  readonly [argument: string]: unknown;
}

interface ConsentMods {
  readonly clock: { now(): Promise<number> };
  readonly mcp: {
    call(server: string, tool: string, args?: Record<string, unknown>): Promise<unknown>;
  };
  readonly ui: {
    ask(
      question: string,
      options: { readonly options: readonly string[]; readonly header: string },
    ): Promise<string>;
  };
  readonly session: { surfaces(): Promise<readonly string[]> };
}

type ConsentHook = ($: ConsentMods, e: ConsentCall, next: Next<ConsentCall>) => Promise<unknown>;

/** What `on` returns: `.catch` answers in place of a hook that failed. */
interface Registration<H> {
  catch(handler: H): unknown;
}

interface On {
  (
    event: 'tool.call',
    matcher: { readonly tool: readonly string[] },
    hook: ConsentHook,
  ): Registration<ConsentHook>;
}

const FROM_PANEL_DENIAL = 'from_panel is set only by the LoadCraft panel; call again without it.';

/** What the user agreed to; one use, ten minutes (consent/ledger.ts). */
const consent = atom({ plugin: 'loadcraft', key: 'consent' }, EMPTY_LEDGER);

// ---- End of the consent types -------------------------------------------------------------------

/**
 * Changes the session state the way `change` says, when it changes anything, and lets the listeners
 * of the gate know (`gate.onStateChange`). Every write of the state goes through here.
 */
async function write($: Mods, gate: Gate, change: (state: ModState) => ModState): Promise<void> {
  const known = await read($, session);
  if (change(known) === known) return;
  const next = await update($, session, change);
  gate.changed(next);
}

/**
 * Changes the progress of the live line of a running test (series.ts), when it changes anything;
 * the row that reads it is drawn again after the write. It never throws: the line is a nicety, and
 * a failure here must not reach the call or the poll. Declared at the top level because it takes `$`.
 */
async function noteProgress($: Mods, event: ProgressEvent): Promise<void> {
  try {
    const known = await read($, progress);
    if (withProgress(known, event) === known) return;
    await update($, progress, (current) => withProgress(current, event));
  } catch {
    // The row keeps what it showed.
  }
}

/**
 * Reads the bars of the operations in progress: `process_get_status` with `progress` answers from the
 * state file of the plugin and asks the backend nothing, so it does not wait for the gate. It
 * never throws; a failed read leaves the bars as they were (only the finished ones run out).
 * Declared at the top level because it takes `$`.
 */
async function readBars($: Mods, feed: CardFeed): Promise<void> {
  let rows: ReturnType<typeof parseBars>;
  let ends: BarEnds = {};
  // The same answer carries the newest self-check view: the Run tab draws it, a failure is a card.
  let check: SelfCheckFacts | 'failed' | undefined;
  try {
    const data = parseDataBlock(
      await $.mcp.call(SERVER, 'process_get_status', {
        format: 'data',
        progress: true,
        from_panel: true,
      }),
    );
    rows = parseBars(data);
    ends = parseEnded(data);
    check = rows === undefined ? 'failed' : parseSelfCheck(data);
  } catch {
    rows = undefined;
    check = 'failed';
  }
  await storeBars($, rows, ends, feed);
  await storeCheck($, feed, check);
}

/**
 * Puts the self-check view of a read of the bars into the panel and keeps its card in step with it: a
 * step that failed while the AI repairs, or a check that did not pass, is a card whose action shows the
 * Run tab. Never throws.
 */
async function storeCheck(
  $: Mods,
  feed: CardFeed,
  check: SelfCheckFacts | 'failed' | undefined,
): Promise<void> {
  try {
    await remember($, (known) => withSelfCheck(known, check));
    const before = await read($, cards);
    const wanted = checkCards((await read($, panel)).selfCheck, feed.locale, await $.clock.now());
    const changed = await changeCards($, (known) => syncKind(known, 'check', wanted));
    if (!changed || hasBand(feed.surface)) return;
    const known = new Set(before.queue.map((card) => card.key));
    for (const card of wanted) if (!known.has(card.key)) tellCard($, feed, card);
  } catch {
    // The panel shows what it knew before.
  }
}

/**
 * Puts what a read of the bars found into the atom (`undefined`: the read failed, or none was made;
 * only the finished bars run out). The one place that writes `bars`. Never throws.
 */
async function storeBars(
  $: Mods,
  rows: ReturnType<typeof parseBars>,
  ends: BarEnds = {},
  feed?: CardFeed,
): Promise<void> {
  try {
    const now = await $.clock.now();
    const known = await read($, bars);
    if (withBars(known, rows, now, ends) !== known) {
      await update($, bars, (current) => withBars(current, rows, now, ends));
    }
    if (feed !== undefined) {
      // An operation that ended badly is a card. A test is left to the poll, which reads the reason
      // with it; a card of the same key made here first would hide that reason.
      const failed = (await read($, bars)).finished.flatMap(({ row, end }) =>
        end === 'failed' && row.handle !== undefined && row.kind !== 'test_run'
          ? [cardOfEnd(row.handle, row.kind, end, feed.locale, now)]
          : [],
      );
      await addCards(
        $,
        feed,
        failed.filter((card): card is Card => card !== undefined),
        false,
      );
    }
  } catch {
    // The bars stay as they were.
  }
}

/** What a read of the bars needs to remember: one at a time, the tick, and where the cards go. */
interface BarsRead {
  running: boolean;
  tick: number;
  readonly feed: CardFeed;
}

/** One read of the bars at a time: a read asked for while another runs is not made. */
async function refreshBars($: Mods, reading: BarsRead): Promise<void> {
  if (reading.running) return;
  reading.running = true;
  try {
    await readBars($, reading.feed);
  } finally {
    reading.running = false;
  }
}

/**
 * A background read of the status through the gate (state/reader.ts): refused while one runs, then
 * queued; the answer is put on top of what the calls since it began said. Declared here, at the top
 * level, because it takes `$`: the poll and the tool hook both start it.
 */
/** The names of the proposed journeys the panel knows, in order, joined: what tells a new proposal. */
const journeyNames = (known: PanelData): string =>
  JSON.stringify((known.project?.path?.journeys ?? []).map((item) => item.name));

/**
 * A read of the status that a call of `flows_suggest_journeys` or `process_wait` asked to watch: when
 * the proposed journeys it brings differ from `expect` (the names before the call), `open` runs once.
 * Kept by gate, so that every read through it (also one queued behind a read in flight) sees it.
 */
interface JourneyWatch {
  readonly expect: string;
  readonly open: () => void;
}
const journeyWatches = new WeakMap<Gate, JourneyWatch>();

function readStatus($: Mods, gate: Gate, at: number): void {
  const ticket = gate.begin(at, true);
  if (ticket === undefined) return;
  $.clock.after(0, async () => {
    try {
      const data = parseDataBlock(
        await $.mcp.call(SERVER, 'process_get_status', { format: 'data', from_panel: true }),
      );
      // An answer of a read that stopped counting (it ran past the stale limit and another took its
      // place) has not seen the calls since, so it is dropped.
      if (data === undefined || !gate.isCurrent(ticket)) return;
      await remember($, (known) => withProject(known, data));
      const feed = cardFeeds.get(gate);
      if (feed !== undefined) await syncStatusCards($, feed, data);
      const watch = journeyWatches.get(gate);
      if (watch !== undefined) {
        journeyWatches.delete(gate);
        const names = journeyNames(await read($, panel));
        if (names !== watch.expect && names !== '[]') watch.open();
      }
      const done = await $.clock.now();
      // While a `run_start` call waits, its test is the operation to follow.
      const { call } = await read($, progress);
      const facts = {
        kind: 'status',
        data,
        ...(call === undefined ? {} : { prefer: 'test_run' }),
      } as const;
      // The picture first, then the calls that came after it was asked for, on top of it:
      // nothing a call said is taken back, and a busy session still gets fresh facts.
      const merge = (state: ModState): ModState =>
        ticket.signals.reduce(
          (next, { signal, at: calledAt }) => reduce(next, signal, calledAt),
          reduce(state, facts, done),
        );
      await write($, gate, merge);
    } catch {
      // The state stays as it was.
    } finally {
      if (gate.end(ticket)) readStatus($, gate, await $.clock.now());
    }
  });
}

/**
 * The data of the next result block that waits for it, read through the gate (state/reader.ts), so
 * a result read never runs beside a status read or the poll: when the gate is busy the read tries
 * again shortly. The server gives the data the view of the result is made from through the channel
 * meant for the mod (`process_get_status` with `result`); the answer is kept by `tool_use_id` and the
 * blocks are drawn again. Declared here, at the top level, because it takes `$`.
 */
function readResults($: Mods, gate: Gate, reads: ResultReads, at: number): void {
  if (reads.jobs.length === 0) return;
  const ticket = gate.begin(at, false);
  if (ticket === undefined) {
    if (reads.attempts >= RESULT_RETRIES) {
      for (const waiting of reads.jobs.splice(0)) reads.entries.set(waiting.key, { state: 'none' });
      reads.attempts = 0;
      return;
    }
    if (!reads.retrying) {
      reads.retrying = true;
      reads.attempts += 1;
      $.clock.after(RESULT_RETRY_MS, async () => {
        reads.retrying = false;
        readResults($, gate, reads, await $.clock.now());
      });
    }
    return;
  }
  reads.attempts = 0;
  const job = reads.jobs.shift();
  if (job === undefined) {
    gate.end(ticket);
    return;
  }
  $.clock.after(0, async () => {
    try {
      const data = parseDataBlock(
        await $.mcp.call(SERVER, 'process_get_status', {
          format: 'data',
          from_panel: true,
          result: job.selector,
        }),
      );
      reads.entries.set(job.key, data === undefined ? { state: 'none' } : { state: 'ready', data });
      if (data !== undefined && job.selector.kind === 'report') {
        await remember($, (known) => withReport(known, data, job.href));
      }
      if (data !== undefined) await $.ui.invalidate('ui.render');
    } catch {
      reads.entries.set(job.key, { state: 'none' });
    } finally {
      const queued = gate.end(ticket);
      const now = await $.clock.now();
      // A status read that was refused while this one ran takes its place first.
      if (queued) readStatus($, gate, now);
      readResults($, gate, reads, now);
    }
  });
}

// ---- Cards above the prompt (MODV-15) ----------------------------------------------------------------
// Declared at the top level, because they take `$`. The logic is in card/ and view/card.ts (pure).

/** What the cards need to know about the session: the language, where it draws, what was said. */
interface CardFeed {
  readonly locale: Locale;
  /** The surface `session.start` reported; `undefined` before it. */
  surface: string | undefined;
  /** Keys whose title went to a toast already (a surface with no band, or a collapsed band). */
  readonly told: Set<string>;
}

/** The feed of a registration, by its gate: the status read finds it there. */
const cardFeeds = new WeakMap<Gate, CardFeed>();

/** True where the card has its place above the prompt; elsewhere a toast and the panel tell it. */
const hasBand = (surface: string | undefined): boolean =>
  surface === undefined || supports(surface, 'AbovePrompt');

/** Changes the cards when `change` changes them; true when it did. A failure leaves them as they were. */
async function changeCards($: Mods, change: (known: CardsState) => CardsState): Promise<boolean> {
  try {
    const known = await read($, cards);
    if (change(known) === known) return false;
    await update($, cards, change);
    return true;
  } catch {
    return false;
  }
}

/** The title of a card the user cannot see on screen, once: a toast that says how to open the panel. */
function tellCard($: Mods, feed: CardFeed, card: Card): void {
  if (feed.told.has(card.key)) return;
  feed.told.add(card.key);
  rememberKeys($, CARDS_TOLD_KEY, [card.key]).catch(() => undefined);
  $.ui.toast(
    cardTexts(feed.locale)('card.toast', { title: card.title, command: '/loadcraft-panel' }),
  );
}

/**
 * Queues cards. With `announce`, a card that joined on a surface with no band is told in a toast
 * (the end of an operation is told by its own notice already).
 */
async function addCards(
  $: Mods,
  feed: CardFeed,
  added: readonly Card[],
  announce: boolean,
): Promise<void> {
  for (const card of added) {
    const joined = await changeCards($, (known) => enqueue(known, card));
    if (joined && announce && !hasBand(feed.surface)) tellCard($, feed, card);
  }
}

/**
 * Brings the cards of the server's facts (flows on an older documentation, profile fields to
 * confirm) in step with a status that was read: a fact that is gone takes its card away.
 */
async function syncStatusCards($: Mods, feed: CardFeed, data: unknown): Promise<void> {
  try {
    const before = await read($, cards);
    const docs = docsCard(data, feed.locale);
    const profile = profileCard(data, feed.locale);
    const changed = await changeCards($, (known) =>
      syncKind(
        syncKind(known, 'docs', docs === undefined ? [] : [docs]),
        'profile',
        profile === undefined ? [] : [profile],
      ),
    );
    if (!changed || hasBand(feed.surface)) return;
    const known = new Set(before.queue.map((card) => card.key));
    for (const card of (await read($, cards)).queue) {
      if (!known.has(card.key)) tellCard($, feed, card);
    }
  } catch {
    // The cards stay as they were.
  }
}

/** Opens the panel on `tab`, without taking the keyboard; where it cannot be placed, says how to open it. */
async function showPane($: Mods, view: PaneView, locale: Locale, tab: PaneTab): Promise<void> {
  try {
    const opened = await $.ui.open({ id: PANE_ID, title: 'LoadCraft' });
    if (opened.isPlaced) {
      view.tab = tab;
      await $.ui.invalidate('ui.render');
      return;
    }
    $.ui.toast(paneTexts(locale)('pane.hint.narrow', { command: '/loadcraft-panel' }));
  } catch {
    // The panel stays as it was; the card is closed all the same.
  }
}

/**
 * Adds `keys` to what the store holds under `name`: the keys of two sessions are merged, so that one
 * session never takes back what another wrote.
 */
async function rememberKeys($: Mods, name: string, keys: readonly string[]): Promise<void> {
  const stored = await $.store.get(name).catch(() => undefined);
  await $.store.set(name, mergeKeys(stored, keys));
}

/** Closes the card with `key` for good: it leaves the queue and its key is kept, in this session and the next. */
async function closeCard($: Mods, key: string): Promise<void> {
  await changeCards($, (known) => dismiss(known, key));
  await rememberKeys($, CARDS_CLOSED_KEY, [key]).catch(() => undefined);
}

/**
 * A digit of the card `key` (the one that was drawn, not whichever is at the head by now): its action
 * runs. A question to Claude and `0` close the card; showing the panel does not, the card stays until
 * it is closed or its fact is gone. An action is a view of the panel, a question or a close, never a
 * decision of consent.
 */
async function pressCard(
  $: Mods,
  feed: CardFeed,
  view: PaneView,
  key: string,
  digit: '0' | '1' | '2',
): Promise<void> {
  try {
    const known = expire(await read($, cards), await $.clock.now());
    const action = actionOf(known, key, digit);
    if (action === undefined) return;
    if (action.effect.kind === 'pane') {
      await showPane($, view, feed.locale, action.effect.tab);
      return;
    }
    if (action.effect.kind === 'ask') {
      const message = askMessage(action.effect);
      if (message === undefined) return;
      sendChoice($, feed.locale, message);
    }
    await closeCard($, key);
  } catch {
    // The card stays; the user can press again.
  }
}

/** The keys the store remembers from earlier sessions: closed cards stay closed, told ones are not told again. */
async function loadClosedCards($: Mods, feed: CardFeed): Promise<void> {
  try {
    const closed = mergeKeys(await $.store.get(CARDS_CLOSED_KEY), []);
    await changeCards($, (known) => withClosed(known, closed));
    for (const key of mergeKeys(await $.store.get(CARDS_TOLD_KEY), [])) feed.told.add(key);
  } catch {
    // Cards closed earlier may show again; that is all.
  }
}

// ---- Side panel (MOD-09) ------------------------------------------------------------------------
// Declared at the top level, because they take `$`.

/** Changes the data of the panel when `change` changes it; a failure leaves it as it was. */
async function remember($: Mods, change: (known: PanelData) => PanelData): Promise<void> {
  try {
    const known = await read($, panel);
    if (change(known) !== known) await update($, panel, change);
  } catch {
    // The panel shows what it knew before.
  }
}

/** The stored preference "open the panel when a test starts"; on unless the user turned it off. */
async function loadAuto($: Mods): Promise<boolean> {
  try {
    return (await $.store.get(AUTO_OPEN_KEY)) !== false;
  } catch {
    return true;
  }
}

/**
 * Opens the panel for a test that started, without taking the keyboard. A terminal too narrow for
 * a pane nobody asked for leaves it waiting: the user is told once how to open it.
 */
async function openForTest($: Mods, view: PaneView, locale: Locale): Promise<void> {
  try {
    view.auto ??= await loadAuto($);
    if (!view.auto) return;
    const opened = await $.ui.open({ id: PANE_ID, title: 'LoadCraft' });
    if (!opened.isPlaced && !view.told) {
      view.told = true;
      $.ui.toast(paneTexts(locale)('pane.hint.narrow', { command: '/loadcraft-panel' }));
    }
  } catch {
    // The test goes on without the panel.
  }
}

/**
 * Opens the panel on the Path tab when new proposals came (from `flows_suggest_journeys`, or from
 * `process_wait` on its refinement), without taking the keyboard (the user may be typing). The list
 * starts anew: an old filter or preview would hide the new proposals. The tab changes only when the
 * pane is drawn; a terminal too narrow for a pane nobody asked for, or the preference off, leaves it as
 * it was and the user is told how to open it.
 */
async function openForJourneys($: Mods, view: PaneView, locale: Locale): Promise<void> {
  try {
    await remember($, (known) => withListView(known, JOURNEY_LIST, () => EMPTY_VIEW));
    view.auto ??= await loadAuto($);
    const opened = view.auto ? await $.ui.open({ id: PANE_ID, title: 'LoadCraft' }) : undefined;
    if (opened?.isPlaced === true) {
      view.tab = 'path';
      await $.ui.invalidate('ui.render');
      return;
    }
    $.ui.toast(paneTexts(locale)('pane.path.opened', { command: '/loadcraft-panel' }));
  } catch {
    // The proposals stay in the chat; the panel shows them when it is opened.
  }
}

/** How a list of the panel reaches its entries and its marks; a list without `mark` takes no marks. */
interface PanelList {
  /** The keys of its entries, in the order of the list (the index in the element keys). */
  readonly keys: (known: PanelData) => readonly string[];
  readonly mark?: (known: PanelData, keys: readonly string[]) => PanelData;
  readonly add?: (known: PanelData, keys: readonly string[]) => PanelData;
  /** No entry marked. */
  readonly clear?: (known: PanelData) => PanelData;
  /** What the list read is dropped, so that the next draw reads it again ("Try again"). */
  readonly reload?: (known: PanelData) => PanelData;
  /** Applied when a preview of the list opens or closes (the steps of the flow are read again). */
  readonly leave?: (known: PanelData) => PanelData;
}

/** The lists of the panel by id; a new list adds its entry here and its drawing in view/pane.ts. */
const PANEL_LISTS: Readonly<Record<string, PanelList>> = {
  [JOURNEY_LIST]: {
    keys: (known) => (known.project?.path?.journeys ?? []).map((item) => item.name),
    mark: withJourneyMarks,
    add: withJourneysAdded,
  },
  [FLOW_LIST]: {
    keys: (known) => listKeysOf(known, FLOW_LIST),
    mark: (known, keys) => withMarksToggled(known, FLOW_LIST, keys),
    add: (known, keys) => withMarksAdded(known, FLOW_LIST, keys),
    clear: (known) => withMarksCleared(known, FLOW_LIST),
    reload: (known) => withoutLoaded(known, 'flows'),
    leave: (known) => withListView(withoutLoaded(known, 'outline'), STEP_LIST, () => EMPTY_VIEW),
  },
  [RUN_LIST]: {
    keys: (known) => listKeysOf(known, RUN_LIST),
    mark: (known, keys) => withMarksToggled(known, RUN_LIST, keys),
    add: (known, keys) => withMarksAdded(known, RUN_LIST, keys),
    clear: (known) => withMarksCleared(known, RUN_LIST),
    reload: (known) => withoutLoaded(known, 'runs'),
  },
  [STEP_LIST]: {
    keys: (known) => (known.outline?.steps ?? []).map((step) => step.num),
    reload: (known) => withoutLoaded(known, 'outline'),
  },
};

/** A list of the self-check in the Run tab (one per scenario): it takes no marks. */
function checkListOf(id: string): PanelList | undefined {
  if (!isCheckList(id)) return undefined;
  const index = Number(id.slice(id.indexOf('-') + 1));
  return { keys: (known) => checkEntryKeys(known.selfCheck, index) };
}

/**
 * A press on a list of the panel (view/list.ts): its filter, preview, way back, groups and marks.
 * `focused` is the element under the cursor in the pane (from `ui.focus`), for `x` on the row.
 */
async function pressList(
  $: Mods,
  action: ListAction,
  focused: string | undefined,
  drawn: Readonly<Record<string, readonly string[]>>,
): Promise<void> {
  const list = PANEL_LISTS[action.list] ?? checkListOf(action.list);
  if (list === undefined) return;
  const id = action.list;
  if (action.kind === 'list.find') {
    await $.ui.focus({ requestId: PANE_ID, key: filterKey(id) }).catch(() => undefined);
    return;
  }
  if (action.kind === 'list.mark' || action.kind === 'list.markAll') {
    const change = action.kind === 'list.mark' ? list.mark : list.add;
    if (change !== undefined) await remember($, (known) => change(known, action.keys));
    return;
  }
  if (action.kind === 'list.markCurrent') {
    const mark = list.mark;
    if (mark === undefined) return;
    const known = await read($, panel);
    const key = entryOfElement(id, drawn[id] ?? list.keys(known), focused);
    if (key !== undefined) await remember($, (current) => mark(current, [key]));
    return;
  }
  if (action.kind === 'list.clear') {
    const clear = list.clear;
    if (clear !== undefined) await remember($, clear);
    return;
  }
  if (action.kind === 'list.reload') {
    const reload = list.reload;
    if (reload === undefined) return;
    await remember($, reload);
    await $.ui.invalidate('ui.render');
    return;
  }
  if (action.kind === 'list.back') {
    const known = await read($, panel);
    const open = listView(known, id).open;
    await remember($, (current) => withListView(current, id, withBack));
    if (list.leave !== undefined) await remember($, list.leave);
    const row = open === undefined ? undefined : rowKeyOf(id, list.keys(known), open);
    // The cursor goes back to the row the preview was opened from.
    if (row !== undefined) {
      await $.ui.focus({ requestId: PANE_ID, key: row }).catch(() => undefined);
    }
    return;
  }
  const change =
    action.kind === 'list.filter'
      ? (view: ListView) => withQuery(view, action.query)
      : action.kind === 'list.open'
        ? (view: ListView) => withOpen(view, action.key)
        : (view: ListView) => withGroupToggled(view, action.group);
  await remember($, (known) => withListView(known, id, change));
  if (action.kind === 'list.open' && list.leave !== undefined) await remember($, list.leave);
}

// ---- The lists the status channel feeds (MODV-20) ----------------------------------------------------
// Declared at the top level, because they take `$`. What they read and when is decided in pane/lists.ts.

const readKey = (wanted: WantedRead): string =>
  wanted.kind === 'outline' ? `outline:${wanted.flow}` : wanted.kind;

/** A list read again no sooner than this after the last read of it, whatever the state says. */
const LIST_READ_GAP_MS = 2_000;

/**
 * The read-only status call that gives the data of `wanted`: the first 20 flows, the first 20 runs,
 * or the outline of a flow. It does not start, change or spend anything. The answer comes back as the
 * server gave it: the data block is parsed by the caller, which also tells why a read failed.
 */
async function fetchList($: Mods, wanted: WantedRead): Promise<unknown> {
  switch (wanted.kind) {
    case 'flows':
      return await $.mcp.call(SERVER, 'process_get_status', {
        format: 'data',
        from_panel: true,
        detail: 'flows',
      });
    case 'runs':
      return await $.mcp.call(SERVER, 'process_get_status', {
        format: 'data',
        from_panel: true,
        detail: 'runs',
      });
    case 'outline':
      return await $.mcp.call(SERVER, 'process_get_status', {
        format: 'data',
        from_panel: true,
        result: { kind: 'flow', id: wanted.flow },
      });
  }
}

/**
 * The panel after the answer `answer` of the read `wanted` (made for `project`); a read with no usable
 * data failed, with why: `failure` when the reader knows it (`busy`, `exception`), else from the answer.
 */
function withListRead(
  known: PanelData,
  wanted: WantedRead,
  answer: unknown,
  project: PanelData['project'],
  failure?: string,
): PanelData {
  const data = failure === undefined ? parseDataBlock(answer) : undefined;
  const why = (): string => failure ?? readFailure(answer);
  if (wanted.kind === 'flows') {
    const loaded = flowsLoaded(data, project);
    return loaded === undefined
      ? withFailed(known, 'flows', undefined, why())
      : withFlows(known, loaded);
  }
  if (wanted.kind === 'runs') {
    const loaded = runsLoaded(data, project);
    return loaded === undefined
      ? withFailed(known, 'runs', undefined, why())
      : withRuns(known, loaded);
  }
  const outline = outlineLoaded(data, wanted.flow);
  return outline === undefined
    ? withFailed(known, 'outline', wanted.flow, why())
    : withOutline(known, outline);
}

/**
 * One read of a list, through the gate (state/reader.ts), so that it never runs beside a status read
 * or the poll: when the gate is busy it tries again shortly, `RESULT_RETRIES` times, then the list
 * is marked failed ("Try again"). A failure, a bad answer and an exception all end as a failed list;
 * the panel is drawn again whatever happened.
 */
async function runListRead(
  $: Mods,
  gate: Gate,
  view: PaneView,
  wanted: WantedRead,
  attempt: number,
): Promise<void> {
  const key = readKey(wanted);
  const ticket = gate.begin(await $.clock.now(), false);
  if (ticket === undefined && attempt < RESULT_RETRIES) {
    $.clock.after(RESULT_RETRY_MS, () => runListRead($, gate, view, wanted, attempt + 1));
    return;
  }
  const project = (await read($, panel)).project;
  try {
    if (ticket === undefined) {
      await remember($, (known) => withListRead(known, wanted, undefined, project, 'busy'));
      return;
    }
    const answer = await fetchList($, wanted);
    await remember($, (known) => withListRead(known, wanted, answer, project));
  } catch {
    await remember($, (known) => withListRead(known, wanted, undefined, project, 'exception'));
  } finally {
    const queued = ticket !== undefined && gate.end(ticket);
    view.reading.delete(key);
    // A read that settled the question is no reason to wait before the next one ("Try again" at once);
    // one the stored panel still asks for (a state that cannot be written) is held back by the gap.
    try {
      const after = wantedReads(await read($, panel), view.tab);
      if (!after.some((item) => readKey(item) === key)) view.readAt.delete(key);
    } catch {
      // The gap stays.
    }
    // A status read that was refused while this one ran takes its place.
    if (queued) readStatus($, gate, await $.clock.now());
    try {
      await $.ui.invalidate('ui.render');
    } catch {
      // The next draw shows what was read.
    }
  }
}

/** Starts the first of the reads the drawn tab waits for that is not running (the rest follows the draw). */
function readLists(
  $: Mods,
  gate: Gate,
  view: PaneView,
  wanted: readonly WantedRead[],
  now: number,
): void {
  const next = wanted.find((item) => {
    const key = readKey(item);
    return !view.reading.has(key) && now - (view.readAt.get(key) ?? -Infinity) >= LIST_READ_GAP_MS;
  });
  if (next === undefined) return;
  const key = readKey(next);
  view.reading.add(key);
  view.readAt.set(key, now);
  $.clock.after(0, () => runListRead($, gate, view, next, 0));
}

/** Called with every state that was written: a test that is new to the panel opens it. */
function watchTests($: Mods, state: ModState, view: PaneView, locale: Locale): void {
  const handle = state.operation?.kind === 'test_run' ? state.operation.handle : undefined;
  if (handle === undefined || handle === view.opened) return;
  view.opened = handle;
  openForTest($, view, locale).catch(() => undefined);
}

/**
 * "Stop test": the consent of the cancel call (consent/decide.ts) with the numbers of the last
 * reading, then the one `process_cancel` call the mod makes. A no, a closed dialog and an error do
 * nothing. The call is the mod's own, which Claude Code does not show to the mod's own `tool.call`
 * hooks, so the question above is the only one the user gets.
 */
async function stopTest($: Mods, gate: Gate, locale: Locale): Promise<void> {
  const { snapshot } = await read($, panel);
  const question = snapshot === undefined ? undefined : cancelQuestion(snapshot, locale);
  if (snapshot === undefined || question === undefined) return;
  let answer: string;
  try {
    answer = await $.ui.ask(question.text, {
      options: question.options,
      header: QUESTION_HEADER,
    });
  } catch {
    return;
  }
  if (settle(question, { answer }) !== 'allow') return;
  try {
    await $.mcp.call(SERVER, CANCEL_TOOL, {
      operation: snapshot.operation,
      from_panel: true,
    });
  } catch {
    // The test goes on; the poll shows what the server says.
  }
  readStatus($, gate, await $.clock.now());
}

/**
 * Hands a pick of the Path tab to the agent as a message (a turn of its own, once the session is
 * idle). The call is not awaited: it settles when the turn has run. A failure is told to the user,
 * who can say the same in the chat. Declared at the top level because it takes `$`.
 */
function sendChoice($: Mods, locale: Locale, message: string): void {
  const t = paneTexts(locale);
  try {
    $.prompt.submit({ text: message }).then(
      () => undefined,
      () => $.ui.toast(t('pane.path.sendFailed')),
    );
    $.ui.toast(t('pane.path.sent'));
  } catch {
    $.ui.toast(t('pane.path.sendFailed'));
  }
}

/** What a press in the panel does; nothing that fails reaches the user's session. */
async function pressPane(
  $: Mods,
  gate: Gate,
  view: PaneView,
  locale: Locale,
  action: PaneAction,
): Promise<void> {
  try {
    if (action.kind === 'cancel') {
      await stopTest($, gate, locale);
      return;
    }
    if (action.kind === 'card.close') {
      await closeCard($, action.key);
      return;
    }
    if (action.kind === 'method') {
      await remember($, (known) => withMethod(known, action.method));
      sendChoice($, locale, methodMessage(action.method));
      return;
    }
    if (isListAction(action)) {
      await pressList($, action, view.focused, view.drawn);
      return;
    }
    if (action.kind === 'none') {
      await remember($, withNoJourneys);
      return;
    }
    if (action.kind === 'build') {
      const names = markedJourneys(await read($, panel));
      if (names.length === 0) return;
      sendChoice($, locale, journeysMessage(names));
      await remember($, withJourneysSent);
      return;
    }
    if (action.kind === 'check.ask') {
      // The run and the number come from the drawn button; nothing else of the step goes into the text.
      if (!isStepQuestion(action.run, action.step)) return;
      sendChoice($, locale, stepMessage(action.run, action.step));
      return;
    }
    if (action.kind === 'send' && action.topic === 'scenario') {
      const names = markedFlows(await read($, panel));
      if (names.length === 0) return;
      sendChoice($, locale, scenarioMessage(names));
      await remember($, (known) => withMarksCleared(known, FLOW_LIST));
      return;
    }
    if (action.kind === 'send' && action.topic === 'migrate') {
      const names = markedOldDocs(await read($, panel));
      if (names.length === 0) return;
      sendChoice($, locale, migrationMessage(names));
      await remember($, (known) => withMarksCleared(known, FLOW_LIST));
      return;
    }
    if (action.kind === 'send') {
      const pair = comparePair(await read($, panel));
      if (pair === undefined) return;
      sendChoice($, locale, compareMessage(pair.older, pair.newer));
      await remember($, (known) => withMarksCleared(known, RUN_LIST));
      return;
    }
    if (action.kind === 'tab') view.tab = action.tab;
    else {
      view.auto = !(view.auto ?? true);
      await $.store.set(AUTO_OPEN_KEY, view.auto).catch(() => undefined);
    }
    await $.ui.invalidate('ui.render');
  } catch {
    // The panel stays as it was.
  }
}

export function register(on: On, options?: Readonly<Record<string, unknown>>): void {
  // Per registration, not per module: a load (and a test) starts from nothing.
  // For the step band and the poll. Only `locale` is read from the options: the rest holds the API token.
  const locale = toLocale(options?.['locale']);
  const status: StatusMemory = { shown: undefined };

  /** Every background read of the server goes through this gate: one at a time. */
  const gate = createGate();
  const reads: ResultReads = {
    entries: new Map(),
    jobs: [],
    retrying: false,
    attempts: 0,
  };

  // Status line of the operation in progress and notices of its end: what to read, draw and say is
  // decided by the poller (poll.ts, pure); the timer in the session.start hook below does it.
  const poller = createPoller(locale);
  const pane: PaneView = {
    tab: 'run',
    auto: undefined,
    told: false,
    opened: undefined,
    drawn: {},
    reading: new Set(),
    readAt: new Map(),
  };
  /** `session.start` fires once per load; a second one in the same load starts nothing again. */
  let started = false;
  /** The LoadCraft calls of the model that have not returned: `tool_use_id` → short tool name. */
  const openCalls = new Map<string, string>();
  const feed: CardFeed = { locale, surface: undefined, told: new Set() };
  cardFeeds.set(gate, feed);
  const barsRead: BarsRead = { running: false, tick: 0, feed };

  on('session.start', async ($, e, next) => {
    if (started) return next(e);
    started = true;
    feed.surface = e.surface ?? undefined;
    await loadClosedCards($, feed);
    // VS Code has no band: the step goes to the status line, after every state that was written.
    if (e.surface === 'vscode') gate.onStateChange((state) => showStatus($, state, locale, status));
    // ---- status line poll ----
    // Starts with the session and stays; a tick with no operation in the state does nothing. It
    // runs in the background: it holds no hook and never touches the result of a tool.
    $.clock.every(POLL_MS, async () => {
      try {
        const state = await read($, session);
        const now = await $.clock.now();
        await changeCards($, (known) => expire(known, now));
        const plan = poller.tick(state.operation?.handle, gate.busy(now));
        const { call: open } = await read($, progress);
        // A `run_start` call that holds knows no operation yet (its handle comes with its result),
        // but the server lists the test from its start: the status read, through the gate, finds it.
        if (state.operation === undefined && open !== undefined && !gate.busy(now)) {
          readStatus($, gate, now);
        }
        const notices: Notice[] = plan.notice === undefined ? [] : [plan.notice];
        let line = plan.line;
        const handle = plan.read;
        const ticket = handle === undefined ? undefined : gate.begin(now, false);
        if (handle !== undefined && ticket !== undefined) {
          try {
            let data: unknown;
            try {
              data = parseDataBlock(
                await $.mcp.call(SERVER, 'process_get_status', {
                  format: 'data',
                  from_panel: true,
                  operation: handle,
                }),
              );
            } catch {
              data = undefined;
            }
            const outcome = poller.settle(handle, data, gate.calls());
            // A self-check no call follows: its snapshot carries the view read now (best effort).
            const live = parseSelfCheck(data);
            if (live !== undefined) await storeCheck($, feed, live);
            // The end of the operation is a card too: it stays until closed, a notice does not.
            const ended =
              outcome.snapshot !== undefined && isTerminal(outcome.snapshot)
                ? cardOfSnapshot(outcome.snapshot, locale, await $.clock.now())
                : undefined;
            if (ended !== undefined) await addCards($, feed, [ended], false);
            if (outcome.notice !== undefined) notices.push(outcome.notice);
            if (outcome.line !== undefined) line = outcome.line;
            const at = await $.clock.now();
            // Only the operation the read was about, and only while this read still counts: a
            // newer operation or read is not touched by an older answer.
            if (gate.isCurrent(ticket)) {
              const seen = outcome.snapshot;
              let applied = false;
              if (outcome.lost !== undefined || outcome.snapshot !== undefined) {
                await remember($, (known) =>
                  withSnapshot(known, outcome.lost === undefined ? outcome.snapshot : undefined),
                );
              }
              await write($, gate, (known) => {
                if (outcome.lost !== undefined) {
                  applied = true;
                  return reduce(known, { kind: 'lost', handle: outcome.lost }, at);
                }
                // Only the operation the read was about: an older answer does not bring back an
                // operation that is over, nor replace a newer one.
                if (seen === undefined || known.operation?.handle !== handle) {
                  return known;
                }
                applied = true;
                const facts = { kind: 'operation', data: seen } as const;
                // The snapshot first, then the calls that came after the read began, on top of it:
                // the same rule as for the status read (see `readStatus`).
                return ticket.signals.reduce(
                  (next, { signal, at: calledAt }) => reduce(next, signal, calledAt),
                  reduce(known, facts, at),
                );
              });
              // The live line of a running `run_start` takes the snapshot too (a series of its numbers).
              if (applied) {
                await noteProgress(
                  $,
                  outcome.lost !== undefined || seen === undefined
                    ? { kind: 'end' }
                    : { kind: 'snapshot', snapshot: seen },
                );
              }
            }
          } finally {
            if (gate.end(ticket)) readStatus($, gate, await $.clock.now());
          }
        }
        if (line !== undefined) $.ui.status(line === null ? undefined : line);
        for (const told of notices) {
          const sent = await $.ui.notify(told.text).catch(() => undefined);
          // No channel that shows the text (none, or a bell): the toast says it.
          if (!sent?.isSent || sent.channel === 'terminal_bell') {
            $.ui.toast(told.text);
          }
        }
      } catch {
        // Nothing to show this time; the next tick tries again.
      }
    });
    // ---- end of the status line poll ----
    // ---- bars of the operations in progress ----
    // Once a second while anything is on screen or a call waits: every other tick reads the list
    // (the state file of the plugin, no backend), every tick draws the clock and the moving block
    // again and lets finished bars run out. A tick with nothing to show does nothing.
    $.clock.every(1000, async () => {
      try {
        const known = await read($, bars);
        const active =
          openCalls.size > 0 || hasBars(known) || (await read($, session)).operation !== undefined;
        if (!active) return;
        barsRead.tick += 1;
        if (barsRead.tick % 2 === 0) {
          await refreshBars($, barsRead);
        } else {
          await storeBars($, undefined, {}, barsRead.feed);
        }
        if (hasBars(await read($, bars))) await $.ui.invalidate('ui.render');
      } catch {
        // Nothing to draw this time; the next tick tries again.
      }
    });
    // ---- end of the bars ----
    // ---- side panel (MOD-09): the command and the opening for a test ----
    gate.onStateChange((state) => watchTests($, state, pane, locale));
    try {
      await $.command.register({
        name: 'loadcraft-panel',
        description: paneTexts(locale)('pane.command.description'),
        // The panel is for watching a test: it opens while the model waits for one too.
        immediate: true,
      });
    } catch {
      // A name that is taken does not spoil the rest of the hook.
    }
    // ---- end of the side panel ----
    return next(e);
  });

  // ---- Consent before a tool with an effect outside the editor ----------------------------------
  // Registered before the state hook, so it runs first: a refused call never reaches the tool, nor
  // the state. The hook reads the facts through the channel meant for the mod, asks the user when
  // the facts call for it, and then either refuses the call (`{ deny }`, which the model reads as
  // the result) or passes it on as it came. It changes no argument and approves nothing for Claude
  // Code, whose own permission check still runs inside `next`. Whenever the facts are missing, or
  // nobody can answer, or the hook itself fails before `next` (`.catch`), the call goes on and the
  // server's own guard (clamping, `confirm_capped`, `confirm_protected`) holds.
  on(
    'tool.call',
    {
      tool: [
        'mcp__plugin_loadcraft_lc__run_start',
        'mcp__plugin_loadcraft_lc__data_create_accounts',
        'mcp__plugin_loadcraft_lc__flows_describe_journeys',
        'mcp__plugin_loadcraft_lc__process_cancel',
      ],
    },
    async ($, e, next) => {
      // `process_cancel` also takes `from_panel` (the Stop button); a call of the model never may
      if (shortToolName(e.tool) === 'process_cancel' && e['from_panel'] !== undefined) {
        return { deny: FROM_PANEL_DENIAL };
      }
      const plan = consentPlan(shortToolName(e.tool), e);
      if (plan === undefined) return next(e);
      let data: unknown;
      if (plan.read !== undefined) {
        try {
          data = parseDataBlock(
            await $.mcp.call(SERVER, 'process_get_status', { ...plan.read, from_panel: true }),
          );
        } catch {
          data = undefined;
        }
      }
      const facts = readFacts(plan, data);
      if (facts === undefined) return next(e);
      const now = await $.clock.now();
      const decision = decide(facts, await read($, consent), now, locale);
      if ('pass' in decision) {
        const used = decision.consume;
        if (used !== undefined) {
          await update($, consent, (l) => consume(l, used.tool, used.key, now));
        }
        return next(e);
      }
      const question = decision.ask;
      let outcome: Outcome;
      try {
        const answer = await $.ui.ask(question.text, {
          options: question.options,
          header: QUESTION_HEADER,
        });
        outcome = { answer };
      } catch {
        // Closed, "Chat about this", or nobody to ask at all. When even who could answer cannot be
        // read, the user may have closed the question: that is a no, never a pass.
        let surfaces: number;
        try {
          surfaces = (await $.session.surfaces()).length;
        } catch {
          surfaces = 1;
        }
        outcome = { dismissed: true, surfaces };
      }
      const verdict = settle(question, outcome);
      if (verdict === 'deny') return { deny: question.denial };
      if (verdict === 'allow' && question.remember) {
        const at = await $.clock.now();
        await update($, consent, (l) => grant(l, question.tool, question.key, at));
      }
      return next(e);
    },
  ).catch(($, e, next) => next(e));
  // ---- End of consent ---------------------------------------------------------------------------

  // `from_panel` marks a call as the panel's: the server writes no entry for such a read and signs
  // such a write 'panel'. Only the mod sets it, through `$.mcp.call`, which these hooks never see; a
  // call of the model that carries it is refused (here for `process_get_status`, in the consent hook for `process_cancel`).
  on(
    'tool.call',
    {
      tool: ['mcp__plugin_loadcraft_lc__process_get_status'],
    },
    async ($, e, next) => {
      if (e['from_panel'] !== undefined) return { deny: FROM_PANEL_DENIAL };
      return next(e);
    },
  ).catch(($, e, next) => next(e));

  // A call of a LoadCraft tool says that something may have changed. The hook notes which tool it
  // was and returns at once. The facts come from the server through the channel meant for the mod
  // (the model never reads that answer), read in the background: a slow server never holds the
  // result back, and at most one read runs at a time. A call that arrives meanwhile is
  // kept, and put on top of the answer of that read when it comes (so the answer cannot undo what
  // the call said), and exactly one more read follows. Whatever goes wrong here, the model gets the result
  // it would have had.
  on('tool.call', { tool: /^mcp__plugin_loadcraft_lc__/ }, async ($, e, next) => {
    // `run_start` holds until the test ends or its wait runs out, so its call is noted before it
    // goes on: the live row under it (ToolProgress, below) is drawn for that call and no other.
    const own = isFromThisMod(next.origin);
    const running = own ? undefined : runStartCall(e.tool, e.tool_use_id);
    if (running !== undefined) await noteProgress($, { kind: 'open', call: running });
    // The bar under the call row is found by the id of the call (see the ToolProgress hook).
    const waiting = !own && typeof e.tool_use_id === 'string' ? e.tool_use_id : undefined;
    const toolName = shortToolName(e.tool);
    if (waiting !== undefined && toolName !== undefined) openCalls.set(waiting, toolName);
    let result: unknown;
    try {
      result = await next(e);
    } finally {
      if (running !== undefined) await noteProgress($, { kind: 'close', call: running });
      if (waiting !== undefined) {
        openCalls.delete(waiting);
        // The call is over: a bar on screen is read again, so that a finished one is told at once.
        try {
          if (hasBars(await read($, bars))) $.clock.after(0, () => refreshBars($, barsRead));
        } catch {
          // The timer reads them in a moment.
        }
      }
    }
    // A call raised by this mod's own `$` (a consent hook reading the status) is not the model's.
    if (isFromThisMod(next.origin)) return result;
    try {
      const signal = toolSignal(e.tool, result);
      if (signal === undefined) return result;
      const now = await $.clock.now();
      // A read in flight will answer with a picture older than this call: it replays the call.
      gate.note(signal, now);
      // The result that starts a test names its live preview: the panel links to it.
      const preview =
        signal.kind === 'tool' && signal.tool === 'run_start' && signal.handle !== undefined
          ? runLink(resultText(result))
          : undefined;
      if (signal.kind === 'tool' && signal.handle !== undefined && preview !== undefined) {
        const started = signal.handle;
        await remember($, (known) => withPreview(known, started, preview));
      }
      // Proposals that may have come (never after a refusal): the next read of the status tells, and
      // new ones open the list in the panel.
      if (
        signal.kind === 'tool' &&
        signal.errorCode === undefined &&
        (signal.tool === 'flows_suggest_journeys' || signal.tool === 'process_wait')
      ) {
        const expect = journeyNames(await read($, panel));
        journeyWatches.set(gate, {
          expect,
          open: () => {
            openForJourneys($, pane, locale).catch(() => undefined);
          },
        });
      }
      // `reduce` hands back the same object when the call changes nothing: then nothing is written.
      const current = await read($, session);
      await write($, gate, (state) => reduce(state, signal, now));
      // The answer of a status call the model made is not read again while the state is fresh
      // (after /clear or /resume it is not, and the read refills it) and no read is running.
      if (signal.kind === 'tool' && signal.tool === 'process_get_status' && !current.isStale) {
        if (!gate.busy(now)) return result;
      }
      readStatus($, gate, now);
    } catch {
      // The state stays as it was; see above.
    }
    return result;
  }).catch(($, e, next) => next(e));

  // --- The step band above the prompt (logic in view/band.ts) ---
  // The band is one row above the prompt, drawn from the session state. Where nothing is known, on
  // a surface without a band, or while a survey holds the band, the hook passes the event on.
  // What the hooks below drew goes into our Box (see `bandRow`).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    let tree: ReturnType<typeof bandTree>;
    let lines: Tree[] = [];
    let card: unknown;
    try {
      const drawn = supports(e.surface, 'AbovePrompt') && !e.props.hasSurvey;
      tree = drawn ? bandTree(await read($, session), locale, e.props.bodyColumns) : undefined;
      // The bars of the operations in progress: one line each, under the step row.
      if (drawn) {
        const shown = await read($, bars);
        const now = await $.clock.now();
        lines = barsBand(shown, { locale, now, width: e.props.bodyColumns }).map(plainOf);
        // One card at a time, the head of the queue. A collapsed band hides it: then the panel
        // lists it and its title goes to a toast, once.
        const queue = expire(await read($, cards), now);
        const top = head(queue);
        if (top !== undefined && e.props.isCollapsed) tellCard($, feed, top);
        else if (top !== undefined) {
          card = cardElements(
            $.ui.resolve(e),
            cardTree(top, {
              locale,
              width: e.props.bodyColumns,
              surface: e.surface,
              waiting: waiting(queue),
            }),
            (digit) => pressCard($, feed, pane, top.key, digit),
          );
        }
      }
    } catch {
      tree = undefined;
      lines = [];
      card = undefined;
    }
    const beneath = await next(e);
    return tree === undefined && lines.length === 0 && card === undefined
      ? beneath
      : bandRow(tree, beneath, lines, card);
  });

  // ---- Result drawing (MOD-07) ------------------------------------------------------------------
  // Only what the user sees changes; the result the model reads is not touched (no `tool.call` hook
  // here). A LoadCraft tool call is drawn as `LoadCraft · <tool>` instead of the long name with the
  // plugin prefix; the full view (ctrl+o) keeps Claude Code's own row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    try {
      const row = toolRow(e.props.tool, {
        surface: e.surface,
        isRunning: e.props.isRunning,
        isErrored: e.props.isErrored,
        isExpanded: e.props.isExpanded === true,
      });
      if (row === undefined) return next(e);
      return toElements($.ui.resolve(e), row);
    } catch {
      return next(e);
    }
  });

  // The block under a tool row: a report, a diagnosis or a flow is drawn from the data the server
  // gives for it, read once in the background after the first drawing, through the gate; the first
  // drawing, a result the server has no data for, an error, the full view and any failure are
  // Claude Code's own block.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    try {
      const named = resultKindOfTool(e.props.tool);
      if (
        named === undefined ||
        e.props.isErrored ||
        e.props.isExpanded === true ||
        !supports(e.surface, 'ToolResult')
      ) {
        return next(e);
      }
      const key = e.props.tool_use_id;
      const entry = reads.entries.get(key);
      // A block drawn outside the viewport is read when it scrolls into view (it is drawn again).
      if (entry === undefined && e.props.onScreen === null) return next(e);
      if (entry === undefined) {
        const selector = resultSelector(named.kind, outputText(e.props.output));
        reads.entries.set(key, {
          state: selector === undefined ? 'none' : 'pending',
        });
        if (reads.entries.size > MAX_RESULTS) {
          for (const old of reads.entries.keys()) {
            reads.entries.delete(old);
            break;
          }
        }
        if (selector !== undefined) {
          const href = runLink(outputText(e.props.output));
          if (reads.jobs.length >= MAX_PENDING_READS) {
            const dropped = reads.jobs.shift();
            if (dropped !== undefined) reads.entries.set(dropped.key, { state: 'none' });
          }
          reads.jobs.push({
            key,
            selector,
            ...(href === undefined ? {} : { href }),
          });
          readResults($, gate, reads, await $.clock.now());
        }
        return next(e);
      }
      if (entry.state !== 'ready') return next(e);
      const width = Math.min(200, Math.max(40, e.viewport?.columns ?? DEFAULT_WIDTH));
      const tree = drawResult(named.tool, entry.data, {
        locale,
        width,
        surface: e.surface,
      });
      if (tree === undefined) return next(e);
      return toElements($.ui.resolve(e), tree);
    } catch {
      return next(e);
    }
  });

  // ---- Live line of a running test (MOD-08) -----------------------------------------------------
  // Under a `run_start` call that holds, the progress row is drawn from the progress the state keeps
  // (series.ts): the time of the test, the numbers of the run and a small chart of the requests per
  // second. The poll writes it; reading it here draws the row again after each write.
  // Any other row, another surface, a call the mod did not note, no snapshot yet and any failure are
  // Claude Code's own row.
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    try {
      if (!supports(e.surface, 'ToolProgress') || e.props.kind !== 'background_hint') {
        return next(e);
      }
      const shown = await read($, progress);
      const width = Math.min(200, Math.max(40, e.viewport?.columns ?? DEFAULT_WIDTH));
      const line =
        shown.call === e.props.tool_use_id
          ? progressTree(shown.snapshot, shown.samples, locale, width)
          : undefined;
      if (line !== undefined) return toElements($.ui.resolve(e), progressRow(line, e.props.hint));
      // Any other LoadCraft call that waits: the bar of its operation, when the server told one.
      const tool = openCalls.get(e.props.tool_use_id);
      if (tool === undefined) return next(e);
      const waiting = (await read($, bars)).rows.find((row) => row.open && row.tool === tool);
      if (waiting === undefined) return next(e);
      const now = await $.clock.now();
      return toElements(
        $.ui.resolve(e),
        progressRow(barLine(waiting, { locale, now, width }, { stage: true }), e.props.hint),
      );
    } catch {
      return next(e);
    }
  });

  // ---- Side panel (MOD-09) ----------------------------------------------------------------------
  // `/loadcraft-panel` opens the pane; the pane is drawn from the session state and what the panel
  // keeps (pane/tabs.ts), so it asks the server for nothing. A test that starts opens it too (the
  // listener in the `session.start` hook). The one button with an effect, "Stop test", asks the
  // user first (`stopTest`).
  on('command.run', { command: 'loadcraft-panel' }, async ($) => {
    try {
      await $.ui.open({
        id: PANE_ID,
        title: 'LoadCraft',
        focus: true,
        closeOnEscape: true,
      });
    } catch {
      // Another plugin holds the id, or nothing can draw: the command does nothing.
    }
    return {};
  });

  // Where the cursor of the pane is: `x` marks the row under it. Only noted, never moved.
  // The id is written out (it is PANE_ID) so that `claude plugin validate` names the pane it hooks.
  on('ui.focus', { requestId: 'loadcraft' }, async ($, e, next) => {
    try {
      if (e.element === undefined) delete pane.focused;
      else pane.focused = e.element;
    } catch {
      // Without the cursor, `x` marks nothing; the arrows and Enter still work.
    }
    return next(e);
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    try {
      if (e.requestId !== PANE_ID || !supports(e.surface, 'Pane')) return next(e);
      pane.auto ??= await loadAuto($);
      const live = await read($, progress);
      const known = await read($, panel);
      pane.drawn = drawnKeys(known);
      readLists($, gate, pane, wantedReads(known, pane.tab), await $.clock.now());
      const tree = paneTree(await read($, session), known, pane.tab, {
        locale,
        // The series the live line of the test draws too; it is the same one (series.ts).
        samples: live.snapshot?.operation === known.snapshot?.operation ? live.samples : [],
        surface: e.surface,
        width: e.props.bodyColumns,
        autoOpen: pane.auto,
        bars: await read($, bars),
        now: await $.clock.now(),
        cards: expire(await read($, cards), await $.clock.now()).queue,
      });
      return paneElements($.ui.resolve(e), tree, (action) =>
        pressPane($, gate, pane, locale, action),
      );
    } catch {
      return next(e);
    }
  });
}
