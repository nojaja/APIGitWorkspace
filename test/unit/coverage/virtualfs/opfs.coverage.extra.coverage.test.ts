/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */

import { jest } from '@jest/globals'
import OpfsStorage from '../../../../src/virtualfs/opfsStorage'

// Minimal in-memory OPFS-like root to exercise traversal and file operations
function makeOpfsRoot() {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  dirs.add('')

  function pathJoin(parts: string[]) { return parts.filter(Boolean).join('/') }

  function makeDirHandle(dirPath: string) {
    const handle: any = {}

    handle.getDirectoryHandle = async (name: string, opts?: any) => {
      const p = pathJoin([dirPath, name])
      dirs.add(p)
      return makeDirHandle(p)
    }

    handle.getDirectory = async (name: string, opts?: any) => handle.getDirectoryHandle(name, opts)

    handle.getFileHandle = async (name: string, opts?: any) => {
      const p = pathJoin([dirPath, name])
      if (!files.has(p) && !(opts && opts.create)) {
        const e: any = new Error('not found')
        e.name = 'NotFound'
        throw e
      }
      if (opts && opts.create) files.set(p, files.get(p) ?? '')
      const fh: any = {
        getFile: async () => ({ text: async () => files.get(p) }),
        createWritable: async () => ({ write: async (c: string) => files.set(p, String(c)), close: async () => {} }),
        remove: async () => { files.delete(p) }
      }
      return fh
    }

    handle.removeEntry = async (name: string) => {
      const p = pathJoin([dirPath, name])
      if (files.has(p)) files.delete(p)
      else {
        // remove directory by clearing entries prefixed
        for (const k of Array.from(files.keys())) if (k.startsWith(p + '/')) files.delete(k)
      }
    }

    handle.entries = async function* () {
      // yield direct children (files and directories)
      const prefix = dirPath ? dirPath + '/' : ''
      const seen = new Set<string>()
      for (const k of Array.from(files.keys())) {
        if (!k.startsWith(prefix)) continue
        const rest = k.slice(prefix.length)
        const name = rest.split('/')[0]
        if (seen.has(name)) continue
        seen.add(name)
        const childPath = prefix + name
        if (files.has(childPath)) {
          yield [name, { kind: 'file', getFile: async () => ({ text: async () => files.get(childPath) }) }]
        } else {
          yield [name, makeDirHandle(childPath)]
        }
      }
    }

    handle.keys = async function* () {
      const prefix = dirPath ? dirPath + '/' : ''
      const seen = new Set<string>()
      for (const k of Array.from(files.keys())) {
        if (!k.startsWith(prefix)) continue
        const rest = k.slice(prefix.length)
        const name = rest.split('/')[0]
        if (seen.has(name)) continue
        seen.add(name)
        yield name
      }
    }

    return handle
  }

  const root = makeDirHandle('')
  return { root, files }
}

describe('OpfsStorage extra coverage', () => {
  afterEach(() => { jest.clearAllMocks(); delete (globalThis as any).navigator; delete (globalThis as any).originPrivateFileSystem })

  it('write/read/delete and listFiles via entries iterator', async () => {
    const { root, files } = makeOpfsRoot()
    // make navigator.storage.getDirectory available
    ;(globalThis as any).navigator = { storage: { getDirectory: async () => root } }

    const s = new OpfsStorage('apigit_storage')
    await s.init()

    // write blobs under workspace and base
    await s.writeBlob('foo.txt', 'foo', 'workspace')
    await s.writeBlob('bar/baz.txt', 'baz', 'base')

    // read back
    const w = await s.readBlob('foo.txt', 'workspace')
    expect(w).toBe('foo')
    const b = await s.readBlob('bar/baz.txt', 'base')
    expect(b).toBe('baz')

    // list files under workspace (should include foo.txt)
    const list = await s.listFiles('', 'workspace', true)
    expect(list.map(x => x.path)).toEqual(expect.arrayContaining(['foo.txt']))

    // delete and ensure removed
    await s.deleteBlob('foo.txt', 'workspace')
    expect(await s.readBlob('foo.txt', 'workspace')).toBeNull()
  })

  it('readIndex handles malformed info entries and writeIndex persists meta', async () => {
    const { root, files } = makeOpfsRoot()
    ;(globalThis as any).navigator = { storage: { getDirectory: async () => root } }

    const s = new OpfsStorage('apigit_storage')
    await s.init()

    // write malformed info entry directly via file handle
    // use writeBlob to write an info file
    await s.writeBlob('bad.json', 'not-json', 'info')

    // write index metadata with an entry referencing a valid info
    const idx = { head: 'h', entries: { 'good.json': { path: 'good.json' } }, lastCommitKey: 'k' }
    await s.writeIndex(idx)

    const read = await s.readIndex()
    // malformed 'bad.json' should be ignored; good.json should appear
    expect(read).not.toBeNull()
    expect((read as any).entries['good.json']).toBeDefined()
  })
})
