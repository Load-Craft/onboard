// Views of the project setup tools: the project `project_create` found or created, the
// environments `project_save_env` saved (role, limits, fixed headers, what LoadCraft kept other than
// requested), the connection test and conformance of `project_check_env`, the profile proposals of
// `project_analyze_setup`, and what `project_apply_setup` left (documentation, profile, validators
// and test types, the gate). Everything the model needs from a result is in its text.

import type { Translator } from '../../context.js';
import type { Caps, ProbeResult } from '../../api/environments.js';
import type { SetupStep } from '../../api/status.js';
import { bar, inline, VIEW_WIDTH, visibleWidth, wrap } from '../primitives.js';
import { uncertainLines, type UncertainField } from './projectProfile.js';

/** A field where the environment in LoadCraft differs from the request; LoadCraft keeps its value. */
export type EnvironmentDiff =
  | {
      readonly field: 'api' | 'frontend';
      readonly current: string | null;
      readonly requested: string;
    }
  | {
      readonly field: 'limit';
      /** Null: the environment is not protected. */
      readonly current: Caps | null;
      readonly requested: Caps | null;
    };

/**
 * Whether the default environment serves the operations of the documentation. `skipped`: the
 * environment is protected and is not probed; `failed`: the probe did not answer.
 */
export type EnvironmentConformance =
  | {
      readonly state: 'checked';
      /** GET operations the environment answers. */
      readonly exists: number;
      readonly missing: number;
      /** The first missing operations as `METHOD path`. */
      readonly missingPaths: readonly string[];
      /** Missing operations not named in `missingPaths`. */
      readonly missingMore: number;
      readonly inconclusive: number;
      /** Operations not probed because their method changes data. */
      readonly notProbedMethods: number;
      /** Operations not probed because their path has parameters. */
      readonly skippedParams: number;
      /** Operations not probed because their path names another host. */
      readonly offHost?: number;
      /** Names of the headers the probes carried; absent when the backend does not say. */
      readonly headersSent?: readonly string[];
      /** HTTP statuses of the inconclusive probes, the most frequent first. */
      readonly statuses?: readonly { readonly status: number; readonly count: number }[];
      /** How the report ended when it did not complete. */
      readonly reportStatus?: string;
    }
  | { readonly state: 'skipped' }
  | { readonly state: 'failed' };

/** The role and limits of an environment as LoadCraft stores it. */
interface EnvironmentRole {
  readonly name: string;
  readonly default: boolean;
  readonly protected: boolean;
  /** Load limits as stored in LoadCraft; absent when none is set. */
  readonly caps?: Caps;
}

/** An environment as `project_save_env` left it. */
export interface SavedEnvironment extends EnvironmentRole {
  /** Created by this call; false for an environment that was already there. */
  readonly created: boolean;
  /** The protection was set or tightened by this call to the requested limit. */
  readonly protectionSet?: boolean;
  /** Fixed headers requested for the environment: the header and the variable it comes from. */
  readonly headers?: readonly { readonly name: string; readonly variable: string }[];
  readonly differs?: readonly EnvironmentDiff[];
}

/** An environment as `project_check_env` found it. */
export interface CheckedEnvironment extends EnvironmentRole {
  readonly api: ProbeResult;
  readonly frontend?: ProbeResult;
  /** Only on the default environment, and only when the project has documentation. */
  readonly conformance?: EnvironmentConformance;
}

/** An environment line of a view: the role, and what the tool that draws it knows besides. */
type EnvironmentLine = EnvironmentRole &
  Partial<Pick<SavedEnvironment, 'headers'>> &
  Partial<Pick<CheckedEnvironment, 'conformance'>>;

/** A profile field the analysis proposed that a person should look at before relying on it. */
export interface ReviewField {
  /** Name of the profile field, e.g. `has_async_operations`. */
  readonly field: string;
  readonly value: unknown;
  /** Where the proposal comes from: `llm` when a model wrote it, else the first source of evidence. */
  readonly source: string;
}

/**
 * `analyzed`: the analysis ran in this call (or in the one `project_apply_setup` names); `kept`: it
 * had been done before and was left as it was; `none`: there was nothing to analyse (no
 * documentation and no description).
 */
export type SetupAnalysis = 'analyzed' | 'kept' | 'none';

