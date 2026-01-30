/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('InMemoryStorage extra branches', () => {
  it('writeBlob with unknown segment should reject with unknown segment error', async () => {
    const s = new InMemoryStorage()
    await expect(s.writeBlob('a.txt', 'content', 'bogus')).rejects.toThrow('unknown segment')
  })

  it('listFiles non-recursive filters nested keys', async () => {
    const s = new InMemoryStorage('testroot')
    // prepare workspace blobs
    await s.writeBlob('dir/a.txt', 'one', 'workspace')
    await s.writeBlob('dir/sub/b.txt', 'two', 'workspace')
    const resAll = await s.listFiles('dir', 'workspace', true)
    expect(resAll.map(r => r.path).sort()).toEqual(['dir/a.txt', 'dir/sub/b.txt'].sort())
    const resNonRec = await s.listFiles('dir', 'workspace', false)
    expect(resNonRec.map(r => r.path)).toEqual(['dir/a.txt'])
  })

  it('writeBlob to info with invalid json stores raw text', async () => {
    const s = new InMemoryStorage('infotest')
    // write to info segment raw text
    await s.writeBlob('x.txt', 'not-json-@@', 'info')
    const info = await s.readBlob('x.txt', 'info')
    expect(info).toBe('not-json-@@')
  })
})
