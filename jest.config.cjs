module.exports = {
  testEnvironment: 'node',
  // Treat TypeScript files as ESM so dynamic import() resolves ESM-only packages
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.(ts|js)$': '$1'
  },
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  // Ensure IndexedDB shim is available before modules load: load fake-indexeddb first,
  // then the wrapper that patches open() behavior. Also run per-test setup after env.
  setupFiles: [
    'fake-indexeddb/auto',
    '<rootDir>/test/setupIndexedDB.cjs',
    '<rootDir>/test/setupOpfs.ts'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.json', useESM: true }]
  },
  // ts-jest options are provided inline in `transform` (globals deprecated)
  verbose: true,
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/src/git/gitlabAdapter.ts'],
  // coverage threshold to enforce 80% global minimum
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
}
