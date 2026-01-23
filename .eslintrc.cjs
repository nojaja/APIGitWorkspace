module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  settings: {
    jsdoc: {
      mode: 'typescript'
    }
  },
  overrides: [
    {
      files: ['src/git/githubAdapter.ts', 'src/git/*.clean.ts', '**/*.clean.ts'],
      rules: {
        'jsdoc/require-jsdoc': 'off',
        'jsdoc/require-param': 'off',
        'jsdoc/require-returns': 'off'
      }
    }
  ],
  extends: [
    'eslint:recommended',
    'plugin:sonarjs/recommended'
  ],
  plugins: ['sonarjs', 'jsdoc'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json'
  },
  plugins: ['sonarjs', 'jsdoc', '@typescript-eslint', 'unicorn'],
  ignorePatterns: ['dist/', 'node_modules/'],
  rules: {
    'sonarjs/cognitive-complexity': ['error', 10],
    // 未定義のグローバル参照を検出して、Jestグローバルのimport忘れ等を見つける
    'no-undef': 'error',
    // Cyclomatic complexity も併せて警告する（補助的な検出）
    'complexity': ['warn', 12],
    'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
    '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
    // JSDoc ルールを有効化（プロジェクト方針に従う）
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
    // 指定環境での eslint-plugin-jsdoc の AST 問題対応のため一時的に param チェックを無効化
    'jsdoc/require-param': 'off',
    'jsdoc/require-returns': 'error'
    // Unicorn: 早期リターン・重複分岐検出・ファイル名規約・略語抑制
    , 'unicorn/prefer-early-return': 'warn'
    , 'unicorn/no-duplicated-branches': 'warn'
    , 'unicorn/filename-case': ['warn', { case: 'camelCase' }]
    , 'unicorn/prevent-abbreviations': 'warn'
  }
}
