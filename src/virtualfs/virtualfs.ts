import { sha1 } from '../utils/sha1'
import { IndexFile, TombstoneEntry } from './types'
import { StorageBackend, BrowserStorage } from './persistence'

/**
 *
 */
export class VirtualFS {
  private storageDir: string | undefined
  private base = new Map<string, { sha: string; content: string }>()
  private workspace = new Map<string, { sha: string; content: string }>()
  private tombstones = new Map<string, TombstoneEntry>()
  private index: IndexFile = { head: '', entries: {} }
  private backend: StorageBackend

  /**
   *
   */
  constructor(options?: { storageDir?: string; backend?: StorageBackend }) {
    this.storageDir = options?.storageDir
    if (options?.backend) this.backend = options.backend
    else this.backend = new BrowserStorage()
  }


  /**
   * コンテンツから SHA1 を計算します。
   * @param {string} content コンテンツ
   * @returns {string} 計算された SHA
   */
  private shaOf(content: string) {
    return sha1(content)
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
   * ワークスペースにファイルを書き込みます（ローカル編集）。
   * @param {string} filepath ファイルパス
   * @param {string} content コンテンツ
   * @returns {Promise<void>}
   */
  async writeWorkspace(filepath: string, content: string) {
    const sha = this.shaOf(content)
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
    // persist workspace blob (optional)
    await this.backend.writeBlob(filepath, content)
    await this.saveIndex()
  }

  /**
   * ワークスペース上のファイルを削除します（トゥームストーン作成を含む）。
   * @param {string} filepath ファイルパス
   * @returns {Promise<void>}
   */
  async deleteWorkspace(filepath: string) {
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
    } else {
      // created in workspace and deleted before push
      delete this.index.entries[filepath]
      this.workspace.delete(filepath)
      await this.backend.deleteBlob(filepath)
    }
    await this.saveIndex()
  }

  /**
   * rename を delete + create の合成で行うヘルパ
   * @param from 元パス
   * @param to 新パス
   */
  async renameWorkspace(from: string, to: string) {
    // read content from workspace if present, otherwise from base
    const w = this.workspace.get(from)
    const content = w ? w.content : (this.base.get(from)?.content ?? null)
    if (content === null) throw new Error('source not found')

    // create new workspace entry
    await this.writeWorkspace(to, content)

    // delete original path (creates tombstone if base existed)
    await this.deleteWorkspace(from)
  }

  /**
   * ワークスペース/ベースからファイル内容を読み出します。
   * @param {string} filepath ファイルパス
   * @returns {Promise<string|null>} ファイル内容または null
   */
  async readWorkspace(filepath: string) {
    const w = this.workspace.get(filepath)
    if (w) return w.content
    // try backend blob
    const blob = await this.backend.readBlob(filepath)
    if (blob !== null) return blob
    const b = this.base.get(filepath)
    if (b && b.content) return b.content
    return null
  }

