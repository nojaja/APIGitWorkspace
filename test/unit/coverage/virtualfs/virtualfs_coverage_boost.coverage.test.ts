/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { VirtualFS } from '../../../../src/virtualfs/virtualfs'

beforeEach(() => jest.clearAllMocks())

describe('VirtualFS internals coverage boost', () => {
  // Note: tests for private helpers removed to keep tests aligned with public API.

  it('_applyChangeLocally apply create/update flow', async () => {
    const calls: string[] = []
    const backend: any = {
      readBlob: jest.fn().mockResolvedValue(null),
      writeBlob: jest.fn().mockImplementation(async () => calls.push('write')),
      deleteBlob: jest.fn().mockImplementation(async () => calls.push('delete'))
    }
    const v = new (VirtualFS as any)({ backend })
    await (v as any)._applyChangeLocally({ type: 'create', path: 'x', content: 'c' })
    expect(calls).toContain('write')
    expect(calls).toContain('delete')
  })
})
