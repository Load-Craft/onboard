/**
 * Generated file - do not edit.
 * Source: the modules of catalog/katalog.json. Regenerate with "npm run gen:tools" (from mcp/).
 */

import type { ModuleName } from '../../../catalog.generated.js';
import type { Entry } from '../core.js';
import { processEn } from '../process.en.js';
import { processPl } from '../process.pl.js';
import { projectEn } from '../project.en.js';
import { projectPl } from '../project.pl.js';
import { flowsEn } from '../flows.en.js';
import { flowsPl } from '../flows.pl.js';
import { scenarioEn } from '../scenario.en.js';
import { scenarioPl } from '../scenario.pl.js';
import { dataEn } from '../data.en.js';
import { dataPl } from '../data.pl.js';
import { runEn } from '../run.en.js';
import { runPl } from '../run.pl.js';
import { resultsEn } from '../results.en.js';
import { resultsPl } from '../results.pl.js';
import { trafficEn } from '../traffic.en.js';
import { trafficPl } from '../traffic.pl.js';
import { functionalEn } from '../functional.en.js';
import { functionalPl } from '../functional.pl.js';
import { githubEn } from '../github.en.js';
import { githubPl } from '../github.pl.js';

type Dictionary = Readonly<Record<string, Entry>>;

/** The texts of each module, in both languages. */
export const MODULE_DICTIONARIES: Readonly<
  Record<ModuleName, { readonly en: Dictionary; readonly pl: Dictionary }>
> = {
  process: { en: processEn, pl: processPl },
  project: { en: projectEn, pl: projectPl },
  flows: { en: flowsEn, pl: flowsPl },
  scenario: { en: scenarioEn, pl: scenarioPl },
  data: { en: dataEn, pl: dataPl },
  run: { en: runEn, pl: runPl },
  results: { en: resultsEn, pl: resultsPl },
  traffic: { en: trafficEn, pl: trafficPl },
  functional: { en: functionalEn, pl: functionalPl },
  github: { en: githubEn, pl: githubPl },
};

/** The texts of every module, in one dictionary per language. */
export const MODULE_TEXTS: { readonly en: Dictionary; readonly pl: Dictionary } = {
  en: Object.fromEntries(
    Object.values(MODULE_DICTIONARIES).flatMap((part) => Object.entries(part.en)),
  ),
  pl: Object.fromEntries(
    Object.values(MODULE_DICTIONARIES).flatMap((part) => Object.entries(part.pl)),
  ),
};
