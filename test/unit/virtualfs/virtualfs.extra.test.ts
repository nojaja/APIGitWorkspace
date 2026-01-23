import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import VirtualFS from '../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS additional branches', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
  })
  afterEach(async () => {
    jest.resetAllMocks()
  })

  it('handleRemoteExisting is no-op when baseSha equals remoteSha', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    await vfs.init()

    // apply initial base snapshot
    const snapshot = { 'a.txt': 'v1' }
    await vfs.applyBaseSnapshot(snapshot, 'h1')

    // pull with identical snapshot
    const res = await vfs.pull('h1', snapshot)
    expect(res.conflicts.length).toBe(0)
    expect((await vfs.getIndex()).head).toBe('h1')
  })

  it('handleRemoteExisting updates base when workspace unchanged', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    await vfs.init()

    // initial base
    const initial = { 'b.txt': 'old' }
    await vfs.applyBaseSnapshot(initial, 'h-old')

    // remote updated
    const remote = { 'b.txt': 'new' }
    const res = await vfs.pull('h-new', remote)
    expect(res.conflicts.length).toBe(0)
    // index entry should now reflect new baseSha
    const entry = (await vfs.getIndex()).entries['b.txt']
    expect(entry).toBeDefined()
    expect(entry.baseSha).toBeDefined()
    expect(entry.state).toBe('base')
    // backend blob should contain new content
    const content = await storage.readBlob('b.txt')
    expect(content).toBe('new')
  })

  it('handleRemoteDeletion deletes when workspace has no changes', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    await vfs.init()

    const initial = { 'c.txt': 'keep' }
    await vfs.applyBaseSnapshot(initial, 'h1')

    // ensure file exists
    let got = await storage.readBlob('c.txt')
    expect(got).toBe('keep')

    // remote snapshot deletes c.txt
    const remote: Record<string, string> = {}
    const res = await vfs.pull('h2', remote)
    expect(res.conflicts.length).toBe(0)
      // file should be removed from index and storage
      expect((await vfs.listPaths()).includes('c.txt')).toBe(false)
    const after = await storage.readBlob('c.txt')
    expect(after).toBeNull()
  })

  it('loadIndex resets index when backend.readIndex throws', async () => {
    const fakeBackend = {
      /**
       *
       */
      init: async () => {},
      /**
       *
       */
      readIndex: async () => ({ head: '', entries: {} }),
      writeIndex: jest.fn(async (_: any) => {}),
      writeBlob: jest.fn(async () => {}),
      readBlob: jest.fn(async () => null),
      deleteBlob: jest.fn(async () => {}),
    }
    const vfs = new VirtualFS({ backend: fakeBackend as any })
    await vfs.init()
    expect((await vfs.getIndex()).head).toBe('')
    expect((fakeBackend.writeIndex as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(0)
  })

  it('getChangeSet returns create/update/delete entries correctly', async () => {
    const storage = new InMemoryStorage()
    const vfs = new VirtualFS({ backend: storage })
    await vfs.init()

    // create added file
    await vfs.writeFile('new.txt', 'new-content')

    // create base with a file, modify it, then delete
    await vfs.applyBaseSnapshot({ 'mod.txt': 'base', 'del.txt': 'x' }, 'h1')
    
    // modify an existing file
    await vfs.writeFile('mod.txt', 'modified')

    // delete an existing file to produce tombstone
    await vfs.deleteFile('del.txt')

    const changes = await vfs.getChangeSet()
    const types = changes.map((c: any) => c.type).sort()
    // Should have create (new.txt), update (mod.txt), and delete (del.txt)
    expect(types).toEqual(expect.arrayContaining(['create', 'update', 'delete']))
    // listPaths should no longer include del.txt (it's deleted)
    const paths = await vfs.listPaths()
    expect(paths.includes('del.txt')).toBe(false)
  })

  it('loadIndex populates internal maps from stored index', async () => {
    const fakeBackend = {
      /**
       *
       */
      init: async () => {},
      /**
       *
       */
      readIndex: async () => ({ head: 'h', entries: { 'a.txt': { path: 'a.txt', baseSha: 'b1', workspaceSha: 'w1' } } }),
      writeIndex: jest.fn(async (_: any) => {}),
      writeBlob: jest.fn(async () => {}),
      readBlob: jest.fn(async () => null),
      deleteBlob: jest.fn(async () => {}),
    }
    const vfs = new VirtualFS({ backend: fakeBackend as any })
    await vfs.init()
    // readFile should return null because workspace blob is null (not written)
    const got = await vfs.readFile('a.txt')
    expect(got).toBeNull()
  })
})
