// Vitest file (see capabilities.spec.ts for why it is not named *.test.ts).
//
// What the mod may do, read from its code, as a reviewer would read it: the sources in mod/src and
// the built mod/register.js that Claude Code loads (a bundler could bring in what the sources do not
// show). The mod only shows and asks the user: it opens no network, reads no secret, approves no
// tool call, never rewrites a result or an argument, and calls back into the LoadCraft server only
// with the read-only tools of a closed list, `process_cancel` only after the user said yes.
//
// `claude plugin validate` reads the same file; its `hooks:` and `calls:` lines are kept in
// validate-expected.json. This file checks that list against the code (no Claude Code needed, so it
// runs in CI); `npm run test:mod` checks it against what `claude plugin validate` prints.
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';

import type * as Ts from '../../mcp/node_modules/typescript';
import { describe, expect, it } from 'vitest';

const ts = createRequire(import.meta.url)('../../mcp/node_modules/typescript') as typeof Ts;

const MOD = join(import.meta.dirname, '..');
const SRC = join(MOD, 'src');
const BUILT = join(MOD, 'register.js');

/** The server the mod calls, as `/mcp` lists it. */
const SERVER = 'plugin:loadcraft:lc';
/** The only tools the mod may call: the read-only status, and `process_cancel` behind the user's yes. */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['process_get_status']);
const AFTER_CONSENT_TOOLS: ReadonlySet<string> = new Set(['process_cancel']);
/** Arguments a literal `process_get_status` call of the mod may carry: it reads, nothing else. */
const GET_STATUS_KEYS: ReadonlySet<string> = new Set([
  'format',
  'operation',
  'result',
  'preflight',
  'progress',
  'project',
  'from_panel',
  // The lists of the panel: `detail` names a section of the same read-only status.
  'detail',
]);
/**
 * The fixed messages of the actions of the lists (Project and Results tabs, the question about a step of
 * the self-check in the Run tab), made in pane/choice.ts.
 */
const LIST_MESSAGES = ['scenarioMessage', 'migrationMessage', 'compareMessage', 'stepMessage'];
/** The events the mod may hook. */
const EVENTS: ReadonlySet<string> = new Set([
  'session.start',
  'tool.call',
  'ui.render',
  'command.run',
  // Only notes where the cursor of the panel is (for `x` on a row); it passes every move on.
  'ui.focus',
]);
/** The drawings the mod may take over; never the permission prompt or a question card. */
const COMPONENTS: ReadonlySet<string> = new Set([
  'AbovePrompt',
  'ToolUse',
  'ToolResult',
  'ToolProgress',
  'Pane',
]);
/** The atoms of `$.state`, each written from one function only. */
const ATOMS = ['session', 'progress', 'bars', 'panel', 'consent', 'cards'] as const;

