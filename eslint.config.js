// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // test/real-world/ is test data kept as received, including its own scripts.
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'test/real-world/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node },
  },
  {
    // The core library must run in the browser: no Node built-ins outside the CLI.
    files: ['src/**/*.ts'],
    ignores: ['src/cli.ts', 'src/cli/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^node:',
              message: 'The core must stay browser-safe. Node APIs belong in src/cli.ts only.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'The core must stay browser-safe.' },
        ...[
          'Buffer',
          '__dirname',
          '__filename',
          'require',
          'module',
          'exports',
          'global',
          'setImmediate',
          'clearImmediate',
        ].map((name) => ({ name, message: 'The core must stay browser-safe.' })),
      ],
    },
  },
  prettier,
);
