import { jest } from '@jest/globals'
import { VirtualFS } from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'
import { shaOf } from '../../../src/virtualfs/hashUtils'

describe('VirtualFS normalize and process helpers', () => {
  let vfs: VirtualFS
  let backend: any

  beforeEach(async () => {
    backend = new InMemoryStorage()
    vfs = new VirtualFS({ backend })
    await vfs.init()
  })

  it('_normalizeRemoteInput returns descriptor with fetchContent and shas', async () => {
    const snapshot = { 'a.txt': 'A' }
    const desc = await (vfs as any)._normalizeRemoteInput('HEAD', snapshot)
    expect(desc.headSha).toBe('HEAD')
    expect(typeof desc.fetchContent).toBe('function')
    const fetched = await desc.fetchContent(['a.txt', 'b.txt'])
    expect(fetched['a.txt']).toBe('A')
    expect(desc.shas['a.txt']).toBe(await shaOf('A'))
  })

  it('_computeRemoteShas computes shas for snapshot', async () => {
    const snapshot = { 'x.txt': 'xyz', 'y.txt': 'yy' }
    const shas = await (vfs as any)._computeRemoteShas(snapshot)
    expect(shas['x.txt']).toBe(await shaOf('xyz'))
    expect(shas['y.txt']).toBe(await shaOf('yy'))
  })

  it('_processRemoteAddsAndUpdates applies base when content present', async () => {
    const baseSnapshot = { 'add.txt': 'content-add' }
    const remoteShas = await (vfs as any)._computeRemoteShas(baseSnapshot)
    const conflicts: any[] = []
    await (vfs as any)._processRemoteAddsAndUpdates(remoteShas, baseSnapshot, 'rhead', conflicts)
    // base blob should exist and info should indicate base state
    expect(await backend.readBlob('add.txt', 'base')).toBe('content-add')
    const info = await backend.readBlob('add.txt', 'info')
    expect(info).not.toBeNull()
    const ie = JSON.parse(info as string)
    expect(ie.state).toBe('base')
    expect(conflicts.length).toBe(0)
  })

  it('_processRemoteDeletions handles deletion when safe', async () => {
    // create an info entry representing base present and no workspace blob
    await backend.writeBlob('del.txt', JSON.stringify({ path: 'del.txt', state: 'base', baseSha: 'sha1' }), 'info')
    const conflicts: any[] = []
    await (vfs as any)._processRemoteDeletions({}, conflicts)
    expect(await backend.readBlob('del.txt')).toBeNull()
    expect(await backend.readBlob('del.txt', 'info')).toBeNull()
  })
})
