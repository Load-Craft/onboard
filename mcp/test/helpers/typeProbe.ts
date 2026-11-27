// Compiles small TypeScript snippets against the plugin's own sources and says which of them
// have type errors. A test uses it to pin what the type machinery accepts and refuses, so the
// signal is in the test result and not only in `tsc` over the test file.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import ts from 'typescript';

const MCP = resolve(import.meta.dirname, '..', '..');

export interface ProbeCase {
  readonly name: string;
  /** Statements; they may use the imports of `prelude` and `src` (see below). */
  readonly code: string;
}

/** The type errors of each case, by name (an empty list: the snippet compiles). */
export function compileCases(prelude: string, cases: readonly ProbeCase[]): Map<string, string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'lc-probe-'));
  try {
    const lines = [...prelude.split('\n'), ''];
    const ranges = new Map<string, [number, number]>();
    for (const { name, code } of cases) {
      const body = [`{`, ...code.split('\n'), `}`];
      ranges.set(name, [lines.length + 1, lines.length + body.length]);
      lines.push(...body);
    }
    const file = join(dir, 'probe.ts');
    writeFileSync(file, `${lines.join('\n')}\n`);
    const program = ts.createProgram([file], {
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      noEmit: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      target: ts.ScriptTarget.ES2023,
      lib: ['lib.es2023.d.ts'],
      types: [],
      skipLibCheck: true,
      paths: { zod: [join(MCP, 'node_modules', 'zod')] },
    });
    const result = new Map<string, string[]>([...ranges.keys()].map((name) => [name, []]));
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
      if (diagnostic.file?.fileName !== file || diagnostic.start === undefined) {
        if (diagnostic.file === undefined || diagnostic.file.fileName === file) {
          result
            .get([...ranges.keys()][0] ?? '')
            ?.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
        }
        continue;
      }
      const line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
      const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      const owner = [...ranges].find(([, [from, to]]) => line >= from && line <= to);
      (owner === undefined
        ? (result.get('prelude') ?? result.set('prelude', []).get('prelude'))
        : result.get(owner[0])
      )?.push(text);
    }
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const SRC = join(MCP, 'src');
