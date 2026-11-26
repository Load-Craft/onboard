// View of `process_get_status`: identity and compatibility, the project with its setup and environments,
// counts, recent runs, operations in progress and the next step. `detail` adds one list.

import type { Translator } from '../../context.js';
import type { EnvironmentState, SetupState, SlotState } from '../../api/status.js';
import type { OperationSnapshot } from '../../ops/operation.js';
import type { VerdictState } from '../../report/verdict.js';
import { clock, columns, inline, num, VIEW_WIDTH, visibleWidth, wrap } from '../primitives.js';
import { needsInputLines, type NeedsInputView } from './needsInput.js';
import { oldDocsLines } from './oldDocs.js';
import { numberParts, testTime } from './run.js';
import { slotRef } from '../slotRef.js';

export interface RunView {
  /** `e-` and the first 8 characters of the id: what `results_get_report` and `results_analyze_run` take. */
  readonly handle: string;
  readonly id: string;
  /** Name of the composition or scenario the run drove. */
  readonly target: string;
  readonly status: string;
  readonly verdict?: VerdictState;
  /** ISO time of the run's start. */
  readonly when: string;
}

export interface OperationView {
  /** What `process_wait` takes: `<kind>:<id>`. */
  readonly handle: string;
  readonly kind: string;
  readonly startedAt: string;
}

/** Why the next step is the next step; the text is `status.next.<hint>`. */
export type NextHint =
  | 'unbound'
  | 'setup_incomplete'
  | 'analysis_done'
  | 'no_flows'
  | 'no_compositions'
  | 'needs_data'
  | 'no_runs'
  | 'no_analysis'
  | 'passed_no_diagnosis'
  | 'all_done';

export interface NextStep {
  /** The tool to call next. */
  readonly step: string;
  readonly hint: NextHint;
  /**
   * What the step is about: the run handle for `no_analysis` and `passed_no_diagnosis`, the handle
   * of the finished analysis for `analysis_done`.
   */
  readonly subject?: string;
  /** The slots `needs_data` waits for, with the keys the data tools take. */
  readonly slots?: readonly { readonly slot: string; readonly label: string }[];
  /** Tools the session does not need at this point (the diagnosis of a test that passed). */
  readonly skipped?: readonly string[];
}

export type StatusSection =
  | {
      readonly kind: 'flows';
      readonly items: { name: string; steps: number }[];
      readonly more: number;
    }
  | {
      readonly kind: 'scenarios';
      readonly items: {
        name: string;
        flow: string | null;
        version: number | null;
        selfCheck: string | null;
      }[];
      readonly more: number;
      readonly compositions: string[];
      readonly moreCompositions: number;
    }
  | {
      readonly kind: 'data';
      readonly items: { scenario: string; slots: SlotState[] }[];
      readonly more: number;
    };

export interface StatusData {
  /** Time of the reading (ISO); ages in the view are counted from it. */
  readonly asOf: string;
  readonly identity: { readonly userId: string | null };
  readonly compat: {
    readonly backendVersion: string;
    readonly apiRevision: number;
    readonly plugin: string;
  };
  readonly project?: { readonly id: string; readonly name: string };
  readonly setup?: SetupState;
  readonly environments: EnvironmentState[];
  readonly counts: {
    readonly flows: number;
    readonly scenarios: number;
    readonly compositions: number;
  };
  /**
   * What flows can be built from, and the journeys already proposed: for a client that offers the
   * choice (the data block only; the text view does not show it).
   */
  readonly path?: {
    readonly docs: boolean;
    readonly recording: boolean;
    readonly frontend: boolean;
    readonly journeys: readonly {
      readonly name: string;
      readonly pattern: string;
      /** What each step does, as `flows_suggest_journeys` showed it (the first 12). */
      readonly steps?: readonly string[];
      /** A flow with this name exists already. */
      readonly built?: true;
    }[];
  };
  /** Newest first; as many as the detail level shows. */
  readonly recentRuns: RunView[];
  readonly moreRuns: number;
  readonly operations: OperationView[];
  readonly section?: StatusSection;
  /** Flows on an older docs version: the first names and how many more; absent when there is none. */
  readonly oldDocs?: { readonly flows: readonly string[]; readonly more: number };
  /** Flows the generator left open items on, by name, with the definite items. */
  readonly needsInput?: NeedsInputView;
  /** Profile fields the setup analysis was unsure of (its open warning); absent when none. */
  readonly uncertainFields?: readonly string[];
  readonly next: NextStep;
}

