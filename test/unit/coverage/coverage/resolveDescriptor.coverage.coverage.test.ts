/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */
import { jest } from '@jest/globals'

import { VirtualFS } from '../../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../../src/virtualfs/inmemoryStorage'

describe('coverage: _resolveDescriptor branches', () => {
  it('handles adapter-like input and undefined fallback', async () => {
    const vfs = new VirtualFS({ backend: new InMemoryStorage() })
    await vfs.init()

    // adapter-like object passed directly (has fetchSnapshot fn, no headSha)
    const adapterLike = {
      fetchSnapshot: async () => ({ headSha: 'h1', shas: {}, fetchContent: async () => ({}) })
    }
    const r1 = await vfs.getRemoteDiffs(adapterLike as any)
    expect(r1).toBeDefined()
    expect(typeof r1.remoteShas).toBe('object')

    // ensure fallback when remote is undefined and adapter instance available
    await vfs.setAdapter(adapterLike as any, { type: 'mock' })
    const r2 = await vfs.getRemoteDiffs(undefined)
    expect(r2).toBeDefined()
    expect(r2.remote).not.toBeNull()
  })
})
