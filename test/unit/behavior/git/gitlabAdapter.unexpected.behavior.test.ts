/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import GitLabAdapter from '../../../../src/git/gitlabAdapter'

beforeEach(() => {
  jest.clearAllMocks()
  // @ts-ignore
  global.fetch = undefined
})

describe('GitLabAdapter unexpected commit responses', () => {
  it('createCommitWithActions throws when JSON lacks id/commit', async () => {
    const adapter = new GitLabAdapter({ projectId: '1', token: 't' })
    const fetchMock = jest.fn()
    // return valid JSON but without id/commit
    fetchMock.mockResolvedValue({ ok: true, /**
     *
     */
    text: async () => JSON.stringify({}) })
    // @ts-ignore
    global.fetch = fetchMock

    await expect(adapter.createCommitWithActions('main', 'm', [{ type: 'create', path: 'a', content: 'c' }])).rejects.toThrow(/unexpected response/)
  })
})
