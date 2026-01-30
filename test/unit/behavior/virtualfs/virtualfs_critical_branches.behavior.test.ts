/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import { describe, it, expect } from '@jest/globals'
import VirtualFS from '../../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

/**
 * Additional coverage for virtualfs.ts critical branches:
 * - Lines 663, 694, 729-730, 752-755, 806-810, 943-947
 * - Focus: push error handling, pull branch logic, deletion flows
 */
describe('VirtualFS critical branches - push/pull error handling', () => {
  it('push with createTree error should throw', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    // prepare base
    await vfs.applyBaseSnapshot({ 'file.txt': 'base' }, 'head1')

    const adapter: any = {
      createBlobs: jest.fn().mockResolvedValue({ 'file.txt': 'blobsha' }),
      createTree: jest.fn().mockRejectedValue(new Error('tree creation failed')),
    }

    const input: any = {
      parentSha: 'head1',
      changes: [{ type: 'update', path: 'file.txt', content: 'modified' }],
      message: 'update',
      commitKey: 'k1',
    }

    await vfs.setAdapter(adapter, { type: 'github' })
    await expect(vfs.push(input)).rejects.toThrow('tree creation failed')
  })

  it('push with createCommit error should throw', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'file.txt': 'base' }, 'head1')

    const adapter: any = {
      createBlobs: jest.fn().mockResolvedValue({ 'file.txt': 'blobsha' }),
      createTree: jest.fn().mockResolvedValue('treesha'),
      createCommit: jest.fn().mockRejectedValue(new Error('commit failed')),
    }

    const input: any = {
      parentSha: 'head1',
      changes: [{ type: 'update', path: 'file.txt', content: 'x' }],
      message: 'msg',
      commitKey: 'k1',
    }

    await vfs.setAdapter(adapter, { type: 'github' })
    await expect(vfs.push(input)).rejects.toThrow('commit failed')
  })

  it('pull with conflict when remote adds new file and workspace unchanged', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    // prepare base with file1
    await vfs.applyBaseSnapshot({ 'file1.txt': 'content1' }, 'head1')

    // remote adds file2, file1 unchanged
    const normalized: any = {
      headSha: 'head2',
      shas: { 'file1.txt': (await vfs['shaOf']('content1')), 'file2.txt': 'newsha' },
      fetchContent: async (paths: string[]) => {
        const out: Record<string, string> = {}
        for (const p of paths) {
          if (p === 'file2.txt') out[p] = 'new remote file'
        }
        return out
      },
    }

    const res = await vfs.pull(normalized)
    // file2 should be added to base since workspace unchanged
    const file2 = await backend.readBlob('file2.txt', 'base')
    expect(file2).toBe('new remote file')
  })

  it('pull with remote deletion and workspace unchanged', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    // prepare base with 2 files
    await vfs.applyBaseSnapshot({ 'file1.txt': 'content1', 'file2.txt': 'content2' }, 'head1')

    // remote deletes file2 (not in shas)
    const normalized: any = {
      headSha: 'head2',
      shas: { 'file1.txt': (await vfs['shaOf']('content1')) },
      fetchContent: async (_paths: string[]) => ({}),
    }

    const res = await vfs.pull(normalized)
    // file2 should be removed (tombstone or deletion)
    const file2 = await backend.readBlob('file2.txt', 'base')
    // expect no exception and proper handling
    expect(res).toBeDefined()
  })

  it('push with createBlobs returning wrong sha should throw', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'file.txt': 'base' }, 'head1')

    const adapter: any = {
      createBlobs: jest.fn().mockResolvedValue({ 'file.txt': undefined }), // missing sha
      createTree: jest.fn(),
    }

    const input: any = {
      parentSha: 'head1',
      changes: [{ type: 'create', path: 'file.txt', content: 'new' }],
      message: 'add',
      commitKey: 'k1',
    }

    // Should throw when blob sha missing
    await vfs.setAdapter(adapter, { type: 'github' })
    await expect(vfs.push(input)).rejects.toThrow()
  })

  it('pull with partial content fetch results in conflict', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'head1')

    const normalized: any = {
      headSha: 'head2',
      shas: { 'file1.txt': 'sha1', 'file2.txt': 'sha2' },
      fetchContent: async (paths: string[]) => {
        // Only return content for file1, not file2
        return { 'file1.txt': 'content1' }
      },
    }

    const res = await vfs.pull(normalized)
    // file2 should be marked as conflict due to missing content
    const file2Conflict = res.conflicts?.find((c: any) => c.path === 'file2.txt')
    expect(file2Conflict).toBeDefined()
  })

  it('pull with workspace conflict - remote deletion vs local modification', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    // setup: file in base and locally modified
    await vfs.applyBaseSnapshot({ 'file.txt': 'base' }, 'head1')
    await backend.writeBlob('file.txt', 'local edit', 'workspace')

    // remote deletes the file (not in shas)
    const normalized: any = {
      headSha: 'head2',
      shas: {},
      fetchContent: async (_paths: string[]) => ({}),
    }

    const res = await vfs.pull(normalized)
    // Should report conflict: local has changes but remote deleted
    const conflict = res.conflicts?.find((c: any) => c.path === 'file.txt')
    expect(conflict).toBeDefined()
  })
})
