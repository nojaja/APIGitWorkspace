/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import GitLabAdapter from '../../../../src/git/gitlabAdapter'

beforeEach(() => {
  jest.clearAllMocks()
  jest.restoreAllMocks()
})

describe('GitLabAdapter final-retry response handling', () => {
  it('returns final retryable response (status 500) and causes invalid JSON error', async () => {
    const adapter = new GitLabAdapter({ projectId: '1', token: 't', host: 'http://example.com' })
    ;(adapter as any).maxRetries = 2
    ;(adapter as any).baseBackoff = 5

    // Always return status 500 with non-JSON body; on final attempt fetchWithRetry should return res
    // @ts-ignore
    global.fetch = jest.fn().mockResolvedValue({ status: 500, ok: false, /**
     *
     */
    text: async () => 'not-json' })

    await expect(
      adapter.createCommitWithActions('main', 'msg', [{ type: 'create', path: 'a', content: 'x' }])
    ).rejects.toThrow(/GitLab commit invalid JSON response/)
  })
})
