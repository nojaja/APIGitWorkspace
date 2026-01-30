/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import { shaOf, fetchWithRetry, mapWithConcurrency } from '../../../../src/git/abstractAdapter'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('AbstractAdapter utilities', () => {
  it('shaOf returns correct sha1 for "abc"', async () => {
    const h = await shaOf('abc')
    expect(h).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  it('fetchWithRetry returns response when ok', async () => {
    const mockResp: any = { ok: true, status: 200, json: async () => ({}), headers: { get: (_: string) => null }, text: async () => '' }
    ;(globalThis as any).fetch = jest.fn().mockResolvedValue(mockResp)
    const res = await fetchWithRetry('https://example.com', { method: 'GET' } as RequestInit, 2, 10)
    expect(res).toBe(mockResp)
    expect((globalThis as any).fetch).toHaveBeenCalled()
  })

  it('mapWithConcurrency processes items', async () => {
    const items = [1, 2, 3, 4]
    const mapper = jest.fn(async (n: number) => n * 2)
    const out = await mapWithConcurrency(items, mapper, 2)
    expect(out).toEqual([2, 4, 6, 8])
    expect(mapper).toHaveBeenCalledTimes(4)
  })
})
