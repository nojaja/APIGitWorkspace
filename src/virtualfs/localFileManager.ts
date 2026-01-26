import type { StorageBackend } from './storageBackend'

/**
 * ローカルファイル操作のラッパー
 */
export class LocalFileManager {
  private backend: StorageBackend

  /**
   * コンストラクタ
   * @param {StorageBackend} backend - ストレージバックエンド
   */
  constructor(backend: StorageBackend) {
    this.backend = backend
  }

  /**
   * ファイルを書き込む（workspace領域）
   * @param {string} filepath - ファイルパス
   * @param {string} content - 書き込む内容
   * @returns {Promise<void>}
   */
  async writeFile(filepath: string, content: string): Promise<void> {
    await this.backend.writeBlob(`${filepath}`, content, 'workspace')
  }

  /**
   * ファイルを削除する（workspace と info をクリア）
   * @param {string} filepath - ファイルパス
   * @returns {Promise<void>}
   */
  async deleteFile(filepath: string): Promise<void> {
    // Previously we used tombstones (`info` entry with state='remove').
    // Tombstone approach removed: always clean workspace cache and info blob.
    await this.backend.deleteBlob(`${filepath}`, 'workspace')
    await this.backend.deleteBlob(`${filepath}`, 'info')
  }

  /**
   * ワークスペースまたはベースからファイルを読み出す
   * @param {string} filepath - ファイルパス
   * @returns {Promise<string|null>} ファイル内容または null
   */
  async readFile(filepath: string): Promise<string | null> {
    const wsBlob = await this.backend.readBlob(filepath, 'workspace')
    if (wsBlob !== null) return wsBlob
    const baseBlob = await this.backend.readBlob(filepath, 'base')
    if (baseBlob !== null) return baseBlob
    return null
  }

  /**
   * ファイルをリネームする（内容をコピーして元を削除）
   * @param {string} from - 元パス
   * @param {string} to - 先パス
   * @returns {Promise<void>}
   */
  async renameFile(from: string, to: string): Promise<void> {
    const content = await this.readFile(from)
    if (content === null) throw new Error('Source file not found')
    await this.writeFile(to, content)
    await this.deleteFile(from)
  }
}

export default LocalFileManager
