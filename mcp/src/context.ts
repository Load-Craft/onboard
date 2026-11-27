// What a tool receives besides its arguments.

import type { Config, Locale } from './config.js';
import type { HttpClient } from './http/client.js';
import type { Links } from './links.js';
import type { Logger } from './log.js';
import type { SecretScope } from './secret.js';
import type { Clock } from './ops/clock.js';
import type { StateCache } from './workspace/cache.js';

export type TranslationParams = Readonly<Record<string, string | number>>;

export interface Translator {
  (key: string, params?: TranslationParams): string;
  plural(key: string, count: number, params?: TranslationParams): string;
  /** Whether the dictionary has the key; lets a caller fall back to a literal text. */
  has(key: string): boolean;
  readonly locale: Locale;
}

export interface ProgressReporter {
  /** Short status line for the client; `fraction` in 0..1 when known. */
  report(message: string, fraction?: number): void;
  /** The call follows long operation `handle`; its bar in the workspace state is keyed by it. */
  attach?(handle: string): void;
  /** Called by the registry once the handler finished; nothing is sent afterwards. */
  stop(): void;
}

/** Process-wide clients shared by tools; created once per server process (see `createServices`). */
export interface Services {
  /** Typed LoadCraft REST client: token, time limit, retries for reads, `LoadcraftApiError`. */
  readonly http: HttpClient;
  /** Addresses of LoadCraft app screens, built from the configured app URL. */
  readonly links: Links;
}

export interface ToolContext {
  readonly config: Config;
  readonly log: Logger;
  readonly signal: AbortSignal;
  readonly t: Translator;
  readonly progress: ProgressReporter;
  readonly secrets: SecretScope;
  readonly services: Services;
  /** Time source of the call; long operations wait and stamp entries with it. */
  readonly clock: Clock;
  /**
   * Workspace state (`loadcraft/.cache/state.json`), created for this call and bound to its
   * `secrets`: a value holding one of them is never written.
   */
  readonly state: StateCache;
  /**
   * The answers the client collected from the person for the questions of an earlier round of this
   * call (MCP `inputResponses`, outside the arguments the model writes); read with `consent/ask.ts`.
   */
  readonly inputResponses?: Readonly<Record<string, unknown>> | undefined;
  /** The client can ask the person a question (it declares form elicitation for this call). */
  readonly canAsk?: boolean;
}
