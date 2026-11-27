// Every tool is one `defineTool` call: input schema, `run` returning view data, `render` turning
// finished data into text. An unfinished outcome (`running`, `needs_user`) is drawn here, with one
// view for every tool. Validation, the error boundary and the shape of the result live here only.

import { randomUUID } from 'node:crypto';

import {
  CLIENT_CAPABILITIES_META_KEY,
  isInputRequiredResult,
  type CallToolResult,
  type InputRequiredResult,
  type McpServer,
  type ServerContext,
} from '@modelcontextprotocol/server';
import * as z from 'zod';

import { LOG_META } from './catalog.generated.js';
import type { Config } from './config.js';
import { declaresForm, QuestionForUser, questionResult } from './consent/ask.js';
import type { ProgressReporter, Services, ToolContext, Translator } from './context.js';
import { ToolError } from './errors.js';
import { LoadcraftApiError } from './http/apiError.js';
import { toToolError } from './http/errors.js';
import { mergeUpdates, type PendingOutcome, type ToolOutcome } from './outcome.js';
import { systemClock, type Clock } from './ops/clock.js';
import { createLiveProgress, type LiveProgress } from './ops/liveProgress.js';
import { createProgress } from './ops/progress.js';
import { createTranslator } from './render/i18n/index.js';
import type { Logger } from './log.js';
import { createStateCache } from './workspace/cache.js';
import type { SecretScope } from './secret.js';
import { migrateState } from './workspace/migrate.js';
import {
  buildLogEntry,
  declaresFromPanel,
  logToolOf,
  logValueCollisions,
  templateValues,
  unfilledSlots,
  type CallEnd,
  type LogEntryInput,
} from './workspace/logEntry.js';
import { detailOf, storesDetail } from './workspace/logDetails.js';
import { NEW_KEY, recordCall, type Process } from './workspace/processState.js';
import { adoptBinding, processKey } from './workspace/processKey.js';
import type {
  ForeignWriter,
  ProcessStore,
  ProcessStoreOptions,
  ProcessUpdateInput,
} from './workspace/reducer.js';
import { CallSecretScope } from './workspace/secrets.js';
import { runsUnderTests } from './underTests.js';
import { UNFILLED_RESULT_SLOTS } from './workspace/logSlotDebt.js';
import { withShownNames } from './tools/shownNames.js';

export interface ToolAnnotationHints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolSpec<I extends z.ZodType, D> {
  name: string;
  title: string;
  description: string;
  input: I;
  annotations: ToolAnnotationHints;
  meta?: Record<string, unknown>;
  /**
   * The names and texts of a third party in the finished data (`name`, `label`, `dataset`, …) pass
   * `content()` before anything sees them (`tools/shownNames.ts`, FIX-76): for a tool that copies
   * names from LoadCraft's answers into its data without masking them itself.
   */
  maskNames?: true;
  run(ctx: ToolContext, args: z.infer<I>): Promise<ToolOutcome<D>>;
  /**
   * Text of finished data. `args` are those of the call, for a view chosen by the input (`process_wait`
   * draws with the view of the kind its handle names).
   */
  render(data: D, t: Translator, args: z.infer<I>): string;
}

/** A tool with its data type erased, ready to be registered. */
export interface Tool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly input: z.ZodType;
  readonly annotations: ToolAnnotationHints;
  readonly meta?: Record<string, unknown>;
  invoke(ctx: ToolContext, args: unknown): Promise<{ outcome: ToolOutcome<unknown>; text: string }>;
}

