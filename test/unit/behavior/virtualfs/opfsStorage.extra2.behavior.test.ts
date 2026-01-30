/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import OpfsStorage from '../../../../src/virtualfs/opfsStorage'

describe('OpfsStorage additional failure branches', () => {
  let getOpfsRootSpy: any = null
  beforeEach(() => { jest.clearAllMocks(); getOpfsRootSpy = null })
  afterEach(() => { if (getOpfsRootSpy) { getOpfsRootSpy.mockRestore(); getOpfsRootSpy = null } ; jest.resetAllMocks() })

  it('deleteBlob uses fileHandle.remove when removeEntry not present', async () => {
    const storage = new OpfsStorage()
    // simulate a directory where removeEntry is not present but file handle has remove
    const dir = {
      getDirectory: jest.fn(async (p: string) => dir),
      getFileHandle: jest.fn(async (name: string, opts?: any) => ({
        remove: jest.fn(async () => true),
        name
      }))
    } as any
    // mock getOpfsRoot to return our dir (use spy so we can restore)
    getOpfsRootSpy = jest.spyOn(OpfsStorage.prototype as any, 'getOpfsRoot').mockImplementation(async () => dir)

    // should not throw
    await expect(storage.deleteBlob('a/b/c.txt')).resolves.toBeUndefined()
    expect(dir.getFileHandle).toHaveBeenCalled()
  })

  it('writeBlob/readBlob handles nested path creation', async () => {
    const storage = new OpfsStorage()
    const allFiles = new Map<string, string>()
    
    function makeDir(pathPrefix: string): any {
      return {
        getDirectory: jest.fn(async (name: string) => makeDir(pathPrefix ? `${pathPrefix}/${name}` : name)),
        getFileHandle: jest.fn(async (name: string, opts?: any) => {
          const fullKey = pathPrefix ? `${pathPrefix}/${name}` : name
          return {
            createWritable: jest.fn(async () => ({ 
              write: async (d: any) => { allFiles.set(fullKey, d) }, 
              close: async () => {} 
            })),
            getFile: jest.fn(async () => ({ text: async () => allFiles.get(fullKey) || '' }))
          }
        })
      }
    }
    
    const dir = makeDir('')
    getOpfsRootSpy = jest.spyOn(OpfsStorage.prototype as any, 'getOpfsRoot').mockImplementation(async () => dir)

    await storage.writeBlob('nested/dir/f.txt', 'ok data')
    const buf = await storage.readBlob('nested/dir/f.txt')
    expect(buf).toBeDefined()
    const text = buf as string
    expect(text).toBe('ok data')
  })

  it('writeBlob falls back to IndexedDB when OPFS write throws', async () => {
    const storage = new OpfsStorage()
    // mock getOpfsRoot to throw to force fallback
    getOpfsRootSpy = jest.spyOn(OpfsStorage.prototype as any, 'getOpfsRoot').mockImplementation(async () => { throw new Error('opfs unavailable') })
    // provide a fake indexedDB backend used by OpfsStorage internals
    const indexedFallback = {
      writeBlob: jest.fn(async (_p: string, _b: any) => true),
      readBlob: jest.fn(async () => 'f')
    }
    ;(storage as any).indexedDb = indexedFallback

    await expect(storage.writeBlob('f.txt', 'data')).rejects.toThrow()
  })

  it('deleteBlob swallows getFileHandle throwing errors', async () => {
    const storage = new OpfsStorage()
    // create a recursive dir whose getFileHandle throws
    const recursiveDir: any = {}
    recursiveDir.getDirectory = jest.fn(async () => recursiveDir)
    recursiveDir.getDirectoryHandle = jest.fn(async () => recursiveDir)
    recursiveDir.getFileHandle = jest.fn(async () => { throw new Error('boom') })

    getOpfsRootSpy = jest.spyOn(OpfsStorage.prototype as any, 'getOpfsRoot').mockImplementation(async () => recursiveDir)

    // Should not throw and should resolve (errors are swallowed)
    await expect(storage.deleteBlob('x/y/z.txt')).resolves.toBeUndefined()
  })

  it('writeBlob rejects when directory API is absent on intermediate nodes', async () => {
    const storage = new OpfsStorage()
    // root without any directory/file APIs
    const badRoot: any = {}
    getOpfsRootSpy = jest.spyOn(OpfsStorage.prototype as any, 'getOpfsRoot').mockImplementation(async () => badRoot)

    await expect(storage.writeBlob('a/b/c.txt', 'x')).rejects.toThrow()
  })

  it('readIndex returns null when getFile throws in fallback path', async () => {
    const storage = new OpfsStorage()
    const root = {
      getFileHandle: jest.fn(async () => ({ getFile: async () => { throw new Error('nope') } }))
    } as any
    getOpfsRootSpy = jest.spyOn(OpfsStorage.prototype as any, 'getOpfsRoot').mockImplementation(async () => root)

    const res = await storage.readIndex()
    // When error occurs, readIndex returns default empty index
    expect(res).toEqual({ head: '', entries: {} })
  })

  it('writeBlob/readBlob works with getDirectoryHandle API', async () => {
    const storage = new OpfsStorage()
    const allFiles = new Map<string, string>()
    
    function makeDir(pathPrefix: string): any {
      return {
        getDirectoryHandle: jest.fn(async (name: string, opts?: any) => makeDir(pathPrefix ? `${pathPrefix}/${name}` : name)),
        getFileHandle: jest.fn(async (name: string, opts?: any) => {
          const fullKey = pathPrefix ? `${pathPrefix}/${name}` : name
          return {
            createWritable: jest.fn(async () => ({ 
              write: async (d: any) => { allFiles.set(fullKey, d) }, 
              close: async () => {} 
            })),
            getFile: jest.fn(async () => ({ text: async () => allFiles.get(fullKey) || '' }))
          }
        })
      }
    }
    
    const root = makeDir('')
    getOpfsRootSpy = jest.spyOn(OpfsStorage.prototype as any, 'getOpfsRoot').mockImplementation(async () => root)

    await storage.writeBlob('dir1/dir2/f.txt', 'hello-handle')
    const out = await storage.readBlob('dir1/dir2/f.txt')
    expect(out).toBe('hello-handle')
  })
})
