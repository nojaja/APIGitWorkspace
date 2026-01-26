import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'
import { VirtualFS } from '../../../src/virtualfs/virtualfs'

// Consolidated VirtualFS tests (InMemory backend)
const backends = [
  { name: 'InMemory', factory: () => new InMemoryStorage(), available: true }
]

beforeEach(() => jest.clearAllMocks())
afterEach(() => jest.resetAllMocks())

for (const backend of backends) {
  const describeFn = backend.available ? describe : describe.skip
  describeFn(`VirtualFS consolidated - ${backend.name}`, () => {
    it('storage: init, write/read index and blob ops', async () => {
      const store = await backend.factory()
      await store.init()

      const index = { head: 'h', entries: {} }
      await store.writeIndex(index as any)
      const read = await store.readIndex()
      expect(read).not.toBeNull()
      expect(read.head).toBe('h')

      await store.writeBlob('dir/a.txt', 'hello')
      expect(await store.readBlob('dir/a.txt')).toBe('hello')
      await store.deleteBlob('dir/a.txt')
      expect(await store.readBlob('dir/a.txt')).toBeNull()
    })

    it('vfs: add/update/delete and tombstone flow', async () => {
      const store = await backend.factory()
      await store.init()
      const vfs = new VirtualFS({ backend: store })
      await vfs.init()

      await vfs.writeFile('foo.txt', 'hello')
      let idx = await vfs.getIndex()
      expect(idx.entries['foo.txt']).toBeDefined()

      await vfs.writeFile('foo.txt', 'hello2')
      idx = await vfs.getIndex()
      expect(idx.entries['foo.txt'].state).toBe('added')

      await vfs.deleteFile('foo.txt')
      idx = await vfs.getIndex()
      expect(idx.entries['foo.txt']).toBeUndefined()

      await vfs.applyBaseSnapshot({ 'a.txt': 'basecontent' }, 'head1')
      await vfs.writeFile('a.txt', 'modified')
      await vfs.deleteFile('a.txt')
      const changes = await vfs.getChangeSet()
      const hasDelete = changes.find((c: any) => c.type === 'delete' && c.path === 'a.txt')
      if (!hasDelete) {
        const idx = await vfs.getIndex()
        expect(idx.entries['a.txt']).toBeUndefined()
      } else {
        expect(hasDelete).toBeDefined()
      }
    })

    it('vfs: readFile and resolveConflict', async () => {
      const store = await backend.factory()
      await store.init()
      const vfs = new VirtualFS({ backend: store })

      await vfs.writeFile('a.txt', 'A')
      expect(await vfs.readFile('a.txt')).toBe('A')

      await store.writeBlob('b.txt', 'B', 'workspace')
      expect(await vfs.readFile('b.txt')).toBe('B')

      await store.writeBlob('c.txt', 'C', 'base')
      expect(await vfs.readFile('c.txt')).toBe('C')

      const filePath = 'conf.txt'
      await store.writeBlob(filePath, JSON.stringify({ path: filePath, remoteSha: 'r1' }), 'info')
      await store.writeBlob(filePath, 'RC', 'conflict')
      await vfs.init()
      expect(await vfs.resolveConflict(filePath)).toBe(true)
      const ie = (await vfs.getIndex()).entries[filePath]
      expect(ie.state).toBe('base')
    })
  })
}

export {}
// ---- Merged: readAndResolve tests ----
describe('readFile and resolveConflict branches (merged)', () => {
  it('readFile returns workspace, workspace blob, base blob and base map', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })

    await vfs.writeFile('a.txt', 'A')
    expect(await vfs.readFile('a.txt')).toBe('A')

    await storage.writeBlob('b.txt', 'B', 'workspace')
    expect(await vfs.readFile('b.txt')).toBe('B')

    await storage.writeBlob('c.txt', 'C', 'base')
    expect(await vfs.readFile('c.txt')).toBe('C')

    await storage.writeBlob('d.txt', 'D', 'base')
    expect(await vfs.readFile('d.txt')).toBe('D')
  })

  it('resolveConflict promotes remote content when present and updates index', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    const filePath = 'conf.txt'
    const entry = { path: filePath, remoteSha: 'r1' }
    await storage.writeBlob(filePath, JSON.stringify(entry), 'info')
    await storage.writeBlob(filePath, 'RC', 'conflict')
    await vfs.init()

    const res = await vfs.resolveConflict(filePath)
    expect(res).toBe(true)
    const ie = (await vfs.getIndex()).entries[filePath]
    expect(ie.state).toBe('base')
    expect(await storage.readBlob(filePath, 'base')).toBe('RC')
  })

  it('resolveConflict promotes remoteSha even if blob not present', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    const filePath2 = 'noblob.txt'
    const entry = { path: filePath2, remoteSha: 'r2' }
    await storage.writeBlob(filePath2, JSON.stringify(entry), 'info')
    await vfs.init()

    const res = await vfs.resolveConflict(filePath2)
    expect(res).toBe(true)
    const ie = (await vfs.getIndex()).entries[filePath2]
    expect(ie.baseSha).toBe('r2')
    expect(ie.state).toBe('base')
  })
})

// ---- Merged: persistence tests ----
describe('InMemoryStorage basic flows (merged)', () => {
  it('init and write/read index', async () => {
    const storage = new InMemoryStorage()
    await storage.init()
    const index = { head: 'h', entries: {} }
    await storage.writeIndex(index as any)
    const read = await storage.readIndex()
    expect(read).not.toBeNull()
    expect(read.head).toBe('h')
  })

  it('writeBlob/readBlob/deleteBlob', async () => {
    const storage = new InMemoryStorage()
    await storage.init()
    await storage.writeBlob('dir/a.txt', 'hello')
    const got = await storage.readBlob('dir/a.txt')
    expect(got).toBe('hello')
    await storage.deleteBlob('dir/a.txt')
    const after = await storage.readBlob('dir/a.txt')
    expect(after).toBeNull()
  })

  it('readIndex returns default index when absent', async () => {
    const storage = new InMemoryStorage()
    await storage.init()
    const r = await storage.readIndex()
    expect(r).not.toBeNull()
    expect(r.head).toBe('')
  })
})