/** What a mod must never touch: network, files, programs, secrets, the model, other tools. */
const FORBIDDEN: readonly (readonly [string, RegExp])[] = [
  ['$.http', /\$\s*\??\.\s*http\b/u],
  ['$.fs', /\$\s*\??\.\s*fs\b/u],
  ['$.process', /\$\s*\??\.\s*process\b/u],
  ['$.env', /\$\s*\??\.\s*env\b/u],
  ['$.settings', /\$\s*\??\.\s*settings\b/u],
  ['$.model', /\$\s*\??\.\s*model\b/u],
  // Only `$.prompt.submit` is allowed, from one function (see "a pick of the Path tab" below).
  ['$.prompt (other than submit)', /\$\s*\??\.\s*prompt\b(?!\s*\??\.\s*submit\b)/u],
  ['$.agent', /\$\s*\??\.\s*agent\b/u],
  // $.tool.call, .check, .run, .register: each runs, approves or adds a tool.
  ['$.tool', /\$\s*\??\.\s*tool\b/u],
  ['$.session.send', /\bsession\s*\??\.\s*send\b/u],
  ['session.append', /\bsession\s*\??\.\s*append\b/u],
  ['tool.check', /\btool\s*\??\.\s*check\b/u],
  ['tool.run', /\btool\s*\??\.\s*run\b/u],
  ['prompt.* (other than submit)', /\bprompt\s*\??\.\s*(?!submit\b)[A-Za-z_]/u],
  ['fetch', /\bfetch\b/u],
  ['process.env', /\bprocess\s*\??\.\s*env\b/u],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/u],
  ['WebSocket', /\bWebSocket\b/u],
  ['Authorization', /\bAuthorization\b/u],
  ['$ indexed', /\$\s*\??\.?\s*\[/u],
  ['eval', /\beval\s*\(/u],
  ['Function constructor', /\bFunction\s*\(/u],
  ['dynamic import', /\bimport\s*\(/u],
  ['globalThis', /\bglobalThis\b/u],
];

interface Code {
  readonly name: string;
  readonly file: Ts.SourceFile;
  /** The code without comments: what runs. */
  readonly bare: string;
}

function load(path: string): Code {
  const text = readFileSync(path, 'utf8');
  const kind = path.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const bare = ts.createPrinter({ removeComments: true }).printFile(file);
  return { name: relative(MOD, path), file, bare };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}

const SOURCES: readonly Code[] = filesUnder(SRC).map(load);
const REGISTER_TS = load(join(SRC, 'register.ts'));
const BUILT_JS = load(BUILT);
/** Each place `$` is used: the source of the hooks and the file Claude Code loads. */
const MODULES: readonly (readonly [string, Code, readonly Code[]])[] = [
  ['mod/src/register.ts', REGISTER_TS, SOURCES],
  ['mod/register.js', BUILT_JS, [BUILT_JS]],
];

// ---- reading the code ----------------------------------------------------------------------------

function nodes(root: Ts.Node): Ts.Node[] {
  const found: Ts.Node[] = [];
  const visit = (node: Ts.Node): void => {
    found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

const isDollar = (node: Ts.Node): boolean => ts.isIdentifier(node) && node.text === '$';

/** `$.a.b` of a callee, or `undefined` when the callee is not such a chain. */
function dollarChain(callee: Ts.Expression): string | undefined {
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const inner = callee.expression;
  if (!ts.isPropertyAccessExpression(inner) || !isDollar(inner.expression)) return undefined;
  return `$.${inner.name.text}.${callee.name.text}`;
}

/** String constants anywhere in `codes` (`const NAME = 'text'`); a name with two values is left out. */
function constants(codes: readonly Code[]): Map<string, string> {
  const values = new Map<string, string | null>();
  for (const code of codes) {
    for (const node of nodes(code.file)) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        (ts.isStringLiteral(node.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(node.initializer))
      ) {
        const known = values.get(node.name.text);
        const value = node.initializer.text;
        values.set(node.name.text, known === undefined || known === value ? value : null);
      }
    }
  }
  const resolved = new Map<string, string>();
  for (const [name, value] of values) if (value !== null) resolved.set(name, value);
  return resolved;
}

function literal(node: Ts.Node | undefined, known: Map<string, string>): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) return known.get(node.text);
  return undefined;
}

type FunctionLike =
  Ts.FunctionDeclaration | Ts.FunctionExpression | Ts.ArrowFunction | Ts.MethodDeclaration;

function isFunctionLike(node: Ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function enclosing(node: Ts.Node): FunctionLike | undefined {
  for (let up = node.parent; up !== undefined; up = up.parent) {
    if (isFunctionLike(up)) return up;
  }
  return undefined;
}

/** The nodes of a function's own body, without the functions nested in it. */
function ownNodes(fn: FunctionLike): Ts.Node[] {
  const found: Ts.Node[] = [];
  const visit = (node: Ts.Node): void => {
    found.push(node);
    if (node !== fn && isFunctionLike(node)) return;
    ts.forEachChild(node, visit);
  };
  if (fn.body !== undefined) visit(fn.body);
  return found.filter((node) => node === fn.body || enclosing(node) === fn);
}

interface McpCall {
  readonly node: Ts.CallExpression;
  readonly server: string | undefined;
  readonly tool: string | undefined;
}

function mcpCalls(code: Code, known: Map<string, string>): McpCall[] {
  return nodes(code.file).flatMap((node) => {
    if (!ts.isCallExpression(node) || dollarChain(node.expression) !== '$.mcp.call') return [];
    const [server, tool] = node.arguments;
    return [{ node, server: literal(server, known), tool: literal(tool, known) }];
  });
}

/** Every `on(...)` registration of the module: the event, the matcher and the hook. */
interface Registration {
  readonly call: Ts.CallExpression;
  readonly event: string | undefined;
  readonly matcher: Ts.ObjectLiteralExpression | undefined;
  readonly hook: FunctionLike | undefined;
  /** The `.catch(handler)` chained on the registration. */
  readonly handler: FunctionLike | undefined;
}

function registrations(code: Code): Registration[] {
  return nodes(code.file).flatMap((node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return [];
    if (node.expression.text !== 'on') return [];
    const [first, ...rest] = node.arguments;
    const last = rest.at(-1);
    const matcher =
      rest.length === 2 && ts.isObjectLiteralExpression(rest[0]!) ? rest[0] : undefined;
    const chained = node.parent;
    let handler: FunctionLike | undefined;
    if (
      ts.isPropertyAccessExpression(chained) &&
      chained.name.text === 'catch' &&
      ts.isCallExpression(chained.parent)
    ) {
      const [argument] = chained.parent.arguments;
      if (argument !== undefined && isFunctionLike(argument)) handler = argument;
    }
    return [
      {
        call: node,
        event: first !== undefined && ts.isStringLiteral(first) ? first.text : undefined,
        matcher,
        hook: last !== undefined && isFunctionLike(last) ? last : undefined,
        handler,
      },
    ];
  });
}

function matcherValue(matcher: Ts.ObjectLiteralExpression, key: string): Ts.Expression | undefined {
  for (const property of matcher.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === key
    ) {
      return property.initializer;
    }
  }
  return undefined;
}

/** A registration as `claude plugin validate` names it: `tool.call{tool=a|b}`. */
function registrationName(item: Registration): string {
  if (item.matcher === undefined) return item.event ?? '?';
  const parts = item.matcher.properties.map((property) => {
    if (!ts.isPropertyAssignment(property)) return '?';
    const key = property.name.getText();
    const value = property.initializer;
    if (ts.isStringLiteral(value)) return `${key}=${value.text}`;
    if (ts.isArrayLiteralExpression(value)) {
      return `${key}=${value.elements.map((item) => (ts.isStringLiteral(item) ? item.text : '?')).join('|')}`;
    }
    if (ts.isRegularExpressionLiteral(value)) {
      const source = value.text.slice(1, value.text.lastIndexOf('/'));
      return `${key}=/"${source}"/`;
    }
    return `${key}=?`;
  });
  return `${item.event ?? '?'}{${parts.join(',')}}`;
}

const isNextOfE = (node: Ts.Node): boolean =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'next' &&
  node.arguments.length === 1 &&
  ts.isIdentifier(node.arguments[0]!) &&
  node.arguments[0].text === 'e';

function objectKeys(node: Ts.Node): string[] {
  if (!ts.isObjectLiteralExpression(node)) return [];
  return node.properties.flatMap((property) =>
    (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ? [property.name.text]
      : [],
  );
}

const EXPECTED = JSON.parse(
  readFileSync(join(import.meta.dirname, 'validate-expected.json'), 'utf8'),
) as Readonly<Record<string, string | readonly string[]>>;

/** `a (via x, y), b` → `['a', 'b']`; the notes in brackets are what validate adds. */
function listOf(line: string): string[] {
  return line
    .replace(/ \([^)]*\)/gu, '')
    .split(', ')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

// ---- the checks ----------------------------------------------------------------------------------

describe('Z1: what the mod never touches', () => {
  for (const code of [...SOURCES, BUILT_JS]) {
    it(`${code.name} has no network, file, program, secret, model or tool call`, () => {
      for (const [name, pattern] of FORBIDDEN) {
        expect(pattern.test(code.bare), `${code.name}: ${name}`).toBe(false);
      }
    });
  }

  it('$ appears only in the hooks module and never leaves it', () => {
    expect(/(^|[^\w$])\$\s*\??\./u.test(REGISTER_TS.bare)).toBe(true);
    for (const code of SOURCES) {
      if (code.name === REGISTER_TS.name) continue;
      expect(/(^|[^\w$])\$\s*\??\./u.test(code.bare), code.name).toBe(false);
    }
  });

  for (const [name, code] of MODULES) {
    it(`${name} never destructures, copies or renames $ (every call on it is written in full)`, () => {
      const unwrap = (node: Ts.Expression): Ts.Expression =>
        ts.isParenthesizedExpression(node) ||
        ts.isNonNullExpression(node) ||
        ts.isAsExpression(node)
          ? unwrap(node.expression)
          : node;
      for (const node of nodes(code.file)) {
        // `const { mcp } = $`, `const [a] = $`, `const api = $`
        if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
          expect(
            isDollar(unwrap(node.initializer)),
            `${name}: ${node.getText().slice(0, 80)}`,
          ).toBe(false);
        }
        // `({ http } = $)`, `api = $`
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          expect(isDollar(unwrap(node.right)), `${name}: ${node.getText().slice(0, 80)}`).toBe(
            false,
          );
        }
        // `{ ...$ }`, `[...$]`, `f(...$)`
        if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
          expect(isDollar(unwrap(node.expression)), `${name}: ${node.getText().slice(0, 80)}`).toBe(
            false,
          );
        }
        // A hook's own `$` as a pattern: `async ({ mcp }, e, next) => …`
        if (isFunctionLike(node)) {
          const first = node.parameters[0]?.name;
          if (first !== undefined && !ts.isIdentifier(first)) {
            const isHook = registrations(code).some(
              (item) => item.hook === node || item.handler === node,
            );
            expect(
              isHook,
              `${name}: a hook destructures its $: ${node.getText().slice(0, 80)}`,
            ).toBe(false);
          }
        }
      }
    });

    it(`${name} reads only the locale of the plugin options (the rest holds the API token)`, () => {
      const register = nodes(code.file).find(
        (node): node is Ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(node) && node.name?.text === 'register',
      );
      expect(register, 'register').toBeDefined();
      const parameter = register?.parameters[1]?.name;
      expect(parameter !== undefined && ts.isIdentifier(parameter)).toBe(true);
      const options = (parameter as Ts.Identifier).text;
      const uses = nodes(register as Ts.Node).filter(
        (node): node is Ts.Identifier =>
          ts.isIdentifier(node) &&
          node.text === options &&
          node !== parameter &&
          !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
          !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) &&
          !ts.isPropertySignature(node.parent),
      );
      expect(uses.length).toBeGreaterThan(0);
      for (const use of uses) {
        const parent = use.parent;
        const readsLocale =
          (ts.isElementAccessExpression(parent) &&
            ts.isStringLiteral(parent.argumentExpression) &&
            parent.argumentExpression.text === 'locale') ||
          (ts.isPropertyAccessExpression(parent) && parent.name.text === 'locale');
        expect(readsLocale, `${name}: ${parent.getText()}`).toBe(true);
      }
    });
  }
});

