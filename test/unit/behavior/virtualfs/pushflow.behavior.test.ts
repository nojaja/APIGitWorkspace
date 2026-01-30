/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import VirtualFS from '../../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

beforeEach(async () => {
  jest.clearAllMocks()
})
afterEach(async () => {
  jest.resetAllMocks()
})

describe('VirtualFS push flows', () => {
  it('uses GitHub flow and updates index even if updateRef throws', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    await vfs.init()

    await vfs.writeFile('a.txt', 'hello')
    const changes = await vfs.getChangeSet()

    const adapter = {
      /**
       *
       */
      createBlobs: async (chs: any[]) => {
        const m: Record<string, string> = {}
        for (const c of chs) {
          if (c.type === 'create' || c.type === 'update') m[c.path] = 'blob-' + c.path
        }
        return m
      },
      /**
       *
       */
      createTree: async (_changes: any[]) => 'treesha',
      /**
       *
       */
      createCommit: async (_message: string, _parent: string, _tree: string) => 'commit-github',
      /**
       *
       */
      updateRef: async (_ref: string, _sha: string) => { throw new Error('no update') }
    }

    await vfs.setAdapter(adapter as any, { type: 'github' })
    const res = await vfs.push({ parentSha: (await vfs.getIndex()).head, message: 'm', changes })
    expect(res.commitSha).toBe('commit-github')
    expect((await vfs.getIndex()).head).toBe('commit-github')

    const blob = await storage.readBlob('a.txt')
    expect(blob).toBe('hello')
  })

  it('uses actions flow when adapter has createCommitWithActions', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    await vfs.init()

    await vfs.writeFile('b.txt', 'world')
    const changes = await vfs.getChangeSet()

    const adapter = {
      /**
       *
       */
      createCommitWithActions: async (_branch: string, _message: string, _changes: any[]) => 'commit-actions',
      /**
       *
       */
      updateRef: async (_ref: string, _sha: string) => { throw new Error('no update') }
    }

    await vfs.setAdapter(adapter as any, { type: 'gitlab' })
    const res = await vfs.push({ parentSha: (await vfs.getIndex()).head, message: 'm2', changes, ref: 'main' })
    expect(res.commitSha).toBe('commit-actions')
    expect((await vfs.getIndex()).head).toBe('commit-actions')

    const blob = await storage.readBlob('b.txt')
    expect(blob).toBe('world')
  })
})
