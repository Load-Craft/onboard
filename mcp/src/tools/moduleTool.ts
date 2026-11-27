// A tool of a module (`tools/<module>/<object>.ts`): what the catalog says of it comes from the
// generated `tools/<module>/meta.generated.ts` (name, description, class, consent level, card and
// log templates, undo, operations, arguments), what the module writes by hand is the input, the
// reads and the view. `moduleTool` turns the two into a `Tool` of the registry:
//
// - the description and the MCP annotations are the catalog's; `readOnlyHint` only for a read of
//   level 1 that costs nothing and sends nothing to the target;
// - a tool only a person may approve carries `anthropic/requiresUserInteraction` (`requiresUserInteraction`);
// - the input is strict (an unknown argument is refused) and always takes `format`: the view, or the
//   data as one JSON block;
// - a tool without `run` and `render` is registered but not implemented: a call answers
//   `not_implemented`, and the server does not offer it to the client (`_generated/modules.ts`);
// - fail-closed: `run` alone is taken, by type and at run time, only for a tool of level 1 that never
//   asks (no level by argument, no escalation). A tool that asks is written on the consent card
//   (`card`, `cardView`, `run`, `render`; `kit/consent.ts`, docs/consent-card.md): its `run` is
//   reached only through the card and the person's yes. A tool that asks and has no card, or one the
//   card does not cover (a secret, traffic to the target, a level by argument), stays a scaffold.

import * as z from 'zod';

import type { ToolName } from '../catalog.generated.js';
import type { ModuleName } from '../catalog.generated.js';
import type { ToolContext, Translator } from '../context.js';
import { ToolError } from '../errors.js';
import type { OperationId } from '../http/generated/operations.js';
import type { ToolOutcome } from '../outcome.js';
import { formatInput, renderDataBlock } from '../render/dataBlock.js';
import { isConsentCard, renderConsentCard } from '../render/consentCard.js';
import { defineTool, type Tool, type ToolAnnotationHints } from '../registry.js';
import {
  asksConditionally,
  asksOnACard,
  runOnACard,
  type Card,
  type CardView,
  type ConsentCardData,
  type Proceed,
  type Unchanged,
  type Volatile,
} from './kit/consent.js';

/** An argument the catalog names for a tool: its name, its type and the state field it defaults to. */
export interface CatalogArgument {
  readonly name: string;
  readonly type: string;
  /** A path in the process state (`ids.run_id`); null when the argument has no default there. */
  readonly from_state: string | null;
  /** What the argument is, for its description in `tools/list`. */
  readonly doc?: string;
  /** Whether a call must give it; without the key: when the state gives no default. */
  readonly required?: boolean;
  /** Further facts of the catalog (default, enum, min, max, max_length, max_items). */
  readonly [key: string]: unknown;
}

/** A list view of a tool: one page of items of a state schema type, the full list behind a `ref`. */
export interface CatalogView {
  readonly item: string;
  readonly page: { readonly default: number; readonly max: number };
  readonly args: readonly string[];
  readonly ref: string | null;
  readonly [key: string]: unknown;
}

/** A card of consent: its title and fields (templates of the catalog, in English). */
export interface CatalogCardTemplate {
  readonly title: string;
  readonly fields: readonly { readonly label: string; readonly [key: string]: unknown }[];
  readonly [key: string]: unknown;
}

/**
 * The catalog entry of a tool as `meta.generated.ts` holds it. Keys the catalog adds later are kept
 * (the index signature), so a newer catalog regenerates without a change here.
 */
