// The code that talks to the backend on behalf of a tool reaches it only through the clients
// generated from the contracts, so a change of the contract shows up in types and not at run time.
// Scanned: src/tools, src/ops, src/resolve, src/workspace, src/render, src/report. Rules:
//
// - no `fetch(` (also `globalThis.fetch`, `window.fetch`, `fetch` passed on; an own method or
//   function called `fetch` is not the global one), no `WebSocket`;
// - no import of `ws`, `undici`, `node-fetch`, `axios`, `got`, `http`, `https`, `net` (but
//   `isIP`, `isIPv4`, `isIPv6`), `tls`, `dgram`, `dns` or `module` (`createRequire` would go round
//   every other rule); `child_process` is banned in src/tools only (the workspace runs git);
// - no raw route (`/api/v1...`, `/ws/...`) at the start of a string or of a piece of a template;
//   a literal with a space is a sentence, not a route;
// - imports from `src/http` only of the generated client, the error and compat helpers (the type
//   of the client too); imports from `src/ws` only of the typed channel, the address module `ws/url` (derived from the generated channels) and the generated channels;
// - imports from `src/api/*` and from the hand-written `ws/channel` and `ws/frames` only
//   in the files of the transitional lists in `architecture.clients.allowed.ts`. The tools of the
//   first stage were written on those readers; the lists shrink in stage 2 and the guard fails on an
//   entry that is no longer needed. A type-only import from `src/api/*` or `src/ws/*` outside
//   src/tools (a view that draws a type of an answer) is not a call of the backend and needs no entry.
//
// Known exception, to be retired in stage 2 when the tools move to `callOperation`: `ctx.http`
// (an `HttpClient`) in the tools. The guard catches mistakes, not a deliberate way round (gluing
// '/api' + '/v1', an import by a variable).

import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

import { LEGACY_API_READERS, LEGACY_WS_MODULES } from './architecture.clients.allowed.js';
import { isCatalogDataFile } from './helpers/catalogDataFiles.js';

const SRC = resolve(import.meta.dirname, '..', 'src');
const SCANNED = ['tools', 'ops', 'resolve', 'workspace', 'render', 'report'];

const BANNED_MODULES = new Set([
  'ws',
  'undici',
  'node-fetch',
  'cross-fetch',
  'axios',
  'got',
  'ky',
  'superagent',
  'http',
  'https',
  'http2',
  'tls',
  'dgram',
  'dns',
  'module',
]);
const IP_HELPERS = new Set(['isIP', 'isIPv4', 'isIPv6']);
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global']);
const HTTP_ALLOWED = new Set(['apiError', 'compat', 'errors', 'operation', 'client']);
const WS_ALLOWED = new Set(['typedChannel', 'url']);
const RAW_ROUTE = /^(?:https?:\/\/[^/\s]+)?\/(?:api\/v\d+|ws)(?:\/|$)/;

export type Legacy = 'api' | 'ws';

export interface Finding {
  readonly rule: string;
  readonly line: number;
  readonly legacy?: Legacy;
}

/** The package of a specifier: `node:net` -> `net`, `@scope/pkg/sub` -> `@scope/pkg`. */
function bareModule(spec: string): string {
  const parts = spec.replace(/^node:/, '').split('/');
  return spec.startsWith('@') || parts[0]?.startsWith('@')
    ? parts.slice(0, 2).join('/')
    : (parts[0] ?? spec);
}

interface Import {
  readonly typeOnly: boolean;
  /** Names imported (empty for a default, namespace, side-effect or dynamic import). */
  readonly names: readonly string[];
  readonly plain: boolean;
}

