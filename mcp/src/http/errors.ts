// Catalog of backend error codes → a sentence for the model that says what happened and what to
// do next. Texts live in the dictionaries as `error.<code>.message` and `error.<code>.hint`; the
// table below only decides which codes have an entry and what the sentence needs from the error.

import { ToolError } from '../errors.js';
import type { TranslationParams, Translator } from '../context.js';
import { inline } from '../render/primitives.js';
import {
  codeForStatus,
  cutForLog,
  LoadcraftApiError,
  quotesBackendText,
  withheldCopy,
} from './apiError.js';
import type { Logger } from '../log.js';
import { SchemaError } from '../workspace/processState.js';

/** The backend text quoted for a code the catalog does not know, in characters. */
const UNKNOWN_MESSAGE_LIMIT = 300;
/** The backend code named for a code the catalog does not know, in characters. */
const CODE_LIMIT = 80;

/** Setup parts the backend can report as missing; each has a `error.setup_incomplete.part.<name>` text. */
const SETUP_PARTS: ReadonlySet<string> = new Set([
  'environments',
  'evidence',
  'analysis',
  'profile',
  'validators',
  'test_types',
]);

type Params = TranslationParams;

interface Entry {
  /** Suffix of the hint key; defaults to `hint`. */
  readonly hint?: (error: LoadcraftApiError) => string;
  readonly params?: (error: LoadcraftApiError, t: Translator) => Params;
}

function missingParts(error: LoadcraftApiError): string[] {
  const details = error.details;
  if (typeof details !== 'object' || details === null || !('missing' in details)) return [];
  const { missing } = details;
  return Array.isArray(missing)
    ? missing.filter((item): item is string => typeof item === 'string').map((item) => inline(item))
    : [];
}

/** `details.environment_name`, empty when the backend sent none. */
function environmentNameOf(error: LoadcraftApiError): string {
  const details = error.details;
  const name =
    typeof details === 'object' && details !== null && 'environment_name' in details
      ? details.environment_name
      : undefined;
  return typeof name === 'string' ? name : '';
}

function statusParams(error: LoadcraftApiError): Params {
  return { status: error.status };
}

/** `{detail}` is the backend's text; for a status whose text is not shown, a sentence says so. */
function detailParams(error: LoadcraftApiError, t: Translator): Params {
  return {
    status: error.status,
    detail: quotesBackendText(error.status)
      ? inline(error.message, UNKNOWN_MESSAGE_LIMIT)
      : t('error.detail.withheld'),
  };
}

/** `reasonKind` names the `error.backend_too_old.reason.<kind>` text that fills `{reason}`. */
function withReason(params: Params, t?: Translator): Params {
  const kind = params['reasonKind'];
  const reason =
    t !== undefined && typeof kind === 'string' && t.has(`error.backend_too_old.reason.${kind}`)
      ? t(`error.backend_too_old.reason.${kind}`, params)
      : 'no details';
  return { advice: '', ...params, reason };
}

const MIB = 1024 * 1024;

/** `details.limitBytes` as "32 MiB" (or "64 KiB" below one MiB). */
function limitLabel(error: LoadcraftApiError): string {
  const details = error.details;
  const bytes =
    typeof details === 'object' && details !== null && 'limitBytes' in details
      ? details.limitBytes
      : undefined;
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '?';
  if (bytes < MIB) return `${String(Math.round((bytes / 1024) * 10) / 10)} KiB`;
  return `${String(Math.round((bytes / MIB) * 10) / 10)} MiB`;
}

/** `details.method`, `path`, `status` and `host` of a redirect the client refused to follow. */
function redirectParams(error: LoadcraftApiError): Params {
  const details = error.details;
  const text = (key: string): string => {
    const value =
      typeof details === 'object' && details !== null && key in details
        ? (details as Record<string, unknown>)[key]
        : undefined;
    return typeof value === 'string' ? inline(value, CODE_LIMIT) : '';
  };
  const host = text('host');
  return {
    request: `${text('method')} ${text('path')}`.trim(),
    status: error.status,
    host: host === '' ? '?' : host,
  };
}

