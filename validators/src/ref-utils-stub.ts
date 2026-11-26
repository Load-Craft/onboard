// Stand-in for `ref-utils` of @redocly/openapi-core, which the OpenAPI 3.0 type tree imports for one
// function. The full module pulls in the whole library (file system, network); the build swaps it
// for this copy of `isMappingRef` (see validators/scripts/build.mjs).

export function isMappingRef(mapping: string): boolean {
  return (
    mapping.startsWith('#') ||
    mapping.startsWith('https://') ||
    mapping.startsWith('http://') ||
    mapping.startsWith('./') ||
    mapping.startsWith('../') ||
    mapping.includes('/')
  );
}
