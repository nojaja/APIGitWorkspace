import { VirtualFS, IndexedDbStorage, OpfsStorage, GitHubAdapter, GitLabAdapter, default as defaultExport } from '../../src/index'

describe('entry exports', () => {
  it('should export main symbols', () => {
    expect(VirtualFS).toBeDefined()
    expect(IndexedDbStorage).toBeDefined()
    expect(OpfsStorage).toBeDefined()
    expect(GitHubAdapter).toBeDefined()
    expect(GitLabAdapter).toBeDefined()
    expect(defaultExport).toBeDefined()
  })
})