const CATALOG: Readonly<Record<string, Entry>> = {
  unauthorized: {},
  forbidden: {},
  // `{available}` is filled by the resolver's own not-found errors; a backend 404 has nothing to add.
  not_found: { params: () => ({ available: '' }) },
  setup_incomplete: {
    params: (error, t) => {
      const parts = missingParts(error).map((part) =>
        SETUP_PARTS.has(part) ? t(`error.setup_incomplete.part.${part}`) : part,
      );
      return { missing: parts.length > 0 ? parts.join(', ') : t('error.setup_incomplete.unknown') };
    },
  },
  agent_browsers_busy: {},
  protected_environment_requires_caps: {},
  protected_environment_requires_acknowledgement: {},
  protected_environment_requires_confirmation: {
    params: (error) => ({ environment: inline(environmentNameOf(error)) }),
  },
  workload_exceeds_environment_caps: { params: detailParams },
  spike_exceeds_environment_caps: { params: detailParams },
  no_default_environment: {},
  // a deletion of a project with a browser walk that is still working (409)
  run_not_finished: {},
  llm_generation_failed: {
    hint: (error) => (error.retryable ? 'hintRetryable' : 'hint'),
  },
  llm_not_configured: {},
  prompt_over_budget: {},
  timeout: {},
  bad_gateway: {},
  // Thrown by the backend with this code (no params) or by `compat.ts` (params, see fromDictionary).
  backend_too_old: { params: () => withReason({}) },
  network_error: {},
  unexpected_redirect: { params: redirectParams },
  response_too_large: { params: (error) => ({ limit: limitLabel(error) }) },
  invalid: { params: detailParams },
  conflict: { params: detailParams },
  rate_limited: { params: detailParams },
  server_error: { params: statusParams },
  unavailable: { params: statusParams },
  gateway_timeout: { params: statusParams },
};

function render(
  t: Translator,
  base: string,
  hintKey: string,
  params: Params | undefined,
): { message: string; hint: string } {
  return { message: t(`${base}.message`, params), hint: t(`${base}.${hintKey}`, params) };
}

function fromCatalog(error: LoadcraftApiError, t: Translator): ToolError | undefined {
  // The code comes from a response body: look only at own keys, never at Object.prototype.
  if (!Object.hasOwn(CATALOG, error.code)) return undefined;
  const entry = CATALOG[error.code];
  if (entry === undefined) return undefined;
  // Status 0 is the client's own refusal: no token is configured and nothing was sent.
  const noToken = error.code === 'unauthorized' && error.status === 0;
  const base = noToken ? 'error.unauthorized.noToken' : `error.${error.code}`;
  const params = entry.params?.(error, t);
  const hintKey = entry.hint?.(error) ?? 'hint';
  const text = render(t, base, hintKey, params);
  return new ToolError(error.code, {
    ...text,
    ...(error.details === undefined || !quotesBackendText(error.status)
      ? {}
      : { details: error.details }),
    cause: error,
  });
}

function unknownCode(error: LoadcraftApiError, t: Translator): ToolError {
  const params = { status: error.status, code: inline(error.code, CODE_LIMIT) };
  const message = quotesBackendText(error.status)
    ? t('error.unknown.message', {
        ...params,
        detail: inline(error.message, UNKNOWN_MESSAGE_LIMIT),
      })
    : t('error.unknown.withheld', params);
  return new ToolError(error.code, { message, hint: t('error.unknown.hint'), cause: error });
}

/** A `ToolError` thrown by the plugin itself: translated when the dictionary knows its code. */
/**
 * `rule` names the `error.<code>.rule.<rule>` text that fills `{reason}` (`invalid_arguments`: the
 * plugin's own refusal of arguments that do not fit together, in the language of the call).
 */