export interface ToolMeta {
  readonly name: ToolName;
  readonly module: ModuleName;
  readonly kind: 'atomic' | 'composite' | 'process';
  readonly class: string;
  readonly secret: boolean;
  readonly description: string;
  readonly consent: {
    readonly level: 1 | 2 | 3;
    readonly level3_reason: string | null;
    readonly target_traffic: string | null;
    readonly cost: string | null;
    readonly card: CatalogCardTemplate | null;
    readonly [key: string]: unknown;
  };
  readonly undo: {
    readonly reversible: string | null;
    readonly ways: readonly Readonly<Record<string, unknown>>[];
    readonly reason: string | null;
  };
  readonly log: { readonly args: string; readonly result: string };
  readonly operations: readonly {
    readonly operationId: OperationId;
    readonly method: string;
    readonly path: string;
  }[];
  readonly state_reads: readonly string[];
  readonly state_writes: readonly string[];
  /** The arguments the catalog fixes; null when it leaves them to the module. */
  readonly arguments: readonly CatalogArgument[] | null;
  readonly views: readonly CatalogView[] | null;
  /** Only a person may approve a call (an elicitation the model cannot answer); null: not stated. */
  readonly requires_user_interaction: boolean | null;
  readonly install_allow: boolean | null;
  readonly shows_content: Readonly<Record<string, unknown>> | null;
  readonly known_debt: string | null;
  /**
   * The MCP hints the catalog fixes for the tool, with the reason when they differ from its class;
   * null in a catalog that does not give them (the hints then follow the class and the level).
   */
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly override_reason: string | null;
  } | null;
  readonly [key: string]: unknown;
}

/** The base class of a catalog class: `read+secret` is a `read`. */
function effectOf(meta: ToolMeta): string {
  return meta.class.split('+')[0] ?? meta.class;
}

/**
 * The MCP annotations of a catalog entry. A client may run a `readOnlyHint` tool without asking, so
 * the hint is given only to a read of level 1 with no cost and no traffic to the target.
 */
export function annotationsOf(meta: ToolMeta): ToolAnnotationHints {
  const effect = effectOf(meta);
  const { consent } = meta;
  const openWorld =
    consent.target_traffic !== null || consent.level3_reason === 'external'
      ? { openWorldHint: true }
      : {};
  // the catalog's own hints, where it gives them (an exception says why in `override_reason`)
  if (meta.annotations !== null) {
    if (meta.annotations.readOnlyHint) return { readOnlyHint: true };
    return {
      readOnlyHint: false,
      destructiveHint: meta.annotations.destructiveHint,
      ...openWorld,
    };
  }
  const quietRead =
    effect === 'read' &&
    consent.level === 1 &&
    consent.cost === null &&
    consent.target_traffic === null &&
    consent.level3_reason === null;
  if (quietRead) return { readOnlyHint: true };
  return { readOnlyHint: false, destructiveHint: effect === 'destructive', ...openWorld };
}

/** The tool sends traffic to the target or has an effect outside LoadCraft (level 3 for that reason). */
function reachesOut(meta: ToolMeta): boolean {
  const { consent } = meta;
  return (
    consent.target_traffic !== null ||
    consent.level3_reason === 'traffic' ||
    consent.level3_reason === 'external'
  );
}

/**
 * Whether only a person may approve a call: when the catalog says so; and, whatever it says, for a
 * deletion and for a tool that sends traffic to the target or acts outside LoadCraft (today's tools
 * of that kind carry the marker; moving them to a module must not drop it). A catalog that does not
 * state it (`null`) says so also of a tool with a cost.
 */
export function requiresUserInteraction(meta: ToolMeta): boolean {
  if (meta.requires_user_interaction === true) return true;
  if (effectOf(meta) === 'destructive' || reachesOut(meta)) return true;
  return meta.requires_user_interaction === null && meta.consent.cost !== null;
}

/**
 * A tool that never asks: level 1, no other level by argument, no escalation to level 3. Only such a
 * tool may be written on this layer; any other needs the consent card this layer does not draw.
 */
export function asksNothing(meta: ToolMeta): boolean {
  const { consent } = meta;
  return (
    consent.level === 1 &&
    consent['by_argument'] === null &&
    Array.isArray(consent['escalate_to_3']) &&
    consent['escalate_to_3'].length === 0
  );
}

/** The type of a catalog entry of a tool that never asks (`asksNothing`). */
export type QuietMeta = ToolMeta & {
  readonly consent: {
    readonly level: 1;
    readonly by_argument: null;
    readonly escalate_to_3: readonly [];
  };
};

/**
 * The type of a catalog entry a tool on the consent card may have (`asksOnACard`): level 2 or 3,
 * fixed (not by argument), no secret, no traffic to the target, no reason but a deletion, a schedule or an external service.
 */
