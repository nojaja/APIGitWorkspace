/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { GitHubAdapter } from '../../../../src/git/githubAdapter'

describe('GitHubAdapter cache simple test', () => {
  it('fetchSnapshot reuses blob content for duplicate SHAs', async () => {
    const adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    const originalFetch = (global as any).fetch
    let blobCalls = 0

    try {
      (global as any).fetch = async (url: string) => {
        const u = String(url)
        if (u.includes('/git/refs/heads/')) {
          return { ok: true, status: 200, json: async () => ({ object: { sha: 'commit-sha' } }), text: async () => '', headers: { get: () => null } } as any
        }
        if (u.includes('/git/commits/')) {
          return { ok: true, status: 200, json: async () => ({ tree: { sha: 'tree-sha' } }), text: async () => '', headers: { get: () => null } } as any
        }
        if (u.includes('/git/trees/')) {
          return { ok: true, status: 200, json: async () => ({ tree: [
            { path: 'a.txt', type: 'blob', sha: 'sha-1' },
            { path: 'b.txt', type: 'blob', sha: 'sha-2' },
            { path: 'c.txt', type: 'blob', sha: 'sha-1' }
          ] }), text: async () => '', headers: { get: () => null } } as any
        }
        if (u.includes('/git/blobs/sha-1')) {
          blobCalls++
          return { ok: true, status: 200, json: async () => ({ content: Buffer.from('one').toString('base64'), encoding: 'base64' }), text: async () => '', headers: { get: () => null } } as any
        }
        if (u.includes('/git/blobs/sha-2')) {
          blobCalls++
          return { ok: true, status: 200, json: async () => ({ content: Buffer.from('two').toString('base64'), encoding: 'base64' }), text: async () => '', headers: { get: () => null } } as any
        }
        return { ok: false, status: 404, text: async () => 'not found', headers: { get: () => null } } as any
      }

      const res = await adapter.fetchSnapshot('main')

      // first fetch: populate cache for all files
      const first = await res.fetchContent(['a.txt', 'b.txt', 'c.txt'])
      expect(first['a.txt']).toBe('one')
      expect(first['b.txt']).toBe('two')
      expect(first['c.txt']).toBe('one')

      // record blob calls and call again to exercise cache-hit early return
      const callsAfterFirst = blobCalls
      const second = await res.fetchContent(['a.txt', 'b.txt'])
      expect(second['a.txt']).toBe('one')
      expect(second['b.txt']).toBe('two')
      // blobCalls should not increase on cached hits
      expect(blobCalls).toBe(callsAfterFirst)
    } finally {
      (global as any).fetch = originalFetch
    }
  })
})