export function defineTool<I extends z.ZodType, D>(spec: ToolSpec<I, D>): Tool {
  const tool: Tool = {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    input: spec.input,
    annotations: spec.annotations,
    async invoke(ctx, args) {
      // The SDK has already validated `args` against `spec.input` before the handler runs.
      const input = args as z.infer<I>;
      // The view wraps, cuts and joins what it is given, and a secret reshaped that way no longer
      // looks like itself: every registered value leaves the data before the view sees it.
      const ran = await spec.run(ctx, input);
      const shown = spec.maskNames === true ? withShownNames(ctx, ran) : ran;
      const outcome = ctx.secrets.scrubDeep(shown, { keys: 'keep' });
      const text =
        outcome.status === 'done'
          ? spec.render(outcome.data, ctx.t, input)
          : pendingView(outcome, ctx.t);
      return { outcome, text };
    },
  };
  return spec.meta === undefined ? tool : { ...tool, meta: spec.meta };
}

/** Progress, the handle, and the next step: the same lines for every unfinished operation. */
function pendingView(outcome: PendingOutcome, t: Translator): string {
  const { status, operation, data } = outcome;
  const lines = [data.message];
  if (data.note !== undefined) lines.push(data.note);
  lines.push(t(`operation.${status}.state`, { operation }));
  lines.push(`→ ${data.next ?? t(`operation.${status}.next`, { operation })}`);
  return lines.join('\n');
}

/** Opens the process store of the workspace for one call (`createProcessStore`). */
export type JournalFactory = (root: string, options: ProcessStoreOptions) => ProcessStore;

export interface RegistryDeps {
  config: Config;
  log: Logger;
  services: Services;
  /** Time source of every call (progress, operations, state); tests inject a controlled clock. */
  clock?: Clock;
  /**
   * The log of calls: with it, every tool that has a catalog entry leaves an entry in the state
   * file after each call (`withLog`). Without it nothing is written.
   */
  journal?: JournalFactory;
}

function endOf(outcome: ToolOutcome<unknown>): CallEnd {
  const link = outcome.links?.[0]?.url;
  const linked = link === undefined ? {} : { link };
  return outcome.status === 'done'
    ? {
        kind: 'done',
        data: outcome.data,
        ...linked,
        ...(outcome.consent === undefined ? {} : { consent: outcome.consent }),
      }
    : { kind: 'running', data: outcome.data, handle: outcome.operation, ...linked };
}

/**
 * The code and the text the model is shown for a failure, for its log entry. A text the dictionary
 * cannot build leaves the entry with the code alone: the failure is logged either way.
 */
function shownFailure(error: unknown, ctx: ToolContext): { code: string; message: string } {
  try {
    const shown = toToolError(ctx.secrets.scrubDeep(error), ctx.t, {
      withhold: ctx.secrets.incomplete,
    });
    return { code: shown.code, message: shown.message };
  } catch {
    const code = error instanceof ToolError ? error.code : 'internal_error';
    return { code, message: code };
  }
}

/** Longest list of refused fields of the state a result names. */
const MAX_REFUSED_FIELDS = 300;

/** Longest cause of a failed write the server log keeps. */
const MAX_WRITE_CAUSE = 500;

/** What the server log says about a write of the state that failed: its code, fields and cause, masked. */
function writeFailure(
  error: unknown,
  secrets: Pick<SecretScope, 'scrub'>,
): Record<string, unknown> {
  const fields = error instanceof ToolError ? error.params?.['fields'] : undefined;
  const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return {
    code: error instanceof ToolError ? error.code : 'internal_error',
    ...(fields === undefined ? {} : { fields }),
    cause: secrets.scrub(cause).slice(0, MAX_WRITE_CAUSE),
  };
}

/**
 * The tool with its log: after every call, a success or a failure, the effect the tool returned
 * (`update` of its outcome), the ends of the operations the call saw end (`StateCache.endOperation`)
 * and one log entry are written to the process of the workspace through the reducer, in one write. The reducer
 * stamps and invalidates by the catalog entry of the call, and only a call that succeeded is a
 * trigger. The store is opened per call, because the secrets it masks belong to the call (also
 * those the tool registers while it runs: the entry is built after the call). A tool without a
 * catalog entry (a helper) is returned as it is. The entry never changes what the call returns: a
 * failed write is only logged, and an update the schema refuses is logged and dropped, the entry
 * saved without it.
 */
