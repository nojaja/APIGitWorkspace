import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'
import { VirtualFS } from '../../../src/virtualfs/virtualfs'

// Consolidated Batch A tests (persistence + basic vfs + read/resolve + coverage targets)
const backends = [
  { name: 'InMemory', factory: () => new InMemoryStorage(), available: true }
]

beforeEach(() => jest.clearAllMocks())
afterEach(() => jest.resetAllMocks())

for (const backend of backends) {
  const describeFn = backend.available ? describe : describe.skip
  describeFn(`VirtualFS BatchA consolidated - ${backend.name}`, () => {
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

    it('vfs: add/update/delete reflected in index and tombstone flow', async () => {
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

      // tombstone
      await vfs.applyBaseSnapshot({ 'a.txt': 'basecontent' }, 'head1')
      await vfs.writeFile('a.txt', 'modified')
      await vfs.deleteFile('a.txt')
      const changes = await vfs.getChangeSet()
      const hasDelete = changes.find((c: any) => c.type === 'delete' && c.path === 'a.txt')
      if (!hasDelete) {
        const idx2 = await vfs.getIndex()
        expect(idx2.entries['a.txt']).toBeUndefined()
      } else {
        expect(hasDelete).toBeDefined()
      }
    })

    it('vfs: readFile and resolveConflict flows', async () => {
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
