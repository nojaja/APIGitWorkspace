import { describe, it, expect } from '@jest/globals'
import VirtualFS from '../../../src/virtualfs/virtualfs'

describe('VirtualFS constructor default and rename error', () => {
  it('constructs with default backend when none provided', async () => {
    const vfs = new VirtualFS()
    // init should create default NodeFsStorage directory (relative) and not throw
    await expect(vfs.init()).resolves.toBeUndefined()
    // getIndex should be available
    const idx = vfs.getIndex()
    expect(idx).toBeDefined()
  })

  it('renameWorkspace throws when source not found', async () => {
    const vfs = new VirtualFS()
    await vfs.init()
    await expect(vfs.renameWorkspace('no-such.txt', 'x.txt')).rejects.toThrow('source not found')
  })
})
