/**
 * What the user reads in the consent dialog (in the plugin's language) and what the model reads
 * when the user says no (always English, like every tool result). Pure: facts in, text out.
 *
 * Numbers and times are written the way the server's views write them (`num` and `clock` of
 * mcp/src/render/primitives.ts: `2,000` / `2 000`, `10:00`), and every name that came from the
 * server or the model passes through `inline`, so it cannot break the line or carry control marks.
 * The two languages share one dictionary shape (`Words`): a key missing in one of them does not
 * compile.
 */

import { clock, inline, num, type Locale } from '../../../mcp/src/render/primitives.js';

/** The code a refusal starts with, as the server's error results start with theirs. */
export const DECLINED_CODE = 'user_declined';

/** The chip beside the question in the dialog (12 characters at most). */
export const QUESTION_HEADER = 'LoadCraft';

const NAME_LIMIT = 80;
const HANDLE_LIMIT = 140;

/** A load profile, as `run_start` and the preflight carry it. */
export interface LoadProfile {
  readonly type: string;
  readonly vusers: number;
  readonly ramp?: number;
  readonly hold?: number;
}

/** A test about to start: the preflight of the server for the arguments of the call. */
export interface RunStartFacts {
  readonly tool: 'run_start';
  readonly project: string;
  readonly target: string;
  readonly environment: string;
  readonly protected: boolean;
  readonly label: string;
  readonly requested: LoadProfile;
  readonly effective: LoadProfile;
  readonly capped: boolean;
  readonly consentRequired: boolean;
  /** Rows needed and rows there are, of the slot with the least to spare. */
  readonly needed: number | null;
  readonly available: number | null;
  readonly plannedS: number | null;
  /** The call already carries `confirm_capped: true`. */
  readonly confirmed: boolean;
}

/** Accounts about to be created in the tested system (`data_create_accounts`): the arguments of the call. */
export interface ProvisionAccountsFacts {
  readonly tool: 'data_create_accounts';
  readonly project: string;
  readonly scenario: string;
  readonly slot: string;
  readonly count: number;
  /** The environment the call names; null for the default one. */
  readonly environment: string | null;
  /** The default environment, when the status named it. */
  readonly defaultEnvironment: string | null;
  /** Whether the environment the accounts go to is protected; null when unknown. */
  readonly protected: boolean | null;
  /** The call already carries `confirm_protected: true`. */
  readonly confirmed: boolean;
}

/** The browser agent about to sign in with an account: the arguments of the call. */
export interface DescribeFlowsFacts {
  readonly tool: 'flows_describe_journeys';
  readonly project: string;
  readonly environment: string | null;
  readonly fromEnv: string;
  readonly emailKey: string | null;
  readonly passwordKey: string | null;
}

/** An operation about to be stopped: one snapshot of it. */
export interface CancelFacts {
  readonly tool: 'process_cancel';
  readonly operation: string;
  readonly kind: string;
  readonly phase: string | null;
  readonly elapsedS: number;
  readonly loadElapsedS: number | null;
  readonly plannedS: number | null;
}

export type ConsentFacts =
  RunStartFacts | ProvisionAccountsFacts | DescribeFlowsFacts | CancelFacts;

/** The question, its options (the yes first), and the yes label. */
export interface Wording {
  readonly text: string;
  readonly options: readonly [string, string];
}

/** Profiles whose `vusers` is an arrival rate, as the server's view counts them
 * (mcp/src/render/views/run.ts, `RATE_TYPES`). */
const RATE_TYPES: ReadonlySet<string> = new Set(['constant', 'stress']);

