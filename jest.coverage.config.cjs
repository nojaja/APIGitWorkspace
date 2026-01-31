module.exports = {
  displayName: 'coverage',
  testEnvironment: 'node',
  // Treat TypeScript files as ESM so `import` in test files works under --experimental-vm-modules
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Include tests intended for coverage; also include tests under coverage/ folder
  testMatch: [
    '<rootDir>/test/unit/**/*.(coverage|coverage_boost|coverage.fix|uncovered|deep_coverage|branch_coverage|targetedBranches).test.ts?(x)',
    '<rootDir>/test/unit/**/coverage/**/*.test.ts?(x)'
  ],
  setupFiles: [
    'fake-indexeddb/auto',
    '<rootDir>/test/setupIndexedDB.cjs',
    '<rootDir>/test/setupOpfs.ts'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.json', useESM: true }]
  },
  verbose: true,
  collectCoverage: true,
  coverageDirectory: '<rootDir>/coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