export type ConsentMeta = ToolMeta & {
  readonly secret: false;
  readonly install_allow: false | null;
  readonly consent: {
    readonly level: 2 | 3;
    readonly by_argument: null;
    readonly target_traffic: null;
    readonly level3_reason: null | 'delete' | 'schedule' | 'external';
  };
};

/**
 * The type of a catalog entry of a tool of level 1 that asks only when a call meets an escalation
 * (`asksConditionally`): another level by argument (3), no secret, no traffic to the target.
 */
export type ConditionalMeta = ToolMeta & {
  readonly secret: false;
  readonly install_allow: false | null;
  readonly consent: {
    readonly level: 1;
    readonly by_argument: { readonly level: 3 };
    readonly escalate_to_3: readonly [string, ...string[]];
    readonly target_traffic: null;
    readonly level3_reason: null;
  };
};

/** The `_meta` of a tool for `tools/list`; undefined when it has none. */
export function toolMetaOf(meta: ToolMeta): Record<string, unknown> | undefined {
  return requiresUserInteraction(meta) ? { 'anthropic/requiresUserInteraction': true } : undefined;
}

/**
 * An id argument of a tool (`<object>_id`, the catalog's type `uuid`): 36 hex digits and hyphens. The
 * schema stays short in `tools/list`; the backend answers an id it does not know with a 404.
 */
export function uuidArgument(): z.ZodString {
  return z.string().regex(/^[0-9a-fA-F-]{36}$/u);
}

type Shape = z.core.$ZodLooseShape;
type InputOf<S extends Shape> = z.ZodObject<
  z.core.util.Writeable<S & { format: typeof formatInput }>,
  z.core.$strict
>;

/** The arguments a tool's `run` and `render` receive: the module's own and `format`. */
export type ModuleArgs<S extends Shape> = z.infer<InputOf<S>>;

/** A tool registered before it is written: the title and the input only. */
export interface ScaffoldSpec<S extends Shape> {
  /** A short English title for `tools/list` (the catalog has none). */
  readonly title: string;
  /** The module's arguments (`format` is added): the shape of a strict object. */
  readonly input: S;
}

/** A scaffold has neither: a spec with `run` fits only a tool that never asks (`QuietMeta`). */
export interface ScaffoldOnly<S extends Shape> extends ScaffoldSpec<S> {
  readonly run?: never;
  readonly render?: never;
}

/** A tool that is written: the reads (`run`) and the view (`render`). */
export interface ModuleToolSpec<S extends Shape, D> extends ScaffoldSpec<S> {
  run(ctx: ToolContext, args: ModuleArgs<S>): Promise<ToolOutcome<D>>;
  /** The view of finished data; `format: "data"` prints the data instead, without calling it. */
  render(data: D, t: Translator, args: ModuleArgs<S>): string;
}

/**
 * A tool that asks, written on the consent card (docs/consent-card.md): `card` reads what the call
 * would do, `cardView` words it, `run` does it after the person's yes to exactly that card.
 */
export interface ConsentToolSpec<S extends Shape, C, D> extends ScaffoldSpec<S> {
  /** Reads only (a write is refused). Throws to refuse before any question. */
  card(ctx: ToolContext, args: ModuleArgs<S>): Promise<Card<C> | Unchanged<D>>;
  /** The card in words: what will happen, on what, the cost when the tool has one, the undo. */
  cardView(facts: C, t: Translator, volatile: Volatile): CardView;
  run(ctx: ToolContext, args: ModuleArgs<S>, facts: C): Promise<ToolOutcome<D>>;
  render(data: D, t: Translator, args: ModuleArgs<S>): string;
}

/**
 * A tool of level 1 that asks only for the calls that meet an escalation of its entry: `card` reads
 * the backend and answers `{ proceed: true }` when the call does not meet it (the tool then runs at
 * once, `run` gets `null` facts and checks again what it must), else the card of the escalation. That
 * answer may come from the facts it read, never from an argument the model left out.
 */
