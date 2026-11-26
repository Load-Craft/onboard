// Runs `tsc --noEmit` in a plugin folder and groups what it prints by file and by tool.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export interface CompileError {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: string;
  readonly message: string;
}

export interface TypecheckResult {
  readonly ok: boolean;
  readonly errors: readonly CompileError[];
  /** Output lines that are not an error line (for example a broken tsconfig); empty when all parsed. */
  readonly other: readonly string[];
}

const LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

export function parseTscOutput(output: string): TypecheckResult {
  const errors: CompileError[] = [];
  const other: string[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.trimEnd();
    if (line === '') continue;
    const match = LINE.exec(line);
    if (match !== null) {
      errors.push({
        file: (match[1] ?? '').replaceAll('\\', '/'),
        line: Number(match[2]),
        column: Number(match[3]),
        code: match[4] ?? '',
        message: match[5] ?? '',
      });
    } else if (!/^\s/.test(raw)) {
      other.push(line);
    }
  }
  return { ok: errors.length === 0 && other.length === 0, errors, other };
}

/** `mcpDir` holds `tsconfig.json`; the compiler is the one the plugin itself depends on. */
export function runTypecheck(mcpDir: string): Promise<TypecheckResult> {
  const tsc = createRequire(join(mcpDir, 'package.json')).resolve('typescript/bin/tsc');
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [tsc, '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'],
      {
        cwd: mcpDir,
      },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', fail);
    child.on('close', (code) => {
      const parsed = parseTscOutput(output);
      done(code === 0 ? { ok: true, errors: [], other: [] } : { ...parsed, ok: false });
    });
  });
}
