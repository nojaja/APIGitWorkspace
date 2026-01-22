import VirtualFS from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'

describe('readFile and resolveConflict branches', () => {
  it('readFile returns workspace, workspace blob, base blob and base map', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })

    // workspace via writeFile
    await vfs.writeFile('a.txt', 'A')
    expect(await vfs.readFile('a.txt')).toBe('A')

    // workspace blob read-through (simulate backend-only)
    await storage.writeBlob('workspace/b.txt', 'B')
    expect(await vfs.readFile('b.txt')).toBe('B')

    // base blob read-through
    await storage.writeBlob('.git-base/c.txt', 'C')
    const gotc = await vfs.readFile('c.txt'); if (gotc !== 'C') throw new Error('expected C got ' + String(gotc))

       // base blob read-through for d.txt
       await storage.writeBlob('.git-base/d.txt', 'D')
       expect(await vfs.readFile('d.txt')).toBe('D')
  })

  it('resolveConflict promotes remote content when present and updates index', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    const path = 'conf.txt'
    // set index entry with remoteSha
    vfs.getIndex().entries[path] = { path, remoteSha: 'r1' } as any
    // write conflict blob
    await storage.writeBlob('.git-conflict/' + path, 'RC')

    const res = await vfs.resolveConflict(path)
    expect(res).toBe(true)
    const ie = vfs.getIndex().entries[path]
    expect(ie.state).toBe('base')
    // backend should have base blob
    expect((storage as any).blobs.get('.git-base/' + path)).toBe('RC')
  })

  it('resolveConflict promotes remoteSha even if blob not present', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    const path = 'noblob.txt'
    vfs.getIndex().entries[path] = { path, remoteSha: 'r2' } as any

    const res = await vfs.resolveConflict(path)
    expect(res).toBe(true)
    const ie = vfs.getIndex().entries[path]
    expect(ie.baseSha).toBe('r2')
    expect(ie.state).toBe('base')
  })
})