/** Codes of a write that another process held up or spoiled: tried once more after `LOG_RETRY_MS`. */
const RETRIED_WRITES: ReadonlySet<string> = new Set(['state_locked', 'state_conflict']);
const LOG_RETRY_MS = 150;
const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The entries this process wrote, per workspace and process key (the newest `OWN_ENTRIES_KEPT`): when a writer of
 * another build is seen in the file, an entry of ours it dropped is put back in the same write.
 */
const OWN_ENTRIES_KEPT = 20;
type OwnEntry = {
  readonly entry: LogEntryInput & { readonly id: string };
  readonly format: string | undefined;
};
const ownEntries = new Map<string, OwnEntry[]>();

function rememberEntry(key: string, own: OwnEntry): void {
  const list = [...(ownEntries.get(key) ?? []), own];
  ownEntries.set(key, list.slice(-OWN_ENTRIES_KEPT));
}

/** The process with every remembered entry of ours that is missing from it put back. */
function withOwnEntries(p: Process, key: string, now: string, current: string): Process {
  const present = new Set([...p.log, ...p.reads].map((entry) => entry.id));
  let next = p;
  for (const own of ownEntries.get(key) ?? []) {
    if (own.entry.id === current || present.has(own.entry.id)) continue;
    next = recordCall(next, { entry: own.entry, format: own.format }, now);
  }
  return next;
}

