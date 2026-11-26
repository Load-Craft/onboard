// The channel metadata `process_wait` and the process tools read: which frame ends a run, whether a
// socket replays state on connect, what a close code means, whether the handshake needs an `Origin`
// header, and which REST operation starts the run and where it returns the channel's path
// parameter. It lives in `contracts/loadcraft-asyncapi.json` as `x-*` extensions (with the backend
// `file:line` that shows each one) and in the generated `CHANNELS`.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { emitChannelTypes } from '../scripts/gen-clients/emit.js';
import { readChannels, type AsyncApiDocument } from '../scripts/gen-clients/model.js';
import { OPERATIONS } from '../src/http/generated/operations.js';
import { CHANNELS, type ChannelId, type ChannelMetadata } from '../src/ws/generated/channels.js';

interface Started {
  operationId: string;
  parameter: string;
  field: string;
  source: 'response' | 'request';
}
type Extensions = Record<string, unknown> & {
  'x-terminal-frames'?: string[];
  'x-replay'?: { mode: string; once?: boolean };
  'x-close-codes'?: Record<string, string>;
  'x-requires-origin'?: boolean;
  'x-started-by'?: Started[];
};
interface OpenApiSchema {
  $ref?: string;
  properties?: Record<string, unknown>;
}
interface OpenApiOperation {
  operationId?: string;
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> };
  responses?: Record<string, { content?: Record<string, { schema?: OpenApiSchema }> }>;
}
interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, OpenApiSchema> };
}

const contracts = (name: string): string =>
  resolve(import.meta.dirname, '..', '..', 'contracts', name);
const asyncapi = JSON.parse(
  readFileSync(contracts('loadcraft-asyncapi.json'), 'utf8'),
) as AsyncApiDocument;
const openapi = JSON.parse(
  readFileSync(contracts('loadcraft-openapi.json'), 'utf8'),
) as OpenApiDocument;
const catalog = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', 'catalog', 'katalog.json'), 'utf8'),
) as { channels: { channel: string; excluded_reason: string | null }[] };

const extensions = (id: string): Extensions =>
  (asyncapi.channels as unknown as Record<string, Extensions>)[id] ?? {};
const ids = Object.keys(asyncapi.channels);

function schemaOf(operationId: string, source: 'response' | 'request'): OpenApiSchema {
  for (const methods of Object.values(openapi.paths)) {
    for (const operation of Object.values(methods)) {
      if (operation.operationId !== operationId) continue;
      const content =
        source === 'request'
          ? operation.requestBody?.content
          : Object.entries(operation.responses ?? {}).find(([code]) => code.startsWith('2'))?.[1]
              .content;
      const schema = content?.['application/json']?.schema ?? {};
      const name = schema.$ref?.split('/').pop();
      return name === undefined ? schema : (openapi.components.schemas[name] ?? {});
    }
  }
  throw new Error(`no operation ${operationId} in the OpenAPI contract`);
}

describe('the contract carries the metadata of all 17 channels', () => {
  it('has 17 channels', () => {
    expect(ids).toHaveLength(17);
  });

  it.each(ids)('%s: every extension is present', (id) => {
    const channel = extensions(id);
    expect(Array.isArray(channel['x-terminal-frames'])).toBe(true);
    expect(['none', 'state', 'events']).toContain(channel['x-replay']?.mode);
    expect(typeof channel['x-requires-origin']).toBe('boolean');
    expect(Array.isArray(channel['x-started-by'])).toBe(true);
    expect(typeof channel['x-close-codes']).toBe('object');
  });

  it.each(ids)('%s: a terminal frame is a frame the server sends', (id) => {
    const model = readChannels(asyncapi).find((channel) => channel.id === id);
    const sent = (model?.server ?? []).map((message) => message.type);
    for (const type of extensions(id)['x-terminal-frames'] ?? []) expect(sent).toContain(type);
  });

  it.each(ids)('%s: the starting operations exist and return the channel parameter', (id) => {
    const model = readChannels(asyncapi).find((channel) => channel.id === id);
    for (const start of extensions(id)['x-started-by'] ?? []) {
      expect(Object.keys(OPERATIONS), `${id}: ${start.operationId}`).toContain(start.operationId);
      expect(model?.params).toContain(start.parameter);
      const properties = Object.keys(schemaOf(start.operationId, start.source).properties ?? {});
      expect(properties, `${id}: ${start.operationId} has no ${start.field}`).toContain(
        start.field,
      );
    }
  });

  it('no extension is written the old way, and no backend location is in the document', () => {
    expect(JSON.stringify(asyncapi)).not.toContain('x-nullable');
    expect(JSON.stringify(asyncapi)).not.toContain('x-evidence');
    expect(JSON.stringify(asyncapi)).not.toMatch(/backend\/[a-z_/]+\.py/);
  });
});

