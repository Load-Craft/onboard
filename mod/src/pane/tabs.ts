/**
 * What the side panel knows and how it learns it: pure functions of the stored panel data, with
 * no `$`, no clock and no exception. The panel reads only this and the session state, so its
 * Project and Results tabs ask the server for nothing; `register.ts` feeds it from the answers of
 * reads that run anyway (the poll of the operation, the status read after a tool call, the data
 * of a report block).
 *
 * Everything that came from the server is bounded and passed through `inline`, and a link is kept
 * only when it is an `https` address the drawing can hand to `Link`.
 */

import { MAX_SUGGESTIONS } from '../../../mcp/src/tools/flows/limits.js';
import { EMPTY_VIEW, addedMarks, toggledMarks, type ListView } from '../view/list.js';
import { inline } from '../../../mcp/src/render/primitives.js';
import { isTerminal, type OperationSnapshot } from '../view/status.js';
import { finite, isDict, list, str, type Dict } from '../view/tree.js';
import type { SelfCheckFacts } from './selfCheck.js';

/** The id of the pane, as `$.ui.open` and the `ui.render` hook know it. */
export const PANE_ID = 'loadcraft';
/** The slash command that opens the pane. */
export const PANE_COMMAND = 'loadcraft-panel';
/** The preference "open the pane when a test starts", in `$.store`. */
export const AUTO_OPEN_KEY = 'paneAutoOpen';

export const TABS = ['run', 'project', 'results', 'path'] as const;
export type PaneTab = (typeof TABS)[number];

/** The ways to build flows (step 3), as the Path tab offers them and the skill names them. */
export const FLOW_METHODS = ['docs', 'describe', 'har', 'manual'] as const;
export type FlowMethod = (typeof FLOW_METHODS)[number];

const MAX_ENVIRONMENTS = 8;
const MAX_RUNS = 3;
const MAX_THRESHOLDS = 12;
/** Journeys the Path tab lists: as many as `process_get_status` gives (the list has a filter). */
export const MAX_JOURNEYS = 200;
/** Profile field names the Project tab lists at most. */
export const MAX_UNCERTAIN = 20;
/** Names of flows on an older docs version the panel keeps (the status lists 20). */
const MAX_OLD_DOCS = 20;
const JOURNEY_NAME_LIMIT = 200;
const MAX_STEPS = 12;
const STEP_LIMIT = 80;
const NAME_LIMIT = 80;
/** `Link` takes at most 2 048 characters. */
export const MAX_HREF = 2048;

export type Json =
  string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

export interface EnvironmentFact {
  readonly name: string;
  readonly isDefault: boolean;
  readonly protected: boolean;
  readonly active: boolean;
  readonly maxVu?: number;
  readonly maxRps?: number;
}

export interface RunFact {
  /** `e-` and 8 characters: what `results_get_report` takes. */
  readonly handle: string;
  readonly target: string;
  readonly verdict?: string;
}

/** One journey `flows_suggest_journeys` proposed: its name exactly as the tool gave it, and its pattern. */
export interface JourneyFact {
  readonly name: string;
  readonly pattern: string;
  /** What each step does, as `flows_suggest_journeys` showed it; empty when it did not save them. */
  readonly steps: readonly string[];
  /** A flow with this name exists already (the journey is marked "Flow created"). */
  readonly built: boolean;
}

/** What flows can be built from in the project, and the journeys already proposed. */
export interface PathFacts {
  /** An API documentation (OpenAPI or AsyncAPI) is in the project. */
  readonly docs: boolean;
  /** A HAR recording is in the project. */
  readonly recording: boolean;
  /** An environment has a frontend address, which the LoadCraft browser opens. */
  readonly frontend: boolean;
  readonly journeys: readonly JourneyFact[];
}

/** What the user picked in the Path tab and has not yet seen built. */
export interface PathChoice {
  /** The method sent to the agent last. */
  readonly method?: FlowMethod;
  /** Journeys marked, by name, in the order they were marked. */
  readonly journeys: readonly string[];
}