export function withLog(tool: Tool, journal: JournalFactory): Tool {
  if (logToolOf(tool.name, {}) === undefined) return tool;
  const fromPanel = declaresFromPanel(tool.input);
  return {
    ...tool,
    async invoke(ctx, args) {
      const startedAt = ctx.clock.now();
      // What the write of the entry met: the code of an entry not saved, or another build that writes
      // the same file; undefined when the entry was saved and nothing else was seen (DOKTOR-07).
      const record = async (
        end: CallEnd,
        update: ProcessUpdateInput | undefined,
        inert = false,
      ): Promise<{ lost?: string; refused?: string; foreign?: ForeignWriter } | undefined> => {
        // a split tool of today: the way the call took (its arguments, then its result) decides
        // the catalog entry, so it is chosen after the call
        const data = end.kind === 'done' || end.kind === 'running' ? end.data : undefined;
        const catalogTool = logToolOf(tool.name, args, data);
        if (catalogTool === undefined) return undefined;
        // `log.values` win in the entry; one that fills a slot of the result other than the data of the
        // same name is a mistake of the tool, made loud under the tests only
        if (runsUnderTests()) {
          // the way of the undo a tool names must be one of the ways of its catalog entry
          const named = update?.log?.undo_args?.['undo_tool'];
          if (
            named !== undefined &&
            !LOG_META[catalogTool].undo.some((way) => way.tool === named)
          ) {
            throw new TypeError(
              `${tool.name}: undo_tool ${JSON.stringify(named)} is none of the undo ways of its catalog entry`,
            );
          }
          // a call that only made a consent card has no result yet: its entry says it waits
          const asked = end.kind === 'done' && end.consent === 'asked';
          const clashes = asked
            ? []
            : logValueCollisions(LOG_META[catalogTool].log.result, update?.log?.values, data);
          if (clashes.length > 0) {
            throw new TypeError(
              `${tool.name}: log.values ${clashes.join(', ')} fill a slot of the result other than the data of the same name`,
            );
          }
          // A slot of the result no value fills prints `none` in the entry; a tool whose data may
          // lack a slot gives its value in `log.values`, so the entry says what the call did.
          const unfilled =
            end.kind === 'done' && !asked
              ? unfilledSlots(
                  LOG_META[catalogTool].log.result,
                  templateValues(update?.log?.values, data, args),
                )
              : [];
          const owed = new Set(UNFILLED_RESULT_SLOTS[catalogTool] ?? []);
          const unowed = unfilled.filter((slot) => !owed.has(slot));
          if (unowed.length > 0) {
            throw new TypeError(
              `${tool.name}: the result of its log entry leaves ${unowed.join(', ')} without a value; give it in log.values`,
            );
          }
        }
        try {
          const draft = buildLogEntry({
            tool: tool.name,
            catalogTool,
            args,
            end,
            startedAt,
            ms: ctx.clock.now() - startedAt,
            secrets: ctx.secrets,
            fromPanel,
            ...(update?.log?.undo_args === undefined ? {} : { undoArgs: update.log.undo_args }),
            ...(update?.log?.values === undefined ? {} : { values: update.log.values }),
          });
          const format =
            typeof args === 'object' && args !== null && 'format' in args
              ? typeof args.format === 'string'
                ? args.format
                : undefined
              : undefined;
          // only a call the log records with its own entry keeps a detail
          const keepsDetail = storesDetail(draft, format);
          const built = { ...draft, has_detail: keepsDetail };
          // a file of an older schema is migrated by the first entry, like the cache does on its first read
          const store = journal(ctx.config.stateRoot, {
            secrets: ctx.secrets,
            clock: ctx.clock,
            migrate: (raw) =>
              migrateState(raw, { scrubDeep: <T>(value: T): T => ctx.secrets.scrubDeep(value) }),
          });
          // The key is read once per call, outside the lock: a `project.json` written by another process
          // between this read and the write puts one entry under the older key, and the next call moves it.
          const key = processKey(ctx.config.stateRoot, ctx.config.appUrl);
          // a clone that arrives bound, with a state file that still holds `_new`, is moved first
          await adoptBinding(store, ctx.config.stateRoot, key);
          const failed = end.kind === 'error' || end.kind === 'cancelled';
          const write = (change: ProcessUpdateInput): ReturnType<ProcessStore['applyUpdate']> =>
            store.applyUpdate(key, change, {
              // the table of invalidations and the `by` of checks name catalog entries
              tool: catalogTool,
              ...(failed ? { failed } : {}),
              ...(inert ? { inert } : {}),
              // the binding is recorded in the same write as the entry
              ...(key === NEW_KEY ? {} : { bound: key }),
              // `rev` is the store's: it raises it once per write that changes the process
              then: (p, now, foreign) => {
                const recorded = recordCall(p, { entry: built, format }, now);
                // a writer of another build may have dropped entries of ours: they go back (DOKTOR-07)
                return foreign === undefined
                  ? recorded
                  : withOwnEntries(recorded, `${ctx.config.stateRoot}\0${key}`, now, built.id);
              },
              // the detail lands in the same write as its entry, so the log never points at a missing detail
              ...(keepsDetail
                ? {
                    detail: {
                      id: built.id,
                      entry: detailOf({ args, end, secrets: ctx.secrets }, ctx.clock.now()),
                    },
                  }
                : {}),
            });
          // the operations the call ended (also a failed or cancelled call) end in the same write
          const ended = ctx.state.endedOperations();
          let foreign: ForeignWriter | undefined;
          const save = async (): Promise<void> => {
            try {
              foreign = (await write(mergeUpdates(update, ended) ?? {})).foreign;
            } catch (error) {
              const refused = error instanceof ToolError && error.code === 'state_update_invalid';
              if (update === undefined || !refused) throw error;
              ctx.log.warn('state update of the call not saved', writeFailure(error, ctx.secrets));
              foreign = (await write(ended ?? {})).foreign;
            }
          };
          try {
            await save();
          } catch (error) {
            // another process held the lock past its wait, or wrote outside it: one more try
            if (!(error instanceof ToolError) || !RETRIED_WRITES.has(error.code)) throw error;
            ctx.log.warn('log entry not saved, trying once more', writeFailure(error, ctx.secrets));
            await pause(LOG_RETRY_MS);
            await save();
          }
          rememberEntry(`${ctx.config.stateRoot}\0${key}`, { entry: built, format });
          if (foreign !== undefined) {
            ctx.log.warn('another build of the plugin writes the state file', { foreign });
            return { foreign };
          }
          return undefined;
        } catch (error) {
          ctx.log.warn('log entry not saved', writeFailure(error, ctx.secrets));
          // the fields the schema of the state refused, so the next look at the result finds them (DOKTOR-12)
          const fields = error instanceof ToolError ? error.params?.['fields'] : undefined;
          return {
            lost: error instanceof ToolError ? error.code : 'internal_error',
            ...(typeof fields === 'string' && fields !== ''
              ? { refused: ctx.secrets.scrub(fields).slice(0, MAX_REFUSED_FIELDS) }
              : {}),
          };
        }
      };
      let result: Awaited<ReturnType<Tool['invoke']>>;
      try {
        result = await tool.invoke(ctx, args);
      } catch (error) {
        // a question for the person ends this round only: the call comes again with the answer
        if (error instanceof QuestionForUser) throw error;
        if (ctx.signal.aborted) {
          await record({ kind: 'cancelled' }, undefined);
        } else {
          const shown = shownFailure(error, ctx);
          await record({ kind: 'error', ...shown }, undefined);
        }
        throw error;
      }
      const { outcome } = result;
      const lost = await record(
        endOf(outcome),
        outcome.update,
        outcome.status === 'done' && outcome.inert === true,
      );
      // the call succeeded; that its entry is missing from the log, or that another build writes the
      // same file, is said, never kept quiet
      const notes = [
        ...(lost?.lost === undefined
          ? []
          : [
              lost.refused === undefined
                ? ctx.t('log.entryNotSaved', { code: lost.lost })
                : ctx.t('log.entryNotSaved.refused', { code: lost.lost, fields: lost.refused }),
            ]),
        ...(lost?.foreign === undefined ? [] : [ctx.t('log.foreignWriter')]),
      ];
      return notes.length === 0 ? result : { ...result, text: [result.text, ...notes].join('\n') };
    },
  };
}

