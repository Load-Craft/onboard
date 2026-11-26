// Entry bundled by test/ws.channel.test.ts with the production build options: proves that the
// WebSocket client still works from one self-contained ESM file. Prints the first frame type.

import { Secret } from '../../src/secret.js';
import { createLogger } from '../../src/log.js';
import { openChannel } from '../../src/ws/channel.js';

const channel = await openChannel(
  {
    config: { apiUrl: process.env['WS_API_URL'] ?? '', token: new Secret('') },
    log: createLogger({ level: 'error' }),
  },
  { channel: 'scenario', params: { run_id: 'bundle' } },
);
for await (const frame of channel.frames) {
  process.stdout.write(`${frame.type}\n`);
  channel.close();
}
