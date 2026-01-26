import InMemoryStorage from '../../../src/virtualfs/inmemoryStorage'

describe('InMemoryStorage', () => {
  it('canUse static returns true and availableRoots returns keys', () => {
    expect((InMemoryStorage as any).canUse()).toBe(true)
    const roots = (InMemoryStorage as any).availableRoots()
    expect(Array.isArray(roots)).toBe(true)
  })

  it('writeBlob/readBlob across segments and info behavior', async () => {
    const s = new (InMemoryStorage as any)('store1')
    await s.writeBlob('f1', 'w', 'workspace')
    expect(await s.readBlob('f1', 'workspace')).toBe('w')
    await s.writeBlob('f1', 'b', 'base')
    expect(await s.readBlob('f1', 'base')).toBe('b')
    await s.writeBlob('f1', 'c', 'conflict')
    expect(await s.readBlob('f1', 'conflict')).toBe('c')
    // info should be set when writing to workspace/base/conflict
    expect(await s.readBlob('f1', 'info')).not.toBeNull()
  })

  it('readBlob without segment falls back workspace->base', async () => {
    const s = new (InMemoryStorage as any)('store2')
    await s.writeBlob('x', 'baseonly', 'base')
    expect(await s.readBlob('x')).toBe('baseonly')
    await s.writeBlob('x', 'ws', 'workspace')
    expect(await s.readBlob('x')).toBe('ws')
  })

  it('deleteBlob deletes by segment and all when omitted', async () => {
    const s = new (InMemoryStorage as any)('store3')
    await s.writeBlob('d', 'v', 'workspace')
    await s.writeBlob('d', 'v', 'base')
    await s.writeBlob('d', 'v', 'info')
    await s.deleteBlob('d', 'workspace')
    expect(await s.readBlob('d', 'workspace')).toBeNull()
    await s.deleteBlob('d')
    expect(await s.readBlob('d', 'base')).toBeNull()
    expect(await s.readBlob('d', 'info')).toBeNull()
  })

  it('listFiles respects prefix and recursion flag', async () => {
    const s = new (InMemoryStorage as any)('store4')
    await s.writeBlob('dir/a.txt', '1', 'workspace')
    await s.writeBlob('dir/sub/b.txt', '2', 'workspace')
    const all = await s.listFiles('dir', 'workspace', true)
    expect(all.map((it: any) => it.path).sort()).toEqual(['dir/sub/b.txt','dir/a.txt'].sort())
    const top = await s.listFiles('dir', 'workspace', false)
    expect(top.map((it: any) => it.path)).toEqual(['dir/a.txt'])
  })

  it('listFiles returns empty for unknown segment', async () => {
    const s = new (InMemoryStorage as any)('store5')
    const res = await s.listFiles('x', 'unknown', true)
    expect(res).toEqual([])
  })
})