/** The project as the last `process_get_status` listed it. */
export interface ProjectFacts {
  readonly path?: PathFacts;
  readonly setupComplete?: boolean;
  readonly environments: readonly EnvironmentFact[];
  readonly counts: {
    readonly flows: number;
    readonly scenarios: number;
    readonly compositions: number;
  };
  readonly runs: readonly RunFact[];
  /** Names of the profile fields the analysis was unsure of (never their values). */
  readonly uncertainFields?: readonly string[];
  /** Time of the status reading (ISO): a list read for an older reading is read again. */
  readonly asOf?: string;
  /** Names of the flows on an older docs version (the first ones the status lists); absent when none. */
  readonly oldDocs?: readonly string[];
}

/** One flow of the project as `process_get_status` (`detail: flows`) lists it; its name is its key. */
export interface FlowFact {
  readonly name: string;
  readonly steps: number;
  /** The flow is on an older docs version than the project's current one. */
  readonly oldDocs: boolean;
  /** The name had to be cut or flattened to be drawn: it is not the name the server knows. */
  readonly odd?: true;
}

/** One test run as `process_get_status` (`detail: runs`) lists it; its handle is its key. */
export interface RunRow {
  /** `e-` and 8 characters: what `results_get_report` takes. */
  readonly handle: string;
  readonly target: string;
  readonly verdict?: string;
  /** ISO time of the start. */
  readonly when?: string;
}

/**
 * A list read from the status channel. `stamp` says which state of the project it was read for: a
 * list whose stamp is not the project's is read again (and drawn meanwhile as it is). `failed`: the read
 * did not work, and is not repeated for the same stamp.
 */
export interface Loaded<T> {
  readonly stamp: string;
  readonly failed?: true;
  /** Why the read failed (`readFailure` in pane/lists.ts): a kind, or `code:<code>` of an error answer. */
  readonly why?: string;
  readonly items: readonly T[];
  /** Entries the status did not list (it lists the first 20). */
  readonly more: number;
}

/** One step of a flow as the outline of `flows_get` gives it, bounded. */
export interface StepFact {
  /** Outline number as the screen shows it: `3`, `4.2`. */
  readonly num: string;
  readonly kind: 'request' | 'pause' | 'other';
  readonly name: string;
  readonly method?: string;
  /** The path with its query, every reference written `#{x}`. */
  readonly path?: string;
  readonly description?: string;
  readonly uses: readonly string[];
  readonly produces: readonly string[];
  /** Variables no earlier step produced: values of the test data. */
  readonly feeder: readonly string[];
  readonly statuses: readonly number[];
  readonly validators: readonly string[];
}

/** The steps of the flow open in the preview of the flows list. */
export interface OutlineFacts {
  readonly flow: string;
  readonly failed?: true;
  /** Why the read failed, as `Loaded.why`. */
  readonly why?: string;
  readonly steps: readonly StepFact[];
  /** Every step the flow has, listed or not. */
  readonly total: number;
  readonly truncated: boolean;
}

/** The data of the newest report block the model read, cut to what the summary draws. */
export interface ReportFacts {
  readonly href?: string;
  readonly data: { readonly [key: string]: Json };
}

/** A test that failed: its handle and the reason the server gave, when it gave one. */
export interface TestFailure {
  readonly operation: string;
  readonly reason?: string;
}

/** What the panel keeps in `$.state` beside the session state (`panel`, see mod/types/index.d.ts). */
export interface PanelData {
  /** The last reading of the operation in progress. */
  readonly snapshot?: OperationSnapshot;
  /** The live preview of a test, from the result that started it. */
  readonly preview?: { readonly handle: string; readonly href: string };
  readonly project?: ProjectFacts;
  /** The last test that failed, until another test starts: what the Run tab says about it. */
  readonly failure?: TestFailure;
  readonly report?: ReportFacts;
  /** The pick of the Path tab; the agent got it as a message when it was made. */
  readonly choice?: PathChoice;
  /** The view of each list of the panel (view/list.ts), by the id of the list: filter, preview, open groups. */
  readonly lists?: { readonly [list: string]: ListView };
  /** The flows of the project, the test runs and the steps of the flow open (pane/lists.ts). */
  readonly flows?: Loaded<FlowFact>;
  readonly runs?: Loaded<RunRow>;
  readonly outline?: OutlineFacts;
  /** The keys marked in each list that keeps its marks here (the journeys keep theirs in `choice`). */
  readonly marks?: { readonly [list: string]: readonly string[] };
  /** The newest self-check view the server wrote (pane/selfCheck.ts), kept until a newer one comes. */
  readonly selfCheck?: SelfCheckFacts;
  /** The last read of the view failed; the view drawn is the one before. */
  readonly selfCheckFailed?: true;
}

