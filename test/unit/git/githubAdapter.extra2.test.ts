import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import GitHubAdapter, { NonRetryableError } from '../../../src/git/githubAdapter'

beforeEach(() => {
  jest.clearAllMocks()
  // @ts-ignore
  global.fetch = undefined
})

describe('GitHubAdapter missing-sha branches', () => {
  it('createCommit throws NonRetryableError when response missing sha', async () => {
    const adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    const fetchMock = jest.fn()
    fetchMock.mockResolvedValue({ ok: true, /**
     *
     */
    json: async () => ({}) })
    // @ts-ignore
    global.fetch = fetchMock

    await expect(adapter.createCommit('m', 'p', 't')).rejects.toThrow(NonRetryableError)
  })

  it('createTree throws NonRetryableError when response missing sha', async () => {
    const adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    const fetchMock = jest.fn()
    fetchMock.mockResolvedValue({ ok: true, /**
     *
     */
    json: async () => ({}) })
    // @ts-ignore
    global.fetch = fetchMock

    await expect(adapter.createTree([{ type: 'create', path: 'x', blobSha: 'b' }])).rejects.toThrow(NonRetryableError)
  })
})
