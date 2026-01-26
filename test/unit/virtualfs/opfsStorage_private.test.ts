import OpfsStorage from '../../../src/virtualfs/opfsStorage'

describe('OpfsStorage private helpers', () => {
  let opfs: any
  beforeEach(() => {
    opfs = new (OpfsStorage as any)('testroot')
  })

  it('getVariants returns expected order', () => {
    const v = opfs.getVariants()
    expect(Array.isArray(v)).toBe(true)
    expect(v[0]).toBe('workspace')
  })

  it('build workspace/base/conflict entries preserve fields', () => {
    const existing = { baseSha: 'b', remoteSha: 'r', workspaceSha: 'w' }
    const now = Date.now()
    const we = opfs._buildWorkspaceEntry(existing, 'p', 'sha1', now)
    expect(we.path).toBe('p')
    expect(we.workspaceSha).toBe('sha1')
    const be = opfs._buildBaseEntry(existing, 'p', 'sha2', now)
    expect(be.baseSha).toBe('sha2')
    const ce = opfs._buildConflictEntry(existing, 'p', now)
    expect(ce.state).toBe('conflict')
  })

  it('shaOf computes hex digest', async () => {
    const s = await opfs.shaOf('abc')
    expect(typeof s).toBe('string')
    expect(s.length).toBeGreaterThan(0)
  })
})
