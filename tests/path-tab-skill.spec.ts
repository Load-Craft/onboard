// The Path tab of the LoadCraft panel and the skill: a pick made in the tab is the user's answer.
//
// Each rule ties a condition to an action in one sentence (regex over one sentence, no full stop
// inside), and every rule is checked by mutation: the sentence removed, and its sense reversed, must
// make the check fail. The message wording the skill matches is the one the mod sends
// (mod/src/pane/choice.ts), so the same phrases are checked there too.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PACK_ROOT } from './helpers.ts';

const SKILL = join(PACK_ROOT, 'skills', 'loadcraft-test');
const CHOICE = join(PACK_ROOT, 'mod', 'src', 'pane', 'choice.ts');

// One sentence: no full stop followed by a space or the end of the line inside it.
const S = '[^\\n]*?';

type Rule = [name: string, pattern: string, reversal: [before: string, after: string]];

const RULES: Record<string, Rule[]> = {
  // file -> [(name, pattern, reversal of the sense)]
  'SKILL.md': [
    [
      'method from the tab is used without asking',
      `message of the plugin says \`The user chose the flow method\`${S}use that method and do not ask the panel again`,
      ['do not ask the panel again', 'ask the panel again'],
    ],
    [
      'the tab is mentioned once',
      'when you do ask, tell the user once that the tab exists',
      ['tell the user once', 'never tell the user'],
    ],
    [
      'a pick is never consent',
      'A pick in the tab is a choice, never consent to a write or a cost',
      ['never consent', 'consent'],
    ],
  ],
  'references/panels.md': [
    [
      'a pick answers the panel',
      "When such a message is in the conversation, treat it as the user's answer to that panel and do not ask the panel again",
      ['do not ask the panel again', 'ask the panel again'],
    ],
    [
      'an unusable pick is asked again with the reason',
      `ask it only when the pick cannot be used${S}and say why`,
      ['ask it only when', 'ask it always, also when'],
    ],
    [
      'a pick is not consent',
      'it is never consent to a write or a cost, which stays the user\'s \\"yes\\" to the question the server asks',
      ['it is never consent', 'it is consent'],
    ],
  ],
  'references/step-03-flows-docs.md': [
    [
      'the method from the tab skips the panel',
      'a message of the plugin says the user chose the method in the Path tab \\(then use it without asking',
      ['then use it without asking', 'then ask anyway'],
    ],
    [
      'the whole list is shown in the conversation first',
      'Show the whole list first, in the conversation, every time: a table of every proposal',
      ['Show the whole list first', 'Show only the first four'],
    ],
    [
      'the list is never cut to what a panel holds',
      'Never cut the list to what a panel can hold',
      ['Never cut', 'Cut'],
    ],
    [
      'the agent waits and does not choose alone',
      'and wait\\. Never choose journeys yourself without a choice from the user',
      ['Never choose', 'Choose'],
    ],
    [
      'a choice in the tab comes first',
      'A choice made in the tab comes first',
      ['comes first', 'comes last'],
    ],
    [
      'the panel is only the fallback',
      'Ask with the panel `path-selection` from \\[panels.md\\]\\(panels.md\\), a multi-select, only as the fallback',
      ['only as the fallback', 'always'],
    ],
    [
      'names are checked against the proposals',
      '(?<!not )check that each name is one `flows_suggest_journeys` returned exactly',
      ['check that each name', 'do not check that each name'],
    ],
    [
      'a name outside the proposals is not built',
      'A name that is not among the proposals is not built: say so and ask about it',
      ['is not built', 'is built'],
    ],
    [
      'how to use the tab: filter, preview and marks',
      'Enter on a name shows all its steps and "Back to the list" returns with the filter and marks kept',
      ['returns with the filter and marks kept', 'clears the filter and marks'],
    ],
    [
      'without the panel the table and path-selection stay the way to choose',
      'When there is no LoadCraft panel[^.]*the table and the panel `path-selection` below are the way to choose',
      ['the way to choose', 'never used'],
    ],
    [
      'the tab is mentioned when the proposals are offered',
      '(?<!never )say that the user can mark the journeys in the Path tab of the LoadCraft panel',
      ['say that the user can', 'never say that the user can'],
    ],
  ],
};

function text(name: string): string {
  return readFileSync(join(SKILL, name), 'utf8');
}

describe('PathTabSkillTestCase', () => {
  it('test_every_rule_holds_and_fails_without_its_sentence_or_with_its_sense_reversed', () => {
    for (const [name, rules] of Object.entries(RULES)) {
      const source = text(name);
      for (const [rule, patternSource, [before, after]] of rules) {
        const context = `${name}: ${rule}`;
        const pattern = new RegExp(patternSource);
        const match = pattern.exec(source);
        expect(match, `${context}: rule missing`).not.toBeNull();
        if (match === null) continue;
        // Removed.
        const removed = source.slice(0, match.index) + source.slice(match.index + match[0].length);
        expect(pattern.test(removed), `${context}: removal does not fail the check`).toBe(false);
        // Reversed: the one phrase that carries the sense is swapped.
        const sentence = match[0];
        expect(sentence, `${context}: the reversal does not apply`).toContain(before);
        const reversed =
          source.slice(0, match.index) +
          sentence.replace(before, () => after) +
          source.slice(match.index + sentence.length);
        expect(pattern.test(reversed), `${context}: reversal does not fail the check`).toBe(false);
      }
    }
  });

  it('test_the_panel_catalog_is_unchanged_by_the_tab', () => {
    // The tab adds no panel: flow-method and path-selection stay the two questions it answers.
    const ids = [...text('references/panels.md').matchAll(/^## (\S+)$/gm)].map((m) => m[1] ?? '');
    expect(ids).toContain('flow-method');
    expect(ids).toContain('path-selection');
    expect(ids.filter((id) => id.includes('tab'))).toEqual([]);
  });

  it('test_the_messages_the_mod_sends_use_the_words_the_skill_matches', () => {
    const source = readFileSync(CHOICE, 'utf8');
    expect(source).toContain('The user chose the flow method');
    expect(source).toContain('The user chose these journeys to build in the LoadCraft Path tab');
    expect(source).toContain('in the LoadCraft Path tab');
    const panels = text('references/panels.md');
    expect(panels).toContain('`The user chose the flow method "<id>" in the LoadCraft Path tab`');
    expect(panels).toContain('`The user chose these journeys to build in the LoadCraft Path tab`');
    for (const method of ['docs', 'describe', 'har', 'manual']) {
      expect(panels).toContain(`\`${method}\``);
    }
  });
});
