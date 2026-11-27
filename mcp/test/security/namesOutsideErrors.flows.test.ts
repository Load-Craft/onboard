// FIX-76 (group flows): the names the generator and the recording give (proposed journeys, the
// steps of a proposal, the paths of a recording) are a third party's text wherever a tool shows
// them. A credential in such a name never reaches the model in the text, nor in `format: "data"`,
// nor the files of the workspace; a masked name still picks its proposal.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { flowsGenerateFromSuggestions } from '../../src/tools/flowsGenerateFromSuggestions.js';
import { flowsImportHar } from '../../src/tools/flowsImportHar.js';
import { flowsSuggestJourneys } from '../../src/tools/flowsSuggestJourneys.js';
import { registerHarRoutes, type HarRouteOptions } from '../fake-backend/routes/har.js';
import { registerLookupRoutes } from '../fake-backend/routes/lookup.js';
import { registerSuggestionRoutes, SKLEP_SUGGESTIONS } from '../fake-backend/routes/suggestions.js';
import type { Fake } from '../fake-backend/server.js';
import { seedSklep } from '../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../golden/index.js';
import { leakedPieces, SHAPE_CANARY } from '../helpers/canary.js';
import { createTestClock } from '../helpers/clock.js';
import { toolRig, type ToolRig } from '../helpers/rig.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmbG93cyJ9.c2VudGluZWwtZmxvd3Mtc2ln';
const SIGNATURE = 'c2VudGluZWwtZmxvd3Mtc2ln';
// every piece of a secret counts: a view that cuts or a mask that hides a part leaves one (FIX-79)
const leaks = (text: string): string[] => leakedPieces(text, [JWT, SIGNATURE, SHAPE_CANARY]);

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

const stateText = (r: ToolRig): string => {
  try {
    return readFileSync(join(r.workspace, 'loadcraft/.cache/state.json'), 'utf8');
  } catch {
    return '';
  }
};

async function suggestionRig(): Promise<ToolRig> {
  const [first, ...rest] = SKLEP_SUGGESTIONS.refined;
  if (first === undefined) throw new Error('no refined proposal');
  return toolRig({
    tools: [flowsSuggestJourneys, flowsGenerateFromSuggestions],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerSuggestionRoutes(fake, {
        ...SKLEP_SUGGESTIONS,
        cached: true,
        refined: [{ ...first, name: `zakupy ${JWT}` }, ...rest],
      });
      seedSklep(fake.store, { stage: 'project' });
    },
    clock: createTestClock(Date.parse('2026-11-22T09:00:00Z')),
    env: { LOADCRAFT_LOCALE: 'en' },
    files: BOUND,
  });
}

describe('a credential in a name of the generator, outside the errors (flows)', () => {
  it('flows_suggest_journeys shows the proposals masked, in the text and the data', async () => {
    const r = await suggestionRig();
    const text = (await r.call('flows_suggest_journeys', {})).text;
    const data = (await r.call('flows_suggest_journeys', { format: 'data' })).text;
    expect(text).toContain('zakupy');
    expect(leaks(text)).toEqual([]);
    expect(leaks(data)).toEqual([]);
    expect(leaks(stateText(r))).toEqual([]);
  });

  it('flows_generate_from_suggestions lists the known proposals masked when a name is unknown', async () => {
    const r = await suggestionRig();
    await r.call('flows_suggest_journeys', {});
    const result = await r.call('flows_generate_from_suggestions', { suggestions: ['nie-ma'] });
    expect(result.text).toMatch(/^\[unknown_suggestions\] /u);
    expect(result.text).toContain('zakupy');
    expect(leaks(result.text)).toEqual([]);
  });

  it('a proposal is still picked by the masked name the view showed', async () => {
    const r = await suggestionRig();
    const data = (await r.call('flows_suggest_journeys', {})).outcome?.data as {
      suggestions: { name: string }[];
    };
    const shown = data.suggestions[0]?.name ?? '';
    expect(shown).toContain('[redacted]');
    const result = await r.call('flows_generate_from_suggestions', { suggestions: [shown] });
    expect(result.text).not.toMatch(/^\[unknown_suggestions\] /u);
  });

  it('flows_import_har shows the paths of the recording masked', async () => {
    const har: HarRouteOptions = {
      fixed: {
        upload: {
          duration_ms: 0,
          total_entries: 3,
          filtered_entries: 0,
          excluded_count: 0,
          base_url: 'https://perf.example.com',
          detected_auth_pattern: 'bearer_token',
          warnings: [],
          domain_stats: [],
        },
        analysis: {
          action_groups: [
            {
              name: `checkout api_key=${SHAPE_CANARY}`,
              entry_indices: [0],
              start_index: 0,
              end_index: 0,
              entries_summary: [{ method: 'GET', path: '/cart', status: 200 }],
            },
            {
              name: `zakupy ${JWT}`,
              entry_indices: [1],
              start_index: 1,
              end_index: 1,
              entries_summary: [],
            },
          ],
          correlations: [],
          evidence_quality: 'full',
          evidence_coverage: { response_body_ratio: 0.9, stripped_response_body_ratio: 0 },
          warnings: [],
        },
      },
    };
    const r = await toolRig({
      tools: [flowsImportHar],
      world: (fake: Fake) => {
        registerLookupRoutes(fake);
        registerHarRoutes(fake, har);
        seedSklep(fake.store, { stage: 'project' });
      },
      clock: createTestClock(Date.parse('2026-11-22T09:00:00Z')),
      env: { LOADCRAFT_LOCALE: 'en' },
      files: { ...BOUND, 'captures/shop.har': JSON.stringify({ log: { entries: [] } }) },
    });
    const text = (await r.call('flows_import_har', { file: 'captures/shop.har' })).text;
    const data = (await r.call('flows_import_har', { file: 'captures/shop.har', format: 'data' }))
      .text;
    expect(text).toContain('checkout');
    expect(leaks(text)).toEqual([]);
    expect(leaks(data)).toEqual([]);
    expect(leaks(stateText(r))).toEqual([]);
  });
});