export const EMPTY_PANEL: PanelData = {};

const HOST = '[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?';
const SAFE_HREF = new RegExp(`^https://${HOST}(?::(?!443(?:/|$))\\d{1,5})?(?:/[^\\s@]*)?$`);

/**
 * The address as `Link` can draw it everywhere: `https`, a lower-case host, no `:443`, no space
 * and no `@`, at most 2 048 characters. Anything else is no link.
 */
export function safeHref(href: unknown): string | undefined {
  return typeof href === 'string' && href.length <= MAX_HREF && SAFE_HREF.test(href)
    ? href
    : undefined;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RUN_LINK = new RegExp(
  `^https://[^\\s/]+/projects/${UUID}/gatling/executions/${UUID}(?:/live)?(?:[?#]\\S*)?$`,
);

/**
 * The link of a run in a tool's text: the one line that starts with `↗ ` and names an execution of
 * a project (the server puts it under a report and under the start of a test). No such line, or
 * more than one, gives nothing: a customer's text can never add a link line of its own.
 */
export function runLink(text: string): string | undefined {
  const lines = text.split('\n').filter((line) => line.startsWith('↗ '));
  const [only, ...others] = lines;
  if (only === undefined || others.length > 0) return undefined;
  const href = only.slice(2).trim();
  return RUN_LINK.test(href) ? safeHref(href) : undefined;
}

const count = (value: unknown): number => {
  const n = finite(value);
  return n === undefined ? 0 : Math.max(0, Math.round(n));
};

function environmentOf(item: unknown): EnvironmentFact | undefined {
  if (!isDict(item)) return undefined;
  const name = str(item['name']);
  if (name === undefined || inline(name) === '') return undefined;
  const caps = isDict(item['caps']) ? item['caps'] : {};
  const maxVu = finite(caps['maxVu']);
  const maxRps = finite(caps['maxRps']);
  return {
    name: inline(name, NAME_LIMIT),
    isDefault: item['isDefault'] === true,
    protected: item['protected'] === true,
    active: item['active'] === true,
    ...(maxVu === undefined ? {} : { maxVu }),
    ...(maxRps === undefined ? {} : { maxRps }),
  };
}

function runOf(item: unknown): RunFact | undefined {
  if (!isDict(item)) return undefined;
  const handle = str(item['handle']);
  if (handle === undefined || inline(handle) === '') return undefined;
  const verdict = isDict(item['verdict']) ? str(item['verdict']['state']) : str(item['verdict']);
  return {
    handle: inline(handle, NAME_LIMIT),
    target: inline(str(item['target']) ?? '', NAME_LIMIT),
    ...(verdict === undefined ? {} : { verdict: inline(verdict, NAME_LIMIT) }),
  };
}

/**
 * A journey the tab can offer: a name that reads the same after `inline` (one line, bounded). The
 * agent passes the name to `flows_generate_from_suggestions` exactly, so a name the view would change is not offered.
 */
function journeyOf(item: unknown): JourneyFact | undefined {
  if (!isDict(item)) return undefined;
  const name = str(item['name']);
  if (name === undefined || name === '' || inline(name, JOURNEY_NAME_LIMIT) !== name) {
    return undefined;
  }
  return {
    name,
    pattern: inline(str(item['pattern']) ?? '', NAME_LIMIT),
    steps: list(item['steps'])
      .flatMap((step) => {
        const label = str(step);
        return label === undefined || inline(label) === '' ? [] : [inline(label, STEP_LIMIT)];
      })
      .slice(0, MAX_STEPS),
    built: item['built'] === true,
  };
}

/** The Path facts of `process_get_status` data; `undefined` when the data has none (an older server). */
export function pathFacts(data: unknown): PathFacts | undefined {
  if (!isDict(data) || !isDict(data['path'])) return undefined;
  const path = data['path'];
  const seen = new Set<string>();
  const journeys = list(path['journeys'])
    .map(journeyOf)
    .filter((item): item is JourneyFact => {
      if (item === undefined || seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    })
    .slice(0, MAX_JOURNEYS);
  return {
    docs: path['docs'] === true,
    recording: path['recording'] === true,
    frontend: path['frontend'] === true,
    journeys,
  };
}

/** The facts of the Project tab from the data block of `process_get_status`; `undefined` for any other data. */
export function projectFacts(data: unknown): ProjectFacts | undefined {
  if (!isDict(data) || !Array.isArray(data['environments']) || !isDict(data['counts'])) {
    return undefined;
  }
  const counts = data['counts'];
  const setup = isDict(data['setup']) ? data['setup']['complete'] : undefined;
  const path = pathFacts(data);
  const uncertain = list(data['uncertainFields'])
    .filter((item): item is string => typeof item === 'string' && inline(item) !== '')
    .map((item) => inline(item, 40))
    .slice(0, MAX_UNCERTAIN);
  const old = isDict(data['oldDocs'])
    ? list(data['oldDocs']['flows'])
        .flatMap((item) => (typeof item === 'string' && item !== '' ? [inline(item, 200)] : []))
        .slice(0, MAX_OLD_DOCS)
    : [];
  return {
    ...(path === undefined ? {} : { path }),
    ...(typeof setup === 'boolean' ? { setupComplete: setup } : {}),
    environments: data['environments']
      .map(environmentOf)
      .filter((item): item is EnvironmentFact => item !== undefined)
      .slice(0, MAX_ENVIRONMENTS),
    counts: {
      flows: count(counts['flows']),
      scenarios: count(counts['scenarios']),
      compositions: count(counts['compositions']),
    },
    runs: list(data['recentRuns'])
      .map(runOf)
      .filter((item): item is RunFact => item !== undefined)
      .slice(0, MAX_RUNS),
    ...(uncertain.length === 0 ? {} : { uncertainFields: uncertain }),
    ...(old.length === 0 ? {} : { oldDocs: old }),
    ...(typeof data['asOf'] === 'string' && data['asOf'].length <= 40
      ? { asOf: data['asOf'] }
      : {}),
  };
}

/** Is `value` JSON, as the state stores it? Anything else (a function, `undefined`) is dropped. */
function toJson(value: unknown, depth = 0): Json | undefined {
  if (depth > 6) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => {
      const json = toJson(item, depth + 1);
      return json === undefined ? [] : [json];
    });
  }
  if (!isDict(value)) return undefined;
  const out: Record<string, Json> = {};
  for (const [key, item] of Object.entries(value)) {
    const json = toJson(item, depth + 1);
    if (json !== undefined) out[key] = json;
  }
  return out;
}

