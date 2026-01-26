import { shaOf, shaOfGitBlob } from './hashUtils'
import { StorageBackend } from './storageBackend'
import { IndexManager } from './indexManager'
import { ConflictManager } from './conflictManager'
import { LocalChangeApplier } from './localChangeApplier'

type RemoteSnapshotDescriptor = {
  headSha: string
  shas: Record<string, string>
  fetchContent: (_paths: string[]) => Promise<Record<string, string>>
}

/**
 * リモート同期を行うクラス
 */
export class RemoteSynchronizer {
  /**
   * コンストラクタ
   * @param {StorageBackend} backend - ストレージバックエンド
   * @param {IndexManager} indexManager - インデックス管理
   * @param {ConflictManager} conflictManager - コンフリクト管理
   * @param {LocalChangeApplier} applier - ローカル適用器
   */
  constructor(
    private backend: StorageBackend,
    private indexManager: IndexManager,
    private conflictManager: ConflictManager,
    private applier: LocalChangeApplier
  ) {}

  /**
   * リモートのスナップショットをpullしてローカルを同期する
   * @param {RemoteSnapshotDescriptor|string} remote - リモートスナップショットまたはheadSha
   * @param {Record<string,string>=} baseSnapshot - オプションのベーススナップショット
   * @returns {Promise<object>} conflicts, fetchedPaths, reconciledPaths を含む結果オブジェクト
   */
  async pull(remote: RemoteSnapshotDescriptor | string, baseSnapshot?: Record<string, string>): Promise<object> {
    const normalized = await this._normalizeRemoteInput(remote, baseSnapshot)

    const conflicts: Array<any> = []
    const pathsToFetch: string[] = []
    const reconciledPaths: string[] = []

    for (const [p, sha] of Object.entries(normalized.shas)) {
      const classified = await this._classifyRemotePathForPull(p, sha, normalized, pathsToFetch, reconciledPaths)
      if (!classified) pathsToFetch.push(p)
    }

    const fetched = await normalized.fetchContent(pathsToFetch)
    await this._processRemoteAddsAndUpdates(normalized.shas, fetched, normalized.headSha, conflicts)
    await this._processRemoteDeletions(normalized.shas, conflicts)

    if (conflicts.length === 0) {
      this.indexManager.setHead(normalized.headSha)
      await this.indexManager.saveIndex()
      return { conflicts, fetchedPaths: pathsToFetch, reconciledPaths }
    }

    await this.conflictManager.promoteResolvedConflicts(conflicts, fetched, normalized.headSha)

    if (reconciledPaths.length > 0) await this.indexManager.saveIndex()

    return { conflicts, fetchedPaths: pathsToFetch, reconciledPaths }
  }

  /**
   * ローカルの変更をpushする（インデックス更新を行う）
   * @param {any} input - push 入力（parentSha, changes 等）
   * @param {any=} adapter - オプションのアダプタ
   * @returns {Promise<object>} commitSha を含むオブジェクト
   */
  async push(input: any, adapter?: any): Promise<object> {
    if (input.parentSha === undefined || input.parentSha === null) {
      throw new Error('No parentSha set. pull required')
    }
    const currentIndex = await this.indexManager.getIndex()
    if (input.parentSha !== currentIndex.head) {
      throw new Error('非互換な更新 (non-fast-forward): pull が必要です')
    }
    if (!input.commitKey) {
      input.commitKey = await shaOf(input.parentSha + JSON.stringify(input.changes))
    }
    if (!input.changes || input.changes.length === 0) throw new Error('No changes to commit')

    const commitSha = await shaOf(input.parentSha + '|' + input.commitKey)
    for (const ch of input.changes as any[]) {
      await this._applyChangeLocally(ch)
    }
    this.indexManager.setHead(commitSha)
    this.indexManager.setLastCommitKey(input.commitKey)
    await this.indexManager.saveIndex()

    return { commitSha }
  }

