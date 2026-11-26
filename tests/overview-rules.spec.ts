import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runValidator, withTempDir, type RunResult } from './helpers.ts';

/**
 * A realistic, fully valid ~1000-character LoadCraft overview.
 *
 * Every rejected-input fixture below is this text mutated in one spot, so an
 * asserted error can only come from the rule under test.
 */
function validOverview(): string {
  return (
    '# Orders Example Shop\n\n' +
    'Orders Example Shop is a web storefront where small retailers manage ' +
    'their product catalog and fulfil customer orders. It serves shop ' +
    'operators who process daily sales and administrators who configure the ' +
    'store at app.example.com.\n\n' +
    'The domain centers on a handful of entities. A Product has a name, a ' +
    'stock-keeping identifier such as order-example, a price amount, and an ' +
    'availability state. An Order groups line items, carries a status that ' +
    'moves from pending to paid to shipped, and belongs to a Customer. ' +
    'Customers hold a display name and a contact address like ' +
    'user@example.com.\n\n' +
    'Two roles use the system. Operators browse the catalog, create orders, ' +
    'adjust quantities, and mark orders as fulfilled. Administrators ' +
    'additionally manage the catalog, invite teammates, and review sales ' +
    'summaries.\n\n' +
    'The main business flows are catalog browsing, order creation, order ' +
    'fulfilment, and reporting. An operator opens the catalog, assembles an ' +
    'order, confirms it, and later transitions it through shipping. ' +
    'Administrators reconcile daily totals.\n\n' +
    'Data is primarily English. Identifiers follow short hyphenated slugs, ' +
    'prices are decimal amounts in a single currency, and names are free ' +
    'text. A typical product code looks like order-example.\n\n' +
    'The application integrates with a hosted identity provider for sign-in, ' +
    'a payment gateway for checkout, and an analytics collector. Traffic to ' +
    'the analytics and CDN hosts is noise from a load-testing perspective ' +
    'and can be excluded from scenarios.\n'
  );
}

function run(target: string): RunResult {
  return runValidator('overview', [target]);
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

describe('OverviewRuleTestCase', () => {
  // -- accepts --------------------------------------------------------------

  it('accepts valid overview', () => {
    const result = runContent('overview.md', validOverview());
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('passes the LoadCraft structural preflight');
  });

  it('accepts valid overview with sidecar', () => {
    const result = withTempDir((dir) => {
      writeFileSync(join(dir, 'overview.md'), validOverview(), 'utf8');
      writeFileSync(
        join(dir, 'overview.provenance.json'),
        JSON.stringify({ commit: 'a1b2c3d4e5f6', dirty: false }),
        'utf8',
      );
      return run(join(dir, 'overview.md'));
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('passes the LoadCraft structural preflight');
  });

  it('accepts headings and lists', () => {
    const content =
      '# Orders Example Shop\n\n' +
      '## What it does\n\n' +
      'Orders Example Shop is a web storefront where small retailers ' +
      'manage their product catalog and fulfil customer orders for shop ' +
      'operators and administrators at app.example.com.\n\n' +
      '## Roles\n\n' +
      '- Operators create and fulfil orders across the catalog.\n' +
      '- Administrators manage the catalog and review sales summaries.\n\n' +
      '## Data\n\n' +
      'Identifiers follow short hyphenated slugs such as order-example, ' +
      'prices are decimal amounts in a single currency, and contact ' +
      'addresses look like user@example.com. The data is primarily ' +
      'English and integrates with an identity provider and a payment ' +
      'gateway whose analytics traffic is load-testing noise.\n';
    const result = runContent('overview.md', content);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('passes the LoadCraft structural preflight');
  });

  // -- I/O guards -----------------------------------------------------------

  it('rejects non md extension', () => {
    const result = runContent('overview.txt', validOverview());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('.md extension');
  });

  it('rejects missing file', () => {
    const result = withTempDir((dir) => run(join(dir, 'overview.md')));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('file not found');
  });

  it('rejects invalid UTF-8 bytes', () => {
    const result = runBytes(
      'overview.md',
      Buffer.concat([
        Buffer.from('# Orders '),
        Buffer.from([0xff, 0xfe]),
        Buffer.from(' Example Shop\n'),
      ]),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('file must be UTF-8');
  });

  it('rejects NUL byte', () => {
    const content = validOverview().replace('A Product', 'A\x00Product');
    const result = runContent('overview.md', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('NUL byte');
  });

  // -- structural rules -----------------------------------------------------

  it('rejects missing H1 heading', () => {
    const content = validOverview().replace('# Orders Example Shop', 'Orders Example Shop');
    const result = runContent('overview.md', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('H1 heading');
  });

  it('rejects content under minimum length', () => {
    const result = runContent('overview.md', '# Orders Example Shop\n\nA tiny shop.\n');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('at least 200 characters');
  });

  it('rejects content over maximum length', () => {
    const padding = 'The operator reviews each pending order carefully. '.repeat(200);
    const content = `# Orders Example Shop\n\n${padding}\n`;
    expect(content.trim().length).toBeGreaterThan(8000);
    const result = runContent('overview.md', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('exceeds the 8000-character');
  });

  it('rejects code fence', () => {
    const content = validOverview() + '\n```\nGET /orders\n```\n';
    const result = runContent('overview.md', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('code fence');
  });

  it('rejects markdown table', () => {
    const content = validOverview() + '\n| Role | Action |\n| --- | --- |\n| Operator | Create |\n';
    const result = runContent('overview.md', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('table');
  });

  it('rejects unresolved marker', () => {
    const content = validOverview().replace(
      'Administrators reconcile daily totals.',
      'Administrators reconcile daily totals. TBD.',
    );
    const result = runContent('overview.md', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unresolved marker');
  });

  it('rejects source file reference', () => {
    const content = validOverview().replace(
      'carries a status',
      'carries a status defined in models/order.py:42',
    );
    const result = runContent('overview.md', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('source file reference');
  });

  it('rejects secret-like value', () => {
    const content = validOverview().replace(
      'A typical product code looks like order-example.',
      'A typical product code looks like order-example. ' +
        'AKIAIOSFODNN7EXAMPLE identifies the account.',
    );
    const result = runContent('overview.md', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-like value');
  });

  it('rejects credential-like value', () => {
    const content = validOverview().replace(
      'A typical product code looks like order-example.',
      'A typical product code looks like order-example. ' +
        'apiKey: sample-value seeds the client.',
    );
    const result = runContent('overview.md', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('credential-like value');
  });

  it('rejects non-synthetic email', () => {
    const content = validOverview().replace('user@example.com', 'operator@acme-corp.com');
    const result = runContent('overview.md', content);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('credential-like value');
  });

  // -- provenance sidecar ---------------------------------------------------

  it('rejects malformed sidecar', () => {
    const result = withTempDir((dir) => {
      writeFileSync(join(dir, 'overview.md'), validOverview(), 'utf8');
      writeFileSync(
        join(dir, 'overview.provenance.json'),
        JSON.stringify({ commit: 'not-a-hash', dirty: 'yes', extra: 1 }),
        'utf8',
      );
      return run(join(dir, 'overview.md'));
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('provenance commit must be a git object hash');
    expect(result.stderr).toContain('provenance dirty must be a boolean');
    expect(result.stderr).toContain('provenance stamp has unsupported keys');
  });
});
