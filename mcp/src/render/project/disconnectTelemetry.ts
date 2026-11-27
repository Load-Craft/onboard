// The view of `project_disconnect_telemetry` and of the lines of its consent card: which log server the
// project is connected to, and what the removal touches. The label is a text a person wrote and the
// address one of the application: both arrive masked and made one line (the tool does it). The
// credentials of the connection are never read.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

/** What the card froze. */
export interface DisconnectTelemetryFacts {
  readonly label: string;
  /** The host of the server's address, never its path or query (null when there is none). */
  readonly host: string | null;
  /** How many tools of the server the project has enabled. */
  readonly tools: number;
}

export interface DisconnectTelemetryData {
  /** False: no log server was connected and nothing was sent. */
  readonly disconnected: boolean;
  readonly label: string | null;
  readonly host: string | null;
}

export function cardViewDisconnectTelemetry(
  facts: DisconnectTelemetryFacts,
  t: Translator,
): CardView {
  return {
    title: t('project_disconnect_telemetry.card.title'),
    lines: [
      t('project_disconnect_telemetry.card.server', {
        label: facts.label,
        host: facts.host ?? t('project_disconnect_telemetry.no_host'),
      }),
      t.plural('project_disconnect_telemetry.card.tools', facts.tools, {
        count: num(facts.tools, t.locale),
      }),
      t('project_disconnect_telemetry.card.stays'),
    ],
    undo: t('project_disconnect_telemetry.card.undo'),
  };
}

export function renderDisconnectTelemetry(data: DisconnectTelemetryData, t: Translator): string {
  if (!data.disconnected) return t('project_disconnect_telemetry.none');
  return [
    t('project_disconnect_telemetry.done', {
      label: data.label ?? '',
      host: data.host ?? t('project_disconnect_telemetry.no_host'),
    }),
    t('project_disconnect_telemetry.again'),
  ].join('\n');
}
