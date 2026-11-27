import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const CANARY = 'CANARY-SECRET-7f3a';
const CWD = '/work/project';

describe('loadConfig defaults', () => {
  const config = loadConfig({}, CWD);

  it('uses documented defaults', () => {
    expect(config.appUrl).toBe('https://app.loadcraft.io');
    expect(config.apiUrl).toBe('https://app.loadcraft.io/api/v1');
    expect(config.locale).toBe('en');
    expect(config.workspaceRoot).toBe(CWD);
    expect(config.demo).toBe(false);
    expect(config.logLevel).toBe('info');
  });

  it('reports a missing token as a problem without throwing', () => {
    expect(config.token.reveal()).toBe('');
    expect(config.problems).toHaveLength(1);
    expect(config.problems[0]).toMatch(/LOADCRAFT_API_TOKEN/);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe('loadConfig URLs', () => {
  const cases: Array<[string, Record<string, string>, { appUrl: string; apiUrl: string }]> = [
    [
      'trailing slash stripped from app url',
      { LOADCRAFT_URL: 'http://localhost:5173/' },
      { appUrl: 'http://localhost:5173', apiUrl: 'http://localhost:5173/api/v1' },
    ],
    [
      'many trailing slashes stripped',
      { LOADCRAFT_URL: 'https://example.com///' },
      { appUrl: 'https://example.com', apiUrl: 'https://example.com/api/v1' },
    ],
    [
      'api url overrides verbatim, trailing slash stripped',
      { LOADCRAFT_URL: 'http://localhost:5173', LOADCRAFT_API_URL: 'http://localhost:8000/' },
      { appUrl: 'http://localhost:5173', apiUrl: 'http://localhost:8000' },
    ],
    [
      'api url is not suffixed with /api/v1',
      { LOADCRAFT_API_URL: 'https://api.example.com/custom' },
      { appUrl: 'https://app.loadcraft.io', apiUrl: 'https://api.example.com/custom' },
    ],
    [
      'empty string means unset',
      { LOADCRAFT_URL: '', LOADCRAFT_API_URL: '' },
      { appUrl: 'https://app.loadcraft.io', apiUrl: 'https://app.loadcraft.io/api/v1' },
    ],
    [
      'unexpanded user_config pattern means unset',
      {
        LOADCRAFT_URL: '${user_config.loadcraft_url}',
        LOADCRAFT_API_URL: '${user_config.api_url}',
      },
      { appUrl: 'https://app.loadcraft.io', apiUrl: 'https://app.loadcraft.io/api/v1' },
    ],
    [
      'variables absent altogether mean unset',
      {},
      { appUrl: 'https://app.loadcraft.io', apiUrl: 'https://app.loadcraft.io/api/v1' },
    ],
    [
      'own web app address with an unexpanded api_url derives the api address from it',
      { LOADCRAFT_URL: 'https://lc.example.com/', LOADCRAFT_API_URL: '${user_config.api_url}' },
      { appUrl: 'https://lc.example.com', apiUrl: 'https://lc.example.com/api/v1' },
    ],
  ];

  it.each(cases)('%s', (_name, env, expected) => {
    const config = loadConfig({ ...env, LOADCRAFT_API_TOKEN: CANARY }, CWD);
    expect(config.appUrl).toBe(expected.appUrl);
    expect(config.apiUrl).toBe(expected.apiUrl);
    expect(config.problems).toEqual([]);
  });

  it('reports a non-http app url and falls back to the default', () => {
    const config = loadConfig(
      { LOADCRAFT_URL: 'ftp://example.com', LOADCRAFT_API_TOKEN: CANARY },
      CWD,
    );
    expect(config.appUrl).toBe('https://app.loadcraft.io');
    expect(config.problems).toHaveLength(1);
    expect(config.problems[0]).toMatch(/LOADCRAFT_URL/);
  });

  it('reports an unparseable app url', () => {
    const config = loadConfig({ LOADCRAFT_URL: 'not a url', LOADCRAFT_API_TOKEN: CANARY }, CWD);
    expect(config.problems[0]).toMatch(/LOADCRAFT_URL/);
  });

  it('reports a non-http api url', () => {
    const config = loadConfig(
      { LOADCRAFT_API_URL: 'ws://example.com', LOADCRAFT_API_TOKEN: CANARY },
      CWD,
    );
    expect(config.apiUrl).toBe('https://app.loadcraft.io/api/v1');
    expect(config.problems[0]).toMatch(/LOADCRAFT_API_URL/);
  });
});

describe('loadConfig scalar options', () => {
  const cases: Array<[string, Record<string, string>, Record<string, unknown>]> = [
    ['locale pl', { LOADCRAFT_LOCALE: 'pl' }, { locale: 'pl' }],
    ['locale en', { LOADCRAFT_LOCALE: 'en' }, { locale: 'en' }],
    ['bad locale falls back to en', { LOADCRAFT_LOCALE: 'de' }, { locale: 'en' }],
    [
      'unexpanded locale falls back to en',
      { LOADCRAFT_LOCALE: '${user_config.locale}' },
      { locale: 'en' },
    ],
    ['demo 1', { LOADCRAFT_DEMO: '1' }, { demo: true }],
    ['demo true (boolean option)', { LOADCRAFT_DEMO: 'true' }, { demo: true }],
    ['demo other value', { LOADCRAFT_DEMO: 'yes' }, { demo: false }],
    ['demo padded value', { LOADCRAFT_DEMO: ' 1 ' }, { demo: false }],
    ['log level debug', { LOADCRAFT_LOG_LEVEL: 'debug' }, { logLevel: 'debug' }],
    ['log level error', { LOADCRAFT_LOG_LEVEL: 'error' }, { logLevel: 'error' }],
    ['bad log level falls back to info', { LOADCRAFT_LOG_LEVEL: 'verbose' }, { logLevel: 'info' }],
    ['absolute workspace', { LOADCRAFT_WORKSPACE: '/srv/app' }, { workspaceRoot: '/srv/app' }],
    [
      'relative workspace resolved against cwd',
      { LOADCRAFT_WORKSPACE: 'sub/dir' },
      { workspaceRoot: '/work/project/sub/dir' },
    ],
    ['empty workspace means cwd', { LOADCRAFT_WORKSPACE: '' }, { workspaceRoot: CWD }],
    [
      'unexpanded workspace means cwd',
      { LOADCRAFT_WORKSPACE: '${CLAUDE_PROJECT_DIR}' },
      { workspaceRoot: CWD },
    ],
  ];

  it.each(cases)('%s', (_name, env, expected) => {
    const config = loadConfig({ ...env, LOADCRAFT_API_TOKEN: CANARY }, CWD);
    expect(config).toMatchObject(expected);
  });
});

describe('loadConfig token', () => {
  it('demo mode does not require a token', () => {
    const config = loadConfig({ LOADCRAFT_DEMO: '1' }, CWD);
    expect(config.problems).toEqual([]);
  });

  it('empty and unexpanded tokens count as missing', () => {
    for (const value of ['', '${user_config.api_token}']) {
      const config = loadConfig({ LOADCRAFT_API_TOKEN: value }, CWD);
      expect(config.token.reveal()).toBe('');
      expect(config.problems.join(' ')).toMatch(/LOADCRAFT_API_TOKEN/);
    }
  });

  it('reveal returns the token', () => {
    const config = loadConfig({ LOADCRAFT_API_TOKEN: CANARY }, CWD);
    expect(config.token.reveal()).toBe(CANARY);
    expect(config.problems).toEqual([]);
  });

  it('never leaks the token through serialization', () => {
    const config = loadConfig({ LOADCRAFT_API_TOKEN: CANARY }, CWD);
    const outputs = [
      JSON.stringify(config),
      String(config.token),
      `${config.token.toString()}`,
      JSON.stringify(config.token),
      inspect(config, { depth: 5 }),
      inspect(config.token),
      JSON.stringify(Object.entries(config)),
    ];
    for (const out of outputs) {
      expect(out).not.toContain(CANARY);
    }
    expect(String(config.token)).toBe('[redacted]');
    expect(JSON.stringify(config.token)).toBe('"[redacted]"');
    expect(inspect(config.token)).toBe('[redacted]');
  });

  it('does not read process.env', () => {
    process.env['LOADCRAFT_LOCALE'] = 'pl';
    try {
      expect(loadConfig({}, CWD).locale).toBe('en');
    } finally {
      delete process.env['LOADCRAFT_LOCALE'];
    }
  });
});
