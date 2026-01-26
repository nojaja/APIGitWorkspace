import { jest } from '@jest/globals'
import { VirtualFS } from '../../../src/virtualfs/virtualfs'

class MockBackend {
  store: Record<string, Record<string, string>> = {}
  index: any = { head: '', entries: {} }
  calls: any[] = []
  async init() { return }
  async readIndex() { return this.index }
  async writeIndex(idx: any) { this.calls.push(['writeIndex', idx]); this.index = idx }
  async readBlob(path: string, seg?: string) {
    this.calls.push(['readBlob', path, seg])
    const segs = this.store[path]
    if (!segs) return null
    if (!seg) return segs['base'] || null
    return segs[seg] ?? null
  }
  async writeBlob(path: string, content: string, seg?: string) {
    this.calls.push(['writeBlob', path, seg, content])
    if (!this.store[path]) this.store[path] = {}
    const key = seg || 'base'
    this.store[path][key] = content
  }
  async deleteBlob(path: string, seg?: string) {
    this.calls.push(['deleteBlob', path, seg])
    if (!this.store[path]) return
    if (seg) delete this.store[path][seg]
    else delete this.store[path]
  }
  async listFiles(_prefix?: string | undefined, seg?: string) {
    this.calls.push(['listFiles', seg])
    const out: Array<{ path: string; info?: string }> = []
    for (const p of Object.keys(this.store)) {
      if (seg === 'info') out.push({ path: p, info: this.store[p]['info'] })
      else if (seg === 'workspace') out.push({ path: p, info: this.store[p]['workspace'] })
      else out.push({ path: p })
    }
    return out
  }
}

describe('VirtualFS remote handlers (unit)', () => {
  let backend: MockBackend
  let vfs: any

  beforeEach(async () => {
    backend = new MockBackend()
    vfs = new VirtualFS({ backend: (backend as any) })
    // initialize index manager state
    await vfs.init()
    // replace conflictManager with spies to observe calls
    const mockConflict = {
      persistRemoteContentAsConflict: jest.fn().mockResolvedValue(undefined),
      setIndexEntryToConflict: jest.fn().mockResolvedValue(undefined)
    }
    ;(vfs as any).conflictManager = mockConflict
  })

  it('._handleRemoteNewAdd adds base when snapshot contains path', async () => {
    const p = 'a.txt'
    const content = 'hello'
    const sha = await vfs.shaOf(content)
    const baseSnapshot: Record<string,string> = { [p]: content }
    const conflicts: any[] = []

    await (vfs as any)._handleRemoteNewAdd(p, sha, baseSnapshot, 'remoteHead', conflicts, undefined, undefined)

    // info and base blobs must be written
    expect(backend.calls.some(c => c[0] === 'writeBlob' && c[1] === p && c[2] === 'info')).toBeTruthy()
    expect(backend.calls.some(c => c[0] === 'writeBlob' && c[1] === p && c[2] === 'base')).toBeTruthy()
    expect(conflicts.length).toBe(0)
  })

  it('._handleRemoteNewAdd creates conflict when snapshot missing path', async () => {
    const p = 'b.txt'
    const sha = 'deadbeef'
    const baseSnapshot: Record<string,string> = {}
    const conflicts: any[] = []

    await (vfs as any)._handleRemoteNewAdd(p, sha, baseSnapshot, 'remoteHead', conflicts, undefined, undefined)

    expect((vfs as any).conflictManager.setIndexEntryToConflict).toHaveBeenCalled()
    expect(conflicts.length).toBe(1)
  })

  it('._handleRemoteExistingUpdate marks conflict when remote content missing', async () => {
    const p = 'c.txt'
    const indexEntry = { path: p, state: 'base', baseSha: 'oldsha' }
    // write existing info
    await backend.writeBlob(p, JSON.stringify(indexEntry), 'info')
    const perFileRemoteSha = 'newsha'
    const baseSnapshot: Record<string,string> = {}
    const conflicts: any[] = []

    await (vfs as any)._handleRemoteExistingUpdate(p, indexEntry, perFileRemoteSha, baseSnapshot, conflicts, 'remoteHead')

    // should have written updated info and saved index, and pushed conflict
    expect(backend.calls.some(c => c[0] === 'writeBlob' && c[1] === p && c[2] === 'info')).toBeTruthy()
    expect(conflicts.length).toBe(1)
  })

  it('._handleRemoteExistingUpdate updates base when remote content present', async () => {
    const p = 'd.txt'
    const oldEntry = { path: p, state: 'base', baseSha: '0' }
    await backend.writeBlob(p, JSON.stringify(oldEntry), 'info')
    const content = 'newcontent'
    const baseSnapshot: Record<string,string> = { [p]: content }
    const perFileRemoteSha = await vfs.shaOf(content)
    const conflicts: any[] = []

    await (vfs as any)._handleRemoteExistingUpdate(p, oldEntry, perFileRemoteSha, baseSnapshot, conflicts, 'remoteHead')

    // info and base blobs updated
    expect(backend.calls.some(c => c[0] === 'writeBlob' && c[1] === p && c[2] === 'info')).toBeTruthy()
    expect(backend.calls.some(c => c[0] === 'writeBlob' && c[1] === p && c[2] === 'base')).toBeTruthy()
    expect(conflicts.length).toBe(0)
  })

  it('._handleRemoteDeletion deletes when no workspace or matching sha', async () => {
    const p = 'e.txt'
    const entry = { path: p, state: 'base', baseSha: 'sha1' }
    await backend.writeBlob(p, JSON.stringify(entry), 'info')
    await backend.writeBlob(p, 'basecontent', 'base')
    const conflicts: any[] = []

    // simulate no workspace
    await (vfs as any)._handleRemoteDeletion(p, entry, {}, conflicts)

    // deleteBlob called for info and base (delete all segments then info)
    expect(backend.calls.some(c => c[0] === 'deleteBlob' && c[1] === p)).toBeTruthy()
  })

  it('._handleRemoteDeletion pushes conflict when workspace differs', async () => {
    const p = 'f.txt'
    const entry = { path: p, state: 'base', baseSha: 'sha1' }
    await backend.writeBlob(p, JSON.stringify(entry), 'info')
    // workspace blob present and different sha
    await backend.writeBlob(p, 'workspacecontent', 'workspace')
    const conflicts: any[] = []

    await (vfs as any)._handleRemoteDeletion(p, entry, {}, conflicts)

    expect(conflicts.length).toBe(1)
  })
})
