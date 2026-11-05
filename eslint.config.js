import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * Purity rule for src/core: it must not read wall-clock time or draw randomness.
 * Both are passed in as arguments (see tech.md "Architecture rules").
 */
const corePuritySyntax = [
  {
    selector:
      "MemberExpression[object.name='Date'][property.name='now']",
    message:
      'src/core is pure: do not call Date.now(). Pass the current time in as an argument.',
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message:
      'src/core is pure: do not construct Date(). Pass the current time in as an argument.',
  },
  {
    selector:
      "MemberExpression[object.name='Math'][property.name='random']",
    message:
      'src/core is pure: do not call Math.random(). Pass a random() function in as an argument.',
  },
  {
    selector: "MemberExpression[object.name='performance'][property.name='now']",
    message:
      'src/core is pure: do not call performance.now(). Pass the time in as an argument.',
  },
];

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'node_modules'] },

  // Base: all TypeScript/TSX source.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // React component layer.
  {
    files: ['src/**/*.tsx', 'src/app/**/*.ts'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },

  // src/core must stay pure: no React, no DOM time/randomness sources.
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/core must not import React.' },
            { name: 'react-dom', message: 'src/core must not import react-dom.' },
          ],
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: 'src/core must not import React.',
            },
            {
              group: ['../playback/*', '../render/*', '../audio/*', '../persistence/*', '../components/*', '../app/*'],
              message:
                'src/core may only import its own files and content types (see structure.md).',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...corePuritySyntax],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/core is pure: no DOM access.' },
        { name: 'document', message: 'src/core is pure: no DOM access.' },
      ],
    },
  },

  // Node-side tooling and config.
  {
    files: ['scripts/**/*.ts', '*.config.ts', '*.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Tests may use broader globals and console.
  {
    files: ['src/**/*.test.{ts,tsx}', 'tests/**/*.ts', 'src/test/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-globals': 'off',
    },
  },
);