describe('the four channels the process tools wait on', () => {
  it('describe: ends in four frames, replays state, needs Origin, started by the generate call', () => {
    expect(CHANNELS.describe.terminalFrames).toEqual([
      'complete',
      'error',
      'cancelled',
      'interrupted',
    ]);
    expect(CHANNELS.describe.replay).toEqual({ mode: 'state' });
    expect(CHANNELS.describe.requiresOrigin).toBe(true);
    expect(Object.keys(CHANNELS.describe.closeCodes)).toEqual(['4001', '4003', '4404']);
    expect(CHANNELS.describe.startedBy).toEqual([
      {
        operationId:
          'generate_scenario_api_v1_projects__project_id__scenario_from_description_generate_post',
        parameter: 'run_id',
        field: 'run_id',
        source: 'response',
      },
    ]);
  });

  it('har: ends in complete, error or cancelled, nothing replayed, no Origin', () => {
    expect(CHANNELS.har.terminalFrames).toEqual(['har:complete', 'har:error', 'har:cancelled']);
    expect(CHANNELS.har.replay).toEqual({ mode: 'none' });
    expect(CHANNELS.har.requiresOrigin).toBe(false);
    expect(Object.keys(CHANNELS.har.closeCodes)).toEqual(['4001', '4003']);
    expect(CHANNELS.har.startedBy).toEqual([
      {
        operationId: 'upload_har_api_v1_projects__project_id__har_upload_post',
        parameter: 'session_id',
        field: 'har_session_id',
        source: 'response',
      },
    ]);
  });

  it('flowGeneration: replays the stored state and is started by generate and regenerate', () => {
    expect(CHANNELS.flowGeneration.terminalFrames).toEqual([
      'flow-generation:complete',
      'flow-generation:error',
      'flow-generation:cancelled',
    ]);
    expect(CHANNELS.flowGeneration.replay).toEqual({ mode: 'state' });
    expect(CHANNELS.flowGeneration.requiresOrigin).toBe(false);
    expect(CHANNELS.flowGeneration.closeCodes).toEqual({});
    expect(CHANNELS.flowGeneration.startedBy.map((start) => start.operationId)).toEqual([
      'generate_flow_async_api_v1_projects__project_id__flows_generate_async_post',
      'regenerate_flow_api_v1_projects__project_id__flows__flow_id__regenerate_post',
    ]);
  });

  it('gatlingExecution: both twins of the terminal frame, an execution id from three starters', () => {
    expect(CHANNELS.gatlingExecution.terminalFrames).toEqual([
      'gatling:execution_complete',
      'execution_complete',
    ]);
    expect(CHANNELS.gatlingExecution.replay).toEqual({ mode: 'none' });
    expect(CHANNELS.gatlingExecution.requiresOrigin).toBe(false);
    expect(Object.keys(CHANNELS.gatlingExecution.closeCodes)).toEqual(['4001', '4003', '4404']);
    const fields = CHANNELS.gatlingExecution.startedBy.map((start) => start.field);
    expect(fields).toEqual(['id', 'execution_id', 'execution_id']);
    for (const start of CHANNELS.gatlingExecution.startedBy) {
      expect(start.parameter).toBe('execution_id');
    }
  });

  it('a socket that replays once says so', () => {
    expect(CHANNELS.scenario.replay).toEqual({ mode: 'state', once: true });
    expect(CHANNELS.batch.replay).toEqual({ mode: 'events' });
  });

  it('the live image channel needs Origin too', () => {
    expect(CHANNELS.liveView.requiresOrigin).toBe(true);
    expect(CHANNELS.liveView.terminalFrames).toEqual([]);
  });
});

