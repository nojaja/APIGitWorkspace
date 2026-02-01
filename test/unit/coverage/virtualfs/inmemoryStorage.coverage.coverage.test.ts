/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */

import { jest } from '@jest/globals'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('InMemoryStorage extra branches', () => {
  it('writeBlob rejects on unknown segment', async () => {
    const inst = new InMemoryStorage('__testroot_unknown') as any
    await expect(inst.writeBlob('x.txt', 'c', 'unknown')).rejects.toThrow('unknown segment')
  })

  it('_buildInfoEntryForSeg default case returns basic info', async () => {
    const inst = new InMemoryStorage('__testroot_info') as any
    const now = Date.now()
    const out = (inst as any)._buildInfoEntryForSeg('mystery', null, 'p.txt', 's', now)
    expect(out).toBeDefined()
    expect(out.path).toBe('p.txt')
    expect(out.updatedAt).toBe(now)
  })
})
