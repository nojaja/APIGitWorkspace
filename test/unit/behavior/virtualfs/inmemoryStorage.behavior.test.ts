/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import { InMemoryStorage } from '../../../../src/virtualfs/inmemoryStorage'

describe('InMemoryStorage basic behaviors', () => {
  let rootName: string
  let store: any

  beforeEach(() => {
    rootName = `test_inmem_${Date.now()}_${Math.random().toString(36).slice(2)}`
    store = new InMemoryStorage(rootName)
  })

  afterEach(() => {
    // cleanup static store
    try {
      InMemoryStorage.delete(rootName)
    } catch (_err) {
      // ignore
    }
  })

  it('writes and reads workspace blob and updates index info', async () => {
    await store.writeBlob('dir/a.txt', 'hello world')
    const r = await store.readBlob('dir/a.txt')
    expect(r).toBe('hello world')

    const idx = await store.readIndex()
    expect(idx).toBeDefined()
    expect(idx.entries['dir/a.txt']).toBeDefined()
    const info = idx.entries['dir/a.txt']
    expect(info.workspaceSha).toBeDefined()
    expect(['added', 'modified']).toContain(info.state)
  })

  it('readBlob prefers workspace over base', async () => {
    await store.writeBlob('file.txt', 'base-content', 'base')
    await store.writeBlob('file.txt', 'workspace-content', 'workspace')

    const s1 = await store.readBlob('file.txt')
    expect(s1).toBe('workspace-content')

    const baseOnly = await store.readBlob('file.txt', 'base')
    expect(baseOnly).toBe('base-content')
  })

  it('deleteBlob with segment deletes only that segment', async () => {
    await store.writeBlob('y.txt', 'b', 'base')
    await store.writeBlob('y.txt', 'w', 'workspace')

    await store.deleteBlob('y.txt', 'workspace')
    const afterWorkspace = await store.readBlob('y.txt')
    // should fall back to base
    expect(afterWorkspace).toBe('b')

    const base = await store.readBlob('y.txt', 'base')
    expect(base).toBe('b')
  })

  it('deleteBlob without segment deletes all including info', async () => {
    await store.writeBlob('z.txt', 'ZCONTENT')
    let idx = await store.readIndex()
    expect(idx.entries['z.txt']).toBeDefined()

    await store.deleteBlob('z.txt')
    const r = await store.readBlob('z.txt')
    expect(r).toBeNull()

    idx = await store.readIndex()
    expect(idx.entries['z.txt']).toBeUndefined()
  })

  it('listFiles supports prefix and non-recursive listing', async () => {
    await store.writeBlob('dir/a.txt', 'A')
    await store.writeBlob('dir/sub/b.txt', 'B')
    await store.writeBlob('other/c.txt', 'C')

    const all = await store.listFiles()
    // contains at least the three written files
    const paths = all.map((x: any) => x.path)
    expect(paths).toEqual(expect.arrayContaining(['dir/a.txt', 'dir/sub/b.txt', 'other/c.txt']))

    const dirRecursive = await store.listFiles('dir', 'workspace', true)
    expect(dirRecursive.map((x: any) => x.path).sort()).toEqual(['dir/a.txt', 'dir/sub/b.txt'].sort())

    const dirNonRec = await store.listFiles('dir', 'workspace', false)
    expect(dirNonRec.map((x: any) => x.path)).toEqual(['dir/a.txt'])
  })

})
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('InMemoryStorage', () => {
  it('canUse static returns true and availableRoots returns keys', () => {
    expect((InMemoryStorage as any).canUse()).toBe(true)
    const roots = (InMemoryStorage as any).availableRoots()
    expect(Array.isArray(roots)).toBe(true)
  })

  it('writeBlob/readBlob across segments and info behavior', async () => {
    const s = new (InMemoryStorage as any)('store1')
    await s.writeBlob('f1', 'w', 'workspace')
    expect(await s.readBlob('f1', 'workspace')).toBe('w')
    await s.writeBlob('f1', 'b', 'base')
    expect(await s.readBlob('f1', 'base')).toBe('b')
    await s.writeBlob('f1', 'c', 'conflict')
    expect(await s.readBlob('f1', 'conflict')).toBe('c')
    // info should be set when writing to workspace/base/conflict
    expect(await s.readBlob('f1', 'info')).not.toBeNull()
  })

  it('readBlob without segment falls back workspace->base', async () => {
    const s = new (InMemoryStorage as any)('store2')
    await s.writeBlob('x', 'baseonly', 'base')
    expect(await s.readBlob('x')).toBe('baseonly')
    await s.writeBlob('x', 'ws', 'workspace')
    expect(await s.readBlob('x')).toBe('ws')
  })

  it('deleteBlob deletes by segment and all when omitted', async () => {
    const s = new (InMemoryStorage as any)('store3')
    await s.writeBlob('d', 'v', 'workspace')
    await s.writeBlob('d', 'v', 'base')
    await s.writeBlob('d', 'v', 'info')
    await s.deleteBlob('d', 'workspace')
    expect(await s.readBlob('d', 'workspace')).toBeNull()
    await s.deleteBlob('d')
    expect(await s.readBlob('d', 'base')).toBeNull()
    expect(await s.readBlob('d', 'info')).toBeNull()
  })

  it('listFiles respects prefix and recursion flag', async () => {
    const s = new (InMemoryStorage as any)('store4')
    await s.writeBlob('dir/a.txt', '1', 'workspace')
    await s.writeBlob('dir/sub/b.txt', '2', 'workspace')
    const all = await s.listFiles('dir', 'workspace', true)
    expect(all.map((it: any) => it.path).sort()).toEqual(['dir/sub/b.txt','dir/a.txt'].sort())
    const top = await s.listFiles('dir', 'workspace', false)
    expect(top.map((it: any) => it.path)).toEqual(['dir/a.txt'])
  })

  it('listFiles returns empty for unknown segment', async () => {
    const s = new (InMemoryStorage as any)('store5')
    const res = await s.listFiles('x', 'unknown', true)
    expect(res).toEqual([])
  })
})
