/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import GitHubAdapter, { RetryableError, NonRetryableError } from '../../../../src/git/githubAdapter'

beforeEach(() => {
  jest.clearAllMocks()
  // @ts-ignore
  global.fetch = undefined
})

describe('GitHubAdapter basic flows', () => {
  it('createBlobs returns map of path->sha', async () => {
    const adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    const changes = [
      { type: 'create', path: 'a.txt', content: 'a' },
      { type: 'update', path: 'b.txt', content: 'b' },
    ]

    const fetchMock = jest.fn()
    // each call returns a Response-like object with json
    fetchMock.mockResolvedValue({ ok: true, /** @returns {Promise<{sha:string}>} */ json: async () => ({ sha: 'sha1' }) })
    // @ts-ignore
    global.fetch = fetchMock

    const res = await adapter.createBlobs(changes, 2)
    expect(res['a.txt']).toBe('sha1')
    expect(res['b.txt']).toBe('sha1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('createTree throws when blobSha missing', async () => {
    const adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    await expect(adapter.createTree([{ type: 'create', path: 'x' }])).rejects.toThrow(NonRetryableError)
  })

  it('createTree returns sha on success', async () => {
    const adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    const fetchMock = jest.fn()
    fetchMock.mockResolvedValue({ ok: true, /** @returns {Promise<{sha:string}>} */ json: async () => ({ sha: 'treesha' }) })
    // @ts-ignore
    global.fetch = fetchMock

    const sha = await adapter.createTree([{ type: 'create', path: 'x', blobSha: 'b' }])
    expect(sha).toBe('treesha')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('createCommit retries on 500 and succeeds', async () => {
    const adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    const fetchMock = jest.fn()
    // first two responses are 500, third is ok
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, headers: { /** @returns {null} */ get: () => null }, /** @returns {Promise<string>} */ text: async () => 'err' })
      .mockResolvedValueOnce({ ok: false, status: 500, headers: { /** @returns {null} */ get: () => null }, /** @returns {Promise<string>} */ text: async () => 'err' })
      .mockResolvedValueOnce({ ok: true, /** @returns {Promise<{sha:string}>} */ json: async () => ({ sha: 'commitsha' }) })
    // @ts-ignore
    global.fetch = fetchMock

    const sha = await adapter.createCommit('msg', 'parentsha', 'treesha')
    expect(sha).toBe('commitsha')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('updateRef throws NonRetryableError on bad request', async () => {
    const adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    const fetchMock = jest.fn()
    fetchMock.mockResolvedValue({ ok: false, status: 400, /** @returns {Promise<string>} */ text: async () => 'bad' })
    // @ts-ignore
    global.fetch = fetchMock

    await expect(adapter.updateRef('heads/main', 'sha', false)).rejects.toThrow(NonRetryableError)
  })
})
