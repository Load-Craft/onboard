// Experiment: does the `tools` list of a plugin subagent accept full MCP tool names
// (`mcp__plugin_<plugin>_<server>__<tool>`), and does it hide the tools that are not on the list?
//
// The script builds a throw-away plugin in a temporary directory (one subagent whose `tools` lists a
// single MCP tool, and a stub MCP server with two tools that return a fixed text), runs
// `claude -p --plugin-dir <copy> --no-session-persistence` once, and prints what the subagent could call.
// Nothing is installed and no Claude Code setting is touched. Not part of dist.
//
// Usage: node scripts/probe-subagent-tools.mjs [--keep]   (--keep leaves the temporary directory)

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_NAME = 'probeplug';
export const SERVER_NAME = 'stub';
export const ALLOWED_TOOL = `mcp__plugin_${PLUGIN_NAME}_${SERVER_NAME}__probe_allowed`;
export const DENIED_TOOL = `mcp__plugin_${PLUGIN_NAME}_${SERVER_NAME}__probe_denied`;
export const AGENT_NAME = 'prober';

// Minimal MCP server over stdio (newline-delimited JSON-RPC): two tools, each answers a fixed text.
const STUB_SERVER = `
import { createInterface } from 'node:readline';
const TOOLS = ['probe_allowed', 'probe_denied'].map((name) => ({
  name,
  description: 'Returns a fixed text. Takes no arguments.',
  inputSchema: { type: 'object', properties: {} },
}));
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'stub', version: '0.0.0' },
      },
    });
  } else if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } });
  } else if (message.method === 'tools/call') {
    const name = message.params?.name;
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { content: [{ type: 'text', text: 'STUB-OK ' + name }] },
    });
  } else {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not found' } });
  }
});
`;

const AGENT_FILE = `---
name: ${AGENT_NAME}
description: Probe subagent. Use it when asked to run the tool probe.
tools: ${ALLOWED_TOOL}
---
You are a probe. Call the two tools named in the request, one after the other, by their exact full
names, unconditionally, even if one of them looks unavailable to you. Do not look for a way around a
failure. Report for each tool the raw result or the raw error text, verbatim.
`;

export const PROMPT =
  `Use the ${AGENT_NAME} subagent (Agent tool, subagent_type "${AGENT_NAME}"). ` +
  `Tell it to call both tools: ${ALLOWED_TOOL} and ${DENIED_TOOL}, unconditionally and by these full names, and to return the raw result or raw error of each. ` +
  `Do not call either tool yourself. Then repeat its report.`;

/** Writes the throw-away plugin into `dir`. */
export function writeProbePlugin(dir) {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(
    join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: PLUGIN_NAME, version: '0.0.0', description: 'Subagent tools probe' }),
  );
  writeFileSync(join(dir, 'stub-server.mjs'), STUB_SERVER);
  writeFileSync(
    join(dir, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        [SERVER_NAME]: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/stub-server.mjs'] },
      },
    }),
  );
  writeFileSync(join(dir, 'agents', `${AGENT_NAME}.md`), AGENT_FILE);
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) =>
      part !== null && typeof part === 'object' && typeof part.text === 'string' ? part.text : '',
    )
    .join('');
}

/**
 * Reads the stream-json output of `claude -p`. Returns the calls made by the main agent and by
 * subagents (events carrying `parent_tool_use_id`), each with the outcome of its result.
 */
export function parseProbeOutput(stdout) {
  const calls = new Map();
  const order = [];
  let finalText = '';
  let initTools = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (event.type === 'system' && event.subtype === 'init' && Array.isArray(event.tools)) {
      initTools = event.tools.filter((name) => typeof name === 'string');
    } else if (event.type === 'result' && typeof event.result === 'string') {
      finalText = event.result;
    }
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    const inSubagent = typeof event.parent_tool_use_id === 'string';
    for (const block of content) {
      if (block?.type === 'tool_use' && typeof block.id === 'string') {
        const call = {
          id: block.id,
          name: String(block.name),
          inSubagent,
          isError: null,
          text: '',
        };
        calls.set(block.id, call);
        order.push(call);
      } else if (block?.type === 'tool_result' && calls.has(block.tool_use_id)) {
        const call = calls.get(block.tool_use_id);
        call.isError = block.is_error === true;
        call.text = resultText(block.content);
      }
    }
  }
  return {
    mainCalls: order.filter((call) => !call.inSubagent),
    subagentCalls: order.filter((call) => call.inSubagent),
    initTools,
    finalText,
  };
}

/**
 * accepts: the listed tool worked in the subagent and a call of the unlisted one was refused or failed;
 * allowed-works-denied-unverified: the listed tool worked, the subagent never tried the unlisted one;
 * ignored: both worked, so the list restricted nothing;
 * rejects: the listed tool did not work in the subagent (the full name is not accepted);
 * inconclusive: the subagent never tried the listed tool.
 */
export function verdict(parsed, allowed = ALLOWED_TOOL, denied = DENIED_TOOL) {
  const worked = (name) =>
    parsed.subagentCalls.some((call) => call.name === name && call.isError === false);
  const attempted = (name) => parsed.subagentCalls.some((call) => call.name === name);
  if (worked(allowed) && worked(denied)) return 'ignored';
  if (worked(allowed)) {
    const refused = parsed.subagentCalls.some(
      (call) => call.name === denied && call.isError === true,
    );
    return refused ? 'accepts' : 'allowed-works-denied-unverified';
  }
  if (attempted(allowed)) return 'rejects';
  if (parsed.subagentCalls.length > 0 || parsed.finalText !== '') return 'rejects';
  return 'inconclusive';
}

function main() {
  const keep = process.argv.includes('--keep');
  const dir = mkdtempSync(join(tmpdir(), 'probe-subagent-tools-'));
  // An empty working directory of its own, so the plugin's .mcp.json is not also read as a project file.
  const cwd = mkdtempSync(join(tmpdir(), 'probe-subagent-cwd-'));
  try {
    writeProbePlugin(dir);
    const run = spawnSync(
      'claude',
      [
        '-p',
        PROMPT,
        '--plugin-dir',
        dir,
        '--no-session-persistence',
        '--output-format',
        'stream-json',
        '--verbose',
        '--allowedTools',
        `mcp__plugin_${PLUGIN_NAME}_${SERVER_NAME}__*`,
      ],
      { cwd, encoding: 'utf8', timeout: 240_000, maxBuffer: 64 * 1024 * 1024 },
    );
    if (run.error) throw run.error;
    const parsed = parseProbeOutput(run.stdout);
    const show = (call) =>
      `${call.name} -> ${call.isError === null ? 'no result' : call.isError ? 'error' : 'ok'} ${call.text.slice(0, 80)}`;
    process.stdout.write(`claude exit code: ${String(run.status)}\n`);
    process.stdout.write(
      `main agent calls:\n${parsed.mainCalls.map((c) => '  ' + show(c)).join('\n')}\n`,
    );
    process.stdout.write(
      `subagent calls:\n${parsed.subagentCalls.map((c) => '  ' + show(c)).join('\n')}\n`,
    );
    process.stdout.write(`final text: ${parsed.finalText}\n`);
    process.stdout.write(`verdict: ${verdict(parsed)}\n`);
    if (keep) process.stdout.write(`kept: ${dir}\n`);
  } finally {
    if (!keep) {
      rmSync(dir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
