import { jest } from '@jest/globals'
import { VirtualFS } from '../../../src/virtualfs/virtualfs'
import { GitHubAdapter } from '../../../src/git/githubAdapter'

describe('VirtualFS coverage boost: adapter & index delete branches', () => {
  it('getAdapter returns cached adapterMeta when set', async () => {
    const vfs = new VirtualFS({})
    ;(vfs as any).adapterMeta = { test: 1 }
    const got = await vfs.getAdapter()
    expect(got).toEqual({ test: 1 })
  })

  it('getAdapterInstance returns null when no adapterMeta present', async () => {
    const vfs = new VirtualFS({})
    // provide indexManager that returns { adapter: null }
    ;(vfs as any).indexManager = { getIndex: jest.fn().mockResolvedValue({ adapter: null }) }
    ;(vfs as any).adapterMeta = null
    const inst = await vfs.getAdapterInstance()
    expect(inst).toBeNull()
  })

  it('getAdapterInstance returns null when adapterMeta.type is missing', async () => {
    const vfs = new VirtualFS({})
    ;(vfs as any).adapterMeta = { opts: {} }
    // ensure indexManager not used
    ;(vfs as any).indexManager = { getIndex: jest.fn() }
    const inst = await vfs.getAdapterInstance()
    expect(inst).toBeNull()
  })

  it('_instantiateAdapter returns GitHubAdapter for type github', () => {
    const vfs = new VirtualFS({})
    const created = (vfs as any)._instantiateAdapter('github', { owner: 'o', repo: 'r', token: 't' })
    expect(created).toBeInstanceOf(GitHubAdapter)
  })

  it('_changesFromIndexDeletes handles workspace present/null/throw cases', async () => {
    const vfs = new VirtualFS({})
    // mock index with three entries
    const index = {
      entries: {
        'keep.txt': { baseSha: 'a' },
        'del.txt': { baseSha: 'b' },
        'err.txt': { baseSha: 'c' },
      },
    }
    ;(vfs as any).indexManager = { getIndex: jest.fn().mockResolvedValue(index) }

    // backend.readBlob behaviour: keep.txt -> non-null, del.txt -> null, err.txt -> throw
    const readBlob = jest.fn(async (p: string) => {
      if (p === 'keep.txt') return 'content'
      if (p === 'del.txt') return null
      if (p === 'err.txt') throw new Error('boom')
      return null
    })
    ;(vfs as any).backend = { readBlob }

    const res = await (vfs as any)._changesFromIndexDeletes()
    // should only include del.txt
    expect(Array.isArray(res)).toBe(true)
    expect(res.find((r: any) => r.path === 'del.txt')).toBeTruthy()
    expect(res.find((r: any) => r.path === 'keep.txt')).toBeUndefined()
    expect(res.find((r: any) => r.path === 'err.txt')).toBeUndefined()
  })
})
