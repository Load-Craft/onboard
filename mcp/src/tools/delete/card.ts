// The consent card of a deletion (level 3, cannot be undone). The first call makes the card: it
// freezes the items (name, id, and for a flow its version and time) and the numbers of what goes
// with them, and prints a one-use token. The deletion runs only on a repeat with that token, with
// the items the card froze, and only after the person said yes to the question the client asks in
// that very call (`consent/ask.ts`): an MCP elicitation, answered outside the arguments the model
// writes, so no call of the model, whatever its arguments, deletes anything by itself. Without a
// client that asks (no elicitation, a run without a person) every deletion is refused and the user
// deletes in the app.

import * as z from 'zod';

import { discardCard, issueCard, redeemCard, sameFrozen } from '../../consent/confirmCard.js';
import type { ToolContext } from '../../context.js';
import type {
  CardRenewal,
  DeleteChoiceData,
  DeleteData,
  DeleteFacts,
  DeleteItem,
  DeleteKind,
  DeleteTool,
} from '../../render/views/deletion.js';
import { content } from '../moduleCall.js';

/** The card scope of each tool, and the key its one card lives under. */
export const DELETE_SCOPES: Readonly<Record<DeleteTool, string>> = {
  project_delete: 'project:delete',
  flows_delete: 'flows:delete',
};

/** Projects are not of one project: their card has a key of its own. */
export const PROJECTS_KEY = 'projects';

/** What a call asks to delete, in one order: the repeat with the token must ask the same. */
export interface DeleteCall {
  readonly kind: DeleteKind;
  readonly ids: readonly string[];
  readonly names: readonly string[];
}

export function deleteCall(
  kind: DeleteKind,
  ids: readonly string[] | undefined,
  names: readonly string[] | undefined,
): DeleteCall {
  const sorted = (list: readonly string[] | undefined): string[] =>
    [...new Set((list ?? []).map((item) => item.trim()).filter((item) => item !== ''))].sort();
  return { kind, ids: sorted(ids), names: sorted(names) };
}

const count = z.object({ n: z.number(), more: z.boolean() }).nullable();
const item = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().optional(),
  at: z.string().optional(),
  counts: z
    .object({
      flows: count,
      scenarios: count,
      compositions: count,
      docs: count,
      environments: count,
      datasets: count,
      runs: count,
    })
    .optional(),
});
const factsSchema = z.object({
  tool: z.enum(['project_delete', 'flows_delete']),
  kind: z.enum(['project', 'flow']),
  scope: z.string(),
  project: z.object({ id: z.string(), name: z.string() }).optional(),
  items: z.array(item),
  stays: z.object({ scenarios: count, compositions: count }).optional(),
  bound: z.string().optional(),
  testsUnknown: z.boolean().optional(),
});
const frozenSchema = z.object({
  call: z.object({
    kind: z.enum(['project', 'flow']),
    ids: z.array(z.string()),
    names: z.array(z.string()),
  }),
  facts: factsSchema,
});

export type FrozenCard = z.infer<typeof frozenSchema>;

/** Drops the keys whose value is `undefined`, as the frozen copy in the state file has them. */
function stored<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Saves the card of `facts` for `call` (replacing the earlier card of the scope); its token. */
export function issueDeleteCard(
  ctx: ToolContext,
  key: string,
  call: DeleteCall,
  facts: DeleteFacts,
): Promise<string> {
  return issueCard(ctx, facts.scope, key, stored({ call, facts }));
}

export type CardState =
  | { readonly kind: 'renew'; readonly renewed: CardRenewal }
  | { readonly kind: 'card'; readonly card: FrozenCard };

/** What the repeat with `token` finds: the card it was made for, or why a new card is needed. */
export function cardFor(
  ctx: ToolContext,
  scope: string,
  key: string,
  token: string,
  call: DeleteCall,
): CardState {
  const redeemed = redeemCard(ctx, scope, key, token.trim());
  if (!redeemed.ok) return { kind: 'renew', renewed: redeemed.reason };
  const frozen = frozenSchema.safeParse(redeemed.frozen);
  if (!frozen.success) return { kind: 'renew', renewed: 'missing' };
  if (!sameFrozen(frozen.data.call, call)) return { kind: 'renew', renewed: 'changed' };
  return { kind: 'card', card: frozen.data };
}

/** The card is used: it is gone before anything is deleted, so its token never deletes twice. */
export function useCard(
  ctx: ToolContext,
  scope: string,
  key: string,
  token: string,
): Promise<void> {
  return discardCard(ctx, scope, key, token.trim());
}

/** The key of the card of a tool: projects have one card, flows one per project. */
export function cardKey(tool: DeleteTool, projectId: string): string {
  return tool === 'project_delete' ? PROJECTS_KEY : projectId;
}

/** `"a", "b"` of the items, for the log and the result. */
export function namesOf(items: readonly Pick<DeleteItem, 'name'>[]): string {
  return items.map((one) => one.name).join(', ');
}

/**
 * A name from the backend (a project, a flow, the label of an operation) as the card and its
 * messages show it: masked by shape, its secrets registered, one line (FIX-76). Deterministic, so a
 * card frozen on the first call matches the one the confirming call computes.
 */
export function shownName(ctx: Pick<ToolContext, 'secrets'>, name: string): string {
  return content(ctx, name, 80);
}

/** The choice between items of the same name, their names shown masked. */
export function shownChoice(ctx: Pick<ToolContext, 'secrets'>, data: DeleteData): DeleteData {
  if (!('ambiguous' in data)) return data;
  const choice: DeleteChoiceData = data;
  return {
    ...choice,
    ambiguous: choice.ambiguous.map((entry) => ({
      name: shownName(ctx, entry.name),
      matches: entry.matches.map((item) => ({ ...item, name: shownName(ctx, item.name) })),
    })),
  };
}
