import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runValidator, withTempDir, type RunResult } from './helpers.ts';

function validate(description: string): RunResult {
  return withTempDir((dir) => {
    const target = join(dir, 'create-order.txt');
    writeFileSync(target, description, 'utf8');
    return runValidator('journeys', [target]);
  });
}

describe('JourneyFinishConditionTestCase', () => {
  it('finish followed by parenthetical clarification passes', () => {
    const description = `Open the "Orders" page.
Click "Create order".
Finish when the success toast appears. (It may take a few seconds.)
`;
    const result = validate(description);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 journey');
  });

  it('finish followed by multiple parentheticals passes', () => {
    const description = `Open the "Orders" page.
Click "Create order".
Finish when the success toast appears. (It may take a few seconds.) (Ignore the banner.)
`;
    const result = validate(description);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('1 journey');
  });

  it('finish followed by real instruction still fails', () => {
    const description = `Open the "Orders" page.
Click "Create order".
Finish when the toast appears. Then click "Close".
`;
    const result = validate(description);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('final instruction');
  });

  it('finish only in the middle still fails', () => {
    const description = `Open the "Orders" page.
Finish when the success toast appears.
Click "Create order".
`;
    const result = validate(description);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('final instruction');
  });

  it('missing finish condition still fails', () => {
    const description = `Open the "Orders" page.
Click "Create order".
`;
    const result = validate(description);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('observable finish condition');
  });
});