/** The setup of the project as `project_apply_setup` leaves it. */
export interface SetupResult {
  /** The OpenAPI document the project has; null when it has none. */
  readonly docs: {
    readonly title: string;
    readonly operations: number;
    /** Areas of the API map; absent when LoadCraft has no map of the documentation. */
    readonly areas?: number;
  } | null;
  readonly analysis: SetupAnalysis;
  /** 100 once the project has been analysed (now or before), 0 when there was nothing to analyse. */
  readonly analysisPct: number;
  /** Profile fields the analysis proposed and this call applied; 0 otherwise. */
  readonly fieldsTotal: number;
  readonly needsReview: readonly ReviewField[];
  /** From the profile after this call; absent when the call did not touch the profile. */
  readonly auth?: { readonly method: string; readonly tokenEndpoint?: string };
  readonly profileApplied: boolean;
  readonly validators: number;
  readonly testTypes: number;
  /** Test types LoadCraft created for a person to look at. */
  readonly testTypesToReview: number;
  /** The setup gate lets flow generation through. */
  readonly complete: boolean;
  /** Unmet steps of the gate, in the gate's order. */
  readonly missing: readonly SetupStep[];
}

export interface ProjectRef {
  readonly id: string;
  readonly name: string;
}

/** The result of `project_create`. */
export interface ProjectCreateData {
  readonly project: ProjectRef & { readonly reused: boolean };
  /** One of the two is true: the project was created by this call, or an existing one adopted. */
  readonly created: boolean;
  readonly adopted: boolean;
  /** The environment a new project was created with (its default); absent for a reused project. */
  readonly environment?: string;
}

/** The result of `project_save_env`; the environments in the order of the request. */
export interface SaveEnvData {
  readonly environments: readonly SavedEnvironment[];
}

/** The result of `project_check_env`; the environments in the order LoadCraft lists them. */
export interface CheckEnvData {
  readonly environments: readonly CheckedEnvironment[];
}

/** The result of `project_analyze_setup`: what the analysis proposes, nothing applied yet. */
export interface AnalyzeSetupData {
  readonly analysis: SetupAnalysis;
  /** Profile fields the analysis proposed; 0 when it did not run in this call. */
  readonly fieldsTotal: number;
  readonly needsReview: readonly ReviewField[];
  /** Fields the analysis was unsure of (low confidence or a conflict); absent when it did not run. */
  readonly uncertain?: readonly UncertainField[];
  /** The handle of the analysis that ran, for `project_apply_setup`. */
  readonly operation?: string;
}

/** The result of `project_apply_setup`. */
export interface ApplySetupData {
  readonly project: ProjectRef;
  readonly setup: SetupResult;
  /** The conformance of the default environment against the documentation, when it was probed. */
  readonly conformance?: { readonly environment: string; readonly result: EnvironmentConformance };
  /** Profile fields still to settle with the user after this apply. */
  readonly unsure?: readonly string[];
}

const PROBE_STATUSES: ReadonlySet<string> = new Set([
  'ok',
  'blocked',
  'unreachable',
  'tls_error',
  'too_many_redirects',
]);

const INDENT = '  ';

const TITLE_LIMIT = 80;
const ENDPOINT_LIMIT = 80;
const ANALYSIS_BAR_WIDTH = 20;
/** Longest handle of an operation (`<kind>:<id>`) a view quotes. */
const HANDLE_LIMIT = 160;

const projectTitle = (name: string, t: Translator): string =>
  t('initProject.header.project', { name: inline(name, TITLE_LIMIT) });

/** The project and the documentation it has. */
function headerLine(name: string, docs: SetupResult['docs'], t: Translator): string {
  const parts = [
    projectTitle(name, t),
    docs === null
      ? t('initProject.header.noDocs')
      : [
          inline(docs.title, TITLE_LIMIT),
          t.plural('initProject.header.operations', docs.operations),
          ...(docs.areas === undefined || docs.areas === 0
            ? []
            : [t.plural('initProject.header.areas', docs.areas)]),
        ].join(' · '),
  ];
  return parts.join(' · ');
}

const AUTH_METHODS: ReadonlySet<string> = new Set([
  'bearer_jwt',
  'session_cookie',
  'oauth2_code',
  'oauth2_pkce',
  'api_key',
  'basic',
  'saml',
  'none',
]);

