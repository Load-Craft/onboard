// The reads the plugin makes of routes whose response changed in the refreshed contract: a search
// result with `created_at`, an execution list from the paged route, and a run timeline whose step
// carries one of the newer `failure_code` values. Over real HTTP against the fake backend.

import { describe, expect, it } from 'vitest';

import type { ApiContext } from '../src/api/context.js';
import { getRunTimeline } from '../src/api/describe.js';
import { listExecutions } from '../src/api/lookup.js';
import { searchProjects } from '../src/api/projects.js';
import { loadConfig } from '../src/config.js';
import { createHttp } from '../src/http/client.js';
import type { components } from '../src/http/generated/api.js';
import { createLinks } from '../src/links.js';
import { createLogger } from '../src/log.js';
import { CANARY } from './helpers/canary.js';
import { createTestClock } from './helpers/clock.js';
import { startFake, type Fake } from './fake-backend/server.js';

type Timeline = components['schemas']['TimelineResponse'];
type TimelineStep = components['schemas']['TimelineStep'];
type FailureCode = NonNullable<TimelineStep['failure_code']>;

const PROJECT = '6f1d2a40-5b8c-4e7a-9d13-2c0a8e4b7f51';
const RUN = 'a3c5e7f9-1b2d-4f60-8a24-9e0c7b5d3f18';

async function setup(): Promise<{ fake: Fake; api: ApiContext }> {
  const clock = createTestClock();
  const fake = await startFake({ clock });
  const config = loadConfig(
    { LOADCRAFT_API_URL: `${fake.url}/api/v1`, LOADCRAFT_API_TOKEN: CANARY },
    '/tmp',
  );
  const http = createHttp(config, createLogger({ level: 'error', sink: () => undefined }), {
    clock,
  });
  return {
    fake,
    api: {
      services: { http, links: createLinks(config.appUrl) },
      signal: new AbortController().signal,
    },
  };
}

describe('reads of routes changed in the refreshed contract', () => {
  it('reads a search hit that carries created_at', async () => {
    const { fake, api } = await setup();
    try {
      fake.route('GET', '/api/v1/search', () => ({
        status: 200,
        body: {
          results: [
            {
              id: PROJECT,
              type: 'project',
              title: 'shop',
              href: `/projects/${PROJECT}`,
              created_at: '2026-11-20T10:00:00Z',
            },
          ],
          total: 1,
        },
      }));
      expect(await searchProjects(api, 'shop')).toEqual([{ id: PROJECT, name: 'shop' }]);
    } finally {
      await fake.close();
    }
  });

  it('reads an execution list filtered by scenario and source', async () => {
    const { fake, api } = await setup();
    try {
      fake.route('GET', '/api/v1/projects/{project_id}/gatling/executions', () => ({
        status: 200,
        body: {
          executions: [
            {
              id: RUN,
              status: 'completed' as const,
              scenario_id: null,
              composite_id: null,
              configuration_id: null,
              started_at: '2026-11-20T10:00:00Z',
              created_at: '2026-11-20T09:59:00Z',
              completed_at: '2026-11-20T10:10:00Z',
              duration_seconds: 600,
              error_message: null,
              has_result: true,
              invariant_summary: null,
              ko_count: 0,
              ok_count: 100,
              total_requests: 100,
              load_window_state: 'measured' as const,
              result_has_errors: false,
              run_exit_code: 0,
              run_manifest: null,
              run_manifest_state: 'unavailable' as const,
              saved_run_id: null,
              saved_run_name: null,
              sla_verdict: null,
              source: 'manual' as const,
              supervised: false,
              warnings: [],
            },
          ],
          total: 1,
        },
      }));
      const executions = await listExecutions(api, PROJECT);
      expect(executions.map((execution) => execution.id)).toEqual([RUN]);
    } finally {
      await fake.close();
    }
  });

  it.each<FailureCode>(['error_page', 'no_answer'])(
    'reads a timeline whose step failed with %s',
    async (code) => {
      const { fake, api } = await setup();
      try {
        const step: TimelineStep = {
          label: 'Open the page',
          outcome: 'failed',
          path_index: 0,
          source: 'agent',
          failure: 'The page answered with an error.',
          failure_code: code,
        };
        const body: Timeline = {
          run_id: RUN,
          events: [
            { type: 'agent_step', step },
            { type: 'control_taken', path_index: 0, attempt: 1 },
          ],
        };
        fake.route(
          'GET',
          '/api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}/timeline',
          () => ({ status: 200, body }),
        );
        expect(await getRunTimeline(api, PROJECT, RUN)).toEqual([
          { type: 'control_taken', pathIndex: 0, attempt: 1 },
        ]);
      } finally {
        await fake.close();
      }
    },
  );
});
