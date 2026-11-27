import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CHANNELS } from '../src/ws/generated/channels.js';
import { apiOrigin, channelRequirement, channelUrl, redactUrl } from '../src/ws/url.js';

interface ChannelContract {
  path: string;
  requires: string;
}

const contract = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', '..', 'contracts', 'ws-frames.json'), 'utf8'),
) as { channels: Record<string, ChannelContract> };

type ChannelName = keyof typeof CHANNELS;
const ids = Object.keys(CHANNELS) as ChannelName[];

describe('addresses of the channels', () => {
  it('covers all 17 channels of the generated table', () => {
    expect(ids).toHaveLength(17);
  });

  it.each(ids)('%s is at the address the generated table gives', (id) => {
    const generated = CHANNELS[id];
    const params = Object.fromEntries(generated.params.map((name) => [name, `v-${name}`]));
    const expected = generated.address.replace(/\{([a-z_]+)\}/g, (_m, name: string) => `v-${name}`);
    const url = channelUrl('https://api.example.com:8443/api/v1', id, params as never);
    expect(url.href).toBe(`wss://api.example.com:8443${expected}`);
  });

  it('keeps no channel path of its own in url.ts', () => {
    const source = readFileSync(resolve(import.meta.dirname, '..', 'src', 'ws', 'url.ts'), 'utf8');
    expect(source).not.toMatch(/\/ws\//);
  });
});

describe('channelRequirement', () => {
  it('agrees with the requirement the frame contract states for its channels', () => {
    for (const [name, spec] of Object.entries(contract.channels)) {
      expect(channelRequirement(name as ChannelName), name).toBe(spec.requires);
    }
  });

  it('follows the security and the Origin flag of the generated table', () => {
    expect(channelRequirement('scenario')).toBe('none');
    expect(channelRequirement('har')).toBe('identity');
    expect(channelRequirement('describe')).toBe('identity_and_origin');
    for (const id of ids) {
      const { security, requiresOrigin } = CHANNELS[id];
      const expected = requiresOrigin
        ? 'identity_and_origin'
        : (security as readonly string[]).includes('bearerToken')
          ? 'identity'
          : 'none';
      expect(channelRequirement(id), id).toBe(expected);
    }
  });
});

describe('channelUrl', () => {
  it('maps http to ws on the origin of the API address, not under its /api/v1 path', () => {
    const url = channelUrl('http://localhost:8000/api/v1', 'scenario', { run_id: 'r-1' });
    expect(url.href).toBe('ws://localhost:8000/ws/gatling-scenario/r-1');
  });

  it('maps https to wss and keeps an explicit port', () => {
    const url = channelUrl('https://api.example.com:8443/api/v1', 'describe', {
      project_id: 'p-1',
      run_id: 'r-2',
    });
    expect(url.href).toBe(
      'wss://api.example.com:8443/ws/projects/p-1/scenario-from-description/runs/r-2',
    );
  });

  it('drops the query, fragment and credentials of the API address', () => {
    const url = channelUrl('https://user:pw@api.example.com/api/v1?x=1#frag', 'har', {
      project_id: 'p',
      session_id: 's',
    });
    expect(url.href).toBe('wss://api.example.com/ws/projects/p/har/s');
  });

  it('percent-encodes every path parameter', () => {
    const url = channelUrl('http://localhost:8000/api/v1', 'refine', { job_id: 'a/b?c#d e' });
    expect(url.pathname).toBe('/ws/flow-suggestions-refine/a%2Fb%3Fc%23d%20e');
    expect(url.search).toBe('');
  });

  it.each(['', '.', '..'])('refuses the path parameter %j', (value) => {
    expect(() => channelUrl('http://localhost:8000/api/v1', 'batch', { run_id: value })).toThrow(
      /run_id/,
    );
  });

  it('refuses a missing parameter and a parameter the path does not have', () => {
    const missing = { project_id: 'p' } as unknown as { project_id: string; session_id: string };
    expect(() => channelUrl('http://localhost:8000/api/v1', 'har', missing)).toThrow(/session_id/);
    const extra = { run_id: 'r', token: 'x' } as unknown as { run_id: string };
    expect(() => channelUrl('http://localhost:8000/api/v1', 'analysis', extra)).toThrow(/token/);
  });
});

describe('apiOrigin', () => {
  it('is the http(s) origin of the API address, the scheme the backend compares with Host', () => {
    expect(apiOrigin('https://api.example.com/api/v1')).toBe('https://api.example.com');
    expect(apiOrigin('http://localhost:8000/api/v1')).toBe('http://localhost:8000');
    expect(apiOrigin('https://api.example.com:443/api/v1')).toBe('https://api.example.com');
  });
});

describe('redactUrl', () => {
  it('keeps origin and path only', () => {
    expect(redactUrl(new URL('wss://u:p@api.example.com/ws/x/1?token=abc#f'))).toBe(
      'wss://api.example.com/ws/x/1',
    );
    expect(redactUrl('ws://localhost:8000/ws/y?a=b')).toBe('ws://localhost:8000/ws/y');
  });
});
