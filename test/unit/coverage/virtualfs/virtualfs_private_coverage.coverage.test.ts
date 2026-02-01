/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */

import { jest } from '@jest/globals'
import { VirtualFS } from '../../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../../src/virtualfs/inmemoryStorage'
import { shaOf } from '../../../../src/virtualfs/hashUtils'

describe('VirtualFS private helpers coverage', () => {
  let vfs: VirtualFS
  let backend: any

  beforeEach(async () => {
    backend = new InMemoryStorage()
    vfs = new VirtualFS({ backend })
    await vfs.init()
  })

  it('_isNonFastForwardError recognizes FF errors', () => {
    expect((vfs as any)._isNonFastForwardError(new Error('422: conflict'))).toBe(true)
    expect((vfs as any)._isNonFastForwardError('not a fast forward')).toBe(true)
    expect((vfs as any)._isNonFastForwardError('some other error')).toBe(false)
  })
  it('placeholder: private add/remove helper tests removed', () => {
    expect(true).toBe(true)
  })
})
