// Sentinel suite, part 4: a secret the backend keeps in a record (a variable of an environment or of
// the project, a fixed header of a composition) reaches the plugin in a read whose contract marks
// it secret. A later request of the same call fails with a 500 or a 401 whose text quotes it; that
// text goes to the log of the server ("backend error text"), masked only by the secrets the call
// registered. Every such read goes through `callOperation` with the secret scope of the call, so the
// quote is masked. No answer is tainted here: the secret comes only from the seeded record.

import { describe, expect, it, vi } from 'vitest';

import { SKLEP_COLLECTIONS, SKLEP_WORLD_IDS } from '../fake-backend/worlds/sklep.js';
import type { Fake } from '../fake-backend/server.js';
import { BACKEND_CANARY } from '../helpers/canary.js';
import { CASES, callUnderTest, envSecret, runBefore, start, type Case } from './canaryCases.js';

vi.setConfig({ testTimeout: 120_000 });

/** Every project keeps a secret variable and a secret fixed header. */
function projectSecret(fake: Fake): void {
  const projects = fake.store.collection<{ id: string }>(SKLEP_COLLECTIONS.projects);
  for (const { id } of projects.list()) {
    projects.update(id, {
      variables: { api_secret: BACKEND_CANARY },
      default_headers: { 'X-Api-Key': BACKEND_CANARY },
    });
  }
}

/** The composition keeps a fixed header with a key in it. */
function compositionSecret(fake: Fake): void {
  fake.store
    .collection(SKLEP_COLLECTIONS.compositions)
    .update(SKLEP_WORLD_IDS.composition, { global_headers: { 'X-Api-Key': BACKEND_CANARY } });
}

/** A case of the main suite, by tool and label. */
function base(tool: string, label: string): Case {
  const found = CASES.find((item) => item.tool === tool && item.label === label);
  if (found === undefined) throw new Error(`no case ${tool} (${label})`);
  return found;
}

type Seed = (fake: Fake) => void;

/** The case on a world of `stage`, without its healthy steps. */
function withoutBefore(from: Case, stage: Case['stage']): Case {
  const rest: Case = { ...from, stage };
  delete (rest as { before?: unknown }).before;
  return rest;
}

/** The project of an empty world exists only after the healthy steps; its secret is seeded then. */
function seededAfterBefore(from: Case): Case {
  const own = from.before;
  return {
    ...from,
    before: async (drive) => {
      const before = (await own?.(drive)) ?? {};
      projectSecret(drive.r.fake);
      return before;
    },
  };
}

function variant(
  from: Case,
  label: string,
  seed: Seed,
  methods: readonly string[],
  path: RegExp,
): Case {
  const own = from.setup;
  return {
    ...from,
    label,
    setup: (fake) => {
      own?.(fake);
      seed(fake);
    },
    failOptions: { methods, path, quoteBackend: true },
  };
}

const READS: readonly Case[] = [
  variant(
    base('project_import_docs', 'new documentation, a protected environment named'),
    'resolver: the environments, then the upload of the documentation fails',
    envSecret,
    ['POST'],
    /\/openapi\/upload$/u,
  ),
  variant(
    withoutBefore(base('project_check_env', 'connection test'), 'project'),
    'project tools: the environments, then the connection test fails',
    envSecret,
    ['POST'],
    /\/test-connection$/u,
  ),
  variant(
    base('flows_describe_journeys', 'account from .env.perf'),
    'the environments, then the start of the description fails',
    envSecret,
    ['POST'],
    /\/scenario-from-description\/generate$/u,
  ),
  variant(
    base('flows_describe_journeys', 'account from .env.perf'),
    'the project, then the start of the description fails',
    projectSecret,
    ['POST'],
    /\/scenario-from-description\/generate$/u,
  ),
  variant(
    base('flows_generate_from_har', 'from a recording, one flow'),
    'HAR: the environments, then the list of flows fails',
    envSecret,
    ['GET'],
    /\/flows$/u,
  ),
  variant(
    base('process_get_status', 'summary'),
    'resolver: the project, then the analysis of the last run fails',
    projectSecret,
    ['GET'],
    /\/analysis$/u,
  ),
  variant(
    seededAfterBefore(base('project_apply_setup', 'profile from the analysis')),
    'the project, then the apply fails',
    () => undefined,
    ['POST'],
    /\/setup\/apply$/u,
  ),
  variant(
    base('data_check_readiness', 'plan'),
    'the composition, then the scenario fails',
    compositionSecret,
    ['GET'],
    /\/gatling\/scenarios\/[^/]+$/u,
  ),
  // Reads sent at once: the read that fails is answered before the one that carries the secret.
  variant(
    base('process_get_status', 'summary'),
    'parallel reads: the setup status fails beside the read of the project',
    projectSecret,
    ['GET'],
    /\/setup\/status$/u,
  ),
  variant(
    base('run_plan', 'profiles'),
    'parallel reads of the resolver: the scenarios fail beside the compositions',
    compositionSecret,
    ['GET'],
    /\/gatling\/scenarios$/u,
  ),
];

describe.each(READS)('sentinel: $tool ($label)', (item) => {
  it.each([500, 401])('keeps the secret of the record out of an error %i', async (status) => {
    const { r, proxy, drive } = await start(item);
    const before = await runBefore(item, drive, proxy);
    proxy.taint(false);
    proxy.failWith(status, item.failOptions);
    await callUnderTest(item, drive, before);
    // The failure was served, and its text reached the log (masked).
    expect(proxy.tainted).toBeGreaterThan(0);
    expect(r.logRecords().some((record) => record.msg === 'backend error text')).toBe(true);
    r.assertClean();
  });
});
