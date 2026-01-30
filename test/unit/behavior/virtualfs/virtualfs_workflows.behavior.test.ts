/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import { describe, it, expect } from '@jest/globals'
import VirtualFS from '../../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

async function createVFS() {
  const backend = new InMemoryStorage()
  const vfs = new VirtualFS({ backend })
  await vfs.init()
  return { backend, vfs }
}

describe('VirtualFS advanced workflows', () => {
  // Test applyBaseSnapshot with large number of files
  it('applyBaseSnapshot handles many files efficiently', async () => {
    const { backend, vfs } = await createVFS()
    const files: Record<string, string> = {}
    for (let i = 0; i < 20; i++) {
      files[`file${i}.txt`] = `content${i}`
    }
    await vfs.applyBaseSnapshot(files, 'h1')
    const paths = await vfs.listPaths()
    expect(paths.length).toBe(20)
  })

  // Test getChangeSet with new files
  it('getChangeSet detects new files', async () => {
    const { backend, vfs } = await createVFS()
    await vfs.applyBaseSnapshot({}, 'h0')
    await vfs.writeFile('new1.txt', 'content1')
    await vfs.writeFile('new2.txt', 'content2')
    const changes = await vfs.getChangeSet()
    const hasNew1 = changes.some((c: any) => c.type === 'create' && c.path === 'new1.txt')
    const hasNew2 = changes.some((c: any) => c.type === 'create' && c.path === 'new2.txt')
    expect(hasNew1).toBe(true)
    expect(hasNew2).toBe(true)
  })

  // Test push with multiple commits
  it('push creates valid commit structure', async () => {
    const { backend, vfs } = await createVFS()
    await vfs.applyBaseSnapshot({ 'base.txt': 'base' }, 'h0')
    const input: any = {
      parentSha: 'h0',
      changes: [
        { type: 'create', path: 'file1.txt', content: 'c1' },
        { type: 'modify', path: 'base.txt', content: 'modified' }
      ],
      message: 'Multiple changes',
      commitKey: 'key1'
    }
    const result = await vfs.push(input)
    expect(result.commitSha).toBeTruthy()
    expect(result.commitSha).toMatch(/^[a-f0-9]+$/)
  })

  // Test pull after local modifications
  it('pull with local changes preserves workspace state', async () => {
    const { backend, vfs } = await createVFS()
    await vfs.applyBaseSnapshot({ 'file.txt': 'v1' }, 'h0')
    // Local modification
    await vfs.writeFile('file.txt', 'local change')
    await vfs.writeFile('local.txt', 'local only')
    // Pull remote updates
    const remoteSha = await vfs.shaOfGitBlob('v2')
    const normalized: any = {
      headSha: 'h1',
      shas: { 'file.txt': remoteSha },
      fetchContent: async () => ({ 'file.txt': 'v2' })
    }
    await (vfs as any).pull(normalized)
    const localContent = await vfs.readFile('local.txt')
    expect(localContent).toBe('local only')
  })

  // Test push with nested directory structure
  it('push handles deeply nested paths', async () => {
    const { backend, vfs } = await createVFS()
    await vfs.applyBaseSnapshot({}, 'h0')
    const input: any = {
      parentSha: 'h0',
      changes: [
        { type: 'create', path: 'a/b/c/d/deep.txt', content: 'nested' },
        { type: 'create', path: 'x/y/file.txt', content: 'another' }
      ],
      message: 'Deep structure',
      commitKey: 'ck'
    }
    const result = await vfs.push(input)
    expect(result.commitSha).toBeTruthy()
  })

  // Test renameFile with nested paths
  it('renameFile works with directory paths', async () => {
    const { backend, vfs } = await createVFS()
    await vfs.applyBaseSnapshot({ 'dir/old.txt': 'content' }, 'h0')
    await vfs.renameFile('dir/old.txt', 'dir/new.txt')
    const paths = await vfs.listPaths()
    expect(paths).toContain('dir/new.txt')
    expect(paths).not.toContain('dir/old.txt')
    const content = await vfs.readFile('dir/new.txt')
    expect(content).toBe('content')
  })

  // Test pull with file added remotely
  it('pull adds new remote files to workspace', async () => {
    const { backend, vfs } = await createVFS()
    await vfs.applyBaseSnapshot({ 'existing.txt': 'exists' }, 'h0')
    const newSha = await vfs.shaOfGitBlob('new content')
    const normalized: any = {
      headSha: 'h1',
      shas: {
        'existing.txt': await vfs.shaOfGitBlob('exists'),
        'newfile.txt': newSha
      },
      fetchContent: async () => ({
        'existing.txt': 'exists',
        'newfile.txt': 'new content'
      })
    }
    await (vfs as any).pull(normalized)
    const newContent = await vfs.readFile('newfile.txt')
    expect(newContent).toBe('new content')
  })

  // Test writeFile after delete
  it('writeFile recreates previously deleted file', async () => {
    const { backend, vfs } = await createVFS()
    await vfs.applyBaseSnapshot({ 'file.txt': 'original' }, 'h0')
    await vfs.deleteFile('file.txt')
    let paths = await vfs.listPaths()
    expect(paths).not.toContain('file.txt')
    await vfs.writeFile('file.txt', 'recreated')
    paths = await vfs.listPaths()
    expect(paths).toContain('file.txt')
    const content = await vfs.readFile('file.txt')
    expect(content).toBe('recreated')
  })

  // Test push with GitLab adapter
  it('push with adapter flow completes successfully', async () => {
    const { backend, vfs } = await createVFS()
    await vfs.applyBaseSnapshot({}, 'h0')
    const mockAdapter: any = {
      createBlobs: jest.fn().mockResolvedValue({ 'f.txt': 'blob1' }),
      createTree: jest.fn().mockResolvedValue('tree1'),
      createCommit: jest.fn().mockResolvedValue('commit1'),
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
    expect(mockAdapter.createBlobs).toHaveBeenCalledTimes(1)
    expect(mockAdapter.createTree).toHaveBeenCalledTimes(1)
    expect(mockAdapter.createCommit).toHaveBeenCalledTimes(1)
    expect(mockAdapter.updateRef).toHaveBeenCalledTimes(1)
    expect(result.commitSha).toBe('commit1')
  })

  // Test pull updates index correctly
  it('pull updates backend index with new head', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'f.txt': 'v1' }, 'oldhead')

    const normalized: any = {
      headSha: 'newhead123',
      shas: { 'f.txt': await vfs.shaOfGitBlob('v1') },
      fetchContent: async () => ({ 'f.txt': 'v1' })
    }

    await (vfs as any).pull(normalized)

    const idx = await backend.readIndex()
    expect(idx.head).toBe('newhead123')
  })
})
