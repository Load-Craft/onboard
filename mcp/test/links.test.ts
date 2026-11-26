import { describe, expect, it } from 'vitest';
import { createLinks, type ResultsTab } from '../src/links.js';
import { LINK_KEYS } from '../src/outcome.js';

const links = createLinks('https://app.loadcraft.io');

describe('createLinks', () => {
  it.each([
    [
      'projectProfile',
      links.projectProfile('p1'),
      'https://app.loadcraft.io/projects/p1/settings#application-profile',
    ],
    ['flow', links.flow('p1', 'f1'), 'https://app.loadcraft.io/projects/p1/flows/f1'],
    [
      'describeRun',
      links.describeRun('p1', 'r1'),
      'https://app.loadcraft.io/projects/p1/scenario-from-description/runs/r1',
    ],
    ['harImport', links.harImport('p1'), 'https://app.loadcraft.io/projects/p1/har-import'],
    [
      'composition',
      links.composition('p1', 'c1'),
      'https://app.loadcraft.io/projects/p1/gatling/compositions/c1',
    ],
    [
      'scenario',
      links.scenario('p1', 's1'),
      'https://app.loadcraft.io/projects/p1/gatling/scenarios/s1',
    ],
    ['feeders', links.feeders('p1'), 'https://app.loadcraft.io/projects/p1/gatling/feeders'],
    [
      'executionLive',
      links.executionLive('p1', 'e1'),
      'https://app.loadcraft.io/projects/p1/gatling/executions/e1/live',
    ],
    [
      'executionResults',
      links.executionResults('p1', 'e1'),
      'https://app.loadcraft.io/projects/p1/gatling/executions/e1',
    ],
    [
      'compare',
      links.compare('p1', 'a1', 'b1'),
      'https://app.loadcraft.io/projects/p1/gatling/executions/compare?compare=a1,b1',
    ],
    ['projects', links.projects(), 'https://app.loadcraft.io/projects'],
    ['flows', links.flows('p1'), 'https://app.loadcraft.io/projects/p1/flows'],
  ])('%s returns the exact address and a label key', (_name, link, url) => {
    expect(link.url).toBe(url);
    expect(LINK_KEYS).toContain(link.labelKey);
  });

  it('only the describeRun preview asks for its label in the text', () => {
    expect(links.describeRun('p', 'r').showLabel).toBe(true);
    expect(links.flow('p', 'f').showLabel).toBeUndefined();
  });

  it('uses a distinct label key per function', () => {
    const keys = [
      links.projectProfile('p'),
      links.flow('p', 'f'),
      links.describeRun('p', 'r'),
      links.harImport('p'),
      links.composition('p', 'c'),
      links.scenario('p', 's'),
      links.feeders('p'),
      links.executionLive('p', 'e'),
      links.executionResults('p', 'e'),
      links.compare('p', 'a', 'b'),
      links.projects(),
      links.flows('p'),
    ].map((l) => l.labelKey);
    expect(new Set(keys)).toEqual(new Set(LINK_KEYS));
  });

  it('encodes the tab in the query string', () => {
    expect(links.executionResults('p1', 'e1', 'AI analysis').url).toBe(
      'https://app.loadcraft.io/projects/p1/gatling/executions/e1?tab=AI%20analysis',
    );
  });

  it.each<ResultsTab>([
    'Overview',
    'Response Times',
    'Errors',
    'Requests',
    'Traces',
    'Diagnostics',
    'Gatling report',
    'AI analysis',
  ])('accepts tab %s', (tab) => {
    expect(links.executionResults('p1', 'e1', tab).url).toBe(
      `https://app.loadcraft.io/projects/p1/gatling/executions/e1?tab=${encodeURIComponent(tab)}`,
    );
  });

  it('encodes identifiers', () => {
    expect(links.flow('a/b', 'c d?#').url).toBe(
      'https://app.loadcraft.io/projects/a%2Fb/flows/c%20d%3F%23',
    );
    expect(links.compare('p', 'a,b', 'c').url).toBe(
      'https://app.loadcraft.io/projects/p/gatling/executions/compare?compare=a%2Cb,c',
    );
  });

  it('keeps the port and drops trailing slashes of appUrl', () => {
    expect(createLinks('http://localhost:5173/').harImport('p1').url).toBe(
      'http://localhost:5173/projects/p1/har-import',
    );
    expect(createLinks('https://app.example.com:8443').feeders('p1').url).toBe(
      'https://app.example.com:8443/projects/p1/gatling/feeders',
    );
  });
});
