import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'dist/',
      'scripts/',
      'src/http/generated/',
      'src/catalog.generated.ts',
      'catalog/',
      'src/workspace/processState.ts',
      'src/ws/generated/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      // `no-restricted-imports` with `importNames` also reports `import * as z`, so the named
      // import is matched by syntax.
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value='zod'] > ImportSpecifier[imported.name='z']",
          message:
            "Use `import * as z from 'zod'`: the named `z` export pulls the whole library into dist.",
        },
      ],
    },
  },
);
