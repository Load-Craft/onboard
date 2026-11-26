// Fails when dist/server.mjs or dist/demo-backend.mjs differs from what the current sources build to.

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_OUT, DEMO_BACKEND_OUT, buildDemoBackendTo, buildTo } from './build.mjs';
import { TOOLS_OUT, renderTools } from './list-tools.mjs';

const dir = await mkdtemp(join(tmpdir(), 'lc-mcp-dist-'));
try {
  const fresh = join(dir, 'server.mjs');
  await buildTo(fresh);
  const [expected, committed] = await Promise.all([
    readFile(fresh),
    readFile(DEFAULT_OUT).catch(() => null),
  ]);
  if (committed === null || !expected.equals(committed)) {
    process.stderr.write(
      'dist/server.mjs is out of date: uruchom npm run build i dodaj dist do commita\n',
    );
    process.exitCode = 1;
  }
  const freshDemo = join(dir, 'demo-backend.mjs');
  await buildDemoBackendTo(freshDemo);
  const [expectedDemo, committedDemo] = await Promise.all([
    readFile(freshDemo),
    readFile(DEMO_BACKEND_OUT).catch(() => null),
  ]);
  if (committedDemo === null || !expectedDemo.equals(committedDemo)) {
    process.stderr.write(
      'dist/demo-backend.mjs is out of date: uruchom npm run build i dodaj dist do commita\n',
    );
    process.exitCode = 1;
  }
  const tools = await readFile(TOOLS_OUT, 'utf8').catch(() => null);
  if (tools !== (await renderTools(buildTo))) {
    process.stderr.write(
      'dist/tools.json is out of date: uruchom npm run build i dodaj dist do commita\n',
    );
    process.exitCode = 1;
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
