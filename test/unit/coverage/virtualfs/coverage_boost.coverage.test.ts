/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { IndexedDatabaseStorage } from '../../../../src/virtualfs/indexedDatabaseStorage'

beforeEach(() => jest.clearAllMocks())
afterEach(() => {
  try { delete (globalThis as any).indexedDB } catch (e) { /* noop */ }
  jest.resetAllMocks()
  jest.clearAllMocks()
})

// provide a minimal fake indexedDB so constructor/openDb succeed
function makeFakeIndexedDB() {
  const stores = new Set<string>()
  const data = new Map<string, Map<string, any>>()
  const db: any = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => { stores.add(name); data.set(name, new Map()) },
    transaction: (storeName: string, _mode: string) => {
      const storeMap = data.get(storeName) || new Map()
      const tx: any = { oncomplete: undefined, onerror: undefined }
      tx.objectStore = (_: string) => ({
        get: (key: string) => {
          const req: any = {}
          Object.defineProperty(req, 'onsuccess', { set(fn) { setTimeout(() => fn({ target: req }), 0) } })
          Object.defineProperty(req, 'onerror', { set(_fn) { /* noop */ } })
          req.result = storeMap.get(key)
          return req
        },
        put: (val: any, key: string) => {
          const req: any = {}
          Object.defineProperty(req, 'onsuccess', { set(fn) { setTimeout(() => { storeMap.set(key, val); if (typeof tx.oncomplete === 'function') tx.oncomplete(); fn({ target: req }) }, 0) } })
          Object.defineProperty(req, 'onerror', { set(_fn) { /* noop */ } })
          return req
        },
        delete: (key: string) => {
          const req: any = {}
          Object.defineProperty(req, 'onsuccess', { set(fn) { setTimeout(() => { storeMap.delete(key); if (typeof tx.oncomplete === 'function') tx.oncomplete(); fn({ target: req }) }, 0) } })
          Object.defineProperty(req, 'onerror', { set(_fn) { /* noop */ } })
          return req
        },
        openKeyCursor: () => {
          const req: any = {}
          Object.defineProperty(req, 'onsuccess', { set(fn) { setTimeout(() => fn({ target: { result: null } }), 0) } })
          Object.defineProperty(req, 'onerror', { set(_fn) { /* noop */ } })
          return req
        }
      })
      return tx
    }
  }
  return {
    open: (_name: string, _ver: number) => {
      let onsuccess: any
      let onupgradeneeded: any
      const req: any = {}
      Object.defineProperty(req, 'onsuccess', { set(fn) { onsuccess = fn } })
      Object.defineProperty(req, 'onupgradeneeded', { set(fn) { onupgradeneeded = fn } })
      setTimeout(() => { if (onupgradeneeded) onupgradeneeded({ target: { result: db } }); if (onsuccess) onsuccess({ target: { result: db } }) }, 0)
      req.result = db
      return req
    }
  }
}

// ensure fake exists for tests
if (!(globalThis as any).indexedDB) (globalThis as any).indexedDB = makeFakeIndexedDB()

describe('Coverage boost for IndexedDatabaseStorage internals', () => {
  it('canUse returns false when indexedDB missing', () => {
    // @ts-ignore
    const orig = (globalThis as any).indexedDB
    // @ts-ignore
    delete (globalThis as any).indexedDB
    try {
      expect(IndexedDatabaseStorage.canUse()).toBe(false)
    } finally {
      // @ts-ignore
      (globalThis as any).indexedDB = orig
    }
  })

  it('_filterKeys handles non-recursive correctly', async () => {
    // ensure IndexedDB shim present before instantiation
    if (!(globalThis as any).indexedDB) (globalThis as any).indexedDB = makeFakeIndexedDB()
    const inst = new (IndexedDatabaseStorage as any)('test')
    // call private method
    const keys = ['a', 'a/b', 'a/b/c', 'd']
    const filtered = (inst as any)._filterKeys(keys, 'a', false)
    expect(filtered).toEqual(['a', 'a/b'])
  })

  it('_collectFiles calls _getFromStore for each key', async () => {
    if (!(globalThis as any).indexedDB) (globalThis as any).indexedDB = makeFakeIndexedDB()
    const inst = new (IndexedDatabaseStorage as any)('test')
    const spy = jest.spyOn(inst as any, '_getFromStore').mockResolvedValue('INFO')
    const out = await (inst as any)._collectFiles(['x', 'y'])
    expect(out).toEqual([{ path: 'x', info: 'INFO' }, { path: 'y', info: 'INFO' }])
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('_listKeysFromStore iterates keys via cursor', async () => {
    if (!(globalThis as any).indexedDB) (globalThis as any).indexedDB = makeFakeIndexedDB()
    const inst = new (IndexedDatabaseStorage as any)('test')
    const fakeDB: any = {
      transaction: (_: string, _mode: string) => ({
        objectStore: (_: string) => ({
          openKeyCursor: () => {
            const req: any = {}
            let onsuccess: any
            Object.defineProperty(req, 'onsuccess', { set(fn) { onsuccess = fn } })
            // simulate cursor first returning a key, then null
            setTimeout(() => {
              const cur: any = { key: 'k1', continue: () => { setTimeout(() => onsuccess({ target: { result: null } }), 0) } }
              onsuccess({ target: { result: cur } })
            }, 0)
            return req
          }
        })
      })
    }
    // override dbPromise
    ;(inst as any).dbPromise = Promise.resolve(fakeDB)
    const keys = await (inst as any)._listKeysFromStore('any')
    expect(keys).toEqual(['k1'])
  })

  it('_getFromStore resolves null when transaction throws', async () => {
    if (!(globalThis as any).indexedDB) (globalThis as any).indexedDB = makeFakeIndexedDB()
    const inst = new (IndexedDatabaseStorage as any)('test')
    const fakeDB: any = { transaction: (_: string, _mode: string) => { throw new Error('txfail') } }
    ;(inst as any).dbPromise = Promise.resolve(fakeDB)
    const v = await (inst as any)._getFromStore('s', 'k')
    expect(v).toBeNull()
  })

  it('_performTxAttempt rejects when transaction ctor throws', async () => {
    if (!(globalThis as any).indexedDB) (globalThis as any).indexedDB = makeFakeIndexedDB()
    const inst = new (IndexedDatabaseStorage as any)('test')
    const fakeDB: any = { transaction: (_: string, _mode: string) => { throw new Error('ctorfail') } }
    ;(inst as any).dbPromise = Promise.resolve(fakeDB)
    await expect((inst as any)._performTxAttempt('s', 'readwrite', async (_store: any) => {})).rejects.toThrow('ctorfail')
  })
})
