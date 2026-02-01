/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */
import { jest } from '@jest/globals'

import IndexedDbStorage from '../../../../src/virtualfs/indexedDatabaseStorage'

describe('IndexedDbStorage coverage helpers', () => {
  it('canUse returns false when indexedDB is absent', () => {
    const orig = (globalThis as any).indexedDB
    try {
      ;(globalThis as any).indexedDB = undefined
      expect(IndexedDbStorage.canUse()).toBe(false)
    } finally {
      ;(globalThis as any).indexedDB = orig
    }
  })

  it('init rejects when indexedDB is absent', async () => {
    const orig = (globalThis as any).indexedDB
    try {
      ;(globalThis as any).indexedDB = undefined
      const s = new (IndexedDbStorage as any)('coverage-test-db')
      await expect(s.init()).rejects.toThrow()
    } finally {
      ;(globalThis as any).indexedDB = orig
    }
  })

  it('tx retries when InvalidStateError occurs', async () => {
    // create instance without invoking constructor to avoid real openDb
    const s = Object.create((IndexedDbStorage as any).prototype) as any
    s.dbName = 'coverage-tx-db'

    // initial fake DB that throws InvalidStateError on transaction
    const badDb = {
      transaction: () => { const e: any = new Error('invalid'); e.name = 'InvalidStateError'; throw e }
    }
    // good DB that returns a tx whose oncomplete is invoked immediately when set
    const goodStore = { put: () => { /* no-op */ } }
    const goodTx = {
      objectStore: () => goodStore,
      set oncomplete(fn: any) { if (typeof fn === 'function') setTimeout(fn, 0) },
      set onerror(_fn: any) { /* ignore */ }
    }
    const goodDb = { transaction: () => goodTx }

    ;(s as any).dbPromise = Promise.resolve(badDb)
    ;(s as any).openDb = async () => goodDb

    // Should resolve (retry path catches InvalidStateError and reopens DB)
    await expect((s as any).writeBlob('p', 'c')).resolves.toBeUndefined()
  })

  it('readBlob returns null when transaction throws', async () => {
    const s = Object.create((IndexedDbStorage as any).prototype) as any
    s.dbName = 'coverage-read-db'
    const badDb = { transaction: () => { throw new Error('boom') } }
    ;(s as any).dbPromise = Promise.resolve(badDb)
    const res = await (s as any).readBlob('nope')
    expect(res).toBeNull()
  })

  it('availableRoots returns [] when indexedDB.databases is not a function', async () => {
    const orig = (globalThis as any).indexedDB
    try {
      ;(globalThis as any).indexedDB = { /* no databases() */ }
      const roots = await (IndexedDbStorage as any).availableRoots()
      expect(Array.isArray(roots)).toBe(true)
      expect(roots.length).toBe(0)
    } finally {
      ;(globalThis as any).indexedDB = orig
    }
  })

  it('availableRoots returns unique names from indexedDB.databases()', async () => {
    const orig = (globalThis as any).indexedDB
    try {
      ;(globalThis as any).indexedDB = {
        databases: async () => ([
          { name: 'a' },
          { name: 'a' },
          { name: 'b' },
          {},
          { name: 'c' }
        ])
      }
      const roots = await (IndexedDbStorage as any).availableRoots()
      expect(roots).toEqual(['a', 'b', 'c'])
    } finally {
      ;(globalThis as any).indexedDB = orig
    }
  })
})