/** Environments the summary lists before it says how many more there are. */
const SHOWN_ENVIRONMENTS = 8;
const INDENT = '  ';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** `30 min ago`, `5 h ago`, `3 days ago`, counted from the reading. */
function ago(when: string, asOf: string, t: Translator): string {
  const elapsed = Date.parse(asOf) - Date.parse(when);
  if (!Number.isFinite(elapsed)) return '—';
  if (elapsed < MINUTE) return t('status.ago.now');
  if (elapsed < HOUR) return t.plural('status.ago.minutes', Math.floor(elapsed / MINUTE));
  if (elapsed < 48 * HOUR) return t.plural('status.ago.hours', Math.floor(elapsed / HOUR));
  return t.plural('status.ago.days', Math.floor(elapsed / (24 * HOUR)));
}

const more = (count: number, t: Translator): string[] =>
  count > 0 ? [INDENT + t('status.more', { count: num(count, t.locale) })] : [];

function setupLine(name: string, setup: SetupState | undefined, t: Translator): string {
  const project = t('status.project', { name: inline(name) });
  if (setup === undefined) return project;
  if (setup.complete) return `${project} · ${t('status.setup.complete')}`;
  if (setup.missing.length === 0) return `${project} · ${t('status.setup.incompleteUnknown')}`;
  const missing = setup.missing.map((step) => t(`error.setup_incomplete.part.${step}`)).join(', ');
  return `${project} · ${t('status.setup.incomplete', { missing })}`;
}

function environmentNotes(environment: EnvironmentState, t: Translator): string {
  const notes: string[] = [];
  if (environment.isDefault) notes.push(t('status.env.default'));
  if (environment.protected) notes.push(t('status.env.protected'));
  const caps = [
    ...(environment.caps.maxVu === undefined
      ? []
      : [t.plural('status.env.capUsers', environment.caps.maxVu)]),
    ...(environment.caps.maxRps === undefined
      ? []
      : [t.plural('status.env.capRps', environment.caps.maxRps)]),
  ];
  if (caps.length > 0) notes.push(t('status.env.caps', { caps: caps.join(' / ') }));
  else if (environment.protected) notes.push(t('status.env.protectedNoCaps'));
  else if (!environment.isDefault) notes.push(t('status.env.noCaps'));
  if (!environment.active) notes.push(t('status.env.inactive'));
  return notes.join(' · ');
}

function environmentLines(environments: readonly EnvironmentState[], t: Translator): string[] {
  const shown = environments.slice(0, SHOWN_ENVIRONMENTS);
  const rows = shown.map((environment) => [
    environment.isDefault ? `${inline(environment.name)} ★` : inline(environment.name),
    environmentNotes(environment, t),
  ]);
  return [...columns(rows), ...more(environments.length - shown.length, t)];
}

function countsLine(counts: StatusData['counts'], t: Translator): string {
  return [
    t.plural('status.count.flows', counts.flows),
    t.plural('status.count.scenarios', counts.scenarios),
    t.plural('status.count.compositions', counts.compositions),
  ].join(' · ');
}

function runLines(data: StatusData, t: Translator): string[] {
  if (data.recentRuns.length === 0) return [t('status.runs.none')];
  const rows = data.recentRuns.map((run) => [
    INDENT + inline(run.handle),
    inline(run.target),
    run.verdict === undefined ? inline(run.status) : t(`verdict.state.${run.verdict}`),
    ago(run.when, data.asOf, t),
  ]);
  return [t('status.runs.title'), ...columns(rows), ...more(data.moreRuns, t)];
}

function operationLines(data: StatusData, t: Translator): string[] {
  if (data.operations.length === 0) return [];
  const rows = data.operations.map((operation) => [
    INDENT + inline(operation.handle),
    t('status.ops.started', { ago: ago(operation.startedAt, data.asOf, t) }),
  ]);
  return [t('status.ops.title'), ...columns(rows)];
}

function selfCheckText(status: string | null, t: Translator): string {
  if (status === null) return t('status.selfCheck.none');
  const key = `status.selfCheck.${status}`;
  return t.has(key) ? t(key) : t('status.selfCheck.other', { status: inline(status) });
}

/** `label ✓` for a pinned dataset, `label ✕` for one the self-check waits for. */
function slotText(slot: SlotState, t: Translator): string {
  const label = slotRef(slot.label, slot.slot, t);
  if (slot.state === 'bound') return `${label} ✓`;
  if (slot.state === 'missing') return `${label} ✕`;
  return label;
}

/** A name column and a value wrapped under the value column. */
function hanging(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(0, ...rows.map(([name]) => visibleWidth(name)));
  const indent = width + INDENT.length;
  return rows.flatMap(([name, value]) => {
    const [first = '', ...rest] = wrap(value, VIEW_WIDTH - indent - INDENT.length);
    const head = `${INDENT}${name}${' '.repeat(width - visibleWidth(name))}${INDENT}${first}`;
    return [head, ...rest.map((line) => ' '.repeat(indent + INDENT.length) + line)];
  });
}

