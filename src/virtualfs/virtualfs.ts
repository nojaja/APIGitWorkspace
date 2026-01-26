import { IndexFile } from './types'
import { StorageBackend } from './storageBackend'
import { OpfsStorage } from './opfsStorage'
import { shaOf, shaOfGitBlob } from './hashUtils'
import { LocalChangeApplier } from './localChangeApplier'
import { LocalFileManager } from './localFileManager'
import { IndexManager } from './indexManager'
import { ChangeTracker } from './changeTracker'
import { ConflictManager } from './conflictManager'
import { RemoteSynchronizer } from './remoteSynchronizer'

type RemoteSnapshotDescriptor = {
  headSha: string
  shas: Record<string, string>
  fetchContent: (_paths: string[]) => Promise<Record<string, string>>
}

/** Virtual file system - 永続化バックエンドを抽象化した仮想ファイルシステム */
export class VirtualFS {
  private storageDir: string | undefined
  // `workspace` state moved to StorageBackend implementations; tombstones are
  // persisted in the backend as `info` entries with `state: 'remove'`.
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
  constructor(options?: { storageDir?: string; backend?: StorageBackend }) {
    this.storageDir = options?.storageDir
    if (options?.backend) this.backend = options.backend
    else this.backend = new OpfsStorage()
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
   * コンテンツから SHA1 を計算します。
   * @param {string} content コンテンツ
   * @returns {string} 計算された SHA
   */
  // SHA helpers delegated to ./hashUtils.ts

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
    return this.indexManager.loadIndex()
  }

