// ESLint flat config: Node (server, scripts, configs) + browser/React (src) + Vitest (tests).
// Formatting is Prettier's job; eslint-config-prettier turns off conflicting style rules.
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'contract-luminary/target/'] },
  js.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  // Server, scripts and tooling configs run on Node.
  {
    files: ['server/**/*.js', '*.config.js', 'scripts/**/*.js'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  // Frontend (React 18 + Vite).
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      'react/prop-types': 'off', // props documented with JSDoc instead
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Tests (Vitest globals are imported explicitly, but tests may use Node APIs too).
  {
    files: ['**/*.test.{js,jsx}', 'test/**/*.{js,jsx}', 'server/test/**/*.js', 'src/test/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
];
