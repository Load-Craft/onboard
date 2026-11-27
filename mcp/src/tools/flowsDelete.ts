// `flows_delete`: deletes flows of a project for good (kind "flow"; the other kinds of the catalog
// are refused as not supported yet), by id or by exact name. A name of several flows gets a choice
// with each flow's id, version and time instead of a card. The deletion needs the repeat with the
// card's token and the person's yes to the question the client asks in that call (an MCP
// elicitation, `tools/delete/card.ts`), which the model can neither answer nor make up.

import * as z from 'zod';

import { defineTool } from '../registry.js';
import { renderDelete } from '../render/views/deletion.js';
import { deleteFlows, FLOWS_DELETE_KINDS } from './delete/flows.js';

const id = z.string().trim().min(1).max(64);
const name = z.string().trim().min(1).max(200);

const input = z.strictObject({
  kind: z
    .enum(FLOWS_DELETE_KINDS)
    .describe('What to delete; this server deletes "flow" only so far.'),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
  flow_ids: z.array(id).max(100).optional().describe('UUIDs of the flows.'),
  names: z
    .array(name)
    .max(100)
    .optional()
    .describe(
      'Exact names of the flows; a name of several flows gets a list of them with ids to pick ' +
        'from, no card.',
    ),
  confirm: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .describe(
      'Leave it out in the first call: the answer is the consent card. Then repeat the call with ' +
        'the same arguments and the token of the card: Claude Code asks the user in a dialog of ' +
        'its own, and only their yes there deletes.',
    ),
});

export const flowsDelete = defineTool({
  name: 'flows_delete',
  title: 'Delete flows of a LoadCraft project for good',
  description:
    'Delete flows for good, with every version; cannot be undone. Only when the user asks for it, ' +
    'never on your own (for flows saved twice by a build, list the duplicates and let the user ' +
    'pick). The first call deletes nothing: it returns a card with each flow (id, version, time) ' +
    'and the scenarios and compositions that stay pointing at them. The repeat with confirm set to ' +
    'the token of that card makes Claude Code ask the user in a dialog of its own, and only the ' +
    'yes there deletes; a yes in the chat does not, and where no dialog can be shown the call is ' +
    'refused and the user deletes in the app. Refused while a ' +
    'test or another long operation runs on them.',
  input,
  // Claude Code asks the user before every call, also under an allow rule, in bypass, acceptEdits
  // and auto mode, and refuses it where nobody can answer: a second guard beside the question the
  // server asks itself (`consent/ask.ts`).
  meta: { 'anthropic/requiresUserInteraction': true },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  async run(ctx, args) {
    return deleteFlows(ctx, args);
  },
  render: renderDelete,
});
