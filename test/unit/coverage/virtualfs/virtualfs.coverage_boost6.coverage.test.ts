/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */

import { jest } from '@jest/globals'
import { VirtualFS } from '../../../../src/virtualfs/virtualfs'

describe('VirtualFS coverage boost 6 - targeted branch fills', () => {
  // Private helper tests removed per request; keep public-facing behavior tests only.

  it('_resolveDescriptor handles adapter-like input and throws when adapter unavailable', async () => {
    const vfs = new VirtualFS({})
    // make a remote-like object
    const remoteLike = { fetchSnapshot: () => Promise.resolve({ headSha: 'h', shas: {}, fetchContent: async () => ({}) }) }
    // override _fetchSnapshotFromAdapterInstance to return null -> should throw
    ;(vfs as any)._fetchSnapshotFromAdapterInstance = jest.fn().mockResolvedValue(null)
    await expect((vfs as any)._resolveDescriptor(remoteLike)).rejects.toThrow('Adapter instance not available')
    // when _fetchSnapshotFromAdapterInstance returns a descriptor, should return it
    const desc = { headSha: 'ok', shas: {}, fetchContent: async () => ({}) }
    ;(vfs as any)._fetchSnapshotFromAdapterInstance = jest.fn().mockResolvedValue(desc)
    const got = await (vfs as any)._resolveDescriptor(remoteLike)
    expect(got).toBe(desc)
  })
})
