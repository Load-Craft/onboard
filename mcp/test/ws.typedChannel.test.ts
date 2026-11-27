// The typed client of the generated channels (`src/ws/typedChannel.ts`): addresses with parameters,
// received frames typed by wire type, sent frames typed by channel. The `@ts-expect-error` lines
// are cases tsc must refuse; `npm run typecheck` checks them.

import { describe, expect, it } from 'vitest';

import { channelAddress, encodeClientFrame, parseServerFrame } from '../src/ws/typedChannel.js';

describe('channelAddress', () => {
  it('fills the path parameters and encodes them', () => {
    expect(channelAddress('refine', { job_id: 'job 1/x' })).toBe(
      '/ws/flow-suggestions-refine/job%201%2Fx',
    );
    expect(channelAddress('har', { project_id: 'p1', session_id: 's1' })).toBe(
      '/ws/projects/p1/har/s1',
    );
  });

  it('refuses an empty value or a dot segment', () => {
    expect(() => channelAddress('refine', { job_id: '' })).toThrow(/job_id/);
    expect(() => channelAddress('refine', { job_id: '..' })).toThrow(/job_id/);
  });

  it('is typed by the parameters of the channel', () => {
    expect(() => {
      // @ts-expect-error `run_id` is not a parameter of refine
      channelAddress('refine', { run_id: 'r' });
    }).toThrow(/run_id/);
    expect(() => {
      // @ts-expect-error har needs both parameters
      channelAddress('har', { project_id: 'p' });
    }).toThrow(/session_id/);
  });
});

describe('channelAddress, more', () => {
  it('refuses a parameter the channel does not have', () => {
    const extra = { job_id: 'j', run_id: 'r' } as unknown as Parameters<
      typeof channelAddress<'refine'>
    >[1];
    expect(() => channelAddress('refine', extra)).toThrow(/run_id/);
  });
});

describe('raw frames', () => {
  it('reads a text frame the channel lists as a raw message', () => {
    expect(parseServerFrame('gatlingExecution', 'pong')).toEqual({
      kind: 'raw',
      key: 'GatlingExecutionPong',
      text: 'pong',
    });
  });

  it('reads a binary frame the channel lists as a raw message', () => {
    const data = new Uint8Array([0, 0, 0, 2, 123, 125, 255]);
    expect(parseServerFrame('liveView', data)).toEqual({
      kind: 'raw',
      key: 'LiveViewFrame',
      data,
    });
  });

  it('refuses text that is neither JSON nor a raw text of the channel', () => {
    expect(() => parseServerFrame('gatlingExecution', 'hello')).toThrow(/JSON/);
    expect(() => parseServerFrame('refine', 'pong')).toThrow(/JSON/);
  });

  it('refuses a binary frame on a channel that has none', () => {
    expect(() => parseServerFrame('refine', new Uint8Array([1]))).toThrow(/binary/);
    expect(() => parseServerFrame('refine', Buffer.from('{}'), true)).toThrow(/binary/);
  });

  // The ws library hands every message over as a Buffer and says with `isBinary` which it was.
  it('reads a text message given as bytes with isBinary false as text', () => {
    const frame = { type: 'flow-suggestions-refine:progress', payload: { progress: 5 } };
    expect(parseServerFrame('refine', Buffer.from(JSON.stringify(frame)), false)).toMatchObject({
      kind: 'frame',
      type: 'flow-suggestions-refine:progress',
      body: { progress: 5 },
    });
    expect(parseServerFrame('gatlingExecution', Buffer.from('pong'), false)).toEqual({
      kind: 'raw',
      key: 'GatlingExecutionPong',
      text: 'pong',
    });
  });

  it('reads bytes with isBinary true as a binary message, even if they spell text', () => {
    const data = Buffer.from('pong');
    expect(parseServerFrame('liveView', data, true)).toEqual({
      kind: 'raw',
      key: 'LiveViewFrame',
      data,
    });
  });

  it('refuses a text given as a string with isBinary true', () => {
    expect(() => parseServerFrame('liveView', 'pong', true)).toThrow(/binary/);
  });

  it('sends a raw text frame of the channel as it is', () => {
    expect(encodeClientFrame('gatlingExecution', 'ping')).toBe('ping');
  });

  it('refuses raw text the channel does not receive', () => {
    expect(() => {
      // @ts-expect-error `pong` is a server frame, not one the channel receives
      encodeClientFrame('gatlingExecution', 'pong');
    }).toThrow(/pong/);
    expect(() => {
      // @ts-expect-error refine receives no raw text
      encodeClientFrame('refine', 'ping');
    }).toThrow(/refine/);
  });
});

describe('parseServerFrame', () => {
  it('returns an enveloped frame with its body typed', () => {
    const parsed = parseServerFrame('refine', {
      type: 'flow-suggestions-refine:progress',
      payload: { job_id: 'j', status: 'running', progress: 5 },
    });
    expect(parsed.kind).toBe('frame');
    if (parsed.kind === 'frame' && parsed.type === 'flow-suggestions-refine:progress') {
      const progress: number = parsed.body.progress;
      expect(progress).toBe(5);
      expect(parsed.frame.type).toBe('flow-suggestions-refine:progress');
    }
  });

  it('returns a flat frame with the keys beside type as its body', () => {
    const parsed = parseServerFrame('describe', {
      type: 'path_done',
      path_index: 2,
      path_name: 'Checkout',
    });
    expect(parsed).toMatchObject({ kind: 'frame', type: 'path_done', body: { path_index: 2 } });
  });

  it('reads JSON text', () => {
    const parsed = parseServerFrame(
      'analysis',
      JSON.stringify({ type: 'gatling-analysis:error', payload: { error: 'x' } }),
    );
    expect(parsed).toMatchObject({ kind: 'frame', type: 'gatling-analysis:error' });
  });

  it('reports a type the document does not list as unknown', () => {
    expect(parseServerFrame('refine', { type: 'flow-suggestions-refine:later' })).toEqual({
      kind: 'unknown',
      type: 'flow-suggestions-refine:later',
    });
  });

  it('throws for what is not a frame', () => {
    expect(() => parseServerFrame('refine', 'not json')).toThrow(/JSON/);
    expect(() => parseServerFrame('refine', [])).toThrow(/object/);
    expect(() => parseServerFrame('refine', { payload: {} })).toThrow(/type/);
    expect(() =>
      parseServerFrame('refine', { type: 'flow-suggestions-refine:progress', payload: 3 }),
    ).toThrow(/payload/);
  });
});

describe('encodeClientFrame', () => {
  it('writes the frame as JSON text', () => {
    expect(encodeClientFrame('har', { type: 'har:cancel' })).toBe('{"type":"har:cancel"}');
  });

  it('refuses a type the channel does not receive, even when the types were bypassed', () => {
    const wrong = { type: 'har:nope' } as unknown as Parameters<typeof encodeClientFrame<'har'>>[1];
    expect(() => encodeClientFrame('har', wrong)).toThrow(/har:nope/);
  });

  it('is typed by the frames the channel receives', () => {
    expect(() => {
      // @ts-expect-error refine receives no frames
      encodeClientFrame('refine', { type: 'har:cancel' });
    }).toThrow(/refine/);
    expect(() => {
      // @ts-expect-error `nope` is not a key of the frame
      encodeClientFrame('har', { type: 'har:cancel', nope: 1 });
    }).not.toThrow();
  });
});
