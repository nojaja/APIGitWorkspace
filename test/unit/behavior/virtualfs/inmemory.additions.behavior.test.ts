/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('InMemoryStorage branches', () => {
  beforeEach(() => jest.clearAllMocks())
  afterEach(() => jest.resetAllMocks())

  it('availableRoots includes named stores created via constructor', () => {
    const s = new InMemoryStorage('my_shared_root')
    const roots = InMemoryStorage.availableRoots()
    expect(roots).toContain('my_shared_root')
  })

  it('writeBlob throws on unknown segment', async () => {
    const s = new InMemoryStorage()
    await expect(s.writeBlob('p', 'c', 'UNKNOWN')).rejects.toThrow('unknown segment')
  })

  it('readBlob respects explicit segment lookup', async () => {
    const s = new InMemoryStorage('segroot')
    await s.writeBlob('f1', 'w', 'workspace')
    await s.writeBlob('f2', 'b', 'base')
    await s.writeBlob('f3', 'c', 'conflict')

    expect(await s.readBlob('f2', 'base')).toBe('b')
    expect(await s.readBlob('f3', 'conflict')).toBe('c')
  })
})
