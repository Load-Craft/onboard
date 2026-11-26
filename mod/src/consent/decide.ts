/**
 * The consent of the user before a LoadCraft tool with an effect outside the editor: a load test,
 * accounts created in the tested system, a browser signing in with an account, a stopped test.
 * Pure functions, no `$`: register.ts reads the facts, asks, and acts on the verdict.
 *
 * 1. `consentPlan`: is this call one to guard, and what must be read first (`process_get_status`, the
 *    read-only call meant for the mod: `preflight` for run_start, `operation` for process_cancel).
 * 2. `readFacts`: the facts from that answer and the call; none when the server did not give
 *    them, and then the mod steps aside and the server's own guard holds.
 * 3. `decide`: pass, or ask with the numbers. A consent the user gave for the same facts less than
 *    ten minutes ago lets one repeat through (the model repeats a call with `confirm_capped` or
 *    `confirm_protected` after the server asked for it).
 * 4. `settle`: only the exact yes label is a yes; a closed dialog is a no while someone could
 *    answer, and nothing at all when nobody can (`claude -p`).
 *
 * Nothing here changes the arguments of a call or approves anything for Claude Code.
 */

import { hasConsent, type Ledger } from './ledger.js';
import {
  DECLINED_CODE,
  denial,
  wording,
  type CancelFacts,
  type ConsentFacts,
  type DescribeFlowsFacts,
  type LoadProfile,
  type ProvisionAccountsFacts,
  type RunStartFacts,
} from './texts.js';
import type { Locale } from '../../../mcp/src/render/primitives.js';

export type { ConsentFacts } from './texts.js';
export { DECLINED_CODE };

/** The tools whose calls wait for the user's consent, by their short names. */
export const CONSENT_TOOLS = [
  'run_start',
  'data_create_accounts',
  'flows_describe_journeys',
  'process_cancel',
] as const;
export type ConsentTool = (typeof CONSENT_TOOLS)[number];

/** Phases after which an operation runs no more: stopping it stops nothing. */
const ENDED = new Set(['completed', 'failed', 'cancelled', 'abandoned']);

/** One call to guard: the tool, the arguments that matter, and the `process_get_status` read it needs. */
export interface ConsentPlan {
  readonly tool: ConsentTool;
  readonly call: Readonly<Record<string, unknown>>;
  /** Arguments of the `process_get_status` call that gives the facts; absent when the call has them all. */
  readonly read?: Readonly<Record<string, unknown>>;
}

export interface Question {
  readonly tool: ConsentTool;
  /** The facts asked about, as one string: the ledger's key. */
  readonly key: string;
  readonly text: string;
  /** 2 options; the yes is the first. */
  readonly options: readonly [string, string];
  readonly yes: string;
  /** What the model reads after a no. */
  readonly denial: string;
  /** Keep the yes for a repeat of the call: the server will ask for the consent again. */
  readonly remember: boolean;
}

export type Decision =
  | { readonly pass: true; readonly consume?: { readonly tool: ConsentTool; readonly key: string } }
  | { readonly ask: Question };

/** How the dialog ended: an answer, or a dismissal (closed, "Chat about this", nobody to ask). */
export type Outcome =
  { readonly answer: string } | { readonly dismissed: true; readonly surfaces: number };

/** `allow`: the user said yes. `deny`: refuse the call. `pass`: nobody could answer, step aside. */
export type Verdict = 'allow' | 'deny' | 'pass';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const isTool = (tool: string | undefined): tool is ConsentTool =>
  (CONSENT_TOOLS as readonly (string | undefined)[]).includes(tool);

function withProject(call: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const project = text(call['project']);
  return project === undefined ? {} : { project };
}

/** What to read before deciding on this call; `undefined` when the call needs no consent. */
export function consentPlan(
  tool: string | undefined,
  call: Readonly<Record<string, unknown>>,
): ConsentPlan | undefined {
  if (!isTool(tool)) return undefined;
  switch (tool) {
    case 'run_start': {
      const scenario = text(call['scenario']);
      const environment = text(call['environment']);
      const profile = call['profile'];
      // A call the server would refuse for its shape is left to the server.
      if (scenario === undefined || environment === undefined || !isRecord(profile)) {
        return undefined;
      }
      return {
        tool,
        call,
        read: {
          preflight: { scenario, environment, profile },
          ...withProject(call),
          format: 'data',
        },
      };
    }
    case 'data_create_accounts': {
      // The only tool that creates accounts; the other data tools (plan, file of accounts,
      // datasets, bindings) do not. The names are those of the tool's input, which refuses any other spelling of them.
      if (text(call['slot']) === undefined || count(call['count']) === undefined) return undefined;
      return { tool, call, read: { ...withProject(call), format: 'data' } };
    }
    case 'flows_describe_journeys': {
      // The fields follow the tool's planned input (account.from_env, email_key, password_key);
      // when the tool ships, the contract test of its input schema must keep these names in step
      // with this check.
      const account = call['account'];
      if (!isRecord(account) || text(account['from_env']) === undefined) return undefined;
      return { tool, call };
    }
    case 'process_cancel': {
      const operation = text(call['operation']);
      if (operation === undefined) return undefined;
      return { tool, call, read: { operation, format: 'data' } };
    }
  }
}

