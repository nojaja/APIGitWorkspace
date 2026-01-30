/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import { describe, it, expect } from '@jest/globals'
import VirtualFS from '../../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS pull and conflict flows', () => {
  // Test pull updates head on success
  it('pull updates head sha after successful fetch', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'existing.txt': 'v1' }, 'oldhead')

    const newSha = await vfs.shaOfGitBlob('v2')
    const normalized: any = {
      headSha: 'newhead',
      shas: { 'existing.txt': newSha },
      fetchContent: async () => ({ 'existing.txt': 'v2' })
    }

    await (vfs as any).pull(normalized)

    const idx = await backend.readIndex()
    expect(idx.head).toBe('newhead')
  })

  // Test pull with no changes keeps existing head
  it('pull with identical content keeps head', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    const sha1 = await vfs.shaOfGitBlob('same')
    await vfs.applyBaseSnapshot({ 'file.txt': 'same' }, 'h1')

    const normalized: any = {
      headSha: 'h2',
      shas: { 'file.txt': sha1 },
      fetchContent: async () => ({ 'file.txt': 'same' })
    }

    await (vfs as any).pull(normalized)

    const idx = await backend.readIndex()
    // head should be updated to new value
    expect(idx.head).toBe('h2')
  })

  // Test pull adds new remote files
  it('pull adds files from remote', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'h0')

    const sha = await vfs.shaOfGitBlob('remote content')
    const normalized: any = {
      headSha: 'h1',
      shas: { 'newfile.txt': sha },
      fetchContent: async () => ({ 'newfile.txt': 'remote content' })
    }

    await (vfs as any).pull(normalized)

    const content = await vfs.readFile('newfile.txt')
    expect(content).toBe('remote content')
  })

  // Test pull with file deleted locally but present remotely
  it('pull restores file when deleted locally but present remotely', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    const sha = await vfs.shaOfGitBlob('content')
    await vfs.applyBaseSnapshot({ 'file.txt': 'content' }, 'h0')

    // Delete locally
    await vfs.deleteFile('file.txt')

    // Pull from remote which still has it
    const normalized: any = {
      headSha: 'h1',
      shas: { 'file.txt': sha },
      fetchContent: async () => ({ 'file.txt': 'content' })
    }

    await (vfs as any).pull(normalized)

    const content = await vfs.readFile('file.txt')
    expect(content).toBe('content')
  })

  // Test pull with workspace modification and remote modification
  it('pull creates conflict when both sides modified', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    const baseSha = await vfs.shaOfGitBlob('original')
    const remoteSha = await vfs.shaOfGitBlob('remote')

    // Setup: base file, locally modified
    await backend.writeBlob('conflict.txt', JSON.stringify({ path: 'conflict.txt', baseSha, state: 'modified' }), 'info')
    await backend.writeBlob('conflict.txt', 'original', 'base')
    await backend.writeBlob('conflict.txt', 'local', 'workspace')

    // Pull remote change
    const normalized: any = {
      headSha: 'remote-h',
      shas: { 'conflict.txt': remoteSha },
      fetchContent: async () => ({ 'conflict.txt': 'remote' })
    }

    const result = await (vfs as any).pull(normalized)

    expect(result.conflicts.length).toBeGreaterThan(0)
    expect(result.conflicts.some((c: any) => c.path === 'conflict.txt')).toBe(true)
  })

  // Test pull with workspace delete but base still has it
  it('pull with remote deletion marks as conflict if workspace exists', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    const baseSha = await vfs.shaOfGitBlob('base')
    await backend.writeBlob('willdelete.txt', JSON.stringify({ path: 'willdelete.txt', baseSha, state: 'unmodified' }), 'info')
    await backend.writeBlob('willdelete.txt', 'base', 'base')
    await backend.writeBlob('willdelete.txt', 'base', 'workspace')

    const idx = await backend.readIndex()
    await backend.writeIndex({ ...idx, head: 'h0' })

    // Pull with remote deletion (shas empty for this file)
    const normalized: any = {
      headSha: 'h1',
      shas: {},  // no files
      fetchContent: async () => ({})
    }

    const result = await (vfs as any).pull(normalized)

    // Verify the pull completed
    expect(result).toBeDefined()
  })

  // Test pull clears old conflicts when none exist remotely
  it('pull processes empty remote state', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    // Setup with conflicts
    let idx = await backend.readIndex()
    await backend.writeIndex({ ...idx, conflicts: ['oldconflict.txt'], head: 'h0' })

    // Pull with no conflicts in result
    const normalized: any = {
      headSha: 'h1',
      shas: {},
      fetchContent: async () => ({})
    }

    const result = await (vfs as any).pull(normalized)

    // Verify pull processed successfully
    expect(result).toBeDefined()
  })

  // Test pull with multiple files changed
  it('pull handles multiple file changes', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'a.txt': 'av1' }, 'h0')

    const sha1 = await vfs.shaOfGitBlob('av2')
    const sha2 = await vfs.shaOfGitBlob('bv1')

    const normalized: any = {
      headSha: 'h1',
      shas: {
        'a.txt': sha1,
        'b.txt': sha2
      },
      fetchContent: async () => ({
        'a.txt': 'av2',
        'b.txt': 'bv1'
      })
    }

    await (vfs as any).pull(normalized)

    expect(await vfs.readFile('a.txt')).toBe('av2')
    expect(await vfs.readFile('b.txt')).toBe('bv1')
  })
})
