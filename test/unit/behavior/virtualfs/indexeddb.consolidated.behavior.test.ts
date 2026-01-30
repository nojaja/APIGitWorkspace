/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'

// Unified/merged tests for IndexedDatabaseStorage to avoid duplicated suites
// These tests dynamically import the storage class to avoid module-load order
// dependency on `globalThis.indexedDB`.

async function getStorageClass() {
  const mod = await import('../../../../src/virtualfs/indexedDatabaseStorage')
  return mod.IndexedDatabaseStorage || mod.default || mod.IndexedDbStorage
}

function makeFakeDBFor(kind: string) {
  const stores: Record<string, Map<string, any>> = {
    workspace: new Map(),
    'git-base': new Map(),
    'git-conflict': new Map(),
    'git-info': new Map(),
    index: new Map(),
  }
  if (kind === 'base-only') stores['git-base'].set('test.txt', 'base content')
  if (kind === 'conflict-only') stores['git-conflict'].set('test.txt', 'conflict content')

  const db: any = {
    transaction: (storeName: string) => {
      const store = stores[storeName]
      const objectStore = {
        get: (key: string) => {
          const req: any = { onsuccess: null, onerror: null, result: store.has(key) ? store.get(key) : undefined }
          setTimeout(() => { if (req.onsuccess) req.onsuccess({ target: req }) }, 0)
          return req
        },
        put: (val: any, key: string) => {
          const req: any = { onsuccess: null }
          setTimeout(() => { store.set(key, val); if (req.onsuccess) req.onsuccess({ target: req }) }, 0)
          return req
        },
        delete: (key: string) => {
          const req: any = { onsuccess: null }
          setTimeout(() => { store.delete(key); if (req.onsuccess) req.onsuccess({ target: req }) }, 0)
          return req
        },
        openKeyCursor: () => {
          const keys = Array.from(store.keys())
          let idx = 0
          const req: any = { onsuccess: null, onerror: null, result: null }
          setTimeout(function iterate() {
            const cursor = idx < keys.length ? { key: keys[idx], continue: () => { idx++; setTimeout(iterate, 0) } } : null
            const ev: any = { target: { result: cursor } }
            if (req.onsuccess) req.onsuccess(ev)
          }, 0)
          return req
        }
      }
      const tx: any = { objectStore: () => objectStore, oncomplete: null, onerror: null }
      setTimeout(() => { if (tx.oncomplete) tx.oncomplete() }, 0)
      return tx
    },
    objectStoreNames: { contains: (_: string) => true },
    onversionchange: null,
  }
  return { db, stores }
}

