// Sentinel suite, part 1 (cases and what is fed in: canaryCases.ts): the cases cover the registry,
// a tainted success of every case, the password of the browser account, a secret the view reshapes,
// the files of the project, a value under the masking threshold and the env file.

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createLogger, MIN_SECRET_LENGTH } from '../../src/log.js';
import { loadConfig } from '../../src/config.js';
import { readAccountFromEnv } from '../../src/workspace/envFile.js';
import { CallSecretScope } from '../../src/workspace/secrets.js';
import { defineTool } from '../../src/registry.js';
import { LoadcraftApiError } from '../../src/http/apiError.js';
import { inline, wrap } from '../../src/render/primitives.js';
import { createServer as createMcpServer } from '../../src/server.js';
import { ALL_TOOLS } from '../../src/tools/index.js';
import { taintBody } from '../fake-backend/faults.js';
import { SKLEP_IDS } from '../golden/index.js';
import { assertNoCanary, BACKEND_CANARY, FILE_CANARY, TOKEN_CANARY } from '../helpers/canary.js';
import { connect } from '../helpers/mcp.js';
import { toolRig } from '../helpers/rig.js';
import * as z from 'zod/v4';
import { CASES, CREATE_ARGS, TOOL_NAMES, callUnderTest, runBefore, start } from './canaryCases.js';

vi.setConfig({ testTimeout: 120_000 });

describe('sentinel: the cases cover the registry', () => {
  it('has at least one case for every tool of ALL_TOOLS', () => {
    const covered = new Set(CASES.map((item) => item.tool));
    expect(ALL_TOOLS.filter((tool) => !covered.has(tool.name)).map((tool) => tool.name)).toEqual(
      [],
    );
  });

  it('names only tools that exist', () => {
    expect(CASES.filter((item) => !TOOL_NAMES.has(item.tool)).map((item) => item.tool)).toEqual([]);
  });
});

describe.each(CASES)('sentinel: $tool ($label)', (item) => {
  it('lets no secret out through a tainted success', async () => {
    const { r, proxy, drive } = await start(item);
    const before = await runBefore(item, drive, proxy);
    const calls = await callUnderTest(item, drive, before);
    const last = calls[calls.length - 1];
    expect(last, 'the tool answered').toBeDefined();
    expect(proxy.tainted, 'the proxy tainted an answer').toBeGreaterThan(0);
    if (item.refusedAs === undefined) {
      expect(last?.isError, `the call finished: ${last?.text ?? ''}`).toBe(false);
    } else {
      expect(last?.isError).toBe(true);
      expect(last?.text).toMatch(new RegExp(`^\\[${item.refusedAs}\\] `, 'u'));
    }
    if (item.progress === true) {
      const messages = r.results.flatMap((result) => result.progress);
      expect(messages.length, 'progress notifications were sent').toBeGreaterThan(0);
    }
    r.assertClean();
  });
});

// ---- the password of the browser account in the description tools --------------------------------

// `flows_describe_journeys` hands the password of `.env.perf` to the backend (the browser of LoadCraft signs
// in with it), so the check has two halves: the body of the request that reached the backend holds
// the password (else the case would prove nothing), and neither a result, a log line, a file, a
// frame the client sent on the run's socket nor the address of a connection holds it.

describe.each(
  CASES.filter(
    (item) =>
      (item.tool === 'flows_describe_journeys' && item.quotes !== true) ||
      item.tool === 'flows_record_journeys',
  ),
)('sentinel: $tool ($label), the password of the browser account', (item) => {
  it('is in the body of the request to the backend and in no output, frame or address', async () => {
    const { r, proxy, drive } = await start(item);
    const before = await runBefore(item, drive, proxy);
    const calls = await callUnderTest(item, drive, before);
    expect(calls.at(-1)?.isError, calls.at(-1)?.text).toBe(false);

    const starts = r.fake.calls.filter(
      (call) => call.method === 'POST' && /\/scenario-from-description\/generate$/u.test(call.path),
    );
    expect(starts.length, 'the run was started on the backend').toBeGreaterThan(0);
    for (const request of starts) expect(JSON.stringify(request.body)).toContain(FILE_CANARY);

    const runId = r.fake.calls
      .map((call) => /\/scenario-from-description\/runs\/([^/]+)/u.exec(call.path)?.[1])
      .find((id) => id !== undefined);
    expect(runId, 'a call named the run').toBeDefined();
    const channel = r.fake.channel('describe', {
      project_id: SKLEP_IDS.project,
      run_id: runId ?? '',
    });
    expect(channel.opened, 'the run socket was opened').toBeGreaterThan(0);
    if (item.tool === 'flows_record_journeys') expect(channel.received.length).toBeGreaterThan(0);
    assertNoCanary(channel.received, channel.addresses);
    for (const address of channel.addresses) expect(address).not.toContain('password');
    r.assertClean();
  });
});