describe('Z1: a pick of the Path tab and a question of a card are the only texts the mod puts into the conversation', () => {
  for (const [name, code] of MODULES) {
    const submits = nodes(code.file).filter(
      (node): node is Ts.CallExpression =>
        ts.isCallExpression(node) && dollarChain(node.expression) === '$.prompt.submit',
    );

    it(`${name}: $.prompt.submit is called once, in sendChoice, with the text it was given`, () => {
      expect(submits).toHaveLength(1);
      const [call] = submits;
      const fn = call === undefined ? undefined : enclosing(call);
      expect(
        fn !== undefined && ts.isFunctionDeclaration(fn) && fn.name?.text === 'sendChoice',
      ).toBe(true);
      const argument = call?.arguments[0];
      expect(argument !== undefined && ts.isObjectLiteralExpression(argument)).toBe(true);
      // Only `text`, and it is the parameter of the function: no `asUser`, so the model reads the
      // message as the plugin's own and never as words the user typed.
      expect(objectKeys(argument as Ts.Node)).toEqual(['text']);
      const parameter = (fn as Ts.FunctionDeclaration).parameters[2]?.name;
      const value = (
        (argument as Ts.ObjectLiteralExpression).properties[0] as Ts.PropertyAssignment
      ).initializer;
      expect(
        parameter !== undefined &&
          ts.isIdentifier(parameter) &&
          ts.isIdentifier(value) &&
          value.text === parameter.text,
      ).toBe(true);
    });

    it(`${name}: sendChoice is called only from pressPane (the Path tab) and pressCard (a card), with a fixed message`, () => {
      const calls = nodes(code.file).filter(
        (node): node is Ts.CallExpression =>
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'sendChoice',
      );
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        const fn = enclosing(call);
        const caller = fn !== undefined && ts.isFunctionDeclaration(fn) ? fn.name?.text : undefined;
        expect(['pressPane', 'pressCard'], `${name}: ${call.getText().slice(0, 100)}`).toContain(
          caller,
        );
        const text = call.arguments[2];
        if (caller === 'pressPane') {
          expect(
            text !== undefined &&
              ts.isCallExpression(text) &&
              ts.isIdentifier(text.expression) &&
              ['methodMessage', 'journeysMessage', ...LIST_MESSAGES].includes(text.expression.text),
            `${name}: ${call.getText().slice(0, 100)}`,
          ).toBe(true);
        } else {
          // The message of a card is made by `askMessage` from a fixed topic; it is the local `message`
          // of pressCard, which returns when `askMessage` gives none.
          expect(text?.getText()).toBe('message');
          const fn = enclosing(call);
          expect(fn?.getText()).toMatch(
            /const message\s*=\s*askMessage\(action\.effect\);\s*if\s*\(message\s*===\s*(?:undefined|void 0)\)\s*return;/u,
          );
        }
      }
    });

    it(`${name}: the call is not awaited (a hook waiting on its own prompt would hang)`, () => {
      for (const call of submits) {
        let up: Ts.Node = call;
        while (ts.isPropertyAccessExpression(up.parent) || ts.isCallExpression(up.parent)) {
          up = up.parent;
        }
        expect(ts.isAwaitExpression(up.parent)).toBe(false);
      }
    });
  }
});

