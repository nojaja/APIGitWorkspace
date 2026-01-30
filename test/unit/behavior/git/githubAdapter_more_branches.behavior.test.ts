/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import GitHubAdapter from '../../../../src/git/githubAdapter'

describe('GitHubAdapter remaining branches', () => {
  it('createBlobs uses blobCache early-return and avoids network', async () => {
    const a: any = new GitHubAdapter({ baseUrl: 'http://x', headers: {} })
    // stub shaOf to a known value and populate blobCache
    const fakeSha = 'deadbeef'
    a.shaOf = jest.fn().mockResolvedValue(fakeSha)
    a.blobCache.set(fakeSha, 'cached-sha')
    // make _fetchWithRetry fail if called
    a._fetchWithRetry = jest.fn(() => { throw new Error('should not be called') })

    const res = await a.createBlobs([{ type: 'create', path: 'p', content: 'c' }])
    expect(res.p).toBe('cached-sha')
  })

  it('fetchSnapshot uses reference.sha fallback when object missing', async () => {
    const a: any = new GitHubAdapter({ baseUrl: 'http://x', headers: {} })
    // Prepare responses for refs and trees
    const refResp = { json: async () => ({ sha: 'HEAD-SHA' }) }
    const treeResp = { json: async () => ({ tree: [{ path: 'a.txt', type: 'blob', sha: 'S1' }] }) }
    a._fetchWithRetry = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/git/refs/heads/')) return refResp
      if (url.includes('/git/trees/')) return treeResp
      return { json: async () => ({}) }
    })

    const snap = await a.fetchSnapshot('main')
    expect(snap.headSha).toBe('HEAD-SHA')
    // fetchContent should return content map (empty because blob fetch not stubbed)
    const out = await snap.fetchContent(['a.txt'])
    expect(typeof out).toBe('object')
  })

  it('getBlob decodes base64 content', async () => {
    const a: any = new GitHubAdapter({ baseUrl: 'http://x', headers: {} })
    // ensure global atob exists
    if (typeof (global as any).atob === 'undefined') {
      (global as any).atob = (s: string) => Buffer.from(s, 'base64').toString('binary')
    }
    a._fetchWithRetry = jest.fn().mockResolvedValue({ json: async () => ({ content: Buffer.from('hello').toString('base64'), encoding: 'base64' }) })
    const r = await a.getBlob('S')
    expect(r.encoding).toBe('base64')
    expect(r.content).toBe('hello')
  })

  it('updateRef throws on non-ok response and includes text', async () => {
    const a: any = new GitHubAdapter({ baseUrl: 'http://x', headers: {} })
    a._fetchWithRetry = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })
    await expect(a.updateRef('heads/main', 'S', false)).rejects.toThrow('updateRef failed: 500 boom')
  })

  it('fetchContent caches results and avoids repeated blob fetches', async () => {
    const a: any = new GitHubAdapter({ baseUrl: 'http://x', headers: {} })
    const refResp = { json: async () => ({ sha: 'H' }) }
    const treeResp = { json: async () => ({ tree: [{ path: 'a.txt', type: 'blob', sha: 'S1' }] }) }
    a._fetchWithRetry = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/git/refs/heads/')) return refResp
      if (url.includes('/git/trees/')) return treeResp
      return { json: async () => ({}) }
    })

    const snap = await a.fetchSnapshot('main')
    // stub the internal blob fetch helper to simulate one network fetch
    a._fetchBlobContentOrNull = jest.fn().mockResolvedValue({ path: 'a.txt', content: 'XYZ' })

    const first = await snap.fetchContent(['a.txt'])
    expect(first['a.txt']).toBe('XYZ')

    const second = await snap.fetchContent(['a.txt'])
    expect(second['a.txt']).toBe('XYZ')
    // internal helper should have been called only once due to cache
    expect(a._fetchBlobContentOrNull).toHaveBeenCalledTimes(1)
  })
})
