// Vitest file (see capabilities.spec.ts for why it is not named *.test.ts).
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const REPO = resolve(import.meta.dirname, '..', '..');
const CHECK = join(REPO, 'mod', 'scripts', 'check-mod.mjs');
const BUILT = join(REPO, 'mod', 'register.js');

async function check(committed: string): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await run(process.execPath, [CHECK, '--committed', committed]);
    return { code: 0, stderr };
  } catch (error) {
    const failed = error as { code?: number; stderr?: string };
    return { code: failed.code ?? -1, stderr: failed.stderr ?? '' };
  }
}

describe('check-mod', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lc-mod-check-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('passes for the committed mod/register.js', async () => {
    const copy = join(dir, 'register.js');
    await copyFile(BUILT, copy);
    expect(await check(copy)).toEqual({ code: 0, stderr: '' });
  }, 20_000);

  it('fails after a hand edit of mod/register.js', async () => {
    const copy = join(dir, 'register.js');
    const text = await readFile(BUILT, 'utf8');
    await writeFile(copy, text.replace('"session.start"', '"session.end"'));
    const result = await check(copy);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('npm run build:mod');
  }, 20_000);

  it('fails when the built file is missing', async () => {
    const result = await check(join(dir, 'absent.js'));
    expect(result.code).toBe(1);
  }, 20_000);
});

describe('mod/register.js', () => {
  it('keeps register as a top-level function and the event name as a literal', async () => {
    const text = await readFile(BUILT, 'utf8');
    // `options` carries the plugin's userConfig values (the mod reads only `locale`).
    expect(text).toMatch(/(?:^|[;}\n])function register\(on,\s*options\)/);
    expect(text).toMatch(/export\s*\{\s*register\s*\};?\s*$/);
    expect(text).toContain('on("session.start",');
  });

  it("stays small and carries no server text beyond the mod's own", async () => {
    const text = await readFile(BUILT, 'utf8');
    // What fills it: the step band (about 5 KB), the status line and notices, the consent dialog
    // (about 39 KB with its own texts), and the result drawings with the texts they draw with
    // (about 47 KB: report, outline, diagnosis, split, tree and `results.ts`), the side panel
    // (about 21 KB: tabs, cancel question, its texts), the list of the panel with its filter, preview and
    // groups (about 13 KB, view/list.ts and the Path tab), the cards above the prompt (about 17 KB: queue, the
    // cards of the end of an operation, of old documentation and of profile fields, their drawing and
    // actions, the texts), the lists of the status channel (about 25 KB: flows, steps, runs, their
    // reads, drawing and fixed messages, the texts in both languages), the self-check of the Run tab (about 21 KB:
    // the view read with the bars, its states, steps and attempts on the common list, the card of a failure, the
    // question about a step, the texts in both languages) and the progress line of MOD-08 (estimate). The
    // server's whole dictionaries, which it must not pull in, are about 150 KB.
    // The limit is this project's own guard, not a platform limit (nothing in the mods reference or
    // types states one). The built file is minified for whitespace only, about 203 KB with the self-check
    // (156 KB when this was set): 220 KB leaves room for about one more view, and still fails at once if a
    // whole server dictionary (about 150 KB) is imported by mistake.
    expect(Buffer.byteLength(text)).toBeLessThan(220_000);
    expect(text).toContain('Dokumentacja API');
    // Keys the mod never uses, from views of other tools: a whole dictionary would carry them.
    for (const foreign of [
      'error.setup_incomplete',
      'initProject.header.reused',
      'data.state.short_rows',
      'link.projectProfile',
    ]) {
      expect(text).not.toContain(foreign);
    }
  });

  it('imports only from claude-code and uses no Node API', async () => {
    const text = await readFile(BUILT, 'utf8');
    // The built file is minified (whitespace only), so imports are found by shape, not by line (a string "import" in a dictionary is not one).
    const sources = [
      ...text.matchAll(/(?<=^|[;}\n])import\s*(?:[^;"'(]*?\bfrom\s*)?"([^"]+)"/g),
    ].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source === 'claude-code')).toBe(true);
    expect(text).not.toMatch(/(?<=^|[;}\n])import\s*\(/);
    expect(text).not.toMatch(/\brequire\(|\bprocess\.|node:/);
  });
});

describe('hooks/hooks.json', () => {
  it('names the mod under modules beside the untouched SessionStart hook', async () => {
    const json = JSON.parse(await readFile(join(REPO, 'hooks', 'hooks.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(json.modules).toEqual(['../mod/register.js']);
    expect(json.hooks).toEqual({
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs"',
              timeout: 2,
            },
          ],
        },
      ],
    });
    expect(Object.keys(json).sort()).toEqual(['hooks', 'modules']);
  });
});
