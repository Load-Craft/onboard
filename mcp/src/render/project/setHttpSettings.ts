// The view of `project_set_http_settings` and of the lines of its consent card: what changes in the
// base URL and in the protocol options of generated tests (from -> to), and which default headers an
// env file sets (the names, the size and the hash of the file; never a value). The texts arrive masked
// and made one line by the tool.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

/** One protocol option of the card: the value now and the value the call sets, as short texts. */
export interface ProtocolChange {
  readonly key: string;
  readonly from: string;
  readonly to: string;
}

/** The env file of a call, as the card shows it (a hash and the header names, never a value). */
export interface HeadersFileFacts {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  /** At most 20 header names and how many there are. */
  readonly names: readonly string[];
  readonly count: number;
  /** How many default headers the project has now (null: unknown). */
  readonly current: number | null;
}

/** What the card froze. */
export interface SetHttpSettingsFacts {
  /** The project has no HTTP settings yet: the call creates them. */
  readonly created: boolean;
  readonly base_url?: { readonly from: string | null; readonly to: string };
  readonly protocol?: readonly ProtocolChange[];
  readonly headers?: HeadersFileFacts;
}

export type ChangedPart = 'base_url' | 'protocol' | 'headers';

export interface SetHttpSettingsData {
  readonly created: boolean;
  readonly changed: readonly ChangedPart[];
  /** The base URL now (null: none). */
  readonly base_url: string | null;
  /** The protocol options the call changed, with the value now. */
  readonly protocol: Readonly<Record<string, string | number | boolean | null>>;
  /** The default headers the call set: their names and how many (null: not touched). */
  readonly headers: { readonly names: readonly string[]; readonly count: number } | null;
  /** The way back the log keeps: the previous values, or none (headers and a new project cannot be). */
  readonly undo: 'values' | 'withheld' | 'none';
}

const list = (names: readonly string[], total: number): string =>
  names.join(', ') + (total > names.length ? ', …' : '');

export function cardViewSetHttpSettings(facts: SetHttpSettingsFacts, t: Translator): CardView {
  const lines: string[] = [];
  if (facts.created) lines.push(t('project_set_http_settings.card.created'));
  if (facts.base_url !== undefined) {
    lines.push(
      t('project_set_http_settings.card.base_url', {
        from: facts.base_url.from ?? t('project_set_http_settings.none'),
        to: facts.base_url.to,
      }),
    );
  }
  for (const change of facts.protocol ?? []) {
    lines.push(t('project_set_http_settings.card.protocol', { ...change }));
  }
  const { headers } = facts;
  if (headers !== undefined) {
    lines.push(
      t('project_set_http_settings.card.headers', {
        count: num(headers.count, t.locale),
        file: headers.path,
        size: num(headers.size, t.locale),
        sha: headers.sha256.slice(0, 12),
        names: list(headers.names, headers.count),
      }),
      headers.current === null
        ? t('project_set_http_settings.card.headers_replace_unknown')
        : t('project_set_http_settings.card.headers_replace', {
            current: num(headers.current, t.locale),
          }),
    );
  }
  lines.push(t('project_set_http_settings.card.stays'));
  return {
    title: t('project_set_http_settings.card.title'),
    lines,
    undo: t(
      facts.created
        ? 'project_set_http_settings.card.undo.created'
        : 'project_set_http_settings.card.undo.values',
    ),
  };
}

export function renderSetHttpSettings(data: SetHttpSettingsData, t: Translator): string {
  if (data.changed.length === 0) return t('project_set_http_settings.unchanged');
  const parts = data.changed.map((part) => t(`project_set_http_settings.part.${part}`)).join(', ');
  const lines = [t('project_set_http_settings.done', { parts })];
  if (data.base_url !== null && data.changed.includes('base_url')) {
    lines.push(t('project_set_http_settings.base_url_now', { url: data.base_url }));
  }
  const options = Object.entries(data.protocol).map(([key, value]) => `${key}=${String(value)}`);
  if (options.length > 0) {
    lines.push(t('project_set_http_settings.protocol_now', { options: options.join(', ') }));
  }
  if (data.headers !== null) {
    lines.push(
      t('project_set_http_settings.headers_now', {
        count: num(data.headers.count, t.locale),
        names: list(data.headers.names, data.headers.count),
      }),
    );
  }
  lines.push(t(`project_set_http_settings.undo.${data.undo}`));
  return lines.join('\n');
}