describe('the channels the catalog uses', () => {
  const used = catalog.channels
    .filter((entry) => entry.excluded_reason === null)
    .map((entry) => entry.channel);

  it('are 15', () => {
    expect(used).toHaveLength(15);
  });

  it.each(used)('%s: has a terminal frame and a starting operation', (id) => {
    const channel = CHANNELS[id as ChannelId];
    expect(channel.terminalFrames.length).toBeGreaterThan(0);
    expect(channel.startedBy.length).toBeGreaterThan(0);
  });
});

describe('the generated CHANNELS carry what the contract says', () => {
  it.each(ids)('%s', (id) => {
    const channel = extensions(id);
    const generated = CHANNELS[id as ChannelId];
    expect([...generated.terminalFrames]).toEqual(channel['x-terminal-frames']);
    expect(generated.replay).toEqual(channel['x-replay']);
    expect(generated.closeCodes).toEqual(channel['x-close-codes']);
    expect(generated.requiresOrigin).toBe(channel['x-requires-origin']);
    expect(generated.startedBy).toEqual(channel['x-started-by']);
  });
});

describe('--check notices a changed contract', () => {
  function checkAgainst(edit: (document: AsyncApiDocument) => void): {
    status: number | null;
    stderr: string;
  } {
    const dir = mkdtempSync(join(tmpdir(), 'lc-wsmeta-'));
    try {
      const copy = structuredClone(asyncapi);
      edit(copy);
      const file = join(dir, 'changed.asyncapi.json');
      writeFileSync(file, JSON.stringify(copy));
      const script = join(import.meta.dirname, '..', 'scripts', 'gen-clients.mjs');
      const result = spawnSync(
        process.execPath,
        [script, '--only', 'ws', '--check', '--asyncapi', file],
        { encoding: 'utf8', timeout: 60_000 },
      );
      return { status: result.status, stderr: result.stderr };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const channel = (document: AsyncApiDocument, id: string): Extensions =>
    (document.channels as unknown as Record<string, Extensions>)[id] ?? {};

  it('is green on the committed contract', () => {
    const committed = readFileSync(
      join(import.meta.dirname, '..', 'src', 'ws', 'generated', 'channels.ts'),
      'utf8',
    );
    expect(emitChannelTypes(readChannels(asyncapi), 'contracts/loadcraft-asyncapi.json')).toBe(
      committed,
    );
  });

  it.each([
    [
      'a terminal frame',
      (document: AsyncApiDocument) => {
        channel(document, 'har')['x-terminal-frames'] = ['har:error'];
      },
    ],
    [
      'the Origin requirement',
      (document: AsyncApiDocument) => {
        channel(document, 'describe')['x-requires-origin'] = false;
      },
    ],
    [
      'a close code',
      (document: AsyncApiDocument) => {
        channel(document, 'gatlingExecution')['x-close-codes'] = {};
      },
    ],
  ])(
    'goes red when %s changes and the client is not regenerated',
    (_name, edit) => {
      const result = checkAgainst(edit);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('npm run gen:ws');
    },
    60_000,
  );

  it('refuses a terminal frame the channel never sends', () => {
    const result = checkAgainst((document) => {
      channel(document, 'har')['x-terminal-frames'] = ['har:finished'];
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('har:finished');
  }, 60_000);
});

describe('the terminal frames are typed by the frames of their channel', () => {
  it('refuses a frame the channel does not send', () => {
    const fine: ChannelMetadata['har']['terminalFrames'] = ['har:complete'];
    // @ts-expect-error har sends no har:finished
    const bad: ChannelMetadata['har']['terminalFrames'] = ['har:finished'];
    // @ts-expect-error a frame of another channel
    const other: ChannelMetadata['har']['terminalFrames'] = ['complete'];
    expect([fine, bad, other]).toHaveLength(3);
  });

  it('is what the generated table is checked against', () => {
    const text = readFileSync(
      join(import.meta.dirname, '..', 'src', 'ws', 'generated', 'channels.ts'),
      'utf8',
    );
    expect(text).toContain('} as const satisfies ChannelMetadata;');
  });
});