function loginText(auth: NonNullable<SetupResult['auth']>, t: Translator): string {
  const method = AUTH_METHODS.has(auth.method)
    ? t(`initProject.auth.${auth.method}`)
    : inline(auth.method, ENDPOINT_LIMIT);
  if (auth.tokenEndpoint === undefined) return method;
  const endpoint = inline(auth.tokenEndpoint, ENDPOINT_LIMIT);
  return auth.method === 'bearer_jwt'
    ? t('initProject.auth.tokenFrom', { endpoint })
    : t('initProject.auth.methodAt', { method, endpoint });
}

/** The analysis, the profile and what LoadCraft provisioned; empty lines are left out. */
function setupLines(setup: SetupResult, t: Translator): string[] {
  if (setup.analysis === 'none') return [t('initProject.analysis.none')];
  const lines = [
    `${t('initProject.analysis.label')}  ${bar(setup.analysisPct / 100, ANALYSIS_BAR_WIDTH)} ${String(setup.analysisPct)}%`,
  ];
  if (setup.analysis === 'analyzed') {
    const fields = t.plural('initProject.profile.fields', setup.fieldsTotal);
    const review =
      setup.needsReview.length === 0
        ? ''
        : `, ${t.plural('initProject.profile.toReview', setup.needsReview.length)}`;
    const login =
      setup.auth === undefined
        ? ''
        : ` · ${t('initProject.auth.label', { login: loginText(setup.auth, t) })}`;
    lines.push(
      ...wrap(`${t('initProject.profile.line', { fields })}${review}${login}`, VIEW_WIDTH, 2),
    );
  }
  const applied = setup.profileApplied
    ? t('initProject.profile.applied')
    : t('initProject.profile.notApplied');
  const testTypes = `${t('initProject.provision.testTypes', { count: setup.testTypes })}${
    setup.testTypesToReview > 0 ? ` ${t('initProject.provision.toReview')}` : ''
  }`;
  lines.push(
    ...wrap(
      [applied, t('initProject.provision.validators', { count: setup.validators }), testTypes].join(
        ' · ',
      ),
      VIEW_WIDTH,
      2,
    ),
  );
  if (!setup.complete && setup.missing.length > 0) {
    const missing = setup.missing
      .map((step) => t(`error.setup_incomplete.part.${step}`))
      .join(', ');
    lines.push(...wrap(t('status.setup.incomplete', { missing }), VIEW_WIDTH, 2));
  }
  return lines;
}

const reached = (item: CheckedEnvironment): boolean =>
  item.api.status === 'ok' && (item.frontend === undefined || item.frontend.status === 'ok');

function probeText(part: 'api' | 'frontend', probe: ProbeResult, t: Translator): string {
  const status = PROBE_STATUSES.has(probe.status)
    ? t(`initProject.status.${probe.status}`)
    : t('initProject.status.other', { status: inline(probe.status) });
  return t(`initProject.probe.${part}`, { status });
}

function connectionLines(environments: readonly CheckedEnvironment[], t: Translator): string[] {
  const ok = environments.filter(reached);
  const lines: string[] = [];
  if (ok.length > 0) {
    const names = ok.map((item) => inline(item.name)).join(', ');
    const withFrontend = ok.filter((item) => item.frontend !== undefined).length;
    const scope =
      withFrontend === ok.length
        ? ` ${t('initProject.connection.both')}`
        : withFrontend === 0
          ? ` ${t('initProject.connection.apiOnly')}`
          : '';
    lines.push(...wrap(`${t('initProject.connection.ok', { names })}${scope}`, VIEW_WIDTH, 2));
  }
  for (const item of environments.filter((environment) => !reached(environment))) {
    const parts = [
      probeText('api', item.api, t),
      ...(item.frontend === undefined ? [] : [probeText('frontend', item.frontend, t)]),
    ];
    const text = t('initProject.connection.problem', {
      name: inline(item.name),
      parts: parts.join(' · '),
    });
    lines.push(...wrap(text, VIEW_WIDTH, 2));
  }
  if (environments.some((environment) => !reached(environment))) {
    lines.push(...wrap(t('initProject.connection.next'), VIEW_WIDTH, 2));
  }
  return lines;
}

