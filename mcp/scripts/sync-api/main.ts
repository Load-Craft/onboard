// `npm run sync:api`: one pass from a backend's OpenAPI document to a list of what to fix in the plugin.
//
//   1. take the document (--from-url | --from-backend | --from-file); the WebSocket document
//      (--asyncapi-from-file | --asyncapi-from-url) goes through the same steps beside it
//   2. save it as contracts/loadcraft-openapi.json (contracts/loadcraft-asyncapi.json); where it came
//      from (commit, branch) is printed in the report only, no file records it
//   3. regenerate the typed clients (GENERATORS below)
//   4. report the API changes against the previous snapshot, the ones the plugin uses apart
//   5. type-check the plugin and group the errors by file and tool
//   6. exit 0 (nothing to do), 1 (does not compile), 2 (breaking change on a used route), 3 (bad call)
//
// With --dry-run nothing in the repository is written: the new document and the types go to a copy.

import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { standardNullable, type AsyncApiDocument } from '../gen-clients/model.ts';
import { carryChannelMetadata, diffAsyncApi, surfaceOf, type AsyncChange } from './asyncDiff.ts';
import { diffSpecs, type OperationChange, type Spec } from './diff.ts';
import { findPluginRoutes, toolsReaching, type PluginRoute } from './routes.ts';
import { runTypecheck, type CompileError } from './typecheck.ts';

const SCRIPTS = resolve(import.meta.dirname, '..');

/** Exit codes; see the module comment. */
export const EXIT = { ok: 0, compile: 1, breaking: 2, usage: 3 } as const;

interface GeneratorContext {
  /** The document to generate from: the OpenAPI or the AsyncAPI one, by `Generator.document`. */
  readonly spec: string;
  /** The `mcp` folder to write into (a copy on --dry-run). */
  readonly mcp: string;
}

interface Generator {
  readonly name: string;
  readonly document: 'openapi' | 'asyncapi';
  readonly run: (context: GeneratorContext) => Promise<void>;
}

function runNode(args: readonly string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', (chunk: Buffer) => (error += chunk.toString()));
    child.on('close', (code) =>
      code === 0
        ? done()
        : fail(new Error(`${basename(args[0] ?? '')} exited with ${code}: ${error.trim()}`)),
    );
  });
}

/**
 * Every client generator, run in order on the new document. To generate one more thing (for example
 * Zod schemas) add an entry here; each one writes its own file under `context.mcp`.
 */
const GENERATORS: readonly Generator[] = [
  {
    name: 'openapi-typescript -> src/http/generated/api.d.ts',
    document: 'openapi',
    run: ({ spec, mcp }) =>
      runNode([
        join(SCRIPTS, 'gen-api.mjs'),
        '--spec',
        spec,
        '--out',
        join(mcp, 'src', 'http', 'generated', 'api.d.ts'),
      ]),
  },
  {
    name: 'gen-operations -> src/http/generated/operations.ts',
    document: 'openapi',
    run: ({ spec, mcp }) =>
      runNode([
        join(SCRIPTS, 'gen-operations.mjs'),
        '--spec',
        spec,
        '--out',
        join(mcp, 'src', 'http', 'generated', 'operations.ts'),
      ]),
  },
  {
    name: 'gen-clients -> src/ws/generated/channels.ts',
    document: 'asyncapi',
    run: ({ spec, mcp }) =>
      runNode([
        join(SCRIPTS, 'gen-clients.mjs'),
        '--only',
        'ws',
        '--asyncapi',
        spec,
        '--out-ws',
        join(mcp, 'src', 'ws', 'generated', 'channels.ts'),
      ]),
  },
];

interface Options {
  /** `undefined` when only the WebSocket document is synced. */
  readonly source: 'url' | 'backend' | 'file' | undefined;
  readonly target: string;
  readonly asyncSource: { readonly kind: 'url' | 'file'; readonly target: string } | undefined;
  readonly dryRun: boolean;
  readonly root: string;
  readonly tokenEnv: string;
  readonly sourceCommit: string | undefined;
  readonly sourceBranch: string | undefined;
}

class Usage extends Error {}

