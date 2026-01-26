import { jest } from '@jest/globals'
import { VirtualFS } from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'
import { shaOf } from '../../../src/virtualfs/hashUtils'

describe('VirtualFS private helpers coverage', () => {
  let vfs: VirtualFS
  let backend: any

  beforeEach(async () => {
    backend = new InMemoryStorage()
    vfs = new VirtualFS({ backend })
    await vfs.init()
  })

  it('_isNonFastForwardError recognizes FF errors', () => {
    expect((vfs as any)._isNonFastForwardError(new Error('422: conflict'))).toBe(true)
    expect((vfs as any)._isNonFastForwardError('not a fast forward')).toBe(true)
    expect((vfs as any)._isNonFastForwardError('some other error')).toBe(false)
  })

  it('_computeToAddOrUpdate, _applyAddsOrUpdates work and persist base blobs', async () => {
    const snapshot: Record<string,string> = { 'a.txt': 'A', 'b.txt': 'B' }
    const newShas: Record<string,string> = {}
    for (const [p, c] of Object.entries(snapshot)) newShas[p] = await shaOf(c)

    // prepare info for a.txt so it should be skipped
    await backend.writeBlob('a.txt', JSON.stringify({ path: 'a.txt', state: 'base', baseSha: newShas['a.txt'], updatedAt: Date.now() }), 'info')

    const toAdd = await (vfs as any)._computeToAddOrUpdate(snapshot, newShas)
    expect(toAdd.sort()).toEqual(['b.txt'])

    await (vfs as any)._applyAddsOrUpdates(toAdd, snapshot, newShas)
    // base blob should be written
    expect(await backend.readBlob('b.txt', 'base')).toBe('B')
    const infoB = await backend.readBlob('b.txt', 'info')
    expect(infoB).not.toBeNull()
  })

  it('_computeToRemove and _applyRemovals remove info and blobs', async () => {
    // create an info entry for c.txt not present in snapshot
    await backend.writeBlob('c.txt', JSON.stringify({ path: 'c.txt', state: 'base', baseSha: 'sha1' }), 'info')
    const snapshot: Record<string,string> = { 'a.txt': 'A' }
    const toRemove = await (vfs as any)._computeToRemove(snapshot)
    expect(toRemove).toContain('c.txt')

    await (vfs as any)._applyRemovals(toRemove)
    expect(await backend.readBlob('c.txt')).toBeNull()
    expect(await backend.readBlob('c.txt', 'info')).toBeNull()
  })
})
