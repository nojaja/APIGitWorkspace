import { IndexFile } from './types.ts'
import { StorageBackend } from './storageBackend.ts'
import { OpfsStorage } from './opfsStorage.ts'
import { GitHubAdapter } from '../git/githubAdapter.ts'
import { GitLabAdapter } from '../git/gitlabAdapter.ts'
import { Logger } from '../git/abstractAdapter.ts'
import { shaOf, shaOfGitBlob } from './hashUtils.ts'
import { LocalChangeApplier } from './localChangeApplier.ts'
import { LocalFileManager } from './localFileManager.ts'
import { IndexManager } from './indexManager.ts'
import { ChangeTracker } from './changeTracker.ts'
import { ConflictManager } from './conflictManager.ts'
import { RemoteSynchronizer } from './remoteSynchronizer.ts'

type RemoteSnapshotDescriptor = {
  headSha: string
  shas: Record<string, string>
  fetchContent: (_paths: string[]) => Promise<Record<string, string>>
}

/** Virtual file system - 永続化バックエンドを抽象化した仮想ファイルシステム */
export class VirtualFS {
  // adapter instance managed by VirtualFS
  private adapter: any | null = null
  // optional logger injected via constructor options; propagated to adapters when present
  private logger?: Logger
  // adapter metadata persisted in index
  private adapterMeta: any | null = null
  // `workspace` state moved to StorageBackend implementations; tombstones are
  // persisted in the backend as `info` entries with `state: 'deleted'.`.
  private indexManager: IndexManager
  private backend: StorageBackend
  private applier: LocalChangeApplier
  private localFileManager: LocalFileManager
  private changeTracker: ChangeTracker
  private conflictManager: ConflictManager
  private remoteSynchronizer: RemoteSynchronizer

  /**
   * VirtualFS のインスタンスを初期化します。
   * @param options オプション
   * @returns {void}
   */
  constructor(options?: { backend?: StorageBackend; logger?: Logger }) {
    if (options?.backend) this.backend = options.backend
    else this.backend = new OpfsStorage()
    // capture optional logger for adapter propagation
    if (options && options.logger) this.logger = options.logger
    this.applier = new LocalChangeApplier(this.backend)
    this.localFileManager = new LocalFileManager(this.backend)
    this.indexManager = new IndexManager(this.backend)
    this.changeTracker = new ChangeTracker(this.backend, this.indexManager)
    this.conflictManager = new ConflictManager(this.backend, this.indexManager)
    this.remoteSynchronizer = new RemoteSynchronizer(this.backend, this.indexManager, this.conflictManager, this.applier)
  }

  /**
   * public-facing property accessors for backwards compatibility with tests
   * @returns {string}
   */
  get head(): string {
    return this.indexManager.getHead()
  }
  /**
   * Setter for head
   * @param {string} h - head value
   * @returns {void}
   */
  set head(h: string) {
    this.indexManager.setHead(h)
  }

  /**
   * Get lastCommitKey
   * @returns {string|undefined}
   */
  get lastCommitKey(): string | undefined {
    return this.indexManager.getLastCommitKey()
  }
  /**
   * Set lastCommitKey
   * @param {string|undefined} k
   * @returns {void}
   */
  set lastCommitKey(k: string | undefined) {
    this.indexManager.setLastCommitKey(k)
  }

  /**
   * SHA-1 helper wrapper (delegates to ./hashUtils)
   * @param {string} content - ハッシュ対象の文字列
   * @returns {Promise<string>} SHA-1 ハッシュの16進表現
   */
  async shaOf(content: string): Promise<string> {
    return await shaOf(content)
  }

  /**
   * SHA helper for Git blob formatting
   * @param {string} content - blob コンテンツ
   * @returns {Promise<string>} SHA-1 ハッシュの16進表現（git blob 用）
   */
  async shaOfGitBlob(content: string): Promise<string> {
    return await shaOfGitBlob(content)
  }

  /**
   * VirtualFS の初期化を行います（バックエンド初期化と index 読み込み）。
   * @returns {Promise<void>}
   */
  async init() {
    await this.backend.init()
    await this.loadIndex()
  }

