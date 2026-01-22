import { IndexFile, TombstoneEntry } from './types'
import { StorageBackend } from './storageBackend'
import { OpfsStorage } from './opfsStorage'

/** Virtual file system - 永続化バックエンドを抽象化した仮想ファイルシステム */
export class VirtualFS {
  private storageDir: string | undefined
  private base = new Map<string, { sha: string; content: string }>()
  private workspace = new Map<string, { sha: string; content: string }>()
  private tombstones = new Map<string, TombstoneEntry>()
  private index: IndexFile = { head: '', entries: {} }
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
      if (raw) this.index = raw
      // Populate internal maps lightly (only shas known)
      for (const [p, e] of Object.entries(this.index.entries)) {
        if (e.baseSha) {
          this.base.set(p, { sha: e.baseSha, content: '' })
        }
        if (e.workspaceSha) {
          this.workspace.set(p, { sha: e.workspaceSha, content: '' })
        }
      }
    } catch (err) {
      this.index = { head: '', entries: {} }
      await this.saveIndex()
    }
  }

  /**
   * 内部インデックスを永続化します。
   * @returns {Promise<void>}
   */
  private async saveIndex() {
    await this.backend.writeIndex(this.index)
  }

  /**
   *
  */
  /**
   * ファイルを書き込みます（ローカル編集）。
   * @param {string} filepath ファイルパス
   * @param {string} content コンテンツ
   * @returns {Promise<void>}
   */
  async writeFile(filepath: string, content: string) {
    const sha = await this.shaOf(content)
    this.workspace.set(filepath, { sha, content })
    const now = Date.now()
    const existing = this.index.entries[filepath]
    const state = existing && existing.baseSha ? 'modified' : 'added'
    this.index.entries[filepath] = {
      path: filepath,
      state: state as any,
      baseSha: existing?.baseSha,
      workspaceSha: sha,
      updatedAt: now,
    }
    // persist workspace blob (optional) under workspace/
    await this.backend.writeBlob(`workspace/${filepath}`, content)
    await this.saveIndex()
  }

  /**
   * ファイルを削除します（トゥームストーン作成を含む）。
   * @param {string} filepath ファイルパス
   * @returns {Promise<void>}
   */
  async deleteFile(filepath: string) {
    // if file existed in base, create tombstone
    const entry = this.index.entries[filepath]
    const now = Date.now()
    if (entry && entry.baseSha) {
      this.tombstones.set(filepath, { path: filepath, baseSha: entry.baseSha!, deletedAt: now })
      this.index.entries[filepath] = {
        path: filepath,
        state: 'deleted',
        baseSha: entry.baseSha,
        updatedAt: now,
      }
      // remove any workspace copy from backend
      try {
        await this.backend.deleteBlob(`workspace/${filepath}`)
      } catch (_) {
        // ignore
      }
    } else {
      // created in workspace and deleted before push
      delete this.index.entries[filepath]
      this.workspace.delete(filepath)
      await this.backend.deleteBlob(`workspace/${filepath}`)
    }
    await this.saveIndex()
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
    const w = this.workspace.get(filepath)
    if (w) return w.content
    // try workspace blob in backend first (read-through)
    const wsBlob = await this.backend.readBlob(`workspace/${filepath}`)
    if (wsBlob !== null) return wsBlob
    // then try base (.git-base)
    const baseBlob = await this.backend.readBlob(`.git-base/${filepath}`)
    if (baseBlob !== null) return baseBlob
    const b = this.base.get(filepath)
    if (b && b.content) return b.content
    return null
  }

  /**
   * 衝突ファイル（.git-conflict/配下）を取得します。
   * @param {string} filepath ファイルパス
   * @returns {Promise<string|null>} ファイル内容または null
   */
  async readConflict(filepath: string) {
    const blob = await this.backend.readBlob(`.git-conflict/${filepath}`)
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
      const remoteContent = await this.backend.readBlob(`.git-conflict/${filepath}`)
      const ie = this.index.entries[filepath]
      // If we have remote content and an index entry with remoteSha, promote it to base
      if (remoteContent !== null && ie && ie.remoteSha) {
        // write to .git-base
        try {
          await this.backend.writeBlob(`.git-base/${filepath}`, remoteContent)
        } catch (_) {
          // ignore backend write errors
        }
        // update in-memory base map
        this.base.set(filepath, { sha: ie.remoteSha, content: remoteContent })
        // update index entry: set baseSha to remoteSha, clear remoteSha, set state to base
        ie.baseSha = ie.remoteSha
        delete ie.remoteSha
        ie.state = 'base'
        ie.updatedAt = Date.now()
        this.index.entries[filepath] = ie
      } else if (ie && ie.remoteSha) {
        // no blob but remoteSha present: still update baseSha to remoteSha (content unknown)
        ie.baseSha = ie.remoteSha
        delete ie.remoteSha
        ie.state = 'base'
        ie.updatedAt = Date.now()
        this.index.entries[filepath] = ie
      }

      // remove conflict blob if present
      try {
        await this.backend.deleteBlob(`.git-conflict/${filepath}`)
      } catch (_) {
        // ignore
      }

      await this.saveIndex()
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

    const toAddOrUpdate = this._computeToAddOrUpdate(snapshot, newShas)
    const toRemove = this._computeToRemove(snapshot)

    await this._applyRemovals(toRemove)
    await this._applyAddsOrUpdates(toAddOrUpdate, snapshot, newShas)

    this.index.head = headSha
    await this.saveIndex()
  }

  /**
   * 指定スナップショットから追加・更新対象のパス一覧を計算します。
   * @param {Record<string,string>} snapshot path->content マップ
   * @param {Record<string,string>} newShas path->sha マップ
   * @returns {string[]} 追加/更新すべきパスの配列
   */
  private _computeToAddOrUpdate(snapshot: Record<string, string>, newShas: Record<string, string>) {
    const out: string[] = []
    for (const [p] of Object.entries(snapshot)) {
      const existing = this.base.get(p)
      const sha = newShas[p]
      if (!existing || existing.sha !== sha) out.push(p)
    }
    return out
  }
  /**
   * 指定スナップショットから削除対象のパス一覧を計算します。
   * @param {Record<string,string>} snapshot リモートの path->content マップ
   * @returns {string[]} 削除すべきパスの配列
   */
  private _computeToRemove(snapshot: Record<string, string>) {
    const out: string[] = []
    for (const p of Array.from(this.base.keys())) if (!(p in snapshot)) out.push(p)
    return out
  }

  /**
   * 指定パス群を削除として backend に反映します。
   * @param {string[]} toRemove 削除するパスの配列
   * @returns {Promise<void>}
   */
  private async _applyRemovals(toRemove: string[]) {
    for (const p of toRemove) {
      this.base.delete(p)
      try {
        await this.backend.deleteBlob(`.git-base/${p}`)
      } catch (_) {
        // ignore backend errors
      }
      const ie = this.index.entries[p]
      if (ie && ie.state === 'base') delete this.index.entries[p]
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
      this.base.set(p, { sha, content })
      try {
        await this.backend.writeBlob(`.git-base/${p}`, content)
      } catch (_) {
        // ignore
      }
      const existing = this.index.entries[p]
      if (!existing) this.index.entries[p] = { path: p, state: 'base', baseSha: sha, updatedAt: Date.now() }
      else if (existing.state === 'base') {
        existing.baseSha = sha
        existing.updatedAt = Date.now()
      }
    }
  }

  /**
   * 指定エラーが non-fast-forward を示すか判定します。
   * @param {any} err 例外オブジェクト
   * @returns {boolean}
   */
  private _isNonFastForwardError(err: any) {
    const msg = String(err && err.message ? err.message : err)
    return msg.includes('422') || /fast\s*forward/i.test(msg) || /not a fast forward/i.test(msg)
  }

  /**
   * インデックス情報を返します。
   * @returns {IndexFile}
   */
  getIndex(): IndexFile {
    return this.index
  }

  /**
   * 登録されているパス一覧を返します。
   * @returns {string[]}
   */
  listPaths(): string[] {
    return Object.keys(this.index.entries)
  }

  /**
   * tombstone を返します。
   * @returns {TombstoneEntry[]}
   */
  getTombstones(): TombstoneEntry[] {
    return Array.from(this.tombstones.values())
  }

  /**
   * tombstone を返します。
   * @returns {TombstoneEntry[]}
   */

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
    changes.push(...this._changesFromTombstones())
    const idxChanges = await this._changesFromIndexEntries()
    changes.push(...idxChanges)
    return changes
  }

  /**
   * tombstone からの削除変更リストを生成します。
   * @returns {Array<{type:'delete',path:string,baseSha:string}>}
   */
  private _changesFromTombstones(): Array<{ type: 'delete'; path: string; baseSha: string }> {
    const out: Array<{ type: 'delete'; path: string; baseSha: string }> = []
    for (const t of this.tombstones.values()) out.push({ type: 'delete', path: t.path, baseSha: t.baseSha })
    return out
  }

  /**
   * index entries から create/update の変更リストを生成します。
   * @returns {Array<{type:'create'|'update',path:string,content:string,baseSha?:string}>}
   */
  private async _changesFromIndexEntries(): Promise<Array<{ type: 'create' | 'update'; path: string; content: string; baseSha?: string }>> {
    const out: Array<{ type: 'create' | 'update'; path: string; content: string; baseSha?: string }> = []
    out.push(...await this._changesFromAddedEntries())
    out.push(...await this._changesFromModifiedEntries())
    return out
  }

  /**
   * 追加状態のエントリから create 変更を生成します。
   * @returns {Array<{type:'create',path:string,content:string}>}
   */
  private async _changesFromAddedEntries(): Promise<Array<{ type: 'create'; path: string; content: string }>> {
    const out: Array<{ type: 'create'; path: string; content: string }> = []
    for (const [p, e] of Object.entries(this.index.entries)) {
      if (e.state === 'added') {
        const w = await this._ensureWorkspaceBlobForEntry(p, e)
        if (w && w.content !== undefined) out.push({ type: 'create', path: p, content: w.content })
      }
    }
    return out
  }

  /**
   * 変更状態のエントリから update 変更を生成します。
   * @returns {Array<{type:'update',path:string,content:string,baseSha:string}>}
   */
  private async _changesFromModifiedEntries(): Promise<Array<{ type: 'create' | 'update'; path: string; content: string; baseSha?: string }>> {
    const out: Array<{ type: 'create' | 'update'; path: string; content: string; baseSha?: string }> = []
    for (const [p, e] of Object.entries(this.index.entries)) {
      // Include entries that are explicitly 'modified' or in 'conflict'.
      // Also include entries that have a workspace blob _unless_ they are
      // newly 'added' entries (those are handled by _changesFromAddedEntries()).
      const consider =
        e.state === 'modified' || e.state === 'conflict' || (!!e.workspaceSha && e.state !== 'added')
      if (!consider) continue

      const w = await this._ensureWorkspaceBlobForEntry(p, e)
      if (!w) continue

      await this._pushChangeForModifiedEntry(out, p, e, w)
    }
    return out
  }

  /**
   * modified エントリを変更リストに追加する補助
   * @param out 変更リスト
   * @param p パス
   * @param e エントリ
   * @param w workspace blob
   */
  private async _pushChangeForModifiedEntry(out: any[], p: string, e: any, w: any) {
    if (e.baseSha) {
      if (e.baseSha !== w.sha) out.push({ type: 'update', path: p, content: w.content, baseSha: e.baseSha })
    } else {
      out.push({ type: 'create', path: p, content: w.content })
    }
  }

  /**
   * workspace キャッシュがなければ backend から読み出して補完します。
   * @param p パス
   * @param e インデックスエントリ
   * @returns {Promise<{sha:string,content:string}|undefined>} workspace blob を返す
   */
  private async _ensureWorkspaceBlobForEntry(p: string, e: any) {
    let w = this.workspace.get(p)
    if ((!w || !w.content) && e.workspaceSha) {
      try {
        const blob = await this.backend.readBlob(`workspace/${p}`)
        if (blob !== null) {
          w = { sha: e.workspaceSha, content: blob }
          this.workspace.set(p, w)
        }
      } catch (_) {
        // ignore backend read errors
      }
    }
    return w
  }

  /**
   * @returns {Promise<{sha:string,content:string}|undefined>} workspace blob を返す
   */

  /**
   * リモートスナップショットからの差分取り込み時に、単一パスを評価して
   * 必要なら conflicts に追加、もしくは base を更新します。
   * @returns {Promise<void>}
   */
  private async _handleRemotePath(p: string, perFileRemoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>, remoteHeadSha: string) {
    const idxEntry = this.index.entries[p]
    const localWorkspace = this.workspace.get(p)
    const localBase = this.base.get(p)

    if (!idxEntry) return await this._handleRemoteNew(p, perFileRemoteSha, baseSnapshot, conflicts, localWorkspace, localBase, remoteHeadSha)
    return await this._handleRemoteExisting(p, idxEntry, perFileRemoteSha, baseSnapshot, conflicts, localWorkspace, remoteHeadSha)
  }

  /**
   * リモートに存在するがローカルにないパスを処理します。
   * @returns {Promise<void>}
   */
  private async _handleRemoteNew(p: string, perFileRemoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>, localWorkspace: { sha: string; content: string } | undefined, localBase: { sha: string; content: string } | undefined, remoteHeadSha: string) {
    if (localWorkspace) {
      // workspace has uncommitted changes -> conflict
      // persist remote content for inspection under .git-conflict/
      try {
        const content = baseSnapshot[p]
        if (content !== undefined) await this.backend.writeBlob(`.git-conflict/${p}`, content)
      } catch (_) {
        // ignore backend write errors
      }
      // mark index entry as conflict and store remoteHeadSha for later resolution
      const ie = this.index.entries[p] || ({ path: p } as any)
      ie.state = 'conflict'
      ie.remoteSha = remoteHeadSha
      ie.updatedAt = Date.now()
      this.index.entries[p] = ie
      await this.saveIndex()
      conflicts.push({ path: p, remoteSha: remoteHeadSha, workspaceSha: localWorkspace.sha, baseSha: localBase?.sha })
    } else {
      // safe to add to base
      const content = baseSnapshot[p]
      this.base.set(p, { sha: perFileRemoteSha, content })
      this.index.entries[p] = { path: p, state: 'base', baseSha: perFileRemoteSha, updatedAt: Date.now() }
      await this.backend.writeBlob(`.git-base/${p}`, content)
    }
  }

  /**
   * リモートに存在し、かつローカルにエントリがあるパスを処理します。
   * @returns {Promise<void>}
   */
  private async _handleRemoteExisting(p: string, idxEntry: any, perFileRemoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>, localWorkspace: { sha: string; content: string } | undefined, remoteHeadSha: string) {
    const baseSha = idxEntry.baseSha
    if (baseSha === perFileRemoteSha) return
    // remote changed
    if (!localWorkspace || localWorkspace.sha === baseSha) {
      // workspace unchanged -> update base
      const content = baseSnapshot[p]
      idxEntry.baseSha = perFileRemoteSha
      idxEntry.state = 'base'
      idxEntry.updatedAt = Date.now()
      await this.backend.writeBlob(`.git-base/${p}`, content)
    } else {
      // workspace modified -> conflict
      // persist remote content for inspection under .git-conflict/
      try {
        const content = baseSnapshot[p]
        if (content !== undefined) await this.backend.writeBlob(`.git-conflict/${p}`, content)
      } catch (_) {
        // ignore backend write errors
      }
      // record remoteHeadSha in index for later resolution
      idxEntry.state = 'conflict'
      idxEntry.remoteSha = remoteHeadSha
      idxEntry.updatedAt = Date.now()
      this.index.entries[p] = idxEntry
      await this.saveIndex()
      conflicts.push({ path: p, baseSha, remoteSha: remoteHeadSha, workspaceSha: localWorkspace?.sha })
    }
  }

  /**
   * ローカルに対する変更（create/update/delete）を適用するヘルパー
   * @param {any} ch 変更オブジェクト
   * @returns {Promise<void>}
   */
  private async _applyChangeLocally(ch: any) {
    if (ch.type === 'create' || ch.type === 'update') {
      const sha = await this.shaOf(ch.content)
      this.base.set(ch.path, { sha, content: ch.content })
      const entry = this.index.entries[ch.path] || ({ path: ch.path } as any)
      entry.baseSha = sha
      entry.state = 'base'
      entry.updatedAt = Date.now()
      entry.workspaceSha = undefined
      this.index.entries[ch.path] = entry
      await this.backend.writeBlob(`.git-base/${ch.path}`, ch.content)
      try {
        await this.backend.deleteBlob(`workspace/${ch.path}`)
      } catch (_) {
        // ignore backend errors when cleaning workspace blob
      }
      this.workspace.delete(ch.path)
      // cleanup any conflict blob for this path
      try {
        await this.backend.deleteBlob(`.git-conflict/${ch.path}`)
      } catch (_) {
        // ignore
      }
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
    const sha = await this.shaOf(ch.content)
    this.base.set(ch.path, { sha, content: ch.content })
    const entry = this.index.entries[ch.path] || ({ path: ch.path } as any)
    entry.baseSha = sha
    entry.state = 'base'
    entry.updatedAt = Date.now()
    entry.workspaceSha = undefined
    this.index.entries[ch.path] = entry
    await this.backend.writeBlob(`.git-base/${ch.path}`, ch.content)
    try { await this.backend.deleteBlob(`workspace/${ch.path}`) } catch (_) { /* ignore backend errors when cleaning workspace blob */ }
    this.workspace.delete(ch.path)
    try { await this.backend.deleteBlob(`.git-conflict/${ch.path}`) } catch (_) { /* ignore */ }
  }

  /**
   * delete 変更をローカルに適用します。
   * @param {any} ch 変更オブジェクト
   * @returns {Promise<void>}
   */
  private async _applyDelete(ch: any) {
    delete this.index.entries[ch.path]
    this.base.delete(ch.path)
    this.tombstones.delete(ch.path)
    await this.backend.deleteBlob(`.git-base/${ch.path}`)
    try { await this.backend.deleteBlob(`workspace/${ch.path}`) } catch (_) { /* ignore backend errors when cleaning workspace blob */ }
    this.workspace.delete(ch.path)
    try { await this.backend.deleteBlob(`.git-conflict/${ch.path}`) } catch (_) { /* ignore */ }
  }

  /**
   * リモート側で削除されたエントリをローカルに反映します。
   * @returns {Promise<void>}
   */
  private async _handleRemoteDeletion(p: string, e: any, _remoteShas: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>) {
    const localWorkspace = this.workspace.get(p)
    // If the index entry has no baseSha it was created locally (added) and not
    // present in the remote base. In that case, remote lacking the path is NOT
    // a conflict — keep the local addition as-is.
    if (!e || !e.baseSha) {
      return
    }

    if (!localWorkspace || localWorkspace.sha === e.baseSha) {
      // safe to delete locally
      delete this.index.entries[p]
      this.base.delete(p)
      await this.backend.deleteBlob(`.git-base/${p}`)
    } else {
      conflicts.push({ path: p, baseSha: e.baseSha, workspaceSha: localWorkspace?.sha })
    }
  }

  /**
   * GitLab 風の actions ベースコミットフローで push を実行します。
   * @returns {Promise<{commitSha:string}>}
   */
  private async _pushWithActions(adapter: any, input: any, branch: string) {
    const commitSha = await adapter.createCommitWithActions(branch, input.message, input.changes as any[])
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
      } catch (err: any) {
        if (this._isNonFastForwardError(err)) {
          throw new Error('非互換な更新 (non-fast-forward): pull が必要です')
        }
        if (typeof console !== 'undefined' && (console as any).warn) (console as any).warn('updateRef failed (non-422), continuing locally:', err)
      }
    }
  }

  /**
   * Apply changes locally, update index head and persist index.
   * Returns the commit result object for callers.
   */
  /**
   * Apply changes locally, update index head and persist index.
   * Returns the commit result object for callers.
   * @returns {Promise<{commitSha:string}>}
   */
  private async _applyChangesAndFinalize(commitSha: string, input: any) {
    for (const ch of input.changes as any[]) {
      await this._applyChangeLocally(ch)
    }
    this.index.head = commitSha
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
      this.index.lastCommitKey = input.commitKey
      return res
    }

    // Fallback to GitHub-style flow
    (input as any).message = messageWithKey
    const res = await this._pushWithGitHubFlow(adapter, input, branch)
    this.index.lastCommitKey = input.commitKey
    return res
  }

  /**
   * リモートのスナップショットを取り込み、コンフリクト情報を返します。
   * @param {string} remoteHead リモート HEAD
   * @param {{[path:string]:string}} baseSnapshot path->content マップ
   * @returns {Promise<{conflicts:Array<import('./types').ConflictEntry>}>}
   */
  async pull(remoteHead: string, baseSnapshot: Record<string, string>) {
    const conflicts: Array<import('./types').ConflictEntry> = []
    const remoteShas = await this._computeRemoteShas(baseSnapshot)
    await this._processRemoteAddsAndUpdates(remoteShas, baseSnapshot, remoteHead, conflicts)
    await this._processRemoteDeletions(remoteShas, conflicts)

    if (conflicts.length === 0) {
      this.index.head = remoteHead
      await this.saveIndex()
      return { conflicts }
    }

    // If conflicts exist, but for every conflict the index already has baseSha === remoteSha,
    // treat them as already-resolved. Promote remoteSha -> baseSha, write .git-base blobs,
    // cleanup .git-conflict blobs and mark entries as 'base'. Then advance head to remoteHead.
    await this._promoteResolvedConflicts(conflicts, baseSnapshot, remoteHead)

    return { conflicts }
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
    for (const [p, e] of Object.entries(this.index.entries)) {
      if (!(p in remoteShas)) {
        await this._handleRemoteDeletion(p, e, remoteShas, conflicts)
      }
    }
  }

  /**
   * conflicts の中で解決済みのものを base に昇格させる
    * @returns {Promise<void>}
   */
  private async _promoteResolvedConflicts(conflicts: Array<import('./types').ConflictEntry>, baseSnapshot: Record<string, string>, remoteHead: string) {
    if (!this._areAllResolved(conflicts)) return
    for (const c of conflicts) {
      const p = c.path
      const ie = this.index.entries[p]
      try {
        const content = baseSnapshot[p]
        if (content !== undefined) {
          await this.backend.writeBlob(`.git-base/${p}`, content)
          this.base.set(p, { sha: ie.remoteSha!, content })
        }
      } catch (_) {
        /* ignore write errors */
      }
      ie.baseSha = ie.remoteSha
      delete ie.remoteSha
      ie.state = 'base'
      ie.updatedAt = Date.now()
      this.index.entries[p] = ie
      try { await this.backend.deleteBlob(`.git-conflict/${p}`) } catch (_) { /* ignore */ }
    }
    this.index.head = remoteHead
    await this.saveIndex()
  }

  /**
   * conflicts が全て解決済みかどうかを判定する
   * @returns {boolean}
   */
  private _areAllResolved(conflicts: Array<import('./types').ConflictEntry>) {
    for (const c of conflicts) {
      const p = c.path
      const ie = this.index.entries[p]
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
    if (input.parentSha !== this.index.head) {
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

    this.index.head = commitSha
    this.index.lastCommitKey = input.commitKey
    await this.saveIndex()

    return { commitSha }
  }
}

export default VirtualFS