describe('Z1: the questions a card puts to Claude are fixed texts', () => {
  const make = readFileSync(join(SRC, 'card', 'make.ts'), 'utf8');
  const queue = readFileSync(join(SRC, 'card', 'queue.ts'), 'utf8');

  it('the state holds a topic and a handle, never a text', () => {
    expect(queue).toMatch(/readonly kind: 'ask'; readonly topic: 'why'; readonly handle: string/u);
    expect(queue).toMatch(/readonly kind: 'ask'; readonly topic: 'migrate'/u);
    expect(queue).not.toMatch(/readonly message\b/u);
  });

  it('askMessage has the two topics, each a fixed text, and a handle goes in only when it is one', () => {
    const body = /export function askMessage[\s\S]*?\n\}\n/u.exec(make)?.[0] ?? '';
    expect(body).toContain("effect.topic === 'migrate'");
    expect(body).toContain('isHandle(effect.handle) ? whyMessage(effect.handle) : undefined');
    // Every message says that it is a question and not a consent.
    expect(make.match(/\$\{NOT_CONSENT\}/gu)).toHaveLength(2);
    expect(make).toContain("const NOT_CONSENT = 'It is a question, not consent");
  });
});

describe('Z1: every call back into the server is on the closed list', () => {
  for (const [name, code, scope] of MODULES) {
    const known = constants(scope);
    const calls = mcpCalls(code, known);

    it(`${name}: each $.mcp.call names the LoadCraft server and a listed tool as literals`, () => {
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        const where = `${name}: ${call.node.getText().slice(0, 120)}`;
        expect(call.server, where).toBe(SERVER);
        expect(call.tool, where).toBeDefined();
        expect(call.tool, `${where}: run_start is never called by the mod`).not.toBe('run_start');
        expect(
          READ_ONLY_TOOLS.has(call.tool ?? '') || AFTER_CONSENT_TOOLS.has(call.tool ?? ''),
          `${where}: ${call.tool} is not on the list`,
        ).toBe(true);
      }
    });

    it(`${name}: $.mcp is used only to call, never kept, connected or passed on`, () => {
      for (const node of nodes(code.file)) {
        if (!ts.isPropertyAccessExpression(node) || !isDollar(node.expression)) continue;
        if (node.name.text !== 'mcp') continue;
        const outer = node.parent;
        const isCall =
          ts.isPropertyAccessExpression(outer) &&
          outer.name.text === 'call' &&
          ts.isCallExpression(outer.parent) &&
          outer.parent.expression === outer;
        expect(isCall, `${name}: ${outer.getText().slice(0, 80)}`).toBe(true);
      }
    });

    it(`${name}: a literal process_get_status call only reads`, () => {
      for (const call of calls.filter((item) => item.tool === 'process_get_status')) {
        const args = call.node.arguments[2];
        expect(args, call.node.getText()).toBeDefined();
        if (args === undefined || !ts.isObjectLiteralExpression(args)) continue;
        for (const key of objectKeys(args)) {
          expect(GET_STATUS_KEYS.has(key), `${name}: process_get_status with ${key}`).toBe(true);
        }
      }
    });

    it(`${name}: cancel is called only after the user's yes to the question`, () => {
      const cancels = calls.filter(
        (item) => item.tool !== undefined && AFTER_CONSENT_TOOLS.has(item.tool),
      );
      expect(cancels.length).toBeGreaterThan(0);
      for (const call of cancels) {
        const fn = enclosing(call.node);
        expect(fn, 'a function around the cancel').toBeDefined();
        const own = ownNodes(fn as FunctionLike);
        const before = (node: Ts.Node): boolean => node.end <= call.node.getStart();
        const asked = own.some(
          (node) =>
            before(node) &&
            ts.isCallExpression(node) &&
            dollarChain(node.expression) === '$.ui.ask',
        );
        const gated = own.some(
          (node) =>
            before(node) &&
            ts.isIfStatement(node) &&
            /\bsettle\(/u.test(node.expression.getText()) &&
            /!==\s*["']allow["']/u.test(node.expression.getText()) &&
            (ts.isReturnStatement(node.thenStatement) ||
              (ts.isBlock(node.thenStatement) &&
                node.thenStatement.statements.length === 1 &&
                ts.isReturnStatement(node.thenStatement.statements[0]!))),
        );
        expect(asked, `${name}: the cancel follows $.ui.ask in its function`).toBe(true);
        expect(gated, `${name}: the cancel follows "if (settle(...) !== 'allow') return"`).toBe(
          true,
        );
      }
    });
  }
});

describe('Z1: a tool call hook never answers in place of the tool nor rewrites it', () => {
  for (const [name, code] of MODULES) {
    const all = registrations(code);
    const toolHooks = all.filter((item) => item.event === 'tool.call');

    it(`${name}: there are three tool.call hooks, each with a .catch`, () => {
      expect(toolHooks).toHaveLength(3);
      for (const item of toolHooks) {
        expect(item.hook, registrationName(item)).toBeDefined();
        expect(item.handler, `${registrationName(item)}: .catch`).toBeDefined();
      }
    });

    it(`${name}: no tool.call hook builds a { result } (a result is never replaced)`, () => {
      for (const item of toolHooks) {
        for (const fn of [item.hook, item.handler]) {
          if (fn === undefined) continue;
          for (const node of nodes(fn)) {
            expect(objectKeys(node), `${name}: ${node.getText().slice(0, 80)}`).not.toContain(
              'result',
            );
          }
        }
      }
    });

    it(`${name}: every next of a tool.call hook passes the event as it came`, () => {
      for (const item of toolHooks) {
        for (const fn of [item.hook, item.handler]) {
          if (fn === undefined) continue;
          for (const node of nodes(fn)) {
            if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) continue;
            if (node.expression.text !== 'next') continue;
            expect(isNextOfE(node), `${name}: ${node.getText()}`).toBe(true);
          }
        }
      }
    });

    it(`${name}: only the consent hook refuses, and its .catch passes the call on`, () => {
      for (const item of toolHooks) {
        const guarded = item.matcher === undefined ? undefined : matcherValue(item.matcher, 'tool');
        const isConsent = guarded !== undefined && ts.isArrayLiteralExpression(guarded);
        const denies = nodes(item.hook as Ts.Node).some((node) =>
          objectKeys(node).includes('deny'),
        );
        expect(denies, registrationName(item)).toBe(isConsent);
        const handler = item.handler as FunctionLike;
        const body = handler.body;
        expect(body !== undefined && isNextOfE(body), `${name}: ${handler.getText()}`).toBe(true);
      }
    });

    it(`${name}: the state hook returns what next returned, untouched`, () => {
      const state = toolHooks.find((item) => {
        const value = item.matcher === undefined ? undefined : matcherValue(item.matcher, 'tool');
        return value !== undefined && ts.isRegularExpressionLiteral(value);
      });
      expect(state?.hook).toBeDefined();
      const hook = state?.hook as FunctionLike;
      const own = ownNodes(hook);
      const assignments = own.filter(
        (node): node is Ts.BinaryExpression =>
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(node.left) &&
          node.left.text === 'result',
      );
      expect(assignments).toHaveLength(1);
      const [assigned] = assignments;
      expect(
        assigned !== undefined &&
          ts.isAwaitExpression(assigned.right) &&
          isNextOfE(assigned.right.expression),
        `${name}: result = await next(e)`,
      ).toBe(true);
      const returns = own.filter(ts.isReturnStatement);
      expect(returns.length).toBeGreaterThan(0);
      for (const statement of returns) {
        const value = statement.expression;
        expect(
          value !== undefined && ts.isIdentifier(value) && value.text === 'result',
          `${name}: ${statement.getText()}`,
        ).toBe(true);
      }
    });
  }
});

