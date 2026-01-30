/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { GitHubAdapter } from '../../../../src/git/githubAdapter'

describe('GitHubAdapter createBlobs cache', () => {
  it('reuses cached blob sha for identical content when run sequentially', async () => {
    const adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    let calls = 0
    ;(adapter as any)._fetchWithRetry = async () => {
      calls++
      return { json: async () => ({ sha: 'blob-sha' }) } as any
    }

    const changes = [
      { type: 'create', path: 'a.txt', content: 'same' },
      { type: 'create', path: 'b.txt', content: 'same' }
    ]

    const map = await adapter.createBlobs(changes, 1)
    expect(map['a.txt']).toBe('blob-sha')
    expect(map['b.txt']).toBe('blob-sha')
    // should have called network only once due to cache reuse
    expect(calls).toBe(1)
  })
})