const DOCTOR = '/loadcraft:doctor';

/** A link as the model sees it: the dictionary key already resolved to the label. */
interface ShownLink {
  readonly url: string;
  readonly label: string;
}

/** `↗ https://…`; the label is printed only for a link that asks for it (`showLabel`). */
function linkLine(link: ShownLink, showLabel: boolean): string {
  return showLabel ? `↗ ${link.label}: ${link.url}` : `↗ ${link.url}`;
}

function success(
  scope: SecretScope,
  rawOutcome: ToolOutcome<unknown>,
  rawText: string,
  t: Translator,
): CallToolResult {
  // Second line of defence, after the data was scrubbed before the view: the whole text passes the
  // scope. Labels are translated first, so the scope sees exactly what is sent.
  const text = scope.scrub(rawText);
  const links: ShownLink[] = (rawOutcome.links ?? []).map((link) =>
    scope.scrubDeep({ url: link.url, label: t(link.labelKey) }),
  );
  const shown = (rawOutcome.links ?? []).map((link) => link.showLabel === true);
  const body = [text, ...links.map((link, i) => linkLine(link, shown[i] === true))].join('\n');
  // Text only: when a result carries `structuredContent`, Claude Code hands the model that JSON
  // instead of the text, and every identifier and next step lives in the text.
  return { content: [{ type: 'text', text: body }] };
}

