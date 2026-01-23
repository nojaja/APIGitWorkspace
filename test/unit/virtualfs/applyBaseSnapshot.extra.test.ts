import VirtualFS from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'

describe('applyBaseSnapshot branches', () => {
  it('applies snapshot: adds, updates and removes as needed', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })

    // initial base: x.txt -> old
    await storage.writeBlob('x.txt', 'old', 'base')
    // manually populate index as if loaded
    const sha = await (async () => {
      const enc = new TextEncoder()
      const h = await crypto.subtle.digest('SHA-1', enc.encode('old'))
      return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
    })()
    // write entry to backend info segment
    const entry = { path: 'x.txt', state: 'base', baseSha: sha, updatedAt: Date.now() }
    await storage.writeBlob('x.txt', JSON.stringify(entry), 'info')

    // snapshot contains y.txt (new) and x.txt updated
    const snapshot = { 'x.txt': 'newx', 'y.txt': 'ycontent' }
    await vfs.applyBaseSnapshot(snapshot, 'headsha')

    // backend should have updated blobs
    expect(await storage.readBlob('x.txt', 'base')).toBe('newx')
    expect(await storage.readBlob('y.txt', 'base')).toBe('ycontent')
    // index head should be updated
    expect((await vfs.getIndex()).head).toBe('headsha')
  })
})
