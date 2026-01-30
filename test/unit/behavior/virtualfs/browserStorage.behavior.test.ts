/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

beforeEach(() => {
  jest.clearAllMocks()
  try { (globalThis as any).indexedDB = makeFakeIndexedDB() } catch (e) { /* noop */ }
})

afterEach(() => {
  try { delete (globalThis as any).indexedDB } catch (e) { /* noop */ }
  jest.resetAllMocks()
  jest.clearAllMocks()
})

// set up a fake indexedDB before importing BrowserStorage
/** @returns {any} */
function makeFakeIndexedDB() {
  const stores = new Set<string>()
  const data = new Map<string, Map<string, any>>()

  const db = {
    objectStoreNames: {
      /** @returns {boolean} */
      contains: (name: string) => stores.has(name),
    },
    /** @returns {void} */
    createObjectStore: (name: string) => {
      stores.add(name)
      data.set(name, new Map())
    },
    /** @returns {any} */
    transaction: (storeName: string, _mode: string) => {
      const storeMap = data.get(storeName) || new Map()
      const tx: any = { oncomplete: undefined, onerror: undefined }
      /** @returns {any} */
      tx.objectStore = (_: string) => {
        return {
          /** @returns {any} */
          get: (key: string) => {
            let onsuccess: any
            let _onerror: any
            const req: any = {
              /** @returns {any} */
              get result() {
                return storeMap.get(key)
              },
              /** @returns {void} */
              set onsuccess(fn: any) {
                onsuccess = fn
              },
              /** @returns {void} */
              set onerror(fn: any) {
                _onerror = fn
              }
            }
            // simulate async
            setTimeout(() => {
              if (onsuccess) onsuccess({ target: req })
            }, 0)
            return req
          },
          /** @returns {any} */
          put: (val: any, key: string) => {
            let onsuccess: any
            let _onerror: any
            const req: any = {
              /** @returns {void} */
              set onsuccess(fn: any) {
                onsuccess = fn
              },
              /** @returns {void} */
              set onerror(fn: any) {
                _onerror = fn
              }
            }
            setTimeout(() => {
              storeMap.set(key, val)
              if (onsuccess) onsuccess({ target: req })
              // notify transaction complete if set
              if (typeof tx.oncomplete === 'function') tx.oncomplete()
            }, 0)
            return req
          },
          /** @returns {any} */
          delete: (key: string) => {
            let onsuccess: any
            let _onerror: any
            const req: any = {
              /** @returns {void} */
              set onsuccess(fn: any) {
                onsuccess = fn
              },
              /** @returns {void} */
              set onerror(fn: any) {
                _onerror = fn
              }
            }
            setTimeout(() => {
              storeMap.delete(key)
              if (onsuccess) onsuccess({ target: req })
              if (typeof tx.oncomplete === 'function') tx.oncomplete()
            }, 0)
            return req
          }
        }
      }
      return tx
    }
  }

  return {
    /** @returns {any} */
    open: (_name: string, _ver: number) => {
      let onsuccess: any
      let onupgradeneeded: any
      let _onerror: any
      const req: any = {}
      Object.defineProperty(req, 'onsuccess', { /** @returns {void} */ set(fn) { onsuccess = fn } })
      Object.defineProperty(req, 'onupgradeneeded', { /** @returns {void} */ set(fn) { onupgradeneeded = fn } })
      Object.defineProperty(req, 'onerror', { /** @returns {void} */ set(fn) { _onerror = fn } })

      // schedule upgrade + success
      setTimeout(() => {
        if (onupgradeneeded) onupgradeneeded({ target: { result: db } })
        if (onsuccess) onsuccess({ target: { result: db } })
      }, 0)

      req.result = db
      return req
    }
  }
}

// install fake indexedDB
// @ts-ignore
global.indexedDB = makeFakeIndexedDB()

// now import IndexedDbStorage
import { IndexedDatabaseStorage } from '../../../../src/virtualfs/indexedDatabaseStorage'

describe('BrowserStorage (IndexedDB) flows', () => {
  it('writeIndex/readIndex via IndexedDB', async () => {
    const bs = new IndexedDatabaseStorage()
    try {
      await bs.init()
    } catch (err) {
      // ensure fake indexedDB available and retry
      ;(globalThis as any).indexedDB = makeFakeIndexedDB()
      await bs.init()
    }
    const idx = { head: 'h', entries: {} }
    await bs.writeIndex(idx as any)
    const got = await bs.readIndex()
    expect(got).not.toBeNull()
    expect(got!.head).toBe('h')
  }, 30000)

  it('writeBlob/readBlob/deleteBlob via IndexedDB', async () => {
    const bs = new IndexedDatabaseStorage()
    try {
      await bs.init()
    } catch (err) {
      ;(globalThis as any).indexedDB = makeFakeIndexedDB()
      await bs.init()
    }
    await bs.writeBlob('dir/x.txt', 'hello')
    const r = await bs.readBlob('dir/x.txt')
    expect(r).toBe('hello')
    await bs.deleteBlob('dir/x.txt')
    const after = await bs.readBlob('dir/x.txt')
    expect(after).toBeNull()
  })
})
