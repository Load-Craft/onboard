// Test aid: preloaded with `node --import scripts/net-guard.mjs dist/server.mjs`. Every outgoing
// TCP connection (HTTP, TLS and WebSocket all end in `net.Socket#connect`) is written to the file
// named by LC_NET_GUARD_LOG, one line per attempt: `ok <host>:<port>` for the loopback interface,
// `blocked <host>:<port>` for any other address, which is also refused. Not part of dist.

import { appendFileSync } from 'node:fs';
import net from 'node:net';

const log = process.env.LC_NET_GUARD_LOG;

function target(args) {
  // net.connect hands the socket its arguments already normalized: `[options, callback]`.
  const [first, second] = Array.isArray(args[0]) ? args[0] : args;
  if (typeof first === 'object' && first !== null) {
    if (typeof first.path === 'string') return { local: true, label: `unix:${first.path}` };
    return { host: String(first.host ?? 'localhost'), port: String(first.port ?? '') };
  }
  if (typeof first === 'string' && Number.isNaN(Number(first))) {
    return { local: true, label: `unix:${first}` };
  }
  return { host: typeof second === 'string' ? second : 'localhost', port: String(first) };
}

function isLoopback(host) {
  return (
    host === 'localhost' || host === '::1' || host === '[::1]' || /^127(\.\d{1,3}){3}$/u.test(host)
  );
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const where = target(args);
  const label = where.label ?? `${where.host}:${where.port}`;
  const allowed = where.local === true || isLoopback(where.host);
  if (log !== undefined) appendFileSync(log, `${allowed ? 'ok' : 'blocked'} ${label}\n`);
  if (!allowed) {
    queueMicrotask(() => this.destroy(new Error(`net-guard: connection to ${label} refused`)));
    return this;
  }
  return connect.apply(this, args);
};
