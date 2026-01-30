/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

﻿import { getDelayForResponse, mapWithConcurrency } from '../../../../src/git/githubAdapter'
import GitHubAdapter from '../../../../src/git/githubAdapter'

// shim atob for Node test environment
(global as any).atob = (s: string) => Buffer.from(s, 'base64').toString('utf8')

describe('GitHubAdapter - table-driven branch tests (trimmed)', () => {
  it.each([
    { idx: 0, base: 100 },
    { idx: 2, base: 50 }
  ])('getDelayForResponse with null response returns in range (index=%s)', ({ idx, base }) => {
    const d = getDelayForResponse(null as any, idx, base)
    const min = base * Math.pow(2, idx)
    expect(d).toBeGreaterThanOrEqual(min)
    expect(d).toBeLessThanOrEqual(min + 100)
  })

  it.each([1, 2, 10])('mapWithConcurrency returns mapped array with concurrency=%i', async (concurrency) => {
    const items = [1, 2, 3, 4]
    const mapper = async (n: number) => {
      await new Promise((r) => setTimeout(r, 1))
      return n * 2
    }
    const res = await mapWithConcurrency(items, mapper as any, concurrency)
    expect(res).toEqual([2, 4, 6, 8])
  })

  it('private _fetchContentFromMap returns cached content when contentCache prepopulated', async () => {
    const a = new (GitHubAdapter as any)({ owner: 'o', repo: 'r', token: 't' })
    // prepare fileMap and cache
    const fileMap = new Map()
    fileMap.set('a.txt', { path: 'a.txt', sha: 's1' })
    const contentCache = new Map<string, string>()
    contentCache.set('a.txt', 'cached')
    const snapshot: Record<string, string> = {}
    const out = await (a as any)._fetchContentFromMap(fileMap, contentCache, snapshot, ['a.txt'], 2)
    expect(out).toEqual({ 'a.txt': 'cached' })
    expect(snapshot['a.txt']).toBe('cached')
  })

})

export {}
