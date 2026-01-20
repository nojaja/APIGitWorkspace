import { describe, it, expect } from '@jest/globals'
import VirtualFS from '../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../helpers/inmemoryStorage'

describe('VirtualFS constructor default and rename error', () => {
  it('constructs with InMemoryStorage backend when none provided', async () => {
    const vfs = new VirtualFS({ backend: new InMemoryStorage() })
    // init should not throw
    await expect(vfs.init()).resolves.toBeUndefined()
    // getIndex should be available
    const idx = vfs.getIndex()
    expect(idx).toBeDefined()
  })

  it('renameWorkspace throws when source not found', async () => {
    const vfs = new VirtualFS({ backend: new InMemoryStorage() })
    await vfs.init()
    await expect(vfs.renameWorkspace('no-such.txt', 'x.txt')).rejects.toThrow('source not found')
  })
})