/** `100 users / 20 requests/s`; undefined when no limit is set. */
function capsParts(caps: Caps | undefined, t: Translator): string | undefined {
  const parts = [
    ...(caps?.maxVu === undefined ? [] : [t.plural('status.env.capUsers', caps.maxVu)]),
    ...(caps?.maxRps === undefined ? [] : [t.plural('status.env.capRps', caps.maxRps)]),
  ];
  return parts.length === 0 ? undefined : parts.join(' / ');
}

function capsText(caps: Caps | undefined, t: Translator): string | undefined {
  const parts = capsParts(caps, t);
  return parts === undefined ? undefined : t('status.env.caps', { caps: parts });
}

/** Statuses that say the request lacked what the target wants: a header, a key or a login. */
const REQUEST_REFUSED = new Set([400, 401, 403]);

/** Header names a line quotes. */
const HEADERS_SHOWN = 8;

/** `x-api-key, Accept`, then how many more. */
function headerNames(names: readonly string[], t: Translator): string {
  const shown = names.slice(0, HEADERS_SHOWN).map((name) => inline(name, 60));
  const rest = names.length - shown.length;
  return rest > 0 ? t('oldDocs.more', { names: shown.join(', '), count: rest }) : shown.join(', ');
}

/** Whether most of the probes that were sent got a status that points at the fixed headers. */
function headerHint(conformance: Extract<EnvironmentConformance, { state: 'checked' }>): boolean {
  const refused = (conformance.statuses ?? [])
    .filter((item) => REQUEST_REFUSED.has(item.status))
    .reduce((sum, item) => sum + item.count, 0);
  const sent = conformance.exists + conformance.missing + conformance.inconclusive;
  return refused * 2 > sent;
}

/** `conformance: 19 GET ✓ · 24 unchecked (non-GET)`; the sentence for a skipped or failed check. */
export function conformanceText(conformance: EnvironmentConformance, t: Translator): string {
  if (conformance.state === 'skipped') return t('initProject.conformance.skipped');
  if (conformance.state === 'failed') return t('initProject.conformance.failed');
  const parts: string[] = [];
  if (conformance.exists > 0) {
    parts.push(t('initProject.conformance.exists', { count: conformance.exists }));
  }
  if (conformance.missing > 0) {
    const named = conformance.missingPaths.map((path) => inline(path, ENDPOINT_LIMIT));
    const more =
      conformance.missingMore > 0
        ? [t('initProject.conformance.more', { count: conformance.missingMore })]
        : [];
    parts.push(
      t('initProject.conformance.missing', {
        count: conformance.missing,
        paths: [...named, ...more].join(', '),
      }),
    );
  }
  const statuses = conformance.statuses ?? [];
  if (conformance.inconclusive > 0) {
    parts.push(
      statuses.length === 0
        ? t('initProject.conformance.inconclusive', { count: conformance.inconclusive })
        : t('initProject.conformance.inconclusiveStatuses', {
            count: conformance.inconclusive,
            statuses: statuses
              .map((item) => `${String(item.status)} ×${String(item.count)}`)
              .join(', '),
          }),
    );
  }
  const offHost = conformance.offHost ?? 0;
  const unchecked = conformance.notProbedMethods + conformance.skippedParams + offHost;
  if (unchecked > 0) {
    const reasons = [
      ...(conformance.notProbedMethods > 0 ? [t('initProject.conformance.reason.methods')] : []),
      ...(conformance.skippedParams > 0 ? [t('initProject.conformance.reason.params')] : []),
      ...(offHost > 0 ? [t('initProject.conformance.reason.offHost')] : []),
    ].join(', ');
    parts.push(t('initProject.conformance.unchecked', { count: unchecked, reasons }));
  }
  const sent = conformance.headersSent;
  if (sent !== undefined && sent.length > 0) {
    parts.push(t('initProject.conformance.headersSent', { names: headerNames(sent, t) }));
  }
  if (conformance.reportStatus !== undefined) {
    parts.push(
      t('initProject.conformance.reportStatus', { status: inline(conformance.reportStatus) }),
    );
  }
  const label = t('initProject.conformance.label', { parts: parts.join(' · ') });
  if (!headerHint(conformance)) return label;
  // the hint says what the probe sent: fixed headers that did not help, or none at all
  const hint =
    sent === undefined
      ? t('initProject.conformance.headersHint')
      : sent.length === 0
        ? t('initProject.conformance.headersHintNone')
        : t('initProject.conformance.headersHintSent', { names: headerNames(sent, t) });
  return `${label}. ${hint}`;
}

