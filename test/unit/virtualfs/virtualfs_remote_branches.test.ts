import { jest } from '@jest/globals'
import { VirtualFS } from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'
import { shaOf } from '../../../src/virtualfs/hashUtils'

describe('VirtualFS remote branches (private handlers)', () => {
  let vfs: VirtualFS
  let backend: any

  beforeEach(async () => {
    backend = new InMemoryStorage()
    vfs = new VirtualFS({ backend })
    await vfs.init()
  })

  it('_handleRemoteNewAdd without snapshot content marks conflict and writes info', async () => {
    const conflicts: any[] = []
    const remoteHead = 'rhead'
    // snapshot lacks 'x.txt'
    const baseSnapshot: Record<string,string> = {}
    await (vfs as any)._handleRemoteNewAdd('x.txt', 'rs1', baseSnapshot, remoteHead, conflicts, undefined, undefined)
    expect(conflicts.find(c => c.path === 'x.txt')).toBeTruthy()
    const info = await backend.readBlob('x.txt', 'info')
    expect(info).not.toBeNull()
    const ie = JSON.parse(info as string)
    expect(ie.state).toBe('conflict')
    expect(ie.remoteSha).toBe(remoteHead)
  })

  it('_handleRemoteExistingUpdate with missing content sets entry to conflict', async () => {
    // prepare existing index entry for y.txt with baseSha
    const entry = { path: 'y.txt', state: 'base', baseSha: 'oldsha', updatedAt: Date.now() }
    await backend.writeBlob('y.txt', JSON.stringify(entry), 'info')
    const conflicts: any[] = []
    const baseSnapshot: Record<string,string> = {}
    // remoteSha differs
    await (vfs as any)._handleRemoteExistingUpdate('y.txt', entry, 'newsha', baseSnapshot, conflicts, 'rhead')
    const info = await backend.readBlob('y.txt', 'info')
    const ie = JSON.parse(info as string)
    expect(ie.state).toBe('conflict')
    expect(ie.remoteSha).toBe('rhead')
    expect(conflicts.length).toBeGreaterThan(0)
  })
})
