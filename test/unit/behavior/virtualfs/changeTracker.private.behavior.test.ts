/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import { InMemoryStorage } from '../../../../src/virtualfs/inmemoryStorage'
import { ChangeTracker } from '../../../../src/virtualfs/changeTracker'

describe('ChangeTracker private methods', () => {
  it('_isIndexEntryDeleted returns false for falsy entry', async () => {
    const backend = new InMemoryStorage()
    const mockIndexManager: any = { getIndex: async () => ({ entries: {} }) }
    const ct = new ChangeTracker(backend as any, mockIndexManager)
    const res = await (ct as any)._isIndexEntryDeleted(null, 'p')
    expect(res).toBe(false)
  })

  it('_isIndexEntryDeleted returns true for explicit deleted state', async () => {
    const backend = new InMemoryStorage()
    const mockIndexManager: any = { getIndex: async () => ({ entries: {} }) }
    const ct = new ChangeTracker(backend as any, mockIndexManager)
    const entry = { baseSha: 'b', state: 'deleted' }
    const res = await (ct as any)._isIndexEntryDeleted(entry, 'p')
    expect(res).toBe(true)
  })

  it('_isIndexEntryDeleted returns true when workspaceSha present but workspace blob missing', async () => {
    const backend = new InMemoryStorage()
    const mockIndexManager: any = { getIndex: async () => ({ entries: {} }) }
    const ct = new ChangeTracker(backend as any, mockIndexManager)
    const entry = { baseSha: 'b', workspaceSha: 'w' }
    // ensure workspace blob is absent
    const res = await (ct as any)._isIndexEntryDeleted(entry, 'p')
    expect(res).toBe(true)
  })
})
