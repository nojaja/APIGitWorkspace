import VirtualFS from '../../../src/virtualfs/virtualfs'

describe('VirtualFS extra coverage targets', () => {
  it('_persistRemoteContentAsConflict ignores undefined and swallows backend errors', async () => {
    const backend = {
      init: async () => {},
      readIndex: async () => ({ head: '', entries: {} }),
      writeIndex: async () => {},
      readBlob: async () => null,
      writeBlob: async (p: string, c: string, seg?: string) => { if (p === 'err') throw new Error('boom') },
      deleteBlob: async () => {},
      listFiles: async () => [],
    }
    const fs = new VirtualFS({ backend: backend as any })
    const ref = fs as any
    // undefined content -> early return
    await ref._persistRemoteContentAsConflict('a', undefined)
    // content but backend throws -> should not throw
    await expect(ref._persistRemoteContentAsConflict('err', 'x')).resolves.toBeUndefined()
  })
})


