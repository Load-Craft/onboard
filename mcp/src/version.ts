import { readFileSync } from 'node:fs';

// The bundle build (scripts/build.mjs) replaces this constant with the version from package.json, so
// dist/server.mjs carries the version number and nothing else from package.json.
declare const __LOADCRAFT_VERSION__: string | undefined;

function readPackageVersion(): string {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

export const VERSION: string =
  typeof __LOADCRAFT_VERSION__ === 'string' ? __LOADCRAFT_VERSION__ : readPackageVersion();
