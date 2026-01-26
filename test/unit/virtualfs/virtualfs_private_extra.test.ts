import { jest } from '@jest/globals'
import { VirtualFS } from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS private remote handlers', () => {
  let vfs: any
  let backend: InMemoryStorage

  beforeEach(async () => {
    backend = new InMemoryStorage()
    vfs = new VirtualFS({ backend })
    await vfs.init()
  })

  it('_handleRemoteExistingUpdate marks conflict when base snapshot missing', async () => {
    const indexEntry: any = { path: 'a.txt', baseSha: 'oldsha', state: 'base' }
    const conflicts: any[] = []
    // baseSnapshot has no entry for a.txt -> content undefined branch
    await (vfs as any)._handleRemoteExistingUpdate('a.txt', indexEntry, 'newsha', {}, conflicts, 'headsha')
    expect(conflicts.length).toBe(1)
    expect(conflicts[0].path).toBe('a.txt')
    const info = await backend.readBlob('a.txt', 'info')
    expect(info).toBeDefined()
    const parsed = JSON.parse(info as string)
    expect(parsed.state).toBe('conflict')
    expect(parsed.remoteSha).toBe('headsha')
  })

  it('_handleRemoteExistingUpdate updates base when content present', async () => {
    const indexEntry: any = { path: 'b.txt', baseSha: 'oldsha', state: 'base' }
    const conflicts: any[] = []
    const baseSnapshot: Record<string, string> = { 'b.txt': 'content-b' }
    await (vfs as any)._handleRemoteExistingUpdate('b.txt', indexEntry, 'newsha2', baseSnapshot, conflicts, 'head2')
    expect(conflicts.length).toBe(0)
    const base = await backend.readBlob('b.txt', 'base')
    expect(base).toBe('content-b')
    const info = JSON.parse((await backend.readBlob('b.txt', 'info')) as string)
    expect(info.state).toBe('base')
  })

  it('_handleRemoteDeletion deletes when safe', async () => {
    // prepare index entry and blobs: base exists and workspace absent
    const idx: any = { path: 'c.txt', baseSha: 'basesha' }
    // write info and base blob
    await backend.writeBlob('c.txt', JSON.stringify(idx), 'info')
    await backend.writeBlob('c.txt', 'base-content', 'base')
    const conflicts: any[] = []
    await (vfs as any)._handleRemoteDeletion('c.txt', idx, { }, conflicts)
    const infoAfter = await backend.readBlob('c.txt', 'info')
    const baseAfter = await backend.readBlob('c.txt', 'base')
    expect(infoAfter).toBeNull()
    expect(baseAfter).toBeNull()
  })
})
