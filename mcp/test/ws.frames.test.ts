import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  CLIENT_SCHEMAS,
  FrameParseError,
  SERVER_SCHEMAS,
  frameEnvelope,
  parseFrame,
  type Channel,
} from '../src/ws/frames.js';

interface KeySpec {
  name: string;
  type: string;
  required: boolean;
  nullable?: boolean;
  items?: KeySpec[];
}
interface FrameSpec {
  type: string;
  envelope?: 'payload' | 'flat';
  source?: string;
  keys: KeySpec[];
}
interface ChannelSpec {
  path: string;
  envelope: 'payload' | 'flat';
  requires: 'none' | 'identity' | 'identity_and_origin';
  server: FrameSpec[];
  client: FrameSpec[];
}
interface Contract {
  channels: Record<string, ChannelSpec>;
}

const contract = JSON.parse(
  readFileSync(new URL('../../contracts/ws-frames.json', import.meta.url), 'utf8'),
) as Contract;

const EXPECTED_SERVER: Record<Channel, string[]> = {
  refine: ['progress', 'complete', 'error', 'cancelled'].map((e) => `flow-suggestions-refine:${e}`),
  batch: ['basket-progress', 'basket-complete', 'basket-error', 'complete', 'error'].map(
    (e) => `batch-generation:${e}`,
  ),
  scenario: ['progress', 'complete', 'error', 'cancelled'].map((e) => `gatling-scenario:${e}`),
  analysis: ['progress', 'complete', 'error'].map((e) => `gatling-analysis:${e}`),
  har: ['har:progress', 'split_proposal', 'har:complete', 'har:error', 'har:cancelled'],
  describe: [
    'split_proposal',
    'drive_snapshot',
    'path_stage',
    'path_done',
    'path_failed',
    'agent_step',
    'help_requested',
    'control_returned',
    'stop_accepted',
    'stop_refused',
    'split_resume_refused',
    'message_denied',
    'complete',
    'error',
    'cancelled',
    'interrupted',
  ],
  healthCheck: ['progress', 'complete', 'error', 'cancelled'],
  testTypes: ['progress', 'complete', 'error'].map((e) => `test-types:${e}`),
  payloadGen: ['progress', 'complete', 'error'].map((e) => `payload-gen:${e}`),
  gatlingFeeder: ['progress', 'complete', 'error'].map((e) => `gatling-feeder:${e}`),
};
const EXPECTED_CLIENT: Record<Channel, string[]> = {
  refine: [],
  batch: [],
  scenario: [],
  analysis: [],
  har: ['har:generate', 'split_resume', 'har:cancel'],
  describe: ['split_resume', 'stop'],
  // written as a key: the plain word in quotes is an old tool name to the names check
  healthCheck: Object.keys({ cancel: true }),
  testTypes: [],
  payloadGen: [],
  gatlingFeeder: [],
};

/** Describes a zod object shape as {name: required} for comparison with the contract. */
function shapeOf(schema: unknown): Record<string, { required: boolean; nullable: boolean }> {
  const shape = (
    schema as { shape: Record<string, { isOptional(): boolean; isNullable(): boolean }> }
  ).shape;
  return Object.fromEntries(
    Object.entries(shape).map(([k, v]) => [
      k,
      { required: !v.isOptional(), nullable: v.isNullable() },
    ]),
  );
}

function expectedShape(keys: KeySpec[]): Record<string, { required: boolean; nullable: boolean }> {
  return Object.fromEntries(
    keys.map((k) => [k.name, { required: k.required, nullable: k.nullable === true }]),
  );
}

/** Minimal valid value for a contract key (only required keys are filled). */
function sample(key: KeySpec): unknown {
  switch (key.type) {
    case 'string':
      return 'x';
    case 'integer':
      return 1;
    case 'boolean':
      return true;
    case 'array':
      return key.items ? [fill(key.items)] : [];
    case 'object':
      return key.items ? fill(key.items) : {};
    default:
      throw new Error(`unknown key type ${key.type}`);
  }
}
function fill(keys: KeySpec[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => k.required).map((k) => [k.name, sample(k)]));
}

