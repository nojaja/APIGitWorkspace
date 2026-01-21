import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import VirtualFS from '../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../src/virtualfs/inmemoryStorage'

beforeEach(async () => {
  jest.clearAllMocks()
})
afterEach(async () => {
  jest.resetAllMocks()
})

describe('VirtualFS push error branches', () => {
  it('throws when updateRef indicates non-fast-forward (contains 422)', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    await vfs.init()
    // set head so parentSha check passes
    vfs.getIndex().head = 'parent'

    const adapter = {
      createCommitWithActions: async (branch: string, message: string, changes: any[]) => {
        return 'commit-sha-422'
      },
      updateRef: async () => {
        throw new Error('422 Unprocessable Entity')
      },
    }

    const input: any = {
      parentSha: 'parent',
      changes: [{ type: 'create', path: 'a.txt', content: 'x' }],
      message: 'msg',
    }

    await expect(vfs.push(input, adapter as any)).rejects.toThrow('非互換な更新')
  })

  it('continues locally when updateRef throws non-422 error', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    await vfs.init()
    vfs.getIndex().head = 'parent2'
    const adapter = {
      createCommitWithActions: async (branch: string, message: string, changes: any[]) => {
        return 'commit-sha-ok'
      },
      updateRef: async () => {
        throw new Error('network glitch')
      },
    }

    const input: any = {
      parentSha: 'parent2',
      changes: [{ type: 'create', path: 'b.txt', content: 'y' }],
      message: 'msg',
    }

    const res = await vfs.push(input, adapter as any)
    expect(res.commitSha).toBe('commit-sha-ok')
    // index should be updated even when updateRef warned
    expect(vfs.getIndex().head).toBe('commit-sha-ok')
  })
})
