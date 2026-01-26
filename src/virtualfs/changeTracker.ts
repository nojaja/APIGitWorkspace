import { StorageBackend } from './storageBackend'
import { IndexManager } from './indexManager'
import { IndexFile } from './types'

/**
 * 変更追跡を行うユーティリティクラス
 */
export class ChangeTracker {
  private backend: StorageBackend
  private indexManager: IndexManager

  /**
   * コンストラクタ
   * @param {StorageBackend} backend - ストレージバックエンド
   * @param {IndexManager} indexManager - インデックス管理オブジェクト
   */
  constructor(backend: StorageBackend, indexManager: IndexManager) {
    this.backend = backend
    this.indexManager = indexManager
  }

  /**
   * ワークスペースの変更セットを取得する
   * @returns {Promise<Array>} 変更オブジェクトの配列
   */
  async getChangeSet(): Promise<Array<any>> {
    type Change =
      | { type: 'create'; path: string; content: string }
      | { type: 'update'; path: string; content: string; baseSha?: string }
      | { type: 'delete'; path: string; baseSha: string }

    const changes: Change[] = []
    const deleteChanges = await this._changesFromIndexDeletes()
    changes.push(...deleteChanges)
    const tombChanges = await this._changesFromTombstones()
    changes.push(...tombChanges)
    const indexChanges = await this._changesFromIndexEntries()
    changes.push(...indexChanges)
    return changes
  }

  /**
   * インデックス差分から削除変更を取得する
   * @returns {Promise<Array<{type:'delete';path:string;baseSha:string}>>} 削除変更の配列
   */
  private async _changesFromIndexDeletes(): Promise<Array<{ type: 'delete'; path: string; baseSha: string }>> {
    const out: Array<{ type: 'delete'; path: string; baseSha: string }> = []
    const index = await this.indexManager.getIndex()
    for (const [p, entry] of Object.entries(index.entries || {})) {
      try {
        const ie: any = entry as any
        if (!ie || !ie.baseSha) continue
        const ws = await this.backend.readBlob(p, 'workspace')
        if (ws !== null) continue
        out.push({ type: 'delete', path: p, baseSha: ie.baseSha })
      } catch (error) {
        continue
      }
    }
    return out
  }

  /**
   * トゥームストーンから削除変更を取得する（未実装：空配列を返す）
   * @returns {Promise<Array<{type:'delete';path:string;baseSha:string}>>}
   */
  private async _changesFromTombstones(): Promise<Array<{ type: 'delete'; path: string; baseSha: string }>> {
    return []
  }

  /**
   * インデックスエントリから作成・更新の変更を取得する
   * @returns {Promise<Array>} 作成/更新変更の配列
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
   * 単一のインデックスファイルから変更を抽出する
   * @param {string} p - ファイルパス
   * @param {string|null} infoTxt - インデックスの情報テキスト
   * @returns {Promise<Array>} 変更配列
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
   * インデックスエントリから具体的な変更リストを作る
   * @param {any} entry - インデックスエントリ
   * @param {string} p - パス
   * @param {string|null} blob - blob コンテンツ
   * @returns {Array} 変更オブジェクト配列
   */
  private _changesFromIndexEntry(entry: any, p: string, blob: string | null): Array<any> {
    const out: Array<{ type: 'create'; path: string; content: string } | { type: 'update'; path: string; content: string; baseSha?: string }> = []
    if (entry.state === 'added') {
      if (blob == null) return out
      out.push({ type: 'create', path: p, content: blob })
      return out
    }
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
   * エントリが変更対象として考慮されるか判定する
   * @param {any} entry - インデックスエントリ
   * @returns {boolean} 考慮対象ならtrue
   */
  private _isEntryConsidered(entry: any): boolean {
    return entry.state === 'modified' || entry.state === 'conflict' || (!!entry.workspaceSha && entry.state !== 'added')
  }
}