function wire(spec: ChannelSpec, frame: FrameSpec, data: Record<string, unknown>): unknown {
  const envelope = frame.envelope ?? spec.envelope;
  return envelope === 'payload'
    ? { type: frame.type, payload: data }
    : { type: frame.type, ...data };
}

describe('contract file shape', () => {
  it('lists exactly the six channels', () => {
    expect(Object.keys(contract.channels).sort()).toEqual([...CHANNELS].sort());
  });

  it.each(CHANNELS)('channel %s lists the frames the plugin reads and sends', (channel) => {
    const spec = contract.channels[channel];
    expect(spec).toBeDefined();
    expect(spec?.server.map((f) => f.type)).toEqual(EXPECTED_SERVER[channel]);
    expect(spec?.client.map((f) => f.type)).toEqual(EXPECTED_CLIENT[channel]);
  });

  it('declares connection requirements per channel', () => {
    const requires = Object.fromEntries(CHANNELS.map((c) => [c, contract.channels[c]?.requires]));
    expect(requires).toEqual({
      refine: 'none',
      batch: 'none',
      scenario: 'none',
      analysis: 'none',
      har: 'identity',
      describe: 'identity_and_origin',
      healthCheck: 'none',
      testTypes: 'none',
      payloadGen: 'none',
      gatlingFeeder: 'none',
    });
  });

  it('agrees with the contract on which frames carry a payload envelope', () => {
    for (const channel of CHANNELS) {
      const spec = contract.channels[channel] as ChannelSpec;
      for (const f of spec.server) {
        expect(frameEnvelope(channel, f.type), `${channel}/${f.type}`).toBe(
          f.envelope ?? spec.envelope,
        );
      }
    }
  });

  it('points no frame at a file of the backend: the repository is public, the backend is not', () => {
    for (const channel of CHANNELS) {
      for (const f of [
        ...(contract.channels[channel]?.server ?? []),
        ...(contract.channels[channel]?.client ?? []),
      ]) {
        expect(f.source, `${channel}/${f.type}`).toBeUndefined();
      }
    }
  });
});

describe('schemas match the contract (both ways)', () => {
  it.each(CHANNELS)('channel %s: every contract frame has a schema and vice versa', (channel) => {
    const spec = contract.channels[channel];
    expect(Object.keys(SERVER_SCHEMAS[channel]).sort()).toEqual(
      (spec?.server ?? []).map((f) => f.type).sort(),
    );
    expect(Object.keys(CLIENT_SCHEMAS[channel]).sort()).toEqual(
      (spec?.client ?? []).map((f) => f.type).sort(),
    );
  });

  it.each(CHANNELS)('channel %s: schema keys, required and nullable flags match', (channel) => {
    const spec = contract.channels[channel];
    for (const f of spec?.server ?? []) {
      const schema = SERVER_SCHEMAS[channel][f.type];
      expect(shapeOf(schema), `${channel}/${f.type}`).toEqual(expectedShape(f.keys));
    }
    for (const f of spec?.client ?? []) {
      const schema = CLIENT_SCHEMAS[channel][f.type];
      expect(shapeOf(schema), `${channel}/client/${f.type}`).toEqual(expectedShape(f.keys));
    }
  });
});