function environmentNotes(item: EnvironmentLine, t: Translator): string {
  const notes: string[] = [];
  if (item.default) notes.push(t('status.env.default'));
  if (item.protected) notes.push(t('status.env.protected'));
  const caps = capsText(item.caps, t);
  if (caps !== undefined) notes.push(caps);
  else if (item.protected) notes.push(t('status.env.protectedNoCaps'));
  else if (!item.default) notes.push(t('status.env.noCaps'));
  if (item.headers !== undefined && item.headers.length > 0) {
    const list = item.headers
      .map((header) =>
        t('initProject.headers.item', {
          name: inline(header.name, ENDPOINT_LIMIT),
          variable: inline(header.variable, ENDPOINT_LIMIT),
        }),
      )
      .join(', ');
    notes.push(t('initProject.headers', { list }));
  }
  if (item.conformance !== undefined) notes.push(conformanceText(item.conformance, t));
  return notes.join(' · ');
}

/** `name ★  notes`, names in one column; long notes continue under the notes column. */
function environmentLines(environments: readonly EnvironmentLine[], t: Translator): string[] {
  const labels = environments.map((item) =>
    item.default ? `${inline(item.name)} ★` : inline(item.name),
  );
  const width = Math.max(...labels.map(visibleWidth));
  const lead = width + INDENT.length;
  return environments.flatMap((item, index) => {
    const label = labels[index] ?? '';
    const [first = '', ...rest] = wrap(environmentNotes(item, t), VIEW_WIDTH - lead);
    const padding = ' '.repeat(width - visibleWidth(label));
    return [
      `${label}${padding}${INDENT}${first}`.trimEnd(),
      ...rest.map((line) => ' '.repeat(lead) + line),
    ];
  });
}

const REVIEW_VALUE_LIMIT = 80;

/** A proposed value as one line: text as it is, anything else as JSON. */
function valueText(value: unknown): string {
  return typeof value === 'string'
    ? inline(value, REVIEW_VALUE_LIMIT)
    : inline(JSON.stringify(value) ?? '', REVIEW_VALUE_LIMIT);
}

/** One line per profile field the analysis proposed that a person should confirm. */
function reviewLines(setup: Pick<SetupResult, 'needsReview'>, t: Translator): string[] {
  if (setup.needsReview.length === 0) return [];
  return [
    t('initProject.review.heading'),
    ...setup.needsReview.map((item) => {
      const source =
        item.source === 'llm' ? t('initProject.review.model') : inline(item.source, ENDPOINT_LIMIT);
      return `${INDENT}${inline(item.field, ENDPOINT_LIMIT)}: ${valueText(item.value)} (${source})`;
    }),
  ];
}

const limitText = (caps: Caps | null, t: Translator): string =>
  capsParts(caps ?? undefined, t) ?? t('status.env.noCaps');

function diffValues(diff: EnvironmentDiff, t: Translator): { current: string; requested: string } {
  if (diff.field === 'limit') {
    return { current: limitText(diff.current, t), requested: limitText(diff.requested, t) };
  }
  return {
    current:
      diff.current === null ? t('initProject.env.none') : inline(diff.current, ENDPOINT_LIMIT),
    requested: inline(diff.requested, ENDPOINT_LIMIT),
  };
}

/** The limits the request sets higher than the stored ones, as `max_vu 200, max_rps 40`. */
function looserParts(current: Caps, requested: Caps | null): string {
  const parts: string[] = [];
  if (
    requested?.maxVu !== undefined &&
    current.maxVu !== undefined &&
    requested.maxVu > current.maxVu
  ) {
    parts.push(`max_vu ${requested.maxVu}`);
  }
  if (
    requested?.maxRps !== undefined &&
    current.maxRps !== undefined &&
    requested.maxRps > current.maxRps
  ) {
    parts.push(`max_rps ${requested.maxRps}`);
  }
  return parts.join(', ');
}