  /**
   * ベーススナップショットを適用してローカルを置き換える
   * @param {Record<string,string>} snapshot - パス->内容のマップ
   * @param {string} headSha - 適用後のhead
   * @returns {Promise<void>}
   */
  async applyBaseSnapshot(snapshot: Record<string, string>, headSha: string): Promise<void> {
    const newShas: Record<string, string> = {}
    for (const [p, c] of Object.entries(snapshot)) newShas[p] = await shaOf(c)

    const toAddOrUpdate = await this._computeToAddOrUpdate(snapshot, newShas)
    const toRemove = await this._computeToRemove(snapshot)

    await this._applyRemovals(toRemove)
    await this._applyAddsOrUpdates(toAddOrUpdate, snapshot, newShas)

    this.indexManager.setHead(headSha)
    await this.indexManager.saveIndex()
  }

  /**
   * remote 引数を標準の RemoteSnapshotDescriptor に変換する
   * @returns {Promise<RemoteSnapshotDescriptor>}
   */
  private async _normalizeRemoteInput(remote: RemoteSnapshotDescriptor | string, baseSnapshot?: Record<string, string>): Promise<RemoteSnapshotDescriptor> {
    if (typeof remote !== 'string') return remote
    const snapshot = baseSnapshot || {}
    const shas: Record<string, string> = {}
    for (const [p, c] of Object.entries(snapshot)) shas[p] = await shaOf(c)
    /**
     * 指定パスの内容を snapshot から取得する（内部ユーティリティ）
     * @param {string[]} paths - 取得するパス一覧
     * @returns {Promise<Record<string,string>>} path->content マップ
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
   * 追加/更新対象のパス一覧を計算する
   * @returns {Promise<string[]>}
   */
  private async _computeToAddOrUpdate(snapshot: Record<string, string>, newShas: Record<string, string>): Promise<string[]> {
    const out: string[] = []
    for (const [p] of Object.entries(snapshot)) {
      const sha = newShas[p]
      let entry: any = undefined
      const infoTxt = await this.backend.readBlob(p, 'info')
      if (infoTxt) entry = JSON.parse(infoTxt)
      if (!entry || entry.baseSha !== sha) out.push(p)
    }
    return out
  }

  /**
   * 削除対象のパス一覧を計算する
   * @returns {Promise<string[]>}
   */
  private async _computeToRemove(snapshot: Record<string, string>): Promise<string[]> {
    const out: string[] = []
    const infos = await this.backend.listFiles(undefined, 'info')
    for (const it of infos) {
      const p = it.path
      if (!(p in snapshot)) out.push(p)
    }
    return out
  }

  /**
   * 指定パスの削除を適用する
   * @param {string[]} toRemove - 削除対象パス配列
   * @returns {Promise<void>}
   */
  private async _applyRemovals(toRemove: string[]): Promise<void> {
    for (const p of toRemove) {
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
   * 追加/更新を適用する
   * @returns {Promise<void>}
   */
  private async _applyAddsOrUpdates(toAddOrUpdate: string[], snapshot: Record<string, string>, newShas: Record<string, string>): Promise<void> {
    for (const p of toAddOrUpdate) {
      const content = snapshot[p]
      const sha = newShas[p]
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
   * リモートの追加/更新を処理する
   * @returns {Promise<void>}
   */
  private async _processRemoteAddsAndUpdates(remoteShas: Record<string, string>, baseSnapshot: Record<string, string>, remoteHead: string, conflicts: Array<any>): Promise<void> {
    for (const [p, remoteSha] of Object.entries(remoteShas)) {
      await this._handleRemotePath(p, remoteSha, baseSnapshot, conflicts, remoteHead)
    }
  }

  /**
   * リモートの削除を処理する
   * @returns {Promise<void>}
   */
  private async _processRemoteDeletions(remoteShas: Record<string, string>, conflicts: Array<any>): Promise<void> {
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
   * プル時に個別パスが既に整合済みか判定する
   * @returns {Promise<boolean>} 整合済みならtrue
   */
  private async _classifyRemotePathForPull(p: string, sha: string, normalized: RemoteSnapshotDescriptor, pathsToFetch: string[], reconciledPaths: string[]): Promise<boolean> {
    let entry: any = undefined
    const infoTxt = await this.backend.readBlob(p, 'info')
    if (infoTxt) entry = JSON.parse(infoTxt)
    if (!entry) return false
    if (entry.baseSha === sha) return true

    const baseContent = await this.backend.readBlob(p, 'base')
    if (baseContent !== null) {
      const gitSha = await shaOfGitBlob(baseContent)
      if (gitSha === sha) {
        entry.baseSha = sha
        entry.state = entry.state || 'base'
        entry.updatedAt = Date.now()
        await this.backend.writeBlob(p, JSON.stringify(entry), 'info')
        reconciledPaths.push(p)
        return true
      }
    }
    return false
  }

  /**
   * 個別のリモートパスを処理する（新規/既存の振り分けを行う）
   * @returns {Promise<void>}
   */
  private async _handleRemotePath(p: string, perFileRemoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<any>, remoteHeadSha: string): Promise<void> {
    let indexEntry: any = undefined
    const infoTxt = await this.backend.readBlob(p, 'info')
    if (infoTxt) indexEntry = JSON.parse(infoTxt)
    let localWorkspace: { sha: string; content: string } | undefined = undefined
    const wsBlob = await this.backend.readBlob(p, 'workspace')
    if (wsBlob !== null) {
      const wsSha = indexEntry?.workspaceSha || await shaOf(wsBlob)
      localWorkspace = { sha: wsSha, content: wsBlob }
    }
    let localBase: { sha: string; content: string } | undefined = undefined
    const baseBlob = await this.backend.readBlob(p, 'base')
    if (baseBlob !== null && indexEntry?.baseSha) {
      localBase = { sha: indexEntry.baseSha, content: baseBlob }
    }

    if (!indexEntry) return await this._handleRemoteNew(p, perFileRemoteSha, baseSnapshot, conflicts, localWorkspace, localBase, remoteHeadSha)
    return await this._handleRemoteExisting(p, indexEntry, perFileRemoteSha, baseSnapshot, conflicts, localWorkspace, remoteHeadSha)
  }

  /**
   * 新規ファイルに対する処理（追加 or conflict）
   * @returns {Promise<void>}
   */
  private async _handleRemoteNew(p: string, perFileRemoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<any>, localWorkspace: { sha: string; content: string } | undefined, localBase: { sha: string; content: string } | undefined, remoteHeadSha: string): Promise<void> {
    const workspaceSha = localWorkspace ? localWorkspace.sha : undefined
    if (localWorkspace) {
      await this._handleRemoteNewConflict(p, baseSnapshot[p], remoteHeadSha, conflicts, workspaceSha, localBase?.sha)
      return
    }
    await this._handleRemoteNewAdd(p, perFileRemoteSha, baseSnapshot, remoteHeadSha, conflicts, workspaceSha, localBase?.sha)
  }

  /**
   * 新規でコンフリクトが発生した場合の処理
   * @returns {Promise<void>}
   */
  private async _handleRemoteNewConflict(p: string, content: string | undefined, remoteHeadSha: string, conflicts: Array<any>, workspaceSha: string | undefined, baseSha: string | undefined): Promise<void> {
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
   * 新規追加を処理する
   * @returns {Promise<void>}
   */
  private async _handleRemoteNewAdd(p: string, perFileRemoteSha: string, baseSnapshot: Record<string, string>, remoteHeadSha: string, conflicts: Array<any>, workspaceSha: string | undefined, baseSha: string | undefined): Promise<void> {
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
    const entry = { path: p, state: 'base', baseSha: perFileRemoteSha, updatedAt: Date.now() }
    await this.backend.writeBlob(p, JSON.stringify(entry), 'info')
    await this.backend.writeBlob(p, content, 'base')
  }

  /**
   * 既存ファイルに対する更新/競合処理
   * @returns {Promise<void>}
   */
  private async _handleRemoteExisting(p: string, indexEntry: any, perFileRemoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<any>, localWorkspace: { sha: string; content: string } | undefined, remoteHeadSha: string): Promise<void> {
    const baseSha = indexEntry.baseSha
    if (baseSha === perFileRemoteSha) return
    if (!localWorkspace || localWorkspace.sha === baseSha) {
      await this._handleRemoteExistingUpdate(p, indexEntry, perFileRemoteSha, baseSnapshot, conflicts, remoteHeadSha)
    } else {
      await this._handleRemoteExistingConflict(p, indexEntry, perFileRemoteSha, baseSnapshot, conflicts, localWorkspace, remoteHeadSha)
    }
  }

  /**
   * 既存ファイルの更新処理
   * @returns {Promise<void>}
   */
  private async _handleRemoteExistingUpdate(p: string, indexEntry: any, perFileRemoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<any>, remoteHeadSha: string): Promise<void> {
    const baseSha = indexEntry.baseSha
    const content = baseSnapshot[p]
    if (typeof content === 'undefined') {
      indexEntry.state = 'conflict'
      indexEntry.remoteSha = remoteHeadSha
      indexEntry.updatedAt = Date.now()
      await this.backend.writeBlob(p, JSON.stringify(indexEntry), 'info')
      await this.indexManager.saveIndex()
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
   * 既存ファイルで競合が発生した場合の処理
   * @returns {Promise<void>}
   */
  private async _handleRemoteExistingConflict(p: string, indexEntry: any, perFileRemoteSha: string, baseSnapshot: Record<string, string>, conflicts: Array<any>, localWorkspace: { sha: string; content: string }, remoteHeadSha: string): Promise<void> {
    const baseSha = indexEntry.baseSha
    await this.conflictManager.persistRemoteContentAsConflict(p, baseSnapshot[p])
    this.conflictManager.setIndexEntryToConflict(p, indexEntry, remoteHeadSha)
    await this.indexManager.saveIndex()
    conflicts.push({ path: p, baseSha, remoteSha: remoteHeadSha, workspaceSha: localWorkspace?.sha })
  }

  /**
   * リモートで削除されたパスの処理
   * @returns {Promise<void>}
   */
  private async _handleRemoteDeletion(p: string, indexEntry: any, _remoteShas: Record<string, string>, conflicts: Array<any>): Promise<void> {
    let localWorkspace: { sha: string; content: string } | undefined = undefined
    const wsBlob = await this.backend.readBlob(p, 'workspace')
    if (wsBlob !== null) {
      const wsSha = indexEntry?.workspaceSha || await shaOf(wsBlob)
      localWorkspace = { sha: wsSha, content: wsBlob }
    }
    if (!indexEntry || !indexEntry.baseSha) {
      return
    }

    if (!localWorkspace || localWorkspace.sha === indexEntry.baseSha) {
      await this.backend.deleteBlob(p, 'info')
      await this.backend.deleteBlob(p)
    } else {
      conflicts.push({ path: p, baseSha: indexEntry.baseSha, workspaceSha: localWorkspace?.sha })
    }
  }

  /**
   * 変更をローカルに適用する（create/update/delete）
   * @returns {Promise<void>}
   */
  private async _applyChangeLocally(ch: any): Promise<void> {
    if (ch.type === 'create' || ch.type === 'update') {
      const sha = await shaOf(ch.content)
      let entry: any = undefined
      const infoTxt = await this.backend.readBlob(ch.path, 'info')
      if (infoTxt) entry = JSON.parse(infoTxt)
      if (!entry) entry = { path: ch.path }
      entry.baseSha = sha
      entry.state = 'base'
      entry.updatedAt = Date.now()
      entry.workspaceSha = undefined
      await this.backend.writeBlob(ch.path, JSON.stringify(entry), 'info')
      await this.applier.applyCreateOrUpdate(ch)
    } else if (ch.type === 'delete') {
      await this.applier.applyDelete(ch)
    }
  }
}

export default RemoteSynchronizer