export interface ConditionalToolSpec<S extends Shape, C, D> extends ScaffoldSpec<S> {
  card(ctx: ToolContext, args: ModuleArgs<S>): Promise<Card<C> | Unchanged<D> | Proceed>;
  cardView(facts: C, t: Translator, volatile: Volatile): CardView;
  run(ctx: ToolContext, args: ModuleArgs<S>, facts: C | null): Promise<ToolOutcome<D>>;
  render(data: D, t: Translator, args: ModuleArgs<S>): string;
}

/** A tool of a module, with its catalog entry and whether the module wrote it. */
export interface ModuleTool extends Tool {
  readonly module: ModuleName;
  readonly catalog: ToolMeta;
  /** False for a scaffold: registered, answering `not_implemented`, not offered to the client. */
  readonly implemented: boolean;
  /** True for a tool written on the consent card: its `run` is reached only after the person's yes. */
  readonly onCard: boolean;
}

/** `format: "data"`: the caller reads the data, not the view (a generic `args` cannot name the key). */
function asksForData(args: unknown): boolean {
  return typeof args === 'object' && args !== null && 'format' in args && args.format === 'data';
}

function notImplemented(): Promise<never> {
  return Promise.reject(new ToolError('not_implemented'));
}

/** A tool that never asks, written: `run` and `render`. */
export function moduleTool<S extends Shape, D>(
  meta: QuietMeta,
  spec: ModuleToolSpec<S, D>,
): ModuleTool;
/** A tool that asks, written on the consent card: `card`, `cardView`, `run` and `render`. */
export function moduleTool<S extends Shape, C, D>(
  meta: ConsentMeta,
  spec: ConsentToolSpec<S, C, D>,
): ModuleTool;
/** A tool of level 1 that asks only for the calls that meet its escalation: see `ConditionalToolSpec`. */
export function moduleTool<S extends Shape, C, D>(
  meta: ConditionalMeta,
  spec: ConditionalToolSpec<S, C, D>,
): ModuleTool;
/** Any tool as a scaffold: registered, answering `not_implemented`, not offered. */
export function moduleTool<S extends Shape>(meta: ToolMeta, spec: ScaffoldOnly<S>): ModuleTool;
export function moduleTool<S extends Shape, C, D>(
  meta: ToolMeta,
  spec:
    | ScaffoldSpec<S>
    | ModuleToolSpec<S, D>
    | ConsentToolSpec<S, C, D>
    | ConditionalToolSpec<S, C, D>,
): ModuleTool {
  const input: InputOf<S> = z.strictObject({ ...spec.input, format: formatInput });
  // The types keep `run` from a tool that asks and `card` from a tool the card does not cover; a
  // cast round them still leaves the tool a scaffold. A tool that asks runs only through its card.
  const carded =
    'run' in spec && 'card' in spec && (asksOnACard(meta) || asksConditionally(meta))
      ? spec
      : undefined;
  const quiet = 'run' in spec && !('card' in spec) && asksNothing(meta) ? spec : undefined;
  const extra = toolMetaOf(meta);
  const tool = defineTool({
    name: meta.name,
    title: spec.title,
    description: meta.description,
    input,
    annotations: annotationsOf(meta),
    ...(extra === undefined ? {} : { meta: extra }),
    run: (ctx, args: ModuleArgs<S>): Promise<ToolOutcome<D | ConsentCardData<C>>> =>
      carded !== undefined
        ? runOnACard(meta, carded, ctx, args)
        : quiet !== undefined
          ? quiet.run(ctx, args)
          : notImplemented(),
    render: (data: D | ConsentCardData<C>, t, args: ModuleArgs<S>) => {
      const written = carded ?? quiet;
      if (asksForData(args) || written === undefined) return renderDataBlock(data);
      if (carded !== undefined && isConsentCard(data)) {
        return renderConsentCard(data, carded.cardView(data.card, t, data.volatile ?? {}), t);
      }
      return written.render(data as D, t, args);
    },
  });
  return {
    ...tool,
    module: meta.module,
    catalog: meta,
    implemented: carded !== undefined || quiet !== undefined,
    onCard: carded !== undefined,
  };
}

/** The tools the server offers to the client: the written ones; a scaffold stays registered only. */
export function exposedTools(tools: readonly ModuleTool[]): readonly ModuleTool[] {
  return tools.filter((tool) => tool.implemented);
}