function sectionLines(section: StatusSection, t: Translator): string[] {
  switch (section.kind) {
    case 'flows': {
      if (section.items.length === 0) return [];
      const rows = section.items.map((flow) => [
        INDENT + inline(flow.name),
        t.plural('common.steps', flow.steps),
      ]);
      return [t('status.section.flows'), ...columns(rows), ...more(section.more, t)];
    }
    case 'scenarios': {
      const rows = section.items.map((scenario) => [
        INDENT + inline(scenario.name),
        t('status.scenario.flow', { flow: scenario.flow === null ? '—' : inline(scenario.flow) }),
        scenario.version === null
          ? ''
          : t('status.scenario.version', { version: scenario.version }),
        selfCheckText(scenario.selfCheck, t),
      ]);
      const compositions =
        section.compositions.length === 0
          ? []
          : wrap(
              t('status.section.compositions', {
                names: section.compositions.map((name) => inline(name)).join(', '),
              }),
              VIEW_WIDTH,
              INDENT.length,
            );
      return [
        ...(rows.length === 0 ? [] : [t('status.section.scenarios'), ...columns(rows)]),
        ...more(section.more, t),
        ...compositions,
        ...more(section.moreCompositions, t),
      ];
    }
    case 'data': {
      if (section.items.length === 0) return [t('status.data.none')];
      return [
        t('status.section.data'),
        ...hanging(
          section.items.map((item) => [
            inline(item.scenario),
            item.slots.map((slot) => slotText(slot, t)).join(' · '),
          ]),
        ),
        ...more(section.more, t),
        INDENT + t('status.data.legend'),
      ];
    }
  }
}

function nextLine(next: NextStep, t: Translator): string[] {
  const subject =
    next.slots === undefined
      ? inline(next.subject ?? '')
      : next.slots.map((item) => slotRef(item.label, item.slot, t)).join(', ');
  const params = { step: next.step, subject };
  return wrap(t(`status.next.${next.hint}`, params), VIEW_WIDTH, INDENT.length);
}

export function renderGetStatus(data: StatusData, t: Translator): string {
  const identity = wrap(
    t('status.identity', {
      user: data.identity.userId === null ? '—' : inline(data.identity.userId),
      version: inline(data.compat.backendVersion),
      revision: data.compat.apiRevision,
    }),
    VIEW_WIDTH,
    INDENT.length,
  );
  const project =
    data.project === undefined
      ? []
      : [
          ...wrap(setupLine(data.project.name, data.setup, t), VIEW_WIDTH, INDENT.length),
          ...environmentLines(data.environments, t),
          countsLine(data.counts, t),
          ...(data.oldDocs === undefined
            ? []
            : oldDocsLines(data.oldDocs.flows, data.oldDocs.more, 'list', t)),
          ...needsInputLines(data.needsInput, t),
          ...runLines(data, t),
          ...(data.uncertainFields === undefined || data.uncertainFields.length === 0
            ? []
            : wrap(
                t('projectProfile.uncertain', {
                  fields: inline(data.uncertainFields.join(', '), 400),
                }),
                VIEW_WIDTH,
                INDENT.length,
              )),
        ];
  const section =
    data.project === undefined || data.section === undefined ? [] : sectionLines(data.section, t);
  return [
    ...identity,
    ...project,
    ...operationLines(data, t),
    ...section,
    ...nextLine(data.next, t),
  ].join('\n');
}

/** One line: the handle, the phase, the time, and the numbers of a test that has them. */
export function renderOperationSnapshot(data: OperationSnapshot, t: Translator): string {
  const phase = data.phase === undefined ? [] : [t(`status.operation.phase.${data.phase}`)];
  const load =
    data.load_elapsed_s === undefined
      ? []
      : [
          t('runStart.progress.test', {
            time: testTime(data.load_elapsed_s, data.planned_s ?? null),
          }),
        ];
  const numbers =
    data.live === undefined
      ? []
      : numberParts(
          {
            rps: data.live.rps,
            p95Ms: data.live.p95_ms,
            errorRate: data.live.error_pct === null ? null : data.live.error_pct / 100,
          },
          true,
          t,
        );
  return [
    t('status.operation.head', { handle: inline(data.operation, 160) }),
    ...phase,
    t('status.operation.since', { time: clock(data.elapsed_s) }),
    ...load,
    ...numbers,
    ...(data.needs_user === undefined
      ? []
      : [t('status.operation.needsUser', { what: inline(data.needs_user, 160) })]),
  ].join(' · ');
}
