module.exports = {
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  verbose: true,
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns: ['<rootDir>/src/git/gitlabAdapter.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json'
      }
    ]
  },
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
      useESM: false
    }
  },
  // coverage threshold to enforce 80% global minimum
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.(ts|js)$': '$1'
  }
  ,
  // Ensure IndexedDB shim is available before modules load, and also run
  // setup after the test environment is ready so per-test hooks can restore it.
  setupFiles: ['<rootDir>/test/setupIndexedDB.js'],
  setupFilesAfterEnv: ['<rootDir>/test/setupIndexedDB.js', '<rootDir>/test/setupOpfs.mjs']
}
