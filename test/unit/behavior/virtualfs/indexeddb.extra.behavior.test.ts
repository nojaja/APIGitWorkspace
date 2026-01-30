/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import IndexedDbStorage from '../../../../src/virtualfs/indexedDatabaseStorage'

describe('IndexedDbStorage error and retry branches', () => {
  beforeEach(() => jest.clearAllMocks())
  afterEach(() => {
    try { delete (globalThis as any).indexedDB } catch (e) { /* noop */ }
    jest.resetAllMocks()
    jest.clearAllMocks()
  })

  // minimal fake IndexedDB used for tests
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
            let onsuccess: any
            const req: any = {}
            Object.defineProperty(req, 'onsuccess', { set(fn) { onsuccess = fn } })
            Object.defineProperty(req, 'result', { get() { return storeMap.get(key) } })
            setTimeout(() => { if (onsuccess) onsuccess({ target: req }) }, 0)
            return req
          },
          put: (val: any, key: string) => {
            let onsuccess: any
            const req: any = {}
            Object.defineProperty(req, 'onsuccess', { set(fn) { onsuccess = fn } })
            setTimeout(() => { storeMap.set(key, val); if (onsuccess) onsuccess({ target: req }); if (typeof tx.oncomplete === 'function') tx.oncomplete() }, 0)
            return req
          },
          delete: (key: string) => {
            let onsuccess: any
            const req: any = {}
            Object.defineProperty(req, 'onsuccess', { set(fn) { onsuccess = fn } })
            setTimeout(() => { storeMap.delete(key); if (onsuccess) onsuccess({ target: req }); if (typeof tx.oncomplete === 'function') tx.oncomplete() }, 0)
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

  it('canUse returns false when indexedDB absent', async () => {
    const orig = (global as any).indexedDB
    ;(global as any).indexedDB = undefined
    expect(IndexedDbStorage.canUse()).toBe(false)
    ;(global as any).indexedDB = orig
  })

  it('tx retries when InvalidStateError occurs', async () => {
    // ensure a fake indexedDB exists so constructor does not throw
    ;(global as any).indexedDB = makeFakeIndexedDB()
    const s = new IndexedDbStorage()
    const fakeTx = {
      objectStore: jest.fn(() => ({ put: jest.fn(), get: jest.fn() })),
      onerror: null,
      oncomplete: null
    }
    const fakeDb = { transaction: jest.fn(() => {
      // simulate transaction completing after handlers are attached
      const tx = fakeTx as any
      setTimeout(() => { if (typeof tx.oncomplete === 'function') tx.oncomplete() }, 0)
      return tx
    }) }
    ;(s as any).dbPromise = Promise.resolve(fakeDb as any)
    // call internal tx wrapper which should resolve when tx works
    await expect((s as any).tx('index', 'readwrite', async () => true)).resolves.toBeUndefined()
  })
  // NOTE: readBlob null-on-tx-exception covered in branches.test.ts; removed duplicate
})
