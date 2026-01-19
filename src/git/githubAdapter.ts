/* eslint-disable jsdoc/require-param, jsdoc/require-jsdoc, jsdoc/require-returns */
import { GitAdapter } from './adapter'
import crypto from 'crypto'

type GHOptions = {
  owner: string
  repo: string
  token: string
}

/**
 * リトライ可能なエラー。
 */
export class RetryableError extends Error {}

/**
 * リトライ不可能なエラー。
 */
export class NonRetryableError extends Error {}

/**
 * 指定ミリ秒だけ sleep するユーティリティ
 * @param ms ミリ秒
 */
function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

/**
 * fetch を再試行付きで実行するユーティリティ。
 * 5xx や 429 はリトライ対象、それ以外は NonRetryableError を投げる。
 * @param input RequestInfo
 * @param init RequestInit
 * @param attempts 試行回数
 * @param baseDelay ベースの遅延(ms)
 */
/* istanbul ignore next */
async function fetchWithRetry(input: RequestInfo, init: RequestInit, attempts = 4, baseDelay = 300) {
  let lastErr: any
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(input, init)
      return await processResponseWithDelay(res, i, baseDelay)
    /* istanbul ignore next */
    } catch (err) {
      if (err instanceof NonRetryableError) throw err
      lastErr = err
      await sleep(getDelayForResponse(null, i, baseDelay))
    }
  }
  throw new RetryableError(`Failed after ${attempts} attempts: ${lastErr}`)
}

function classifyStatus(status: number) {
  return status >= 500 || status === 429
}

function getDelayForResponse(res: Response | null, i: number, baseDelay: number) {
  if (!res) return baseDelay * Math.pow(2, i) + Math.random() * 100
  const retryAfter = res.headers.get('Retry-After')
  return retryAfter ? Number(retryAfter) * 1000 : baseDelay * Math.pow(2, i) + Math.random() * 100
}

async function processResponseWithDelay(res: Response, i: number, baseDelay: number) {
  if (res.ok) return res
  if (classifyStatus(res.status)) {
    await sleep(getDelayForResponse(res, i, baseDelay))
    throw new RetryableError(`HTTP ${res.status}`)
  }
  const txt = await res.text().catch(() => '')
  throw new NonRetryableError(`HTTP ${res.status}: ${txt}`)
}

/**
 * 非同期マップを並列実行するユーティリティ
 * @param items 入力配列
 * @param mapper マッピング関数
 * @param concurrency 同時実行数
 */
/* istanbul ignore next */
function mapWithConcurrency<T, R>(items: T[], mapper: (_t: T) => Promise<R>, concurrency = 5) {
  const results: R[] = []
  let idx = 0
  const runners: Promise<void>[] = []
  const run = async () => {
    while (idx < items.length) {
      const i = idx++
      if (i >= items.length) break
      const r = await mapper(items[i])
      results[i] = r
    }
  }
  for (let i = 0; i < Math.min(concurrency, items.length); i++) runners.push(run())
  return Promise.all(runners).then(() => results)
}

export class GitHubAdapter implements GitAdapter {
  private baseUrl: string
  private headers: Record<string, string>
  private _fetchWithRetry: (_: RequestInfo, __: RequestInit, ___?: number, ____?: number) => Promise<Response>
  // simple in-memory blob cache: contentSha -> blobSha
  private blobCache: Map<string, string> = new Map()
  constructor(private opts: GHOptions) {
    this.baseUrl = `https://api.github.com/repos/${opts.owner}/${opts.repo}`
    this.headers = {
      Authorization: `token ${opts.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    }
    this._fetchWithRetry = fetchWithRetry
  }

  async createBlobs(changes: any[], concurrency = 5) {
    const tasks = changes.filter((c) => c.type === 'create' || c.type === 'update')
    const mapper = async (ch: any) => {
      // compute simple content hash to enable cache lookup
      const contentHash = crypto.createHash('sha1').update(ch.content || '', 'utf8').digest('hex')
      const cached = this.blobCache.get(contentHash)
      if (cached) return { path: ch.path, sha: cached }
      const body = JSON.stringify({ content: ch.content, encoding: 'utf-8' })
      const res = await this._fetchWithRetry(`${this.baseUrl}/git/blobs`, { method: 'POST', headers: this.headers, body }, 4, 300)
      const j = await res.json()
      if (!j.sha) throw new NonRetryableError('blob response missing sha')
      this.blobCache.set(contentHash, j.sha)
      return { path: ch.path, sha: j.sha }
    }

    const results = await mapWithConcurrency(tasks, mapper, concurrency)
    const map: Record<string, string> = {}
    for (const r of results) map[r.path] = r.sha
    return map
  }

  async createTree(changes: any[], baseTreeSha?: string) {
    const tree = [] as any[]
    for (const c of changes) {
      if (c.type === 'delete') {
        tree.push({ path: c.path, mode: '100644', sha: null })
      } else {
        if (!c.blobSha) throw new NonRetryableError(`missing blobSha for ${c.path}`)
        tree.push({ path: c.path, mode: '100644', type: 'blob', sha: c.blobSha })
      }
    }
    const body: any = { tree }
    if (baseTreeSha) body.base_tree = baseTreeSha
    const res = await this._fetchWithRetry(`${this.baseUrl}/git/trees`, { method: 'POST', headers: this.headers, body: JSON.stringify(body) }, 4, 300)
    const j = await res.json()
    if (!j.sha) throw new NonRetryableError('createTree response missing sha')
    return j.sha as string
  }

  async createCommit(message: string, parentSha: string, treeSha: string) {
    const body = JSON.stringify({ message, tree: treeSha, parents: [parentSha] })
    const res = await this._fetchWithRetry(`${this.baseUrl}/git/commits`, { method: 'POST', headers: this.headers, body }, 4, 300)
    const j = await res.json()
    if (!j.sha) throw new NonRetryableError('createCommit response missing sha')
    return j.sha as string
  }

  async updateRef(ref: string, commitSha: string, force = false) {
    const body = JSON.stringify({ sha: commitSha, force })
    const res = await this._fetchWithRetry(`${this.baseUrl}/git/refs/${ref}`, { method: 'PATCH', headers: this.headers, body }, 4, 300)
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new NonRetryableError(`updateRef failed: ${res.status} ${txt}`)
    }
  }
}

export { fetchWithRetry, classifyStatus, getDelayForResponse, processResponseWithDelay, mapWithConcurrency }
export default GitHubAdapter
