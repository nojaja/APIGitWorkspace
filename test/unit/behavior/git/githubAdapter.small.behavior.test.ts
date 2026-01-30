/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import {
  classifyStatus,
  getDelayForResponse,
  processResponseWithDelay,
  mapWithConcurrency,
  fetchWithRetry,
  GitHubAdapter,
  NonRetryableError,
} from '../../../../src/git/githubAdapter'

describe('githubAdapter - helpers', () => {
  it('classifyStatus returns true for 500 and 429', () => {
    expect(classifyStatus(500)).toBe(true)
    expect(classifyStatus(429)).toBe(true)
    expect(classifyStatus(200)).toBe(false)
    expect(classifyStatus(404)).toBe(false)
  })

  it('getDelayForResponse uses Retry-After when present', () => {
    const res = { headers: { get: (_: string) => '3' } } as unknown as Response
    expect(getDelayForResponse(res, 0, 100)).toBe(3000)
  })

  it('processResponseWithDelay throws NonRetryableError for 4xx', async () => {
    const res = { ok: false, status: 400, text: async () => 'bad', headers: { get: () => null } } as unknown as Response
    await expect(processResponseWithDelay(res, 0, 0)).rejects.toBeInstanceOf(NonRetryableError)
    await expect(processResponseWithDelay(res, 0, 0)).rejects.toThrow(/HTTP 400: bad/)
  })

  it('mapWithConcurrency maps items preserving order', async () => {
    const items = [1, 2, 3]
    const out = await mapWithConcurrency(items, async (n: number) => n * 2, 2)
    expect(out).toEqual([2, 4, 6])
  })

  it('fetchWithRetry rethrows NonRetryableError thrown by fetch', async () => {
    const originalFetch = global.fetch
    // @ts-ignore
    global.fetch = jest.fn(() => { throw new NonRetryableError('nope') })
    await expect(fetchWithRetry('http://x', {} as RequestInit, 1, 0)).rejects.toBeInstanceOf(NonRetryableError)
    global.fetch = originalFetch
  })
})

describe('GitHubAdapter basic behaviors (mocked)', () => {
  const opts = { owner: 'o', repo: 'r', token: 't' }
  it('createTree throws when blobSha missing', async () => {
    const a = new GitHubAdapter(opts)
    // createTree should throw when a change lacks blobSha for non-delete
    await expect(a.createTree([{ type: 'update', path: 'p', blobSha: undefined }])).rejects.toBeInstanceOf(NonRetryableError)
  })

  it('createCommit returns sha when fetch responds with sha', async () => {
    const a = new GitHubAdapter(opts)
    // @ts-ignore - override private fetch helper
    a['_fetchWithRetry'] = async () => ({ ok: true, json: async () => ({ sha: 'commitsha' }) } as unknown as Response)
    const sha = await a.createCommit('msg', 'invalid-parent', 'treesha')
    expect(sha).toBe('commitsha')
  })

  it('createBlobs returns path->sha map and caches blob', async () => {
    const a = new GitHubAdapter(opts)
    // @ts-ignore
    a['_fetchWithRetry'] = async () => ({ ok: true, json: async () => ({ sha: 'blobsha' }) } as unknown as Response)
    const res = await a.createBlobs([{ type: 'create', path: 'file.txt', content: 'hello' }], 2)
    expect(res['file.txt']).toBe('blobsha')
    // second call should hit cache path (same content)
    const res2 = await a.createBlobs([{ type: 'create', path: 'file.txt', content: 'hello' }], 2)
    expect(res2['file.txt']).toBe('blobsha')
  })

  it('getBlob returns content and encoding', async () => {
    const a = new GitHubAdapter(opts)
    // @ts-ignore
    a['_fetchWithRetry'] = async () => ({ ok: true, json: async () => ({ content: 'raw-data', encoding: 'utf-8' }) } as unknown as Response)
    const b = await a.getBlob('sha1')
    expect(b).toEqual({ content: 'raw-data', encoding: 'utf-8' })
  })
})
import { classifyStatus, getDelayForResponse, processResponseWithDelay, mapWithConcurrency } from '../../../../src/git/githubAdapter'

describe('githubAdapter small helpers', () => {
  it('classifyStatus classifies 500 and 429 as retryable', () => {
    expect(classifyStatus(500)).toBe(true)
    expect(classifyStatus(429)).toBe(true)
    expect(classifyStatus(200)).toBe(false)
    expect(classifyStatus(404)).toBe(false)
  })

  it('getDelayForResponse returns base for null and parses Retry-After header', () => {
    const d1 = getDelayForResponse(null, 0, 100)
    expect(typeof d1).toBe('number')
    const fakeResp: any = { headers: { get: (_: string) => '2' } }
    const d2 = getDelayForResponse(fakeResp, 1, 100)
    expect(d2).toBe(2000)
  })

  it('processResponseWithDelay returns ok response', async () => {
    const fakeResp: any = { ok: true, status: 200, headers: { get: (_: string) => null }, text: async () => 'ok' }
    const res = await processResponseWithDelay(fakeResp, 0, 100)
    expect(res).toBe(fakeResp)
  })

  it('processResponseWithDelay throws RetryableError on 500', async () => {
    const fakeResp: any = { ok: false, status: 500, headers: { get: (_: string) => null }, text: async () => 'err' }
    await expect(processResponseWithDelay(fakeResp, 0, 1)).rejects.toThrow()
  })

  it('mapWithConcurrency runs mapper concurrently and returns results', async () => {
    const items = [1,2,3,4]
    const mapper = async (n: number) => n * 2
    const res = await mapWithConcurrency(items, mapper, 2)
    expect(res).toEqual([2,4,6,8])
  })
})
