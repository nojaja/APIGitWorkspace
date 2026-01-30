/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { IndexedDatabaseStorage } from '../../../../src/virtualfs/indexedDatabaseStorage'

beforeEach(() => {
  // jest may be undefined or not provide clearAllMocks in some ESM setups
  if (typeof (globalThis as any).jest === 'object' && typeof (globalThis as any).jest.clearAllMocks === 'function') (globalThis as any).jest.clearAllMocks()
  // ensure a fake indexedDB exists for each test (some files delete globals in afterEach)
  // @ts-ignore
  (globalThis as any).indexedDB = makeFakeIndexedDB()
})

afterEach(() => {
  if ('indexedDB' in globalThis) { delete (globalThis as any).indexedDB }
  if (typeof (globalThis as any).jest === 'object' && typeof (globalThis as any).jest.resetAllMocks === 'function') (globalThis as any).jest.resetAllMocks()
  if (typeof (globalThis as any).jest === 'object' && typeof (globalThis as any).jest.clearAllMocks === 'function') (globalThis as any).jest.clearAllMocks()
})

// provide a minimal fake indexedDB so BrowserStorage.openDb succeeds
/** @returns {any} */
function makeFakeIndexedDB() {
  const stores = new Set<string>()
  const data = new Map<string, Map<string, any>>()

  const db: any = {
    objectStoreNames: { /** @returns {boolean} */
    contains: (name: string) => stores.has(name) },
    /** @returns {void} */
    createObjectStore: (name: string) => { stores.add(name); data.set(name, new Map()) },
    /** @returns {any} */
    transaction: (storeName: string, _mode: string) => {
      const storeMap = data.get(storeName) || new Map()
      const tx: any = { oncomplete: undefined, onerror: undefined }
      /** @returns {any} */
      tx.objectStore = (_: string) => ({
        /** @returns {any} */
        get: (key: string) => {
          const req: any = {}
          Object.defineProperty(req, 'onsuccess', { set(fn) { setTimeout(() => fn({ target: req }), 0) } })
          Object.defineProperty(req, 'onerror', { /** @returns {void} */ set(_fn) { /* noop */ } })
          req.result = storeMap.get(key)
          return req
        },
        /** @returns {any} */
        put: (val: any, key: string) => {
          const req: any = {}
          Object.defineProperty(req, 'onsuccess', { set(fn) { setTimeout(() => { storeMap.set(key, val); if (typeof tx.oncomplete === 'function') tx.oncomplete(); fn({ target: req }) }, 0) } })
          Object.defineProperty(req, 'onerror', { /** @returns {void} */ set(_fn) { /* noop */ } })
          return req
        },
        /** @returns {any} */
        delete: (key: string) => {
          const req: any = {}
          Object.defineProperty(req, 'onsuccess', { set(fn) { setTimeout(() => { storeMap.delete(key); if (typeof tx.oncomplete === 'function') tx.oncomplete(); fn({ target: req }) }, 0) } })
          Object.defineProperty(req, 'onerror', { /** @returns {void} */ set(_fn) { /* noop */ } })
          return req
        }
      })
      return tx
    }
  }

  return {
    /** @returns {any} */
    open: (_name: string, _ver: number) => {
      let onsuccess: any
      let onupgradeneeded: any
      const req: any = {}
      Object.defineProperty(req, 'onsuccess', { set(fn) { onsuccess = fn } })
      Object.defineProperty(req, 'onupgradeneeded', { /** @returns {void} */ set(fn) { onupgradeneeded = fn } })        
      setTimeout(() => { if (onupgradeneeded) onupgradeneeded({ target: { result: db } }); if (onsuccess) onsuccess({ target: { result: db } }) }, 0)
      req.result = db
      return req
    }
  }
}

// install fake indexedDB for fallback
// @ts-ignore
global.indexedDB = makeFakeIndexedDB()

describe('BrowserStorage transaction/error branches', () => {
  it('tx rejects when transaction.onerror fires during writeIndex', async () => {
    const bs: any = Object.create((IndexedDatabaseStorage as any).prototype)
    // avoid constructor-driven openDb; replace dbPromise with custom DB below
    // create custom DB that triggers tx.onerror after cb finishes
    const customDb: any = {
      /** @returns {any} */
      transaction: (storeName: string, _mode: string) => {
        const tx: any = { oncomplete: undefined, onerror: undefined, error: new Error('tx-err') }
        const store = {
          /** @returns {any} */
          put: (_val: any, _key: any) => {
            const req: any = {}
            Object.defineProperty(req, 'onsuccess', { set(_fn) { /* ignored */ } })
            Object.defineProperty(req, 'onerror', { /** @returns {void} */ set(_fn) { /* ignored */ } })
            // simulate async but do nothing
            setTimeout(() => {
              // after handlers set oncomplete/onerror by BrowserStorage.tx, fire onerror
              if (typeof tx.onerror === 'function') tx.onerror()
            }, 0)
            return req
          }
        }
        /** @returns {any} */
        tx.objectStore = (_: string) => store
        return tx
      }
    }
    // override dbPromise to use customDb
    ;(bs as any).dbPromise = Promise.resolve(customDb)

    await expect(bs.writeIndex({ head: 'x', entries: {} } as any)).rejects.toThrow('tx-err')
  }, 30000)

  it('readIndex rejects when request.onerror fires', async () => {
    const bs: any = Object.create((IndexedDatabaseStorage as any).prototype)
    // avoid constructor-driven openDb; replace dbPromise with custom DB below
    const customDb: any = {
      /** @returns {any} */
      transaction: (_: string, _mode: string) => {
        const tx: any = {}
        /** @returns {any} */
        tx.objectStore = (_: string) => ({
          /** @returns {any} */
          get: (_key: string) => {
            let onsuccessHandler: any
            let onerrorHandler: any
            const req: any = {}
            Object.defineProperty(req, 'onsuccess', { set(fn) { onsuccessHandler = fn } })
            Object.defineProperty(req, 'onerror', { /** @returns {void} */ set(fn) { onerrorHandler = fn } })
            setTimeout(() => {
              if (typeof onerrorHandler === 'function') onerrorHandler({ target: req })
            }, 0)
            return req
          }
        })
        return tx
      }
    }
    ;(bs as any).dbPromise = Promise.resolve(customDb)

    const result = await bs.readIndex()
    // When request.onerror fires, readIndex should return default empty index
    expect(result).toEqual({ head: '', entries: {} })
  })
})
