// The crawler of the report on its own (`src/tools/results/reportFiles.ts`), with a reader that keeps
// answering after the export failed. Through the server a failed call aborts its requests, so a late
// answer never arrives there; the crawler must not count on that: a read that lands after the staging
// folder is removed must not make it again.

import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { exportReport, type ReportFile } from '../../../src/tools/results/reportFiles.js';

const RUN = 'e-3f9a12c4';

function workspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lc-report-files-')));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const later = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('exportReport: reads that land after a failure', () => {
  it('writes nothing once one read failed, whatever answers later', async () => {
    const root = workspace();
    const files = ['style/a.css', 'style/b.css', 'style/c.css', 'style/d.css'];
    const read = async (path: string): Promise<ReportFile> => {
      if (path === 'index.html') {
        const links = files.map((file) => `<link rel="stylesheet" href="${file}">`).join('');
        return { kind: 'file', bytes: bytes(links) };
      }
      if (path === 'style/a.css') throw new Error('the backend failed');
      // the other reads ignore the failure and answer later, into a folder that is gone
      await later(100);
      return { kind: 'file', bytes: bytes('body{}') };
    };

    await expect(exportReport(root, RUN, false, read)).rejects.toThrow('the backend failed');
    await later(250);

    const reports = join(root, 'loadcraft', 'reports');
    expect(readdirSync(reports).sort()).toEqual(['.gitignore']);
    expect(existsSync(join(reports, RUN))).toBe(false);
  });
});