/** Violations in the text of the file at `file` (an absolute path under src/). */
export function scan(file: string, text: string): Finding[] {
  const inTools = relative(SRC, file).split(/[\\/]/)[0] === 'tools';
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: Finding[] = [];
  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const checkSpecifier = (spec: string, node: ts.Node, imp: Import): void => {
    const line = lineOf(node);
    if (!spec.startsWith('.')) {
      const pkg = bareModule(spec);
      if (pkg === 'net') {
        if (imp.typeOnly) return;
        if (imp.plain || imp.names.length === 0 || !imp.names.every((n) => IP_HELPERS.has(n))) {
          found.push({ rule: `imports "${spec}"`, line });
        }
      } else if (BANNED_MODULES.has(pkg) || (pkg === 'child_process' && inTools)) {
        found.push({ rule: `imports "${spec}"`, line });
      }
      return;
    }
    const target = relative(SRC, resolve(dirname(file), spec))
      .split('\\')
      .join('/');
    const [area, name] = target.split('/');
    const base = name?.replace(/\.js$/, '');
    if (area === 'api') {
      if (imp.typeOnly && !inTools) return;
      found.push({ rule: `imports the hand-written reader "${target}"`, line, legacy: 'api' });
    } else if (area === 'http') {
      const ok = base !== undefined && (HTTP_ALLOWED.has(base) || base === 'generated');
      if (!ok || (base === 'client' && !imp.typeOnly)) {
        found.push({ rule: `imports "${target}" from src/http`, line });
      }
    } else if (area === 'ws') {
      if (base !== undefined && (WS_ALLOWED.has(base) || base === 'generated')) return;
      if (imp.typeOnly && !inTools) return;
      found.push({ rule: `imports the hand-written "${target}"`, line, legacy: 'ws' });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const named = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements : [];
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            named.length > 0 &&
            named.every((element) => element.isTypeOnly)));
      checkSpecifier(node.moduleSpecifier.text, node, {
        typeOnly,
        names: named.map((element) => (element.propertyName ?? element.name).text),
        plain:
          clause !== undefined &&
          (clause.name !== undefined || (bindings !== undefined && !ts.isNamedImports(bindings))),
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkSpecifier(node.moduleSpecifier.text, node, {
        typeOnly: node.isTypeOnly,
        names: [],
        plain: true,
      });
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ((ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isStringLiteralLike(arg)) {
        checkSpecifier(arg.text, node, { typeOnly: false, names: [], plain: true });
      }
    } else if (ts.isIdentifier(node) && node.text === 'fetch') {
      const parent = node.parent;
      // An own variable, parameter, import, member or function called `fetch` is not a call of the
      // global one; `globalThis.fetch` and a bare reference are.
      const declares =
        (ts.isVariableDeclaration(parent) && parent.name === node) ||
        (ts.isParameter(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isImportSpecifier(parent) && parent.name === node) ||
        (ts.isFunctionDeclaration(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isMethodSignature(parent) && parent.name === node) ||
        (ts.isPropertyDeclaration(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        (ts.isPropertyAccessExpression(parent) &&
          parent.name === node &&
          !(ts.isIdentifier(parent.expression) && GLOBAL_OBJECTS.has(parent.expression.text)));
      if (!declares) found.push({ rule: 'uses fetch', line: lineOf(node) });
    } else if (ts.isIdentifier(node) && node.text === 'WebSocket') {
      found.push({ rule: 'uses WebSocket', line: lineOf(node) });
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      (node.argumentExpression.text === 'fetch' || node.argumentExpression.text === 'WebSocket') &&
      ts.isIdentifier(node.expression) &&
      GLOBAL_OBJECTS.has(node.expression.text)
    ) {
      found.push({ rule: `uses ${node.argumentExpression.text}`, line: lineOf(node) });
    } else if (
      (ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      !ts.isImportDeclaration(node.parent) &&
      !/\s/.test(node.text) &&
      RAW_ROUTE.test(node.text)
    ) {
      found.push({ rule: `writes the route "${node.text}"`, line: lineOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('code that talks to the backend uses only the generated clients', () => {
  const files = SCANNED.flatMap((dir) => sourceFiles(join(SRC, dir))).filter(
    (file) => !isCatalogDataFile(relative(SRC, file)),
  );
  const rel = (file: string): string => relative(SRC, file).split('\\').join('/');
  const results = files.map((file) => ({
    name: rel(file),
    findings: scan(file, readFileSync(file, 'utf8')),
  }));

  it('scans the tools and the code beside them', () => {
    expect(files.length).toBeGreaterThan(60);
    expect(results.some(({ name }) => name.startsWith('tools/'))).toBe(true);
    expect(results.some(({ name }) => name.startsWith('render/'))).toBe(true);
  });

  it('has no fetch, WebSocket, HTTP library or raw route, and no unlisted import of a hand-written client', () => {
    const bad = results.flatMap(({ name, findings }) =>
      findings
        .filter(({ legacy }) => legacy === undefined)
        .map(({ rule, line }) => `${name}:${line} ${rule}`),
    );
    expect(bad).toEqual([]);
  });

  it('imports src/api only in the files of the transitional list', () => {
    const bad = results
      .filter(
        ({ name, findings }) =>
          findings.some((f) => f.legacy === 'api') && !LEGACY_API_READERS.includes(name),
      )
      .map(({ name }) => name);
    expect(bad).toEqual([]);
  });

  it('imports the hand-written ws modules only in the files of the transitional list', () => {
    const bad = results
      .filter(
        ({ name, findings }) =>
          findings.some((f) => f.legacy === 'ws') && !LEGACY_WS_MODULES.includes(name),
      )
      .map(({ name }) => name);
    expect(bad).toEqual([]);
  });

  it('keeps no entry in the lists that its file no longer needs', () => {
    const uses = (legacy: Legacy): Set<string> =>
      new Set(
        results
          .filter(({ findings }) => findings.some((f) => f.legacy === legacy))
          .map(({ name }) => name),
      );
    const api = uses('api');
    const ws = uses('ws');
    expect({
      api: LEGACY_API_READERS.filter((name) => !api.has(name)),
      ws: LEGACY_WS_MODULES.filter((name) => !ws.has(name)),
    }).toEqual({ api: [], ws: [] });
  });
});

describe('the scan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-clients-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const tool = join(SRC, 'tools', 'probe.ts');
  const view = join(SRC, 'render', 'views', 'probe.ts');
  const rules = (text: string, file = tool): string[] => scan(file, text).map(({ rule }) => rule);

  it('passes code on the generated clients', () => {
    const text = `
import { callOperation } from '../http/operation.js';
import type { HttpClient } from '../http/client.js';
import { typedChannel } from '../ws/typedChannel.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { isIP, isIPv6 } from 'node:net';
import type { Socket } from 'node:net';
// fetch( in a comment and "/api/v1/x" in a comment
export const fetchAll = (n: number) => n + 1;
export const description = 'Use the route /api/v1/x to read it';
export const text = \`Call /api/v1/x then \${fetchAll(1)} and read /ws/y\`;
export const own = { fetch() { return 1; }, other: (o: { fetch(): number }) => o.fetch() };
export function fetch(): number { return 2; }
export class Holder { fetch = 1; }
`;
    expect(scan(tool, text)).toEqual([]);
  });

  it.each([
    ['fetch', `export const x = () => fetch('http://a');`, 'uses fetch'],
    ['globalThis.fetch', `export const x = () => globalThis.fetch('a');`, 'uses fetch'],
    ['window.fetch', `export const x = () => window.fetch('a');`, 'uses fetch'],
    ['fetch by name', `export const x = globalThis['fetch'];`, 'uses fetch'],
    ['fetch passed on', `export const x = [1].map(fetch);`, 'uses fetch'],
    ['new WebSocket', `export const x = () => new WebSocket('ws://a');`, 'uses WebSocket'],
    ['import ws', `import W from 'ws';\nexport { W };`, 'imports "ws"'],
    ['import undici', `import { request } from 'undici';\nexport { request };`, 'imports "undici"'],
    [
      'a subpath of a package',
      `import { request } from 'undici/types';\nexport { request };`,
      'imports "undici/types"',
    ],
    [
      'import node:http',
      `import { get } from 'node:http';\nexport { get };`,
      'imports "node:http"',
    ],
    [
      'import tls',
      `import { connect } from 'node:tls';\nexport { connect };`,
      'imports "node:tls"',
    ],
    [
      'import dgram',
      `import { createSocket } from 'node:dgram';\nexport { createSocket };`,
      'imports "node:dgram"',
    ],
    ['import dns', `import { lookup } from 'node:dns';\nexport { lookup };`, 'imports "node:dns"'],
    [
      'createRequire',
      `import { createRequire } from 'node:module';\nexport { createRequire };`,
      'imports "node:module"',
    ],
    [
      'child_process in a tool',
      `import { exec } from 'node:child_process';\nexport { exec };`,
      'imports "node:child_process"',
    ],
    [
      'net.connect',
      `import { connect } from 'node:net';\nexport { connect };`,
      'imports "node:net"',
    ],
    [
      'net as a namespace',
      `import * as net from 'node:net';\nexport { net };`,
      'imports "node:net"',
    ],
    [
      'net with isIP and connect',
      `import { isIP, connect } from 'node:net';\nexport { isIP, connect };`,
      'imports "node:net"',
    ],
    ['dynamic import', `export const x = () => import('undici');`, 'imports "undici"'],
    ['raw route', `export const x = '/api/v1/projects';`, 'writes the route "/api/v1/projects"'],
    [
      'raw route with a host',
      `export const x = 'https://a.test/api/v1/projects';`,
      'writes the route "https://a.test/api/v1/projects"',
    ],
    [
      'raw route in a template',
      'export const x = (id: string) => `/api/v1/projects/${id}`;',
      'writes the route "/api/v1/projects/"',
    ],
    [
      'raw route after a placeholder',
      'export const x = (a: string, b: string) => `${a}/api/v1/${b}`;',
      'writes the route "/api/v1/"',
    ],
    [
      'raw route at the end of a template',
      'export const x = (base: string) => `${base}/api/v1/x`;',
      'writes the route "/api/v1/x"',
    ],
    ['raw ws route', `export const x = '/ws/executions';`, 'writes the route "/ws/executions"'],
    [
      'the client as a value',
      `import { HttpClient } from '../http/client.js';\nexport { HttpClient };`,
      'imports "http/client.js" from src/http',
    ],
    [
      'an unlisted http module',
      `import { x } from '../http/upload.js';\nexport { x };`,
      'imports "http/upload.js" from src/http',
    ],
    [
      'an unlisted ws module',
      `import { x } from '../ws/frames.js';\nexport { x };`,
      'imports the hand-written "ws/frames.js"',
    ],
    [
      'a global fetch beside an own method',
      `export const o = { fetch() { return 1; } };\nexport const y = globalThis.fetch('a');`,
      'uses fetch',
    ],
  ])('finds %s', (_name, text, rule) => {
    expect(rules(text)).toContain(rule);
  });

  it('applies the rules to the code beside the tools', () => {
    expect(rules(`export const x = () => fetch('a');`, view)).toContain('uses fetch');
    expect(rules(`import { x } from '../../api/flows.js';\nexport { x };`, view)).toContain(
      'imports the hand-written reader "api/flows.js"',
    );
  });

  it('lets a view draw a type of an answer; in a tool the import is listed', () => {
    const type = (up: string): string =>
      `import type { FlowQuestion } from '${up}api/flows.js';\nexport type X = FlowQuestion;`;
    expect(scan(view, type('../../'))).toEqual([]);
    expect(scan(tool, type('../'))).toEqual([
      { rule: 'imports the hand-written reader "api/flows.js"', line: 1, legacy: 'api' },
    ]);
  });

  it('allows child_process outside the tools', () => {
    const text = `import { execFile } from 'node:child_process';\nexport { execFile };`;
    expect(scan(join(SRC, 'workspace', 'probe.ts'), text)).toEqual([]);
  });

  it('tells a hand-written reader from a violation', () => {
    expect(scan(tool, `import { x } from '../api/flows.js';\nexport { x };`)).toEqual([
      { rule: 'imports the hand-written reader "api/flows.js"', line: 1, legacy: 'api' },
    ]);
    expect(scan(tool, `import { x } from '../ws/channel.js';\nexport { x };`)).toEqual([
      { rule: 'imports the hand-written "ws/channel.js"', line: 1, legacy: 'ws' },
    ]);
  });

  it('is red for a planted fetch in a copy of a real tool', () => {
    const real = join(SRC, 'tools', 'processWait.ts');
    mkdirSync(join(dir, 'tools'), { recursive: true });
    const copy = join(dir, 'tools', 'processWait.ts');
    writeFileSync(copy, `${readFileSync(real, 'utf8')}\nexport const leak = () => fetch('x');\n`);
    expect(rules(readFileSync(copy, 'utf8'), real)).toContain('uses fetch');
    expect(rules(readFileSync(real, 'utf8'), real)).not.toContain('uses fetch');
  });
});
