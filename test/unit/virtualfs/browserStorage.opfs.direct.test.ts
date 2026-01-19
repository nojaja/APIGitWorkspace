import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

beforeEach(() => jest.clearAllMocks())

// fake indexedDB to avoid fallback interference
/**
 * Create a fake indexedDB-like object for tests
 * @returns {any}
 */
function makeFakeIndexedDB() {
  const stores = new Set<string>()
  const data = new Map<string, Map<string, any>>()
  const db: any = {
    objectStoreNames: { /** @returns {boolean} */ contains: (name: string) => stores.has(name) },
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
          Object.defineProperty(req, 'onsuccess', { /** @returns {void} */ set(fn) { setTimeout(() => fn({ target: req }), 0) } })
          Object.defineProperty(req, 'onerror', { /** @returns {void} */ set(fn) { /* noop */ } })
          req.result = storeMap.get(key)
          return req
        },
        /** @returns {any} */
        put: (val: any, key: string) => {
          const req: any = {}
          Object.defineProperty(req, 'onsuccess', { /** @returns {void} */ set(fn) { setTimeout(() => { storeMap.set(key, val); if (typeof tx.oncomplete === 'function') tx.oncomplete(); fn({ target: req }) }, 0) } })
          Object.defineProperty(req, 'onerror', { /** @returns {void} */ set(fn) { /* noop */ } })
          return req
        },
        /** @returns {any} */
        delete: (key: string) => {
          const req: any = {}
          Object.defineProperty(req, 'onsuccess', { /** @returns {void} */ set(fn) { setTimeout(() => { storeMap.delete(key); if (typeof tx.oncomplete === 'function') tx.oncomplete(); fn({ target: req }) }, 0) } })
          Object.defineProperty(req, 'onerror', { /** @returns {void} */ set(fn) { /* noop */ } })
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
      Object.defineProperty(req, 'onsuccess', { /** @returns {void} */ set(fn) { onsuccess = fn } })
      Object.defineProperty(req, 'onupgradeneeded', { /** @returns {void} */ set(fn) { onupgradeneeded = fn } })
      setTimeout(() => { if (onupgradeneeded) onupgradeneeded({ target: { result: db } }); if (onsuccess) onsuccess({ target: { result: db } }) }, 0)
      req.result = db
      return req
    }
  }
}

// @ts-ignore
global.indexedDB = makeFakeIndexedDB()

import { BrowserStorage } from '../../../src/virtualfs/persistence'

describe('BrowserStorage OPFS direct (truthy getFileHandle) path', () => {
  it('writeBlob/readBlob via OPFS success path', async () => {
    const files = new Map<string, string>()
    /** @returns {{getDirectory: (name:string)=>Promise<any>, getFileHandle: (name:string, opts?:any)=>Promise<any>}} */
    const makeDir = (map: Map<string, any>) => ({
      /** @returns {Promise<any>} */
      getDirectory: async (name: string) => {
        if (!map.has(name)) map.set(name, makeDir(new Map()))
        return map.get(name)
      },
      /** @returns {Promise<any>} */
      getFileHandle: async (name: string, opts?: any) => {
        const key = name
        return {
          /** @returns {Promise<{write:(content:string)=>Promise<void>,close:()=>Promise<void>}>>} */
          createWritable: async () => ({
            /** @returns {Promise<void>} */
            write: async (content: string) => { files.set(key, content) },
            /** @returns {Promise<void>} */
            close: async () => {}
          }),
          /** @returns {Promise<{text:()=>Promise<string|undefined>}>} */
          getFile: async () => ({ /** @returns {Promise<string|undefined>} */
          text: async () => files.get(key) })
        }
      }
    })

    const root = makeDir(new Map())
    // provide opfs with truthy getFileHandle property so code enters OPFS branch
    // @ts-ignore
    global.originPrivateFileSystem = { /** @returns {Promise<any>} */
    getDirectory: async () => root, /** @returns {boolean} */
    getFileHandle: () => true }

    const bs = new BrowserStorage()
    await bs.init()
    await bs.writeBlob('opfsdir/x.txt', 'from-opfs')
    const got = await bs.readBlob('opfsdir/x.txt')
    expect(got).toBe('from-opfs')
  })
})