/** The parts of a report the summary draws; the lists of errors and endpoints stay out. */
const REPORT_KEYS = [
  'verdict',
  'failure',
  'thresholds',
  'scopedFailed',
  'run',
  'requests',
  'latency',
] as const;

/** The summary of the data of a report (`process_get_status` with `result: report`); `undefined` without a verdict. */
export function reportFacts(data: unknown, href: string | undefined): ReportFacts | undefined {
  if (!isDict(data) || !isDict(data['verdict']) || str(data['verdict']['state']) === undefined) {
    return undefined;
  }
  const picked: Dict = Object.fromEntries(
    REPORT_KEYS.flatMap((key) => {
      const raw = key === 'thresholds' ? list(data[key]).slice(0, MAX_THRESHOLDS) : data[key];
      const json = raw === undefined ? undefined : toJson(raw);
      return json === undefined ? [] : [[key, json] as const];
    }),
  );
  const link = safeHref(href);
  return {
    ...(link === undefined ? {} : { href: link }),
    data: picked as { readonly [key: string]: Json },
  };
}

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * The panel after a reading of the operation in progress (`undefined`: none is). A reading of an
 * operation that is over clears the numbers.
 */
export function withSnapshot(panel: PanelData, snapshot: OperationSnapshot | undefined): PanelData {
  const { snapshot: old, failure, ...rest } = panel;
  const kept = failure === undefined ? {} : { failure };
  if (snapshot === undefined) return old === undefined ? panel : { ...rest, ...kept };
  if (isTerminal(snapshot)) {
    // The end of a test that failed is kept apart from the numbers: the Run tab says why it failed.
    const failed =
      snapshot.kind === 'test_run' &&
      (snapshot.phase === 'failed' || snapshot.phase === 'abandoned');
    const next: TestFailure | undefined = failed
      ? {
          operation: snapshot.operation,
          ...(snapshot.reason === undefined ? {} : { reason: snapshot.reason }),
        }
      : undefined;
    if (old === undefined && sameJson(failure, next)) return panel;
    return { ...rest, ...(next === undefined ? {} : { failure: next }) };
  }
  // A test that runs again takes back the failure of the one before.
  if (snapshot.kind === 'test_run') {
    return sameJson(old, snapshot) && failure === undefined ? panel : { ...rest, snapshot };
  }
  return sameJson(old, snapshot) ? panel : { ...rest, ...kept, snapshot };
}