  /**
   * 永続化レイヤーから index を読み込み、内部マップを初期化します。
   * @returns {Promise<void>}
   */
  private async loadIndex() {
    await this.indexManager.loadIndex()
    try {
      const index = await this.indexManager.getIndex()
      this.adapterMeta = (index as any).adapter || null
    } catch (_error) {
      this.adapterMeta = null
    }
  }

  /**
   * Set adapter instance and persist adapter metadata into index file.
   * @param adapter adapter instance (or null to clear)
   * @param meta metadata to persist (e.g. { type:'github', opts: {...} })
   * @returns {Promise<void>}
   */
  async setAdapter(adapter: any | null, meta?: any) {
    this.adapter = adapter
    this.adapterMeta = meta || null
    // If adapter instance provided, propagate logger when available
    try {
      if (this.adapter && this.logger && typeof (this.adapter as any).setLogger === 'function') {
        (this.adapter as any).setLogger(this.logger)
      }
    } catch (_error) {
      // best-effort logging injection; ignore failures
    }
    try {
      const index = await this.indexManager.getIndex()
      if (this.adapterMeta) (index as any).adapter = this.adapterMeta
      else delete (index as any).adapter
      await this.backend.writeIndex(index)
    } catch (_error) {
      // best-effort persistence; ignore failures here
    }
  }

  /**
   * Return persisted adapter metadata from the index (or cached meta).
   * This does not necessarily instantiate the adapter instance; use
   * `getAdapterInstance()` to obtain an instantiated adapter.
   * @returns {Promise<any|null>}
   */
  async getAdapter(): Promise<any | null> {
    if (this.adapterMeta) return this.adapterMeta
    try {
      const index = await this.indexManager.getIndex()
      this.adapterMeta = (index as any).adapter || null
      return this.adapterMeta
    } catch (_error) {
      return null
    }
  }

  /**
   * Return or lazily create the adapter instance based on persisted metadata.
   * @returns {Promise<any|null>}
   */
  async getAdapterInstance(): Promise<any | null> {
    if (this.adapter) return this.adapter
    // ensure adapterMeta populated from loaded index
    if (!this.adapterMeta) {
      try {
        const index = await this.indexManager.getIndex()
        this.adapterMeta = (index as any).adapter || null
      } catch (_error) {
        this.adapterMeta = null
      }
    }
    if (!this.adapterMeta || !this.adapterMeta.type) return null
    const type = this.adapterMeta.type
    const options = this.adapterMeta.opts || {}
    // instantiate via helper to reduce cognitive complexity for linter
    const created = this._instantiateAdapter(type, options)
    if (created) this.adapter = created
    return this.adapter || null
  }

  /**
   * Create adapter instance for given type and options. Returns null on failure.
   * @param type adapter type string
   * @param opts adapter options
   * @returns {any|null}
   */
  private _instantiateAdapter(type: string, options: any): any | null {
    try {
      // Merge in logger if available so created adapters receive it via DI
      const optionsWithLogger = { ...(options || {}) } as any
      if (this.logger) optionsWithLogger.logger = this.logger
      if (type === 'github') return new GitHubAdapter(optionsWithLogger)
      if (type === 'gitlab') return new GitLabAdapter(optionsWithLogger)
    } catch (_error) {
      return null
    }
    return null
  }

  /**
   * Return persisted adapter metadata (if any).
   * @returns {any|null}
   */
  getAdapterMeta(): any | null {
    return this.adapterMeta
  }
 
  /**
   * ファイルを書き込みます（ローカル編集）。
   * @param {string} filepath ファイルパス
   * @param {string} content コンテンツ
   * @returns {Promise<void>}
   */
  async writeFile(filepath: string, content: string) {
    // delegate workspace write to LocalFileManager then reload index
    await this.localFileManager.writeFile(filepath, content)
    await this.loadIndex()
  }

  /**
   * ファイルを削除します（トゥームストーン作成を含む）。
   * @param {string} filepath ファイルパス
   * @returns {Promise<void>}
   */
  async deleteFile(filepath: string) {
    // delegate delete to LocalFileManager then reload index
    await this.localFileManager.deleteFile(filepath)
    await this.loadIndex()
  }