interface Words {
  readonly users: (count: number) => string;
  readonly rate: (value: string) => string;
  readonly accounts: (count: number) => string;
  readonly runStart: (p: {
    target: string;
    environment: string;
    isProtected: boolean;
    load: string;
    planned: string | null;
    data: string | null;
  }) => string;
  readonly clamped: (requested: string, effective: string) => string;
  readonly planned: (time: string) => string;
  readonly data: (available: string, sign: string, needed: string) => string;
  readonly runOptions: (capped: boolean) => readonly [string, string];
  readonly provision: (p: { accounts: string; slot: string; where: string }) => string;
  readonly namedEnvironment: (name: string, isProtected: boolean | null) => string;
  readonly defaultEnvironment: (name: string | null, isProtected: boolean | null) => string;
  readonly provisionOptions: readonly [string, string];
  readonly signIn: (p: { where: string; account: string }) => string;
  readonly signInDefault: string;
  readonly signInOptions: readonly [string, string];
  readonly stopTest: (handle: string, progress: string) => string;
  readonly stopTestAfter: (load: string, planned: string) => string;
  readonly stopTestStarted: (elapsed: string) => string;
  readonly stopOperation: (handle: string, elapsed: string) => string;
  readonly stopOptions: (isTest: boolean) => readonly [string, string];
}

function plural(locale: Locale, count: number, forms: Record<string, string>): string {
  const rule = new Intl.PluralRules(locale).select(count);
  return `${num(count, locale)} ${forms[rule] ?? forms['other'] ?? ''}`;
}

const EN: Words = {
  users: (count) => plural('en', count, { one: 'user', other: 'users' }),
  rate: (value) => `${value} new/s`,
  accounts: (count) => plural('en', count, { one: 'account', other: 'accounts' }),
  runStart: (p) =>
    `Start a test of ${p.target} on ${p.environment}${p.isProtected ? ' (protected)' : ''}: ` +
    `${p.load}${p.planned === null ? '' : `, ${p.planned}`}${p.data === null ? '' : `, ${p.data}`}?`,
  clamped: (requested, effective) => ` clamped from ${requested} to ${effective}`,
  planned: (time) => `planned ${time}`,
  data: (available, sign, needed) => `data ${available} ${sign} ${needed}`,
  runOptions: (capped) => (capped ? ['Run clamped', "Don't run"] : ['Run', "Don't run"]),
  provision: (p) => `Create ${p.accounts} for slot ${p.slot} on ${p.where} in the tested system?`,
  namedEnvironment: (name, isProtected) => `${name}${isProtected === true ? ' (protected)' : ''}`,
  defaultEnvironment: (name, isProtected) =>
    name === null
      ? 'the default environment'
      : `${name} (default${isProtected === true ? ', protected' : ''})`,
  provisionOptions: ['Create accounts', "Don't create"],
  signIn: (p) =>
    'LoadCraft keeps this sign-in for the run: let its browser agent sign in to ' +
    `${p.where} with the account from ${p.account}?`,
  signInDefault: 'the default environment',
  signInOptions: ['Let it sign in', "Don't sign in"],
  stopTest: (handle, progress) => `Stop test ${handle}${progress}?`,
  stopTestAfter: (load, planned) => ` after ${load} of ${planned}`,
  stopTestStarted: (elapsed) => `, started ${elapsed} ago`,
  stopOperation: (handle, elapsed) => `Stop operation ${handle}, started ${elapsed} ago?`,
  stopOptions: (isTest) =>
    isTest ? ['Stop the test', 'Keep it running'] : ['Stop it', 'Keep it running'],
};

