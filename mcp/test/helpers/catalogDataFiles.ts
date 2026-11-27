// Files under src/ that hold catalog DATA, not plugin logic. The source guards scan every .ts
// file under src/ for string patterns (error codes, dataset routes). These files carry such
// strings as data, so the guards skip them here and nowhere else:
//
// - workspace/processState.ts: a copy, byte for byte, of the state schema from the catalog
//   repository. It uses zod's custom issue code, which is not a plugin error code. The error
//   codes of the schema itself are its list SCHEMA_ERROR_CODES, which the error guard
//   (http.errors.test.ts) reads instead of scanning the file. Do not edit it here; a change
//   belongs in the catalog repository and is copied again.
// - catalog.generated.ts and tools/<module>/meta.generated.ts: generated from the catalog
//   (`npm run gen:catalog`, `npm run gen:tools`). Their operation paths are data, not calls made by
//   the plugin. Do not edit them by hand; regenerate them.
//
// Paths are relative to src/ and use the platform separator (see `join`).
import { join, sep } from 'node:path';

export const CATALOG_DATA_FILES: readonly string[] = [
  join('workspace', 'processState.ts'),
  join('catalog.generated.ts'),
];

/** `tools/<module>/meta.generated.ts`. */
const MODULE_META = /^tools\/[a-z]+\/meta\.generated\.ts$/u;

/** True when `relPath` (relative to src/) is a catalog data file that the guards must skip. */
export function isCatalogDataFile(relPath: string): boolean {
  return CATALOG_DATA_FILES.includes(relPath) || MODULE_META.test(relPath.split(sep).join('/'));
}
