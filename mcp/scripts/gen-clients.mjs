// `npm run gen:clients`: writes the typed clients of the backend contracts.
//   REST:      contracts/loadcraft-openapi.json  -> src/http/generated/api.d.ts   (openapi-typescript)
//   WebSocket: contracts/loadcraft-asyncapi.json -> src/ws/generated/channels.ts  (scripts/gen-clients/)
//   --check                 writes nothing; exits 1 when a generated file differs from its source
//   --only api|ws           one half only
//   --openapi <f> --asyncapi <f> --out-api <f> --out-ws <f>   replace the defaults (used by `sync:api`)
// `npm run gen:api` / `check:api` are the REST half alone, `gen:ws` / `check:ws` the WebSocket half.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { generate as generateApi, OUT as API_OUT } from './gen-api.mjs';
import { emitChannelTypes } from './gen-clients/emit.ts';
import { readChannels } from './gen-clients/model.ts';

const ROOT = resolve(import.meta.dirname, '..');
const CONTRACTS = resolve(ROOT, '..', 'contracts');
export const ASYNCAPI = resolve(CONTRACTS, 'loadcraft-asyncapi.json');
export const WS_OUT = resolve(ROOT, 'src', 'ws', 'generated', 'channels.ts');

/** The WebSocket types of an AsyncAPI document file. */
export async function generateWs(spec = ASYNCAPI) {
  const document = JSON.parse(await readFile(spec, 'utf8'));
  return emitChannelTypes(readChannels(document), 'contracts/loadcraft-asyncapi.json');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const option = (name) => {
    const at = process.argv.indexOf(name);
    return at === -1 ? undefined : resolve(process.argv[at + 1] ?? '');
  };
  const check = process.argv.includes('--check');
  const only = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1]
    : undefined;
  // Two independent generators: one that fails does not stop or hide the other.
  if (only !== undefined && only !== 'api' && only !== 'ws') {
    process.stderr.write(`gen:clients: --only takes "api" or "ws", not "${only}"\n`);
    process.exit(1);
  }
  const targets = [];
  if (only !== 'ws') {
    targets.push({
      name: 'REST client',
      command: 'gen:api',
      source: option('--openapi') ?? 'contracts/loadcraft-openapi.json',
      out: option('--out-api') ?? API_OUT,
      make: () => generateApi(option('--openapi')),
    });
  }
  if (only !== 'api') {
    targets.push({
      name: 'WebSocket client',
      command: 'gen:ws',
      source: option('--asyncapi') ?? 'contracts/loadcraft-asyncapi.json',
      out: option('--out-ws') ?? WS_OUT,
      make: () => generateWs(option('--asyncapi')),
    });
  }
  const outcome = [];
  for (const { name, command, source, out, make } of targets) {
    try {
      const text = await make();
      if (check) {
        const current = await readFile(out, 'utf8').catch(() => null);
        if (current !== text) {
          throw new Error(
            `${name}: ${out.slice(ROOT.length + 1)} is out of date: run npm run ${command} and add the file to the commit`,
          );
        }
      } else {
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, text);
      }
      outcome.push({ command, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${command}: ${source}: ${message}\n`);
      process.exitCode = 1;
      outcome.push({ command, ok: false });
    }
  }
  if (outcome.length > 1) {
    const line = outcome.map((o) => `${o.command} ${o.ok ? 'ok' : 'FAILED'}`).join(', ');
    process.stderr.write(`${check ? 'check' : 'gen'}:clients: ${line}\n`);
  }
}
