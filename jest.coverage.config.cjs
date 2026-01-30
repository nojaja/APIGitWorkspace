module.exports = {
  displayName: 'coverage',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Include tests intended for coverage; also include tests under coverage/ folder
  testMatch: [
    '<rootDir>/test/unit/**/?(*.)+(coverage|coverage_boost|coverage.fix|uncovered|deep_coverage|branch_coverage|targetedBranches)*.[tj]s?(x)',
    '<rootDir>/test/unit/**/coverage/**/?(*.)+(test).[tj]s?(x)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.json' }]
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
