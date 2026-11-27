// Which build of the plugin writes the state file. A server started before a rebuild keeps running its
// old code next to the new one (a session left open, a reconnect that started a second process): the
// two write one state file. The stamp `writer` of the file and the owner of its lock name the build,
// so a writer sees that another version writes too (DOKTOR-07).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { VERSION } from '../version.js';

/** The version and a hash of the code that runs (the bundle in dist, the module under tests). */
export const WRITER_BUILD: string = (() => {
  try {
    const code = readFileSync(fileURLToPath(import.meta.url));
    return `${VERSION}+${createHash('sha256').update(code).digest('hex').slice(0, 12)}`;
  } catch {
    return `${VERSION}+unknown`;
  }
})();
