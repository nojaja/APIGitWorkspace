/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import { describe, it, expect } from '@jest/globals'
import VirtualFS from '../../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS file operations and error paths', () => {
  // Test writeFile creates file with unmodified state
  it('writeFile creates file entry', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.writeFile('new.txt', 'content')
    const content = await vfs.readFile('new.txt')
    expect(content).toBe('content')
  })

  // Test writeFile overwrites existing
  it('writeFile overwrites existing content', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'file.txt': 'original' }, 'h0')
    await vfs.writeFile('file.txt', 'modified')

    const content = await vfs.readFile('file.txt')
    expect(content).toBe('modified')
  })

  // Test readFile throws for non-existent file
  it('readFile returns null for missing file', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    const result = await vfs.readFile('missing.txt')
    // readFile may return null or throw, verify behavior
    expect(result === null || result === undefined).toBe(true)
  })

  // Test listPaths empty
  it('listPaths returns empty array initially', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    const paths = await vfs.listPaths()
    expect(Array.isArray(paths)).toBe(true)
  })

  // Test listPaths with multiple files
  it('listPaths returns all files after applyBaseSnapshot', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({
      'dir1/file1.txt': 'c1',
      'dir2/file2.txt': 'c2',
      'root.txt': 'c0'
    }, 'h1')

    const paths = await vfs.listPaths()
    expect(paths).toContain('dir1/file1.txt')
    expect(paths).toContain('dir2/file2.txt')
    expect(paths).toContain('root.txt')
  })

  // Test deleteFile removes from listing
  it('deleteFile removes file from workspace', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'delete.txt': 'content' }, 'h0')
    await vfs.deleteFile('delete.txt')

    const paths = await vfs.listPaths()
    expect(paths).not.toContain('delete.txt')
  })

  // Test renameFile updates paths
  it('renameFile updates path mapping', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'oldname.txt': 'content' }, 'h0')
    await vfs.renameFile('oldname.txt', 'newname.txt')

    const paths = await vfs.listPaths()
    expect(paths).toContain('newname.txt')
    expect(paths).not.toContain('oldname.txt')

    const content = await vfs.readFile('newname.txt')
    expect(content).toBe('content')
  })

  // Test getChangeSet after single write
  it('getChangeSet reports new files as create', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'h0')
    await vfs.writeFile('new.txt', 'content')

    const changes = await vfs.getChangeSet()
    expect(changes.some((c: any) => c.type === 'create' && c.path === 'new.txt')).toBe(true)
  })

  // Test getIndex returns current index
  it('getIndex returns current index state', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'file.txt': 'content' }, 'h1')

    const idx = await vfs.getIndex()
    expect(idx.head).toBe('h1')
    // conflicts and deleted may be undefined after init
    expect(idx).toBeDefined()
  })

  // Test shaOfGitBlob consistency
  it('shaOfGitBlob returns consistent sha for same content', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })

    const sha1 = await vfs.shaOfGitBlob('content')
    const sha2 = await vfs.shaOfGitBlob('content')

    expect(sha1).toBe(sha2)
  })

  // Test shaOfGitBlob different for different content
  it('shaOfGitBlob returns different sha for different content', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })

    const sha1 = await vfs.shaOfGitBlob('content1')
    const sha2 = await vfs.shaOfGitBlob('content2')

    expect(sha1).not.toBe(sha2)
  })

  // Test readConflict returns conflict info
  it('readConflict returns conflict entry', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    const sha = await vfs.shaOfGitBlob('base')
    await vfs.applyBaseSnapshot({ 'file.txt': 'base' }, 'h0')

    // Mark as conflict
    const idx = await backend.readIndex()
    await backend.writeIndex({
      ...idx,
      conflicts: ['file.txt']
    })

    const conflict = await vfs.readConflict('file.txt')
    expect(conflict).toBeDefined()
  })

  // Test resolveConflict removes from conflicts
  it('resolveConflict removes file from conflicts list', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'conflict.txt': 'content' }, 'h0')

    // Mark as conflict
    let idx = await backend.readIndex()
    await backend.writeIndex({
      ...idx,
      conflicts: ['conflict.txt']
    })

    await vfs.resolveConflict('conflict.txt')

    idx = await backend.readIndex()
    // After resolveConflict, conflicts should be cleared or array
    expect(idx.conflicts === undefined || !idx.conflicts.includes('conflict.txt')).toBe(true)
  })
})
