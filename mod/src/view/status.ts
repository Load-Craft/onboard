/**
 * The line of the operation in progress and the notices of its end: pure functions of one snapshot
 * (what `process_get_status` with `operation` and `format: "data"` returns), with no `$`, no clock and no
 * exception. The wording of the numbers is the server's (`runStart.progress.*`, `status.operation.*`
 * in mcp/src/render/i18n); the dictionary itself stays out of the mod, which has no `process`.
 */

import { operationEn, operationPl } from '../../../mcp/src/render/i18n/operation.js';
import { clock, decimal, inline, type Locale } from '../../../mcp/src/render/primitives.js';

export type { Locale };

export interface OperationSnapshot {
  /** `<kind>:<id>`, as the server gave it. */
  readonly operation: string;
  readonly kind: string;
  /** Only a kind that reports phases has it (a test run does): `pending`, `building`, `running`, `completed`, `failed`, `cancelled`, `abandoned`. */
  readonly phase?: string;
  /** Seconds since the operation started. */
  readonly elapsed_s: number;
  readonly load_elapsed_s?: number;
  readonly planned_s?: number;
  readonly live?: {
    readonly rps: number | null;
    readonly p95_ms: number | null;
    /** Percent points: 0.6 is 0.6%. */
    readonly error_pct: number | null;
  };
  /** What the operation waits for from the user. */
  readonly needs_user?: string;
  /** Why an operation that failed failed, as the server worded it (after its mask of secrets). */
  readonly reason?: string;
}

export interface Notice {
  readonly kind: 'done' | 'failed' | 'needs_user' | 'lost';
  readonly text: string;
}

/** The longest status line, in characters; a longer one is cut from the end. */
export const MAX_LINE = 200;
const PREFIX = 'LoadCraft';
const SEPARATOR = ' · ';
/** What a request of the user is cut to, so that it fits the line next to the rest. */
const MAX_WANTED = 120;
/** What a reason of a failure is cut to. */
export const MAX_REASON = 160;

/** Phases a snapshot reports for an operation that has ended. */
export const ENDED_PHASES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'cancelled',
  'abandoned',
]);

type Dict = Readonly<Record<string, unknown>>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** True when the phase is one an operation does not come back from. */
export function isTerminal(snapshot: OperationSnapshot): boolean {
  return snapshot.phase !== undefined && ENDED_PHASES.has(snapshot.phase);
}

/** The snapshot in the shape of the server's data block, or `undefined` for anything else. */
export function parseSnapshot(data: unknown): OperationSnapshot | undefined {
  if (!isDict(data)) return undefined;
  const { operation, kind, phase, needs_user: needsUser, reason } = data;
  const elapsed = number(data['elapsed_s']);
  if (typeof operation !== 'string' || !/^[a-z_]+:./u.test(operation)) return undefined;
  if (typeof kind !== 'string' || kind === '' || elapsed === undefined) return undefined;
  const optional = (key: 'load_elapsed_s' | 'planned_s'): Partial<OperationSnapshot> => {
    const value = number(data[key]);
    return value === undefined ? {} : { [key]: value };
  };
  const live = isDict(data['live']) ? data['live'] : undefined;
  return {
    operation,
    kind,
    ...(typeof phase === 'string' ? { phase } : {}),
    elapsed_s: elapsed,
    ...optional('load_elapsed_s'),
    ...optional('planned_s'),
    ...(live === undefined
      ? {}
      : {
          live: {
            rps: number(live['rps']) ?? null,
            p95_ms: number(live['p95_ms']) ?? null,
            error_pct: number(live['error_pct']) ?? null,
          },
        }),
    ...(typeof needsUser === 'string' && inline(needsUser) !== '' ? { needs_user: needsUser } : {}),
    ...(typeof reason === 'string' && inline(reason) !== ''
      ? { reason: inline(reason, MAX_REASON) }
      : {}),
  };
}

/** The texts the server's views use for the same line (mcp/src/render/i18n/operation.ts): one source. */
const SERVER_TEXTS: Readonly<Record<Locale, Readonly<Record<string, string>>>> = {
  en: operationEn,
  pl: operationPl,
};

function mirrored(locale: Locale, key: string, params: Readonly<Record<string, string>>): string {
  return (SERVER_TEXTS[locale][key] ?? key).replace(
    /\{(\w+)\}/gu,
    (_, name: string) => params[name] ?? '',
  );
}

/** What only the mod says: the notices, and the names of the kinds of operation. */
interface Words {
  readonly testDone: string;
  readonly testFailed: string;
  readonly testStopped: string;
  readonly operationDone: string;
  /** Names of the kinds of operation the server has (`scenario_generation`). */
  readonly kinds: Readonly<Record<string, string>>;
  readonly lost: string;
}

