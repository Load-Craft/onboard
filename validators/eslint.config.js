// Lint of the skill validators and of the skill tests: run `npm run lint` from mcp/, which calls ESLint
// with this file from the repository root. The packages come from mcp/node_modules (no package of its own).
import { createRequire } from 'node:module';

const fromMcp = createRequire(new URL('../mcp/package.json', import.meta.url));
const js = fromMcp('@eslint/js');
const tseslint = fromMcp('typescript-eslint');

// The rules kept everywhere: no `any`, no silencing the compiler or the linter, no console.
const KEPT = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/ban-ts-comment': [
    'error',
    { 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true, 'ts-check': false },
  ],
  'no-console': 'error',
  'no-warning-comments': ['error', { terms: ['eslint-disable', 'noqa'], location: 'anywhere' }],
};

export default tseslint.config({
  files: ['validators/src/**/*.ts', 'tests/*.ts'],
  extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    ...KEPT,
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
  },
});
