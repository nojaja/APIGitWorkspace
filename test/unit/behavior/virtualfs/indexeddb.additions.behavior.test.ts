/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import IndexedDbStorage from '../../../../src/virtualfs/indexedDatabaseStorage'

describe('IndexedDbStorage basic open/init branches', () => {
  beforeEach(() => jest.clearAllMocks())
  afterEach(() => {
    try { delete (globalThis as any).indexedDB } catch (e) { /* noop */ }
    jest.resetAllMocks()
    jest.clearAllMocks()
  })

  function makeFakeIndexedDB() {
    const db: any = {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => void 0,
      transaction: () => ({ objectStore: () => ({ get: () => ({}) }) })
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

  it('canUse returns true when indexedDB present and init resolves', async () => {
    const orig = (global as any).indexedDB
    ;(global as any).indexedDB = makeFakeIndexedDB()
    expect(IndexedDbStorage.canUse()).toBe(true)
    const s = new IndexedDbStorage('testdb')
    await expect(s.init()).resolves.toBeUndefined()
    ;(global as any).indexedDB = orig
  })

  it('canUse returns false when indexedDB getter throws', () => {
    const orig = Object.getOwnPropertyDescriptor(global, 'indexedDB')
    Object.defineProperty(global, 'indexedDB', { get: () => { throw new Error('boom') }, configurable: true })
    expect(IndexedDbStorage.canUse()).toBe(false)
    if (orig) Object.defineProperty(global, 'indexedDB', orig)
  })

  it('openDb upgrade path creates object stores when missing', async () => {
    // create fake db whose objectStoreNames.contains returns false so upgrade handler creates stores
    const created: string[] = []
    const db: any = {
      objectStoreNames: { contains: (_: string) => false },
      createObjectStore: (name: string) => { created.push(name) }
    }
    const fakeIdb = {
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
    const orig = (global as any).indexedDB
    ;(global as any).indexedDB = fakeIdb
    const s = new IndexedDbStorage('uptest')
    await expect(s.init()).resolves.toBeUndefined()
    expect(created.length).toBeGreaterThanOrEqual(1)
    ;(global as any).indexedDB = orig
  })
})
