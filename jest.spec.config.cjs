module.exports = {
  displayName: 'spec',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: [
    '<rootDir>/test/unit/behavior/**/*.behavior.test.[tj]s?(x)',
    '<rootDir>/test/unit/design/**/*.design.test.[tj]s?(x)'
  ],
  setupFiles: ['<rootDir>/test/setup/indexeddbShim.js'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.json' }]
  },
  verbose: true,
  collectCoverage: false
};
