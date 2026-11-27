// The view of `flows_get_walks`: one line per walk of the list, or one walk with its paths, the flows
// it saved and, when asked, the review timeline. The texts arrive made one line and masked by the
// tool (`content` of tools/moduleCall.ts); the view adds no text of the backend of its own.

import type { Translator } from '../../context.js';

export interface WalkRow {
  readonly id: string;
  /** `r-` and the first 8 characters of the id: what the workspace calls the walk. */
  readonly handle: string;
  readonly status: string;
  readonly created_at: string | null;
  readonly current_step: string | null;
  readonly awaiting_split_approval: boolean;
  /** An excerpt of the description the walk was started from. */
  readonly description: string;
  /** It is `ids.walk_id` of the state. */
  readonly selected: boolean;
}

export interface WalkPath {
  readonly path_index: number;
  readonly name: string;
  readonly status: string;
  readonly steps: number;
  readonly attempts: readonly number[];
  readonly partial: boolean;
  readonly failure_reason: string | null;
  readonly stop_cause: string | null;
  readonly flow_id: string | null;
}

export interface SavedFlow {
  readonly name: string;
  readonly flow_id: string | null;
  readonly version: number | null;
  readonly note: string | null;
}

export interface WalkDetail extends WalkRow {
  readonly title: string;
  readonly error: string | null;
  readonly all_paths_failed: boolean;
  readonly paths: readonly WalkPath[];
  readonly flows_saved: readonly SavedFlow[];
}

export interface TimelinePlanRow {
  readonly path_index: number;
  readonly attempt: number;
  readonly steps: readonly string[];
}

export interface TimelineStepRow {
  readonly path_index: number;
  readonly attempt: number | null;
  readonly step: number | null;
  readonly label: string;
  readonly outcome: string;
  readonly source: string;
  readonly failure_code: string | null;
  readonly reason: string | null;
  readonly still_id: string | null;
}

export interface TimelineNote {
  readonly id: string | null;
  readonly step: number;
  readonly text: string;
  readonly kind: string;
  readonly path_index: number;
  readonly attempt: number;
}

export interface Timeline {
  readonly review_expires_at: string | null;
  readonly plans: readonly TimelinePlanRow[];
  readonly steps: readonly TimelineStepRow[];
  readonly notes: readonly TimelineNote[];
  /** Events of other kinds (a hint, a stop, a hand-back), counted by type. */
  readonly other_events: Readonly<Record<string, number>>;
}

export interface WalksData {
  readonly mode: 'list' | 'walk';
  readonly project_id: string;
  readonly count: number;
  readonly shown: number;
  readonly walks: readonly WalkRow[];
  readonly walk: WalkDetail | null;
  readonly timeline_state: 'none' | 'read' | 'unavailable';
  readonly timeline: Timeline | null;
}

function rowLine(row: WalkRow, index: number, t: Translator): string {
  const parts = [`${String(index + 1)}. ${row.handle}`, row.status];
  if (row.awaiting_split_approval) parts.push(t('flows_get_walks.awaits_approval'));
  if (row.current_step !== null && row.current_step !== '') {
    parts.push(t('flows_get_walks.at_step', { step: row.current_step }));
  }
  if (row.description !== '') parts.push(`"${row.description}"`);
  if (row.selected) parts.push(t('flows_get_walks.selected'));
  return parts.join(' · ');
}

function pathLine(path: WalkPath, t: Translator): string {
  const parts = [
    `${String(path.path_index + 1)}. ${path.name} — ${path.status}`,
    t.plural('flows_get_walks.steps', path.steps),
  ];
  if (path.partial) parts.push(t('flows_get_walks.partial'));
  if (path.flow_id !== null) parts.push(t('flows_get_walks.flow', { id: path.flow_id }));
  if (path.failure_reason !== null) parts.push(path.failure_reason);
  if (path.stop_cause !== null) parts.push(path.stop_cause);
  return `  ${parts.join(', ')}`;
}

function timelineLines(timeline: Timeline, t: Translator): string[] {
  const lines = [t('flows_get_walks.timeline')];
  if (timeline.review_expires_at !== null) {
    lines.push(`  ${t('flows_get_walks.review_until', { at: timeline.review_expires_at })}`);
  }
  for (const plan of timeline.plans) {
    lines.push(
      `  ${t('flows_get_walks.plan', {
        path: plan.path_index + 1,
        attempt: plan.attempt,
        steps: plan.steps.join(' → '),
      })}`,
    );
  }
  for (const step of timeline.steps) {
    const reason = step.reason === null ? '' : ` (${step.reason})`;
    const failure = step.failure_code === null ? '' : ` [${step.failure_code}]`;
    lines.push(
      `  ${t('flows_get_walks.step_line', {
        path: step.path_index + 1,
        attempt: step.attempt ?? '-',
        step: step.step ?? '-',
        label: step.label,
      })} — ${step.outcome}${failure}${reason}`,
    );
  }
  for (const note of timeline.notes) {
    lines.push(
      `  ${t('flows_get_walks.note', { step: note.step, text: note.text, path: note.path_index + 1 })}`,
    );
  }
  const others = Object.entries(timeline.other_events).map(
    ([type, count]) => `${type} ×${String(count)}`,
  );
  if (others.length > 0)
    lines.push(`  ${t('flows_get_walks.other_events', { events: others.join(', ') })}`);
  return lines;
}

function renderWalk(data: WalksData, walk: WalkDetail, t: Translator): string {
  const lines = [
    t('flows_get_walks.walk_header', {
      handle: walk.handle,
      status: walk.status,
      title: walk.title,
    }),
    `id: ${walk.id}`,
  ];
  if (walk.error !== null) lines.push(t('flows_get_walks.error', { text: walk.error }));
  if (walk.all_paths_failed) lines.push(t('flows_get_walks.all_failed'));
  if (walk.paths.length > 0) {
    lines.push(t('flows_get_walks.paths'));
    for (const path of walk.paths) lines.push(pathLine(path, t));
  }
  if (walk.flows_saved.length > 0) {
    lines.push(t('flows_get_walks.saved'));
    for (const flow of walk.flows_saved) {
      const version = flow.version === null ? '' : ` v${String(flow.version)}`;
      const note = flow.note === null ? '' : ` — ${flow.note}`;
      lines.push(
        `  ${flow.name}${version}${flow.flow_id === null ? '' : ` (${flow.flow_id})`}${note}`,
      );
    }
  }
  if (data.timeline_state === 'unavailable') lines.push(t('flows_get_walks.timeline_unavailable'));
  if (data.timeline !== null) lines.push(...timelineLines(data.timeline, t));
  return lines.join('\n');
}

export function renderGetWalks(data: WalksData, t: Translator): string {
  if (data.mode === 'walk' && data.walk !== null) return renderWalk(data, data.walk, t);
  if (data.count === 0) return t('flows_get_walks.empty');
  const lines = [t.plural('flows_get_walks.header', data.count)];
  data.walks.forEach((row, index) => lines.push(rowLine(row, index, t)));
  if (data.shown < data.count) {
    lines.push(t('flows_get_walks.more', { shown: data.shown, count: data.count }));
  }
  return lines.join('\n');
}
