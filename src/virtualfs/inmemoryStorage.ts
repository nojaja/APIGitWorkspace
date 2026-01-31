import { IndexFile } from './types.ts'
import { StorageBackend, StorageBackendConstructor } from './storageBackend.ts'
import { updateInfoForWrite } from './metadataManager.ts'

const BRANCH_SEP = '::'
const SEG_WORKSPACE = 'workspace'
const SEG_INFO_WORKSPACE = 'info-workspace'
const SEG_INFO_GIT = 'info-git'

/**
 * テストや軽量動作検証用のインメモリ実装。
 * `StorageBackend` を実装し、アプリケーション側で差し替えて利用できます。
 */
export const InMemoryStorage: StorageBackendConstructor = class InMemoryStorage implements StorageBackend {
  private rootKey: string
  private currentBranch: string | null = null

  // shared storage across instances keyed by root name
  private static stores: Map<string, {
    index: IndexFile,
    workspaceBlobs: Map<string,string>,
    baseBlobs: Map<string,string>,
    conflictBlobs: Map<string,string>,
    infoBlobs: Map<string,string>
  }> = new Map()

  /**
   * 静的: この実装が利用可能かを同期判定します。
   * テスト/インメモリなので常に true を返します。
   * @returns {boolean} 利用可能なら true
   */
  static canUse(): boolean {
    return true
  }
  /**
   * 利用可能なルート名を返します。
   * @returns {string[]} ルート名の配列
   */
  static availableRoots(): string[] {
    const keys = Array.from(InMemoryStorage.stores.keys())
    return keys.length ? keys : ['apigit_storage']
  }
  // legacy canUseOpfs removed; use static canUse() instead
  /**
   * コンストラクタ。互換性のためにディレクトリ名を受け取るが無視する。
   * @param directory 任意のディレクトリ文字列（使用しない）
   */
  constructor(directory?: string) {
    // If caller provides a directory name, share storage by that name. If omitted, create isolated store per instance.
    this.rootKey = directory ?? `__inmem_${Math.random().toString(36).slice(2)}`
    if (!InMemoryStorage.stores.has(this.rootKey)) {
      InMemoryStorage.stores.set(this.rootKey, {
        index: { head: '', entries: {} },
        workspaceBlobs: new Map(),
        baseBlobs: new Map(),
          conflictBlobs: new Map(),
          infoBlobs: new Map()
      })
    }
  }

  /**
   *
   */
  setBranch(branch?: string | null): void {
    this.currentBranch = branch || null
  }

  /**
   * 初期化処理（インメモリでは何もしない）
   * @returns {Promise<void>} 解決時に初期化完了
   */
  async init(): Promise<void> {
    return
  }

  /**
   * 現在の `IndexFile` を返します。
   * @returns {Promise<IndexFile|null>} IndexFile（常に非null）
   */
  async readIndex(): Promise<IndexFile | null> {
    const store = InMemoryStorage.stores.get(this.rootKey)!
    // Reconstruct entries from infoBlobs map
    const result: IndexFile = { head: store.index.head || '', entries: {} }
    

    // Determine branch scope and load info entries
    const branch = this.currentBranch || 'main'
    // First, load workspace-local info entries (unprefixed keys)
    this._loadInMemoryWorkspaceInfo(store, result, branch)
    this._loadInMemoryBranchInfo(store, result, branch)
    if ((store.index as any).lastCommitKey) result.lastCommitKey = (store.index as any).lastCommitKey
    // Preserve adapter metadata if present
    if ((store.index as any).adapter) result.adapter = (store.index as any).adapter
    return result
  }

  /**
   * Load workspace-local info entries into result.entries (unprefixed keys)
    * @returns {void}
   */
  private _loadInMemoryWorkspaceInfo(store: any, result: IndexFile, branch: string): void {
    for (const [k, v] of store.infoBlobs.entries()) {
      if (k.startsWith(branch + BRANCH_SEP)) continue
      try {
        const parsed = JSON.parse(v)
        result.entries[k] = parsed
      } catch (_error) { continue }
    }
  }

  /**
   * Load branch-scoped info entries into result.entries without overwriting workspace-local entries
    * @returns {void}
   */
  private _loadInMemoryBranchInfo(store: any, result: IndexFile, branch: string): void {
    for (const [k, v] of store.infoBlobs.entries()) {
      if (!k.startsWith(branch + BRANCH_SEP)) continue
      const filepath = k.slice((branch + BRANCH_SEP).length)
      if (result.entries[filepath]) continue
      try {
        const parsed = JSON.parse(v)
        if (parsed && parsed.state === 'deleted') continue
        result.entries[filepath] = parsed
      } catch (_error) { continue }
    }
  }

  /**
   * IndexFile を設定します。
   * @param idx 書き込む IndexFile
   */
  async writeIndex(index: IndexFile): Promise<void> {
    const store = InMemoryStorage.stores.get(this.rootKey)!
    // write entries individually to infoBlobs, then persist meta
    const entries = index.entries || {}
    
    // Persist index entries into workspace-local info (unprefixed keys)
    // Only write info entries for files that exist in workspace or in base (branch-scoped)
    const branch = this.currentBranch || 'main'
    for (const filepath of Object.keys(entries)) {
      const existsInWorkspace = store.workspaceBlobs.has(filepath)
      const existsInBase = store.baseBlobs.has(`${branch}${BRANCH_SEP}${filepath}`)
      if (!existsInWorkspace && !existsInBase) continue
      store.infoBlobs.set(filepath, JSON.stringify(entries[filepath]))
    }
    const meta: any = { head: index.head }
    if ((index as any).lastCommitKey) meta.lastCommitKey = (index as any).lastCommitKey
    if ((index as any).adapter) meta.adapter = (index as any).adapter
    store.index = Object.assign({}, meta, { entries: {} })
  }

  /**
   * 指定パスに対して文字列コンテンツを保存します。
   * @param filepath ファイルパス
   * @param content ファイル内容
   */
  async writeBlob(filepath: string, content: string, segment?: any): Promise<void> {
    const seg = segment || SEG_WORKSPACE
    const store = InMemoryStorage.stores.get(this.rootKey)!
    this._applyBlobToStore(store, seg, filepath, content)
    // update info metadata when writing to workspace/base/conflict
    // For workspace writes, if a git base exists for this file, treat this
    // update as coming from the git base and build workspace/info based on
    // the git-scoped info; otherwise fall back to the default helper.
    if (seg === SEG_WORKSPACE) {
      const handled = await this._handleWorkspaceBlobWrite(store, filepath, content)
      if (handled) return
    }
    // For explicit info-workspace/info-git writes, we've already stored
    // the provided content directly; skip the generic metadata updater
    if (seg === SEG_INFO_WORKSPACE || seg === SEG_INFO_GIT) return

    const wrapped = seg === SEG_WORKSPACE ? this._wrapStoreForInfoNoPrefix(store) : this._wrapStoreForInfoPrefix(store)
    await updateInfoForWrite(wrapped, filepath, seg, content)
  }

  /**
   * Handle workspace blob writes that should be based on existing git-scoped info.
   * Returns true when the operation is handled and caller should return early.
   */
  /**
   * Handle workspace blob writes that should be based on existing git-scoped info.
   * Returns true when the operation is handled and caller should return early.
   * @returns {Promise<boolean>}
   */
  private async _handleWorkspaceBlobWrite(store: any, filepath: string, content: string): Promise<boolean> {
    const branch = this.currentBranch || 'main'
    const gitBaseKey = `${branch}${BRANCH_SEP}${filepath}`
    if (!store.baseBlobs.has(gitBaseKey)) return false
    const gitInfoTxt = store.infoBlobs.has(gitBaseKey) ? store.infoBlobs.get(gitBaseKey)! : null
    let existing: any = undefined
    if (gitInfoTxt) {
      try { existing = JSON.parse(gitInfoTxt) } catch (_error) { existing = undefined }
    }
    const sha = await this.shaOf(content)
    const now = Date.now()
    const entry = this._buildWorkspaceInfoEntry(existing, filepath, sha, now)
    store.infoBlobs.set(filepath, JSON.stringify(entry))
    return true
  }

  /**
   * Persist a blob into the appropriate in-memory map for the segment.
   * @returns {void}
   */
  private _applyBlobToStore(store: any, seg: string, filepath: string, content: string): void {
    const branch = this.currentBranch || 'main'
    if (seg === SEG_WORKSPACE) store.workspaceBlobs.set(filepath, content)
    else if (seg === 'base') store.baseBlobs.set(`${branch}${BRANCH_SEP}${filepath}`, content)
    else if (seg === 'conflict') store.conflictBlobs.set(`${branch}${BRANCH_SEP}${filepath}`, content)
    // Writes to the generic 'info' segment should create/update the
    // workspace-local (unprefixed) info entry so that subsequent
    // readBlob('info') returns the expected value. Dedicated helpers
    // exist for explicit workspace/git info variants.
    else if (seg === 'info') store.infoBlobs.set(filepath, content)
    else if (seg === SEG_INFO_WORKSPACE) store.infoBlobs.set(filepath, content)
    else if (seg === SEG_INFO_GIT) store.infoBlobs.set(`${branch}${BRANCH_SEP}${filepath}`, content)
    else throw new Error('unknown segment')
  }

  /**
   * Build the info entry for a write into a given segment.
   * @returns {any} info entry object
   */
  private _buildInfoEntryForSeg(seg: string, existing: any, filepath: string, sha: string, now: number): any {
    if (seg === SEG_WORKSPACE) return this._buildWorkspaceInfoEntry(existing, filepath, sha, now)
    if (seg === 'base') return this._buildBaseInfoEntry(existing, filepath, sha, now)
    if (seg === 'conflict') return this._buildConflictInfoEntry(existing, filepath, now)
    return { path: filepath, updatedAt: now }
  }

  /**
   * Build info entry when writing to the workspace segment
   * @returns {any}
   */
  private _buildWorkspaceInfoEntry(existing: any, filepath: string, sha: string, now: number): any {
    const entry: any = { path: filepath, updatedAt: now }
    if (existing && existing.baseSha) entry.baseSha = existing.baseSha
    entry.workspaceSha = sha
    entry.state = entry.baseSha ? 'modified' : 'added'
    if (existing && existing.remoteSha) entry.remoteSha = existing.remoteSha
    return entry
  }

  /**
   * Build info entry when writing to the base segment
   * @returns {any}
   */
  private _buildBaseInfoEntry(existing: any, filepath: string, sha: string, now: number): any {
    const entry: any = { path: filepath, updatedAt: now }
    if (existing && existing.workspaceSha) entry.workspaceSha = existing.workspaceSha
    entry.baseSha = sha
    entry.state = 'base'
    if (existing && existing.remoteSha) entry.remoteSha = existing.remoteSha
    return entry
  }

  /**
   * Build info entry when writing to the conflict segment
   * @returns {any}
   */
  private _buildConflictInfoEntry(existing: any, filepath: string, now: number): any {
    const entry: any = { path: filepath, updatedAt: now }
    if (existing && existing.baseSha) entry.baseSha = existing.baseSha
    if (existing && existing.workspaceSha) entry.workspaceSha = existing.workspaceSha
    if (existing && existing.remoteSha) entry.remoteSha = existing.remoteSha
    entry.state = 'conflict'
    return entry
  }

  /**
   * 指定パスの内容を取得します。
   * @param filepath ファイルパス
   * @returns {Promise<string|null>} 内容、存在しなければ null
   */
  async readBlob(filepath: string, segment?: any): Promise<string | null> {
    const store = InMemoryStorage.stores.get(this.rootKey)!
    return this._readInMemoryBlob(store, filepath, segment)
  }

  /**
   * Read blob with segment logic extracted for clarity.
   * @returns {string | null}
   */
  private _readInMemoryBlob(store: any, filepath: string, segment?: any): string | null {
    // Delegate segment-specific handling to a helper for clarity
    if (segment !== undefined) return this._readInMemoryBlobWithSegment(store, filepath, String(segment))

    const workspace = store.workspaceBlobs
    if (workspace && workspace.has(filepath)) return workspace.get(filepath)!
    const base = store.baseBlobs
    const branch = this.currentBranch || 'main'
    if (base && base.has(`${branch}${BRANCH_SEP}${filepath}`)) return base.get(`${branch}${BRANCH_SEP}${filepath}`)!
    return null
  }

  /**
   * Handle reading when a segment is explicitly provided.
   * @returns {string | null}
   */
  private _readInMemoryBlobWithSegment(store: any, filepath: string, seg: string): string | null {
    const branch = this.currentBranch || 'main'
    // Normalize info-git to info
    if (seg === SEG_INFO_GIT) {
      // explicit git-scoped info: prefer branch-prefixed entry
      const key = `${branch}${BRANCH_SEP}${filepath}`
      if (store.infoBlobs.has(key)) return store.infoBlobs.get(key)!
      return null
    }
    if (seg === SEG_INFO_WORKSPACE) return store.infoBlobs.has(filepath) ? store.infoBlobs.get(filepath)! : null

    const segmentToStore = {
      [SEG_WORKSPACE]: store.workspaceBlobs,
      base: store.baseBlobs,
      conflict: store.conflictBlobs,
      info: store.infoBlobs,
    } as Record<string, Map<string, string>>
    const m = segmentToStore[seg]
    if (!m) return null
    // First try unprefixed key (covers workspace and workspace-local info)
    if (m.has(filepath)) return m.get(filepath)!
    const key = `${branch}${BRANCH_SEP}${filepath}`
    return m.has(key) ? m.get(key)! : null
  }

  /**
   * 指定パスのエントリを削除します。
   * @param filepath ファイルパス
   */
  async deleteBlob(filepath: string, segment?: any): Promise<void> {
    // If segment specified, delete only that segment
    const store = InMemoryStorage.stores.get(this.rootKey)!
    const branch = this.currentBranch || 'main'
    if (segment === SEG_WORKSPACE) { store.workspaceBlobs.delete(filepath); return }
    if (segment === 'base') { store.baseBlobs.delete(`${branch}${BRANCH_SEP}${filepath}`); return }
    if (segment === 'conflict') { store.conflictBlobs.delete(`${branch}${BRANCH_SEP}${filepath}`); return }
    if (segment === 'info') { store.infoBlobs.delete(filepath); store.infoBlobs.delete(`${branch}${BRANCH_SEP}${filepath}`); return }
    if (segment === SEG_INFO_WORKSPACE) { store.infoBlobs.delete(filepath); return }
    if (segment === SEG_INFO_GIT) { store.infoBlobs.delete(`${branch}${BRANCH_SEP}${filepath}`); return }
    // otherwise delete from all segments
    store.workspaceBlobs.delete(filepath)
    store.baseBlobs.delete(`${branch}${BRANCH_SEP}${filepath}`)
    store.conflictBlobs.delete(`${branch}${BRANCH_SEP}${filepath}`)
    store.infoBlobs.delete(`${branch}${BRANCH_SEP}${filepath}`)
    store.infoBlobs.delete(filepath)
  }

  /**
   * 指定プレフィックス配下のファイル一覧を取得します。
   * @param prefix プレフィックス（例: 'dir/sub'）
   * @param segment セグメント（'workspace' 等）。省略時は 'workspace'
   * @param recursive サブディレクトリも含めるか。省略時は true
  * @returns {Promise<Array<{ path: string; info: string | null }>>}
   */
  async listFiles(prefix?: string, segment?: any, recursive = true): Promise<Array<{ path: string; info: string | null }>> {
    const seg = segment || SEG_WORKSPACE
    const store = InMemoryStorage.stores.get(this.rootKey)!
    const segmentToStore = {
      [SEG_WORKSPACE]: store.workspaceBlobs,
      base: store.baseBlobs,
      conflict: store.conflictBlobs,
      info: store.infoBlobs,
    } as Record<string, Map<string, string>>

    const m = segmentToStore[String(seg)]
    if (!m) return []

    const p = prefix ? prefix.replace(/^\/+|\/+$/g, '') : ''
    let keys = Array.from(m.keys())
    // For info store include both unprefixed (workspace-local) keys and branch-prefixed keys
    if (seg === 'info') {
      const branch = this.currentBranch || 'main'
      const unpref = keys.filter((k) => !k.startsWith(branch + BRANCH_SEP))
      const pref = keys.filter((k) => k.startsWith(branch + BRANCH_SEP)).map((k) => k.slice((branch + BRANCH_SEP).length))
      // merge with workspace-local keys first (they take precedence)
      const merged = Array.from(new Set(unpref.concat(pref)))
      keys = merged
    } else if (seg !== SEG_WORKSPACE) {
      const branch = this.currentBranch || 'main'
      keys = keys.filter((k) => k.startsWith(branch + BRANCH_SEP)).map((k) => k.slice((branch + BRANCH_SEP).length))
    }
    keys = this._filterKeys(keys, p, recursive)

    return this._collectFilesInMemory(keys, store)
  }

  /**
   * Collect file info objects for keys array (InMemory implementation).
   * @returns {Array<{path:string, info:string|null}>}
   */
  private _collectFilesInMemory(keys: string[], store: any): Array<{ path: string; info: string | null }> {
    const out: Array<{ path: string; info: string | null }> = []
    const branch = this.currentBranch || 'main'
    for (const k of keys) {
      let info: string | null = null
      if (store.infoBlobs.has(k)) info = store.infoBlobs.get(k)!
      else if (store.infoBlobs.has(`${branch}${BRANCH_SEP}${k}`)) info = store.infoBlobs.get(`${branch}${BRANCH_SEP}${k}`)!
      out.push({ path: k, info })
    }
    return out
  }

  /**
   * Filter keys by prefix and recursion flag for InMemoryStorage
   * @returns {string[]}
   */
  private _filterKeys(keys: string[], p: string, recursive: boolean): string[] {
    if (p) keys = keys.filter((k) => k === p || k.startsWith(p + '/'))
    if (!recursive) {
      keys = keys.filter((k) => {
        const rest = p ? k.slice(p.length + (p ? 1 : 0)) : k
        return !rest.includes('/')
      })
    }
    return keys
  }

  /**
   * Wrap store to present branch-prefixed info accessors
   * @returns {any} wrapped store view for info access
   */
  private _wrapStoreForInfoPrefix(store: any): any {
    const branch = this.currentBranch || 'main'
    /**
     * Create branch-prefixed storage key
     * @param {string} k key path
     * @returns {string} prefixed key
     */
    const prefixKey = (k: string) => `${branch}${BRANCH_SEP}${k}`
    return Object.assign({}, store, {
      infoBlobs: {
        /** Check whether prefixed key exists
         * @returns {boolean}
         */
        has: (k: string) => store.infoBlobs.has(k) || store.infoBlobs.has(prefixKey(k)),
        /** Get value preferring unprefixed then branch-prefixed key
         * @returns {string | undefined}
         */
        get: (k: string) => {
          if (store.infoBlobs.has(k)) return store.infoBlobs.get(k)
          return store.infoBlobs.get(prefixKey(k))
        },
        /** Set value: prefer updating an existing unprefixed entry if present;
         * otherwise write into the branch-prefixed key. This preserves the
         * expected read semantics where workspace-local info takes precedence.
         * @returns {any}
         */
        set: (k: string, v: string) => {
          if (store.infoBlobs.has(k)) return store.infoBlobs.set(k, v)
          return store.infoBlobs.set(prefixKey(k), v)
        },
        /** Delete both unprefixed and prefixed keys
         * @returns {boolean}
         */
        delete: (k: string) => { store.infoBlobs.delete(k); return store.infoBlobs.delete(prefixKey(k)) }
      }
    })
  }

  /**
   * Wrap store to present unprefixed info accessors
   * @returns {any} wrapped store view for info access
   */
  private _wrapStoreForInfoNoPrefix(store: any): any {
    return Object.assign({}, store, {
      infoBlobs: {
        /** Check whether key exists
         * @returns {boolean}
         */
        has: (k: string) => store.infoBlobs.has(k),
        /** Get value for key
         * @returns {string | undefined}
         */
        get: (k: string) => store.infoBlobs.get(k),
        /** Set value for key
         * @returns {void}
         */
        set: (k: string, v: string) => store.infoBlobs.set(k, v),
        /** Delete key
         * @returns {boolean}
         */
        delete: (k: string) => store.infoBlobs.delete(k)
      }
    })
  }

  /**
   * Calculate SHA-1 hex digest of given content.
   * @param content Input string
   * @returns {Promise<string>} Hex encoded SHA-1 digest
   */
  private async shaOf(content: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * 指定されたルート名を削除します
   * @param rootName 削除するルート名
   * @returns {void}
   */
  static delete(rootName: string): void {
    if (InMemoryStorage.stores.has(rootName)) {
      InMemoryStorage.stores.delete(rootName)
    } else {
      throw new Error(`InMemory root "${rootName}" not found`)
    }
  }

}

export default InMemoryStorage