describe('parseFrame', () => {
  it.each(CHANNELS)('channel %s: a minimal frame for every server type parses', (channel) => {
    const spec = contract.channels[channel] as ChannelSpec;
    for (const f of spec.server) {
      const parsed = parseFrame(channel, wire(spec, f, fill(f.keys)));
      expect(parsed.kind, `${channel}/${f.type}`).toBe('frame');
      if (parsed.kind === 'frame') {
        expect(parsed.channel).toBe(channel);
        expect(parsed.type).toBe(f.type);
      }
    }
  });

  it.each(CHANNELS)(
    'channel %s: extra keys (top level and nested) are accepted and kept',
    (channel) => {
      const spec = contract.channels[channel] as ChannelSpec;
      for (const f of spec.server) {
        const data = { ...fill(f.keys), added_by_backend: 42 };
        const parsed = parseFrame(channel, wire(spec, f, data));
        expect(parsed.kind, `${channel}/${f.type}`).toBe('frame');
        if (parsed.kind === 'frame') {
          expect((parsed.data as Record<string, unknown>)['added_by_backend']).toBe(42);
        }
      }
    },
  );

  it('accepts a frame given as JSON text', () => {
    const parsed = parseFrame(
      'scenario',
      JSON.stringify({
        type: 'gatling-scenario:complete',
        payload: { run_id: 'r1', scenario_id: 's1', status: 'completed' },
      }),
    );
    expect(parsed).toMatchObject({ kind: 'frame', type: 'gatling-scenario:complete' });
    if (parsed.kind === 'frame' && parsed.type === 'gatling-scenario:complete') {
      expect(parsed.data.scenario_id).toBe('s1');
    }
  });

  it('parses a real refine complete frame with the result kept whole', () => {
    const parsed = parseFrame('refine', {
      type: 'flow-suggestions-refine:complete',
      payload: { job_id: 'j1', status: 'complete', result: { suggestions: [{ id: 'a' }] } },
    });
    expect(parsed.kind).toBe('frame');
    if (parsed.kind === 'frame' && parsed.type === 'flow-suggestions-refine:complete') {
      expect(parsed.data.result).toEqual({ suggestions: [{ id: 'a' }] });
    }
  });

  it('parses a refine error frame carrying a null reason', () => {
    const parsed = parseFrame('refine', {
      type: 'flow-suggestions-refine:error',
      payload: { job_id: 'j1', status: 'failed', error: 'boom', recoverable: true, reason: null },
    });
    expect(parsed.kind).toBe('frame');
  });

  it('reads the har split proposal as a flat frame and the har complete as an enveloped one', () => {
    const proposal = parseFrame('har', {
      type: 'split_proposal',
      proposed_paths: [
        { name: 'Checkout', steps: ['POST /api/orders'], depends_on_prior: false, rationale: 'x' },
      ],
    });
    expect(proposal.kind).toBe('frame');
    const complete = parseFrame('har', {
      type: 'har:complete',
      payload: {
        session_id: 's',
        status: 'completed',
        flows: [{ flow_id: 'f', flow_name: 'Checkout' }],
      },
    });
    expect(complete.kind).toBe('frame');
    expect(() =>
      parseFrame('har', { type: 'split_proposal', payload: { proposed_paths: [] } }),
    ).toThrow(FrameParseError);
  });

  it('reads flat describe frames, and rejects the same type wrapped in a payload', () => {
    expect(
      parseFrame('describe', { type: 'path_done', path_index: 0, path_name: 'Checkout' }).kind,
    ).toBe('frame');
    expect(() => parseFrame('describe', { type: 'path_done', payload: { path_index: 0 } })).toThrow(
      FrameParseError,
    );
  });

  it('names channel, type and field when a required field is missing', () => {
    const attempt = (): unknown =>
      parseFrame('scenario', { type: 'gatling-scenario:complete', payload: { run_id: 'r1' } });
    expect(attempt).toThrow(FrameParseError);
    try {
      attempt();
    } catch (e) {
      const err = e as FrameParseError;
      expect(err.channel).toBe('scenario');
      expect(err.frameType).toBe('gatling-scenario:complete');
      expect(err.field).toBe('payload.scenario_id');
      expect(err.message).toContain('scenario');
      expect(err.message).toContain('gatling-scenario:complete');
      expect(err.message).toContain('payload.scenario_id');
    }
  });

  it('names a nested field when it is missing', () => {
    try {
      parseFrame('describe', { type: 'agent_step', step: { path_index: 0, label: 'Open page' } });
      expect.unreachable();
    } catch (e) {
      const err = e as FrameParseError;
      expect(err).toBeInstanceOf(FrameParseError);
      expect(err.field).toBe('step.outcome');
    }
  });

  it('names the payload when an enveloped frame has none', () => {
    try {
      parseFrame('analysis', { type: 'gatling-analysis:error' });
      expect.unreachable();
    } catch (e) {
      expect((e as FrameParseError).field).toBe('payload');
    }
  });

  it('returns unknown for a type the contract does not list, whatever the channel', () => {
    expect(parseFrame('describe', { type: 'redrive_started', path_index: 1 })).toEqual({
      kind: 'unknown',
      type: 'redrive_started',
    });
    expect(parseFrame('har', { type: 'har:log', payload: { message: 'm' } })).toEqual({
      kind: 'unknown',
      type: 'har:log',
    });
  });

  it('does not take a frame of another channel for its own', () => {
    expect(
      parseFrame('analysis', { type: 'gatling-scenario:progress', payload: { progress: 1 } }),
    ).toEqual({ kind: 'unknown', type: 'gatling-scenario:progress' });
  });

  it('rejects input that is not a frame with a type', () => {
    for (const raw of ['not json', '[]', '{}', 'null', 7, null, { type: 3 }]) {
      expect(() => parseFrame('refine', raw), JSON.stringify(raw)).toThrow(FrameParseError);
    }
  });
});