function withRule(base: string, params: Params | undefined, t: Translator): Params | undefined {
  const rule = params?.['rule'];
  if (typeof rule !== 'string' || !t.has(`${base}.rule.${rule}`)) return params;
  return { ...params, reason: t(`${base}.rule.${rule}`, params) };
}

function fromDictionary(error: ToolError, t: Translator): ToolError {
  const base = `error.${error.code}`;
  if (!t.has(`${base}.message`)) return error;
  const params =
    error.code === 'backend_too_old' && error.params !== undefined
      ? withReason(error.params, t)
      : withRule(base, error.params, t);
  // A hint for one argument (`error.missing_argument.hint.docs_id`) wins over the hint of the code.
  const name = error.params?.['name'];
  const own = typeof name === 'string' ? `${base}.hint.${name}` : undefined;
  const hint =
    own !== undefined && t.has(own)
      ? t(own, params)
      : t.has(`${base}.hint`)
        ? t(`${base}.hint`, params)
        : error.hint;
  return new ToolError(error.code, {
    message: t(`${base}.message`, params),
    ...(hint === undefined ? {} : { hint }),
    ...(error.details === undefined ? {} : { details: error.details }),
    cause: error,
  });
}

/** What the log and the dictionary of a call give to `withheldJobText`. */
interface JobTextContext {
  readonly log: Logger;
  readonly t: Translator;
}

/**
 * The text of a failed job of LoadCraft (the planning of the paths, the analysis of a project, the
 * generation of a flow, a test run) that an answer of success carries. It is treated like the text of
 * a 5xx: the model gets the code, the kind of failure and the hint, and the text goes to the log of
 * the call, cut short, where the secrets the call registered are masked. Returns the sentence that
 * stands in for the text, or undefined when the job gave none.
 */
export function withheldJobText(
  ctx: JobTextContext,
  source: string,
  text: string | null | undefined,
): string | undefined {
  if (text === null || text === undefined || text.trim() === '') return undefined;
  ctx.log.warn('backend error text', { source, text: cutForLog(text) });
  return ctx.t('error.jobText.withheld');
}

/**
 * The error the translation works from. For a status whose text is not shown (5xx, 401) it has no
 * `details` (so no catalog entry can read a field of the body into a sentence), and its code is one
 * the catalog knows or else the code of the status: a body cannot name its own code in the text.
 */
function forModel(error: LoadcraftApiError): LoadcraftApiError {
  if (quotesBackendText(error.status)) return error;
  return new LoadcraftApiError({
    status: error.status,
    code: Object.hasOwn(CATALOG, error.code) ? error.code : codeForStatus(error.status),
    message: error.message,
    retryable: error.retryable,
    ...(error.hint === undefined ? {} : { hint: error.hint }),
    cause: error,
  });
}

/** `withhold`: the call could not register every secret it read, so no backend text is shown. */
interface ShownOptions {
  readonly withhold?: boolean;
}

/**
 * The error a tool reports to the model, in the user's language. A backend refusal is looked up
 * by code; a plugin error by its own code; both fall back to their literal text when the
 * dictionary has no entry. Anything that is not a `ToolError` gets a sentence without its text.
 */
export function toToolError(error: unknown, t: Translator, options: ShownOptions = {}): ToolError {
  if (error instanceof LoadcraftApiError) {
    const shown = forModel(options.withhold === true ? withheldCopy(error) : error);
    return fromCatalog(shown, t) ?? unknownCode(shown, t);
  }
  if (error instanceof ToolError) return fromDictionary(error, t);
  // a rule of the state schema refused the call: the model sees its code and the text of the dictionary
  if (error instanceof SchemaError) {
    return fromDictionary(new ToolError(error.code, { cause: error }), t);
  }
  return new ToolError('internal_error', {
    message: t('error.internal_error.message'),
    hint: t('error.internal_error.hint'),
  });
}
