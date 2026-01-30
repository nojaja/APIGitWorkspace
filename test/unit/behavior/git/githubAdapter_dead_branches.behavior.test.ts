/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { getDelayForResponse, processResponseWithDelay } from '../../../../src/git/githubAdapter'
import { NonRetryableError } from '../../../../src/git/githubAdapter'

describe('GitHubAdapter low-frequency branches', () => {
  it('getDelayForResponse uses Retry-After header when present', () => {
    const res: any = { headers: { get: (_: string) => '3' } }
    const d = getDelayForResponse(res as any, 0, 100)
    expect(d).toBe(3000)
  })

  it('processResponseWithDelay returns response when ok', async () => {
    const res: any = { ok: true }
    const out = await processResponseWithDelay(res as any, 0, 0)
    expect(out).toBe(res)
  })

  it('processResponseWithDelay throws NonRetryableError with response text', async () => {
    const res: any = { ok: false, status: 400, text: () => Promise.resolve('bad') }
    await expect(processResponseWithDelay(res as any, 0, 0)).rejects.toThrow(NonRetryableError)
    await expect(processResponseWithDelay(res as any, 0, 0)).rejects.toThrow('HTTP 400: bad')
  })
})
