const globals = require('globals');
const jsdocPlugin = require('eslint-plugin-jsdoc');
const sonarjs = require('eslint-plugin-sonarjs');
const unicorn = require('eslint-plugin-unicorn');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const preferEarly = require('@regru/eslint-plugin-prefer-early-return');

module.exports = [
  {
    files: ['src/**/*.{ts,js}'],
    // Preserve legacy language globals
    languageOptions: {
      globals: Object.assign({}, globals.builtin, globals.browser, globals.worker),
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        project: './tsconfig.json'
      }
    },
    plugins: {
      jsdoc: jsdocPlugin,
      sonarjs,
      unicorn,
      '@typescript-eslint': tsPlugin,
      '@regru/prefer-early-return': preferEarly
    },
    rules: {
      'sonarjs/cognitive-complexity': ['error', 10],
      'no-undef': 'error',
      complexity: ['warn', 12],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'jsdoc/require-jsdoc': [
        'error',
        {
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true
          }
        }
      ],
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'error',
      '@regru/prefer-early-return/prefer-early-return': ['error', { maximumStatements: 1 }],
      'sonarjs/no-duplicated-branches': 'error',
      'unicorn/filename-case': ['error', { case: 'camelCase' }],
      'unicorn/prevent-abbreviations': 'error'
    }
  }
];
