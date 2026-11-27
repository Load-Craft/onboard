import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TOOL,
  DENIED_TOOL,
  parseProbeOutput,
  verdict,
  writeProbePlugin,
} from '../scripts/probe-subagent-tools.mjs';

type Obj = Record<string, unknown>;

const use = (id: string, name: string, parent: string | null): string =>
  JSON.stringify({
    type: 'assistant',
    parent_tool_use_id: parent,
    message: { content: [{ type: 'tool_use', id, name, input: {} }] },
  });
const result = (id: string, text: string, isError: boolean, parent: string | null): string =>
  JSON.stringify({
    type: 'user',
    parent_tool_use_id: parent,
    message: {
      content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }],
    },
  });
const done = (text: string): string => JSON.stringify({ type: 'result', result: text });

// Main agent delegates (call `a1`), the subagent calls the tools inside that delegation.
const delegate = [use('a1', 'Agent', null)];
const finish = [result('a1', 'report', false, null), done('final report')];

function stream(subagent: string[]): string {
  return [...delegate, ...subagent, ...finish, 'not json at all', ''].join('\n');
}

describe('parseProbeOutput', () => {
  it('separates the main agent calls from the subagent calls and reads their outcome', () => {
    const parsed = parseProbeOutput(
      stream([
        use('s1', ALLOWED_TOOL, 'a1'),
        result('s1', 'STUB-OK probe_allowed', false, 'a1'),
        use('s2', DENIED_TOOL, 'a1'),
        result('s2', 'No such tool available', true, 'a1'),
      ]),
    );
    expect(parsed.mainCalls.map((call) => call.name)).toEqual(['Agent']);
    expect(parsed.subagentCalls.map((call) => [call.name, call.isError])).toEqual([
      [ALLOWED_TOOL, false],
      [DENIED_TOOL, true],
    ]);
    expect(parsed.subagentCalls[0]?.text).toBe('STUB-OK probe_allowed');
    expect(parsed.finalText).toBe('final report');
  });

  it('reads the tool list of the init event and tolerates blocks it does not know', () => {
    const init = JSON.stringify({ type: 'system', subtype: 'init', tools: ['Agent', 7] });
    const odd = JSON.stringify({
      type: 'assistant',
      message: { content: [null, { type: 'text' }] },
    });
    const parsed = parseProbeOutput([init, odd].join('\n'));
    expect(parsed.initTools).toEqual(['Agent']);
    expect(parsed.mainCalls).toEqual([]);
  });

  it('joins the text parts of a structured tool result', () => {
    const structured = JSON.stringify({
      type: 'user',
      parent_tool_use_id: 'a1',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 's1',
            content: [
              { type: 'text', text: 'STUB-' },
              { type: 'text', text: 'OK' },
            ],
          },
        ],
      },
    });
    const parsed = parseProbeOutput(
      [use('a1', 'Agent', null), use('s1', ALLOWED_TOOL, 'a1'), structured].join('\n'),
    );
    expect(parsed.subagentCalls[0]?.text).toBe('STUB-OK');
    expect(parsed.subagentCalls[0]?.isError).toBe(false);
  });
});

describe('verdict', () => {
  const ok = (name: string, id: string): string[] => [
    use(id, name, 'a1'),
    result(id, 'STUB-OK', false, 'a1'),
  ];
  const failed = (name: string, id: string): string[] => [
    use(id, name, 'a1'),
    result(id, 'unavailable', true, 'a1'),
  ];

  it('accepts: the listed tool works and the unlisted one does not', () => {
    const parsed = parseProbeOutput(
      stream([...ok(ALLOWED_TOOL, 's1'), ...failed(DENIED_TOOL, 's2')]),
    );
    expect(verdict(parsed)).toBe('accepts');
  });

  it('does not claim the unlisted half when the subagent never tried the unlisted tool', () => {
    expect(verdict(parseProbeOutput(stream(ok(ALLOWED_TOOL, 's1'))))).toBe(
      'allowed-works-denied-unverified',
    );
  });

  it('ignored: both tools work, so the list restricts nothing', () => {
    const parsed = parseProbeOutput(stream([...ok(ALLOWED_TOOL, 's1'), ...ok(DENIED_TOOL, 's2')]));
    expect(verdict(parsed)).toBe('ignored');
  });

  it('rejects: the listed tool does not work in the subagent', () => {
    const parsed = parseProbeOutput(
      stream([...failed(ALLOWED_TOOL, 's1'), ...failed(DENIED_TOOL, 's2')]),
    );
    expect(verdict(parsed)).toBe('rejects');
  });

  it('rejects: the subagent made no call at all but answered', () => {
    expect(verdict(parseProbeOutput(stream([])))).toBe('rejects');
  });

  it('inconclusive: nothing happened', () => {
    expect(verdict(parseProbeOutput(''))).toBe('inconclusive');
  });

  it('ignores calls of the main agent', () => {
    const main = [use('m1', ALLOWED_TOOL, null), result('m1', 'STUB-OK', false, null)];
    expect(verdict(parseProbeOutput(main.join('\n')))).toBe('inconclusive');
  });
});

describe('writeProbePlugin', () => {
  it('lists exactly one full MCP name in the subagent file and names the plugin to match', () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-test-'));
    try {
      writeProbePlugin(dir);
      const agent = readFileSync(join(dir, 'agents', 'prober.md'), 'utf8');
      expect(agent).toContain(`tools: ${ALLOWED_TOOL}\n`);
      expect(agent).not.toContain(DENIED_TOOL);
      const manifest = JSON.parse(
        readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'),
      ) as Obj;
      expect(ALLOWED_TOOL.startsWith(`mcp__plugin_${String(manifest.name)}_`)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
