/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import GitHubAdapter from '../../../../src/git/githubAdapter'

describe('GitHubAdapter.fetchContent duplicates and missing', () => {
  it('fetchContent handles duplicate and missing paths and fetches blob only once', async () => {
    const adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' } as any)
    let blobFetchCount = 0
    adapter['_fetchWithRetry'] = async (url: string) => {
      if (url.includes('/git/refs/heads/')) {
        return { json: async () => ({ object: { sha: 'headsha' } }) }
      }
      if (url.includes('/git/trees/')) {
        return { json: async () => ({ tree: [{ path: 'a.txt', type: 'blob', sha: 'blobsha1' }] }) }
      }
      if (url.includes('/git/blobs/blobsha1')) {
        blobFetchCount++
        return { json: async () => ({ content: 'YQ==', encoding: 'base64' }) }
      }
      return { json: async () => ({}) }
    }

    const snap = await adapter.fetchSnapshot('main', 5)
    const out = await snap.fetchContent(['a.txt', 'a.txt', 'missing.txt'])
    expect(out['a.txt']).toBe('a')
    expect(blobFetchCount).toBe(1)
    expect(out['missing.txt']).toBeUndefined()
  })
})
