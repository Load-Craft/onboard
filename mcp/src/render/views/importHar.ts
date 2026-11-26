// View of `flows_import_har`: what LoadCraft found in the recording. Numbers, names of paths and variables
// only: a recording holds the session of whoever made it, so no header, cookie or value is shown.

import type { Translator } from '../../context.js';
import { inline, num, VIEW_WIDTH, wrap } from '../primitives.js';

export interface HarWarning {
  /** Dictionary key suffix: `importHar.warning.<kind>`; an unknown kind gets the generic text. */
  readonly kind: string;
  readonly params?: Readonly<Record<string, string | number>> | undefined;
}

export interface ImportHarData {
  /** The answer of an earlier send of the same recording; nothing was uploaded this time. */
  readonly reused: boolean;
  readonly sizeBytes: number;
  /** Requests in the recording. */
  readonly entries: number;
  /** Requests dropped as static files or noise. */
  readonly filtered: number;
  readonly auth: {
    /** `bearer_token`, `cookie_session`, `basic_auth`, or null when none was found. */
    readonly detected: string | null;
    /** The request that issued the token, when the recording shows it. */
    readonly endpoint?: { readonly method: string; readonly path: string } | undefined;
  };
  readonly baseUrl: {
    readonly host: string;
    /** The default environment, when the recorded host is its host; null otherwise. */
    readonly environment: string | null;
  };
  /** Names of the paths (action groups) in recording order, first ten. */
  readonly paths: readonly string[];
  readonly morePaths: number;
  readonly correlations: {
    /** Variables the flow carries between requests with confidence above 0.8. */
    readonly accepted: number;
    readonly uncertain: readonly { readonly variable: string; readonly confidence: number }[];
    readonly moreUncertain: number;
    readonly ambiguous: readonly { readonly variable: string }[];
    readonly moreAmbiguous: number;
  };
  readonly warnings: readonly HarWarning[];
}

const INDENT = 2;
const KIB = 1024;
const MIB = 1024 * KIB;

function sizeText(bytes: number, t: Translator): string {
  if (bytes >= MIB)
    return t('importHar.size.mb', { count: num(Math.round(bytes / MIB), t.locale) });
  return t('importHar.size.kb', { count: num(Math.max(1, Math.round(bytes / KIB)), t.locale) });
}

function summaryLine(data: ImportHarData, t: Translator): string {
  return t(data.reused ? 'importHar.summary.reused' : 'importHar.summary.sent', {
    size: sizeText(data.sizeBytes, t),
    requests: t.plural('common.requests', data.entries),
    filtered: t.plural('importHar.filtered', data.filtered),
  });
}

function authText(auth: ImportHarData['auth'], t: Translator): string {
  if (auth.detected === null) return t('importHar.auth.none');
  const key = `importHar.auth.${auth.detected}`;
  const kind = t.has(key) ? t(key) : t('importHar.auth.other', { kind: inline(auth.detected) });
  if (auth.endpoint === undefined) return kind;
  const endpoint = inline(`${auth.endpoint.method} ${auth.endpoint.path}`);
  return t('importHar.auth.from', { kind, endpoint });
}

function loginLine(data: ImportHarData, t: Translator): string {
  const { host, environment } = data.baseUrl;
  const address =
    environment === null
      ? inline(host)
      : t('importHar.address.default', { environment: inline(environment) });
  return t('importHar.login', { auth: authText(data.auth, t), address });
}

function pathLines(data: ImportHarData, t: Translator): string[] {
  const total = data.paths.length + data.morePaths;
  if (total === 0) return [t('importHar.paths.none')];
  const names = data.paths.map((path) => inline(path)).join(', ');
  const rest =
    data.morePaths > 0 ? `, ${t('importHar.more', { count: num(data.morePaths, t.locale) })}` : '';
  return wrap(`${t.plural('importHar.paths', total)}: ${names}${rest}`, VIEW_WIDTH, INDENT);
}

function named(
  count: number,
  key: string,
  names: readonly string[],
  more: number,
  t: Translator,
): string {
  const label = t.plural(key, count);
  if (names.length === 0) return label;
  return `${label} (${names.map((name) => inline(name)).join(', ')}${more > 0 ? ', …' : ''})`;
}

function correlationLines(data: ImportHarData, t: Translator): string[] {
  const { accepted, uncertain, moreUncertain, ambiguous, moreAmbiguous } = data.correlations;
  const parts = [
    ...(accepted > 0 ? [t.plural('importHar.corr.accepted', accepted)] : []),
    ...(uncertain.length + moreUncertain > 0
      ? [
          named(
            uncertain.length + moreUncertain,
            'importHar.corr.uncertain',
            uncertain.map((item) => item.variable),
            moreUncertain,
            t,
          ),
        ]
      : []),
    ...(ambiguous.length + moreAmbiguous > 0
      ? [
          named(
            ambiguous.length + moreAmbiguous,
            'importHar.corr.ambiguous',
            ambiguous.map((item) => item.variable),
            moreAmbiguous,
            t,
          ),
        ]
      : []),
  ];
  if (parts.length === 0) return [t('importHar.corr.none')];
  return wrap(t('importHar.corr.title', { parts: parts.join(' · ') }), VIEW_WIDTH, INDENT);
}

/** Values the backend put into a warning, each on one line; numbers stay numbers. */
function inlineParams(params: HarWarning['params']): Record<string, string | number> | undefined {
  if (params === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(params).map(([name, value]) => [
      name,
      typeof value === 'string' ? inline(value) : value,
    ]),
  );
}

function warningLines(warnings: readonly HarWarning[], t: Translator): string[] {
  return warnings.flatMap((warning) => {
    const key = `importHar.warning.${warning.kind}`;
    const text = t.has(key)
      ? t(key, inlineParams(warning.params))
      : t('importHar.warning.backend', { code: inline(warning.kind) });
    return wrap(`⚠ ${text}`, VIEW_WIDTH, INDENT);
  });
}

export function renderImportHar(data: ImportHarData, t: Translator): string {
  return [
    summaryLine(data, t),
    loginLine(data, t),
    ...pathLines(data, t),
    ...correlationLines(data, t),
    ...warningLines(data.warnings, t),
  ].join('\n');
}