describe('indexeddb merged tests (consolidated + branches)', () => {
  let origIndexedDB: any
  beforeEach(() => { origIndexedDB = (globalThis as any).indexedDB })
  afterEach(() => { (globalThis as any).indexedDB = origIndexedDB; jest.clearAllMocks() })

  test.each([
    { kind: 'base-only', seg: undefined, expected: 'base content' },
    { kind: 'base-only', seg: 'base', expected: 'base content' },
    { kind: 'conflict-only', seg: 'conflict', expected: 'conflict content' },
  ])('readBlob segment cases %#', async ({ kind, seg, expected }) => {
    const IndexedDatabaseStorage = await getStorageClass()
    const { db } = makeFakeDBFor(kind)
    ;(globalThis as any).indexedDB = { open: jest.fn(() => { const req: any = { result: db, onsuccess: null }; setTimeout(() => { if (req.onsuccess) req.onsuccess() }, 0); return req }) }
    const s = new IndexedDatabaseStorage()
    await s.init()
    const v = await s.readBlob('test.txt', seg as any)
    expect(v).toBe(expected)
  })

  test('deleteBlob segment deletions', async () => {
    const IndexedDatabaseStorage = await getStorageClass()
    const { db } = makeFakeDBFor('all')
    const deletes: string[] = []
    ;(globalThis as any).indexedDB = { open: jest.fn(() => { const req: any = { result: db, onsuccess: null }; setTimeout(() => { if (req.onsuccess) req.onsuccess() }, 0); return req }) }
    const s = new (await getStorageClass())()
    await s.init()
    const fakeDB: any = (await (globalThis as any).indexedDB.open()).result
    const originalTx = fakeDB.transaction
    fakeDB.transaction = (storeName: string) => {
      const tx = originalTx(storeName)
      const os = tx.objectStore()
      const originalDelete = os.delete
      os.delete = (key: string) => { deletes.push(`${storeName}:${key}`); return originalDelete.call(os, key) }
      return tx
    }
    await s.deleteBlob('test.txt', 'base')
    expect(deletes).toEqual(['git-base:test.txt'])
    await s.deleteBlob('test.txt')
    expect(deletes).toEqual(expect.arrayContaining(['workspace:test.txt','git-base:test.txt','git-conflict:test.txt']))
  })

  test.each([
    { name: 'writes entries', index: { head: 'h', entries: { a: { path: 'a', state: 'added' } } } },
    { name: 'empty entries', index: { head: 'h1', entries: {} } },
    { name: 'lastCommitKey', index: { head: 'h1', entries: {}, lastCommitKey: 'k' } },
  ])('writeIndex cases - %s', async ({ index }) => {
    const IndexedDatabaseStorage = await getStorageClass()
    const { db } = makeFakeDBFor('all')
    ;(globalThis as any).indexedDB = { open: jest.fn(() => { const req: any = { result: db, onsuccess: null }; setTimeout(() => { if (req.onsuccess) req.onsuccess() }, 0); return req }) }
    const s = new (await getStorageClass())()
    await s.init()
    await s.writeIndex(index as any)
    const res = await s.readIndex()
    expect(res).toBeDefined()
  })

  // --- merged branch/error tests from branches.test.ts ---
  test('init rejects when openDb fails due to missing indexedDB', async () => {
    const IndexedDatabaseStorage = await getStorageClass()
    const originalIndexedDB = (globalThis as any).indexedDB
    delete (globalThis as any).indexedDB
    const storage = new (await getStorageClass())()
    await expect(storage.init()).rejects.toThrow('IndexedDB is not available')
    if (originalIndexedDB !== undefined) { (globalThis as any).indexedDB = originalIndexedDB }
  })

  test('openDb rejects when IDBOpenDBRequest.onerror fires', async () => {
    const IndexedDatabaseStorage = await getStorageClass()
    const fakeOpen = jest.fn(() => {
      const req: any = {
        error: new Error('DB open failed'),
        result: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      }
      setTimeout(() => { if (req.onerror) req.onerror() }, 0)
      return req
    })
    ;(globalThis as any).indexedDB = { open: fakeOpen }
    const storage = new (await getStorageClass())()
    await expect(storage.init()).rejects.toThrow('DB open failed')
    delete (globalThis as any).indexedDB
  })

  test('tx rethrows non-InvalidStateError exceptions without retry', async () => {
    const IndexedDatabaseStorage = await getStorageClass()
    const fakeDB: any = {
      transaction: jest.fn(() => {
        const err: any = new Error('UnknownError')
        err.name = 'UnknownError'
        throw err
      }),
      objectStoreNames: { contains: () => true },
      onversionchange: null,
    }

    const fakeOpen = jest.fn(() => {
      const req: any = {
        result: fakeDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      }
      setTimeout(() => { if (req.onsuccess) req.onsuccess() }, 0)
      return req
    })

    ;(globalThis as any).indexedDB = { open: fakeOpen }

    const storage = new (await getStorageClass())()
    await storage.init()

    await expect(storage.writeIndex({ version: 1, files: {} })).rejects.toThrow('UnknownError')

    delete (globalThis as any).indexedDB
  })

  test('_getFromStore returns null when transaction() throws', async () => {
    const IndexedDatabaseStorage = await getStorageClass()
    const fakeDB: any = {
      transaction: jest.fn(() => { throw new Error('Transaction creation failed') }),
      objectStoreNames: { contains: () => true },
      onversionchange: null,
    }

    const fakeOpen = jest.fn(() => {
      const req: any = { result: fakeDB, onsuccess: null, onerror: null, onupgradeneeded: null }
      setTimeout(() => { if (req.onsuccess) req.onsuccess() }, 0)
      return req
    })

    ;(globalThis as any).indexedDB = { open: fakeOpen }
    const s = new (await getStorageClass())()
    await s.init()
    const content = await s.readBlob('test.txt')
    expect(content).toBeNull()
    delete (globalThis as any).indexedDB
  })

  test('_getFromStore returns null when IDBRequest.onerror fires', async () => {
    const IndexedDatabaseStorage = await getStorageClass()
    const fakeDB: any = {
      transaction: jest.fn((storeName: string) => {
        const fakeStore: any = {
          get: jest.fn(() => {
            const fakeReq: any = { result: undefined, error: new Error('Get failed'), onsuccess: null, onerror: null }
            setTimeout(() => { if (fakeReq.onerror) fakeReq.onerror() }, 0)
            return fakeReq
          }),
        }
        return { objectStore: () => fakeStore, oncomplete: null, onerror: null }
      }),
      objectStoreNames: { contains: () => true },
      onversionchange: null,
    }

    const fakeOpen = jest.fn(() => {
      const req: any = { result: fakeDB, onsuccess: null, onerror: null, onupgradeneeded: null }
      setTimeout(() => { if (req.onsuccess) req.onsuccess() }, 0)
      return req
    })

    ;(globalThis as any).indexedDB = { open: fakeOpen }
    const s = new (await getStorageClass())()
    await s.init()
    const content = await s.readBlob('test.txt')
    expect(content).toBeNull()
    delete (globalThis as any).indexedDB
  })
})
