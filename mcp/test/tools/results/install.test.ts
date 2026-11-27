// The permission blocks of the install guide follow the catalog for the tools of module results:
// a tool the catalog keeps out at install (`install_allow: false`) — the log lines of a run show
// what the load generator printed — is in no `allow` list, and the guide names no tool of the
// catalog with a value of its own.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  RESULTS_CHECK_PRODUCTION,
  RESULTS_COMPARE_RUNS,
  RESULTS_EXPORT_REPORT,
  RESULTS_GET_LOGS,
  RESULTS_GET_REQUEST,
} from '../../../src/tools/results/meta.generated.js';

const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const GUIDES = ['INSTALL.md', 'INSTALL.pl.md'].map((name) => join(ROOT, 'docs', 'plugin', name));
const PREFIX = 'mcp__plugin_loadcraft_lc__';

/** Every tool name of the `allow` lists of a guide. */
function allowed(text: string): Set<string> {
  const names = new Set<string>();
  for (const block of text.matchAll(/"allow":\s*\[([^\]]*)\]/gu)) {
    for (const name of (block[1] ?? '').matchAll(/"([^"]+)"/gu)) names.add(name[1] ?? '');
  }
  return names;
}

const TOOLS = [
  RESULTS_GET_REQUEST,
  RESULTS_GET_LOGS,
  RESULTS_EXPORT_REPORT,
  RESULTS_CHECK_PRODUCTION,
  RESULTS_COMPARE_RUNS,
];

describe('install guide and the tools of module results', () => {
  it('keeps out of every allow list a tool the catalog keeps out at install', () => {
    expect(RESULTS_GET_LOGS.install_allow).toBe(false);
    for (const guide of GUIDES) {
      const names = allowed(readFileSync(guide, 'utf8'));
      expect(names.size, guide).toBeGreaterThan(0);
      for (const tool of TOOLS) {
        if (tool.install_allow) continue;
        expect(names.has(`${PREFIX}${tool.name}`), `${guide}: ${tool.name}`).toBe(false);
      }
    }
  });

  it('lets a tool that writes files into no allow list of reads only', () => {
    for (const guide of GUIDES) {
      const text = readFileSync(guide, 'utf8');
      const first = /"allow":\s*\[([^\]]*)\]/u.exec(text)?.[1] ?? '';
      expect(first, guide).not.toContain(`${PREFIX}${RESULTS_EXPORT_REPORT.name}`);
    }
  });
});
