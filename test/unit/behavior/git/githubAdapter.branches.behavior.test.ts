/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import GitHubAdapter, { NonRetryableError } from '../../../../src/git/githubAdapter'

function makeRes(ok: boolean, status: number, jsonObj: any, headers?: Record<string,string>) {
  return {
    ok,
    status,
    json: async () => jsonObj,
    text: async () => {
      try { return JSON.stringify(jsonObj) } catch { return '' }
    },
    headers: {
      get: (k: string) => (headers && headers[k]) || null
    }
  } as unknown as Response
}

describe('GitHubAdapter branch coverage', () => {
  beforeEach(() => jest.clearAllMocks())

  it('getCommitTreeSha throws when tree.sha missing', async () => {
    const a = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    a['_fetchWithRetry'] = async (_url: any, _init: any) => makeRes(true, 200, { /* missing tree */ })
    await expect(a.getCommitTreeSha('deadbeef')).rejects.toThrow(NonRetryableError)
  })

  it('getBlob decodes base64 and returns raw for utf-8', async () => {
    const a = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    // base64 case
    const b64 = Buffer.from('hello').toString('base64')
    a['_fetchWithRetry'] = async (url: string) => {
      if (url.includes('/git/blobs/sha-b64')) return makeRes(true, 200, { content: b64, encoding: 'base64' })
      if (url.includes('/git/blobs/sha-raw')) return makeRes(true, 200, { content: 'raw-utf', encoding: 'utf-8' })
      return makeRes(false, 404, {})
    }
    const r1 = await a.getBlob('sha-b64')
    expect(r1.content).toBe('hello')
    expect(r1.encoding).toBe('base64')

    const r2 = await a.getBlob('sha-raw')
    expect(r2.content).toBe('raw-utf')
    expect(r2.encoding).toBe('utf-8')
  })

  it('fetchSnapshot handles blob fetch failure gracefully', async () => {
    const a = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    // simulate refs -> returns headSha
    // simulate trees -> returns two blob entries
    // simulate blob fetch: one succeeds, one throws
    a['_fetchWithRetry'] = async (url: string) => {
      if (url.includes('/git/refs/heads/')) return makeRes(true, 200, { object: { sha: 'head-1' } })
      if (url.includes('/git/trees/') && url.includes('?recursive=1')) {
        return makeRes(true, 200, { tree: [ { type: 'blob', sha: 'good', path: 'f1' }, { type: 'blob', sha: 'bad', path: 'f2' } ] })
      }
      if (url.includes('/git/blobs/good')) return makeRes(true, 200, { content: 'ok', encoding: 'utf-8' })
      if (url.includes('/git/blobs/bad')) throw new Error('network')
      return makeRes(false, 404, {})
    }

    const res = await a.fetchSnapshot('main', 2)
    expect(res.headSha).toBe('head-1')
    // lazy fetch only requested blobs
    await res.fetchContent(Object.keys(res.shas))
    expect(Object.keys(res.snapshot)).toContain('f1')
    expect(res.snapshot['f1']).toBe('ok')
    expect(res.snapshot['f2']).toBeUndefined()
  })

  it('getRef and getTree error and success paths', async () => {
    const a = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    a['_fetchWithRetry'] = async (url: string) => {
      if (url.includes('/git/ref/')) return makeRes(true, 200, { object: { sha: 'refsha' } })
      if (url.includes('/git/trees/') && !url.includes('?recursive=1')) return makeRes(true, 200, { tree: [{ path: 'x' }] })
      if (url.includes('/git/trees/') && url.includes('?recursive=1')) return makeRes(true, 200, { tree: [{ path: 'r1' }, { path: 'r2' }] })
      return makeRes(false, 404, {})
    }

    const ref = await a.getRef('heads/main')
    expect(ref).toBe('refsha')

    const tree = await a.getTree('treesha', false)
    expect(Array.isArray(tree)).toBe(true)
    const rtree = await a.getTree('treesha', true)
    expect(rtree.length).toBeGreaterThanOrEqual(2)

    // error paths
    a['_fetchWithRetry'] = async () => makeRes(true, 200, {})
    await expect(a.getRef('nope')).rejects.toThrow(NonRetryableError)
    await expect(a.getTree('nope')).rejects.toThrow(NonRetryableError)
  })

  it('getCommitTreeSha success path', async () => {
    const a = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' })
    a['_fetchWithRetry'] = async () => makeRes(true, 200, { tree: { sha: 'tree-success' } })
    const sha = await a.getCommitTreeSha('s')
    expect(sha).toBe('tree-success')
  })
})