  /**
   * リモートのベーススナップショットを適用します。
   * @param {{[path:string]:string}} snapshot path->content のマップ
   * @param {string} headSha リモート HEAD
   * @returns {Promise<void>}
   */
  async applyBaseSnapshot(snapshot: Record<string, string>, headSha: string) {
    // snapshot: path -> content
    this.base.clear()
    for (const [p, c] of Object.entries(snapshot)) {
      this.base.set(p, { sha: this.shaOf(c), content: c })
      // persist base blob
      await this.backend.writeBlob(p, c)
    }
    // update index entries for files not touched in workspace
    for (const [p, be] of this.base.entries()) {
      const existing = this.index.entries[p]
      if (!existing) {
        this.index.entries[p] = {
          path: p,
          state: 'base',
          baseSha: be.sha,
          updatedAt: Date.now(),
        }
      } else if (existing.state === 'base') {
        existing.baseSha = be.sha
        existing.updatedAt = Date.now()
      }
    }
    this.index.head = headSha
    await this.saveIndex()
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
    changes.push(...this._changesFromIndexEntries())
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
  private _changesFromIndexEntries(): Array<{ type: 'create' | 'update'; path: string; content: string; baseSha?: string }> {
    const out: Array<{ type: 'create' | 'update'; path: string; content: string; baseSha?: string }> = []
    out.push(...this._changesFromAddedEntries())
    out.push(...this._changesFromModifiedEntries())
    return out
  }

  /**
   * 追加状態のエントリから create 変更を生成します。
   * @returns {Array<{type:'create',path:string,content:string}>}
   */
  private _changesFromAddedEntries(): Array<{ type: 'create'; path: string; content: string }> {
    const out: Array<{ type: 'create'; path: string; content: string }> = []
    for (const [p, e] of Object.entries(this.index.entries)) {
      if (e.state === 'added') {
        const w = this.workspace.get(p)
        if (w) out.push({ type: 'create', path: p, content: w.content })
      }
    }
    return out
  }

  /**
   * 変更状態のエントリから update 変更を生成します。
   * @returns {Array<{type:'update',path:string,content:string,baseSha:string}>}
   */
  private _changesFromModifiedEntries(): Array<{ type: 'update'; path: string; content: string; baseSha: string }> {
    const out: Array<{ type: 'update'; path: string; content: string; baseSha: string }> = []
    for (const [p, e] of Object.entries(this.index.entries)) {
      if (e.state === 'modified') {
        const w = this.workspace.get(p)
        if (w && e.baseSha) out.push({ type: 'update', path: p, content: w.content, baseSha: e.baseSha })
      }
    }
    return out
  }

  /**
   * リモートスナップショットからの差分取り込み時に、単一パスを評価して
   * 必要なら conflicts に追加、もしくは base を更新します。
   * @returns {Promise<void>}
   */
  private async _handleRemotePath(p: string, remoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>) {
    const idxEntry = this.index.entries[p]
    const localWorkspace = this.workspace.get(p)
    const localBase = this.base.get(p)

    if (!idxEntry) return await this._handleRemoteNew(p, remoteSha, baseSnapshot, conflicts, localWorkspace, localBase)
    return await this._handleRemoteExisting(p, idxEntry, remoteSha, baseSnapshot, conflicts, localWorkspace)
  }

  /**
   * リモートに存在するがローカルにないパスを処理します。
   * @returns {Promise<void>}
   */
  private async _handleRemoteNew(p: string, remoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>, localWorkspace: { sha: string; content: string } | undefined, localBase: { sha: string; content: string } | undefined) {
    if (localWorkspace) {
      // workspace has uncommitted changes -> conflict
      conflicts.push({ path: p, remoteSha, workspaceSha: localWorkspace.sha, baseSha: localBase?.sha })
    } else {
      // safe to add to base
      const content = baseSnapshot[p]
      this.base.set(p, { sha: remoteSha, content })
      this.index.entries[p] = { path: p, state: 'base', baseSha: remoteSha, updatedAt: Date.now() }
      await this.backend.writeBlob(p, content)
    }
  }

  /**
   * リモートに存在し、かつローカルにエントリがあるパスを処理します。
   * @returns {Promise<void>}
   */
  private async _handleRemoteExisting(p: string, idxEntry: any, remoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>, localWorkspace: { sha: string; content: string } | undefined) {
    const baseSha = idxEntry.baseSha
    if (baseSha === remoteSha) return
    // remote changed
    if (!localWorkspace || localWorkspace.sha === baseSha) {
      // workspace unchanged -> update base
      const content = baseSnapshot[p]
      this.base.set(p, { sha: remoteSha, content })
      idxEntry.baseSha = remoteSha
      idxEntry.state = 'base'
      idxEntry.updatedAt = Date.now()
      await this.backend.writeBlob(p, content)
    } else {
      // workspace modified -> conflict
      conflicts.push({ path: p, baseSha, remoteSha, workspaceSha: localWorkspace?.sha })
    }
  }

  /**
   * ローカルに対する変更（create/update/delete）を適用するヘルパー
   * @param {any} ch 変更オブジェクト
   * @returns {Promise<void>}
   */
  private async _applyChangeLocally(ch: any) {
    if (ch.type === 'create' || ch.type === 'update') {
      const sha = this.shaOf(ch.content)
      this.base.set(ch.path, { sha, content: ch.content })
      const entry = this.index.entries[ch.path] || ({ path: ch.path } as any)
      entry.baseSha = sha
      entry.state = 'base'
      entry.updatedAt = Date.now()
      entry.workspaceSha = undefined
      this.index.entries[ch.path] = entry
      await this.backend.writeBlob(ch.path, ch.content)
      this.workspace.delete(ch.path)
    } else if (ch.type === 'delete') {
      delete this.index.entries[ch.path]
      this.base.delete(ch.path)
      this.tombstones.delete(ch.path)
      await this.backend.deleteBlob(ch.path)
      this.workspace.delete(ch.path)
    }
  }

  /**
   * リモート側で削除されたエントリをローカルに反映します。
   * @returns {Promise<void>}
   */
  private async _handleRemoteDeletion(p: string, e: any, _remoteShas: Record<string, string>, conflicts: Array<import('./types').ConflictEntry>) {
    const localWorkspace = this.workspace.get(p)
    if (!localWorkspace || localWorkspace.sha === e.baseSha) {
      // safe to delete locally
      delete this.index.entries[p]
      this.base.delete(p)
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
    const commitSha = await adapter.createCommitWithActions(branch, input.message, input.changes as any[])
    try {
      await adapter.updateRef(`heads/${branch}`, commitSha)
    } catch (e) {
      // ignore; adapter may not support updateRef
    }
    for (const ch of input.changes as any[]) {
      await this._applyChangeLocally(ch)
    }
    this.index.head = commitSha
    await this.saveIndex()
    return { commitSha }
  }

  /**
   * GitHub 風の blob/tree/commit フローで push を実行します。
   * @returns {Promise<{commitSha:string}>}
   */
  private async _pushWithGitHubFlow(adapter: any, input: any, branch: string) {
    const blobMap = await adapter.createBlobs(input.changes as any[])
    const changesWithBlob = (input.changes as any[]).map((c) => ({ ...c, blobSha: blobMap[c.path] }))
    const treeSha = await adapter.createTree(changesWithBlob)
    const commitSha = await adapter.createCommit(input.message, input.parentSha, treeSha)
    try {
      await adapter.updateRef(`heads/${branch}`, commitSha)
    } catch (e) {
      // ignore; adapter may not support updateRef
    }
    for (const ch of input.changes as any[]) {
      await this._applyChangeLocally(ch)
    }
    this.index.head = commitSha
    await this.saveIndex()
    return { commitSha }
  }

  /**
   * リモートのスナップショットを取り込み、コンフリクト情報を返します。
   * @param {string} remoteHead リモート HEAD
   * @param {{[path:string]:string}} baseSnapshot path->content マップ
   * @returns {Promise<{conflicts:Array<import('./types').ConflictEntry>}>}
   */
  async pull(remoteHead: string, baseSnapshot: Record<string, string>) {
    const conflicts: Array<import('./types').ConflictEntry> = []

    // compute remote shas
    const remoteShas: Record<string, string> = {}
    for (const [p, c] of Object.entries(baseSnapshot)) {
      remoteShas[p] = this.shaOf(c)
    }

    // handle remote additions/updates via helper
    for (const [p, remoteSha] of Object.entries(remoteShas)) {
      await this._handleRemotePath(p, remoteSha, baseSnapshot, conflicts)
    }

    // handle remote deletions via helper
    for (const [p, e] of Object.entries(this.index.entries)) {
      if (!(p in remoteShas)) {
        await this._handleRemoteDeletion(p, e, remoteShas, conflicts)
      }
    }

    if (conflicts.length === 0) {
      this.index.head = remoteHead
      await this.saveIndex()
    }

    return { conflicts }
  }

  /**
   * 変更をコミットしてリモートへ反映します。adapter が無ければローカルシミュレーションします。
   * @param {import('./types').CommitInput} input コミット入力
   * @param {import('../git/adapter').GitAdapter} [adapter] 任意のアダプタ
   * @returns {Promise<{commitSha:string}>}
   */
  async push(input: import('./types').CommitInput, adapter?: import('../git/adapter').GitAdapter) {
    // pre-check
    if (input.parentSha !== this.index.head) {
      throw new Error('HEAD changed. pull required')
    }

    // generate commitKey for idempotency if not provided
    if (!input.commitKey) {
      // commitKey = hash(parentSha + JSON.stringify(changes))
      input.commitKey = this.shaOf(input.parentSha + JSON.stringify(input.changes))
    }

    // ensure changes are present
    if (!input.changes || input.changes.length === 0) throw new Error('No changes to commit')

    // If adapter provided, perform remote API reflect
    if (adapter) {
      const branch = (input as any).ref || 'main'
      const messageWithKey = `${input.message}\n\napigit-commit-key:${input.commitKey}`

      // If adapter supports createCommitWithActions (GitLab style), use it directly
      if ((adapter as any).createCommitWithActions) {
        // ensure message contains commitKey
        (input as any).message = messageWithKey
        const res = await this._pushWithActions(adapter, input, branch)
        // record commitKey in index metadata
        this.index.lastCommitKey = input.commitKey
        return res
      }

      // Fallback to GitHub-style flow: delegate to helper
      (input as any).message = messageWithKey
      const res = await this._pushWithGitHubFlow(adapter, input, branch)
      this.index.lastCommitKey = input.commitKey
      return res
    }

    // fallback: simulate commit locally
    const commitSha = this.shaOf(input.parentSha + '|' + input.commitKey)

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
