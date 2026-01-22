import VirtualFS from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'

describe('promoteResolvedConflicts', () => {
  it('promotes resolved conflicts to base and writes blobs', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    // prepare index entry with matching baseSha and remoteSha
    const path = 'file.txt'
    const sha = 'sha1'
    vfs.getIndex().entries[path] = { path, state: 'conflict', baseSha: sha, remoteSha: sha, updatedAt: Date.now() } as any

    const conflicts = [{ path }]
    const snapshot: Record<string, string> = { [path]: 'content' }
    const remoteHead = 'remotehead'

    await (vfs as any)._promoteResolvedConflicts(conflicts, snapshot, remoteHead)

    const ie = vfs.getIndex().entries[path]
    expect(ie.state).toBe('base')
    expect(ie.baseSha).toBe(sha)
    expect(vfs.getIndex().head).toBe(remoteHead)
    // backend should have .git-base blob
    // @ts-ignore access internal storage map
    expect((storage as any).blobs.get(`.git-base/${path}`)).toBe('content')
  })
})
