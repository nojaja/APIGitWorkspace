/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import IndexedDatabaseStorage from '../../../../src/virtualfs/indexedDatabaseStorage'

describe('IndexedDatabaseStorage basic flows', () => {
  const dbName = `test_idxdb_${Date.now()}_${Math.random().toString(36).slice(2)}`
  let storage: any

  beforeEach(async () => {
    storage = new (IndexedDatabaseStorage as any)(dbName)
    await storage.init()
  })

  afterEach(async () => {
    // attempt to delete DB; ignore errors
    try { await (IndexedDatabaseStorage as any).delete(dbName) } catch (_e) {}
  })

  it('readIndex on empty DB returns object with no entries', async () => {
    const idx = await storage.readIndex()
    expect(idx).toBeDefined()
    expect(idx.entries).toBeDefined()
    expect(Object.keys(idx.entries).length).toBe(0)
  })

  it('writeBlob and readBlob work (workspace then base fallback)', async () => {
    await storage.writeBlob('a.txt', 'workspace-content', 'workspace')
    const w = await storage.readBlob('a.txt')
    expect(w).toBe('workspace-content')

    await storage.writeBlob('b.txt', 'base-content', 'base')
    const b = await storage.readBlob('b.txt')
    expect(b).toBe('base-content')

    // segment-specific read
    const baseOnly = await storage.readBlob('a.txt', 'base')
    expect(baseOnly).toBeNull()
  })

  it('_getFromStore returns null for missing keys', async () => {
    const val = await storage.readBlob('nonexistent.txt')
    expect(val).toBeNull()
  })

  it('delete removes keys from all segments when no segment provided', async () => {
    await storage.writeBlob('x.txt', 'v', 'workspace')
    await storage.writeBlob('x.txt', 'vbase', 'base')
    await storage.deleteBlob('x.txt')
    const r = await storage.readBlob('x.txt')
    expect(r).toBeNull()
  })

  it('tx retries on InvalidStateError by reopening DB', async () => {
    // obtain underlying DB and monkeypatch transaction to throw once
    const db: any = await storage.dbPromise
    const origTx = db.transaction.bind(db)
    let called = 0
    db.transaction = function (storeName: string, mode: any) {
      called++
      if (called === 1) {
        const err = new Error('closing')
        ;(err as any).name = 'InvalidStateError'
        throw err
      }
      return origTx(storeName, mode)
    }

    // After first throw, tx should reopen DB and retry; this should resolve
    await expect(storage.writeBlob('retry.txt', 'ok', 'workspace')).resolves.toBeUndefined()
    const got = await storage.readBlob('retry.txt')
    expect(got).toBe('ok')
  })

})
