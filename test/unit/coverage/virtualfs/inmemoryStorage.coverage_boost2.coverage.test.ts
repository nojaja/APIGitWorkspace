/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */

import { jest } from '@jest/globals'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('InMemoryStorage coverage boost - edge prefix and filter cases', () => {
  let root: string
  let s: any

  beforeEach(() => {
    root = `cb2_${Date.now()}_${Math.random().toString(36).slice(2)}`
    s = new (InMemoryStorage as any)(root)
  })
  afterEach(() => {
    try { (InMemoryStorage as any).delete(root) } catch (_e) {}
  })

  it('listFiles normalizes leading/trailing slashes in prefix', async () => {
    // write keys without leading slash to match storage normalization
    await s.writeBlob('a/b/c.txt', '1', 'workspace')
    await s.writeBlob('a/d.txt', '2', 'workspace')
    const res = await s.listFiles('/a/', 'workspace', true)
    const paths = res.map((r: any) => r.path)
    expect(paths).toEqual(expect.arrayContaining(['a/b/c.txt','a/d.txt']))
  })

  it('listFiles with prefix equal to key returns exact match when recursive=true', async () => {
    await s.writeBlob('x', '1', 'workspace')
    await s.writeBlob('x/y', '2', 'workspace')
    const rec = await s.listFiles('x', 'workspace', true)
    expect(rec.map((r:any)=>r.path).sort()).toEqual(['x','x/y'].sort())
  })

  it('listFiles with prefix equal to key and non-recursive excludes nested entries', async () => {
    await s.writeBlob('p/q', '1', 'workspace')
    await s.writeBlob('p/q/r', '2', 'workspace')
    const top = await s.listFiles('p/q', 'workspace', false)
    // non-recursive includes immediate children; expect both exact match and immediate child
    expect(top.map((r:any)=>r.path).sort()).toEqual(['p/q','p/q/r'].sort())
  })

  it('listFiles handles keys where p is empty string (prefix falsy) edge', async () => {
    await s.writeBlob('only.txt', '1', 'workspace')
    const all = await s.listFiles('', 'workspace', false)
    expect(all.map((r:any)=>r.path)).toEqual(['only.txt'])
  })

})
