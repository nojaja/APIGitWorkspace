import { GitAdapter } from './adapter.ts'
import AbstractGitAdapter, { fetchWithRetry, classifyStatus, getDelayForResponse, processResponseWithDelay, mapWithConcurrency, shaOf, NonRetryableError } from './abstractAdapter.ts'
// Use Web Crypto directly for SHA-1

type GHOptions = {
  owner: string
  repo: string
  token: string
  host?: string // optional GitHub Enterprise host
}

/**
 * 指定ミリ秒だけ sleep するユーティリティ
 * @param ms ミリ秒
 */
// helpers are provided by abstractAdapter

export class GitHubAdapter extends AbstractGitAdapter implements GitAdapter {
  private _fetchWithRetry: (_: RequestInfo, __: RequestInit, ___?: number, ____?: number) => Promise<Response>
  // simple in-memory blob cache: contentSha -> blobSha
  private blobCache: Map<string, string> = new Map()

  /**
   * GitHubAdapter を初期化します。
   * @param {GHOptions} opts 設定オブジェクト
   */
  constructor(options: GHOptions) {
    super(options)
    const host = options.host || 'https://api.github.com'
    this.baseUrl = `${host}/repos/${options.owner}/${options.repo}`
    this.headers = {
      Authorization: `token ${options.token}`,
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
  // shaOf is inherited from AbstractGitAdapter

  async createBlobs(changes: any[], concurrency = 5) {
    const tasks = changes.filter((c) => c.type === 'create' || c.type === 'update')
    const mapper = async (ch: any) => {
      const contentHash = await this.shaOf(ch.content || '')
      const cached = this.blobCache.get(contentHash)
      if (cached) return { path: ch.path, sha: cached }
      const body = JSON.stringify({ content: ch.content, encoding: 'utf-8' })
      const response = await this._fetchWithRetry(`${this.baseUrl}/git/blobs`, { method: 'POST', headers: this.headers, body }, 4, 300)
      const index = await response.json()
      if (!index.sha) throw new NonRetryableError('blob response missing sha')
      this.blobCache.set(contentHash, index.sha)
      return { path: ch.path, sha: index.sha }
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
    const response = await this._fetchWithRetry(`${this.baseUrl}/git/trees`, { method: 'POST', headers: this.headers, body: JSON.stringify(body) }, 4, 300)
    const index = await response.json()
    if (!index.sha) throw new NonRetryableError('createTree response missing sha')
    return index.sha as string
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
    const response = await this._fetchWithRetry(`${this.baseUrl}/git/commits`, { method: 'POST', headers: this.headers, body }, 4, 300)
    const index = await response.json()
    if (!index.sha) throw new NonRetryableError('createCommit response missing sha')
    return index.sha as string
  }

  /**
   * 参照を更新します。
   * @param {string} ref 参照名（例: heads/main）
   * @param {string} commitSha コミット SHA
   * @param {boolean} force 強制更新フラグ
   */
  async updateRef(reference: string, commitSha: string, force = false) {
    const body = JSON.stringify({ sha: commitSha, force })
    const response = await this._fetchWithRetry(`${this.baseUrl}/git/refs/${reference}`, { method: 'PATCH', headers: this.headers, body }, 4, 300)
    if (!response.ok) {
      const txt = await response.text().catch(() => '')
      throw new NonRetryableError(`updateRef failed: ${response.status} ${txt}`)
    }
  }

  /**
   * 指定コミットの tree SHA を取得します。
   * @param commitSha コミット SHA
   */
  async getCommitTreeSha(commitSha: string) {
    const response = await this._fetchWithRetry(`${this.baseUrl}/git/commits/${commitSha}`, { method: 'GET', headers: this.headers }, 4, 300)
    const index = await response.json()
    if (!index || !index.tree || !index.tree.sha) throw new NonRetryableError('getCommitTreeSha: tree sha not found')
    return index.tree.sha as string
  }

  /**
   * 指定 ref の先頭コミット SHA を取得します。
   * @param ref 例: `heads/main`
   */
  async getRef(reference: string) {
    const response = await this._fetchWithRetry(`${this.baseUrl}/git/ref/${reference}`, { method: 'GET', headers: this.headers }, 4, 300)
    const index = await response.json()
    if (!index || !index.object || !index.object.sha) throw new NonRetryableError('getRef: sha not found')
    return index.object.sha as string
  }

  /**
   * tree を取得します（必要なら再帰取得）。
   * @param treeSha tree の SHA
   * @param recursive 再帰フラグ
   */
  async getTree(treeSha: string, recursive = false) {
    const url = `${this.baseUrl}/git/trees/${treeSha}` + (recursive ? '?recursive=1' : '')
    const response = await this._fetchWithRetry(url, { method: 'GET', headers: this.headers }, 4, 300)
    const index = await response.json()
    if (!index || !index.tree) throw new NonRetryableError('getTree: tree not found')
    return index.tree as any[]
  }

  /**
   * blob を取得してデコードして返します。
   * @param blobSha blob の SHA
   */
  async getBlob(blobSha: string) {
    const response = await this._fetchWithRetry(`${this.baseUrl}/git/blobs/${blobSha}`, { method: 'GET', headers: this.headers }, 4, 300)
    const index = await response.json()
    if (!index || typeof index.content === 'undefined') throw new NonRetryableError('getBlob: content not found')
    const enc = index.encoding || 'utf-8'
    let content: string
    if (enc === 'base64') {
      content = atob((index.content || '').replace(/\n/g, ''))
    } else {
      content = index.content
    }
    return { content, encoding: enc }
  }

  /**
   * Blob を取得して content を返す。取得失敗時は content=null を返す。
   * @param {{sha:string,path:string}} f blob 情報
   * @returns {Promise<{path:string,content:string|null}>}
   */
  private async _fetchBlobContentOrNull(f: any) {
    try {
      const b = await this.getBlob(f.sha)
      return { path: f.path, content: b.content }
    } catch (error) {
      if (typeof console !== 'undefined' && (console as any).debug) (console as any).debug('fetchSnapshot blob failed', f.path, error)
      return { path: f.path, content: null }
    }
  }

  /**
   * リポジトリのスナップショットを取得します。
   * @param {string} branch ブランチ名 (default: 'main')
   */
  async fetchSnapshot(branch = 'main', concurrency = 5) {
    const referenceResponse = await this._fetchWithRetry(`${this.baseUrl}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'GET', headers: this.headers }, 4, 300)
    const referenceJ = await referenceResponse.json()
    const headSha = (referenceJ && (referenceJ.object && referenceJ.object.sha ? referenceJ.object.sha : referenceJ.sha)) || branch

    const treeResponse = await this._fetchWithRetry(`${this.baseUrl}/git/trees/${headSha}${'?recursive=1'}`, { method: 'GET', headers: this.headers }, 4, 300)
    const treeJ = await treeResponse.json()
    const files = (treeJ && treeJ.tree) ? treeJ.tree.filter((t: any) => t.type === 'blob') : []

    const shas: Record<string, string> = {}
    const fileMap = new Map<string, any>()
    for (const f of files) {
      shas[f.path] = f.sha
      fileMap.set(f.path, f)
    }

    const contentCache = new Map<string, string>()
    const snapshot: Record<string, string> = {}
    /**
     * Fetch content wrapper that delegates to private helper.
     */
    const fetchContent = (paths: string[]) => this._fetchContentFromMap(fileMap, contentCache, snapshot, paths, concurrency)

    return { headSha, shas, fetchContent, snapshot }
  }

  /**
   * Helper to fetch file contents from a file map with concurrency and caching.
   */
  private async _fetchContentFromMap(fileMap: Map<string, any>, contentCache: Map<string, string>, snapshot: Record<string, string>, paths: string[], concurrency: number) {
    const out: Record<string, string> = {}
    const unique = Array.from(new Set(paths)).filter((p) => fileMap.has(p))
    await mapWithConcurrency(unique, async (p: string) => {
      if (contentCache.has(p)) {
        out[p] = contentCache.get(p) as string
        snapshot[p] = contentCache.get(p) as string
        return
      }
      const f = fileMap.get(p)
      const r = await this._fetchBlobContentOrNull(f)
      if (r && r.content !== null) {
        contentCache.set(p, r.content)
        out[p] = r.content
        snapshot[p] = r.content
      }
    }, concurrency)
    return out
  }
}
// re-export helpers for backward compatibility
export { fetchWithRetry, classifyStatus, getDelayForResponse, processResponseWithDelay, mapWithConcurrency, shaOf }
// re-export error classes for backward compatibility with tests
export { RetryableError, NonRetryableError } from './abstractAdapter.ts'
export default GitHubAdapter

// helper moved into class as a private method