const HELP = `Usage: npm run sync:api -- [source] [options]

Source (one of; without one the backend at LOADCRAFT_API_URL / LOADCRAFT_URL is used):
  --from-url <address>     GET <address>/openapi.json of a running backend; the token in the
                           environment variable named by --token-env is sent as a bearer
  --from-backend <folder>  backend working tree: runs scripts/export_openapi.py with the .venv of
                           that tree (no uv sync) and prints the tree's commit
  --from-file <file>       an OpenAPI JSON file

WebSocket document (AsyncAPI 3.0), synced beside the OpenAPI one or alone:
  --asyncapi-from-file <file>  an AsyncAPI JSON file (the usual source: the backend serves none yet)
  --asyncapi-from-url <address>  GET <address>/asyncapi.json, with the same token as --from-url

Options:
  --dry-run                write nothing; type-check the plugin against the new document in a copy
  --token-env <NAME>       environment variable holding the API token (default LOADCRAFT_API_TOKEN)
  --source-commit <sha>    commit of the source, printed in the report only (--from-backend finds it
                           itself); no file records it
  --source-branch <name>   branch of the source, printed in the report only
  --root <folder>          repository root (default: the folder above mcp/)

Exit codes: 0 nothing to do, 1 the plugin does not compile, 2 breaking change on a route the plugin
uses, 3 bad call or the source could not be read.
`;

function parseArgs(argv: readonly string[], env: Record<string, string | undefined>): Options {
  let source: Options['source'];
  let target = '';
  let asyncSource: Options['asyncSource'];
  let dryRun = false;
  let root = resolve(SCRIPTS, '..', '..');
  let tokenEnv = 'LOADCRAFT_API_TOKEN';
  let sourceCommit: string | undefined;
  let sourceBranch: string | undefined;
  const value = (index: number, flag: string): string => {
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) throw new Usage(`${flag} needs a value`);
    return next;
  };
  const pick = (kind: Options['source'], at: number, flag: string): void => {
    if (source !== undefined) throw new Usage('give one source only');
    source = kind;
    target = value(at, flag);
  };
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at] ?? '';
    if (flag === '--from-url') pick('url', at, flag);
    else if (flag === '--from-backend') pick('backend', at, flag);
    else if (flag === '--from-file') pick('file', at, flag);
    else if (flag === '--asyncapi-from-file' || flag === '--asyncapi-from-url') {
      if (asyncSource !== undefined) throw new Usage('give one AsyncAPI source only');
      asyncSource = { kind: flag.endsWith('url') ? 'url' : 'file', target: value(at, flag) };
    } else if (flag === '--dry-run') dryRun = true;
    else if (flag === '--token-env') tokenEnv = value(at, flag);
    else if (flag === '--source-commit') sourceCommit = value(at, flag);
    else if (flag === '--source-branch') sourceBranch = value(at, flag);
    else if (flag === '--root') root = resolve(value(at, flag));
    else if (flag === '--help' || flag === '-h') throw new Usage('');
    else throw new Usage(`unknown argument ${flag}`);
    if (flag !== '--dry-run') at += 1;
  }
  if (source === undefined && asyncSource === undefined) {
    const url = env['LOADCRAFT_API_URL'] ?? env['LOADCRAFT_URL'];
    if (url === undefined || url === '') {
      throw new Usage(
        'no source: give --from-url, --from-backend or --from-file, or set LOADCRAFT_API_URL',
      );
    }
    source = 'url';
    target = url;
  }
  return { source, target, asyncSource, dryRun, root, tokenEnv, sourceCommit, sourceBranch };
}

/** The document address: the backend origin (the `/api/v1` suffix dropped) plus `/openapi.json`. */
export function openapiUrl(address: string): string {
  const url = new URL(address);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  let path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/openapi.json')) {
    path = `${path.replace(/\/api\/v1$/, '')}/openapi.json`;
  }
  url.pathname = path;
  return url.toString();
}

interface Fetched {
  readonly spec: Spec;
  readonly description: string;
  readonly commit: string | undefined;
  readonly branch: string | undefined;
  readonly note: string | undefined;
}

