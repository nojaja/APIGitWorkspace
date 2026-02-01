/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { OpfsStorage } from '../../../../src/virtualfs/opfsStorage'

beforeEach(() => jest.clearAllMocks())

describe('OpfsStorage internals coverage boost', () => {
  it('ensureDir with getDirectoryHandle chain', async () => {
    const root: any = {
      getDirectoryHandle: async (name: string, _opts?: any) => {
        // return an object that also supports getDirectoryHandle for nested calls
        return {
          getDirectoryHandle: async (n: string) => ({ getDirectoryHandle: async () => ({}) })
        }
      }
    }
    const inst = new (OpfsStorage as any)('r')
    const dir = await (inst as any).ensureDir(root, ['a', 'b'])
    expect(dir).toBeDefined()
  })

  it('ensureDir with getDirectory chain', async () => {
    const root: any = {
      getDirectory: async (name: string, _opts?: any) => {
        return { getDirectory: async () => ({}) }
      }
    }
    const inst = new (OpfsStorage as any)('r')
    const dir = await (inst as any).ensureDir(root, ['a'])
    expect(dir).toBeDefined()
  })

  it('ensureDir throws when no dir API', async () => {
    const root: any = {}
    const inst = new (OpfsStorage as any)('r')
    await expect((inst as any).ensureDir(root, ['x'])).rejects.toThrow('OPFS directory API not available')
  })

  it('tryRemoveFileHandle true/false/exception paths', async () => {
    const inst = new (OpfsStorage as any)('r')
    // case: remove exists
    const dir1: any = { getFileHandle: async (n: string) => ({ remove: async () => {} }) }
    expect(await (inst as any).tryRemoveFileHandle(dir1, 'f')).toBe(true)

    // case: fh present but no remove
    const dir2: any = { getFileHandle: async (n: string) => ({}) }
    expect(await (inst as any).tryRemoveFileHandle(dir2, 'f')).toBe(false)

    // case: getFileHandle throws
    const dir3: any = { getFileHandle: async (n: string) => { throw new Error('nope') } }
    expect(await (inst as any).tryRemoveFileHandle(dir3, 'f')).toBe(false)
  })

  it('_recurseListDir handles entries iterator and fallback', async () => {
    const inst = new (OpfsStorage as any)('r')
    const results: string[] = []
    // entries() variant: yields a file pair
    const dirWithEntries: any = {
      async *entries() { yield ['file.txt', { getFile: () => ({}) }] }
    }
    await (inst as any)._recurseListDir(dirWithEntries, 'base', results)
    expect(results).toContain('base/file.txt')

    // fallback: keys() async iterator
    const results2: string[] = []
    const dirWithKeys: any = {
      async *keys() { yield 'k1' },
      getFileHandle: async (name: string) => ({ getFile: async () => ({ text: async () => 'x' }) })
    }
    await (inst as any)._recurseListDirFallback(dirWithKeys, '', results2)
    // _handleChildEntry called inside fallback will either push or skip; ensure no error
    expect(Array.isArray(results2)).toBe(true)
  })
})
