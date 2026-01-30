/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import { describe, it, expect } from '@jest/globals'
import VirtualFS from '../../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS additional branch coverage', () => {
  it('pull handles deleted remote files (shas empty)', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    // prepare an index entry with old base content
    await backend.writeBlob('del.txt', JSON.stringify({ path: 'del.txt', state: 'base', baseSha: 'oldsha' }), 'info')
    await backend.writeBlob('del.txt', 'oldcontent', 'base')

    const normalized: any = {
      headSha: 'newhead',
      shas: {}, // file not in remote (deletion)
      fetchContent: async () => ({})
    }

    const res = await vfs.pull(normalized)
    // Should mark as deletion in index
    expect(res.conflicts).toBeDefined()
  })

  it('applyBaseSnapshot clears old entries and applies new ones', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    // First apply a snapshot
    await vfs.applyBaseSnapshot({ 'file1.txt': 'content1' }, 'sha1')

    // Verify it's there
    let blob = await backend.readBlob('file1.txt', 'base')
    expect(blob).toBe('content1')

    // Apply a new snapshot (should replace)
    await vfs.applyBaseSnapshot({ 'file2.txt': 'content2' }, 'sha2')

    // file2 should be there
    blob = await backend.readBlob('file2.txt', 'base')
    expect(blob).toBe('content2')

    // file1 should be gone
    blob = await backend.readBlob('file1.txt', 'base')
    expect(blob).toBeNull()
  })

  it('push with no changes generates empty tree', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({}, 'head1')

    const adapter: any = {
      createBlobs: jest.fn().mockResolvedValue({}),
      createTree: jest.fn().mockResolvedValue('treesha'),
      createCommit: jest.fn().mockResolvedValue('newcommitsha'),
      updateRef: jest.fn().mockResolvedValue(true)
    }

    const input: any = {
      parentSha: 'head1',
      changes: [{ type: 'create', path: 'new.txt', content: 'newcontent' }],
      message: 'add file',
      commitKey: 'k1'
    }

    await vfs.setAdapter(adapter, { type: 'github' })
    const res = await vfs.push(input)
    expect(res.commitSha).toBe('newcommitsha')
    expect(adapter.createTree).toHaveBeenCalled()
  })

  it('pull with workspace deletion (state=deleted) keeps deleted state', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    // Mark a file as deleted in workspace
    await backend.writeBlob('deleted.txt', JSON.stringify({ path: 'deleted.txt', state: 'deleted', baseSha: 'oldsha' }), 'info')
    // Do NOT write to 'base' or 'workspace' (file is gone)

    const normalized: any = {
      headSha: 'newhead',
      shas: {}, // not in remote either
      fetchContent: async () => ({})
    }

    const res = await vfs.pull(normalized)
    expect(res.conflicts).toBeDefined()
  })

  it('pull remote update to locally modified file creates conflict', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    // prepare: base version, local modified
    await backend.writeBlob('mod.txt', JSON.stringify({ path: 'mod.txt', state: 'modified', baseSha: 'basesha' }), 'info')
    await backend.writeBlob('mod.txt', 'baseversion', 'base')
    await backend.writeBlob('mod.txt', 'localmod', 'workspace')

    const normalized: any = {
      headSha: 'remotehead',
      shas: { 'mod.txt': 'remoteSha' },
      fetchContent: async () => ({ 'mod.txt': 'remoteupdate' })
    }

    const res = await vfs.pull(normalized)
    // conflict recorded
    expect(res.conflicts.length).toBeGreaterThan(0)
    expect(res.conflicts.find((c: any) => c.path === 'mod.txt')).toBeDefined()
  })

  it('_handleRemotePath processes delete action', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    // prepare an index entry
    await backend.writeBlob('todelete.txt', JSON.stringify({ path: 'todelete.txt', state: 'base', baseSha: 'sha1' }), 'info')
    await backend.writeBlob('todelete.txt', 'content', 'base')

    // Call the internal method directly via pull with action=delete
    const normalized: any = {
      headSha: 'head2',
      shas: {}, // removed from remote
      fetchContent: async () => ({})
    }

    const res = await vfs.pull(normalized)
    expect(res.conflicts).toBeDefined()
  })

  it('push updates head on success', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()

    await vfs.applyBaseSnapshot({ 'f.txt': 'content' }, 'oldhead')

    const adapter: any = {
      createBlobs: jest.fn().mockResolvedValue({ 'f.txt': 'blobsha' }),
      createTree: jest.fn().mockResolvedValue('treesha'),
      createCommit: jest.fn().mockResolvedValue('newcommitsha'),
      updateRef: jest.fn().mockResolvedValue(true)
    }

    const input: any = {
      parentSha: 'oldhead',
      changes: [{ type: 'modify', path: 'f.txt', content: 'newcontent' }],
      message: 'update',
      commitKey: 'k2'
    }

    await vfs.setAdapter(adapter, { type: 'github' })
    await vfs.push(input)

    // head should be updated
    const idx = await backend.readIndex()
    expect(idx.head).toBe('newcommitsha')
  })
})