/** One line per environment whose protection this call set, with the limit now in force. */
function protectionLines(environments: readonly SavedEnvironment[], t: Translator): string[] {
  return environments
    .filter((item) => item.protectionSet === true)
    .map((item) =>
      t('initProject.env.protectionSet', {
        name: inline(item.name),
        limit: limitText(item.caps ?? null, t),
      }),
    );
}

/**
 * One warning per field where LoadCraft keeps a value other than the one requested. A protection
 * the request would loosen is kept, and the line says where a person removes it.
 */
function differenceLines(environments: readonly SavedEnvironment[], t: Translator): string[] {
  return environments.flatMap((item) =>
    (item.differs ?? []).flatMap((diff) => {
      const { current, requested } = diffValues(diff, t);
      if (diff.field === 'limit' && diff.current !== null) {
        return wrap(
          t(
            diff.requested === null
              ? 'initProject.env.protectionKeptNoLimit'
              : 'initProject.env.protectionKept',
            { name: inline(item.name), current, parts: looserParts(diff.current, diff.requested) },
          ),
          VIEW_WIDTH,
          2,
        );
      }
      return wrap(
        t('initProject.env.differs', {
          name: inline(item.name),
          field: t(`initProject.field.${diff.field}`),
          current,
          requested,
        }),
        VIEW_WIDTH,
        2,
      );
    }),
  );
}

export function renderProjectCreate(data: ProjectCreateData, t: Translator): string {
  return [
    projectTitle(data.project.name, t),
    ...(data.project.reused ? [t('initProject.header.reused')] : []),
  ].join(' · ');
}

export function renderSaveEnv(data: SaveEnvData, t: Translator): string {
  return [
    ...environmentLines(data.environments, t),
    ...protectionLines(data.environments, t),
    ...differenceLines(data.environments, t),
  ].join('\n');
}

export function renderCheckEnv(data: CheckEnvData, t: Translator): string {
  const checked = data.environments.filter((item) => item.conformance !== undefined);
  return [...connectionLines(data.environments, t), ...environmentLines(checked, t)].join('\n');
}

/** The analysis and its proposals; the next step names the handle `project_apply_setup` takes. */
export function renderAnalyzeSetup(data: AnalyzeSetupData, t: Translator): string {
  if (data.analysis === 'none') {
    return [
      t('initProject.analysis.none'),
      ...wrap(t('projectSetup.analysis.nextWithout'), VIEW_WIDTH, 2),
    ].join('\n');
  }
  const lines = [`${t('initProject.analysis.label')}  ${bar(1, ANALYSIS_BAR_WIDTH)} 100%`];
  if (data.analysis === 'analyzed') {
    const fields = t.plural('initProject.profile.fields', data.fieldsTotal);
    const review =
      data.needsReview.length === 0
        ? ''
        : `, ${t.plural('initProject.profile.toReview', data.needsReview.length)}`;
    lines.push(
      ...wrap(`${t('projectSetup.analysis.proposed', { fields })}${review}`, VIEW_WIDTH, 2),
      ...uncertainLines(data.uncertain ?? [], t),
    );
  }
  lines.push(
    ...wrap(
      data.operation === undefined
        ? t('projectSetup.analysis.nextWithout')
        : t('projectSetup.analysis.next', { operation: inline(data.operation, HANDLE_LIMIT) }),
      VIEW_WIDTH,
      2,
    ),
  );
  return lines.join('\n');
}

export function renderApplySetup(data: ApplySetupData, t: Translator): string {
  const checked = data.conformance;
  return [
    headerLine(data.project.name, data.setup.docs, t),
    ...setupLines(data.setup, t),
    ...(checked === undefined
      ? []
      : wrap(
          `${inline(checked.environment)} ★${INDENT}${conformanceText(checked.result, t)}`,
          VIEW_WIDTH,
          2,
        )),
    ...reviewLines(data.setup, t),
    ...(data.unsure === undefined || data.unsure.length === 0
      ? []
      : wrap(
          t('projectProfile.stillUncertain', { fields: inline(data.unsure.join(', '), 400) }),
          VIEW_WIDTH,
          2,
        )),
  ].join('\n');
}