function asProfile(value: unknown): LoadProfile | undefined {
  if (!isRecord(value)) return undefined;
  const type = text(value['type']);
  const vusers = count(value['vusers']);
  if (type === undefined || vusers === undefined) return undefined;
  const ramp = count(value['ramp']);
  const hold = count(value['hold']);
  return {
    type,
    vusers,
    ...(ramp === undefined ? {} : { ramp }),
    ...(hold === undefined ? {} : { hold }),
  };
}

const orNull = (value: number | undefined): number | null => value ?? null;

function runStartFacts(plan: ConsentPlan, data: unknown): RunStartFacts | undefined {
  if (!isRecord(data) || data['dry_run'] !== true) return undefined;
  const target = isRecord(data['target']) ? text(data['target']['name']) : undefined;
  const environment = data['environment'];
  if (target === undefined || !isRecord(environment)) return undefined;
  const environmentName = text(environment['name']);
  const isProtected = environment['protected'];
  const label = typeof data['profile_label'] === 'string' ? data['profile_label'] : undefined;
  const requested = asProfile(data['profile_requested']);
  const effective = asProfile(data['profile_effective']);
  const capped = data['capped'];
  const consentRequired = data['consent_required'];
  const facts = isRecord(data['data']) ? data['data'] : {};
  if (
    environmentName === undefined ||
    typeof isProtected !== 'boolean' ||
    label === undefined ||
    requested === undefined ||
    effective === undefined ||
    typeof capped !== 'boolean' ||
    typeof consentRequired !== 'boolean'
  ) {
    return undefined;
  }
  return {
    tool: 'run_start',
    project: text(plan.call['project']) ?? '',
    target,
    environment: environmentName,
    protected: isProtected,
    label,
    requested,
    effective,
    capped,
    consentRequired,
    needed: orNull(count(facts['needed'])),
    available: orNull(count(facts['available'])),
    plannedS: orNull(count(data['planned_s'])),
    confirmed: plan.call['confirm_capped'] === true,
  };
}

interface KnownEnvironment {
  readonly name: string;
  readonly isDefault: boolean;
  readonly protected: boolean;
}

/** The environments the status lists, when it lists them. */
function environmentsOf(data: unknown): KnownEnvironment[] {
  if (!isRecord(data) || !Array.isArray(data['environments'])) return [];
  return (data['environments'] as unknown[]).flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = text(item['name']);
    if (name === undefined || typeof item['protected'] !== 'boolean') return [];
    return [{ name, isDefault: item['isDefault'] === true, protected: item['protected'] }];
  });
}

function provisionAccountsFacts(
  plan: ConsentPlan,
  data: unknown,
): ProvisionAccountsFacts | undefined {
  const slot = text(plan.call['slot']);
  const accounts = count(plan.call['count']);
  if (slot === undefined || accounts === undefined) return undefined;
  const named = text(plan.call['environment']) ?? null;
  // The numbers are the call's own; the status only says whether the environment is protected.
  const known = environmentsOf(data);
  const fallback = known.find((item) => item.isDefault);
  const aimed =
    named === null
      ? fallback
      : (known.find((item) => item.name === named) ??
        known.find((item) => item.name.toLowerCase() === named.toLowerCase()));
  return {
    tool: 'data_create_accounts',
    project: text(plan.call['project']) ?? '',
    scenario: text(plan.call['scenario']) ?? '',
    slot,
    count: accounts,
    environment: named,
    defaultEnvironment: fallback?.name ?? null,
    protected: aimed?.protected ?? null,
    confirmed: plan.call['confirm_protected'] === true,
  };
}