async function fetchJson(url: string, token: string | undefined): Promise<unknown> {
  const scrub = (text: string): string =>
    token === undefined || token === '' ? text : text.replaceAll(token, '***');
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Usage(
      scrub(`${url} did not answer: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
  if (!response.ok) throw new Usage(`${url} answered ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Usage(`${url} did not return JSON`);
  }
}

async function fetchSpec(address: string, token: string | undefined): Promise<Fetched> {
  const url = openapiUrl(address);
  return {
    spec: asSpec(await fetchJson(url, token), url),
    description: `GET ${url}`,
    commit: undefined,
    branch: undefined,
    note: undefined,
  };
}

/** The AsyncAPI address: the backend origin plus `/asyncapi.json`, as `openapiUrl` does for OpenAPI. */
export function asyncapiUrl(address: string): string {
  const url = new URL(openapiUrl(address));
  url.pathname = url.pathname.replace(/\/openapi\.json$/, '/asyncapi.json');
  return url.toString();
}

function asAsyncApi(value: unknown, origin: string): AsyncApiDocument {
  const text = (value as { asyncapi?: unknown } | null)?.asyncapi;
  if (typeof text !== 'string' || !text.startsWith('3.') || typeof value !== 'object') {
    throw new Usage(`${origin} is not an AsyncAPI 3 document (no "asyncapi": "3.x")`);
  }
  return standardNullable(value as AsyncApiDocument);
}

async function fetchAsyncApi(
  source: NonNullable<Options['asyncSource']>,
  token: string | undefined,
): Promise<{ readonly doc: AsyncApiDocument; readonly description: string }> {
  if (source.kind === 'url') {
    const url = asyncapiUrl(source.target);
    return { doc: asAsyncApi(await fetchJson(url, token), url), description: `GET ${url}` };
  }
  let text: string;
  try {
    text = readFileSync(resolve(source.target), 'utf8');
  } catch {
    throw new Usage(`cannot read ${source.target}`);
  }
  try {
    return {
      doc: asAsyncApi(JSON.parse(text) as unknown, source.target),
      description: `file ${source.target}`,
    };
  } catch (error) {
    if (error instanceof Usage) throw error;
    throw new Usage(`${source.target} is not JSON`);
  }
}

function asSpec(value: unknown, origin: string): Spec {
  if (typeof value !== 'object' || value === null || !('paths' in value)) {
    throw new Usage(`${origin} is not an OpenAPI document (no "paths")`);
  }
  return value as Spec;
}

function git(tree: string, args: readonly string[]): string | undefined {
  const result = spawnSync('git', ['-C', tree, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function fromBackend(tree: string, scratch: string): Fetched {
  const python = join(tree, '.venv', 'bin', 'python');
  const script = join(tree, 'scripts', 'export_openapi.py');
  if (!existsSync(python) || !existsSync(script)) {
    throw new Usage(`${tree} has no .venv/bin/python or scripts/export_openapi.py`);
  }
  const out = join(scratch, 'openapi.json');
  const env = { ...process.env };
  delete env['VIRTUAL_ENV'];
  const result = spawnSync(python, [script, out], {
    cwd: tree,
    env,
    encoding: 'utf8',
    timeout: 300_000,
  });
  if (result.status !== 0) {
    const tail = `${result.stderr}`.trim().split('\n').slice(-5).join('\n');
    throw new Usage(`export_openapi.py failed (exit ${result.status ?? 'none'}):\n${tail}`);
  }
  const branch = git(tree, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = (git(tree, ['status', '--porcelain', '--untracked-files=no']) ?? '') !== '';
  return {
    spec: asSpec(JSON.parse(readFileSync(out, 'utf8')) as unknown, out),
    description: `export_openapi.py of ${tree}`,
    commit: git(tree, ['rev-parse', '--short=9', 'HEAD']),
    branch: branch === 'HEAD' ? undefined : branch,
    note: dirty
      ? 'the backend tree has uncommitted changes; the recorded commit does not describe the document exactly'
      : undefined,
  };
}

function fromFile(file: string): Fetched {
  let text: string;
  try {
    text = readFileSync(resolve(file), 'utf8');
  } catch {
    throw new Usage(`cannot read ${file}`);
  }
  let spec: unknown;
  try {
    spec = JSON.parse(text);
  } catch {
    throw new Usage(`${file} is not JSON`);
  }
  return {
    spec: asSpec(spec, file),
    description: `file ${file}`,
    commit: undefined,
    branch: undefined,
    note: undefined,
  };
}

/** The snapshot's form: sorted keys, two-space indent, no ASCII escaping, a final newline. */
export function canonicalJson(value: unknown): string {
  const sort = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sort);
    if (typeof node === 'object' && node !== null) {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, inner]) => [key, sort(inner)]),
      );
    }
    return node;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** The commit and branch of the source, for the report only: no file of the plugin records them. */
function sourceLine(commit: string | undefined, branch: string | undefined): string | undefined {
  if (commit === undefined && branch === undefined) return undefined;
  const parts = [
    ...(commit === undefined ? [] : [`commit ${commit}`]),
    ...(branch === undefined ? [] : [`branch ${branch}`]),
  ];
  return `source ${parts.join(', ')} (printed only; no file records it)`;
}

function countOperations(spec: Spec): number {
  return Object.values(spec.paths ?? {}).reduce(
    (sum, item) =>
      sum +
      Object.keys(item).filter((key) =>
        /^(get|put|post|delete|options|head|patch|trace)$/.test(key),
      ).length,
    0,
  );
}

function specPathsOf(spec: Spec): string[] {
  return Object.keys(spec.paths ?? {});
}

function copyProject(root: string, into: string): string {
  const skip = new Set(['node_modules', '.git', 'dist']);
  cpSync(root, into, { recursive: true, filter: (source) => !skip.has(basename(source)) });
  symlinkSync(join(root, 'mcp', 'node_modules'), join(into, 'mcp', 'node_modules'));
  return join(into, 'mcp');
}

/** At most five names; shared helpers make the list of a route long. */
function brief(names: readonly string[]): string {
  return names.length <= 5
    ? names.join(', ')
    : `${names.slice(0, 5).join(', ')} (+${names.length - 5} more)`;
}

interface Line {
  (text?: string): void;
}

function describeChange(
  change: OperationChange,
  used: PluginRoute | undefined,
  limit: number,
  out: Line,
): void {
  const tag = change.kind === 'breaking' ? 'BREAKING' : change.kind;
  const where =
    used === undefined
      ? ''
      : `  [${used.tools.length > 0 ? `tools: ${brief(used.tools)}; ` : ''}${used.files.map((file) => `src/${file}`).join(', ')}]`;
  out(`  [${tag}] ${change.status} ${change.operation}${where}`);
  const shown = change.changes.slice(0, limit);
  for (const item of shown)
    out(
      `      ${item.kind === 'breaking' ? '!' : item.kind === 'info' ? '~' : '+'} ${item.where}: ${item.message}`,
    );
  if (change.changes.length > shown.length)
    out(`      ... ${change.changes.length - shown.length} more`);
}

function describeAsyncChange(change: AsyncChange, out: Line): void {
  const tag = change.kind === 'breaking' ? 'BREAKING' : 'additive';
  const frame = change.frame === undefined ? '' : ` ${change.frame}`;
  const where = change.where === '' ? '' : ` ${change.where}`;
  out(`  [${tag}] ${change.channel}${frame}${where}: ${change.message}`);
}

export interface Report {
  readonly code: number;
  readonly text: string;
}

/** The whole run; `argv` are the arguments after the script name. Never throws for a bad call. */
export async function sync(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): Promise<Report> {
  const lines: string[] = [];
  const out: Line = (text = '') => void lines.push(text);
  const scratch = mkdtempSync(join(tmpdir(), 'lc-sync-api-'));
  let token: string | undefined;
  try {
    const options = parseArgs(argv, env);
    token = env[options.tokenEnv];
    const contracts = join(options.root, 'contracts');
    const snapshot = join(contracts, 'loadcraft-openapi.json');
    const mcp = join(options.root, 'mcp');
    if (!existsSync(snapshot) || !existsSync(join(mcp, 'package.json'))) {
      throw new Usage(`${options.root} is not the plugin repository (no contracts/ and mcp/)`);
    }
    const previous = JSON.parse(readFileSync(snapshot, 'utf8')) as Spec;

    // The two halves (REST, WebSocket) are independent: each fetches, writes and generates on its
    // own, and a failure of one is that half's result (exit 3), never the end of the run.
    const bothHalves = options.source !== undefined && options.asyncSource !== undefined;
    const failures: { rest?: string; ws?: string } = {};
    const failure = (half: 'rest' | 'ws', error: unknown): void => {
      if (!bothHalves) throw error;
      const message = error instanceof Error ? error.message : String(error);
      failures[half] =
        token === undefined || token === '' ? message : message.replaceAll(token, '***');
    };

    let fetched: Fetched = {
      spec: previous,
      description: 'OpenAPI document not synced (no source given)',
      commit: undefined,
      branch: undefined,
      note: undefined,
    };
    try {
      if (options.source !== undefined) {
        fetched =
          options.source === 'url'
            ? await fetchSpec(options.target, token)
            : options.source === 'backend'
              ? fromBackend(resolve(options.target), scratch)
              : fromFile(options.target);
      }
    } catch (error) {
      failure('rest', error);
    }
    const asyncSnapshot = join(contracts, 'loadcraft-asyncapi.json');
    let asyncFetched: { readonly doc: AsyncApiDocument; readonly description: string } | undefined;
    try {
      if (options.asyncSource !== undefined) {
        asyncFetched = await fetchAsyncApi(options.asyncSource, token);
      }
    } catch (error) {
      failure('ws', error);
    }
    const previousAsync = existsSync(asyncSnapshot)
      ? (JSON.parse(readFileSync(asyncSnapshot, 'utf8')) as AsyncApiDocument)
      : undefined;
    // The backend's own document carries no channel metadata: what the snapshot has stays.
    const carried =
      asyncFetched === undefined
        ? undefined
        : carryChannelMetadata(previousAsync, asyncFetched.doc);
    // Compared as data, written in the canonical form: the same document in another key order or
    // number spelling is no change.
    const asyncText = carried === undefined ? '' : canonicalJson(carried.document);
    const asyncChanged =
      asyncFetched !== undefined &&
      (previousAsync === undefined || canonicalJson(previousAsync) !== asyncText);
    const surface = existsSync(join(contracts, 'ws-frames.json'))
      ? surfaceOf(JSON.parse(readFileSync(join(contracts, 'ws-frames.json'), 'utf8')))
      : {};
    const asyncChanges: AsyncChange[] =
      asyncFetched === undefined || previousAsync === undefined
        ? []
        : diffAsyncApi(previousAsync, carried?.document ?? asyncFetched.doc, surface);
    // A new channel has no metadata to carry: say so, so that it gets described.
    for (const id of (carried?.bare ?? []).filter(
      (id) => !(id in (previousAsync?.channels ?? {})),
    )) {
      asyncChanges.push({
        kind: 'additive',
        channel: id,
        frame: undefined,
        where: '',
        message:
          'no channel metadata (x-terminal-frames, x-replay, x-requires-origin, x-started-by, x-close-codes): describe it from the backend code',
        usedByPlugin: id in surface,
      });
    }
    const commit = options.sourceCommit ?? fetched.commit;
    const branch = options.sourceBranch ?? fetched.branch;

    out(`sync:api${options.dryRun ? ' (dry run: nothing is written)' : ''}`);
    out(`source: ${fetched.description}`);
    if (failures.rest !== undefined) out(`REST client: FAILED: ${failures.rest}`);
    if (asyncFetched !== undefined) out(`asyncapi source: ${asyncFetched.description}`);
    if (failures.ws !== undefined) out(`WebSocket client: FAILED: ${failures.ws}`);
    if (fetched.note !== undefined) out(`warning: ${fetched.note}`);

    const changes = diffSpecs(previous, fetched.spec);
    const changed = changes.length > 0;
    const routes = findPluginRoutes(join(mcp, 'src'), specPathsOf(previous));
    const routeOf = new Map(
      routes.map((route) => [`${route.method} ${route.path}`, route] as const),
    );

    // Steps 2 and 3: snapshot and generators, in place or in a copy. A half writes its contract
    // and its generated file together; when its generator fails both go back as they were.
    let checkedMcp = mcp;
    let copy: string | undefined;
    if (options.dryRun && (changed || asyncChanged)) {
      copy = join(scratch, 'copy');
      checkedMcp = copyProject(options.root, copy);
    }
    const targetRoot = options.dryRun ? dirname(checkedMcp) : options.root;
    const writeHalf = async (
      half: 'rest' | 'ws',
      document: Generator['document'],
      contract: string,
      generated: string,
      text: string,
    ): Promise<boolean> => {
      const targetSpec = join(targetRoot, 'contracts', contract);
      const targetGenerated = join(checkedMcp, generated);
      const keep = (file: string): string | undefined =>
        existsSync(file) ? readFileSync(file, 'utf8') : undefined;
      const [oldSpec, oldGenerated] = [keep(targetSpec), keep(targetGenerated)];
      try {
        mkdirSync(dirname(targetSpec), { recursive: true });
        writeFileSync(targetSpec, text);
        for (const generator of GENERATORS.filter((g) => g.document === document)) {
          await generator.run({ spec: targetSpec, mcp: checkedMcp });
        }
        return true;
      } catch (error) {
        for (const [file, old] of [
          [targetSpec, oldSpec],
          [targetGenerated, oldGenerated],
        ] as const) {
          if (old === undefined) rmSync(file, { force: true });
          else writeFileSync(file, old);
        }
        failure(half, error);
        out(`${half === 'rest' ? 'REST' : 'WebSocket'} client: FAILED: ${failures[half] ?? ''}`);
        return false;
      }
    };
    if (changed && failures.rest === undefined) {
      const written = await writeHalf(
        'rest',
        'openapi',
        'loadcraft-openapi.json',
        'src/http/generated/api.d.ts',
        canonicalJson(fetched.spec),
      );
      if (written && !options.dryRun) {
        const source = sourceLine(commit, branch);
        if (source !== undefined) out(source);
        out(
          'written: contracts/loadcraft-openapi.json, ' +
            GENERATORS.filter((g) => g.document === 'openapi')
              .map((g) => g.name.split('-> ')[1] ?? g.name)
              .join(', '),
        );
        out(
          'note: mcp/dist embeds the snapshot; run "npm run build" and commit dist with the rest',
        );
      }
    }

    if (asyncChanged && failures.ws === undefined) {
      const written = await writeHalf(
        'ws',
        'asyncapi',
        'loadcraft-asyncapi.json',
        'src/ws/generated/channels.ts',
        asyncText,
      );
      if (written && !options.dryRun) {
        out(
          'written: contracts/loadcraft-asyncapi.json, ' +
            GENERATORS.filter((g) => g.document === 'asyncapi')
              .map((g) => g.name.split('-> ')[1] ?? g.name)
              .join(', '),
        );
        out(
          'note: contracts/ws-frames.json is the plugin surface; keep it in step (npm test checks it)',
        );
      }
    }

    // Step 4: the changes.
    out();
    out(`operations: ${countOperations(previous)} -> ${countOperations(fetched.spec)}`);
    if (!changed) {
      out('API changes: no changes');
    } else {
      const added = changes.filter((c) => c.status === 'added').length;
      const removed = changes.filter((c) => c.status === 'removed').length;
      const modified = changes.filter((c) => c.status === 'changed').length;
      const breaking = changes.filter((c) => c.kind === 'breaking').length;
      out(
        `API changes: ${added} added, ${removed} removed, ${modified} changed (${breaking} breaking)`,
      );
      const usedChanges = changes.filter((c) => routeOf.has(c.operation));
      const otherChanges = changes.filter((c) => !routeOf.has(c.operation));
      out();
      out(`Used by the plugin: ${usedChanges.length} changed of ${routes.length} routes it calls`);
      if (usedChanges.length === 0) out('  none');
      for (const change of usedChanges)
        describeChange(change, routeOf.get(change.operation), 50, out);
      out();
      out(`Not used by the plugin: ${otherChanges.length}`);
      for (const change of otherChanges) describeChange(change, undefined, 3, out);
    }

    if (asyncFetched !== undefined) {
      out();
      const breaking = asyncChanges.filter((c) => c.kind === 'breaking').length;
      out(
        `WebSocket API changes: ${asyncChanges.length === 0 ? 'no frame or key changes' : `${asyncChanges.length} (${breaking} breaking)`}${asyncChanged && asyncChanges.length === 0 ? '; wording changed' : ''}`,
      );
      const usedAsync = asyncChanges.filter((c) => c.usedByPlugin);
      const otherAsync = asyncChanges.filter((c) => !c.usedByPlugin);
      out(`Used by the plugin: ${usedAsync.length}`);
      if (usedAsync.length === 0) out('  none');
      for (const change of usedAsync) describeAsyncChange(change, out);
      out(`Not used by the plugin: ${otherAsync.length}`);
      for (const change of otherAsync.slice(0, 20)) describeAsyncChange(change, out);
      if (otherAsync.length > 20) out(`  ... ${otherAsync.length - 20} more`);
    }

    // Step 5: the compiler.
    out();
    const result = await runTypecheck(checkedMcp);
    const sources = join(mcp, 'src');
    if (result.ok) {
      out('typecheck: ok');
    } else {
      out(
        `typecheck: ${result.errors.length} error(s) in ${new Set(result.errors.map((e) => e.file)).size} file(s)`,
      );
      const byFile = new Map<string, CompileError[]>();
      for (const error of result.errors)
        (byFile.get(error.file) ?? byFile.set(error.file, []).get(error.file))?.push(error);
      for (const [file, errors] of byFile) {
        const inSources = file.startsWith('src/') ? file.slice(4) : undefined;
        const tools = inSources === undefined ? [] : toolsReaching(sources, inSources);
        out(`  ${file}${tools.length > 0 ? `  (tools: ${tools.join(', ')})` : ''}`);
        for (const error of errors.slice(0, 20))
          out(`    ${error.line}:${error.column} ${error.code} ${error.message}`);
        if (errors.length > 20) out(`    ... ${errors.length - 20} more`);
        const related = changes
          .filter((c) => c.status !== 'added')
          .filter(
            (c) =>
              inSources !== undefined &&
              routeOf.get(c.operation)?.files.includes(inSources) === true,
          );
        for (const change of related)
          out(`    related operation: ${change.status} ${change.operation} [${change.kind}]`);
      }
      for (const line of result.other) out(`  ${line}`);
    }

    // Step 6: the summary and the code.
    const breakingUsed = changes.filter((c) => c.kind === 'breaking' && routeOf.has(c.operation));
    const breakingAsync = asyncChanges.filter((c) => c.kind === 'breaking' && c.usedByPlugin);
    const code = !result.ok
      ? EXIT.compile
      : failures.rest !== undefined || failures.ws !== undefined
        ? EXIT.usage
        : breakingUsed.length + breakingAsync.length > 0
          ? EXIT.breaking
          : EXIT.ok;
    out();
    out('Summary');
    out(
      `  changes: ${changed ? `${changes.length} operation(s)` : 'none'}; breaking on used routes: ${breakingUsed.length}`,
    );
    if (asyncFetched !== undefined) {
      out(
        `  websocket changes: ${asyncChanges.length}; breaking on used frames: ${breakingAsync.length}`,
      );
    }
    out(`  compiles: ${result.ok ? 'yes' : `no (${result.errors.length} error(s))`}`);
    const fix = new Set<string>();
    for (const error of result.errors) {
      const rel = error.file.startsWith('src/') ? error.file.slice(4) : undefined;
      for (const tool of rel === undefined ? [] : toolsReaching(sources, rel)) fix.add(tool);
    }
    out(`  tools that do not compile: ${fix.size === 0 ? 'none' : brief([...fix].sort())}`);
    const files = new Set<string>();
    for (const change of breakingUsed)
      for (const file of routeOf.get(change.operation)?.files ?? []) files.add(`src/${file}`);
    out(
      `  files calling a breaking route: ${files.size === 0 ? 'none' : [...files].sort().join(', ')}`,
    );
    const halfResult = (
      failed: string | undefined,
      breaking: number,
      prefixes: readonly string[],
      what: string,
    ): string =>
      failed !== undefined
        ? `exit ${EXIT.usage} (failed: ${failed})`
        : !result.ok &&
            result.errors.some((e) => prefixes.some((prefix) => e.file.startsWith(prefix)))
          ? `exit ${EXIT.compile} (does not compile)`
          : breaking > 0
            ? `exit ${EXIT.breaking} (breaking change on a used ${what})`
            : `exit ${EXIT.ok}`;
    out(
      `  REST client: ${halfResult(failures.rest, breakingUsed.length, ['src/http', 'src/api', 'src/contract'], 'route')}`,
    );
    if (asyncFetched !== undefined || failures.ws !== undefined) {
      out(
        `  WebSocket client: ${halfResult(failures.ws, breakingAsync.length, ['src/ws'], 'frame')}`,
      );
    }
    out(`  exit code: ${code}`);
    if (copy !== undefined) rmSync(copy, { recursive: true, force: true });
    return { code, text: lines.join('\n') + '\n' };
  } catch (error) {
    if (error instanceof Usage) {
      if (error.message === '') return { code: EXIT.ok, text: HELP };
      return {
        code: EXIT.usage,
        text: `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}sync:api: ${error.message}\n\n${HELP}`,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    const clean = token === undefined || token === '' ? message : message.replaceAll(token, '***');
    return { code: EXIT.usage, text: `${lines.join('\n')}\nsync:api failed: ${clean}\n` };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
