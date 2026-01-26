import { VirtualFS } from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'

describe('RemoteSynchronizer pull via VirtualFS', () => {
  let backend: any
  let vfs: any

  beforeEach(async () => {
    backend = new (InMemoryStorage as any)('rs-pull')
    vfs = new VirtualFS({ backend })
    await vfs.init()
  })

  it('pull with string+baseSnapshot applies base and sets head when no conflicts', async () => {
    const snapshot = { 'p.txt': 'content' }
    const res: any = await vfs.pull('remote-head-1', snapshot)
    expect(res.conflicts).toBeDefined()
    expect(res.conflicts).toHaveLength(0)
    // index head should be updated
    expect(vfs.head).toBe('remote-head-1')
    // base blob should be written
    expect(await backend.readBlob('p.txt', 'base')).toBe('content')
  })

  it('pull with descriptor that returns no content produces conflicts and does not set head', async () => {
    const p = 'missing.txt'
    const remoteDesc = {
      headSha: 'remote-head-2',
      shas: { [p]: 'deadbeef' },
      fetchContent: async (_: string[]) => { return {} }
    }
    const originalHead = vfs.head
    const res: any = await vfs.pull(remoteDesc)
    expect(res.conflicts).toBeDefined()
    expect(res.conflicts.length).toBeGreaterThan(0)
    // head should not be set to remote head because conflicts exist
    expect(vfs.head).toBe(originalHead)
  })
})
