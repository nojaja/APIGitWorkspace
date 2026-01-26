import { jest } from '@jest/globals'
import VirtualFS from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS#getRemoteDiffs', () => {
  it('returns added when index has no entry', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })

    // provide descriptor directly to avoid touching internals
    const descriptor = { headSha: 'h', shas: { 'a.txt': 'shaA' }, fetchContent: async () => ({}) }
    // stub getIndex to return empty index
    vfs.getIndex = async () => ({ head: '', entries: {} }) as any

    const res = await vfs.getRemoteDiffs(descriptor as any)
    expect(res.diffs).toEqual(['added: a.txt'])
  })

  it('returns updated when baseSha differs', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    const descriptor = { headSha: 'h', shas: { 'a.txt': 'shaNew' }, fetchContent: async () => ({}) }
    vfs.getIndex = async () => ({ head: '', entries: { 'a.txt': { baseSha: 'shaOld' } } }) as any

    const res = await vfs.getRemoteDiffs(descriptor as any)
    expect(res.diffs).toEqual(['updated: a.txt'])
  })

  it('handles missing index (getIndex throws) and returns empty diffs', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    const descriptor = { headSha: 'h', shas: { 'a.txt': 'shaA' }, fetchContent: async () => ({}) }
    vfs.getIndex = async () => { throw new Error('no index') }

    const res = await vfs.getRemoteDiffs(descriptor as any)
    expect(res.diffs).toEqual([])
    expect(res.remoteShas['a.txt']).toBe('shaA')
  })
})
