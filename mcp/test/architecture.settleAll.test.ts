// Reads of one tool call that are sent at once are joined with `settleAll`, never `Promise.all`: a
// failed read ends the call and the log of the call writes the backend's error text, while a read
// still in flight has not yet registered the secrets of its answer, so a quote of one of them in that
// text would stay unmasked. `settleAll` waits for every read first. A new `Promise.all` under src is a
// finding unless the file is listed here with the reason it joins no read of the backend.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '..', 'src');

/** File (relative to src) to the number of `Promise.all` calls it may keep, with why. */
const EXCEPTIONS: Readonly<Record<string, { readonly count: number; readonly why: string }>> = {
  'http/upload.ts': {
    count: 1,
    why: 'closes file handles of the local machine, no read of the backend.',
  },
  'demo/index.ts': {
    count: 1,
    why: 'removes local state files of the demo, no read of the backend.',
  },
};

/** Lines of the `Promise.all` calls in `text`. */
export function promiseAllCalls(file: string, text: string): number[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Promise' &&
      node.expression.name.text === 'all'
    ) {
      lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('reads are joined with settleAll', () => {
  it('no file under src uses Promise.all beyond the listed exceptions', () => {
    const findings = sourceFiles(SRC).flatMap((path) => {
      const file = relative(SRC, path).split('\\').join('/');
      const lines = promiseAllCalls(file, readFileSync(path, 'utf8'));
      const allowed = EXCEPTIONS[file]?.count ?? 0;
      return lines.length > allowed
        ? [`${file}: Promise.all at line ${lines.join(', ')} (allowed ${String(allowed)})`]
        : [];
    });
    expect(findings).toEqual([]);
  });

  it('every listed exception still exists', () => {
    for (const [file, { count }] of Object.entries(EXCEPTIONS)) {
      const lines = promiseAllCalls(file, readFileSync(join(SRC, file), 'utf8'));
      expect(lines, file).toHaveLength(count);
    }
  });

  it('finds a Promise.all, also one nested in an arrow', () => {
    const text = 'const a = () => Promise.all([f()]);\nconst b = Promise.allSettled([]);';
    expect(promiseAllCalls('x.ts', text)).toEqual([1]);
  });
});
