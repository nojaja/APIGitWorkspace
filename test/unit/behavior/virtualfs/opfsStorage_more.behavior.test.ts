/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import OpfsStorage from '../../../../src/virtualfs/opfsStorage'

describe('OpfsStorage static and helpers', () => {
  afterEach(() => {
    // cleanup any global navigator/originPrivateFileSystem
    delete (globalThis as any).navigator
    delete (globalThis as any).originPrivateFileSystem
  })

  it('canUse detects navigator.storage.getDirectory', () => {
    (globalThis as any).navigator = { storage: { getDirectory: () => {} } }
    expect((OpfsStorage as any).canUse()).toBe(true)
  })

  it('canUse detects originPrivateFileSystem', () => {
    (globalThis as any).originPrivateFileSystem = { getDirectory: () => {} }
    expect((OpfsStorage as any).canUse()).toBe(true)
  })

  it('_extractHandleName and _isDirectoryHandle work', async () => {
    const fakeHandle = { name: 'foo', kind: 'directory' }
    const n = (OpfsStorage as any)._extractHandleName(fakeHandle)
    expect(n).toBe('foo')
    expect((OpfsStorage as any)._isDirectoryHandle(fakeHandle)).toBe(true)
    expect((OpfsStorage as any)._isDirectoryHandle({ getDirectory: () => {} })).toBe(true)
    expect((OpfsStorage as any)._isDirectoryHandle({})).toBe(false)
  })

  it('_collectDirectoryNames iterates values()', async () => {
    const items = [ { name: 'a', kind: 'directory' }, { name: 'b', kind: 'file' } ]
    const root = { values: async function* () { yield items[0]; yield items[1]; } }
    const names = await (OpfsStorage as any)._collectDirectoryNames(root)
    expect(Array.isArray(names)).toBe(true)
    expect(names).toContain('a')
    expect(names).not.toContain('b')
  })

  it('_collectInfoForKeys calls readFromPrefix for each key', async () => {
    const opfs = new (OpfsStorage as any)('r')
    // stub readFromPrefix
    let calls = 0
    opfs.readFromPrefix = async (_root: any, _p: any, key: string) => {
      calls++
      return `val:${key}`
    }
    const out = await opfs._collectInfoForKeys({}, ['x', 'y'])
    expect(calls).toBe(2)
    expect(out.find((o: any) => o.path === 'x').info).toBe('val:x')
  })

  it('_filterKeys filters and respects recursive flag', () => {
    const opfs = new (OpfsStorage as any)('r')
    const keys = ['a', 'a/b', 'a/b/c', 'd']
    const full = opfs._filterKeys(keys, 'a', true)
    expect(full).toEqual(expect.arrayContaining(['a','a/b','a/b/c']))
    const nonrec = opfs._filterKeys(keys, 'a', false)
    expect(nonrec).toEqual(expect.arrayContaining(['a','a/b']))
    expect(nonrec).not.toEqual(expect.arrayContaining(['a/b/c']))
  })

  it('tryRemoveFileHandle returns true when fh.remove exists', async () => {
    const opfs = new (OpfsStorage as any)('r')
    const dir = { getFileHandle: async (n: any) => ({ remove: async () => {} }) }
    const ok = await opfs.tryRemoveFileHandle(dir, 'z')
    expect(ok).toBe(true)
  })

  it('tryRemoveFileHandle returns false on exceptions', async () => {
    const opfs = new (OpfsStorage as any)('r')
    const dir = { getFileHandle: async () => { throw new Error('nope') } }
    const ok = await opfs.tryRemoveFileHandle(dir, 'z')
    expect(ok).toBe(false)
  })
})
