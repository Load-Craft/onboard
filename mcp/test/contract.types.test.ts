import { describe, expectTypeOf, it } from 'vitest';
import type { paths } from '../src/http/generated/api.js';

describe('OpenAPI contract types', () => {
  it('describes project creation', () => {
    expectTypeOf<paths['/api/v1/projects']>().toHaveProperty('post');
  });

  it('describes the current account lookup', () => {
    expectTypeOf<paths['/api/v1/auth/me']>().toHaveProperty('get');
  });

  it('describes reading a Gatling execution', () => {
    expectTypeOf<
      paths['/api/v1/projects/{project_id}/gatling/executions/{execution_id}']
    >().toHaveProperty('get');
  });
});
