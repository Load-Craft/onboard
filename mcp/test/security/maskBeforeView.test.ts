// A view reshapes text from outside before the result filter sees it: `wrap()` breaks lines on
// spaces, `inline()` turns tabs into spaces, collapses runs of spaces and cuts a long text. A secret
// registered in the call must be gone before any of that happens, so the registry masks the data and
// the error first and filters the finished text after.
import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { defineTool } from '../../src/registry.js';
import { LoadcraftApiError } from '../../src/http/apiError.js';
import { inline, wrap } from '../../src/render/primitives.js';
import { CANARY, toolRig } from '../helpers/rig.js';

const PASSPHRASE = 'correct horse battery staple sklep 2026';
const TABBED = 'Pw\tSklep-2026!';

const echo = defineTool({
  name: 'reshape_echo',
  title: 'Reshape echo',
  description:
    'Probe: registers a secret and draws it wrapped or on one line. Does not modify anything.',
  annotations: { readOnlyHint: true },
  input: z.object({ mode: z.enum(['wrap', 'inline']) }),
  run(ctx, args) {
    const said = args.mode === 'wrap' ? PASSPHRASE : TABBED;
    ctx.secrets.add(said);
    return Promise.resolve({
      status: 'done' as const,
      data: { said: `${'x'.repeat(50)} ${said}` },
    });
  },
  render(data: { said: string }, _t, args) {
    return args.mode === 'wrap' ? wrap(data.said, 77, 2).join('\n') : inline(data.said);
  },
});

const failing = defineTool({
  name: 'reshape_fail',
  title: 'Reshape fail',
  description:
    'Probe: fails the way a backend refusal with an unknown code does. Does not modify anything.',
  annotations: { readOnlyHint: true },
  input: z.object({}),
  run() {
    // A backend refusal with an unknown code that quotes the token near the 300-character cut.
    return Promise.reject(
      new LoadcraftApiError({
        status: 409,
        code: 'something_new',
        message: `${'y'.repeat(276)} token ${CANARY}`,
      }),
    );
  },
  render: () => '',
});

describe('a secret the view reshapes is masked before it is reshaped', () => {
  it('a passphrase wrapped over two lines', async () => {
    const r = await toolRig({ tools: [echo] });
    const result = await r.call('reshape_echo', { mode: 'wrap' });
    expect(result.text).toContain('[redacted]');
    expect(result.text).not.toContain('battery');
  });

  it('a password with a tab that inline() turns into a space', async () => {
    const r = await toolRig({ tools: [echo] });
    const result = await r.call('reshape_echo', { mode: 'inline' });
    expect(result.text).toContain('[redacted]');
    expect(result.text).not.toContain('Sklep-2026');
  });

  it('a token cut by the 300-character quote of an unknown backend code', async () => {
    const r = await toolRig({ tools: [failing] });
    const result = await r.call('reshape_fail', {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[redacted]');
    expect(result.text).not.toContain(CANARY.slice(0, 8));
  });
});
