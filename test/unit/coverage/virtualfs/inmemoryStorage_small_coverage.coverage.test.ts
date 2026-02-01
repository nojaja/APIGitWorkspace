/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */
import { jest } from '@jest/globals'

describe('InMemoryStorage small coverage targets', () => {
  beforeEach(() => { jest.resetModules() })

  it('availableRoots returns default when no stores', async () => {
    const mod = await import('../../../../src/virtualfs/inmemoryStorage')
    const InMemoryStorage = mod.InMemoryStorage || mod.default || mod
    const roots = InMemoryStorage.availableRoots()
    expect(roots).toEqual(['apigit_storage'])
  })

  it('availableRoots includes created root', async () => {
    const mod = await import('../../../../src/virtualfs/inmemoryStorage')
    const InMemoryStorage = mod.InMemoryStorage || mod.default || mod
    // create instance with explicit dir which should register a new root
    const tmp = new InMemoryStorage('my_test_root')
    expect(tmp).toBeDefined()
    const roots = InMemoryStorage.availableRoots()
    expect(roots).toContain('my_test_root')
  })

  it('buildInfoEntry default branch', async () => {
    const mod = await import('../../../../src/virtualfs/inmemoryStorage')
    const InMemoryStorage = mod.InMemoryStorage || mod.default || mod
    const inst = new InMemoryStorage()
    const entry = (inst as any)._buildInfoEntryForSeg('unknown', {}, 'p.txt', 'sha', 12345)
    expect(entry).toHaveProperty('path', 'p.txt')
    expect(entry).toHaveProperty('updatedAt', 12345)
  })
})
