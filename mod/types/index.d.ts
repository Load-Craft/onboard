// The values the mod keeps in `$.state`. The manifest's `types` field points here, so that
// `claude plugin validate` can check `atom({ plugin, key }, …)` against these declarations.
// The file must be self-contained (no import), so the shape of `session` is written out here;
// mod/test/reduce.spec.ts fails to compile when it drifts from `ModState` in src/state/types.ts,
// and mod/test/consent.spec.ts when `consent` drifts from `Ledger` in src/consent/ledger.ts.
declare module 'claude-code' {
  /** JSON as the state stores it. */
  type PanelJson =
    string | number | boolean | null | readonly PanelJson[] | { readonly [key: string]: PanelJson };

  interface PluginState {
    loadcraft: {
      /** The session state `reduce` produces: step, project, environment, running operation. */
      session: {
        readonly project?: { readonly name: string; readonly id: string };
        readonly environment?: {
          readonly name: string;
          readonly protected: boolean;
        };
        readonly step: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
        readonly done: readonly number[];
        readonly operation?: {
          readonly handle: string;
          readonly kind: string;
          readonly tool: string;
          readonly startedAt: number;
        };
        readonly lastExecution?: string;
        readonly ended: readonly string[];
        readonly skipped: readonly number[];
        readonly updatedAt: number;
        readonly isStale: boolean;
      };
      /** The live line of a running `run_start` call (`ModProgress` in src/state/types.ts). */
      progress: {
        readonly call?: string;
        readonly samples: readonly number[];
        readonly snapshot?: {
          readonly operation: string;
          readonly kind: string;
          readonly phase?: string;
          readonly elapsed_s: number;
          readonly load_elapsed_s?: number;
          readonly planned_s?: number;
          readonly live?: {
            readonly rps: number | null;
            readonly p95_ms: number | null;
            readonly error_pct: number | null;
          };
          readonly needs_user?: string;
          readonly reason?: string;
        };
      };
      /** The bars of the long operations in progress (`ModBars` in src/state/types.ts). */
      bars: {
        readonly rows: readonly {
          readonly call: string;
          readonly handle?: string;
          readonly kind?: string;
          readonly tool: string;
          readonly stage: string;
          readonly percent?: number;
          readonly n?: number;
          readonly m?: number;
          readonly startedAt: number;
          readonly updatedAt: number;
          readonly open: boolean;
        }[];
        readonly finished: readonly {
          readonly row: {
            readonly call: string;
            readonly handle?: string;
            readonly kind?: string;
            readonly tool: string;
            readonly stage: string;
            readonly percent?: number;
            readonly n?: number;
            readonly m?: number;
            readonly startedAt: number;
            readonly updatedAt: number;
            readonly open: boolean;
          };
          readonly until: number;
          readonly end?: 'done' | 'failed' | 'cancelled';
        }[];
      };
      /** The cards above the prompt: the queue and the keys the user closed (`CardsState` in src/card/queue.ts). */
      cards: {
        readonly queue: readonly {
          readonly key: string;
          readonly kind: 'end' | 'docs' | 'profile' | 'check';
          readonly priority: number;
          readonly title: string;
          readonly lines: readonly string[];
          readonly actions: readonly {
            readonly digit: '0' | '1' | '2';
            readonly label: string;
            readonly effect:
              | { readonly kind: 'pane'; readonly tab: 'run' | 'project' | 'results' | 'path' }
              | { readonly kind: 'ask'; readonly topic: 'why'; readonly handle: string }
              | { readonly kind: 'ask'; readonly topic: 'migrate' }
              | { readonly kind: 'close' };
          }[];
          readonly expiresAt?: number;
        }[];
        readonly closed: readonly string[];
      };
      /** What the user agreed to in the consent dialog (`Ledger` in src/consent/ledger.ts). */
      consent: {
        readonly entries: readonly {
          readonly tool: string;
          readonly key: string;
          readonly at: number;
        }[];
      };
      /**
       * What the side panel keeps beside the session (`PanelData` in src/pane/tabs.ts): the last
       * reading of the operation in progress, the live preview, the project as the last status listed it and the summary of the newest report.
       */
      panel: {
        readonly snapshot?: {
          readonly operation: string;
          readonly kind: string;
          readonly phase?: string;
          readonly elapsed_s: number;
          readonly load_elapsed_s?: number;
          readonly planned_s?: number;
          readonly live?: {
            readonly rps: number | null;
            readonly p95_ms: number | null;
            readonly error_pct: number | null;
          };
          readonly needs_user?: string;
          readonly reason?: string;
        };
        readonly preview?: { readonly handle: string; readonly href: string };
        /** The last test that failed (`TestFailure` in src/pane/tabs.ts). */
        readonly failure?: { readonly operation: string; readonly reason?: string };
        readonly project?: {
          readonly path?: {
            readonly docs: boolean;
            readonly recording: boolean;
            readonly frontend: boolean;
            readonly journeys: readonly {
              readonly name: string;
              readonly pattern: string;
              readonly steps: readonly string[];
              readonly built: boolean;
            }[];
          };
          readonly setupComplete?: boolean;
          readonly environments: readonly {
            readonly name: string;
            readonly isDefault: boolean;
            readonly protected: boolean;
            readonly active: boolean;
            readonly maxVu?: number;
            readonly maxRps?: number;
          }[];
          readonly counts: {
            readonly flows: number;
            readonly scenarios: number;
            readonly compositions: number;
          };
          readonly runs: readonly {
            readonly handle: string;
            readonly target: string;
            readonly verdict?: string;
          }[];
          readonly uncertainFields?: readonly string[];
          readonly oldDocs?: readonly string[];
        };
        /** The flows of the project (`Loaded<FlowFact>` in src/pane/tabs.ts). */
        readonly flows?: {
          readonly stamp: string;
          readonly failed?: true;
          readonly items: readonly {
            readonly name: string;
            readonly steps: number;
            readonly oldDocs: boolean;
            readonly odd?: true;
          }[];
          readonly more: number;
        };
        /** The test runs (`Loaded<RunRow>` in src/pane/tabs.ts). */
        readonly runs?: {
          readonly stamp: string;
          readonly failed?: true;
          readonly items: readonly {
            readonly handle: string;
            readonly target: string;
            readonly verdict?: string;
            readonly when?: string;
          }[];
          readonly more: number;
        };
        /** The steps of the flow open in the preview (`OutlineFacts` in src/pane/tabs.ts). */
        readonly outline?: {
          readonly flow: string;
          readonly failed?: true;
          readonly steps: readonly {
            readonly num: string;
            readonly kind: 'request' | 'pause' | 'other';
            readonly name: string;
            readonly method?: string;
            readonly path?: string;
            readonly description?: string;
            readonly uses: readonly string[];
            readonly produces: readonly string[];
            readonly feeder: readonly string[];
            readonly statuses: readonly number[];
            readonly validators: readonly string[];
          }[];
          readonly total: number;
          readonly truncated: boolean;
        };
        /** The keys marked in the lists that keep their marks in the panel, by list id. */
        readonly marks?: { readonly [list: string]: readonly string[] };
        readonly report?: {
          readonly href?: string;
          readonly data: { readonly [key: string]: PanelJson };
        };
        /** What the user picked in the Path tab (`PathChoice` in src/pane/tabs.ts). */
        readonly choice?: {
          readonly method?: 'docs' | 'describe' | 'har' | 'manual';
          readonly journeys: readonly string[];
        };
        /** The newest self-check view (`SelfCheckFacts` in src/pane/selfCheck.ts). */
        readonly selfCheck?: {
          readonly key: string;
          readonly savedAt: string;
          readonly environment?: string;
          readonly scenarios: readonly {
            readonly id: string;
            readonly name: string;
            readonly status: string;
            readonly version?: number;
            readonly run: number;
            readonly steps: readonly {
              readonly name: string;
              readonly method?: string;
              readonly path?: string;
              readonly result?: 'ok' | 'failed' | 'skipped';
              readonly http?: number;
            }[];
            readonly moreSteps: number;
            readonly failure?: {
              readonly step?: string;
              readonly http?: number;
              readonly message: string;
            };
            readonly runs: readonly {
              readonly run: number;
              readonly version?: number;
              readonly handle?: string;
              readonly verdict?: string;
              readonly results: readonly {
                readonly step: number;
                readonly result: 'ok' | 'failed' | 'skipped';
                readonly http?: number;
                readonly reason?: string;
              }[];
            }[];
            readonly repairs: readonly {
              readonly round: number;
              readonly outcome: 'repaired' | 'refused';
              readonly text: string;
              readonly version?: number;
            }[];
            readonly repairLimit: number;
          }[];
        };
        readonly selfCheckFailed?: true;
        /** The view of each list of the panel (`ListView` in src/view/list.ts), by the id of the list. */
        readonly lists?: {
          readonly [list: string]: {
            readonly query: string;
            readonly open?: string;
            readonly expanded: readonly string[];
          };
        };
      };
    };
  }
}
