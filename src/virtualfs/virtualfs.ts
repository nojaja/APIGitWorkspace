import { IndexFile } from './types'
import { StorageBackend } from './storageBackend'
import { OpfsStorage } from './opfsStorage'

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
  private head: string = ''
  private lastCommitKey: string | undefined
  private backend: StorageBackend

  /**
   * VirtualFS のインスタンスを初期化します。
   * @param options オプション
   * @returns {void}
   */
  constructor(options?: { storageDir?: string; backend?: StorageBackend }) {
    this.storageDir = options?.storageDir
    if (options?.backend) this.backend = options.backend
    else this.backend = new OpfsStorage()
  }


  /**
   * コンテンツから SHA1 を計算します。
   * @param {string} content コンテンツ
   * @returns {string} 計算された SHA
   */
  private async shaOf(content: string) {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  /** Git blob の SHA1 (ヘッダ込み) を算出します。
   * @param {string} content コンテンツ
   * @returns {Promise<string>} 計算された SHA
   */
  private async shaOfGitBlob(content: string): Promise<string> {
    const encoder = new TextEncoder()
    const body = encoder.encode(content)
    const header = encoder.encode(`blob ${body.byteLength}\0`)
    const merged = new Uint8Array(header.length + body.length)
    merged.set(header)
    merged.set(body, header.length)
    const hashBuffer = await crypto.subtle.digest('SHA-1', merged)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
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
    try {
      const raw = await this.backend.readIndex()
      if (raw) {
        this.head = raw.head || ''
        this.lastCommitKey = (raw as any).lastCommitKey
        // Base segment is managed by StorageBackend; no in-memory cache needed
      }
    } catch (error) {
      this.head = ''
      this.lastCommitKey = undefined
      await this.saveIndex()
    }
  }

  /**
   * 内部インデックスを永続化します。
   * @returns {Promise<void>}
   */
  private async saveIndex() {
    const index: IndexFile = { head: this.head, entries: {} }
    if (this.lastCommitKey) (index as any).lastCommitKey = this.lastCommitKey
    await this.backend.writeIndex(index)
  }
 
  /**
   * ファイルを書き込みます（ローカル編集）。
   * @param {string} filepath ファイルパス
   * @param {string} content コンテンツ
   * @returns {Promise<void>}
   */
  async writeFile(filepath: string, content: string) {
    // persist workspace blob under backend; backend will update index/info
    await this.backend.writeBlob(`${filepath}`, content, 'workspace')
    // Index updates are handled by the backend; reload index to pick up changes.
    await this.loadIndex()
  }

  /**
   * ファイルを削除します（トゥームストーン作成を含む）。
   * @param {string} filepath ファイルパス
   * @returns {Promise<void>}
   */
  async deleteFile(filepath: string) {
    // If file existed in base, mark its info entry as removed (logical delete)
    let entry: any = undefined
    const infoTxt = await this.backend.readBlob(filepath, 'info')
    if (infoTxt) entry = JSON.parse(infoTxt)
    if (entry && entry.baseSha) {
      entry.state = 'remove'
      entry.deletedAt = Date.now()
      await this.backend.writeBlob(filepath, JSON.stringify(entry), 'info')
      // remove any workspace copy; backend will manage base segment
      await this.backend.deleteBlob(`${filepath}`, 'workspace')
      await this.loadIndex()
      return
    }
    // created in workspace and deleted before push: remove workspace cache and info blob
    await this.backend.deleteBlob(`${filepath}`, 'workspace')
    await this.backend.deleteBlob(`${filepath}`, 'info')
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
    // try workspace blob in backend first (read-through)
    const wsBlob = await this.backend.readBlob(filepath, 'workspace')
    if (wsBlob !== null) return wsBlob
    // then try base (.git-base) - backend handles all base segment access
    const baseBlob = await this.backend.readBlob(filepath, 'base')
    if (baseBlob !== null) return baseBlob
    return null
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
      const gitSha = await this.shaOfGitBlob(baseContent)
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
    const blob = await this.backend.readBlob(filepath, 'conflict')
    if (blob !== null) return blob
    return null
  }

  /**
   * 指定パスのリモート衝突ファイル (.git-conflict/) を削除して
   * 競合を解消済とマークします。
   * @param {string} filepath ファイルパス
   * @returns {Promise<boolean>} 成功したら true
   */
  async resolveConflict(filepath: string) {
    try {
      // Read remote conflict content
      const remoteContent = await this.backend.readBlob(filepath, 'conflict')
      let ie: any = undefined
      const infoTxt = await this.backend.readBlob(filepath, 'info')
      if (infoTxt) ie = JSON.parse(infoTxt)
      // fallback to index entries if backend has no info blob (tests may set index directly)
      if (!ie) {
        const index = await this.getIndex()
        ie = index.entries[filepath]
      }
      // If we have remote content and an index entry with remoteSha, promote it to base
      if (remoteContent !== null && ie && ie.remoteSha) {
        // write to .git-base
        await this.backend.writeBlob(filepath, remoteContent, 'base')
        // update index entry: set baseSha to remoteSha, clear remoteSha, set state to base
        ie.baseSha = ie.remoteSha
        delete ie.remoteSha
        ie.state = 'base'
        ie.updatedAt = Date.now()
        await this.backend.writeBlob(filepath, JSON.stringify(ie), 'info')
      } else if (ie && ie.remoteSha) {
        // no blob but remoteSha present: still update baseSha to remoteSha (content unknown)
        ie.baseSha = ie.remoteSha
        delete ie.remoteSha
        ie.state = 'base'
        ie.updatedAt = Date.now()
        await this.backend.writeBlob(filepath, JSON.stringify(ie), 'info')
      }

      // remove conflict blob if present
      try {
        await this.backend.deleteBlob(filepath, 'conflict')
      } catch (_) {
        // ignore
      }

      await this.saveIndex()
      await this.loadIndex()
      return true
    } catch (_) {
      return false
    }
  }

  /**
   * リモートのベーススナップショットを適用します。
   * @param {{[path:string]:string}} snapshot path->content のマップ
   * @param {string} headSha リモート HEAD
   * @returns {Promise<void>}
   */
  async applyBaseSnapshot(snapshot: Record<string, string>, headSha: string) {
    const newShas: Record<string, string> = {}
    for (const [p, c] of Object.entries(snapshot)) newShas[p] = await this.shaOf(c)

    const toAddOrUpdate = await this._computeToAddOrUpdate(snapshot, newShas)
    const toRemove = await this._computeToRemove(snapshot)

    await this._applyRemovals(toRemove)
    await this._applyAddsOrUpdates(toAddOrUpdate, snapshot, newShas)

    this.head = headSha
    await this.saveIndex()
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
    const index = await this.backend.readIndex()
    return index || { head: this.head, entries: {} }
  }

  /**
   * 登録されているパス一覧を返します。
   * @returns {string[]}
   */
  async listPaths(): Promise<string[]> {
      const infos = await this.backend.listFiles(undefined, 'info')
      // Exclude entries that are logically removed (state === 'remove')
      const out: string[] = []
      for (const it of infos) {
        if (!it.info) {
          out.push(it.path)
          continue
        }
        try {
          const ie = JSON.parse(it.info)
          if (ie && ie.state === 'remove') continue
        } catch (_) {
          // on parse error, include the path conservatively
        }
        out.push(it.path)
      }
      return out
  }

  /**
    * ワークスペースとインデックスから変更セットを生成します。
    * @returns {Promise<Array<{type:string,path:string,content?:string,baseSha?:string}>>} 変更リスト
    */
    async getChangeSet() {
    // produce Change[] per spec
    type Change =
      | { type: 'create'; path: string; content: string }
      | { type: 'update'; path: string; content: string; baseSha?: string }
      | { type: 'delete'; path: string; baseSha: string }

    const changes: Change[] = []
    const tombChanges = await this._changesFromTombstones()
    changes.push(...tombChanges)
    const indexChanges = await this._changesFromIndexEntries()
    changes.push(...indexChanges)
    return changes
  }

  /**
   * tombstone からの削除変更リストを生成します。
   * @returns {Array<{type:'delete',path:string,baseSha:string}>}
   */
  private async _changesFromTombstones(): Promise<Array<{ type: 'delete'; path: string; baseSha: string }>> {
    const out: Array<{ type: 'delete'; path: string; baseSha: string }> = []
    const infos = await this.backend.listFiles(undefined, 'info')
    for (const it of infos) {
      if (!it.info) continue
      try {
        const ie = JSON.parse(it.info)
        if (ie && ie.state === 'remove' && ie.baseSha) {
          out.push({ type: 'delete', path: it.path, baseSha: ie.baseSha })
        }
      } catch (_) {
        // ignore parse errors
      }
    }
    return out
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
    let e: any = undefined
    try { e = JSON.parse(infoTxt) } catch (_) { return out }
    if (!e) return out
    const blob = await this.backend.readBlob(p, 'workspace')
    return this._changesFromIndexEntry(e, p, blob)
  }

  /**
   * インデックスエントリオブジェクトと workspace blob から変更リストを返す（同期処理）。
   * @param e index entry object
   * @param p file path
   * @param blob workspace blob content or null
    * @returns {Array<{type:'create'|'update',path:string,content?:string,baseSha?:string}>}
   */
  private _changesFromIndexEntry(e: any, p: string, blob: string | null) {
    const out: Array<{ type: 'create'; path: string; content: string } | { type: 'update'; path: string; content: string; baseSha?: string }> = []
    // created in workspace
    if (e.state === 'added') {
      if (blob == null) return out
      out.push({ type: 'create', path: p, content: blob })
      return out
    }
    // consider modified/conflict or entries with workspaceSha
    if (!this._isEntryConsidered(e)) return out
    if (e.baseSha) {
      if (blob !== null) out.push({ type: 'update', path: p, content: blob, baseSha: e.baseSha })
    } else {
      if (blob == null) return out
      out.push({ type: 'create', path: p, content: blob })
    }
    return out
  }

  /**
   * 指定エントリが変更リストに含めるべきか判定します。
   * @param e インデックスエントリ
   * @returns {boolean}
   */
  private _isEntryConsidered(e: any) {
    return e.state === 'modified' || e.state === 'conflict' || (!!e.workspaceSha && e.state !== 'added')
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
      const wsSha = indexEntry?.workspaceSha || await this.shaOf(wsBlob)
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
    await this._persistRemoteContentAsConflict(p, content)
    let ie: any = undefined
    const infoTxt = await this.backend.readBlob(p, 'info')
    if (infoTxt) ie = JSON.parse(infoTxt)
    if (!ie) ie = { path: p }
    await this._setIndexEntryToConflict(p, ie, remoteHeadSha)
    await this.saveIndex()
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
      await this._setIndexEntryToConflict(p, ie, remoteHeadSha)
      conflicts.push({ path: p, remoteSha: remoteHeadSha, workspaceSha, baseSha })
      await this.saveIndex()
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
    await this._persistRemoteContentAsConflict(p, baseSnapshot[p])
    // record remoteHeadSha in index for later resolution
    this._setIndexEntryToConflict(p, indexEntry, remoteHeadSha)
    await this.saveIndex()
    conflicts.push({ path: p, baseSha, remoteSha: remoteHeadSha, workspaceSha: localWorkspace?.sha })
  }

  /**
   * Persist remote content into conflict segment if content is provided.
   * @param p file path
   * @param content remote content
   */
  private async _persistRemoteContentAsConflict(p: string, content: string | undefined) {
    if (typeof content === 'undefined') return
    try {
      await this.backend.writeBlob(p, content, 'conflict')
    } catch (error) {
      // バックエンドの書き込みエラーは競合保存の補助処理で無視する
      return
    }
  }

  /**
   * Mark an index entry as conflict and store it in index.
   * @param p file path
   * @param ie index entry object
   * @param remoteHeadSha remote head sha to record
   */
  private async _setIndexEntryToConflict(p: string, ie: any, remoteHeadSha: string) {
    ie.state = 'conflict'
    ie.remoteSha = remoteHeadSha
    ie.updatedAt = Date.now()
    await this.backend.writeBlob(p, JSON.stringify(ie), 'info')
  }

  /**
   * Promote a single resolved conflict into base (helper for _promoteResolvedConflicts).
   * @param c conflict entry
   * @param baseSnapshot snapshot map
   */
  private async _promoteResolvedConflictEntry(c: import('./types').ConflictEntry, baseSnapshot: Record<string, string>) {
    const p = c.path
    let ie: any = undefined
    const infoTxt = await this.backend.readBlob(p, 'info')
    if (infoTxt) ie = JSON.parse(infoTxt)
    if (!ie) return
    // Prefer baseSnapshot content; if not available, query backend for base segment
    let content = typeof baseSnapshot[p] !== 'undefined' ? baseSnapshot[p] : null
    if (content === null) {
      content = await this.backend.readBlob(p, 'base')
    }
    if (content !== null) {
      // Backend manages base segment persistence
      await this.backend.writeBlob(p, content, 'base')
    }
    ie.baseSha = ie.remoteSha
    delete ie.remoteSha
    ie.state = 'base'
    ie.updatedAt = Date.now()
    await this.backend.writeBlob(p, JSON.stringify(ie), 'info')
    await this.backend.deleteBlob(p, 'conflict')
  }

  /**
   * ローカルに対する変更（create/update/delete）を適用するヘルパー
   * @param {any} ch 変更オブジェクト
   * @returns {Promise<void>}
   */
  private async _applyChangeLocally(ch: any) {
    if (ch.type === 'create' || ch.type === 'update') {
      const sha = await this.shaOf(ch.content)
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

      // Delegate to helper which will persist base and clean workspace in the correct order
      await this._applyCreateOrUpdate(ch)
    } else if (ch.type === 'delete') {
      await this._applyDelete(ch)
    }
  }

  /**
   * create/update 変更をローカルに適用します。
   * @param {any} ch 変更オブジェクト
   * @returns {Promise<void>}
   */
  private async _applyCreateOrUpdate(ch: any) {
    // Ensure workspace copy is removed first (delete may remove all segments),
    // then persist base blob so it remains.
    await this.backend.deleteBlob(ch.path, 'workspace')
    await this.backend.writeBlob(ch.path, ch.content, 'base')
  }

  /**
   * delete 変更をローカルに適用します。
   * @param {any} ch 変更オブジェクト
   * @returns {Promise<void>}
   */
  private async _applyDelete(ch: any) {
    await this.backend.deleteBlob(ch.path, 'info')
    // Backend manages base segment; remove blobs from backend
    await this.backend.deleteBlob(ch.path)
    await this.backend.deleteBlob(ch.path, 'workspace')
  }

  /**
   * リモート側で削除されたエントリをローカルに反映します。
   * @returns {Promise<void>}
   */
  private async _handleRemoteDeletion(p: string, e: any, _remoteShas: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>) {
    let localWorkspace: { sha: string; content: string } | undefined = undefined
    const wsBlob = await this.backend.readBlob(p, 'workspace')
    if (wsBlob !== null) {
      const wsSha = e?.workspaceSha || await this.shaOf(wsBlob)
      localWorkspace = { sha: wsSha, content: wsBlob }
    }
    // If the index entry has no baseSha it was created locally (added) and not
    // present in the remote base. In that case, remote lacking the path is NOT
    // a conflict — keep the local addition as-is.
    if (!e || !e.baseSha) {
      return
    }

    if (!localWorkspace || localWorkspace.sha === e.baseSha) {
      // safe to delete locally
      await this.backend.deleteBlob(p, 'info')
      // backend manages base segment persistence; remove blobs from backend
      await this.backend.deleteBlob(p)
    } else {
      conflicts.push({ path: p, baseSha: e.baseSha, workspaceSha: localWorkspace?.sha })
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
      } catch (e) {
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
    this.head = commitSha
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
      const res = await this._pushWithActions(adapter, input, branch)
      this.lastCommitKey = input.commitKey
      await this.saveIndex()
      return res
    }

    // Fallback to GitHub-style flow
    (input as any).message = messageWithKey
    const res = await this._pushWithGitHubFlow(adapter, input, branch)
    this.lastCommitKey = input.commitKey
    await this.saveIndex()
    return res
  }

  /**
   * リモートのスナップショットを取り込み、コンフリクト情報を返します。
   * @param {string} remoteHead リモート HEAD
   * @param {{[path:string]:string}} baseSnapshot path->content マップ
   * @returns {Promise<{conflicts:Array<import('./types').ConflictEntry>}>}
   */
  async pull(remote: RemoteSnapshotDescriptor | string, baseSnapshot?: Record<string, string>) {
    const normalized = await this._normalizeRemoteInput(remote, baseSnapshot)

    const conflicts: Array<import('./types').ConflictEntry> = []
    const pathsToFetch: string[] = []
    const reconciledPaths: string[] = []

    // Classify each remote path: either reconcile from existing base or mark for fetch
    for (const [p, sha] of Object.entries(normalized.shas)) {
      const classified = await this._classifyRemotePathForPull(p, sha, normalized, pathsToFetch, reconciledPaths)
      if (!classified) pathsToFetch.push(p)
    }

    const fetched = await normalized.fetchContent(pathsToFetch)
    await this._processRemoteAddsAndUpdates(normalized.shas, fetched, normalized.headSha, conflicts)
    await this._processRemoteDeletions(normalized.shas, conflicts)

    if (conflicts.length === 0) {
      this.head = normalized.headSha
      await this.saveIndex()
      return { conflicts, fetchedPaths: pathsToFetch, reconciledPaths }
    }

    await this._promoteResolvedConflicts(conflicts, fetched, normalized.headSha)

    if (reconciledPaths.length > 0) await this.saveIndex()

    return { conflicts, fetchedPaths: pathsToFetch, reconciledPaths }
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
    for (const [p, c] of Object.entries(snapshot)) shas[p] = await this.shaOf(c)
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
      remoteShas[p] = await this.shaOf(c)
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
        let e: any = undefined
        if (it.info) {
          e = JSON.parse(it.info)
        }
        await this._handleRemoteDeletion(p, e, remoteShas, conflicts)
      }
    }
  }

  /**
   * conflicts の中で解決済みのものを base に昇格させる
    * @returns {Promise<void>}
   */
  private async _promoteResolvedConflicts(conflicts: Array<import('./types').ConflictEntry>, baseSnapshot: Record<string, string>, remoteHead: string) {
    if (!(await this._areAllResolved(conflicts))) return
    for (const c of conflicts) {
      await this._promoteResolvedConflictEntry(c, baseSnapshot)
    }
    this.head = remoteHead
    await this.saveIndex()
  }

  /**
   * conflicts が全て解決済みかどうかを判定する
   * @returns {Promise<boolean>}
   */
  private async _areAllResolved(conflicts: Array<import('./types').ConflictEntry>) {
    for (const c of conflicts) {
      const p = c.path
      let ie: any = undefined
      const infoTxt = await this.backend.readBlob(p, 'info')
      if (infoTxt) ie = JSON.parse(infoTxt)
      // If backend has no info entry (tests may have mutated getIndex()),
      // fallback to in-memory index returned by getIndex()
      if (!ie) {
        const index = await this.getIndex()
        ie = index.entries[p]
      }
      if (!ie || !ie.remoteSha || ie.baseSha !== ie.remoteSha) return false
    }
    return true
  }

  /**
   * 変更をコミットしてリモートへ反映します。adapter が無ければローカルシミュレーションします。
   * @param {import('./types').CommitInput} input コミット入力
   * @param {import('../git/adapter').GitAdapter} [adapter] 任意のアダプタ
   * @returns {Promise<{commitSha:string}>}
   */
  async push(input: import('./types').CommitInput, adapter?: import('../git/adapter').GitAdapter) {
    // pre-check: only reject when parentSha is undefined/null
    if (input.parentSha === undefined || input.parentSha === null) {
      throw new Error('No parentSha set. pull required')
    }
    if (input.parentSha !== this.head) {
      throw new Error('HEAD changed. pull required')
    }

    // generate commitKey for idempotency if not provided
    if (!input.commitKey) {
      // commitKey = hash(parentSha + JSON.stringify(changes))
      input.commitKey = await this.shaOf(input.parentSha + JSON.stringify(input.changes))
    }

    // ensure changes are present
    if (!input.changes || input.changes.length === 0) throw new Error('No changes to commit')

    // If adapter provided, perform remote API reflect via helper
    if (adapter) {
      return await this._handlePushWithAdapter(input, adapter)
    }

    // fallback: simulate commit locally
    const commitSha = await this.shaOf(input.parentSha + '|' + input.commitKey)

    for (const ch of input.changes as any[]) {
      await this._applyChangeLocally(ch)
    }

    this.head = commitSha
    this.lastCommitKey = input.commitKey
    await this.saveIndex()

    return { commitSha }
  }
}

export default VirtualFS
