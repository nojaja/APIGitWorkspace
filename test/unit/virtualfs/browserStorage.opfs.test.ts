import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

beforeEach(() => {
  jest.clearAllMocks()
})

// minimal fake IndexedDB (same shape used by other tests)
/**
 * Create a minimal fake indexedDB for tests
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
      tx.objectStore = (_: string) => {
        return {
          /** @returns {any} */
          get: (key: string) => {
            let onsuccess: any
            let _onerror: any
            const req: any = {
              /** @returns {any} */
              get result() { return storeMap.get(key) }
            }
            Object.defineProperty(req, 'onsuccess', { /** @returns {void} */ set(fn) { onsuccess = fn } })
            Object.defineProperty(req, 'onerror', { /** @returns {void} */ set(fn) { _onerror = fn } })
            setTimeout(() => { if (onsuccess) onsuccess({ target: req }) }, 0)
            return req
          },
          /** @returns {any} */
          put: (val: any, key: string) => {
            let onsuccess: any
            let _onerror: any
            const req: any = {}
            Object.defineProperty(req, 'onsuccess', { /** @returns {void} */ set(fn) { onsuccess = fn } })
            Object.defineProperty(req, 'onerror', { /** @returns {void} */ set(fn) { _onerror = fn } })
            setTimeout(() => { storeMap.set(key, val); if (onsuccess) onsuccess({ target: req }); if (typeof tx.oncomplete === 'function') tx.oncomplete() }, 0)
            return req
          },
          /** @returns {any} */
          delete: (key: string) => {
            let onsuccess: any
            let _onerror: any
            const req: any = {}
            Object.defineProperty(req, 'onsuccess', { /** @returns {void} */ set(fn) { onsuccess = fn } })
            Object.defineProperty(req, 'onerror', { /** @returns {void} */ set(fn) { _onerror = fn } })
            setTimeout(() => { storeMap.delete(key); if (onsuccess) onsuccess({ target: req }); if (typeof tx.oncomplete === 'function') tx.oncomplete() }, 0)
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
      const req: any = {}
      Object.defineProperty(req, 'onsuccess', { /** @returns {void} */ set(fn) { onsuccess = fn } })
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

// import BrowserStorage after installing indexedDB
import { BrowserStorage } from '../../../src/virtualfs/persistence'

describe('BrowserStorage OPFS branches', () => {
  it('uses OPFS when available for write/read', async () => {
    // create simple OPFS mock with nested directories and file handle
    const files = new Map<string, string>()

    /** Create a directory-like accessor backed by `map` */
    function makeDir(map: Map<string, any>) {
      /** @returns {Promise<any>} */
      async function getDirectory(name: string) {
        if (!map.has(name)) map.set(name, makeDir(new Map()))
        return map.get(name)
      }

      /** @returns {Promise<any>} */
      async function getFileHandle(name: string, opts?: any) {
        const key = name
        /** @returns {Promise<{write:(content:string)=>Promise<void>,close:()=>Promise<void>}>} */
        async function createWritable() {
          /** @returns {Promise<void>} */
          async function write(content: string) {
            files.set(key, content)
          }
          /** @returns {Promise<void>} */
          async function close() {
            /* noop */
          }
          return { write, close }
        }
        /** @returns {Promise<{text:()=>Promise<string|undefined>}>} */
        async function getFile() {
          /** @returns {Promise<string|undefined>} */
          async function text() { return files.get(key) }
          return { text }
        }
        return { createWritable, getFile }
      }

      return { getDirectory, getFileHandle }
    }

    const root = makeDir(new Map())
    // @ts-ignore
    global.originPrivateFileSystem = {
      /** @returns {Promise<any>} */
      getDirectory: async () => root,
      getFileHandle: undefined
    }

    const bs = new BrowserStorage()
    await bs.init()

    await bs.writeBlob('dir1/x.txt', 'opfs-content')
    const r = await bs.readBlob('dir1/x.txt')
    expect(r).toBe('opfs-content')
  })

  it('falls back to IndexedDB when OPFS write throws', async () => {
    // opfs that throws on getDirectory
    // @ts-ignore
    global.originPrivateFileSystem = {
      /** @returns {Promise<any>} */
      getDirectory: async () => { throw new Error('opfs fail') }
    }

    const bs = new BrowserStorage()
    await bs.init()

    await bs.writeBlob('dir2/y.txt', 'fallback-content')
    const r = await bs.readBlob('dir2/y.txt')
    expect(r).toBe('fallback-content')
  })

  it('falls back to IndexedDB when OPFS read throws', async () => {
    // prepare IndexedDB with a blob
    const bs0 = new BrowserStorage()
    await bs0.init()
    await bs0.writeBlob('dir3/z.txt', 'db-only')

    // opfs that throws on read
    // @ts-ignore
    global.originPrivateFileSystem = {
      /** @returns {Promise<any>} */
      getDirectory: async () => { throw new Error('opfs read fail') }
    }

    const bs = new BrowserStorage()
    await bs.init()
    const got = await bs.readBlob('dir3/z.txt')
    expect(got).toBe('db-only')
  })
})
