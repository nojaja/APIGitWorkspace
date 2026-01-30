/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { VirtualFS } from '../../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../../src/virtualfs/inmemoryStorage'
import { shaOf } from '../../../../src/virtualfs/hashUtils'

describe('VirtualFS additional branch tests', () => {
  let backend: any
  let vfs: any

  beforeEach(async () => {
    backend = new (InMemoryStorage as any)('branch-more')
    vfs = new VirtualFS({ backend })
    await vfs.init()
  })

  it('_normalizeRemoteInput returns descriptor when string input', async () => {
    const snapshot = { 'x.txt': 'abc' }
    const res = await (vfs as any)._normalizeRemoteInput('HEAD', snapshot)
    expect(res.headSha).toBe('HEAD')
    expect(res.shas['x.txt']).toBeDefined()
    const fetched = await res.fetchContent(['x.txt', 'no.txt'])
    expect(fetched['x.txt']).toBe('abc')
    expect(fetched['no.txt']).toBeUndefined()
  })
  // Private helper tests removed; keep public API focused tests only.

  it('_isNonFastForwardError detects various messages', () => {
    const fn = (vfs as any)._isNonFastForwardError.bind(vfs)
    expect(fn(new Error('422 Unprocessable Entity'))).toBe(true)
    expect(fn('not a fast forward')).toBe(true)
    expect(fn(new Error('Some other error'))).toBe(false)
  })
})