  /**
   * rename を delete + create の合成で行うヘルパ
   * @param from 元パス
   * @param to 新パス
   */
  async renameFile(from: string, to: string) {
    // Use readFile to obtain actual content from workspace, backend blob, or base.
    const content = await this.readFile(from)
    if (content === null) throw new Error('source not found')

    // create new workspace entry with the same content
    await this.writeFile(to, content)

    // delete original path (creates tombstone if base existed)
    await this.deleteFile(from)
  }

  /**
   * ワークスペース/ベースからファイル内容を読み出します。
   * @param {string} filepath ファイルパス
   * @returns {Promise<string|null>} ファイル内容または null
   */
  async readFile(filepath: string) {
    return await this.localFileManager.readFile(filepath)
  }

  /**
   * 衝突ファイル（.git-conflict/配下）を取得します。
   * @param {string} filepath ファイルパス
   * @returns {Promise<string|null>} ファイル内容または null
   */
  async readConflict(filepath: string) {
    return await this.conflictManager.readConflict(filepath)
  }

  /**
   * 指定パスのリモート衝突ファイル (.git-conflict/) を削除して
   * 競合を解消済とマークします。
   * @param {string} filepath ファイルパス
   * @returns {Promise<boolean>} 成功したら true
   */
  async resolveConflict(filepath: string) {
    return await this.conflictManager.resolveConflict(filepath)
  }

  /**
   * リモートのベーススナップショットを適用します。
   * @param {{[path:string]:string}} snapshot path->content のマップ
   * @param {string} headSha リモート HEAD
   * @returns {Promise<void>}
   */
  async applyBaseSnapshot(snapshot: Record<string, string>, headSha: string) {
    return await this.remoteSynchronizer.applyBaseSnapshot(snapshot, headSha)
  }

  /**
   * 指定エラーが non-fast-forward を示すか判定します。
   * @param {any} err 例外オブジェクト
   * @returns {boolean}
   */
  private _isNonFastForwardError(error: any) {
    const message = String(error && error.message ? error.message : error)
    return message.includes('422') || /fast\s*forward/i.test(message) || /not a fast forward/i.test(message)
  }

  /**
   * インデックス情報を返します。
   * @returns {Promise<IndexFile>}
   */
  async getIndex(): Promise<IndexFile> {
    return this.indexManager.getIndex()
  }

  /**
   * 登録されているパス一覧を返します。
   * @returns {string[]}
   */
  async listPaths(): Promise<string[]> {
    // Build paths from the reconstructed index so that workspace-local
    // info (workspace/info) takes precedence over git-scoped info.
    const index = await this.indexManager.getIndex()
    const entries = (index && (index as any).entries) || {}
    const out: string[] = []
    for (const k of Object.keys(entries)) {
      try {
        const v = (entries as any)[k]
        if (v && v.state === 'deleted') continue
      } catch (_error) {
        // ignore and include
      }
      out.push(k)
    }
    return out
  }

  /**
    * ワークスペースとインデックスから変更セットを生成します。
    * @returns {Promise<Array<{type:string,path:string,content?:string,baseSha?:string}>>} 変更リスト
    */
    async getChangeSet() {
    return await this.changeTracker.getChangeSet()
  }

  /**
   * ローカルに対する変更（create/update/delete）を適用するヘルパー
   * @param {any} ch 変更オブジェクト
   * @returns {Promise<void>}
   */
  private async _applyChangeLocally(ch: any) {
    if (ch.type === 'create' || ch.type === 'update') {
      const sha = await shaOf(ch.content)
      // Backend manages base segment persistence
      let entry: any = undefined
      const infoTxt = await this.backend.readBlob(ch.path, 'info')
      if (infoTxt) entry = JSON.parse(infoTxt)
      if (!entry) entry = { path: ch.path }
      entry.baseSha = sha
      entry.state = 'base'
      entry.updatedAt = Date.now()
      entry.workspaceSha = undefined
      await this.backend.writeBlob(ch.path, JSON.stringify(entry), 'info')

      // Delegate to LocalChangeApplier which will persist base and clean workspace in the correct order
      await this.applier.applyCreateOrUpdate(ch)
    } else if (ch.type === 'delete') {
      await this.applier.applyDelete(ch)
    }
  }

