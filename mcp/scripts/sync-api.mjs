// `npm run sync:api`: pulls a backend's OpenAPI document into the plugin and lists what to fix.
// Run `node scripts/sync-api.mjs --help` for the sources and options; the logic is in sync-api/.

import { sync } from './sync-api/main.ts';

const report = await sync(process.argv.slice(2));
process.stdout.write(report.text);
process.exitCode = report.code;
