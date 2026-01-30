/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect } from '@jest/globals'
import {
  classifyStatus,
  getDelayForResponse,
  processResponseWithDelay,
  mapWithConcurrency,
  fetchWithRetry,
} from '../../../../src/git/githubAdapter'

describe('githubAdapter helpers', () => {
  it('classifyStatus recognizes retryable statuses', () => {
    expect(classifyStatus(500)).toBeTruthy()
    expect(classifyStatus(429)).toBeTruthy()
    expect(classifyStatus(400)).toBeFalsy()
  })

  it('getDelayForResponse returns parsed Retry-After when present', () => {
    const res: any = { headers: { /** @returns {string|null} */
    get: (k: string) => (k === 'Retry-After' ? '2' : null) } }
    expect(getDelayForResponse(res, 0, 100)).toBe(2000)
    const d = getDelayForResponse(null, 2, 10)
    expect(typeof d).toBe('number')
    expect(d).toBeGreaterThanOrEqual(10)
  })

  it('processResponseWithDelay returns res when ok', async () => {
    const res: any = { ok: true }
    await expect(processResponseWithDelay(res, 0, 1)).resolves.toBe(res)
  })

  it('processResponseWithDelay throws RetryableError for 500/429', async () => {
    const res: any = { ok: false, status: 500, headers: { /** @returns {string|null} */
    get: () => '0' }, /** @returns {Promise<string>} */
    text: async () => 'x' }
    await expect(processResponseWithDelay(res, 0, 1)).rejects.toThrow()
  })

  it('processResponseWithDelay throws NonRetryableError for 4xx with text', async () => {
    const res: any = { ok: false, status: 400, /** @returns {Promise<string>} */
    text: async () => 'errtext' }
    await expect(processResponseWithDelay(res, 0, 1)).rejects.toThrow(/HTTP 400/)
  })

  it('mapWithConcurrency runs mapper with various concurrency', async () => {
    const items = [1, 2, 3]
    const res = await mapWithConcurrency(items, async (n: number) => n * 2, 5)
    expect(res).toEqual([2, 4, 6])
    const res2 = await mapWithConcurrency([], async (n: number) => n * 2, 3)
    expect(res2).toEqual([])
  })

  it('fetchWithRetry rethrows NonRetryableError and throws RetryableError after attempts', async () => {
    // non-retryable thrown by fetch
    // @ts-ignore
    global.fetch = jest.fn().mockImplementation(() => { throw new Error('boom') })
    await expect(fetchWithRetry('/x', {} as any, 1, 1)).rejects.toThrow()

    // fetch throws NonRetryableError should be rethrown immediately
    // @ts-ignore
    global.fetch = jest.fn().mockImplementation(() => { throw new (class extends Error {})('n') })
    // simulate instance of NonRetryableError
    const NR: any = (await import('../../../../src/git/githubAdapter')).NonRetryableError
    // @ts-ignore
    global.fetch = jest.fn().mockImplementation(() => { throw new NR('no') })
    await expect(fetchWithRetry('/x', {} as any, 1, 1)).rejects.toThrow(NR)
  })

  it('fetchWithRetry catches transient errors then succeeds', async () => {
    let calls = 0
    // first call throws, second returns ok
    // @ts-ignore
    global.fetch = jest.fn().mockImplementation(() => {
      if (calls++ === 0) throw new Error('transient')
      return Promise.resolve({ ok: true, /** @returns {Promise<any>} */
      json: async () => ({}) })
    })
    await expect(fetchWithRetry('/x', {} as any, 3, 1)).resolves.toBeDefined()
  })

  it('mapWithConcurrency handles different concurrency values', async () => {
    const items = [1, 2, 3, 4, 5]
    const r1 = await mapWithConcurrency(items, async (n: number) => n + 1, 1)
    expect(r1).toEqual([2, 3, 4, 5, 6])
    const r2 = await mapWithConcurrency(items, async (n: number) => n + 2, 2)
    expect(r2).toEqual([3, 4, 5, 6, 7])
  })
})
