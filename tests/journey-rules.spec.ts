import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runValidator, withTempDir, type RunResult } from './helpers.ts';

// A minimal, fully valid journey. Every rejected-input fixture below is this
// text mutated in one spot, so an asserted error can only come from the rule
// under test.
const VALID_JOURNEY =
  'Use the provided administrator test account and start at ' +
  'https://app.example.com.\n\n' +
  'Open "Orders". Click "Create order". Type a unique order name into ' +
  '"Name". Click "Save".\n\n' +
  'Finish when "Order created" is visible and the new order appears in the ' +
  'list.\n';

const SECOND_VALID_JOURNEY =
  'Use the provided administrator test account and start at ' +
  'https://app.example.com.\n\n' +
  'Open "Orders". Check that the orders list is visible and shows recent ' +
  'entries.\n';

function run(target: string): RunResult {
  return runValidator('journeys', [target]);
}

function runContent(filename: string, content: string): RunResult {
  return withTempDir((dir) => {
    const target = join(dir, filename);
    writeFileSync(target, content, 'utf8');
    return run(target);
  });
}

function runBytes(filename: string, content: Buffer): RunResult {
  return withTempDir((dir) => {
    const target = join(dir, filename);
    writeFileSync(target, content);
    return run(target);
  });
}

describe('JourneyRuleTestCase', () => {
  // -- filename slug --------------------------------------------------------

  it('rejects invalid slug filename', () => {
    const result = runContent('Create_Order.txt', VALID_JOURNEY);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('lowercase hyphenated slug');
  });

  // -- length bounds --------------------------------------------------------

  it('rejects content under minimum length', () => {
    const result = runContent('create-order.txt', 'Open it.');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('at least 10 characters');
  });

  it('rejects content over maximum length', () => {
    const padding = 'The operator reviews each pending order carefully. '.repeat(200);
    const content =
      'Use the provided administrator test account and start at ' +
      'https://app.example.com.\n\n' +
      `${padding}\n\n` +
      'Finish when "Order created" is visible.\n';
    expect(content.trim().length).toBeGreaterThan(6000);
    const result = runContent('create-order.txt', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('exceeds the 6000-character');
  });

  // -- byte-level guards ----------------------------------------------------

  it('rejects NUL byte', () => {
    const content = VALID_JOURNEY.replace('Open "Orders".', 'Open\x00"Orders".');
    const result = runContent('create-order.txt', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('NUL byte');
  });

  it('rejects invalid UTF-8 bytes', () => {
    const result = runBytes(
      'create-order.txt',
      Buffer.concat([
        Buffer.from('Open "Orders" and '),
        Buffer.from([0xff, 0xfe]),
        Buffer.from(' finish.'),
      ]),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('file must be UTF-8');
  });

  // -- target collection ----------------------------------------------------

  it('rejects nonexistent target', () => {
    const result = withTempDir((dir) => run(join(dir, 'create-order.txt')));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('path does not exist');
  });

  it('rejects directory without txt files', () => {
    const result = withTempDir((dir) => run(dir));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('no .txt journey files found');
  });

  it('rejects single non-txt file target', () => {
    const result = runContent('notes.md', VALID_JOURNEY);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must use the .txt extension');
  });

  // -- cross-file dependencies ----------------------------------------------

  it('rejects previous journey reference', () => {
    const content = 'Complete the previous journey before starting this one.\n\n' + VALID_JOURNEY;
    const result = runContent('create-order.txt', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('cross-file dependency');
  });

  it('rejects run first reference', () => {
    const content = 'Run the sign-in journey first, then continue.\n\n' + VALID_JOURNEY;
    const result = runContent('create-order.txt', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('cross-file dependency');
  });

  it('rejects other txt filename reference', () => {
    const content = 'See sign-in.txt for the setup steps.\n\n' + VALID_JOURNEY;
    const result = runContent('create-order.txt', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('cross-file dependency');
  });

  // -- plural PASS output ---------------------------------------------------

  it('reports plural journey count', () => {
    const result = withTempDir((dir) => {
      writeFileSync(join(dir, 'create-order.txt'), VALID_JOURNEY, 'utf8');
      writeFileSync(join(dir, 'view-orders.txt'), SECOND_VALID_JOURNEY, 'utf8');
      return run(dir);
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('2 journeys');
  });
});
