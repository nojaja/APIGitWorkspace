import { jest } from '@jest/globals'
import {
  classifyStatus,
  getDelayForResponse,
  processResponseWithDelay,
  fetchWithRetry,
  mapWithConcurrency,
  RetryableError,
  NonRetryableError,
} from '../../../src/git/abstractAdapter'

describe('AbstractAdapter helpers', () => {
  it('classifyStatus returns true for 5xx and 429', () => {
    expect(classifyStatus(500)).toBe(true)
    expect(classifyStatus(503)).toBe(true)
    expect(classifyStatus(429)).toBe(true)
    expect(classifyStatus(400)).toBe(false)
  })

  it('getDelayForResponse handles null and header get variants', () => {
    const d1 = getDelayForResponse(null as any, 1, 10)
    expect(typeof d1).toBe('number')
    // header.get returning a numeric string should be interpreted as seconds
    const fakeResp: any = { headers: { get: (_: string) => '2' } }
    const d2 = getDelayForResponse(fakeResp as any, 0, 10)
    expect(d2).toBe(2000)
    // header object with field fallback
    const fakeResp2: any = { headers: { 'Retry-After': '3' } }
    const d3 = getDelayForResponse(fakeResp2 as any, 0, 10)
    expect(d3).toBe(3000)
  })

  it('processResponseWithDelay returns OK or throws appropriate errors', async () => {
    const okResp: any = { ok: true }
    await expect(processResponseWithDelay(okResp as any, 0, 0)).resolves.toBe(okResp)

    const retryableResp: any = { ok: false, status: 500, headers: { get: (_: string) => '0' }, text: async () => 'err' }
    await expect(processResponseWithDelay(retryableResp as any, 0, 0)).rejects.toThrow(RetryableError)

    const nonRetryResp: any = { ok: false, status: 400, headers: {}, text: async () => 'bad' }
    await expect(processResponseWithDelay(nonRetryResp as any, 0, 0)).rejects.toThrow(NonRetryableError)
  })

  it('fetchWithRetry retries and eventually returns response', async () => {
    const mockFetch = jest.fn()
    // First call throws, second returns ok response
    mockFetch.mockRejectedValueOnce(new Error('network'))
    mockFetch.mockResolvedValueOnce({ ok: true })
    // @ts-ignore override global fetch
    global.fetch = mockFetch
    const res = await fetchWithRetry('http://example/', {})
    expect(res).toEqual({ ok: true })
  })

  it('mapWithConcurrency maps items preserving order', async () => {
    const items = [1, 2, 3]
    const mapper = async (n: number) => n * 2
    const out = await mapWithConcurrency(items, mapper, 2)
    expect(out).toEqual([2, 4, 6])
  })
})