  /**
   * GitLab 風の actions ベースコミットフローで push を実行します。
   * @returns {Promise<{commitSha:string}>}
   */
  private async _pushWithActions(adapter: any, input: any, branch: string) {
    const commitSha = await adapter.createCommitWithActions(branch, input.message, input.changes as any[], input.parentSha)
    await this._tryUpdateRef(adapter, branch, commitSha)
    return await this._applyChangesAndFinalize(commitSha, input)
  }

  /**
   * GitHub 風の blob/tree/commit フローで push を実行します。
   * @returns {Promise<{commitSha:string}>}
   */
  private async _pushWithGitHubFlow(adapter: any, input: any, branch: string) {
    const blobMap = await adapter.createBlobs(input.changes as any[])
    const changesWithBlob = (input.changes as any[]).map((c) => ({ ...c, blobSha: blobMap[c.path] }))
    // Attempt to base the new tree on the parent commit's tree so we only modify diffs
    let baseTreeSha: string | undefined = undefined
    if (input.parentSha && typeof (adapter as any).getCommitTreeSha === 'function') {
      try {
        baseTreeSha = await (adapter as any).getCommitTreeSha(input.parentSha)
      } catch (error) {
        // ignore and proceed without base_tree if fetching fails
        baseTreeSha = undefined
      }
    }
    const treeSha = await adapter.createTree(changesWithBlob, baseTreeSha)
    const commitSha = await adapter.createCommit(input.message, input.parentSha, treeSha)
    await this._tryUpdateRef(adapter, branch, commitSha)
    return await this._applyChangesAndFinalize(commitSha, input)
  }

  /**
   * Try to update remote ref and handle common non-fast-forward errors.
   * Throws when the remote reports a non-fast-forward conflict.
   */
  private async _tryUpdateRef(adapter: any, branch: string, commitSha: string) {
    if (typeof adapter.updateRef === 'function') {
      try {
        await adapter.updateRef(`heads/${branch}`, commitSha)
      } catch (error: any) {
        if (this._isNonFastForwardError(error)) {
          throw new Error('非互換な更新 (non-fast-forward): pull が必要です')
        }
        if (typeof console !== 'undefined' && (console as any).warn) (console as any).warn('updateRef failed (non-422), continuing locally:', error)
      }
    }
  }

  /**
   * Apply changes locally, update index head and persist index.
   * Returns the commit result object for callers.
   * @returns {Promise<{commitSha:string}>}
   */
  private async _applyChangesAndFinalize(commitSha: string, input: any) {
    for (const ch of input.changes as any[]) {
      await this._applyChangeLocally(ch)
    }
    this.indexManager.setHead(commitSha)
    await this.indexManager.saveIndex()
    return { commitSha }
  }

  /**
   * Handle push when an adapter is provided (delegates to _pushWithActions/_pushWithGitHubFlow).
   * Records commitKey in index metadata and returns the push result.
   * @returns {Promise<{commitSha:string}>}
   */
  private async _handlePushWithAdapter(input: any, adapter: any) {
    const branch = (input as any).ref || (this.adapterMeta && this.adapterMeta.opts && this.adapterMeta.opts.branch) || 'main'
    const messageWithKey = `${input.message}\n\napigit-commit-key:${input.commitKey}`
    // If adapter supports createCommitWithActions (GitLab style), use it directly
    if ((adapter as any).createCommitWithActions) {
      (input as any).message = messageWithKey
      const actionResult = await this._pushWithActions(adapter, input, branch)
      this.indexManager.setLastCommitKey(input.commitKey)
      await this.indexManager.saveIndex()
      return actionResult
    }

    // Fallback to GitHub-style flow
    (input as any).message = messageWithKey
    const gitHubFlowResult = await this._pushWithGitHubFlow(adapter, input, branch)
    this.indexManager.setLastCommitKey(input.commitKey)
    await this.indexManager.saveIndex()
    return gitHubFlowResult
  }