  /**
   * 内部インデックスを永続化します。
   * @returns {Promise<void>}
   */
  private async saveIndex() {
    return this.indexManager.saveIndex()
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
   * Read content from base segment.
   * @param {string} filepath ファイルパス
   * @returns {Promise<string|null>} content or null if not present
   */
  private async _readBaseContent(filepath: string): Promise<string | null> {
    // Delegate directly to StorageBackend - no caching needed
    return await this.backend.readBlob(filepath, 'base')
  }

  /**
   * Classify a remote path during pull: reconcile against local base if possible.
   * @param p file path
   * @param sha remote blob sha
   * @param normalized normalized remote descriptor
   * @param pathsToFetch accumulator for paths requiring fetch
   * @param reconciledPaths accumulator for paths reconciled from base
   * @returns {Promise<boolean>} true if reconciled/no-fetch required, false when fetch is needed
   */
  private async _classifyRemotePathForPull(p: string, sha: string, normalized: RemoteSnapshotDescriptor, pathsToFetch: string[], reconciledPaths: string[]): Promise<boolean> {
    let entry: any = undefined
    const infoTxt = await this.backend.readBlob(p, 'info')
    if (infoTxt) entry = JSON.parse(infoTxt)
    if (!entry) return false
    if (entry.baseSha === sha) return true

    const baseContent = await this._readBaseContent(p)
    if (baseContent !== null) {
      const gitSha = await shaOfGitBlob(baseContent)
      if (gitSha === sha) {
        entry.baseSha = sha
        entry.state = entry.state || 'base'
        entry.updatedAt = Date.now()
        await this.backend.writeBlob(p, JSON.stringify(entry), 'info')
        // base segment is managed by backend; info entry update is sufficient
        reconciledPaths.push(p)
        return true
      }
    }
    return false
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
   * internal wrapper for ConflictManager.areAllResolved
   * kept for test coverage and backwards compatibility
   */
  /**
   * internal wrapper for ConflictManager.areAllResolved
   * @param {Array<any>} conflicts - コンフリクト一覧
   * @returns {Promise<boolean>} 全て解決済みならtrue
   */
  private async _areAllResolved(conflicts: Array<any>): Promise<boolean> {
    for (const c of conflicts) {
      const p = c.path
      let ie: any = undefined
      const infoTxt = await this.backend.readBlob(p, 'info')
      if (infoTxt) ie = JSON.parse(infoTxt)
      if (!ie) {
        const index = await this.getIndex()
        ie = index.entries[p]
      }
      if (!ie || !ie.remoteSha || ie.baseSha !== ie.remoteSha) return false
    }
    return true
  }

  /**
   * internal wrapper for ConflictManager.promoteResolvedConflicts
   * kept for test coverage and backwards compatibility
   */
  /**
   * internal wrapper for ConflictManager.promoteResolvedConflicts
   * @param {Array<any>} conflicts - コンフリクト一覧
   * @param {Record<string,string>} baseSnapshot - ベーススナップショット
   * @param {string} remoteHead - リモートHEAD
   * @returns {Promise<void>}
   */
  private async _promoteResolvedConflicts(conflicts: Array<any>, baseSnapshot: Record<string, string>, remoteHead: string): Promise<void> {
    if (!(await this._areAllResolved(conflicts))) return
    for (const c of conflicts) {
      await this._promoteResolvedConflictEntry(c, baseSnapshot)
    }
    this.indexManager.setHead(remoteHead)
    await this.saveIndex()
  }

  /**
   * internal wrapper for ConflictManager.promoteResolvedConflictEntry
   * @param {any} entry - コンフリクトエントリ
   * @param {Record<string,string>} baseSnapshot - ベーススナップショット
   * @returns {Promise<void>}
   */
  private async _promoteResolvedConflictEntry(entry: any, baseSnapshot: Record<string, string>): Promise<void> {
    return await this.conflictManager.promoteResolvedConflictEntry(entry, baseSnapshot)
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
   * 指定スナップショットから追加・更新対象のパス一覧を計算します。
   * @param {Record<string,string>} snapshot path->content マップ
   * @param {Record<string,string>} newShas path->sha マップ
   * @returns {string[]} 追加/更新すべきパスの配列
   */
  private async _computeToAddOrUpdate(snapshot: Record<string, string>, newShas: Record<string, string>) {
    const out: string[] = []
    for (const [p] of Object.entries(snapshot)) {
      const sha = newShas[p]
      // Query backend info to check if base blob SHA matches
      let entry: any = undefined
      const infoTxt = await this.backend.readBlob(p, 'info')
      if (infoTxt) entry = JSON.parse(infoTxt)
      if (!entry || entry.baseSha !== sha) out.push(p)
    }
    return out
  }
  /**
   * 指定スナップショットから削除対象のパス一覧を計算します。
   * @param {Record<string,string>} snapshot リモートの path->content マップ
   * @returns {string[]} 削除すべきパスの配列
   */
  private async _computeToRemove(snapshot: Record<string, string>) {
    const out: string[] = []
    // Query backend info store for all paths that exist in base
    const infos = await this.backend.listFiles(undefined, 'info')
    for (const it of infos) {
      const p = it.path
      if (!(p in snapshot)) out.push(p)
    }
    return out
  }

  /**
   * 指定パス群を削除として backend に反映します。
   * @param {string[]} toRemove 削除するパスの配列
   * @returns {Promise<void>}
   */
  private async _applyRemovals(toRemove: string[]) {
    for (const p of toRemove) {
      // Backend manages base segment; just cleanup info and all segments
      await this.backend.deleteBlob(p)
      let ie: any = undefined
      const infoTxt = await this.backend.readBlob(p, 'info')
      if (infoTxt) ie = JSON.parse(infoTxt)
      if (ie && ie.state === 'base') {
        await this.backend.deleteBlob(p, 'info')
      }
    }
  }

  /**
   * 指定パス群を base に追加/更新し、backend に書き込みます。
   * @param {string[]} toAddOrUpdate 追加/更新するパス
   * @param {Record<string,string>} snapshot path->content マップ
   * @param {Record<string,string>} newShas path->sha マップ
   * @returns {Promise<void>}
   */
  private async _applyAddsOrUpdates(toAddOrUpdate: string[], snapshot: Record<string, string>, newShas: Record<string, string>) {
    for (const p of toAddOrUpdate) {
      const content = snapshot[p]
      const sha = newShas[p]
      // Backend manages base segment persistence; just persist blob and update info
      await this.backend.writeBlob(p, content, 'base')
      let existing: any = undefined
      const infoTxt = await this.backend.readBlob(p, 'info')
      if (infoTxt) existing = JSON.parse(infoTxt)
      if (!existing) {
        const entry = { path: p, state: 'base', baseSha: sha, updatedAt: Date.now() }
        await this.backend.writeBlob(p, JSON.stringify(entry), 'info')
      } else if (existing.state === 'base') {
        existing.baseSha = sha
        existing.updatedAt = Date.now()
        await this.backend.writeBlob(p, JSON.stringify(existing), 'info')
      }
    }
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
    return this.indexManager.listPaths()
  }

  /**
    * ワークスペースとインデックスから変更セットを生成します。
    * @returns {Promise<Array<{type:string,path:string,content?:string,baseSha?:string}>>} 変更リスト
    */
    async getChangeSet() {
    return await this.changeTracker.getChangeSet()
  }

  /**
   * インデックスエントリとワークスペースを比較して削除変更を検出する
   * @returns Array<{type:'delete',path:string,baseSha:string}>
   */
  private async _changesFromIndexDeletes(): Promise<Array<{ type: 'delete'; path: string; baseSha: string }>> {
    const out: Array<{ type: 'delete'; path: string; baseSha: string }> = []
    const index = await this.getIndex()
    for (const [p, entry] of Object.entries(index.entries || {})) {
      try {
        const ie: any = entry as any
        if (!ie || !ie.baseSha) continue
        // If workspace has a blob, it's not a delete
        const ws = await this.backend.readBlob(p, 'workspace')
        if (ws !== null) continue
        // No workspace blob and an index baseSha implies local deletion
        out.push({ type: 'delete', path: p, baseSha: ie.baseSha })
      } catch (error) {
        // ignore parse/read errors per existing resilience
        continue
      }
    }
    return out
  }

  /**
   * tombstone からの削除変更リストを生成します。
   * @returns {Array<{type:'delete',path:string,baseSha:string}>}
   */
  private async _changesFromTombstones(): Promise<Array<{ type: 'delete'; path: string; baseSha: string }>> {
    // Tombstone-based delete detection removed. Deletions are determined
    // from index entry state elsewhere. Return empty array to avoid
    // emitting delete changes from tombstones.
    return []
  }

  /**
   * index entries から create/update の変更リストを生成します。
   * @returns {Array<{type:'create'|'update',path:string,content?:string,baseSha?:string}>}
   */
  private async _changesFromIndexEntries(): Promise<Array<{ type: 'create'; path: string; content: string } | { type: 'update'; path: string; content: string; baseSha?: string }>> {
    const out: Array<{ type: 'create'; path: string; content: string } | { type: 'update'; path: string; content: string; baseSha?: string }> = []
    const infos = await this.backend.listFiles(undefined, 'workspace')
    for (const it of infos) {
      const changesFor = await this._changesForIndexFile(it.path, it.info)
      if (changesFor.length > 0) out.push(...changesFor)
    }
    return out
  }

  /**
   * 指定インデックスエントリの info テキストから変更リストを算出します。
   * @param p ファイルパス
   * @param infoTxt info セグメントの JSON テキスト
   * @returns 変更リスト（空配列可能）
   */
  private async _changesForIndexFile(p: string, infoTxt: string | null): Promise<Array<{ type: 'create'; path: string; content: string } | { type: 'update'; path: string; content: string; baseSha?: string }>> {
    const out: Array<{ type: 'create'; path: string; content: string } | { type: 'update'; path: string; content: string; baseSha?: string }> = []
    if (!infoTxt) return out
    let entry: any = undefined
    try { entry = JSON.parse(infoTxt) } catch (_) { return out }
    if (!entry) return out
    const blob = await this.backend.readBlob(p, 'workspace')
    return this._changesFromIndexEntry(entry, p, blob)
  }

  /**
   * インデックスエントリオブジェクトと workspace blob から変更リストを返す（同期処理）。
   * @param entry index entry object
   * @param p file path
   * @param blob workspace blob content or null
    * @returns {Array<{type:'create'|'update',path:string,content?:string,baseSha?:string}>}
   */
  private _changesFromIndexEntry(entry: any, p: string, blob: string | null) {
    const out: Array<{ type: 'create'; path: string; content: string } | { type: 'update'; path: string; content: string; baseSha?: string }> = []
    // created in workspace
    if (entry.state === 'added') {
      if (blob == null) return out
      out.push({ type: 'create', path: p, content: blob })
      return out
    }
    // consider modified/conflict or entries with workspaceSha
    if (!this._isEntryConsidered(entry)) return out
    if (entry.baseSha) {
      if (blob !== null) out.push({ type: 'update', path: p, content: blob, baseSha: entry.baseSha })
    } else {
      if (blob == null) return out
      out.push({ type: 'create', path: p, content: blob })
    }
    return out
  }

  /**
   * 指定エントリが変更リストに含めるべきか判定します。
   * @param entry インデックスエントリ
   * @returns {boolean}
   */
  private _isEntryConsidered(entry: any) {
    return entry.state === 'modified' || entry.state === 'conflict' || (!!entry.workspaceSha && entry.state !== 'added')
  }


  /**
   * リモートスナップショットからの差分取り込み時に、単一パスを評価して
   * 必要なら conflicts に追加、もしくは base を更新します。
   * @returns {Promise<void>}
   */
  private async _handleRemotePath(p: string, perFileRemoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>, remoteHeadSha: string) {
    let indexEntry: any = undefined
    const infoTxt = await this.backend.readBlob(p, 'info')
    if (infoTxt) indexEntry = JSON.parse(infoTxt)
    let localWorkspace: { sha: string; content: string } | undefined = undefined
    const wsBlob = await this.backend.readBlob(p, 'workspace')
    if (wsBlob !== null) {
      const wsSha = indexEntry?.workspaceSha || await shaOf(wsBlob)
      localWorkspace = { sha: wsSha, content: wsBlob }
    }
    // Read base blob from backend instead of in-memory map
    let localBase: { sha: string; content: string } | undefined = undefined
    const baseBlob = await this.backend.readBlob(p, 'base')
    if (baseBlob !== null && indexEntry?.baseSha) {
      localBase = { sha: indexEntry.baseSha, content: baseBlob }
    }

    if (!indexEntry) return await this._handleRemoteNew(p, perFileRemoteSha, baseSnapshot, conflicts, localWorkspace, localBase, remoteHeadSha)
    return await this._handleRemoteExisting(p, indexEntry, perFileRemoteSha, baseSnapshot, conflicts, localWorkspace, remoteHeadSha)
  }

  /**
   * リモートに存在するがローカルにないパスを処理します。
   * @returns {Promise<void>}
   */
  private async _handleRemoteNew(p: string, perFileRemoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>, localWorkspace: { sha: string; content: string } | undefined, localBase: { sha: string; content: string } | undefined, remoteHeadSha: string) {
    const workspaceSha = localWorkspace ? localWorkspace.sha : undefined
    if (localWorkspace) {
      await this._handleRemoteNewConflict(p, baseSnapshot[p], remoteHeadSha, conflicts, workspaceSha, localBase?.sha)
      return
    }
    await this._handleRemoteNewAdd(p, perFileRemoteSha, baseSnapshot, remoteHeadSha, conflicts, workspaceSha, localBase?.sha)
  }

  /**
   * Handle remote-new path when local workspace has uncommitted changes (create conflict).
   * @private
   */
  private async _handleRemoteNewConflict(p: string, content: string | undefined, remoteHeadSha: string, conflicts: Array<import('./types').ConflictEntry>, workspaceSha: string | undefined, baseSha: string | undefined) {
    // workspace has uncommitted changes -> conflict
    await this.conflictManager.persistRemoteContentAsConflict(p, content)
    let ie: any = undefined
    const infoTxt = await this.backend.readBlob(p, 'info')
    if (infoTxt) ie = JSON.parse(infoTxt)
    if (!ie) ie = { path: p }
    await this.conflictManager.setIndexEntryToConflict(p, ie, remoteHeadSha)
    await this.indexManager.saveIndex()
    conflicts.push({ path: p, remoteSha: remoteHeadSha, workspaceSha, baseSha })
  }

  /**
   * Handle adding a new remote path into base when no local workspace changes exist.
   * @private
   */
  private async _handleRemoteNewAdd(p: string, perFileRemoteSha: string, baseSnapshot: Record<string, string>, remoteHeadSha: string, conflicts: Array<import('./types').ConflictEntry>, workspaceSha: string | undefined, baseSha: string | undefined) {
    // safe to add to base
    const content = baseSnapshot[p]
    if (typeof content === 'undefined') {
      let ie: any = undefined
      const infoTxt = await this.backend.readBlob(p, 'info')
      if (infoTxt) ie = JSON.parse(infoTxt)
      if (!ie) ie = { path: p }
      await this.conflictManager.setIndexEntryToConflict(p, ie, remoteHeadSha)
      conflicts.push({ path: p, remoteSha: remoteHeadSha, workspaceSha, baseSha })
      await this.indexManager.saveIndex()
      return
    }
    // Backend manages base segment persistence
    const entry = { path: p, state: 'base', baseSha: perFileRemoteSha, updatedAt: Date.now() }
    await this.backend.writeBlob(p, JSON.stringify(entry), 'info')
    await this.backend.writeBlob(p, content, 'base')
  }

  /**
   * リモートに存在し、かつローカルにエントリがあるパスを処理します。
   * @returns {Promise<void>}
   */
  private async _handleRemoteExisting(p: string, indexEntry: any, perFileRemoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>, localWorkspace: { sha: string; content: string } | undefined, remoteHeadSha: string) {
    const baseSha = indexEntry.baseSha
    if (baseSha === perFileRemoteSha) return
    // remote changed
    if (!localWorkspace || localWorkspace.sha === baseSha) {
      await this._handleRemoteExistingUpdate(p, indexEntry, perFileRemoteSha, baseSnapshot, conflicts, remoteHeadSha)
    } else {
      await this._handleRemoteExistingConflict(p, indexEntry, perFileRemoteSha, baseSnapshot, conflicts, localWorkspace, remoteHeadSha)
    }
  }

  /**
   * workspace に変更が無い場合のリモート更新処理を行う
   * @returns {Promise<void>}
   */
  private async _handleRemoteExistingUpdate(p: string, indexEntry: any, perFileRemoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>, remoteHeadSha: string) {
    const baseSha = indexEntry.baseSha
    const content = baseSnapshot[p]
    if (typeof content === 'undefined') {
      indexEntry.state = 'conflict'
      indexEntry.remoteSha = remoteHeadSha
      indexEntry.updatedAt = Date.now()
      await this.backend.writeBlob(p, JSON.stringify(indexEntry), 'info')
      await this.saveIndex()
      conflicts.push({ path: p, baseSha, remoteSha: remoteHeadSha, workspaceSha: undefined })
      return
    }
    indexEntry.baseSha = perFileRemoteSha
    indexEntry.state = 'base'
    indexEntry.updatedAt = Date.now()
    await this.backend.writeBlob(p, JSON.stringify(indexEntry), 'info')
    await this.backend.writeBlob(p, content, 'base')
  }

  /**
   * workspace が変更されている場合の競合処理（conflict 登録、remote content を .git-conflict に保存）
   * @returns {Promise<void>}
   */
  private async _handleRemoteExistingConflict(p: string, indexEntry: any, perFileRemoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>, localWorkspace: { sha: string; content: string }, remoteHeadSha: string) {
    const baseSha = indexEntry.baseSha
    // persist remote content for inspection under .git-conflict/
    await this.conflictManager.persistRemoteContentAsConflict(p, baseSnapshot[p])
    this.conflictManager.setIndexEntryToConflict(p, indexEntry, remoteHeadSha)
    await this.indexManager.saveIndex()
    conflicts.push({ path: p, baseSha, remoteSha: remoteHeadSha, workspaceSha: localWorkspace?.sha })
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
   * create/update 変更をローカルに適用します。
   * @param {any} ch 変更オブジェクト
   * @returns {Promise<void>}
   */
  private async _applyCreateOrUpdate(ch: any) {
    // Deprecated: logic moved to LocalChangeApplier
    await this.applier.applyCreateOrUpdate(ch)
  }

  /**
   * delete 変更をローカルに適用します。
   * @param {any} ch 変更オブジェクト
   * @returns {Promise<void>}
   */
  private async _applyDelete(ch: any) {
    // Deprecated: logic moved to LocalChangeApplier
    await this.applier.applyDelete(ch)
  }

  /**
   * リモート側で削除されたエントリをローカルに反映します。
   * @returns {Promise<void>}
   */
  private async _handleRemoteDeletion(p: string, indexEntry: any, _remoteShas: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>) {
    let localWorkspace: { sha: string; content: string } | undefined = undefined
    const wsBlob = await this.backend.readBlob(p, 'workspace')
    if (wsBlob !== null) {
      const wsSha = indexEntry?.workspaceSha || await shaOf(wsBlob)
      localWorkspace = { sha: wsSha, content: wsBlob }
    }
    // If the index entry has no baseSha it was created locally (added) and not
    // present in the remote base. In that case, remote lacking the path is NOT
    // a conflict — keep the local addition as-is.
    if (!indexEntry || !indexEntry.baseSha) {
      return
    }

    if (!localWorkspace || localWorkspace.sha === indexEntry.baseSha) {
      // safe to delete locally
      await this.backend.deleteBlob(p, 'info')
      // backend manages base segment persistence; remove blobs from backend
      await this.backend.deleteBlob(p)
    } else {
      conflicts.push({ path: p, baseSha: indexEntry.baseSha, workspaceSha: localWorkspace?.sha })
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
    await this.saveIndex()
    return { commitSha }
  }

  /**
   * Handle push when an adapter is provided (delegates to _pushWithActions/_pushWithGitHubFlow).
   * Records commitKey in index metadata and returns the push result.
   * @returns {Promise<{commitSha:string}>}
   */
  private async _handlePushWithAdapter(input: any, adapter: any) {
    const branch = (input as any).ref || 'main'
    const messageWithKey = `${input.message}\n\napigit-commit-key:${input.commitKey}`
    // If adapter supports createCommitWithActions (GitLab style), use it directly
    if ((adapter as any).createCommitWithActions) {
      (input as any).message = messageWithKey
      const actionResult = await this._pushWithActions(adapter, input, branch)
      this.indexManager.setLastCommitKey(input.commitKey)
      await this.saveIndex()
      return actionResult
    }

    // Fallback to GitHub-style flow
    (input as any).message = messageWithKey
    const gitHubFlowResult = await this._pushWithGitHubFlow(adapter, input, branch)
    this.indexManager.setLastCommitKey(input.commitKey)
    await this.saveIndex()
    return gitHubFlowResult
  }

  /**
   * リモートのスナップショットを取り込み、コンフリクト情報を返します。
   * @param {string} remoteHead リモート HEAD
   * @param {{[path:string]:string}} baseSnapshot path->content マップ
   * @returns {Promise<{conflicts:Array<import('./types').ConflictEntry>}>}
   */
  async pull(remote: RemoteSnapshotDescriptor | string, baseSnapshot?: Record<string, string>) {
    return await this.remoteSynchronizer.pull(remote, baseSnapshot)
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
   * snapshot から remote shas を計算して返す
   * @param baseSnapshot スナップショット
    * @returns {Promise<Record<string,string>>}
   */
  private async _computeRemoteShas(baseSnapshot: Record<string, string>) {
    const remoteShas: Record<string, string> = {}
    for (const [p, c] of Object.entries(baseSnapshot)) {
      remoteShas[p] = await shaOf(c)
    }
    return remoteShas
  }

  /**
   * リモートの追加/更新を処理して conflicts を蓄積する
    * @returns {Promise<void>}
   */
  private async _processRemoteAddsAndUpdates(remoteShas: Record<string, string>, baseSnapshot: Record<string, string>, remoteHead: string, conflicts: Array<import('./types').ConflictEntry>) {
    for (const [p, remoteSha] of Object.entries(remoteShas)) {
      await this._handleRemotePath(p, remoteSha, baseSnapshot, conflicts, remoteHead)
    }
  }

  /**
   * リモートの削除を処理して conflicts を蓄積する
    * @returns {Promise<void>}
   */
  private async _processRemoteDeletions(remoteShas: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>) {
    const infos = await this.backend.listFiles(undefined, 'info')
    for (const it of infos) {
      const p = it.path
      if (!(p in remoteShas)) {
        let indexEntry: any = undefined
        if (it.info) {
          indexEntry = JSON.parse(it.info)
        }
        await this._handleRemoteDeletion(p, indexEntry, remoteShas, conflicts)
      }
    }
  }

  

  /**
   * 変更をコミットしてリモートへ反映します。adapter が無ければローカルシミュレーションします。
   * @param {import('./types').CommitInput} input コミット入力
   * @param {import('../git/adapter').GitAdapter} [adapter] 任意のアダプタ
   * @returns {Promise<{commitSha:string}>}
   */
  async push(input: import('./types').CommitInput, adapter?: import('../git/adapter').GitAdapter) {
    // generate commitKey for idempotency if not provided (must be set for adapter flows)
    if (!input.commitKey) {
      input.commitKey = await this.shaOf((input.parentSha || '') + JSON.stringify(input.changes))
    }

    if (adapter) return await this._handlePushWithAdapter(input, adapter)
    return await this.remoteSynchronizer.push(input, adapter)
  }
}

export default VirtualFS
