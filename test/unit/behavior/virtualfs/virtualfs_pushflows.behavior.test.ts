/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import { describe, it, expect } from '@jest/globals'
import VirtualFS from '../../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS push flow branches', () => {
  // Test push creates tree from workspace files
  it('push creates blobs and tree for new files', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'h0')

    const input: any = {
      parentSha: 'h0',
      changes: [
        { type: 'create', path: 'file1.txt', content: 'content1' },
        { type: 'create', path: 'file2.txt', content: 'content2' }
      ],
      message: 'Add files',
      commitKey: 'testkey'
    }

    const result = await vfs.push(input)
    expect(result.commitSha).toBeTruthy()
  })

  // Test push with single delete change
  it('push handles delete operations', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'todelete.txt': 'content' }, 'h0')

    const input: any = {
      parentSha: 'h0',
      changes: [{ type: 'delete', path: 'todelete.txt' }],
      message: 'Delete file',
      commitKey: 'testkey'
    }

    const result = await vfs.push(input)
    expect(result.commitSha).toBeTruthy()
  })

  // Test push with modify change
  it('push handles modify operations', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'file.txt': 'original' }, 'h0')

    const input: any = {
      parentSha: 'h0',
      changes: [{ type: 'modify', path: 'file.txt', content: 'modified' }],
      message: 'Modify file',
      commitKey: 'testkey'
    }

    const result = await vfs.push(input)
    expect(result.commitSha).toBeTruthy()
  })

  // Test push with GitHub adapter - blobs created
  it('push with adapter creates GitHub blobs', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'h0')

    const mockAdapter: any = {
      createBlobs: jest.fn().mockResolvedValue({ 'f.txt': 'blob123' }),
      createTree: jest.fn().mockResolvedValue('tree456'),
      createCommit: jest.fn().mockResolvedValue('commit789'),
      updateRef: jest.fn().mockResolvedValue(true)
    }

    const input: any = {
      parentSha: 'h0',
      changes: [{ type: 'create', path: 'f.txt', content: 'data' }],
      message: 'msg',
      commitKey: 'ck'
    }

    await vfs.setAdapter(mockAdapter, { type: 'github' })
    const res = await vfs.push(input)
    expect(res.commitSha).toBeTruthy()
    if (typeof mockAdapter.createBlobs === 'function') {
      expect(mockAdapter.createBlobs).toHaveBeenCalled()
    }
    if (typeof mockAdapter.createTree === 'function') {
      expect(mockAdapter.createTree).toHaveBeenCalled()
    }
    if (typeof mockAdapter.createCommit === 'function') {
      expect(mockAdapter.createCommit).toHaveBeenCalled()
    }
  })

  // Test push updates head reference
  it('push with adapter updates ref after commit', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'h0')

    const mockAdapter: any = {
      createBlobs: jest.fn().mockResolvedValue({ 'f.txt': 'blob1' }),
      createTree: jest.fn().mockResolvedValue('tree1'),
      createCommit: jest.fn().mockResolvedValue('newcommit'),
      updateRef: jest.fn().mockResolvedValue(true)
    }

    const input: any = {
      parentSha: 'h0',
      changes: [{ type: 'create', path: 'f.txt', content: 'data' }],
      message: 'msg',
      commitKey: 'ck'
    }

    await vfs.setAdapter(mockAdapter, { type: 'github' })
    const result = await vfs.push(input)
    expect(result.commitSha).toBeTruthy()
    if (typeof mockAdapter.updateRef === 'function') {
      expect(mockAdapter.updateRef).toHaveBeenCalled()
    }
  })

  // Test push fails with no changes
  it('push throws when no changes provided', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'h0')

    const input: any = {
      parentSha: 'h0',
      changes: [],
      message: 'msg',
      commitKey: 'ck'
    }

    await expect(vfs.push(input)).rejects.toThrow()
  })

  // Test push with complex nested paths
  it('push handles nested directory structures', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'h0')

    const input: any = {
      parentSha: 'h0',
      changes: [
        { type: 'create', path: 'dir1/subdir/file.txt', content: 'nested' },
        { type: 'create', path: 'dir2/file.txt', content: 'another' }
      ],
      message: 'Add nested',
      commitKey: 'ck'
    }

    const result = await vfs.push(input)
    expect(result.commitSha).toBeTruthy()
  })
})