  /**
   * リモートのスナップショットを取り込み、コンフリクト情報を返します。
   * @param {string} remoteHead リモート HEAD
   * @param {{[path:string]:string}} baseSnapshot path->content マップ
   * @returns {Promise<{conflicts:Array<import('./types').ConflictEntry>}>}
   */
  async pull(
    remote: RemoteSnapshotDescriptor | string | { fetchSnapshot: () => Promise<RemoteSnapshotDescriptor> },
    baseSnapshot?: Record<string, string>
  ) {
    const descriptorRaw = await this._resolveDescriptor(remote, baseSnapshot)
    const normalized: RemoteSnapshotDescriptor =
      typeof descriptorRaw === 'string' ? await this._normalizeRemoteInput(descriptorRaw, baseSnapshot) : (descriptorRaw as RemoteSnapshotDescriptor)

    const preIndex = await this.getIndex()
    const preIndexKeys = Object.keys(preIndex.entries)

    const pullResult: any = await this.remoteSynchronizer.pull(normalized, baseSnapshot)

    const postIndex = await this.getIndex()
    const postIndexKeys = Object.keys(postIndex.entries)
    const preSet = new Set(preIndexKeys)
    const addedPaths = postIndexKeys.filter((k) => !preSet.has(k))
    const remotePaths = Object.keys(normalized.shas || {})

    return {
      ...pullResult,
      remote: normalized,
      remotePaths,
      preIndexKeys,
      postIndexKeys,
      addedPaths
    }
  }

  /**
   * Normalize remote input which may be a headSha or a full descriptor.
   * @param {RemoteSnapshotDescriptor | string} remote remote descriptor or headSha
   * @param {Record<string,string>=} baseSnapshot optional snapshot when remote is a headSha
   * @returns {Promise<RemoteSnapshotDescriptor>} normalized descriptor
   */
  private async _normalizeRemoteInput(remote: RemoteSnapshotDescriptor | string, baseSnapshot?: Record<string, string>): Promise<RemoteSnapshotDescriptor> {
    if (typeof remote !== 'string') return remote
    const snapshot = baseSnapshot || {}
    const shas: Record<string, string> = {}
    for (const [p, c] of Object.entries(snapshot)) shas[p] = await shaOf(c)
    /**
     * Fetch content for the requested paths from the provided snapshot.
     * @param {string[]} paths requested paths
     * @returns {Promise<Record<string,string>>} path->content map
     */
    async function fetchContent(paths: string[]): Promise<Record<string, string>> {
      const out: Record<string, string> = {}
      for (const p of paths) {
        if (p in snapshot) out[p] = snapshot[p]
      }
      return out
    }
    return { headSha: remote, shas, fetchContent }
  }

  /**
   * Obtain remote snapshot (via persisted adapter if available) and
   * compute simple diffs against the current index.
   * Returns an object containing the resolved `remote` descriptor (or null),
   * `remoteShas` map and `diffs` array (strings like `added: path` / `updated: path`).
   * @returns {Promise<{remote: RemoteSnapshotDescriptor|null, remoteShas: Record<string,string>, diffs: string[]}>}
   */
  async getRemoteDiffs(
    remote?: RemoteSnapshotDescriptor | string | { fetchSnapshot: () => Promise<RemoteSnapshotDescriptor> }
  ): Promise<{ remote: RemoteSnapshotDescriptor | null; remoteShas: Record<string, string>; diffs: string[] } > {
    let resolved: RemoteSnapshotDescriptor | string | null = null
    try {
      resolved = await this._resolveDescriptor(remote as any, undefined)
    } catch (_error) {
      resolved = null
    }

    const normalized = await this._toNormalizedDescriptor(resolved)
    const remoteShas: Record<string, string> = normalized?.shas || {}

    const diffs: string[] = []
    const index = await this.getIndex().catch(() => null)
    if (!index) return { remote: normalized, remoteShas, diffs }

    for (const [p, sha] of Object.entries(remoteShas)) {
      const entry = index.entries[p]
      if (!entry) diffs.push(`added: ${p}`)
      else if (entry.baseSha !== sha) diffs.push(`updated: ${p}`)
    }

    return { remote: normalized, remoteShas, diffs }
  }

