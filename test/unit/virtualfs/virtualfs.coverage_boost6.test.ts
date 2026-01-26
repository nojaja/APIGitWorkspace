import { jest } from '@jest/globals'
import { VirtualFS } from '../../../src/virtualfs/virtualfs'

describe('VirtualFS coverage boost 6 - targeted branch fills', () => {
  it('_classifyRemotePathForPull returns true when info.baseSha matches sha', async () => {
    const vfs = new VirtualFS({})
    const info = { baseSha: 'abc' }
    ;(vfs as any).backend = {
      readBlob: jest.fn().mockImplementation(async (p: string, seg?: string) => {
        if (seg === 'info') return JSON.stringify(info)
        return null
      }),
      writeBlob: jest.fn()
    }
    const fn = (vfs as any)._classifyRemotePathForPull.bind(vfs)
    const res = await fn('file.txt', 'abc', { headSha: 'h', shas: {}, fetchContent: async () => ({}) }, [], [])
    expect(res).toBe(true)
  })

  it('_classifyRemotePathForPull reconciles when base content sha matches remote sha', async () => {
    const vfs = new VirtualFS({})
    const content = 'hello'
    // prepare index info with different baseSha
    const info = { baseSha: 'old' }
    ;(vfs as any).backend = {
      readBlob: jest.fn().mockImplementation(async (p: string, seg?: string) => {
        if (seg === 'info') return JSON.stringify(info)
        if (seg === 'base') return content
        return null
      }),
      writeBlob: jest.fn()
    }
    const fn = (vfs as any)._classifyRemotePathForPull.bind(vfs)
    const gitSha = await vfs.shaOfGitBlob(content)
    const reconciled: string[] = []
    const pathsToFetch: string[] = []
    const res = await fn('file.txt', gitSha, { headSha: 'h', shas: {}, fetchContent: async () => ({}) }, pathsToFetch, reconciled)
    expect(res).toBe(true)
    expect(reconciled).toContain('file.txt')
  })

  it('_applyRemovals deletes info when entry.state is base', async () => {
    const vfs = new VirtualFS({})
    const calls: any[] = []
    ;(vfs as any).backend = {
      deleteBlob: jest.fn(async (p: string, seg?: string) => calls.push({ op: 'delete', p, seg })),
      readBlob: jest.fn(async (p: string, seg?: string) => {
        if (p === 'a' && seg === 'info') return JSON.stringify({ path: 'a', state: 'base' })
        return null
      }),
    }
    await (vfs as any)._applyRemovals(['a', 'b'])
    // expect deleteBlob called for both paths, and extra deleteBlob(p,'info') for 'a'
    expect(calls.find((c) => c.p === 'a' && c.seg === undefined)).toBeTruthy()
    expect(calls.find((c) => c.p === 'b' && c.seg === undefined)).toBeTruthy()
    expect(calls.find((c) => c.p === 'a' && c.seg === 'info')).toBeTruthy()
  })

  it('_applyAddsOrUpdates creates info when none exists', async () => {
    const vfs = new VirtualFS({})
    const writes: any[] = []
    ;(vfs as any).backend = {
      readBlob: jest.fn(async (p: string, seg?: string) => null),
      writeBlob: jest.fn(async (p: string, content: any, seg?: string) => writes.push({ p, content, seg }))
    }
    const snapshot = { 'x.txt': 'data' }
    const newShas: Record<string, string> = { 'x.txt': 'sha1' }
    await (vfs as any)._applyAddsOrUpdates(['x.txt'], snapshot, newShas)
    expect(writes.find((w) => w.p === 'x.txt' && w.seg === 'base')).toBeTruthy()
    expect(writes.find((w) => w.p === 'x.txt' && w.seg === 'info')).toBeTruthy()
  })

  it('_handleRemoteNewAdd pushes conflict when snapshot lacks content', async () => {
    const vfs = new VirtualFS({})
    const conflicts: any[] = []
    ;(vfs as any).backend = { readBlob: jest.fn().mockResolvedValue(null), writeBlob: jest.fn() }
    const cm = { setIndexEntryToConflict: jest.fn(), persistRemoteContentAsConflict: jest.fn() }
    ;(vfs as any).conflictManager = cm
    ;(vfs as any).indexManager = { saveIndex: jest.fn() }
    await (vfs as any)._handleRemoteNewAdd('p', 'sha', {}, 'rh', conflicts, undefined, undefined)
    expect(cm.setIndexEntryToConflict).toHaveBeenCalled()
    expect(conflicts.length).toBeGreaterThanOrEqual(1)
  })

  it('_handleRemoteNewAdd writes base and info when content present', async () => {
    const vfs = new VirtualFS({})
    const writes: any[] = []
    ;(vfs as any).backend = {
      readBlob: jest.fn().mockResolvedValue(null),
      writeBlob: jest.fn(async (p: string, c: any, seg?: string) => writes.push({ p, seg }))
    }
    const conflicts: any[] = []
    const baseSnapshot = { p: 'hello' }
    await (vfs as any)._handleRemoteNewAdd('p', 'sha', baseSnapshot, 'rh', conflicts, undefined, undefined)
    expect(writes.find((w) => w.p === 'p' && w.seg === 'info')).toBeTruthy()
    expect(writes.find((w) => w.p === 'p' && w.seg === 'base')).toBeTruthy()
  })

  it('_resolveDescriptor handles adapter-like input and throws when adapter unavailable', async () => {
    const vfs = new VirtualFS({})
    // make a remote-like object
    const remoteLike = { fetchSnapshot: () => Promise.resolve({ headSha: 'h', shas: {}, fetchContent: async () => ({}) }) }
    // override _fetchSnapshotFromAdapterInstance to return null -> should throw
    ;(vfs as any)._fetchSnapshotFromAdapterInstance = jest.fn().mockResolvedValue(null)
    await expect((vfs as any)._resolveDescriptor(remoteLike)).rejects.toThrow('Adapter instance not available')
    // when _fetchSnapshotFromAdapterInstance returns a descriptor, should return it
    const desc = { headSha: 'ok', shas: {}, fetchContent: async () => ({}) }
    ;(vfs as any)._fetchSnapshotFromAdapterInstance = jest.fn().mockResolvedValue(desc)
    const got = await (vfs as any)._resolveDescriptor(remoteLike)
    expect(got).toBe(desc)
  })
})
