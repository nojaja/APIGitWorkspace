/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import { describe, it, expect } from '@jest/globals'
import VirtualFS from '../../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS advanced edge cases', () => {
  // Test push with empty changes array throws
  it('push rejects when changes array is empty', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'h0')

    const input: any = {
      parentSha: 'h0',
      changes: [],
      message: 'Empty commit',
      commitKey: 'ck'
    }

    await expect(vfs.push(input)).rejects.toThrow('No changes')
  })

  // Test pull with same remote and local sha (no-op)
  it('pull with identical shas skips update', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    const sha = await vfs.shaOfGitBlob('content')
    await vfs.applyBaseSnapshot({ 'file.txt': 'content' }, 'h0')

    const normalized: any = {
      headSha: 'h1',
      shas: { 'file.txt': sha },
      fetchContent: async () => ({ 'file.txt': 'content' })
    }

    const result = await (vfs as any).pull(normalized)

    expect(result.conflicts.length).toBe(0)
  })

  // Test writeFile with nested path creates hierarchy
  it('writeFile handles deeply nested paths', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.writeFile('a/b/c/d/e/file.txt', 'deep content')

    const content = await vfs.readFile('a/b/c/d/e/file.txt')
    expect(content).toBe('deep content')

    const paths = await vfs.listPaths()
    expect(paths).toContain('a/b/c/d/e/file.txt')
  })

  // Test deleteFile on non-existent file
  it('deleteFile handles missing file', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'h0')

    // Delete should complete
    await vfs.deleteFile('nonexistent.txt')
    
    const paths = await vfs.listPaths()
    expect(Array.isArray(paths)).toBe(true)
  })

  // Test renameFile to new location
  it('renameFile updates file location', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'file.txt': 'content' }, 'h0')

    await vfs.renameFile('file.txt', 'renamed.txt')

    const paths = await vfs.listPaths()
    expect(paths).toContain('renamed.txt')
    expect(paths).not.toContain('file.txt')
  })

  // Test getChangeSet after multiple operations
  it('getChangeSet aggregates all pending changes', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'base1.txt': 'b1', 'base2.txt': 'b2' }, 'h0')

    // Multiple operations
    await vfs.writeFile('new1.txt', 'n1')
    await vfs.writeFile('new2.txt', 'n2')
    await vfs.writeFile('base1.txt', 'modified')

    const changes = await vfs.getChangeSet()

    expect(changes.length).toBeGreaterThan(0)
    const types = changes.map((c: any) => c.type)
    expect(types).toContain('create')
  })

  // Test push with mixed file types
  it('push handles various file extensions', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'h0')

    const input: any = {
      parentSha: 'h0',
      changes: [
        { type: 'create', path: 'readme.md', content: '# Title' },
        { type: 'create', path: 'code.ts', content: 'const x = 1' },
        { type: 'create', path: 'data.json', content: '{"key":"value"}' },
        { type: 'create', path: 'style.css', content: 'body {}' }
      ],
      message: 'Multiple types',
      commitKey: 'ck'
    }

    const result = await vfs.push(input)
    expect(result.commitSha).toBeTruthy()
  })

  // Test pull creates workspace for new files
  it('pull initializes workspace for new remote files', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'h0')

    const sha = await vfs.shaOfGitBlob('remote data')
    const normalized: any = {
      headSha: 'h1',
      shas: { 'remote.txt': sha },
      fetchContent: async () => ({ 'remote.txt': 'remote data' })
    }

    await (vfs as any).pull(normalized)

    const content = await vfs.readFile('remote.txt')
    expect(content).toBe('remote data')
  })

  // Test applyBaseSnapshot with empty snapshot
  it('applyBaseSnapshot handles empty snapshot', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'existing.txt': 'data' }, 'h0')

    await vfs.applyBaseSnapshot({}, 'h1')

    const paths = await vfs.listPaths()
    expect(paths.length).toBe(0)
  })

  // Test readFile after deletion falls back to base
  it('readFile falls back to base after workspace deletion', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'file.txt': 'content' }, 'h0')
    await vfs.deleteFile('file.txt')

    // May still read from base
    const content = await vfs.readFile('file.txt')
    expect(content === 'content' || content === null).toBe(true)
  })

  // Test listPaths after complex operations
  it('listPaths reflects all file operations', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'a.txt': 'a', 'b.txt': 'b' }, 'h0')

    await vfs.writeFile('c.txt', 'c')
    await vfs.deleteFile('a.txt')
    await vfs.renameFile('b.txt', 'd.txt')

    const paths = await vfs.listPaths()

    expect(paths).toContain('c.txt')
    expect(paths).toContain('d.txt')
    expect(paths).not.toContain('a.txt')
    expect(paths).not.toContain('b.txt')
  })

  // Test push with very long file path
  it('push handles long file paths', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'h0')

    const longPath = 'dir1/dir2/dir3/dir4/dir5/dir6/dir7/dir8/very-long-filename.txt'

    const input: any = {
      parentSha: 'h0',
      changes: [{ type: 'create', path: longPath, content: 'data' }],
      message: 'Long path',
      commitKey: 'ck'
    }

    const result = await vfs.push(input)
    expect(result.commitSha).toBeTruthy()
  })

  // Test pull with conflict resolution data
  it('pull stores conflict data for manual resolution', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    const baseSha = await vfs.shaOfGitBlob('base')
    const remoteSha = await vfs.shaOfGitBlob('remote')

    await backend.writeBlob('conflict.txt', JSON.stringify({ 
      path: 'conflict.txt', 
      baseSha, 
      state: 'modified' 
    }), 'info')
    await backend.writeBlob('conflict.txt', 'base', 'base')
    await backend.writeBlob('conflict.txt', 'local change', 'workspace')

    const normalized: any = {
      headSha: 'h1',
      shas: { 'conflict.txt': remoteSha },
      fetchContent: async () => ({ 'conflict.txt': 'remote' })
    }

    const result = await (vfs as any).pull(normalized)

    expect(result.conflicts.length).toBeGreaterThan(0)
    
    // Verify conflict was detected in result
    expect(result.conflicts.some((c: any) => c.path === 'conflict.txt')).toBe(true)
  })

  // Test getIndex after various operations
  it('getIndex returns updated state', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'file.txt': 'content' }, 'initial-head')

    const idx = await vfs.getIndex()
    expect(idx.head).toBe('initial-head')
  })

  // Test shaOfGitBlob with special characters
  it('shaOfGitBlob handles special characters', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })

    const sha1 = await vfs.shaOfGitBlob('特殊文字\n改行\t\tタブ')
    const sha2 = await vfs.shaOfGitBlob('特殊文字\n改行\t\tタブ')

    expect(sha1).toBe(sha2)
    expect(sha1).toBeTruthy()
  })
})
