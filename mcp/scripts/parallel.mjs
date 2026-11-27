// Runs the commands given as arguments side by side and exits with 1 when any of them fails.
// The output of each is printed whole, in the order the arguments were given, so a failure of one
// is not interleaved with the others. Used by `lint` and `typecheck` (see package.json).

import { spawn } from 'node:child_process';

function run(command) {
  return new Promise((done) => {
    const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.once('error', (error) => done({ command, code: 1, output: String(error) }));
    child.once('close', (code) => done({ command, code: code ?? 1, output }));
  });
}

const results = await Promise.all(process.argv.slice(2).map(run));
for (const { command, code, output } of results) {
  if (code !== 0) process.stderr.write(`FAILED (${String(code)}): ${command}\n`);
  if (output !== '') process.stderr.write(output.endsWith('\n') ? output : `${output}\n`);
}
process.exitCode = results.some((result) => result.code !== 0) ? 1 : 0;