describe('sentinel: the proxy taints what a leaking backend sends', () => {
  it('taints a field of a secret name that holds an address, and spares a token endpoint', () => {
    const tainted = taintBody({
      password_url: 'https://example.com/reset',
      token_path: '/oauth/token',
      token_endpoint: 'https://idp.example.com/oauth/token',
    }) as Record<string, unknown>;
    expect(tainted['password_url']).toBe(BACKEND_CANARY);
    expect(tainted['token_path']).toBe(BACKEND_CANARY);
    expect(tainted['token_endpoint']).toBe('https://idp.example.com/oauth/token');
  });
});

// ---- a secret the view reshapes ----------------------------------------------------------------

// Views wrap lines on spaces, break a word longer than a line, turn tabs into spaces and cut a long
// text with `…`, and a tool may already do the last two in `run`. A value registered in the call is
// masked in the data and the error before the view, and the masker also knows the value as one line
// and its head in front of a cut, for what was reshaped before the registry saw it.

/** A password of the customer's file with spaces in it. */
const SPACED = `correct horse ${FILE_CANARY} staple`;
/** A password with a tab. */
const TABBED = `Pw\t${FILE_CANARY}`;
/** A long password without a space. */
const LONG = FILE_CANARY.repeat(6);
/** A password that a cut at the quote limit leaves partly in front of the `…`. */
const TAILED = `${FILE_CANARY}-tail-2026`;
/** A password with marks `inline()` removes: a zero-width space, a right-to-left override, a bell. */
const INVISIBLE = `Pw\u200b${FILE_CANARY}\u202e!\u0007x`;

const RESHAPES = [
  'wrap',
  'long word',
  'tab',
  'tab before the view',
  'cut in the view',
  'cut before the view',
  'cut in progress',
  'cut in the error',
  'invisible before the view',
  'invisible in progress',
  'drawn by the view',
] as const;
type Reshape = (typeof RESHAPES)[number];

const reshape = defineTool({
  name: 'reshape_secret',
  title: 'Reshape',
  description: 'Probe: registers a password and shows it the way a view reshapes text.',
  input: z.object({ how: z.enum(RESHAPES) }),
  annotations: { readOnlyHint: true },
  // Async so that the error case rejects the way a failed backend call does.
  async run(ctx, args: { how: Reshape }) {
    await Promise.resolve();
    for (const value of [SPACED, TABBED, LONG, TAILED, INVISIBLE]) ctx.secrets.add(value);
    const filler = 'x'.repeat(60);
    switch (args.how) {
      case 'wrap':
        return { status: 'done' as const, data: { text: `${filler} ${SPACED}` } };
      case 'long word':
        return { status: 'done' as const, data: { text: LONG } };
      case 'tab':
        return { status: 'done' as const, data: { text: `${filler} ${TABBED}` } };
      case 'tab before the view':
        // A label made one line in `run`: the tab is a space before the registry sees the data.
        return { status: 'done' as const, data: { text: inline(`${filler} ${TABBED}`) } };
      case 'cut in the view':
        return { status: 'done' as const, data: { text: `${filler} ${TAILED}` } };
      case 'cut before the view':
        // A tool that prepares a short label in `run` cuts before the registry sees the data.
        return { status: 'done' as const, data: { text: inline(`${filler} ${TAILED}`, 75) } };
      case 'cut in progress':
        ctx.progress.report(inline(`${filler} ${TAILED}`, 75), 0.5);
        return { status: 'done' as const, data: { text: 'done' } };
      case 'invisible before the view':
        return { status: 'done' as const, data: { text: inline(`${filler} ${INVISIBLE}`) } };
      case 'invisible in progress':
        // Text made in `run` reaches the client without passing the data scrub: only the filter of
        // the progress text sees it.
        ctx.progress.report(`step ${inline(INVISIBLE)}`, 0.5);
        return { status: 'done' as const, data: { text: 'done' } };
      case 'drawn by the view':
        return { status: 'done' as const, data: { text: filler } };
      case 'cut in the error':
        throw new LoadcraftApiError({
          status: 409,
          code: 'something_new',
          message: `${'y'.repeat(285)} ${TAILED}`,
        });
    }
  },
  render(data: { text: string }, _t, args: { how: Reshape }) {
    if (args.how === 'wrap' || args.how === 'long word') return wrap(data.text, 77, 2).join('\n');
    if (args.how === 'cut in the view') return inline(data.text, 75);
    // The view adds a value that was never in the data: only the filter of the finished text sees it.
    if (args.how === 'drawn by the view') return `${inline(data.text)} ${inline(INVISIBLE)}`;
    return inline(data.text);
  },
});

