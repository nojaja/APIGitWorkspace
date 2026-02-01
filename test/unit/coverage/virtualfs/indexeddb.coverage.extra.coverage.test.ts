/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */

import { jest } from '@jest/globals'
import IndexedDbStorage from '../../../../src/virtualfs/indexedDatabaseStorage'

// This test provides a simple in-memory fake IndexedDB implementation
// to exercise code paths in IndexedDbStorage that are hard to reach
// with the minimal fakes used elsewhere (openKeyCursor, info store updates,
// listFiles prefix/non-recursive filtering).

function makeFakeDB() {
  const stores: Record<string, Map<string, string>> = {
    workspace: new Map(),
    'git-base': new Map(),
    'git-conflict': new Map(),
    'git-info': new Map(),
    index: new Map(),
  }

  function makeReq(result?: any, callOnSuccess = true) {
    const req: any = { result, onsuccess: null, onerror: null }
    // deliver asynchronously so IndexedDbStorage handlers can attach
    setTimeout(() => { if (req.onsuccess) req.onsuccess() }, 0)
    return req
  }

  const db: any = {
    transaction: (storeName: string) => {
      const store = stores[storeName]
      const objectStore = {
        put: (val: any, key: string) => { store.set(key, val) },
        get: (key: string) => makeReq(store.has(key) ? store.get(key) : undefined),
        delete: (key: string) => { store.delete(key) },
        openKeyCursor: () => {
          const keys = Array.from(store.keys())
          let idx = 0
          const req: any = { onsuccess: null, onerror: null, result: null }
          // schedule iterative cursor delivery
          setTimeout(function iterate() {
            const ev: any = { target: { result: idx < keys.length ? { key: keys[idx], continue: () => { idx++; setTimeout(iterate, 0) } } : null } }
            if (req.onsuccess) req.onsuccess(ev)
          }, 0)
          return req
        },
      }
      const tx: any = { objectStore: () => objectStore, oncomplete: null, onerror: null }
      setTimeout(() => { if (tx.oncomplete) tx.oncomplete() }, 0)
      return tx
    },
    objectStoreNames: { contains: (n: string) => true },
    onversionchange: null,
  }

  return { db, stores }
}

describe('IndexedDbStorage additional coverage', () => {
  afterEach(() => { jest.clearAllMocks(); delete (globalThis as any).indexedDB })

  it('writeBlob updates info store and listFiles respects prefix and non-recursive', async () => {
    const { db, stores } = makeFakeDB()
    const fakeOpen = jest.fn(() => {
      const req: any = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null }
      setTimeout(() => { if (req.onsuccess) req.onsuccess() }, 0)
      return req
    })
    ;(globalThis as any).indexedDB = { open: fakeOpen }

    const s = new IndexedDbStorage()
    await s.init()

    // write three blobs into workspace/base/conflict and verify info store entries
    await s.writeBlob('a/b/c.txt', 'workspace-content', 'workspace')
    await s.writeBlob('a/b/d.txt', 'base-content', 'base')
    await s.writeBlob('x/y/z.txt', 'conflict-content', 'conflict')

    // info store should have entries for the three paths
    const infoKeys = Array.from(stores['git-info'].keys())
    expect(infoKeys).toEqual(expect.arrayContaining(['a/b/c.txt', 'a/b/d.txt', 'x/y/z.txt']))

    // listFiles with prefix 'a' should include both files under a/, recursive true
    const filesRec = await s.listFiles('a', 'workspace', true)
    expect(filesRec.map(f => f.path)).toEqual(expect.arrayContaining(['a/b/c.txt']))

    // non-recursive listFiles on 'a' should not include nested files
    const filesNonRec = await s.listFiles('a', 'workspace', false)
    expect(filesNonRec.length).toBe(0)

    // listFiles on info store should return info objects
    const infoList = await s.listFiles('', 'info', true)
    expect(infoList.length).toBeGreaterThanOrEqual(3)
  })
})
