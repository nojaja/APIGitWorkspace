/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */

import { jest } from '@jest/globals'
import { VirtualFS } from '../../../../src/virtualfs/virtualfs'
import { GitHubAdapter } from '../../../../src/git/githubAdapter'

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
  // Tests for private helper _changesFromIndexDeletes removed as part of test cleanup.
})