describe('sentinel: a secret the view reshapes', () => {
  it.each(RESHAPES)('keeps a registered password out of the result (%s)', async (how) => {
    const r = await toolRig({ tools: [reshape] });
    const result = await r.call('reshape_secret', { how });
    const inProgress = how === 'cut in progress' || how === 'invisible in progress';
    expect(result.text).toContain(inProgress ? 'done' : '[redacted]');
    if (inProgress) {
      const messages = r.results.flatMap((item) => item.progress);
      expect(messages.length, 'progress was sent').toBeGreaterThan(0);
    }
    r.assertClean();
  });
});

describe('sentinel: what the files of the project hold', () => {
  it('keeps the sentinel out of loadcraft/ after a project is created and a run is saved', async () => {
    const item = CASES.find((candidate) => candidate.tool === 'project_create');
    if (item === undefined) throw new Error('no project_create case');
    const { r, drive } = await start(item);
    await drive.call('project_create', CREATE_ARGS);
    const saved = readFileSync(join(r.workspace, 'loadcraft', 'project.json'), 'utf8');
    expect(saved.length).toBeGreaterThan(0);
    assertNoCanary(saved);
    r.assertClean();
  });
});

// ---- a value shorter than the masking threshold -----------------------------------------------

describe('sentinel: a secret shorter than MIN_SECRET_LENGTH', () => {
  const short = 'x'.repeat(MIN_SECRET_LENGTH - 1);
  const exact = 'y'.repeat(MIN_SECRET_LENGTH);

  const probe = defineTool({
    name: 'echo_secrets',
    title: 'Echo',
    description: 'Probe: registers two secrets and writes them to the result and the log.',
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run(ctx) {
      const hidden = ctx.secrets.add(short);
      ctx.secrets.add(exact);
      ctx.log.info(`log ${short} ${exact}`);
      return Promise.resolve({
        status: 'done' as const,
        data: { line: `text ${short} ${exact}`, hidden },
      });
    },
    render: (data) => `${data.line} ${String(data.hidden)}`,
  });

  it('is not searched for in text or log lines, a value of the threshold length is masked', async () => {
    const lines: string[] = [];
    const config = loadConfig({ LOADCRAFT_API_TOKEN: TOKEN_CANARY }, process.cwd());
    const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
    const session = await connect(() => createMcpServer({ config, log, tools: [probe] }));
    try {
      const result = await session.call('echo_secrets', {});
      // The short value passes (nothing can tell it from any other three characters), the one of
      // the threshold length does not, and the `Secret` object that holds the short one prints as
      // the redaction marker.
      expect(result.text).toContain(`text ${short}`);
      expect(result.text).not.toContain(exact);
      expect(result.text).toContain('[redacted]');
      expect(lines.join('\n')).toContain(short);
      expect(lines.join('\n')).not.toContain(exact);
    } finally {
      await session.close();
    }
  });
});

// ---- the env file ------------------------------------------------------------------------------

describe('sentinel: the password in .env.perf', () => {
  // Every tool that reads an env file has a case above that hands it `.env.perf`, whose password
  // is the sentinel: the case runs the tool on a tainted backend and through errors that quote it,
  // and checks the text, the progress, the log and every file under `loadcraft/`.
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sources(path) : [path];
    });
  const toolsDir = join(import.meta.dirname, '..', '..', 'src', 'tools');

  it('has a case with the env file for every tool that reads one', () => {
    const readers = sources(toolsDir).filter((path) =>
      readFileSync(path, 'utf8').includes('readAccountFromEnv('),
    );
    expect(readers.length, 'a tool reads an env file').toBeGreaterThan(0);
    const named = new Set(
      readers.flatMap((path) =>
        [...readFileSync(path, 'utf8').matchAll(/\bname: '([a-z_]+)'/gu)].map((m) => m[1] ?? ''),
      ),
    );
    const withFile = new Set(
      CASES.filter((item) => JSON.stringify(item.args({})).includes('"from_env":".env.perf"')).map(
        (item) => item.tool,
      ),
    );
    expect([...named].filter((tool) => !withFile.has(tool))).toEqual([]);
  });

  it('keeps the password of an env file out of text and log once the file is read', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lc-env-'));
    try {
      writeFileSync(
        join(root, '.env.perf'),
        `TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=${FILE_CANARY}\n`,
      );
      const lines: string[] = [];
      const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
      const scope = new CallSecretScope(log);
      const account = await readAccountFromEnv(root, '.env.perf', scope);
      expect(account.email).toBe('user@example.com');
      expect(account.password.reveal()).toBe(FILE_CANARY);
      const shown = [
        scope.scrub(`login as ${account.email} with ${FILE_CANARY}`),
        JSON.stringify(account),
        String(account.password),
      ].join('\n');
      log.info(`signing in with ${FILE_CANARY}`, { account });
      expect(shown).toContain('[redacted]');
      assertNoCanary(shown, lines);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
