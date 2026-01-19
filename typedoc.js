export default {
  entryPoints: ['src'],
  out: 'docs/typedoc-md',
  plugin: ['typedoc-plugin-markdown'],
  hideGenerator: true,
  gitRevision: 'main',
  exclude: ['**/__tests__/**', '**/*.test.ts'],
  tsconfig: 'tsconfig.json',
  markdown: {
    hideBreadcrumbs: true
  }
};
