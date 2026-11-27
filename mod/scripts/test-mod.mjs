// Runs the mod's hook tests (mod/tests/*.test.ts) with `claude plugin test`, after checking that
// `claude plugin validate` lists the hooks and calls of mod/test/validate-expected.json (the list a
// reviewer reads; mod/test/safety.spec.ts checks the same list against the code).
//
// `claude plugin test <dir>` needs the plugin root (the folder with hooks/hooks.json) and collects
// every *.test.ts and *.test.tsx under it, skipping only node_modules and dot folders. Run on this
// repository it would also pick up the server's vitest files in mcp/test, which cannot load in the
// mods environment. So the mod is copied into a temporary plugin folder that holds only what the
// hook tests need: the manifest, hooks/, the built mod/register.js and mod/tests.

import { execFile, spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');
const STAGED = [
  '.claude-plugin/plugin.json',
  '.mcp.json',
  'hooks',
  'mod/register.js',
  'mod/types',
  'mod/tests',
];

function claudePluginTest(dir) {
  return new Promise((done) => {
    const child = spawn('claude', ['plugin', 'test', dir], { stdio: 'inherit' });
    child.once('error', (error) => {
      process.stderr.write(`test-mod: cannot start claude (${error.message})\n`);
      done(1);
    });
    child.once('exit', (code) => done(code ?? 1));
  });
}

/** What `claude plugin validate` prints for the plugin in `dir`, and its exit code. */
function claudePluginValidate(dir) {
  return new Promise((done) => {
    execFile(
      'claude',
      ['plugin', 'validate', dir],
      { maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        done({
          code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
          out: `${stdout}${stderr}`,
        });
      },
    );
  });
}

/**
 * The lines of the hooks module under `label` (`hooks`, `calls`, …). A long list continues on more
 * lines with the same label; they are joined as one list.
 */
function linesOf(out, label) {
  const prefix = `../mod/register.js ${label}: `;
  return out
    .split('\n')
    .map((line) => line.replace(/^\s*❯\s*/u, ''))
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
}

async function checkValidate() {
  const expected = JSON.parse(
    await readFile(join(REPO, 'mod', 'test', 'validate-expected.json'), 'utf8'),
  );
  const { code, out } = await claudePluginValidate(REPO);
  if (code !== 0) {
    process.stderr.write(`test-mod: claude plugin validate failed (exit ${code})\n${out}\n`);
    return 1;
  }
  let failed = 0;
  for (const [label, want] of Object.entries(expected)) {
    const lines = linesOf(out, label);
    const got = Array.isArray(want) ? lines : lines.join(', ');
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failed = 1;
      process.stderr.write(
        `test-mod: claude plugin validate lists another "${label}" than mod/test/validate-expected.json\n` +
          `  expected: ${JSON.stringify(want)}\n  printed:  ${JSON.stringify(got)}\n`,
      );
    }
  }
  if (failed === 0)
    process.stdout.write('test-mod: claude plugin validate lists the expected hooks and calls\n');
  return failed;
}

// The folder name becomes the plugin's name in the test kit; keep the real one.
const parent = await mkdtemp(join(tmpdir(), 'lc-mod-test-'));
const root = join(parent, 'loadcraft');
try {
  for (const path of STAGED) {
    await cp(join(REPO, path), join(root, path), { recursive: true });
  }
  const validated = await checkValidate();
  const tested = await claudePluginTest(root);
  process.exitCode = validated !== 0 ? validated : tested;
} finally {
  await rm(parent, { recursive: true, force: true });
}
