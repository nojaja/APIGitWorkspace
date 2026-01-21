import { GitAdapter } from './adapter'
// Use Web Crypto directly for SHA-1

type GLOpts = { projectId: string; token: string; host?: string }

/**
 *
 */
export class GitLabAdapter implements GitAdapter {
  private baseUrl: string
  private headers: Record<string, string>
  private pendingActions: Array<{ action: string; file_path: string; content?: string }> | null = null
  private maxRetries = 3
  private baseBackoff = 300

  /**
   * GitLabAdapter を初期化します。
   * @param {GLOpts} opts 設定オブジェクト
   */
  constructor(private opts: GLOpts) {
    const host = opts.host || 'https://gitlab.com'
    this.baseUrl = `${host}/api/v4/projects/${encodeURIComponent(opts.projectId)}`
    this.headers = {
       'PRIVATE-TOKEN': opts.token,
       'Content-Type': 'application/json' 
    }
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

  /**
   * 変更一覧から blob sha のマップを作成します（疑似実装）。
   * @param {any[]} changes 変更一覧
   * @returns {Promise<Record<string,string>>} path->sha マップ
   */
  async createBlobs(changes: any[]) {
    const map: Record<string, string> = {}
    for (const c of changes) {
      if (c.type === 'create' || c.type === 'update') map[c.path] = await this.shaOf(c.content)
    }
    return map
  }
  /**
   * 互換用のツリー作成。実際には actions を保持しておき、マーカーを返します。
   * @param {any[]} _changes 変更一覧
   * @param {string} [_baseTreeSha] ベースツリー（未使用）
   * @returns {Promise<string>} マーカー文字列
   */
  async createTree(_changes: any[], _baseTreeSha?: string) {
    // Store actions for later commit; return marker token
    const actions = (_changes || []).map((c: any) => {
      if (c.type === 'delete') return { action: 'delete', file_path: c.path }
      if (c.type === 'create') return { action: 'create', file_path: c.path, content: c.content }
      return { action: 'update', file_path: c.path, content: c.content }
    })
    this.pendingActions = actions
    return `gitlab-tree-${Date.now()}-${Math.floor(Math.random() * 100000)}`
  }

  /**
   * createTree で保持した actions があればコミットし、なければ parentSha を返します。
   * @param {string} message コミットメッセージ
   * @param {string} parentSha 親コミット SHA
   * @param {string} _treeSha ツリー SHA（未使用）
   * @returns {Promise<string>} 新規コミット SHA または parentSha
   */
  async createCommit(message: string, parentSha: string, _treeSha: string) {
    // If pendingActions exist (created via createTree), use commits API
    if (this.pendingActions && this.pendingActions.length > 0) {
      const branch = 'main'
      const res = await this.createCommitWithActions(
        branch,
        message,
        this.pendingActions.map((a) => ({ type: a.action === 'delete' ? 'delete' : a.action === 'create' ? 'create' : 'update', path: a.file_path, content: a.content }))
      )
      this.pendingActions = null
      return res
    }
    // Fallback: no-op commit (return parentSha)
    return parentSha
  }

  /**
   * リファレンス更新は不要なため noop 実装です。
   * @param {string} _ref ref 名
   * @param {string} _commitSha コミット SHA
   * @param {boolean} [_force]
   * @returns {Promise<void>}
   */
  async updateRef(_ref: string, _commitSha: string, _force = false) {
    // Not required when using commits API
  }

  /**
   * actions を用いて GitLab のコミット API を呼び出します。
   * @param {string} branch ブランチ名
   * @param {string} message コミットメッセージ
   * @param {{type:string,path:string,content?:string}[]} changes 変更一覧
   * @returns {Promise<any>} コミット応答（id など）
   */
  async createCommitWithActions(branch: string, message: string, changes: Array<{ type: string; path: string; content?: string }>) {
    const url = `${this.baseUrl}/repository/commits`
    const actions = changes.map((c) => {
      if (c.type === 'delete') return { action: 'delete', file_path: c.path }
      if (c.type === 'create') return { action: 'create', file_path: c.path, content: c.content }
      return { action: 'update', file_path: c.path, content: c.content }
    })
    /**
     * GitLab のコミット API を呼び出します。
     * @param {string} branch ブランチ名
     * @param {string} message コミットメッセージ
     * @param {{type:string,path:string,content?:string}[]} changes 変更一覧
     * @returns {Promise<any>} 作成されたコミットの識別子
     */
    const body = JSON.stringify({ branch, commit_message: message, actions })

    const res = await this.fetchWithRetry(url, { method: 'POST', headers: this.headers, body })
    const text = await res.text().catch(() => '')
    let j: any = null
    try {
      j = text ? JSON.parse(text) : null
    } catch (err) {
      throw new Error(`GitLab commit invalid JSON response: ${text}`)
    }

    // validate expected fields (GitLab returns 'id' for commit id)
    if (!j || (!j.id && !j.commit)) {
      throw new Error(`GitLab commit unexpected response: ${JSON.stringify(j)}`)
    }
    return j.id || j.commit || j
  }

  /**
   * fetch をリトライ付きで実行します。
   * @param {string} url リクエスト URL
   * @param {RequestInit} opts fetch オプション
   * @param {number} [retries] 最大リトライ回数
   * @returns {Promise<Response>} レスポンス
   */
  private async fetchWithRetry(url: string, opts: RequestInit, retries = this.maxRetries): Promise<Response> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, opts)
        if (!this.isRetryableStatus(res.status)) return res
        if (attempt === retries) return res
        const wait = this.backoffMs(attempt)
        await new Promise((r) => setTimeout(r, wait))
      } catch (err) {
        if (attempt === retries) throw err
        const wait = this.backoffMs(attempt)
        await new Promise((r) => setTimeout(r, wait))
      }
    }
    // should not reach here
    throw new Error('fetchWithRetry: unexpected exit')
  }

  /**
   * ステータスが再試行対象か判定します。
   * @param {number} status ステータスコード
   * @returns {boolean}
   */
  private isRetryableStatus(status: number) {
    return status === 429 || (status >= 500 && status < 600)
  }

  /**
   * バックオフ時間を計算します。
   * @param {number} attempt 試行回数（1..）
   * @returns {number} ミリ秒
   */
  private backoffMs(attempt: number) {
    const base = this.baseBackoff * Math.pow(2, attempt - 1)
    const jitter = Math.floor(Math.random() * base * 0.3)
    return base + jitter
  }

  // small concurrency mapper used for fetching files
  private async mapWithConcurrency<T, R>(items: T[], mapper: (_t: T) => Promise<R>, concurrency = 5) {
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
    await Promise.all(runners)
    return results
  }

  /**
   * リポジトリのスナップショットを取得します。
   * @param {string} branch ブランチ名 (default: 'main')
   */
  async fetchSnapshot(branch = 'main', concurrency = 5) {
    const treeRes = await this.fetchWithRetry(`${this.baseUrl}/repository/tree?recursive=true&ref=${encodeURIComponent(branch)}`, { method: 'GET', headers: this.headers })
    const treeJ = await treeRes.json()
    const files = Array.isArray(treeJ) ? treeJ.filter((t: any) => t.type === 'blob') : []
    const snapshot: Record<string, string> = {}

    await this.mapWithConcurrency(files, async (f: any) => {
      try {
        const rawRes = await this.fetchWithRetry(`${this.baseUrl}/repository/files/${encodeURIComponent(f.path)}/raw?ref=${encodeURIComponent(branch)}`, { method: 'GET', headers: this.headers })
        if (!rawRes.ok) {
          if (typeof console !== 'undefined' && (console as any).debug) (console as any).debug('fetchSnapshot file failed', f.path, rawRes.status)
          return null
        }
        const content = await rawRes.text()
        snapshot[f.path] = content
      } catch (e) {
        if (typeof console !== 'undefined' && (console as any).debug) (console as any).debug('fetchSnapshot file error', f.path, e)
      }
      return null
    }, concurrency)

    return { headSha: branch, snapshot }
  }
}

export default GitLabAdapter
