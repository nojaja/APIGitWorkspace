import VirtualFS from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'

describe('promoteResolvedConflicts', () => {
  it('promotes resolved conflicts to base and writes blobs', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    // prepare index entry with matching baseSha and remoteSha
    const path = 'file.txt'
    const shaValue = 'sha1'
    const entry = { path, state: 'conflict', baseSha: shaValue, remoteSha: shaValue, updatedAt: Date.now() }
    // write entry to backend info segment
    await storage.writeBlob(path, JSON.stringify(entry), 'info')

    const conflicts = [{ path }]
    const snapshot: Record<string, string> = { [path]: 'content' }
    const remoteHead = 'remotehead'

    await (vfs as any)._promoteResolvedConflicts(conflicts, snapshot, remoteHead)

    const ie = (await vfs.getIndex()).entries[path]
    expect(ie.state).toBe('base')
    expect(ie.baseSha).toBe(shaValue)
    expect((await vfs.getIndex()).head).toBe(remoteHead)
    // backend should have .git-base blob
    expect(await storage.readBlob(path,'base')).toBe('content')
  })
})
