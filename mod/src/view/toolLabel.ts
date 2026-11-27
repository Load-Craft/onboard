/**
 * The name a LoadCraft tool row carries in the transcript: `LoadCraft · flows_get` instead of
 * `mcp__plugin_loadcraft_lc__flows_get`. Language-free: it is the tool's own name.
 */

import { shortToolName } from '../state/signal.js';

/** The label for a tool of the LoadCraft server; `undefined` for any other tool. */
export function toolLabel(toolName: unknown): string | undefined {
  const name = shortToolName(toolName);
  return name === undefined || !/^[a-z][a-z0-9_]*$/.test(name) ? undefined : `LoadCraft · ${name}`;
}
