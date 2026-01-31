module.exports = {
  displayName: 'spec',
  testEnvironment: 'node',
  // Treat TypeScript files as ESM so `import` in test files works under --experimental-vm-modules
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Map .js imports in ESM test sources to .ts so Node-style ".js" imports work in TS sources
  moduleNameMapper: {
    // Only remap relative .js imports that point into our `test` or `src` tree
    '^(\\.{1,2}\/(?:test|src)\/.*)\\.js$': '$1.ts'
  },
  testMatch: [
    '<rootDir>/test/unit/behavior/**/*.behavior.test.ts?(x)',
    '<rootDir>/test/unit/design/**/*.design.test.ts?(x)'
  ],
  //setupFiles: ['<rootDir>/test/setup/indexeddbShim.js'],
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
  collectCoverage: false
};
