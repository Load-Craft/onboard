// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest: the kit comes
// from 'claude-code/testing', and the mod is loaded from hooks/hooks.json as a session would.
import { expect, test } from 'claude-code/testing';

// The manifest's userConfig has a required token without a default; a load without it fails.
// The value is a test sentinel, never a real token.
const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a' } };

test('the mod loads and session.start returns what next returns', CONFIGURED, async ($, on) => {
  // Stands for Claude Code's own answer after the mod passes the event on.
  on('session.start', () => ({ cwd: '/work' }));

  const result = await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });

  expect(result).toEqual({ cwd: '/work' });
});

test('session.start passes through when nothing draws (claude -p)', CONFIGURED, async ($, on) => {
  on('session.start', () => ({ cwd: '/work' }));

  const result = await $.session.start({ surface: null, isInteractive: false, cwd: '/work' });

  expect(result).toEqual({ cwd: '/work' });
});

test('without the API token Claude Code does not load the mod', async ($, on) => {
  on('session.start', () => ({ cwd: '/work' }));

  await expect(
    $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' }),
  ).rejects.toThrow('options do not fit plugin.json userConfig');
});
