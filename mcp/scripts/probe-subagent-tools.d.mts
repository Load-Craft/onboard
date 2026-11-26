export const PLUGIN_NAME: string;
export const SERVER_NAME: string;
export const ALLOWED_TOOL: string;
export const DENIED_TOOL: string;
export const AGENT_NAME: string;
export const PROMPT: string;

export interface ProbeCall {
  id: string;
  name: string;
  inSubagent: boolean;
  isError: boolean | null;
  text: string;
}

export interface ProbeOutput {
  mainCalls: ProbeCall[];
  subagentCalls: ProbeCall[];
  initTools: string[];
  finalText: string;
}

export type ProbeVerdict =
  'accepts' | 'allowed-works-denied-unverified' | 'ignored' | 'rejects' | 'inconclusive';

export function writeProbePlugin(dir: string): void;
export function parseProbeOutput(stdout: string): ProbeOutput;
export function verdict(parsed: ProbeOutput, allowed?: string, denied?: string): ProbeVerdict;
