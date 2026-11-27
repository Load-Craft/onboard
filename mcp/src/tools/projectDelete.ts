// `project_delete`: deletes LoadCraft projects for good (kind "project"; the other kinds of the
// catalog are refused as not supported yet). The first call is the consent card with each project
// and what goes with it; the deletion needs the repeat with the card's token and the person's yes
// to the question the client asks in that call (an MCP elicitation, `tools/delete/card.ts`),
// which the model can neither answer nor make up. Deleting the project this repository is bound to
// also unbinds the repository.

import * as z from 'zod';

import { defineTool } from '../registry.js';
import { renderDelete } from '../render/views/deletion.js';
import { deleteProjects, PROJECT_DELETE_KINDS } from './delete/projects.js';

const id = z.string().trim().min(1).max(64);
const name = z.string().trim().min(1).max(200);

const input = z.strictObject({
  kind: z
    .enum(PROJECT_DELETE_KINDS)
    .describe('What to delete; this server deletes "project" only so far.'),
  ids: z.array(id).max(100).optional().describe('UUIDs of the projects.'),
  names: z
    .array(name)
    .max(100)
    .optional()
    .describe('Exact names of the projects; a name of several projects gets a choice, no card.'),
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

export const projectDelete = defineTool({
  name: 'project_delete',
  title: 'Delete LoadCraft projects for good',
  description:
    'Delete projects for good, with their flows, scenarios, compositions, docs, environments, ' +
    'datasets and runs; cannot be undone. Only when the user asks for it, never on your own. The ' +
    'first call deletes nothing: it returns a card with each project and what goes with it. The ' +
    'repeat with confirm set to the token of that card makes Claude Code ask the user in a dialog ' +
    'of its own, and only the yes there deletes; a yes in the chat does not, and where no dialog ' +
    'can be shown the call is refused and the user deletes in the app. Refused while a test or another long operation runs on the project. Deleting the ' +
    'bound project unbinds this repository.',
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
    return deleteProjects(ctx, args);
  },
  render: renderDelete,
});