// Plural forms as the server's dictionary has them (mcp/src/render/i18n/pl.ts, `profiles.cap.users`).
const PL: Words = {
  users: (count) =>
    plural('pl', count, {
      one: 'użytkownik',
      few: 'użytkowników',
      many: 'użytkowników',
      other: 'użytkownika',
    }),
  rate: (value) => `${value} nowych/s`,
  accounts: (count) =>
    plural('pl', count, { one: 'konto', few: 'konta', many: 'kont', other: 'konta' }),
  runStart: (p) =>
    `Uruchomić test ${p.target} na ${p.environment}${p.isProtected ? ' (chronione)' : ''}: ` +
    `${p.load}${p.planned === null ? '' : `, ${p.planned}`}${p.data === null ? '' : `, ${p.data}`}?`,
  clamped: (requested, effective) => ` przycięty z ${requested} do ${effective}`,
  planned: (time) => `plan ${time}`,
  data: (available, sign, needed) => `dane ${available} ${sign} ${needed}`,
  runOptions: (capped) =>
    capped ? ['Uruchom przycięty', 'Nie uruchamiaj'] : ['Uruchom', 'Nie uruchamiaj'],
  provision: (p) =>
    `Założyć ${p.accounts} dla slotu ${p.slot} na ${p.where} w testowanym systemie?`,
  namedEnvironment: (name, isProtected) => `${name}${isProtected === true ? ' (chronione)' : ''}`,
  defaultEnvironment: (name, isProtected) =>
    name === null
      ? 'środowisku domyślnym'
      : `${name} (domyślne${isProtected === true ? ', chronione' : ''})`,
  provisionOptions: ['Załóż konta', 'Nie zakładaj'],
  signIn: (p) =>
    'LoadCraft przechowa to logowanie na czas przebiegu: pozwolić jego agentowi przeglądarki ' +
    `zalogować się na ${p.where} kontem z ${p.account}?`,
  signInDefault: 'środowisku domyślnym',
  signInOptions: ['Pozwól zalogować', 'Nie loguj'],
  stopTest: (handle, progress) => `Przerwać test ${handle}${progress}?`,
  stopTestAfter: (load, planned) => ` po ${load} z ${planned}`,
  stopTestStarted: (elapsed) => ` uruchomiony ${elapsed} temu`,
  stopOperation: (handle, elapsed) => `Przerwać operację ${handle} uruchomioną ${elapsed} temu?`,
  stopOptions: (isTest) => (isTest ? ['Przerwij test', 'Niech trwa'] : ['Przerwij', 'Niech trwa']),
};

const WORDS: Readonly<Record<Locale, Words>> = { en: EN, pl: PL };

const name = (text: string): string => inline(text, NAME_LIMIT);

/** `100 users`, or `20 new/s` for an arrival-rate profile. */
function amount(profile: LoadProfile, words: Words, locale: Locale): string {
  return RATE_TYPES.has(profile.type)
    ? words.rate(num(profile.vusers, locale))
    : words.users(profile.vusers);
}

/** `e-3f9a12c4` for a test run, as the server names executions; the handle itself otherwise. */
function shownOperation(facts: CancelFacts): string {
  const [kind, id] = facts.operation.split(':', 2);
  if (kind === 'test_run' && id !== undefined && id !== '') {
    return inline(`e-${id.slice(0, 8).toLowerCase()}`, NAME_LIMIT);
  }
  return inline(facts.operation, HANDLE_LIMIT);
}

function runStartWording(facts: RunStartFacts, locale: Locale): Wording {
  const words = WORDS[locale];
  const effective = amount(facts.effective, words, locale);
  const load = facts.capped
    ? `${name(facts.label)}${words.clamped(num(facts.requested.vusers, locale), effective)}`
    : `${name(facts.label)}, ${effective}`;
  const data =
    facts.needed === null || facts.available === null
      ? null
      : words.data(
          num(facts.available, locale),
          facts.available >= facts.needed ? '≥' : '<',
          num(facts.needed, locale),
        );
  return {
    text: words.runStart({
      target: name(facts.target),
      environment: name(facts.environment),
      isProtected: facts.protected,
      load,
      planned: facts.plannedS === null ? null : words.planned(clock(facts.plannedS)),
      data,
    }),
    options: words.runOptions(facts.capped),
  };
}