const WORDS: Readonly<Record<Locale, Words>> = {
  en: {
    testDone: 'Test finished',
    testFailed: 'Test failed',
    testStopped: 'Test stopped',
    operationDone: 'Operation finished:',
    kinds: {
      setup_analysis: 'project analysis',
      refine: 'refinement',
      batch_generation: 'batch generation',
      flow_generation: 'flow generation',
      scenario_generation: 'scenario generation',
      self_check: 'data check',
      record_run: 'recording',
      test_run: 'test',
      analysis: 'analysis',
      account_provision: 'account creation',
    },
    lost: 'LoadCraft: operation state unknown. Check /loadcraft:status or process_get_status.',
  },
  pl: {
    testDone: 'Test zakończony',
    testFailed: 'Test nieudany',
    testStopped: 'Test zatrzymany',
    operationDone: 'Operacja zakończona:',
    kinds: {
      setup_analysis: 'analiza projektu',
      refine: 'doprecyzowanie',
      batch_generation: 'generowanie zestawu',
      flow_generation: 'generowanie flow',
      scenario_generation: 'generowanie scenariuszy',
      self_check: 'sprawdzenie danych',
      record_run: 'nagrywanie',
      test_run: 'test',
      analysis: 'analiza',
      account_provision: 'zakładanie kont',
    },
    lost: 'LoadCraft: nieznany stan operacji. Sprawdź /loadcraft:status albo process_get_status.',
  },
};

/** The name of a kind of operation; a kind the mod does not know is shown as its code in words. */
function kindLabelOf(kind: string, words: Words): string {
  return words.kinds[kind] ?? inline(kind, 40).replace(/_/gu, ' ');
}

/** The name of a kind of operation in `locale`, for a bar. */
export function kindLabel(kind: string, locale: Locale): string {
  return kindLabelOf(kind, WORDS[locale]);
}

export function numberParts(snapshot: OperationSnapshot, locale: Locale): string[] {
  const { live } = snapshot;
  if (live === undefined) return [];
  const shown: [string, number | null, number, string][] = [
    ['rps', live.rps, 0, ''],
    ['p95', live.p95_ms, 0, ' ms'],
    ['errors', live.error_pct, 1, '%'],
  ];
  return shown.flatMap(([name, value, digits, unit]) =>
    value === null
      ? []
      : [
          mirrored(locale, `runStart.progress.${name}`, {
            value: decimal(value, digits, locale) + unit,
          }),
        ],
  );
}

/**
 * The head of the line and the numbers after it: `test 6:40 / 10:00`, `690 requests/s`, `p95≈ 910 ms`,
 * `errors 0.6%`. The status line and the live line under a running `run_start` are made of these.
 */
export function progressParts(snapshot: OperationSnapshot, locale: Locale): string[] {
  const words = WORDS[locale];
  const time =
    snapshot.load_elapsed_s === undefined
      ? undefined
      : snapshot.planned_s === undefined
        ? clock(snapshot.load_elapsed_s)
        : `${clock(snapshot.load_elapsed_s)} / ${clock(snapshot.planned_s)}`;
  const head =
    time !== undefined
      ? mirrored(locale, 'runStart.progress.test', { time })
      : snapshot.phase === 'building' || snapshot.phase === 'pending'
        ? mirrored(locale, 'runStart.progress.building', { time: clock(snapshot.elapsed_s) })
        : `${kindLabelOf(snapshot.kind, words)} ${clock(snapshot.elapsed_s)}`;
  return [head, ...numberParts(snapshot, locale)];
}

/** `LoadCraft · test 6:40 / 10:00 · 690 żądań/s · p95≈ 910 ms`, at most `MAX_LINE` characters. */
export function statusLine(snapshot: OperationSnapshot, locale: Locale): string {
  const wanted =
    snapshot.needs_user === undefined
      ? []
      : [
          mirrored(locale, 'status.operation.needsUser', {
            what: inline(snapshot.needs_user, MAX_WANTED),
          }),
        ];
  return inline([PREFIX, ...progressParts(snapshot, locale), ...wanted].join(SEPARATOR), MAX_LINE);
}

/** What the end of an operation is called for the user, for the text a kind without phases gets. */
export function endedText(snapshot: OperationSnapshot, locale: Locale): string {
  const words = WORDS[locale];
  return `${words.operationDone} ${kindLabelOf(snapshot.kind, words)}`;
}

const ENDS: Readonly<
  Record<string, readonly ['done' | 'failed', 'testDone' | 'testFailed' | 'testStopped']>
> = {
  completed: ['done', 'testDone'],
  cancelled: ['done', 'testStopped'],
  failed: ['failed', 'testFailed'],
  abandoned: ['failed', 'testFailed'],
};

function endText(snapshot: OperationSnapshot, locale: Locale): Notice | undefined {
  const end = ENDS[snapshot.phase ?? ''];
  if (end === undefined) return undefined;
  return {
    kind: end[0],
    text: [WORDS[locale][end[1]], ...numberParts(snapshot, locale)].join(SEPARATOR),
  };
}

/** The notice for an operation the mod gave up reading. */
export function lostNotice(locale: Locale): Notice {
  return { kind: 'lost', text: WORDS[locale].lost };
}

/**
 * What the user is told about the change from `previous` to `snapshot`: the end or the failure of
 * the test, or a request of the user that was not there before. `undefined` when the state did not
 * change. `previous` is `undefined` at the first look at an operation the mod knew as in progress:
 * what that look finds (an end, a request) is news.
 */
export function notice(
  previous: OperationSnapshot | undefined,
  snapshot: OperationSnapshot,
  locale: Locale,
): Notice | undefined {
  if (previous !== undefined && isTerminal(previous)) return undefined;
  if (isTerminal(snapshot)) return endText(snapshot, locale);
  if (snapshot.needs_user !== undefined && previous?.needs_user === undefined) {
    const what = inline(snapshot.needs_user, MAX_WANTED);
    return {
      kind: 'needs_user',
      text: `${PREFIX}${SEPARATOR}${mirrored(locale, 'status.operation.needsUser', { what })}`,
    };
  }
  return undefined;
}