export function withProject(panel: PanelData, data: unknown): PanelData {
  const project = projectFacts(data);
  return project === undefined || sameJson(panel.project, project) ? panel : { ...panel, project };
}

export function withReport(panel: PanelData, data: unknown, href: string | undefined): PanelData {
  const report = reportFacts(data, href);
  return report === undefined || sameJson(panel.report, report) ? panel : { ...panel, report };
}

export function withPreview(panel: PanelData, handle: string, href: string): PanelData {
  const link = safeHref(href);
  if (link === undefined || (panel.preview?.handle === handle && panel.preview.href === link)) {
    return panel;
  }
  return { ...panel, preview: { handle, href: link } };
}

/** The journeys marked in the tab that the project still lists, in the order the project lists them. */
export function markedJourneys(panel: PanelData): readonly string[] {
  const marked = new Set(panel.choice?.journeys ?? []);
  return (panel.project?.path?.journeys ?? []).flatMap((item) =>
    marked.has(item.name) ? [item.name] : [],
  );
}

/** The panel after a method was picked (and sent to the agent). */
export function withMethod(panel: PanelData, method: FlowMethod): PanelData {
  const journeys = panel.choice?.journeys ?? [];
  return panel.choice?.method === method ? panel : { ...panel, choice: { method, journeys } };
}

/** The panel after the marked journeys were sent: the marks are cleared, the method stays. */
export function withJourneysSent(panel: PanelData): PanelData {
  if ((panel.choice?.journeys.length ?? 0) === 0) return panel;
  return {
    ...panel,
    choice: {
      ...(panel.choice?.method === undefined ? {} : { method: panel.choice.method }),
      journeys: [],
    },
  };
}

/** The view of the list `id`, as kept in the panel; the empty view before the first press. */
export function listView(panel: PanelData, id: string): ListView {
  return panel.lists?.[id] ?? EMPTY_VIEW;
}

/** The panel with the view of the list `id` changed by `change`; the same panel when nothing changed. */
export function withListView(
  panel: PanelData,
  id: string,
  change: (view: ListView) => ListView,
): PanelData {
  const before = listView(panel, id);
  const after = change(before);
  return after === before ? panel : { ...panel, lists: { ...panel.lists, [id]: after } };
}

/** The journeys marked at most: what one call of `flows_generate_from_suggestions` takes. */
export const MAX_MARKED_JOURNEYS = MAX_SUGGESTIONS;

function withMarks(panel: PanelData, journeys: readonly string[]): PanelData {
  return {
    ...panel,
    choice: {
      ...(panel.choice?.method === undefined ? {} : { method: panel.choice.method }),
      journeys: [...journeys],
    },
  };
}

/** The names of `names` the project lists. */
function listedOf(panel: PanelData, names: readonly string[]): string[] {
  const listed = new Set((panel.project?.path?.journeys ?? []).map((item) => item.name));
  return names.filter((name) => listed.has(name));
}

/**
 * The panel after a press on the marks of `names` (view/list.ts `toggledMarks`): one name toggles, a
 * group is marked whole or unmarked whole, never past `MAX_MARKED_JOURNEYS`. Names the project does not
 * list are left out, and so are marks whose journey went.
 */
export function withJourneyMarks(panel: PanelData, names: readonly string[]): PanelData {
  const known = listedOf(panel, names);
  if (known.length === 0) return panel;
  return withMarks(panel, toggledMarks(markedJourneys(panel), known, MAX_MARKED_JOURNEYS));
}

/** The panel with `names` marked on top of the marks, up to `MAX_MARKED_JOURNEYS` ("mark all shown"). */
export function withJourneysAdded(panel: PanelData, names: readonly string[]): PanelData {
  const known = listedOf(panel, names);
  if (known.length === 0) return panel;
  return withMarks(panel, addedMarks(markedJourneys(panel), known, MAX_MARKED_JOURNEYS));
}

/** The panel with no journey marked. */
export function withNoJourneys(panel: PanelData): PanelData {
  return withJourneysSent(panel);
}
