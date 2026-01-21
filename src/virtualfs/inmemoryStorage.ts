import { IndexFile } from './types'
import { StorageBackend, StorageBackendConstructor } from './storageBackend'

/**
 * テストや軽量動作検証用のインメモリ実装。
 * `StorageBackend` を実装し、アプリケーション側で差し替えて利用できます。
 */
export const InMemoryStorage: StorageBackendConstructor = class InMemoryStorage implements StorageBackend {
  private index: IndexFile = { head: '', entries: {} }
  private blobs: Map<string, string> = new Map()

  /**
   * 静的: この実装が利用可能かを同期判定します。
   * テスト/インメモリなので常に true を返します。
   * @returns {boolean} 利用可能なら true
   */
  static canUse(): boolean {
    return true
  }
  /**
   * コンストラクタ。互換性のために `dir` 引数を受け取るが無視する。
   * @param _dir 任意のディレクトリ文字列（使用しない）
   */
  constructor(_dir?: string) {
    // accept dir for compatibility but ignore
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
    return this.index
  }

  /**
   * IndexFile を設定します。
   * @param idx 書き込む IndexFile
   */
  async writeIndex(idx: IndexFile): Promise<void> {
    this.index = idx
  }

  /**
   * 指定パスに対して文字列コンテンツを保存します。
   * @param filepath ファイルパス
   * @param content ファイル内容
   */
  async writeBlob(filepath: string, content: string): Promise<void> {
    this.blobs.set(filepath, content)
  }

  /**
   * 指定パスの内容を取得します。
   * @param filepath ファイルパス
   * @returns {Promise<string|null>} 内容、存在しなければ null
   */
  async readBlob(filepath: string): Promise<string | null> {
    if (this.blobs.has(filepath)) return this.blobs.get(filepath)!
    // backward-compatible read-through: check workspace/ then .git-base/
    const wsKey = `workspace/${filepath}`
    if (this.blobs.has(wsKey)) return this.blobs.get(wsKey)!
    const baseKey = `.git-base/${filepath}`
    if (this.blobs.has(baseKey)) return this.blobs.get(baseKey)!
    return null
  }

  /**
   * 指定パスのエントリを削除します。
   * @param filepath ファイルパス
   */
  async deleteBlob(filepath: string): Promise<void> {
    // delete plain key and any workspace/.git-base variants
    this.blobs.delete(filepath)
    this.blobs.delete(`workspace/${filepath}`)
    this.blobs.delete(`.git-base/${filepath}`)
  }
}

export default InMemoryStorage
