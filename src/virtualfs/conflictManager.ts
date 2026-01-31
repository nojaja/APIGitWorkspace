import { StorageBackend } from './storageBackend.ts'
import { IndexManager } from './indexManager.ts'

/**
 *
 */
export class ConflictManager {
  private backend: StorageBackend
  private indexManager: IndexManager

  /**
   *
   */
  constructor(backend: StorageBackend, indexManager: IndexManager) {
    this.backend = backend
    this.indexManager = indexManager
  }

  /**
   * 指定パスのコンフリクト内容を読み取る
   * @param {string} filepath - ファイルパス
   * @returns {Promise<string|null>} コンフリクトの内容、なければnull
   */
  async readConflict(filepath: string): Promise<string | null> {
    const blob = await this.backend.readBlob(filepath, 'conflict')
    if (blob !== null) return blob
    return null
  }

  /**
   * コンフリクトを解消してインデックスを更新する
   * @param {string} filepath - ファイルパス
   * @returns {Promise<boolean>} 成功すればtrue、失敗すればfalse
   */
  async resolveConflict(filepath: string): Promise<boolean> {
    try {
      const remoteContent = await this.backend.readBlob(filepath, 'conflict')
      const ie: any = await this._loadIndexEntry(filepath)

      if (ie && ie.remoteSha) {
        if (remoteContent !== null) {
          await this.backend.writeBlob(filepath, remoteContent, 'base')
        }
        ie.baseSha = ie.remoteSha
        delete ie.remoteSha
        ie.state = 'base'
        ie.updatedAt = Date.now()
        await this.backend.writeBlob(filepath, JSON.stringify(ie), 'info')
      }

      try {
        await this.backend.deleteBlob(filepath, 'conflict')
      } catch (error) {
        // ignore
      }

      await this.indexManager.saveIndex()
      // Ensure index head reflects resolved remote state when possible
      try {
        if (ie && ie.baseSha) {
          this.indexManager.setHead(ie.baseSha)
          await this.indexManager.saveIndex()
        }
      } catch (error) {
        // best-effort: ignore errors when updating head
      }
      await this.indexManager.loadIndex()
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Load index entry from info blob or index entries.
   * @param {string} filepath
   * @returns {Promise<any>} index entry or undefined
   */
  private async _loadIndexEntry(filepath: string): Promise<any> {
    let ie: any = undefined
    const infoTxt = await this.backend.readBlob(filepath, 'info')
    if (infoTxt) ie = JSON.parse(infoTxt)
    if (!ie) {
      const index = await this.indexManager.getIndex()
      ie = index.entries[filepath]
    }
    return ie
  }

  /**
   * リモートの内容をコンフリクトとして永続化する
   * @param {string} p - ファイルパス
   * @param {string|undefined} content - 永続化する内容
   * @returns {Promise<void>}
   */
  async persistRemoteContentAsConflict(p: string, content: string | undefined): Promise<void> {
    if (typeof content === 'undefined') return
    try {
      await this.backend.writeBlob(p, content, 'conflict')
    } catch (error) {
      return
    }
  }

  /**
   * 指定のインデックスエントリをコンフリクト状態にする
   * @param {string} p - ファイルパス
   * @param {any} ie - インデックスエントリオブジェクト
   * @param {string} remoteHeadSha - リモートのHEAD SHA
   * @returns {Promise<void>}
   */
  async setIndexEntryToConflict(p: string, ie: any, remoteHeadSha: string): Promise<void> {
    ie.state = 'conflict'
    ie.remoteSha = remoteHeadSha
    ie.updatedAt = Date.now()
    await this.backend.writeBlob(p, JSON.stringify(ie), 'info')
  }

  /**
   * 解決済みのコンフリクトエントリを昇格してベース状態に戻す
   * @param {any} c - コンフリクト情報（.path を含む）
   * @param {Record<string,string>} baseSnapshot - ベーススナップショットマップ
   * @returns {Promise<void>}
   */
  async promoteResolvedConflictEntry(c: any, baseSnapshot: Record<string, string>): Promise<void> {
    const p = c.path
    let ie: any = undefined
    const infoTxt = await this.backend.readBlob(p, 'info')
    if (infoTxt) ie = JSON.parse(infoTxt)
    if (!ie) return
    let content = typeof baseSnapshot[p] !== 'undefined' ? baseSnapshot[p] : null
    if (content === null) {
      content = await this.backend.readBlob(p, 'base')
    }
    if (content !== null) {
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
   * 全てのコンフリクトが解決済みか判定する
   * @param {Array<any>} conflicts - コンフリクト一覧
   * @returns {Promise<boolean>} 全て解決済みならtrue
   */
  async areAllResolved(conflicts: Array<any>): Promise<boolean> {
    for (const c of conflicts) {
      const p = c.path
      let ie: any = undefined
      const infoTxt = await this.backend.readBlob(p, 'info')
      if (infoTxt) ie = JSON.parse(infoTxt)
      if (!ie) {
        const index = await this.indexManager.getIndex()
        ie = index.entries[p]
      }
      if (!ie || !ie.remoteSha || ie.baseSha !== ie.remoteSha) return false
    }
    return true
  }

  /**
   * 解決済みのコンフリクト群を昇格してインデックスを更新する
   * @param {Array<any>} conflicts - コンフリクト一覧
   * @param {Record<string,string>} baseSnapshot - ベーススナップショット
   * @param {string} remoteHead - リモートのHEAD
   * @returns {Promise<void>}
   */
  async promoteResolvedConflicts(conflicts: Array<any>, baseSnapshot: Record<string, string>, remoteHead: string): Promise<void> {
    if (!(await this.areAllResolved(conflicts))) return
    for (const c of conflicts) {
      await this.promoteResolvedConflictEntry(c, baseSnapshot)
    }
    this.indexManager.setHead(remoteHead)
    await this.indexManager.saveIndex()
  }
}

export default ConflictManager
