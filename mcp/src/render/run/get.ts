// The view of `run_get`: the state of one run, what it ran against and with, the verdicts it
// carries, and, when asked, the diagnosis of a failure (its stage, its cause and the tail of the
// build output). Texts of the backend and of the target arrive in the data masked and made one line.

import type { Translator } from '../../context.js';
import { decimal, keyValue, num } from '../primitives.js';
import type { RunStatus, WorkloadView } from './types.js';

export type FailureStage =
  | 'pending'
  | 'building'
  | 'running'
  | 'completed'
  | 'compilation'
  | 'build'
  | 'connectivity'
  | 'load'
  | 'failed'
  | 'cancelled';

export interface RunSla {
  readonly status: 'passed' | 'failed' | 'refused';
  readonly reason: string | null;
  readonly assertions: number;
  readonly failed: number;
  readonly gatlingDisagrees: boolean;
}

export interface RunInvariants {
  readonly state: 'evaluated' | 'evaluation_failed' | 'evaluating';
  readonly passed: number;
  readonly failed: number;
  readonly noData: number;
}

export interface RunDiagnostics {
  readonly stage: FailureStage;
  readonly cause: string | null;
  /** The last lines of the build output, newest last, at most 40. */
  readonly lines: readonly string[];
  /** Length of the whole output, in characters, and whether the backend cut it. */
  readonly logChars: number;
  readonly logTruncated: boolean;
}

export interface RunDetail {
  /** The handle of the run (`e-1a2b3c4d`) and its UUID. */
  readonly run: string;
  readonly run_id: string;
  readonly status: RunStatus;
  readonly createdAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  /** The measured load window in seconds; null unless `loadWindow` is `measured`. */
  readonly durationS: number | null;
  readonly loadWindow: 'measured' | 'pending' | 'unavailable';
  readonly targetKind: 'scenario' | 'composition' | null;
  readonly targetId: string | null;
  readonly profileId: string | null;
  readonly totals: { readonly requests: number; readonly ok: number; readonly ko: number } | null;
  readonly exitCode: number | null;
  readonly sla: RunSla | null;
  readonly invariants: RunInvariants | null;
  readonly environment: string | null;
  readonly baseUrl: string | null;
  readonly workload: WorkloadView | null;
  readonly members: number | null;
  readonly errorMessage: string | null;
  readonly warnings: readonly string[];
  readonly warningCount: number;
  readonly diagnostics: RunDiagnostics | null;
}

const minute = (at: string): string =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.exec(at)?.[0].replace('T', ' ') ?? at;

function loadOf(workload: WorkloadView, t: Translator): string {
  const users = workload.vusers === null ? '?' : num(workload.vusers, t.locale);
  const ramp =
    workload.ramp === null ? '' : t('run_get.ramp', { seconds: num(workload.ramp, t.locale) });
  const hold =
    workload.hold === null ? '' : t('run_get.hold', { seconds: num(workload.hold, t.locale) });
  return `${workload.type === null ? '' : `${workload.type} `}${users} ${t('run_get.users')}${ramp}${hold}`;
}

export function renderGet(data: RunDetail, t: Translator): string {
  const rows: [string, string][] = [];
  if (data.targetKind !== null && data.targetId !== null) {
    rows.push([
      t('run_get.label.target'),
      `${t(`run_get.target.${data.targetKind}`)} ${data.targetId}`,
    ]);
  }
  if (data.environment !== null) {
    rows.push([
      t('run_get.label.environment'),
      data.baseUrl === null ? data.environment : `${data.environment} (${data.baseUrl})`,
    ]);
  }
  if (data.workload !== null) rows.push([t('run_get.label.load'), loadOf(data.workload, t)]);
  if (data.profileId !== null) rows.push([t('run_get.label.profile'), data.profileId]);
  if (data.startedAt !== null) rows.push([t('run_get.label.started'), minute(data.startedAt)]);
  if (data.durationS !== null) {
    rows.push([t('run_get.label.lasted'), `${num(Math.round(data.durationS), t.locale)} s`]);
  } else if (data.loadWindow === 'unavailable') {
    rows.push([t('run_get.label.lasted'), t('run_get.lasted.unavailable')]);
  }
  if (data.totals !== null) {
    const rate = data.totals.requests === 0 ? 0 : (data.totals.ko / data.totals.requests) * 100;
    rows.push([
      t('run_get.label.requests'),
      t('run_get.requests', {
        total: num(data.totals.requests, t.locale),
        ko: num(data.totals.ko, t.locale),
        rate: decimal(rate, 2, t.locale),
      }),
    ]);
  }
  if (data.sla !== null) {
    const reason = data.sla.reason === null ? '' : `: ${data.sla.reason}`;
    const disagrees = data.sla.gatlingDisagrees ? t('run_get.sla.disagrees') : '';
    rows.push([
      t('run_get.label.sla'),
      data.sla.status === 'refused'
        ? `${t('run_get.sla.refused')}${reason}`
        : t(`run_get.sla.${data.sla.status}`, {
            failed: num(data.sla.failed, t.locale),
            total: num(data.sla.assertions, t.locale),
          }) + disagrees,
    ]);
  }
  if (data.invariants !== null) {
    rows.push([
      t('run_get.label.invariants'),
      data.invariants.state === 'evaluated'
        ? t('run_get.invariants', {
            passed: num(data.invariants.passed, t.locale),
            failed: num(data.invariants.failed, t.locale),
            noData: num(data.invariants.noData, t.locale),
          })
        : t(`run_get.invariants.${data.invariants.state}`),
    ]);
  }
  if (data.errorMessage !== null) rows.push([t('run_get.label.error'), data.errorMessage]);
  const lines = [
    t('run_get.header', { run: data.run, status: t(`run.status.${data.status}`) }),
    ...keyValue(rows),
  ];
  if (data.warningCount > 0) {
    lines.push(t.plural('run_get.warnings', data.warningCount));
    lines.push(...data.warnings.map((warning) => `  - ${warning}`));
  }
  const { diagnostics } = data;
  if (diagnostics !== null) {
    lines.push(t('run_get.diagnostics', { stage: t(`run_get.stage.${diagnostics.stage}`) }));
    if (diagnostics.cause !== null) lines.push(t('run_get.cause', { cause: diagnostics.cause }));
    if (diagnostics.lines.length === 0) {
      lines.push(t('run_get.output.none'));
    } else {
      lines.push(
        t('run_get.output', {
          shown: diagnostics.lines.length,
          chars: num(diagnostics.logChars, t.locale),
        }),
      );
      lines.push(...diagnostics.lines.map((line) => `  ${line}`));
      lines.push(t('run_get.output.footer'));
    }
  } else if (data.status === 'failed') {
    lines.push(t('run_get.next.diagnostics', { run: data.run }));
  } else if (data.status === 'completed') {
    lines.push(t('run_get.next.report', { run: data.run }));
  }
  return lines.join('\n');
}