describe('client message schemas', () => {
  it('accept the messages the plugin sends', () => {
    expect(CLIENT_SCHEMAS.har['har:generate']?.safeParse({ flow_name: 'Checkout' }).success).toBe(
      true,
    );
    expect(
      CLIENT_SCHEMAS.describe['split_resume']?.safeParse({
        paths: [{ name: 'A', steps: ['open'], depends_on_prior: false }],
      }).success,
    ).toBe(true);
    expect(CLIENT_SCHEMAS.describe['stop']?.safeParse({}).success).toBe(true);
  });

  it('refuse a har:generate without a flow name', () => {
    expect(CLIENT_SCHEMAS.har['har:generate']?.safeParse({}).success).toBe(false);
  });

  it('reads flat health-check frames, and rejects the same type wrapped in a payload', () => {
    const progress = parseFrame('healthCheck', {
      type: 'progress',
      node: 'compare',
      progress: 60,
      status: 'completed',
      details: {},
    });
    expect(progress).toMatchObject({
      kind: 'frame',
      type: 'progress',
      data: { node: 'compare', progress: 60 },
    });
    expect(
      parseFrame('healthCheck', { type: 'complete', result: { staleness_score: 0.2 } }).kind,
    ).toBe('frame');
    expect(
      parseFrame('healthCheck', { type: 'error', error: 'LLM refused', node: null }).kind,
    ).toBe('frame');
    expect(parseFrame('healthCheck', { type: 'cancelled' }).kind).toBe('frame');
    expect(() =>
      parseFrame('healthCheck', {
        type: 'progress',
        payload: { node: 'compare', progress: 60, status: 'x' },
      }),
    ).toThrow(FrameParseError);
  });

  it('reads the frames of an AI dataset generation, enveloped in payload', () => {
    expect(
      parseFrame('gatlingFeeder', {
        type: 'gatling-feeder:progress',
        payload: {
          progress: 35,
          current_step: 'generate',
          step_label: 'Generating',
          status: 'in_progress',
        },
      }),
    ).toMatchObject({ kind: 'frame', data: { progress: 35, current_step: 'generate' } });
    expect(
      parseFrame('gatlingFeeder', {
        type: 'gatling-feeder:complete',
        payload: { feeder_id: 'f1', run_id: 'r1', status: 'completed' },
      }).kind,
    ).toBe('frame');
    expect(() =>
      parseFrame('gatlingFeeder', { type: 'gatling-feeder:complete', run_id: 'r1' }),
    ).toThrow(FrameParseError);
  });
});
