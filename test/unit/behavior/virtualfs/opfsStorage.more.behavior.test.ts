/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { OpfsStorage } from '../../../../src/virtualfs/opfsStorage'

let __origNavigator: any = undefined
let __origOriginPrivateFileSystem: any = undefined

beforeEach(() => {
  if (typeof (globalThis as any).jest === 'object' && typeof (globalThis as any).jest.clearAllMocks === 'function') (globalThis as any).jest.clearAllMocks()
  // save and cleanup any globals to avoid cross-test pollution
  __origNavigator = (globalThis as any).navigator
  __origOriginPrivateFileSystem = (globalThis as any).originPrivateFileSystem
  if ('navigator' in globalThis) { delete (globalThis as any).navigator }
  if ('originPrivateFileSystem' in globalThis) { delete (globalThis as any).originPrivateFileSystem }
})

afterEach(() => {
  // restore originals
  if (typeof __origNavigator !== 'undefined') {
    (globalThis as any).navigator = __origNavigator
  } else {
    if ('navigator' in globalThis) delete (globalThis as any).navigator
  }
  if (typeof __origOriginPrivateFileSystem !== 'undefined') {
    (globalThis as any).originPrivateFileSystem = __origOriginPrivateFileSystem
  } else {
    if ('originPrivateFileSystem' in globalThis) delete (globalThis as any).originPrivateFileSystem
  }
  __origNavigator = undefined
  __origOriginPrivateFileSystem = undefined
})

describe('OpfsStorage additional branches', () => {
  it('readIndex/writeIndex when no OPFS returns/null or throws', async () => {
    const s = new OpfsStorage()
    // no navigator and no originPrivateFileSystem -> readIndex null
    const r = await s.readIndex()
    expect(r).toBeNull()
    await expect(s.writeIndex({ head: 'x', entries: {} } as any)).rejects.toThrow('OPFS not available')
  })

  it('writeIndex/readIndex success path', async () => {
    const files = new Map<string, string>()
    const root = {
      async getFileHandle(name: string, opts?: any) {
        const key = name
        return {
          async getFile() { return { async text() { return files.get(key) } } },
          async createWritable() {
            return {
              async write(content: string) { files.set(key, content) },
              async close() {}
            }
          }
        }
      }
    }
    ;(globalThis as any).navigator = { storage: { getDirectory: async () => root } }

    const s = new OpfsStorage()
    await s.writeIndex({ head: 'h', entries: {} } as any)
    const got = await s.readIndex()
    expect(got).not.toBeNull()
    expect(got!.head).toBe('h')
  })

  it('writeBlob/readBlob nested and single file paths', async () => {
    const allFiles = new Map<string, string>() // path -> content

    function makeDir(pathPrefix: string, map: Map<string, any>) {
      async function getDirectory(name: string, opts?: any) {
        if (!map.has(name)) map.set(name, makeDir(`${pathPrefix}/${name}`, new Map()))
        return map.get(name)
      }
      async function getFileHandle(name: string, opts?: any) {
        const fullKey = `${pathPrefix}/${name}`
        async function createWritable() { return { async write(content: string) { allFiles.set(fullKey, content) }, async close() {} } }
        async function getFile() { return { async text() { return allFiles.get(fullKey) } } }
        return { createWritable, getFile }
      }
      async function removeEntry(name: string) { map.delete(name); allFiles.delete(`${pathPrefix}/${name}`) }
      return { getDirectory, getFileHandle, removeEntry }
    }

    const root = makeDir('', new Map())
    ;(globalThis as any).navigator = { storage: { getDirectory: async () => root } }

    const s = new OpfsStorage()
    await s.writeBlob('a/b/c.txt', 'nested')
    expect(await s.readBlob('a/b/c.txt')).toBe('nested')

    await s.writeBlob('top.txt', 'top')
    expect(await s.readBlob('top.txt')).toBe('top')
  })

  it('deleteBlob uses removeEntry or file handle.remove', async () => {
    const allFiles2 = new Map<string, string>()

    function makeDirWithRemove(pathPrefix: string, map: Map<string, any>) {
      async function getDirectory(name: string, opts?: any) {
        if (!map.has(name)) map.set(name, makeDirWithRemove(`${pathPrefix}/${name}`, new Map()))
        return map.get(name)
      }
      async function getFileHandle(name: string, opts?: any) {
        const fullKey = `${pathPrefix}/${name}`
        async function createWritable() { return { async write(content: string) { allFiles2.set(fullKey, content) }, async close() {} } }
        async function getFile() { return { async text() { return allFiles2.get(fullKey) } } }
        return { createWritable, getFile, async remove() { allFiles2.delete(fullKey) } }
      }
      async function removeEntry(name: string) { map.delete(name); allFiles2.delete(`${pathPrefix}/${name}`) }
      return { getDirectory, getFileHandle, removeEntry }
    }

    const root = makeDirWithRemove('', new Map())
    ;(globalThis as any).navigator = { storage: { getDirectory: async () => root } }

    const s = new OpfsStorage()
    await s.writeBlob('d/r.txt', 'origin-content')
    expect(await s.readBlob('d/r.txt')).toBe('origin-content')
    await s.deleteBlob('d/r.txt')
    expect(await s.readBlob('d/r.txt')).toBeNull()
  })
})
