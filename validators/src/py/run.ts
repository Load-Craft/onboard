// Process wiring shared by the four validators: collect what a Python `main()` would print, then
// write it and set the exit status. The process is never cut short with `process.exit`, so output
// piped to a reader is flushed.

import { Exit } from './argparse.ts';
import { PyCrash, PyOSError } from './io.ts';
import { PyRecursionError } from './json.ts';

export class Output {
  stdout = '';
  stderr = '';

  print(text: string): void {
    this.stdout += `${text}\n`;
  }

  eprint(text: string): void {
    this.stderr += `${text}\n`;
  }
}

export function runMain(main: (out: Output, argv: string[], prog: string) => number): void {
  const out = new Output();
  const argv = process.argv.slice(2);
  const script = process.argv[1] ?? 'validate.mjs';
  const prog = script.slice(script.lastIndexOf('/') + 1);
  let status: number;
  try {
    status = main(out, argv, prog);
  } catch (error) {
    if (error instanceof Exit) {
      out.stdout += error.stdout;
      out.stderr += error.stderr;
      status = error.status;
    } else if (error instanceof PyOSError) {
      out.stderr += `${error.kind}: ${error.message}\n`;
      status = 1;
    } else if (error instanceof PyRecursionError) {
      out.stderr += 'RecursionError: maximum recursion depth exceeded\n';
      status = 1;
    } else if (error instanceof PyCrash) {
      out.stderr += `${error.pyType}: ${error.message}\n`;
      status = 1;
    } else throw error;
  }
  if (out.stdout !== '') process.stdout.write(out.stdout);
  if (out.stderr !== '') process.stderr.write(out.stderr);
  process.exitCode = status;
}