function failure(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function configProblems(problems: readonly string[], t: Translator): CallToolResult {
  const lines = problems.map((problem) => `- ${problem}`);
  return failure(
    [
      `${codePrefix('plugin_not_configured')}${t('error.plugin_not_configured.message')}`,
      ...lines,
      `→ ${t('error.plugin_not_configured.hint')}`,
    ].join('\n'),
  );
}

/**
 * The first line of every tool error starts with its code, `[code] `: the model sees only the
 * text, and the skill looks the next step up by code. A code that came from a backend response
 * body is shown only when it has the shape of one; anything else is reported as `unknown`.
 */
const CODE_SHAPE = /^[a-z][a-z0-9_]{0,63}$/;

function codePrefix(code: string): string {
  return `[${CODE_SHAPE.test(code) ? code : 'unknown'}] `;
}

/**
 * The text of a 5xx or a 401 never reaches the model; the person who reads the log gets it here,
 * through the log of the call (which masks the secrets the call registered), cut short.
 */
/** Links of a cause chain followed to find the error that carries the text. */
const MAX_CAUSE_DEPTH = 5;

function logBackendText(log: Logger, error: ToolError): void {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (current instanceof LoadcraftApiError && current.logText !== undefined) {
      log.warn('backend error text', {
        status: current.status,
        code: current.code,
        text: current.logText,
      });
      return;
    }
    current = current.cause;
  }
}

function toolFailure(scope: SecretScope, raw: ToolError): CallToolResult {
  // `details` is not rendered, but a copy of the whole error is scrubbed so no later use can leak it.
  const error = scope.scrubDeep(raw);
  const head = `${codePrefix(error.code)}${error.message}`;
  // The message was cut to its quote limit after the error was scrubbed; the finished text passes the
  // scope again, which also knows the head of a value in front of a cut.
  return failure(scope.scrub(error.hint === undefined ? head : `${head}\n→ ${error.hint}`));
}

function scrubbedProgress(
  inner: ProgressReporter,
  scope: SecretScope,
  live: LiveProgress,
): ProgressReporter {
  return {
    report: (message, fraction) => {
      const shown = scope.scrub(message);
      inner.report(shown, fraction);
      live.report(shown, fraction);
    },
    attach: (handle) => {
      live.attach(handle);
    },
    stop: () => {
      inner.stop();
    },
  };
}

function internalFailure(toolName: string, event: string): CallToolResult {
  return failure(
    `${codePrefix('internal_error')}Unexpected internal error in ${toolName} (event ${event}). Details are in the server log.\n` +
      `→ Retry once; if it happens again, run ${DOCTOR} and report the event id.`,
  );
}

/**
 * In demonstration mode every result says so on its last line, and `process_get_status` on its first as
 * well: the data is sample data and must not be taken for the user's own.
 */
function withDemoNotice(result: CallToolResult, toolName: string, t: Translator): CallToolResult {
  const notice = t('demo.notice');
  const content = result.content.map((block, index, all) => {
    if (block.type !== 'text') return block;
    const isFirst = index === all.findIndex((other) => other.type === 'text');
    const isLast = index === all.findLastIndex((other) => other.type === 'text');
    const head = isFirst && toolName === 'process_get_status' ? `${notice}\n` : '';
    return { ...block, text: `${head}${block.text}${isLast ? `\n${notice}` : ''}` };
  });
  return { ...result, content };
}

/**
 * Whether the client of this call can ask the person (form elicitation): on the 2026-07-28 revision
 * every request carries the client's capabilities in its envelope; an older connection declared
 * them once, at the start. The same view the SDK checks an input request against.
 */
function clientCanAsk(server: McpServer, mcpCtx: ServerContext): boolean {
  const envelope = mcpCtx.mcpReq.envelope as Readonly<Record<string, unknown>> | undefined;
  return declaresForm(
    envelope === undefined
      ? server.server.getClientCapabilities()
      : envelope[CLIENT_CAPABILITIES_META_KEY],
  );
}

async function handle(
  tool: Tool,
  args: unknown,
  mcpCtx: ServerContext,
  deps: RegistryDeps,
  canAsk: boolean,
): Promise<CallToolResult | InputRequiredResult> {
  const result = await handleCall(tool, args, mcpCtx, deps, canAsk);
  if (isInputRequiredResult(result)) return result;
  return deps.config.demo
    ? withDemoNotice(result, tool.name, createTranslator(deps.config.locale))
    : result;
}