function describeFlowsFacts(plan: ConsentPlan): DescribeFlowsFacts | undefined {
  const account = plan.call['account'];
  if (!isRecord(account)) return undefined;
  const fromEnv = text(account['from_env']);
  if (fromEnv === undefined) return undefined;
  return {
    tool: 'flows_describe_journeys',
    project: text(plan.call['project']) ?? '',
    environment: text(plan.call['environment']) ?? null,
    fromEnv,
    emailKey: text(account['email_key']) ?? null,
    passwordKey: text(account['password_key']) ?? null,
  };
}

function cancelFacts(plan: ConsentPlan, data: unknown): CancelFacts | undefined {
  if (!isRecord(data)) return undefined;
  const operation = text(data['operation']);
  const kind = text(data['kind']);
  const elapsed = count(data['elapsed_s']);
  // A snapshot of another operation is no fact about this one.
  if (operation === undefined || operation !== plan.call['operation']) return undefined;
  if (kind === undefined || elapsed === undefined) return undefined;
  return {
    tool: 'process_cancel',
    operation,
    kind,
    phase: text(data['phase']) ?? null,
    elapsedS: elapsed,
    loadElapsedS: orNull(count(data['load_elapsed_s'])),
    plannedS: orNull(count(data['planned_s'])),
  };
}

/**
 * The facts of the guarded call, from the call and the parsed answer of the `process_get_status` read
 * (`undefined` when there was none, or it failed). `undefined`: the facts are not there, so no
 * question can carry them.
 */
export function readFacts(plan: ConsentPlan, data: unknown): ConsentFacts | undefined {
  switch (plan.tool) {
    case 'run_start':
      return runStartFacts(plan, data);
    case 'data_create_accounts':
      return provisionAccountsFacts(plan, data);
    case 'flows_describe_journeys':
      return describeFlowsFacts(plan);
    case 'process_cancel':
      return cancelFacts(plan, data);
  }
}

/**
 * The facts a consent covers, as one string. A repeat of the call with other facts (another
 * environment, another effective profile, another number of accounts) is asked about again.
 */
export function consentKey(facts: ConsentFacts): string {
  switch (facts.tool) {
    case 'run_start':
      return JSON.stringify([
        facts.project,
        facts.target,
        facts.environment,
        facts.protected,
        facts.capped,
        facts.effective,
      ]);
    case 'data_create_accounts':
      return JSON.stringify([
        facts.project,
        facts.scenario,
        facts.environment,
        facts.slot,
        facts.count,
      ]);
    case 'flows_describe_journeys':
      return JSON.stringify([
        facts.project,
        facts.environment,
        facts.fromEnv,
        facts.emailKey,
        facts.passwordKey,
      ]);
    case 'process_cancel':
      return JSON.stringify([facts.operation]);
  }
}

/** Whether the server will answer this call with a request for consent, so the call comes again. */
function repeatExpected(facts: ConsentFacts): boolean {
  switch (facts.tool) {
    case 'run_start':
      // The server asks exactly when the preflight says consent is required.
      return facts.consentRequired && !facts.confirmed;
    case 'data_create_accounts':
      // An environment known not to be protected gets its accounts at once.
      return facts.protected !== false && !facts.confirmed;
    case 'flows_describe_journeys':
    case 'process_cancel':
      return false;
  }
}

function needsQuestion(facts: ConsentFacts): boolean {
  switch (facts.tool) {
    case 'run_start':
      // Claude Code asks before every run_start anyway; the mod asks only when it has numbers
      // that dialog does not show: a protected environment or a clamped profile.
      return facts.consentRequired;
    case 'process_cancel':
      return facts.phase === null || !ENDED.has(facts.phase);
    case 'data_create_accounts':
    case 'flows_describe_journeys':
      return true;
  }
}

/** Pass the call on, or ask the user with the numbers. */
export function decide(facts: ConsentFacts, ledger: Ledger, now: number, locale: Locale): Decision {
  if (!needsQuestion(facts)) return { pass: true };
  const key = consentKey(facts);
  if (hasConsent(ledger, facts.tool, key, now)) {
    return { pass: true, consume: { tool: facts.tool, key } };
  }
  const { text: question, options } = wording(facts, locale);
  return {
    ask: {
      tool: facts.tool,
      key,
      text: question,
      options,
      yes: options[0],
      denial: denial(facts),
      remember: repeatExpected(facts),
    },
  };
}

/** What the end of the dialog means for the call. */
export function settle(question: Question, outcome: Outcome): Verdict {
  if ('answer' in outcome) return outcome.answer === question.yes ? 'allow' : 'deny';
  return outcome.surfaces === 0 ? 'pass' : 'deny';
}
