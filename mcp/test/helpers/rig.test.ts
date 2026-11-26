import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';

import { ToolError } from '../../src/errors.js';
import { defineTool } from '../../src/registry.js';
import { CANARY } from './canary.js';
import { closedPort, rejection, waitFor } from './async.js';
import { toolRig } from './rig.js';

const echo = defineTool({
  name: 'echo_meta',
  title: 'Echo meta',
  description: 'Echo: asks the backend for its meta. Does not modify anything.',
  input: z.object({}),
  annotations: { readOnlyHint: true },
  async run(ctx) {
    const { data } = await ctx.services.http.GET('/api/v1/meta');
    return { status: 'done' as const, data: { version: data?.version ?? '?' } };
  },
  render: (data) => `backend ${data.version}`,
});

const leaky = defineTool({
  name: 'leak_token',
  title: 'Leak token',
  description: 'Leak: writes the API token to a file in the workspace, which no masker covers.',
  input: z.object({}),
  annotations: { readOnlyHint: true },
  run(ctx) {
    const dir = join(ctx.config.workspaceRoot, 'loadcraft');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'leak.txt'), ctx.config.token.reveal());
    return Promise.resolve({ status: 'done' as const, data: {} });
  },
  render: () => 'leaked',
});

const broken = defineTool({
  name: 'broken',
  title: 'Broken',
  description: 'Broken: always throws an unexpected error. Does not modify anything.',
  input: z.object({}),
  annotations: { readOnlyHint: true },
  run: () => Promise.reject(new Error('boom')),
  render: () => '',
});

describe('toolRig', () => {
  it('connects a client to the tools, the fake backend and a temporary workspace', async () => {
    const rig = await toolRig({ tools: [echo], fake: { meta: { version: '7.7.7' } } });
    const result = await rig.call('echo_meta', {});
    expect(result.isError).toBe(false);
    expect(result.text).toContain('backend 7.7.7');
    expect(rig.fake.calls.map((call) => call.path)).toContain('/api/v1/meta');
    expect(existsSync(rig.workspace)).toBe(true);
    expect(rig.config.workspaceRoot).toBe(rig.workspace);
  });

  it('applies the world to the fake before the first call', async () => {
    const rig = await toolRig({
      tools: [echo],
      world: (fake) => {
        fake.faults.next('GET', '/api/v1/meta', { status: 500, body: { detail: 'down' } });
      },
    });
    const first = await rig.call('echo_meta', {});
    expect(first.isError).toBe(true);
  });

  it('runs the same tools in the legacy era', async () => {
    const rig = await toolRig({ tools: [echo], era: 'legacy' });
    expect(rig.session.protocolVersion).not.toBe('2026-07-28');
    expect((await rig.call('echo_meta', {})).isError).toBe(false);
  });

  it('feeds the clock to the fake and the server', async () => {
    const rig = await toolRig({ tools: [echo] });
    expect(rig.clock.now()).toBe(0);
    await rig.clock.advance(1500);
    expect(rig.clock.now()).toBe(1500);
  });

  it('exposes log lines, parsed by level', async () => {
    const rig = await toolRig({ tools: [broken] });
    const result = await rig.call('broken', {});
    expect(result.isError).toBe(true);
    const errors = rig.logRecords('error');
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain('boom');
  });

  it('lets a test seed files in the workspace', async () => {
    const rig = await toolRig({ tools: [echo], files: { 'data/a.txt': 'hello' } });
    expect(existsSync(join(rig.workspace, 'data', 'a.txt'))).toBe(true);
  });

  it('applies env overrides to the config', async () => {
    const rig = await toolRig({ tools: [echo], env: { LOADCRAFT_LOCALE: 'pl' } });
    expect(rig.config.locale).toBe('pl');
  });

  it('checks for the canary itself when asked to, naming the leak', async () => {
    const rig = await toolRig({ tools: [leaky] });
    await rig.call('leak_token', {});
    expect(() => rig.assertClean()).toThrow(/canary secret leaked/);
    // the end-of-test check must not fail this test a second time
    rmSync(join(rig.workspace, 'loadcraft'), { recursive: true, force: true });
  });

  it('finds a canary in the log', async () => {
    const rig = await toolRig({ tools: [echo] });
    // A line the logger did not write: the sink of the rig is the only place the leak can come from.
    (rig.lines as string[]).push(JSON.stringify({ msg: 'token', value: CANARY }));
    expect(() => rig.assertClean()).toThrow(/canary secret leaked/);
    rig.forgetLogs();
    expect(() => rig.assertClean()).not.toThrow();
  });

  it('finds a canary in a result', async () => {
    const rig = await toolRig({ tools: [echo] });
    const result = await rig.call('echo_meta', {});
    (rig.results as unknown[]).push({ ...result, content: [{ type: 'text', text: CANARY }] });
    expect(() => rig.assertClean()).toThrow(/canary secret leaked/);
    rig.forgetResults();
    expect(() => rig.assertClean()).not.toThrow();
  });

  it('refuses a token other than the canary', async () => {
    await expect(
      toolRig({ tools: [echo], env: { LOADCRAFT_API_TOKEN: 'other-token-1' } }),
    ).rejects.toThrow(/must be the canary/);
  });

  it('finds a canary written under the project folder of the workspace', async () => {
    const rig = await toolRig({ tools: [echo] });
    mkdirSync(join(rig.workspace, 'loadcraft'), { recursive: true });
    writeFileSync(join(rig.workspace, 'loadcraft', 'state.txt'), `token=${CANARY}`);
    expect(() => rig.assertClean()).toThrow(/canary secret leaked/);
    writeFileSync(join(rig.workspace, 'loadcraft', 'state.txt'), 'clean');
  });
});

describe('async helpers', () => {
  it('rejection returns the error of a failing promise and fails on success', async () => {
    const error = await rejection(Promise.reject(new ToolError('E')));
    expect(error).toBeInstanceOf(ToolError);
    await expect(rejection(Promise.resolve(1))).rejects.toThrow(/expected the call to fail/);
  });

  it('waitFor resolves once the condition holds and names what it waited for on timeout', async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 10);
    await waitFor(() => ready, 'ready flag');
    await expect(waitFor(() => false, 'never', 50)).rejects.toThrow(/never/);
  });

  it('closedPort gives an address nothing listens on', async () => {
    const url = await closedPort();
    await expect(fetch(`${url}/x`)).rejects.toThrow();
  });
});
