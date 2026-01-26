import { VirtualFS } from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'
import { shaOf } from '../../../src/virtualfs/hashUtils'

describe('VirtualFS additional branch tests', () => {
  let backend: any
  let vfs: any

  beforeEach(async () => {
    backend = new (InMemoryStorage as any)('branch-more')
    vfs = new VirtualFS({ backend })
    await vfs.init()
  })

  it('_normalizeRemoteInput returns descriptor when string input', async () => {
    const snapshot = { 'x.txt': 'abc' }
    const res = await (vfs as any)._normalizeRemoteInput('HEAD', snapshot)
    expect(res.headSha).toBe('HEAD')
    expect(res.shas['x.txt']).toBeDefined()
    const fetched = await res.fetchContent(['x.txt', 'no.txt'])
    expect(fetched['x.txt']).toBe('abc')
    expect(fetched['no.txt']).toBeUndefined()
  })

  it('_computeRemoteShas computes shas for snapshot', async () => {
    const snapshot = { 'a': '1', 'b': '22' }
    const res = await (vfs as any)._computeRemoteShas(snapshot)
    expect(Object.keys(res).sort()).toEqual(['a', 'b'])
    expect(res['a']).toBeDefined()
  })

  it('_computeToAddOrUpdate identifies missing or changed entries', async () => {
    const p1 = 'p1'
    const p2 = 'p2'
    const snapshot: Record<string,string> = {}
    snapshot[p1] = 'one'
    snapshot[p2] = 'two'
    const shas: Record<string,string> = {}
    shas[p1] = await shaOf(snapshot[p1])
    shas[p2] = await shaOf(snapshot[p2])

    // create info for p1 with matching baseSha -> should be skipped
    await backend.writeBlob(p1, JSON.stringify({ path: p1, baseSha: shas[p1], state: 'base' }), 'info')
    // no info for p2 -> should be included

    const out = await (vfs as any)._computeToAddOrUpdate(snapshot, shas)
    expect(out).toContain(p2)
    expect(out).not.toContain(p1)
  })

  it('_computeToRemove finds entries not present in snapshot', async () => {
    // info entries: keep a, remove b
    await backend.writeBlob('a', JSON.stringify({ path: 'a', baseSha: 's' }), 'info')
    await backend.writeBlob('b', JSON.stringify({ path: 'b', baseSha: 's' }), 'info')
    const snapshot: Record<string,string> = { a: 'v' }
    const out = await (vfs as any)._computeToRemove(snapshot)
    expect(out).toContain('b')
    expect(out).not.toContain('a')
  })

  it('_applyAddsOrUpdates writes new entries and updates existing base entries', async () => {
    const pNew = 'newfile'
    const pExist = 'existfile'
    const contentNew = 'hello'
    const contentExist = 'world'
    const shaExist = await shaOf(contentExist)
    // pre-create existing entry with state base
    await backend.writeBlob(pExist, JSON.stringify({ path: pExist, baseSha: 'old', state: 'base' }), 'info')

    const toAdd = [pNew, pExist]
    const snapshot: Record<string,string> = { [pNew]: contentNew, [pExist]: contentExist }
    const newShas = {}
    newShas[pNew] = await shaOf(contentNew)
    newShas[pExist] = shaExist

    await (vfs as any)._applyAddsOrUpdates(toAdd, snapshot, newShas)

    // new file should exist in base and info
    expect(await backend.readBlob(pNew, 'base')).toBe(contentNew)
    const infoNew = JSON.parse(await backend.readBlob(pNew, 'info'))
    expect(infoNew.baseSha).toBe(newShas[pNew])

    // existing file should have updated baseSha and base content
    expect(await backend.readBlob(pExist, 'base')).toBe(contentExist)
    const infoExist = JSON.parse(await backend.readBlob(pExist, 'info'))
    expect(infoExist.baseSha).toBe(newShas[pExist])
  })

  it('_applyRemovals removes blobs and info for base entries', async () => {
    const p = 'toremove'
    await backend.writeBlob(p, JSON.stringify({ path: p, state: 'base', baseSha: 's' }), 'info')
    await backend.writeBlob(p, 'content', 'base')
    await (vfs as any)._applyRemovals([p])
    expect(await backend.readBlob(p, 'info')).toBeNull()
    expect(await backend.readBlob(p, 'base')).toBeNull()
  })

  it('_isNonFastForwardError detects various messages', () => {
    const fn = (vfs as any)._isNonFastForwardError.bind(vfs)
    expect(fn(new Error('422 Unprocessable Entity'))).toBe(true)
    expect(fn('not a fast forward')).toBe(true)
    expect(fn(new Error('Some other error'))).toBe(false)
  })
})
