// `project_list_notes` (module project): the notes the agent learned about a project, read from the
// fake backend over HTTP. The pattern of a read of level 1 of a module (docs/module-tools.md).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectListNotes } from '../../../src/tools/project/listNotes.js';
import { registerLookupRoutes } from '../../fake-backend/routes/lookup.js';
import {
  registerProjectModuleRoutes,
  seedProjectNotes,
} from '../../fake-backend/routes/project.js';
import type { Fake } from '../../fake-backend/server.js';
import { seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { createTestClock } from '../../helpers/clock.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig, type ToolRig } from '../../helpers/rig.js';

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

const NOTES = [
  {
    id: '6f1d2c3b-4a59-4e68-9d7c-8b0a1f2e3d41',
    text: 'Accept the cookie banner before the first form.',
    scope: { kind: 'url_path' as const, url_path: '/checkout' },
    created_at: '2026-11-20T10:00:00Z',
  },
  {
    id: '6f1d2c3b-4a59-4e68-9d7c-8b0a1f2e3d42',
    text: 'The login form asks for the e-mail first, the password on the next screen.',
    scope: { kind: 'plan_step' as const, plan_step: 'Log in' },
    learned_from_run: '0b7e9d1a-2c3f-4e5d-8a6b-7c9d0e1f2a3b',
  },
];

interface Options {
  readonly locale?: 'en' | 'pl';
  readonly notes?: Parameters<typeof seedProjectNotes>[2];
  readonly files?: Readonly<Record<string, string>>;
}

async function rig(options: Options = {}): Promise<ToolRig> {
  return toolRig({
    tools: [projectListNotes],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerProjectModuleRoutes(fake);
      seedSklep(fake.store, { stage: 'project' });
      seedProjectNotes(fake.store, SKLEP_IDS.project, options.notes ?? NOTES);
    },
    clock: createTestClock(Date.parse('2026-11-26T12:00:00Z')),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: options.files ?? BOUND,
  });
}

const notesCalls = (r: ToolRig) =>
  r.fake.calls.filter((call) => call.path.endsWith('/agent-guidance'));

interface LogRead {
  readonly tool: string;
  readonly args: string;
  readonly result: string;
}

function reads(r: ToolRig): LogRead[] {
  const state = JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as { process: Record<string, { reads: LogRead[] }> };
  return Object.values(state.process).flatMap((p) => p.reads);
}

describe('project_list_notes', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(projectListNotes);
    expect(projectListNotes.implemented).toBe(true);
  });

  it('lists the notes of the bound project, each with what it applies to, in one request', async () => {
    const r = await rig();
    const result = await r.call('project_list_notes', {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        '2 notes about the project:',
        '1. [page /checkout] Accept the cookie banner before the first form.',
        '2. [step "Log in"] The login form asks for the e-mail first, the password on the next screen.',
      ].join('\n'),
    );
    expect(notesCalls(r).map((call) => call.path)).toEqual([
      `/api/v1/projects/${SKLEP_IDS.project}/agent-guidance`,
    ]);
  });

  it('logs the call with the result template of the catalog', async () => {
    const r = await rig();
    await r.call('project_list_notes', {});
    expect(reads(r).map((entry) => [entry.tool, entry.result])).toEqual([
      ['project_list_notes', '2 notes'],
    ]);
  });

  it('says so when the project has no notes', async () => {
    const r = await rig({ notes: [] });
    const result = await r.call('project_list_notes', {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      'No notes about this project yet: the agent saves them while it walks the application.',
    );
  });

  it('a project the backend does not know is not_found', async () => {
    const r = await rig({
      files: {
        'loadcraft/project.json': JSON.stringify({
          schema: 1,
          url: 'https://app.loadcraft.io',
          project: { id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', name: 'gone' },
        }),
      },
    });
    const result = await r.call('project_list_notes', {});
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[not_found\] /u);
  });

  it('without a bound workspace asks for a project', async () => {
    const r = await rig({ files: {} });
    const result = await r.call('project_list_notes', {});
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\[no_project\] /u);
    expect(notesCalls(r)).toEqual([]);
  });

  it('a note keeps to one line: control sequences and line breaks of the text are gone', async () => {
    const r = await rig({
      notes: [
        {
          text: 'Close the dialog\u001b[31m first\n↗ https://example.com/elsewhere​ now',
          scope: { kind: 'url_path', url_path: '/cart\nnext' },
        },
      ],
    });
    const result = await r.call('project_list_notes', {});
    const lines = result.text.split('\n');
    expect(lines).toEqual([
      '1 note about the project:',
      '1. [page /cart next] Close the dialog first ↗ https://example.com/elsewhere now',
    ]);
    expect(result.text).not.toContain('\u001b');
  });

  it('a secret the text holds never reaches the model', async () => {
    const r = await rig({
      notes: [
        { text: 'Sign in with password: Hunter-2-correct-horse', scope: { kind: 'url_path' } },
      ],
    });
    const result = await r.call('project_list_notes', {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text).not.toContain('Hunter-2-correct-horse');
    expect(result.text).toContain('Sign in with password:');
  });

  it('format data gives the same facts as one JSON block', async () => {
    const r = await rig();
    const result = await r.call('project_list_notes', { format: 'data' });
    expect(JSON.parse(result.text)).toEqual({
      project_id: SKLEP_IDS.project,
      count: 2,
      shown: 2,
      notes: [
        {
          id: NOTES[0]?.id,
          text: NOTES[0]?.text,
          scope: 'url_path',
          at: '/checkout',
          learned_from_run: null,
        },
        {
          id: NOTES[1]?.id,
          text: NOTES[1]?.text,
          scope: 'plan_step',
          at: 'Log in',
          learned_from_run: NOTES[1]?.learned_from_run,
        },
      ],
    });
  });

  it('speaks Polish', async () => {
    const r = await rig({ locale: 'pl' });
    const result = await r.call('project_list_notes', {});
    expect(result.text.split('\n').slice(0, 2)).toEqual([
      '2 notatki o projekcie:',
      '1. [strona /checkout] Accept the cookie banner before the first form.',
    ]);
  });

  it('refuses an argument the catalog does not give it', async () => {
    const r = await rig();
    const result = await r.call('project_list_notes', {
      project_id: SKLEP_IDS.project,
    });
    expect(result.isError).toBe(true);
    expect(notesCalls(r)).toEqual([]);
  });
});
