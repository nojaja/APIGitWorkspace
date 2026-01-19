export default {
  forbidden: [
    {
      name: 'no-cross-layer-imports',
      comment: 'レイヤー間の不正な依存を禁止します',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: 'src/(?:adapter|virtualfs)'
      },
      to: {
        path: 'src/(adapter|virtualfs)/',
        pathNot: 'src/(adapter|virtualfs)/'
      }
    }
  ],
  options: {
    doNotFollow: {
      path: 'node_modules'
    }
  }
};