function provisionWhere(facts: ProvisionAccountsFacts, words: Words): string {
  return facts.environment === null
    ? words.defaultEnvironment(
        facts.defaultEnvironment === null ? null : name(facts.defaultEnvironment),
        facts.protected,
      )
    : words.namedEnvironment(name(facts.environment), facts.protected);
}

function cancelWording(facts: CancelFacts, locale: Locale): Wording {
  const words = WORDS[locale];
  const isTest = facts.kind === 'test_run';
  const elapsed = clock(facts.elapsedS);
  if (!isTest) {
    return {
      text: words.stopOperation(inline(facts.operation, HANDLE_LIMIT), elapsed),
      options: words.stopOptions(false),
    };
  }
  const progress =
    facts.loadElapsedS === null || facts.plannedS === null
      ? words.stopTestStarted(elapsed)
      : words.stopTestAfter(clock(facts.loadElapsedS), clock(facts.plannedS));
  return {
    text: words.stopTest(shownOperation(facts), progress),
    options: words.stopOptions(true),
  };
}

/** The question and its options, in the user's language. */
export function wording(facts: ConsentFacts, locale: Locale): Wording {
  const words = WORDS[locale];
  switch (facts.tool) {
    case 'run_start':
      return runStartWording(facts, locale);
    case 'data_create_accounts':
      return {
        text: words.provision({
          accounts: words.accounts(facts.count),
          slot: name(facts.slot),
          where: provisionWhere(facts, words),
        }),
        options: words.provisionOptions,
      };
    case 'flows_describe_journeys': {
      const account = `${inline(facts.fromEnv, NAME_LIMIT)}${
        facts.emailKey === null ? '' : ` (${name(facts.emailKey)})`
      }`;
      return {
        text: words.signIn({
          where: facts.environment === null ? words.signInDefault : name(facts.environment),
          account,
        }),
        options: words.signInOptions,
      };
    }
    case 'process_cancel':
      return cancelWording(facts, locale);
  }
}

const NEXT = 'Do not retry; ask the user what to change.';

/** What the model reads when the user says no: English, starting with the refusal's code. */
export function denial(facts: ConsentFacts): string {
  const head = `[${DECLINED_CODE}] `;
  switch (facts.tool) {
    case 'run_start': {
      const effective = amount(facts.effective, EN, 'en');
      const profile = facts.capped
        ? `capped ${num(facts.requested.vusers, 'en')} → ${effective}`
        : effective;
      return (
        `${head}The user declined to start this test (${name(facts.target)} on environment ` +
        `${name(facts.environment)}${facts.protected ? ', protected' : ''}, profile ${profile}). ` +
        `Nothing was started. ${NEXT}`
      );
    }
    case 'data_create_accounts': {
      const environment = facts.environment ?? facts.defaultEnvironment ?? null;
      const where =
        environment === null ? 'the default environment' : `environment ${name(environment)}`;
      return (
        `${head}The user declined to create these accounts (${num(facts.count, 'en')} for slot ` +
        `${name(facts.slot)} on ${where}). Nothing was sent. ${NEXT}`
      );
    }
    case 'flows_describe_journeys': {
      const where =
        facts.environment === null
          ? 'the default environment'
          : `environment ${name(facts.environment)}`;
      return (
        `${head}The user declined to let the browser agent sign in (${where}, account from ` +
        `${inline(facts.fromEnv, NAME_LIMIT)}). Nothing was sent. ${NEXT}`
      );
    }
    case 'process_cancel': {
      const progress =
        facts.kind === 'test_run' && facts.loadElapsedS !== null && facts.plannedS !== null
          ? `${clock(facts.loadElapsedS)} of ${clock(facts.plannedS)}`
          : `started ${clock(facts.elapsedS)} ago`;
      return (
        `${head}The user chose to keep this operation running (` +
        `${inline(facts.operation, HANDLE_LIMIT)}, ${progress}). Nothing was stopped. ` +
        'Do not retry; follow it with process_wait, or ask the user what to change.'
      );
    }
  }
}
