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

describe('GitHubAdapter error branches', () => {
  it('createBlobs throws NonRetryableError when response missing sha', async () => {
    const adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    const fetchMock = jest.fn()
    fetchMock.mockResolvedValue({ ok: true, /** @returns {Promise<Record<string, unknown>>} */ json: async () => ({}) })
    // @ts-ignore
    global.fetch = fetchMock

    await expect(adapter.createBlobs([{ type: 'create', path: 'x', content: 'c' }])).rejects.toThrow(NonRetryableError)
  })

  it('createCommit throws RetryableError when network always fails', async () => {
    const adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    const fetchMock = jest.fn()
    fetchMock.mockRejectedValue(new Error('network'))
    // @ts-ignore
    global.fetch = fetchMock

    await expect(adapter.createCommit('m', 'p', 't')).rejects.toThrow(RetryableError)
  })

  it('updateRef retries on 500 and eventually succeeds', async () => {
    const adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    const fetchMock = jest.fn()
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, headers: { /** @returns {null} */ get: () => null }, /** @returns {Promise<string>} */ text: async () => 'err' })
      .mockResolvedValueOnce({ ok: false, status: 500, headers: { /** @returns {null} */ get: () => null }, /** @returns {Promise<string>} */ text: async () => 'err' })
      .mockResolvedValueOnce({ ok: true, /** @returns {Promise<string>} */ text: async () => 'ok' })
    // @ts-ignore
    global.fetch = fetchMock

    await expect(adapter.updateRef('heads/main', 'sha')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