async function handleCall(
  tool: Tool,
  args: unknown,
  mcpCtx: ServerContext,
  deps: RegistryDeps,
  canAsk: boolean,
): Promise<CallToolResult | InputRequiredResult> {
  const { config } = deps;
  if (config.problems.length > 0)
    return configProblems(config.problems, createTranslator(config.locale));

  const signal = mcpCtx.mcpReq.signal;
  // A scope: secrets of this call (account passwords) are dropped with it, the process keeps the token only.
  const log = deps.log.scope({ tool: tool.name });
  const scope = new CallSecretScope(log);
  scope.add(config.token.reveal());
  const clock = deps.clock ?? systemClock;
  // Creating the cache touches no file; the state file is read only when a tool uses it.
  const state = createStateCache(config.stateRoot, {
    logger: log,
    secrets: scope,
    clock,
    tool: tool.name,
    appUrl: config.appUrl,
  });
  const live = createLiveProgress(state, clock, tool.name);
  const ctx: ToolContext = {
    config,
    log,
    signal,
    t: createTranslator(config.locale),
    progress: scrubbedProgress(createProgress(mcpCtx.mcpReq, clock), scope, live),
    secrets: scope,
    services: deps.services,
    clock,
    state,
    inputResponses: mcpCtx.mcpReq.inputResponses,
    canAsk,
  };
  let ended: Parameters<LiveProgress['end']>[0] = 'failed';
  try {
    const { outcome, text } = await tool.invoke(ctx, args);
    ended = outcome.status;
    return success(scope, outcome, text, ctx.t);
  } catch (error) {
    // A cancelled request gets no response from the SDK; let the rejection travel there.
    if (signal.aborted) throw error;
    // The client asks the person and calls again with the answer.
    if (error instanceof QuestionForUser) {
      ended = 'done';
      return questionResult(error);
    }
    if (error instanceof ToolError) {
      log.info('tool error', { code: error.code });
      logBackendText(log, error);
      // Scrubbed before it is translated: the translation quotes the backend's text cut to a limit.
      return toolFailure(
        scope,
        toToolError(scope.scrubDeep(error), ctx.t, { withhold: scope.incomplete }),
      );
    }
    const event = randomUUID().slice(0, 8);
    log.error('tool failed', { event, tool: tool.name, ...failureOf(error) });
    return internalFailure(tool.name, event);
  } finally {
    ctx.progress.stop();
    await live.end(ended);
  }
}

/** Stack frames kept in the entry of an internal error: where it failed, not what it held. */
const FAILURE_FRAMES = 12;

/** The message of an internal error in the log is cut to this. */
const FAILURE_MESSAGE_LIMIT = 300;

/**
 * What the server log keeps of an internal error (DOKTOR-03 S1a): the event the model is told, the
 * kind of the exception, its message cut (the logger masks every value the call registered as a
 * secret), and where it was thrown, so the entry says what broke. Nothing else the exception carries
 * (its fields, a cause holding an answer) is written.
 */
export function failureOf(error: unknown): Record<string, string | string[]> {
  if (!(error instanceof Error)) return { error: typeof error };
  const frames = (error.stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .slice(0, FAILURE_FRAMES);
  const message = error.message.slice(0, FAILURE_MESSAGE_LIMIT);
  return { error: error.name, message, frames };
}

export function registerTools(server: McpServer, tools: readonly Tool[], deps: RegistryDeps): void {
  const sorted = [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const { journal } = deps;
  for (const tool of sorted.map((one) => (journal === undefined ? one : withLog(one, journal)))) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: tool.annotations,
        ...(tool.meta === undefined ? {} : { _meta: tool.meta }),
      },
      (args, mcpCtx) => handle(tool, args, mcpCtx, deps, clientCanAsk(server, mcpCtx)),
    );
  }
}
