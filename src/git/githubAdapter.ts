import { GitAdapter } from './adapter'
// Use Web Crypto directly for SHA-1

type GHOptions = {
  owner: string
  repo: string
  token: string
  host?: string // optional GitHub Enterprise host
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

  /**
   * GitHubAdapter を初期化します。
   * @param {GHOptions} opts 設定オブジェクト
   */
  constructor(private opts: GHOptions) {
    const host = opts.host || 'https://api.github.com'
    this.baseUrl = `${host}/repos/${opts.owner}/${opts.repo}`
    this.headers = {
      Authorization: `token ${opts.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    }
    this._fetchWithRetry = fetchWithRetry
  }

  /**
   * コンテンツから sha1 を算出します。
   * @param {string} content コンテンツ
   * @returns {string} sha1 ハッシュ
   */
  private async shaOf(content: string) {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const buf = await crypto.subtle.digest('SHA-1', data)
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  async createBlobs(changes: any[], concurrency = 5) {
    const tasks = changes.filter((c) => c.type === 'create' || c.type === 'update')
    const mapper = async (ch: any) => {
      const contentHash = await this.shaOf(ch.content || '')
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

  /**
   * 互換用のツリー作成。
   * @param {any[]} changes 変更一覧
   * @param {string} [baseTreeSha] ベースツリー
   * @returns {Promise<string>} 作成されたツリーの sha
   */
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

  /**
   * コミットを作成します。
   * @param {string} message コミットメッセージ
   * @param {string} parentSha 親コミット SHA
   * @param {string} treeSha ツリー SHA
   * @returns {Promise<string>} 新規コミット SHA
   */
  async createCommit(message: string, parentSha: string, treeSha: string) {
    const parents = (typeof parentSha === 'string' && /^[0-9a-f]{40}$/.test(parentSha)) ? [parentSha] : []
    const body = JSON.stringify({ message, tree: treeSha, parents })
    // debug: log body for troubleshooting invalid parents
    /* istanbul ignore next */
    if (typeof console !== 'undefined' && (console as any).debug) (console as any).debug('GitHub.createCommit body:', body)
    const res = await this._fetchWithRetry(`${this.baseUrl}/git/commits`, { method: 'POST', headers: this.headers, body }, 4, 300)
    const j = await res.json()
    if (!j.sha) throw new NonRetryableError('createCommit response missing sha')
    return j.sha as string
  }

  /**
   * 参照を更新します。
   * @param {string} ref 参照名（例: heads/main）
   * @param {string} commitSha コミット SHA
   * @param {boolean} force 強制更新フラグ
   */
  async updateRef(ref: string, commitSha: string, force = false) {
    const body = JSON.stringify({ sha: commitSha, force })
    const res = await this._fetchWithRetry(`${this.baseUrl}/git/refs/${ref}`, { method: 'PATCH', headers: this.headers, body }, 4, 300)
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new NonRetryableError(`updateRef failed: ${res.status} ${txt}`)
    }
  }

  /**
   * 指定コミットの tree SHA を取得します。
   * @param commitSha コミット SHA
   */
  async getCommitTreeSha(commitSha: string) {
    const res = await this._fetchWithRetry(`${this.baseUrl}/git/commits/${commitSha}`, { method: 'GET', headers: this.headers }, 4, 300)
    const j = await res.json()
    if (!j || !j.tree || !j.tree.sha) throw new NonRetryableError('getCommitTreeSha: tree sha not found')
    return j.tree.sha as string
  }

  /**
   * 指定 ref の先頭コミット SHA を取得します。
   * @param ref 例: `heads/main`
   */
  async getRef(ref: string) {
    const res = await this._fetchWithRetry(`${this.baseUrl}/git/ref/${ref}`, { method: 'GET', headers: this.headers }, 4, 300)
    const j = await res.json()
    if (!j || !j.object || !j.object.sha) throw new NonRetryableError('getRef: sha not found')
    return j.object.sha as string
  }

  /**
   * tree を取得します（必要なら再帰取得）。
   * @param treeSha tree の SHA
   * @param recursive 再帰フラグ
   */
  async getTree(treeSha: string, recursive = false) {
    const url = `${this.baseUrl}/git/trees/${treeSha}` + (recursive ? '?recursive=1' : '')
    const res = await this._fetchWithRetry(url, { method: 'GET', headers: this.headers }, 4, 300)
    const j = await res.json()
    if (!j || !j.tree) throw new NonRetryableError('getTree: tree not found')
    return j.tree as any[]
  }

  /**
   * blob を取得してデコードして返します。
   * @param blobSha blob の SHA
   */
  async getBlob(blobSha: string) {
    const res = await this._fetchWithRetry(`${this.baseUrl}/git/blobs/${blobSha}`, { method: 'GET', headers: this.headers }, 4, 300)
    const j = await res.json()
    if (!j || typeof j.content === 'undefined') throw new NonRetryableError('getBlob: content not found')
    const enc = j.encoding || 'utf-8'
    let content: string
    if (enc === 'base64') {
      content = atob((j.content || '').replace(/\n/g, ''))
    } else {
      content = j.content
    }
    return { content, encoding: enc }
  }

  /**
   * リポジトリのスナップショットを取得します。
   * @param {string} branch ブランチ名 (default: 'main')
   */
  async fetchSnapshot(branch = 'main', concurrency = 5) {
    const refRes = await this._fetchWithRetry(`${this.baseUrl}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'GET', headers: this.headers }, 4, 300)
    const refJ = await refRes.json()
    const headSha = (refJ && (refJ.object && refJ.object.sha ? refJ.object.sha : refJ.sha)) || branch

    const treeRes = await this._fetchWithRetry(`${this.baseUrl}/git/trees/${headSha}${'?recursive=1'}`, { method: 'GET', headers: this.headers }, 4, 300)
    const treeJ = await treeRes.json()
    const files = (treeJ && treeJ.tree) ? treeJ.tree.filter((t: any) => t.type === 'blob') : []
    const snapshot: Record<string, string> = {}

    await mapWithConcurrency(files, async (f: any) => {
      try {
        const b = await this.getBlob(f.sha)
        snapshot[f.path] = b.content
      } catch (e) {
        if (typeof console !== 'undefined' && (console as any).debug) (console as any).debug('fetchSnapshot blob failed', f.path, e)
      }
      return null
    }, concurrency)

    return { headSha, snapshot }
  }
}

export { fetchWithRetry, classifyStatus, getDelayForResponse, processResponseWithDelay, mapWithConcurrency }
export default GitHubAdapter
