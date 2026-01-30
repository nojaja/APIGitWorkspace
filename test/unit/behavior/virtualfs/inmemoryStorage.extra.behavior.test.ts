/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'
import { updateInfoForWrite } from '../../../../src/virtualfs/metadataManager'

describe('InMemoryStorage extra branches', () => {
  beforeEach(() => {
    // nothing
  })

  it('listFiles respects non-recursive flag', async () => {
    const root = `testroot_${Math.random().toString(36).slice(2)}`
    const s = new InMemoryStorage(root)
    await s.writeBlob('dir/file1.txt', 'c1', 'workspace')
    await s.writeBlob('dir/sub/file2.txt', 'c2', 'workspace')
    const listRec = await s.listFiles('dir', 'workspace', true)
    expect(listRec.map((x) => x.path).sort()).toEqual(['dir/file1.txt', 'dir/sub/file2.txt'].sort())
    const listNonRec = await s.listFiles('dir', 'workspace', false)
    expect(listNonRec.map((x) => x.path).sort()).toEqual(['dir/file1.txt'].sort())
  })

  it('readBlob returns null for unknown segment', async () => {
    const s = new InMemoryStorage()
    await s.writeBlob('a.txt', 'hello', 'workspace')
    const res = await s.readBlob('a.txt', 'noneseg')
    expect(res).toBeNull()
  })

  it('delete throws for missing root', () => {
    expect(() => InMemoryStorage.delete('__this_root_does_not_exist__')).toThrow()
  })

  it('writeBlob rejects for unknown segment', async () => {
    const s = new InMemoryStorage()
    await expect(s.writeBlob('x.txt', 'v', 'unknown-seg')).rejects.toThrow('unknown segment')
  })

  it('updateInfoForWrite handles unknown segment fallback', async () => {
    const store: any = { infoBlobs: new Map() }
    await updateInfoForWrite(store, 'p.txt', 'meta', 'content')
    expect(store.infoBlobs.has('p.txt')).toBeTruthy()
    const txt = store.infoBlobs.get('p.txt')
    const obj = JSON.parse(txt)
    expect(obj.path).toBe('p.txt')
    expect(typeof obj.updatedAt).toBe('number')
  })
})
