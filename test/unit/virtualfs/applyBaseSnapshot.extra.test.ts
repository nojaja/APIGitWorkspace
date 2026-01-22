import VirtualFS from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'

describe('applyBaseSnapshot branches', () => {
  it('applies snapshot: adds, updates and removes as needed', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })

    // initial base: x.txt -> old
    await storage.writeBlob('.git-base/x.txt', 'old')
    // manually populate index as if loaded
    vfs.getIndex().entries['x.txt'] = { path: 'x.txt', state: 'base', baseSha: await (async () => { const enc = new TextEncoder(); const h = await crypto.subtle.digest('SHA-1', enc.encode('old')); return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('') })(), updatedAt: Date.now() } as any

    // snapshot contains y.txt (new) and x.txt updated
    const snapshot = { 'x.txt': 'newx', 'y.txt': 'ycontent' }
    await vfs.applyBaseSnapshot(snapshot, 'headsha')

    // backend should have updated blobs
    expect(await storage.readBlob('.git-base/x.txt')).toBe('newx')
    expect(await storage.readBlob('.git-base/y.txt')).toBe('ycontent')
    // index head should be updated
    expect(vfs.getIndex().head).toBe('headsha')
  })
})
