import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../hooks/session-start.mjs', import.meta.url));
const HOOKS_JSON = fileURLToPath(new URL('../../hooks/hooks.json', import.meta.url));
const CANARY = 'CANARY-SECRET-7f3a';

function runHook(env: Record<string, string>) {
  const clean: Record<string, string> = { PATH: process.env['PATH'] ?? '' };
  return spawnSync(process.execPath, [SCRIPT], {
    env: { ...clean, ...env },
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }),
    encoding: 'utf8',
    timeout: 2000,
  });
}

describe('SessionStart hook script', () => {
  it('prints nothing and exits 0 when the token is present', () => {
    const r = runHook({ CLAUDE_PLUGIN_OPTION_API_TOKEN: CANARY });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('prints one line pointing to /loadcraft:doctor when the token is missing', () => {
    const r = runHook({});
    expect(r.status).toBe(0);
    const lines = r.stdout.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('/loadcraft:doctor');
    expect(lines[0]).toContain('API token');
  });

  it('treats an empty token as missing', () => {
    const r = runHook({ CLAUDE_PLUGIN_OPTION_API_TOKEN: '' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('/loadcraft:doctor');
  });

  it('never echoes the token value', () => {
    for (const env of [
      { CLAUDE_PLUGIN_OPTION_API_TOKEN: CANARY },
      { LOADCRAFT_API_TOKEN: CANARY },
    ]) {
      const r = runHook(env);
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).not.toContain(CANARY);
    }
  });

  it('still warns when started through a symlink to the script or its directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hook-link-'));
    try {
      const fileLink = join(dir, 'link.mjs');
      symlinkSync(SCRIPT, fileLink);
      const dirLink = join(dir, 'hooks');
      symlinkSync(fileURLToPath(new URL('../../hooks', import.meta.url)), dirLink);
      for (const target of [fileLink, join(dirLink, 'session-start.mjs')]) {
        const r = spawnSync(process.execPath, [target], {
          env: { PATH: process.env['PATH'] ?? '' },
          encoding: 'utf8',
          timeout: 2000,
        });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('/loadcraft:doctor');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an unsupported Node version and still exits 0', async () => {
    const mod = (await import(SCRIPT)) as {
      diagnose: (nodeVersion: string, env: Record<string, string | undefined>) => string[];
    };
    const env = { CLAUDE_PLUGIN_OPTION_API_TOKEN: CANARY };
    expect(mod.diagnose('22.17.0', env)).toEqual([]);
    expect(mod.diagnose('24.1.0', env)).toEqual([]);
    expect(mod.diagnose('22.16.9', env)).toHaveLength(1);
    expect(mod.diagnose('20.11.0', env)[0]).toContain('/loadcraft:doctor');
    expect(mod.diagnose('20.11.0', env)[0]).not.toContain(CANARY);
    expect(mod.diagnose('20.11.0', {})).toHaveLength(2);
  });
});

describe('hooks.json', () => {
  it('is valid JSON with a hooks key wiring SessionStart to the script with a short timeout', () => {
    const parsed = JSON.parse(readFileSync(HOOKS_JSON, 'utf8')) as {
      hooks: Record<string, { hooks: { type: string; command: string; timeout?: number }[] }[]>;
    };
    expect(parsed).toHaveProperty('hooks');
    const handler = parsed.hooks['SessionStart']?.[0]?.hooks[0];
    expect(handler?.type).toBe('command');
    expect(handler?.command).toBe('node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs"');
    expect(handler?.timeout).toBe(2);
  });
});
