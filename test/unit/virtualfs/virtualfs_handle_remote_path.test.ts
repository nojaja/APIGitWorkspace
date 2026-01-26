import { VirtualFS } from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'
import { shaOf } from '../../../src/virtualfs/hashUtils'

describe('VirtualFS _handleRemotePath branches', () => {
  let backend: any
  let vfs: any

  beforeEach(async () => {
    backend = new (InMemoryStorage as any)('handle-remote')
    vfs = new VirtualFS({ backend })
    await vfs.init()
  })

  it('handles new remote add when no local workspace and snapshot has content', async () => {
    const p = 'nr.txt'
    const baseSnapshot: Record<string,string> = { [p]: 'remote-content' }
    const perFileRemoteSha = await shaOf(baseSnapshot[p])
    const conflicts: any[] = []
    // indexEntry undefined and no workspace -> should add to base
    await (vfs as any)._handleRemotePath(p, perFileRemoteSha, baseSnapshot, conflicts, 'remoteHead')
    expect(await backend.readBlob(p, 'base')).toBe('remote-content')
    const info = JSON.parse(await backend.readBlob(p, 'info'))
    expect(info.baseSha).toBe(perFileRemoteSha)
    expect(conflicts).toHaveLength(0)
  })

  it('handles new remote conflict when local workspace exists', async () => {
    const p = 'nr2.txt'
    // create a workspace blob to simulate local uncommitted changes
    await backend.writeBlob(p, 'local-work', 'workspace')
    const baseSnapshot: Record<string,string> = { [p]: 'remote-content' }
    const perFileRemoteSha = await shaOf(baseSnapshot[p])
    const conflicts: any[] = []
    await (vfs as any)._handleRemotePath(p, perFileRemoteSha, baseSnapshot, conflicts, 'remoteHead')
    // conflict should be recorded
    expect(conflicts.length).toBeGreaterThan(0)
    const conflictBlob = await backend.readBlob(p, 'conflict')
    expect(conflictBlob).toBe('remote-content')
  })

  it('handles existing remote update when no local workspace', async () => {
    const p = 'exu.txt'
    // create index entry with baseSha pointing to old
    await backend.writeBlob(p, JSON.stringify({ path: p, baseSha: 'old', state: 'base' }), 'info')
    // provide baseSnapshot containing new content
    const baseSnapshot: Record<string,string> = { [p]: 'new-base' }
    const perFileRemoteSha = await shaOf(baseSnapshot[p])
    const conflicts: any[] = []
    await (vfs as any)._handleRemotePath(p, perFileRemoteSha, baseSnapshot, conflicts, 'remoteHead')
    // should update base and info
    expect(await backend.readBlob(p, 'base')).toBe('new-base')
    const ie = JSON.parse(await backend.readBlob(p, 'info'))
    expect(ie.baseSha).toBe(perFileRemoteSha)
    expect(conflicts).toHaveLength(0)
  })

  it('handles existing remote conflict when workspace differs', async () => {
    const p = 'exc.txt'
    // create index entry with baseSha
    await backend.writeBlob(p, JSON.stringify({ path: p, baseSha: 'bs', state: 'base' }), 'info')
    // create base and workspace where workspace differs
    await backend.writeBlob(p, 'base-content', 'base')
    await backend.writeBlob(p, 'local-changed', 'workspace')
    const perFileRemoteSha = await shaOf('remote-new')
    const baseSnapshot: Record<string,string> = { [p]: 'remote-new' }
    const conflicts: any[] = []
    await (vfs as any)._handleRemotePath(p, perFileRemoteSha, baseSnapshot, conflicts, 'remoteHead')
    // conflict entry should be created and .git-conflict content persisted
    expect(conflicts.length).toBeGreaterThan(0)
    const conflictBlob = await backend.readBlob(p, 'conflict')
    expect(conflictBlob).toBe('remote-new')
  })
})
