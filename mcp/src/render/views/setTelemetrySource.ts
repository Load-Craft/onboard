// View of `project_connect_telemetry`: that the log server answered, which of its tools the backend
// calls on its own (and for which window), and the ones it will not call, with the reason.

import type { Translator } from '../../context.js';
import { inline, VIEW_WIDTH, wrap } from '../primitives.js';

/** Why a tool is not called: it needs more than `start` and `end`, or the server does not offer it. */
export type TelemetryToolReason = 'extra_input' | 'not_offered';

export interface TelemetryToolView {
  readonly name: string;
  /** The backend calls the tool on its own: its only required inputs are `start` and `end`. */
  readonly eligible: boolean;
  /** The tool is on the project's list of enabled tools. */
  readonly enabled: boolean;
  /** Set for an enabled tool the backend will not call. */
  readonly reason?: TelemetryToolReason;
}

export interface TelemetryData {
  readonly label: string;
  readonly connected: boolean;
  /** Tools the server offers, then enabled names it does not offer. */
  readonly tools: readonly TelemetryToolView[];
  /** The window the backend passes to the tools: the whole run, two minutes on each side. */
  readonly window: 'whole_run_±120s';
}

const INDENT = '  ';

const names = (tools: readonly TelemetryToolView[]): string =>
  tools.map((tool) => inline(tool.name)).join(', ');

export function renderSetTelemetrySource(data: TelemetryData, t: Translator): string {
  const called = data.tools.filter((tool) => tool.eligible && tool.enabled);
  const extraInput = data.tools.filter((tool) => tool.enabled && tool.reason === 'extra_input');
  const notOffered = data.tools.filter((tool) => tool.enabled && tool.reason === 'not_offered');
  const idle = data.tools.filter((tool) => tool.eligible && !tool.enabled);
  const lines: string[] = [
    called.length > 0
      ? t.plural('telemetry.connected', called.length, { names: names(called) })
      : t('telemetry.connectedNone'),
    ...(called.length > 0 ? [t('telemetry.window')] : []),
    ...(extraInput.length > 0 ? [t('telemetry.extraInput', { names: names(extraInput) })] : []),
    ...(notOffered.length > 0 ? [t('telemetry.notOffered', { names: names(notOffered) })] : []),
    ...(idle.length > 0 ? [t('telemetry.idle', { names: names(idle) })] : []),
  ];
  return lines.flatMap((line) => wrap(line, VIEW_WIDTH, INDENT.length)).join('\n');
}