describe('the hooks and calls that claude plugin validate lists', () => {
  for (const [name, code] of MODULES) {
    const all = registrations(code);

    it(`${name}: hooks only the allowed events and drawings, each by a literal name`, () => {
      expect(all.length).toBeGreaterThan(0);
      for (const item of all) {
        expect(item.event, item.call.getText().slice(0, 80)).toBeDefined();
        expect(EVENTS.has(item.event ?? ''), `${name}: ${item.event}`).toBe(true);
        if (item.event === 'ui.render') {
          const component =
            item.matcher === undefined ? undefined : matcherValue(item.matcher, 'component');
          const value =
            component !== undefined && ts.isStringLiteral(component) ? component.text : '';
          expect(COMPONENTS.has(value), `${name}: ui.render ${value}`).toBe(true);
        }
      }
    });

    it(`${name}: the hooks are the ones validate-expected.json lists, in order`, () => {
      expect(all.map(registrationName)).toEqual(listOf(EXPECTED['hooks'] as string));
    });

    it(`${name}: the calls on $ are the ones validate-expected.json lists`, () => {
      const used = new Set<string>();
      for (const node of nodes(code.file)) {
        if (!ts.isCallExpression(node)) continue;
        const chain = dollarChain(node.expression);
        if (chain !== undefined) used.add(chain);
        // `read($, atom)` and `update($, atom, …)` of `claude-code` read and write `$.state`.
        if (ts.isIdentifier(node.expression) && node.arguments.some(isDollar)) {
          if (node.expression.text === 'read') used.add('$.state.get');
          if (node.expression.text === 'update') {
            used.add('$.state.get');
            used.add('$.state.set');
          }
        }
      }
      expect([...used].sort()).toEqual(listOf(EXPECTED['calls'] as string).sort());
    });
  }

  it('each atom of $.state is declared once and written from one function only', () => {
    const declared =
      REGISTER_TS.bare.match(/atom\(\{ plugin: 'loadcraft', key: '(\w+)' \}/gu) ?? [];
    expect(declared.map((item) => /key: '(\w+)'/u.exec(item)?.[1]).sort()).toEqual(
      [...ATOMS].sort(),
    );
    expect(listOf(EXPECTED['state writes'] as string)).toEqual(
      [...ATOMS].map((atom) => `loadcraft.${atom}`).sort(),
    );
    for (const atom of ATOMS) {
      const writers = new Set<FunctionLike | undefined>();
      for (const node of nodes(REGISTER_TS.file)) {
        if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) continue;
        if (node.expression.text !== 'update') continue;
        const target = node.arguments[1];
        if (target !== undefined && ts.isIdentifier(target) && target.text === atom) {
          // The writer is the outermost function below register (a top-level helper or a hook).
          let fn = enclosing(node);
          while (fn !== undefined && enclosing(fn) !== undefined && !ts.isFunctionDeclaration(fn)) {
            const up = enclosing(fn);
            if (up !== undefined && ts.isFunctionDeclaration(up) && up.name?.text === 'register')
              break;
            fn = up;
          }
          writers.add(fn);
        }
      }
      expect(writers.size, `writers of ${atom}`).toBe(1);
    }
    expect(/\$\s*\.\s*state\s*\.\s*set\b/u.test(REGISTER_TS.bare)).toBe(false);
    const stores = nodes(REGISTER_TS.file).filter(
      (node): node is Ts.CallExpression =>
        ts.isCallExpression(node) && dollarChain(node.expression) === '$.store.set',
    );
    // The keys of the cards go through one helper, which is called with the two known keys only.
    expect(stores.map((node) => node.arguments[0]?.getText()).sort()).toEqual([
      'AUTO_OPEN_KEY',
      'name',
    ]);
    const remembered = nodes(REGISTER_TS.file).filter(
      (node): node is Ts.CallExpression =>
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'rememberKeys',
    );
    expect(remembered.map((node) => node.arguments[1]?.getText()).sort()).toEqual([
      'CARDS_CLOSED_KEY',
      'CARDS_TOLD_KEY',
    ]);
  });
});
