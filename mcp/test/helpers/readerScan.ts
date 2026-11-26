// Finds the Zod readers of backend answers and frames in source files, and says whether each is
// registered with the contract check (`reads()`, `readsTable()`, `sendsTable()`).
//
// Zod values are told by their type (a Zod schema has `_zod`), so a schema built by a helper or
// declared in a function is seen as well as a `z.` chain at the top of a file. A reader is a
// declared Zod value that no other Zod value and no registered reader uses, a declared one that
// is parsed on its own, or a Zod expression parsed on the spot.

import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

const WRAPPERS = new Set(['reads', 'readsTable', 'sendsTable']);
const PARSERS = new Set(['parse', 'safeParse', 'parseAsync', 'safeParseAsync']);
const MCP = resolve(import.meta.dirname, '..', '..');

export interface Found {
  /** `file:name`, `file:name@line` for one declared in a function, or `file:inline@line`. */
  readonly key: string;
  readonly wrapped: boolean;
}

/** Whether `node` is `reads<...>()(...)` and the like. */
function isWrapped(node: ts.Expression): boolean {
  if (!ts.isCallExpression(node)) return false;
  const inner = node.expression;
  return (
    ts.isCallExpression(inner) &&
    ts.isIdentifier(inner.expression) &&
    WRAPPERS.has(inner.expression.text)
  );
}

/** `node` without parentheses, `as` and `satisfies`. */
function strip(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isEmptyObject(node: ts.Expression): boolean {
  const bare = strip(node);
  return ts.isObjectLiteralExpression(bare) && bare.properties.length === 0;
}

interface Declared {
  readonly key: string;
  readonly init: ts.Expression;
  readonly wrapped: boolean;
  readonly zod: boolean;
}

function compilerOptions(): ts.CompilerOptions {
  const path = join(MCP, 'tsconfig.json');
  const read = ts.readConfigFile(path, (file) => ts.sys.readFile(file));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(path));
  return {
    ...parsed.options,
    noEmit: true,
    paths: { zod: [join(MCP, 'node_modules', 'zod')] },
  };
}

/** The readers in `files`; keys are relative to `root`. */
export function findReaders(files: readonly string[], root: string): Found[] {
  const program = ts.createProgram([...files], compilerOptions());
  const checker = program.getTypeChecker();
  const isZodType = (node: ts.Node): boolean =>
    checker.getNonNullableType(checker.getTypeAtLocation(node)).getProperty('_zod') !== undefined;
  const symbolOf = (node: ts.Node): ts.Symbol | undefined => {
    const symbol =
      ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
    return symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  };

  const declared = new Map<ts.Symbol, Declared>();
  const tables = new Map<ts.Symbol, ts.Expression>();
  const inline: Found[] = [];
  const parsedAlone = new Set<ts.Symbol>();
  const users: { readonly owner: ts.Symbol | undefined; readonly node: ts.Node }[] = [];

  for (const file of files) {
    const source = program.getSourceFile(file);
    if (source === undefined) throw new Error(`not in the program: ${file}`);
    const name = relative(root, file);
    const lineOf = (node: ts.Node): number =>
      source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const init = node.initializer;
        const wrapped = isWrapped(init);
        const zod = isZodType(node.name);
        const symbol = symbolOf(node.name);
        if (!zod && !wrapped && symbol !== undefined) tables.set(symbol, init);
        if ((zod || wrapped) && symbol !== undefined) {
          const top = ts.isSourceFile(node.parent.parent.parent);
          const id = top ? node.name.text : `${node.name.text}@${lineOf(node)}`;
          declared.set(symbol, { key: `${name}:${id}`, init, wrapped, zod });
          users.push({ owner: symbol, node: init });
        }
      } else if (ts.isCallExpression(node) && isWrapped(node)) {
        users.push({ owner: undefined, node });
      } else if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        PARSERS.has(node.expression.name.text) &&
        isZodType(node.expression.expression)
      ) {
        const receiver = node.expression.expression;
        if (ts.isIdentifier(receiver)) {
          const symbol = symbolOf(receiver);
          if (symbol !== undefined) parsedAlone.add(symbol);
        } else if (!isWrapped(receiver)) {
          inline.push({ key: `${name}:inline@${lineOf(node)}`, wrapped: false });
          users.push({ owner: undefined, node: receiver });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  // A registry is a table of registered readers (`{ a: readsTable(...)(...), b: {} }`, or a
  // constant holding one); a Zod value looked up in it (`REGISTRY[a][type]`) is registered.
  const registered = new Set([...declared].filter(([, { wrapped }]) => wrapped).map(([s]) => s));
  const holdsRegistered = (node: ts.Expression): boolean => {
    const bare = strip(node);
    if (ts.isIdentifier(bare)) {
      const symbol = symbolOf(bare);
      return symbol !== undefined && registered.has(symbol);
    }
    if (!ts.isObjectLiteralExpression(bare)) return false;
    return bare.properties.every((property) =>
      ts.isShorthandPropertyAssignment(property)
        ? holdsRegistered(property.name)
        : ts.isPropertyAssignment(property) &&
          (holdsRegistered(property.initializer) || isEmptyObject(property.initializer)),
    );
  };
  for (let grown = true; grown;) {
    grown = false;
    for (const [symbol, init] of tables) {
      if (!registered.has(symbol) && holdsRegistered(init)) {
        registered.add(symbol);
        grown = true;
      }
    }
  }
  const lookedUp = (init: ts.Expression): boolean => {
    let current = strip(init);
    if (!ts.isElementAccessExpression(current) && !ts.isPropertyAccessExpression(current)) {
      return false;
    }
    while (ts.isElementAccessExpression(current) || ts.isPropertyAccessExpression(current)) {
      current = strip(current.expression);
    }
    const symbol = ts.isIdentifier(current) ? symbolOf(current) : undefined;
    return symbol !== undefined && registered.has(symbol);
  };

  const parts = new Set<ts.Symbol>();
  const collect = (owner: ts.Symbol | undefined, node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const symbol = symbolOf(node);
      if (symbol !== undefined && symbol !== owner && declared.has(symbol)) parts.add(symbol);
    }
    ts.forEachChild(node, (child) => collect(owner, child));
  };
  for (const { owner, node } of users) collect(owner, node);

  const found: Found[] = [...declared]
    .filter(([symbol, { zod }]) => zod && (!parts.has(symbol) || parsedAlone.has(symbol)))
    .map(([, { key, wrapped, init }]) => ({ key, wrapped: wrapped || lookedUp(init) }));
  return [...found, ...inline];
}
