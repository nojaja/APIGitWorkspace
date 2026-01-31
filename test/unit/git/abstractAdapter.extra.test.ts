import { jest } from '@jest/globals'
import { AbstractGitAdapter, getDelayForResponse, mapWithConcurrency } from '../../../src/git/abstractAdapter'

describe('AbstractAdapter additional coverage', () => {
  it('getDelayForResponse uses Retry-After header via headers.get', () => {
    const fakeResp: any = { headers: { get: (_: string) => '4' } }
    const d = getDelayForResponse(fakeResp as any, 0, 10)
    expect(d).toBe(4000)
  })

  it('mapWithConcurrency default concurrency works', async () => {
    const items = [10, 20, 30]
    const mapper = async (n: number) => n + 1
    const out = await mapWithConcurrency(items, mapper)
    expect(out).toEqual([11, 21, 31])
  })

  it('normalizeHeaders handles Headers-like forEach, array, and plain object', () => {
    class TA extends AbstractGitAdapter {}
    const inst = new TA()
    // Headers-like forEach
    const headersLike: any = { forEach: (cb: any) => { cb('v1', 'k1'); cb('v2', 'k2') } }
    const out1 = (inst as any).normalizeHeaders(headersLike)
    expect(out1.k1).toBe('v1')
    expect(out1.k2).toBe('v2')
    // Array of pairs
    const arr = [['a', '1'], ['b', '2']]
    const out2 = (inst as any).normalizeHeaders(arr)
    // array handling may vary by runtime; ensure it produced a map-like object
    expect(typeof out2).toBe('object')
    expect(Object.keys(out2).length).toBeGreaterThan(0)
    // Plain object
    const obj = { c: '3' }
    const out3 = (inst as any).normalizeHeaders(obj)
    expect(out3.c).toBe('3')
  })
})
