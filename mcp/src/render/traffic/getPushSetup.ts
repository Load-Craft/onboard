// The view of `traffic_get_push_setup`: where a sender pushes production traffic, with what command
// and scripts, which windows of LoadCraft's own runs it cuts out, the push tokens (names, prefixes,
// dates; never a secret) and the limits a packet is held to. Every text arrives already one line.

import type { Translator } from '../../context.js';
import { num } from '../primitives.js';
import { day, minute, span } from './time.js';

export interface PushScript {
  readonly name: string;
  readonly purpose: string;
  /** The command the page shows for it; empty when it runs without one. */
  readonly command: string;
  /** Lines of the script; its text is never read into the data. */
  readonly lines: number;
}

export interface PushWindow {
  readonly start: string;
  readonly end: string;
  readonly reason: string;
}

export interface PushRun {
  /** Handle of the run (`e-1a2b3c4d`). */
  readonly run: string;
  readonly start: string;
  /** The base address it ran against; null when the run left no manifest. */
  readonly target: string | null;
}

export interface PushToken {
  readonly id: string;
  readonly label: string;
  /** The first characters that tell the token apart; never the token. */
  readonly prefix: string;
  readonly created_at: string;
  readonly last_used_at: string | null;
  /** When it was revoked; null for a token still in use. */
  readonly revoked_at: string | null;
  readonly last_outcome: string | null;
  readonly last_refusal_codes: readonly string[];
}

export interface PushLimits {
  readonly packets_per_token_per_hour: number;
  readonly max_window_days: number;
  readonly max_rows: number;
  readonly max_routes: number;
  readonly max_packet_bytes: number;
}

export interface PushSetupData {
  readonly project_id: string;
  readonly address: string | null;
  readonly warning: string | null;
  readonly command: string;
  readonly scripts: readonly PushScript[];
  readonly excluded_windows: { readonly count: number; readonly items: readonly PushWindow[] };
  readonly runs_without_window: { readonly count: number; readonly items: readonly PushRun[] };
  readonly runs_without_window_note: string | null;
  /** How many push tokens the project has, revoked included (the log slot `{tokens}`). */
  readonly tokens: number;
  readonly active_tokens: number;
  readonly token_list: readonly PushToken[];
  readonly tokens_state: 'read' | 'unavailable';
  readonly limits: PushLimits;
}

const MB = 1024 * 1024;

function counted(count: number, shown: number, t: Translator): string {
  return shown < count
    ? t('traffic_get_push_setup.count_first', { count, shown })
    : t('traffic_get_push_setup.count', { count });
}

function tokenLine(token: PushToken, t: Translator): string {
  const parts = [
    t('traffic_get_push_setup.token', { label: token.label, prefix: token.prefix }),
    t('traffic_get_push_setup.token_created', { day: day(token.created_at) }),
  ];
  if (token.revoked_at !== null) {
    parts.push(t('traffic_get_push_setup.token_revoked', { day: day(token.revoked_at) }));
  } else if (token.last_used_at !== null) {
    parts.push(t('traffic_get_push_setup.token_used', { at: minute(token.last_used_at) }));
  } else {
    parts.push(t('traffic_get_push_setup.token_unused'));
  }
  const outcome =
    token.last_outcome === null || token.revoked_at !== null
      ? ''
      : `: ${token.last_outcome}${
          token.last_refusal_codes.length === 0 ? '' : ` (${token.last_refusal_codes.join(', ')})`
        }`;
  return `  ${parts.join(', ')}${outcome}`;
}

export function renderGetPushSetup(data: PushSetupData, t: Translator): string {
  const lines = [t('traffic_get_push_setup.header')];
  // With no address the server's own warning is English prose: say it in the user's language, and say
  // where the address is set (the server of LoadCraft, not the application under test)
  if (data.warning !== null && data.address === null) {
    lines.push(t('traffic_get_push_setup.no_address'));
  } else if (data.warning !== null) {
    lines.push(t('traffic_get_push_setup.warning', { text: data.warning }));
  }
  if (data.address !== null) {
    lines.push(t('traffic_get_push_setup.address', { url: data.address }));
  }
  if (data.command !== '')
    lines.push(t('traffic_get_push_setup.command', { command: data.command }));
  if (data.scripts.length > 0) {
    lines.push(t('traffic_get_push_setup.scripts', { count: data.scripts.length }));
    for (const script of data.scripts) {
      const run =
        script.command === ''
          ? ''
          : ` ${t('traffic_get_push_setup.script_run', { command: script.command })}`;
      lines.push(`  ${script.name} — ${script.purpose}${run}`);
    }
  }
  const windows = data.excluded_windows;
  if (windows.count > 0) {
    lines.push(
      t('traffic_get_push_setup.windows', {
        counted: counted(windows.count, windows.items.length, t),
        windows: windows.items
          .map((window) => `${span(window.start, window.end)} ${window.reason}`)
          .join('; '),
      }),
    );
  }
  const runs = data.runs_without_window;
  if (runs.count > 0) {
    lines.push(
      t('traffic_get_push_setup.runs', {
        counted: counted(runs.count, runs.items.length, t),
        runs: runs.items
          .map((run) =>
            run.target === null
              ? t('traffic_get_push_setup.run', { run: run.run, at: minute(run.start) })
              : t('traffic_get_push_setup.run_on', {
                  run: run.run,
                  at: minute(run.start),
                  target: run.target,
                }),
          )
          .join('; '),
      }),
    );
    if (data.runs_without_window_note !== null) lines.push(`  ${data.runs_without_window_note}`);
  }
  if (data.tokens_state === 'unavailable') {
    lines.push(t('traffic_get_push_setup.tokens_unavailable'));
  } else if (data.tokens === 0) {
    lines.push(t('traffic_get_push_setup.tokens_none'));
  } else {
    lines.push(
      t('traffic_get_push_setup.tokens', { count: data.tokens, active: data.active_tokens }),
    );
    for (const token of data.token_list) lines.push(tokenLine(token, t));
    if (data.token_list.length < data.tokens) {
      lines.push(
        `  ${t('traffic_get_push_setup.tokens_more', { count: data.tokens - data.token_list.length })}`,
      );
    }
  }
  const { limits } = data;
  lines.push(
    t('traffic_get_push_setup.limits', {
      packets: num(limits.packets_per_token_per_hour, t.locale),
      days: num(limits.max_window_days, t.locale),
      rows: num(limits.max_rows, t.locale),
      routes: num(limits.max_routes, t.locale),
      mb: num(Math.round(limits.max_packet_bytes / MB), t.locale),
    }),
  );
  return lines.join('\n');
}