  /**
   * Normalize a resolved descriptor (string headSha or object) into a
   * RemoteSnapshotDescriptor or null. Helper to reduce cognitive complexity.
   * @returns {Promise<RemoteSnapshotDescriptor|null>} 正規化された descriptor または null
   */
  private async _toNormalizedDescriptor(resolved: RemoteSnapshotDescriptor | string | null): Promise<RemoteSnapshotDescriptor | null> {
    if (!resolved) return null
    if (typeof resolved !== 'string') return resolved as RemoteSnapshotDescriptor
    try {
      return await this._normalizeRemoteInput(resolved, {})
    } catch (_error) {
      return null
    }
  }

  /**
   * Resolve the provided `remote` parameter into either a headSha string or a full
   * `RemoteSnapshotDescriptor`. Centralizes adapter fetching and fallback behavior
   * to keep `pull()` small and easier to lint.
   * @param remote remote descriptor or adapter-like object or headSha
   * @param baseSnapshot optional snapshot used when normalizing a headSha
   * @returns {Promise<RemoteSnapshotDescriptor|string>} resolved descriptor or headSha
   */
  private async _resolveDescriptor(
    remote: RemoteSnapshotDescriptor | string | { fetchSnapshot: () => Promise<RemoteSnapshotDescriptor> } | undefined,
    baseSnapshot?: Record<string, string>
  ): Promise<RemoteSnapshotDescriptor | string> {
    const remoteLike: any = remote as any
    const isAdapterLike = remoteLike && typeof remoteLike === 'object' && typeof remoteLike.fetchSnapshot === 'function' && !('headSha' in remoteLike)

    if (isAdapterLike) {
      const fromAdapter = await this._fetchSnapshotFromAdapterInstance()
      if (!fromAdapter) throw new Error('Adapter instance not available')
      return fromAdapter
    }

    if (remote === undefined || remote === null) {
      const fromAdapter = await this._fetchSnapshotFromAdapterInstance()
      if (fromAdapter) return fromAdapter
      return await this._normalizeRemoteInput('', baseSnapshot || {})
    }

    return remote as any
  }

  /**
   * Try to obtain a snapshot descriptor from the persisted adapter instance.
   * @returns {Promise<RemoteSnapshotDescriptor|null>} snapshot descriptor or null when unavailable
   */
  private async _fetchSnapshotFromAdapterInstance(): Promise<RemoteSnapshotDescriptor | null> {
    const adapterInstance = await this.getAdapterInstance()
    if (adapterInstance && typeof adapterInstance.fetchSnapshot === 'function') {
      // prefer branch configured in persisted adapter metadata, default to 'main'
      const branch = (this.adapterMeta && this.adapterMeta.opts && this.adapterMeta.opts.branch) || 'main'
      return await adapterInstance.fetchSnapshot(branch)

    }
    return null
  }

  /**
   * 変更をコミットしてリモートへ反映します。adapter が無ければローカルシミュレーションします。
   * @param {import('./types').CommitInput} input コミット入力
   * @returns {Promise<{commitSha:string}>}
   */
  async push(input: import('./types.ts').CommitInput) {
    // generate commitKey for idempotency if not provided (must be set for adapter flows)
    if (!input.commitKey) {
      input.commitKey = await this.shaOf((input.parentSha || '') + JSON.stringify(input.changes))
    }

    // Otherwise try to obtain a persisted/instantiated adapter from this VirtualFS.
    const instAdapter = await this.getAdapterInstance()
    if (instAdapter) {
      return await this._handlePushWithAdapter(input, instAdapter)
    }

    // Fallback: no adapter available -> perform local-only push via RemoteSynchronizer
    return await this.remoteSynchronizer.push(input)
  }
}

export default VirtualFS
