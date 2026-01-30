/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { VirtualFS } from '../../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS push-related branches', () => {
  let backend: any
  let vfs: any

  beforeEach(async () => {
    backend = new (InMemoryStorage as any)('push-tests')
    vfs = new VirtualFS({ backend })
    await vfs.init()
  })

  it('_tryUpdateRef throws on non-fast-forward error and warns on other errors', async () => {
    const adapter1 = {
      updateRef: async () => { throw new Error('422 Unprocessable') }
    }
    await expect((vfs as any)._tryUpdateRef(adapter1, 'main', 'c')).rejects.toThrow('非互換な更新')

    const warned: any[] = []
    const originalWarn = console.warn
    ;(console as any).warn = (msg: any) => { warned.push(msg) }
    const adapter2 = {
      updateRef: async () => { throw new Error('random failure') }
    }
    // should not throw, should warn
    await expect((vfs as any)._tryUpdateRef(adapter2, 'main', 'c')).resolves.toBeUndefined()
    if (warned.length === 0) throw new Error('expected console.warn to be called')
    (console as any).warn = originalWarn
  })

  it('_applyChangesAndFinalize applies changes and sets head', async () => {
    const input = { changes: [{ type: 'create', path: 'a', content: 'A' }, { type: 'delete', path: 'b', baseSha: 'b' }] }
    // create b so delete removes
    await backend.writeBlob('b', JSON.stringify({ path: 'b', baseSha: 'b' }), 'info')
    await backend.writeBlob('b', 'X', 'base')
    const res = await (vfs as any)._applyChangesAndFinalize('commit-123', input)
    expect(res.commitSha).toBe('commit-123')
    expect(await backend.readBlob('a', 'base')).toBe('A')
    expect(await backend.readBlob('b', 'base')).toBeNull()
    expect(vfs.head).toBe('commit-123')
  })

  it('_handlePushWithAdapter uses createCommitWithActions when available', async () => {
    const adapter = {
      createCommitWithActions: async (branch: string, message: string, changes: any[], parentSha: any) => 'commit-act',
      updateRef: async (_: string, __: string) => undefined
    }
    const input = { message: 'm', changes: [], parentSha: undefined, commitKey: 'k', ref: 'main' }
    const result = await (vfs as any)._handlePushWithAdapter(input, adapter)
    expect(result.commitSha).toBe('commit-act')
    expect(vfs.head).toBe('commit-act')
    expect(vfs.lastCommitKey).toBe('k')
  })

  it('_handlePushWithAdapter falls back to GitHub flow when createCommitWithActions absent', async () => {
    const adapter = {
      createBlobs: async (changes: any[]) => { const m: any = {}; return m },
      createTree: async (_changes: any[], _baseTree?: string) => 'tree-sha',
      createCommit: async (_message: string, _parent: any, _treeSha: string) => 'commit-g',
      updateRef: async (_: string, __: string) => undefined
    }
    const input = { message: 'm2', changes: [], parentSha: undefined, commitKey: 'k2', ref: 'main' }
    const result = await (vfs as any)._handlePushWithAdapter(input, adapter)
    expect(result.commitSha).toBe('commit-g')
    expect(vfs.head).toBe('commit-g')
    expect(vfs.lastCommitKey).toBe('k2')
  })
})
