// An operation whose contract marks secret fields (`SECRET_PATHS`, from the `x-secret` marks and
// contracts/secret-fields.json) is called only through `callOperation`, which registers what those
// fields hold with the secret scope of the call before the answer is returned and before a later
// error of the backend can quote it. A raw call of the typed client (`http.GET('/api/v1/…')` and the
// other methods) registers nothing: a variable of an environment read that way and quoted by a later
// 500 or 401 goes to the log of the server unmasked. Scanned: every file under src except the
// generated code and the one module of the client that sends the calls (`http/operation.ts`).
//
// The route of a raw call must be readable here: a string, a template of constants of the same file,
// or a cast to a string type alias of the same file. A route the scan cannot read is a finding too,
// so a call cannot get past the rule by building its path at run time. The same holds for the
// generic `request(method, route)` of the client (a call of `request` the scan cannot read is a
// finding: none is left outside the client module), a method reached by index (`http['GET']`) and a
// method taken off the client (`const { GET } = http`, `const get = http.GET`): the last is a finding
// by itself, since the call it enables is out of sight.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { OPERATIONS } from '../src/http/generated/operations.js';
import { SECRET_PATHS } from '../src/http/generated/secrets.js';

const SRC = resolve(import.meta.dirname, '..', 'src');
/** The module that sends the calls of `callOperation`; it never names a route itself. */
const CLIENT_MODULES = new Set(['http/operation.ts']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const OPERATION_OF = new Map<string, string>(
  Object.entries(OPERATIONS).map(([id, row]) => [`${row.method} ${row.path}`, id]),
);

/** Whether the contract marks a secret field in the input or in the answer of `id`. */
function hasSecretFields(id: string): boolean {
  const paths = (
    SECRET_PATHS as Readonly<Record<string, (typeof SECRET_PATHS)[keyof typeof SECRET_PATHS]>>
  )[id];
  return paths !== undefined && (paths.request.length > 0 || paths.response.length > 0);
}

export interface SecretReadFinding {
  readonly line: number;
  readonly rule: string;
}

/** Raw calls of operations with secret fields in `text` (a file at `file`, relative to src). */
export function scanSecretReads(file: string, text: string): SecretReadFinding[] {
  if (CLIENT_MODULES.has(file)) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const constants = new Map<string, ts.Expression>();
  const aliases = new Map<string, ts.TypeNode>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      constants.set(node.name.text, node.initializer);
    } else if (ts.isTypeAliasDeclaration(node)) {
      aliases.set(node.name.text, node.type);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const typeRoute = (type: ts.TypeNode, depth: number): string | undefined => {
    if (depth > 10) return undefined;
    if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) return type.literal.text;
    if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
      const aliased = aliases.get(type.typeName.text);
      return aliased === undefined ? undefined : typeRoute(aliased, depth + 1);
    }
    return undefined;
  };
  const route = (node: ts.Expression, depth = 0): string | undefined => {
    if (depth > 10) return undefined;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isParenthesizedExpression(node)) return route(node.expression, depth + 1);
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
      return route(node.expression, depth + 1) ?? typeRoute(node.type, depth + 1);
    }
    if (ts.isIdentifier(node)) {
      const value = constants.get(node.text);
      return value === undefined ? undefined : route(value, depth + 1);
    }
    if (ts.isTemplateExpression(node)) {
      let out = node.head.text;
      for (const span of node.templateSpans) {
        const part = route(span.expression, depth + 1);
        if (part === undefined) return undefined;
        out += part + span.literal.text;
      }
      return out;
    }
    return undefined;
  };

  const found: SecretReadFinding[] = [];
  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  /** The call of `method` on `path` (a route node), or a finding when the route cannot be read. */
  const check = (node: ts.Node, method: string, path: ts.Expression | undefined): void => {
    const line = lineOf(node);
    const read = path === undefined ? undefined : route(path);
    if (read === undefined) {
      found.push({ line, rule: `${method} with a route the scan cannot read` });
      return;
    }
    const id = OPERATION_OF.get(`${method} ${read}`);
    if (id !== undefined && hasSecretFields(id)) {
      found.push({ line, rule: `raw ${method} ${read} (${id} has secret fields)` });
    }
  };
  /** The name `callee` reaches: `http.GET`, `http['GET']`, `http[KEY]` of a constant, `GET`. */
  const memberName = (callee: ts.Expression): string | undefined => {
    if (ts.isIdentifier(callee)) return callee.text;
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
    if (ts.isElementAccessExpression(callee)) return route(callee.argumentExpression);
    return undefined;
  };
  /** The generic call of the client: `request(method, route, init)`. */
  const checkRequest = (node: ts.CallExpression): void => {
    const [methodArg, pathArg] = node.arguments;
    const method = methodArg === undefined ? undefined : route(methodArg);
    if (method !== undefined && METHODS.has(method.toUpperCase())) {
      check(node, method.toUpperCase(), pathArg);
    } else {
      // No call of `request` is left outside the client module: one the scan cannot read is a finding.
      found.push({ line: lineOf(node), rule: 'request with a method the scan cannot read' });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = memberName(node.expression);
      // A bare `GET(…)` is the call of a method destructured before; that taking is the finding.
      if (name !== undefined && METHODS.has(name) && !ts.isIdentifier(node.expression)) {
        check(node, name, node.arguments[0]);
      } else if (name === 'request') checkRequest(node);
    } else if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      // A method of the client taken off it (`const get = http.GET`) is called where no rule sees.
      const name = memberName(node);
      if (name !== undefined && METHODS.has(name)) {
        found.push({ line: lineOf(node), rule: `takes ${name} off the client` });
      }
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      // `const { GET } = http`; a destructured `request` is caught where it is called.
      const key = node.propertyName ?? node.name;
      const name = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
      if (name !== undefined && METHODS.has(name)) {
        found.push({ line: lineOf(node), rule: `takes ${name} off the client` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('operations with secret fields are called only through callOperation', () => {
  it('no file under src calls one with the raw client', () => {
    const findings = sourceFiles(SRC).flatMap((path) => {
      const file = relative(SRC, path).split('\\').join('/');
      return scanSecretReads(file, readFileSync(path, 'utf8')).map(
        (finding) => `${file}:${String(finding.line)} ${finding.rule}`,
      );
    });
    expect(findings).toEqual([]);
  });

  it('the contract marks secret fields of the list of environments', () => {
    expect(
      hasSecretFields('list_project_environments_api_v1_projects__project_id__environments_get'),
    ).toBe(true);
  });

  it('finds a raw read of the environments in a tool, also through a constant and a template', () => {
    const text = [
      "const BASE = '/api/v1/projects/{project_id}' as const;",
      'const ENVIRONMENTS = `${BASE}/environments` as const;',
      'export async function a(ctx: Ctx) {',
      "  await ctx.services.http.GET('/api/v1/projects/{project_id}/environments', {});",
      '  await ctx.services.http.GET(ENVIRONMENTS, {});',
      '}',
    ].join('\n');
    expect(scanSecretReads('tools/someTool.ts', text).map((finding) => finding.line)).toEqual([
      4, 5,
    ]);
  });

  it('finds a route built at run time and reads a cast to a literal type', () => {
    const text = [
      "type Upload = '/api/v1/projects/{project_id}/har/upload';",
      'export async function a(http: Http, url: string, path: string) {',
      '  await http.POST(url as Upload, {});',
      '  await http.GET(path, {});',
      '}',
    ].join('\n');
    expect(scanSecretReads('api/x.ts', text)).toEqual([
      { line: 4, rule: 'GET with a route the scan cannot read' },
    ]);
  });

  it.each([
    [
      'the generic request',
      "await ctx.services.http.request('GET', '/api/v1/projects/{project_id}/environments', {});",
      'raw GET /api/v1/projects/{project_id}/environments',
    ],
    [
      'an element access',
      "await ctx.services.http['GET']('/api/v1/projects/{project_id}/environments', {});",
      'raw GET /api/v1/projects/{project_id}/environments',
    ],
    ['a destructured method', 'const { GET } = ctx.services.http;', 'takes GET off the client'],
    [
      'a destructured request, called',
      "const { request } = http; await request('GET', '/api/v1/projects/{project_id}', {});",
      'raw GET /api/v1/projects/{project_id}',
    ],
    ['a method passed on', 'const get = ctx.services.http.GET;', 'takes GET off the client'],
    [
      'a request with a method chosen at run time',
      'await http.request(method, path, {});',
      'request with a method the scan cannot read',
    ],
  ])('finds %s in a tool', (_label, line, rule) => {
    const findings = scanSecretReads('tools/someTool.ts', line);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toContain(rule);
  });

  it('leaves a raw call of an operation without secret fields alone', () => {
    const text = "await http.GET('/api/v1/projects/{project_id}/gatling/executions', {});";
    expect(scanSecretReads('api/x.ts', text)).toEqual([]);
  });
});
